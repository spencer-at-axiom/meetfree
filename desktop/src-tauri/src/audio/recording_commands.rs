use anyhow::Result;
use log::warn;
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;

use crate::api::TranscriptSegment as PersistedTranscriptSegment;
use crate::database::repositories::transcript::{SaveTranscriptOptions, TranscriptsRepository};

use super::transcription::{self, reset_speech_detected_flag};
use super::{
    default_input_device, default_output_device, AudioDevice, DeviceEvent, DeviceMonitorType,
    RecordingManager,
};

pub use super::transcription::TranscriptUpdate;

static IS_RECORDING: AtomicBool = AtomicBool::new(false);
static IS_PAUSED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Default)]
pub struct RecordingRuntimeState {
    active_session: Arc<Mutex<Option<RecordingSession>>>,
    session_operation_in_progress: Arc<AtomicBool>,
}

struct RecordingSession {
    manager: RecordingManager,
    transcription_task: JoinHandle<()>,
    transcript_listener_id: tauri::EventId,
    transcript_updates_rx:
        mpsc::UnboundedReceiver<crate::audio::recording_saver::TranscriptSegment>,
    device_events: VecDeque<DeviceEvent>,
}

struct ReconnectRequest {
    device_name: String,
    device_type: DeviceMonitorType,
}

impl RecordingRuntimeState {
    pub fn new() -> Self {
        Self::default()
    }

    async fn start_session(
        &self,
        session: RecordingSession,
    ) -> std::result::Result<(), (String, RecordingSession)> {
        let mut guard = self.active_session.lock().await;
        if guard.is_some() {
            return Err(("Recording already in progress".to_string(), session));
        }
        *guard = Some(session);
        Ok(())
    }

    async fn take_session(&self) -> Option<RecordingSession> {
        self.active_session.lock().await.take()
    }

    async fn replace_session(&self, session: RecordingSession) {
        *self.active_session.lock().await = Some(session);
    }

    fn mark_session_operation_started(&self) {
        self.session_operation_in_progress
            .store(true, Ordering::SeqCst);
    }

    fn mark_session_operation_finished(&self) {
        self.session_operation_in_progress
            .store(false, Ordering::SeqCst);
    }

    fn is_session_operation_in_progress(&self) -> bool {
        self.session_operation_in_progress.load(Ordering::SeqCst)
    }

    async fn with_session<T>(&self, f: impl FnOnce(&mut RecordingSession) -> T) -> Option<T> {
        let mut guard = self.active_session.lock().await;
        guard.as_mut().map(f)
    }
}

fn recording_runtime<R: Runtime>(app: &AppHandle<R>) -> RecordingRuntimeState {
    app.state::<crate::state::AppState>()
        .recording_runtime
        .clone()
}

#[derive(Debug, Serialize, Clone)]
pub struct TranscriptionStatus {
    pub chunks_in_queue: usize,
    pub is_processing: bool,
    pub last_activity_ms: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct MeetingFinalizationResult {
    pub meeting_id: String,
    pub meeting_title: String,
    pub folder_path: Option<String>,
    pub transcript_count: usize,
    pub duration_seconds: f64,
    pub source_type: String,
    pub transcription_timed_out: bool,
    pub save_error: Option<String>,
    pub finalized_at: String,
}

fn fallback_meeting_name() -> String {
    let now = chrono::Local::now();
    format!("Meeting {}", now.format("%Y-%m-%d_%H-%M-%S"))
}

async fn persist_recording_to_database<R: Runtime>(
    app: &AppHandle<R>,
    meeting_name: Option<String>,
    meeting_folder: Option<std::path::PathBuf>,
    transcript_segments: Vec<crate::audio::recording_saver::TranscriptSegment>,
    options: SaveTranscriptOptions,
) -> Result<String, String> {
    let meeting_title = meeting_name.unwrap_or_else(fallback_meeting_name);
    let folder_path = meeting_folder.map(|path| path.to_string_lossy().to_string());
    let preferences = crate::preferences::load_app_preferences(app)
        .await
        .unwrap_or_default();
    let transcripts_to_save: Vec<PersistedTranscriptSegment> = transcript_segments
        .into_iter()
        .map(|segment| PersistedTranscriptSegment {
            id: segment.id,
            text: crate::transcript_processing::clean_for_storage(
                &segment.text,
                &preferences.transcript_cleanup,
            ),
            raw_text: Some(segment.text),
            timestamp: segment.display_time,
            audio_start_time: Some(segment.audio_start_time),
            audio_end_time: Some(segment.audio_end_time),
            duration: Some(segment.duration),
            speaker: segment.speaker,
        })
        .collect();

    let state = app.state::<crate::state::AppState>();

    // Retry database writes to handle transient failures.
    let pool = state.db_manager.pool().clone();
    let meeting_title_clone = meeting_title.clone();
    let transcripts_clone = transcripts_to_save.clone();
    let folder_path_clone = folder_path.clone();

    crate::database::retry::retry_db_operation(
        || async {
            TranscriptsRepository::save_transcript(
                &pool,
                &meeting_title_clone,
                &transcripts_clone,
                folder_path_clone.clone(),
                options.clone(),
            )
            .await
            .map_err(|e| anyhow::anyhow!("Database error: {}", e))
        },
        3, // 3 retries
        "save_transcript",
    )
    .await
    .map_err(|e| format!("Failed to save meeting transcript after retries: {}", e))
}

fn validate_transcription_ready_error<R: Runtime>(app: &AppHandle<R>, error_message: &str) {
    let user_message = if error_message.to_ascii_lowercase().contains("download") {
        "Recording cannot start: Transcription model is still downloading. Please wait for the download to complete."
    } else {
        "Recording cannot start: Transcription model is unavailable. Check model settings and try again."
    };

    let _ = app.emit(
        "transcription-error",
        serde_json::json!({
            "error": error_message,
            "userMessage": user_message,
            "actionable": false
        }),
    );
}

async fn create_session<R: Runtime>(
    app: &AppHandle<R>,
    mut manager: RecordingManager,
    meeting_name: Option<String>,
    microphone_device: Option<Arc<super::AudioDevice>>,
    system_device: Option<Arc<super::AudioDevice>>,
    auto_save: bool,
) -> Result<(), String> {
    manager.set_meeting_name(Some(meeting_name.unwrap_or_else(fallback_meeting_name)));

    let app_for_error = app.clone();
    manager.set_error_callback(move |audio_error| {
        let _ = app_for_error.emit("recording-error", audio_error.user_message());
    });

    let transcription_receiver = manager
        .start_recording(microphone_device, system_device, auto_save)
        .await
        .map_err(|e| format!("Failed to start recording: {}", e))?;

    let transcription_task =
        transcription::start_transcription_task(app.clone(), transcription_receiver);
    let (tx, rx) = mpsc::unbounded_channel();

    use tauri::Listener;
    let listener_id = app.listen("transcript-update", move |event: tauri::Event| {
        if let Ok(update) = serde_json::from_str::<TranscriptUpdate>(event.payload()) {
            let _ = tx.send(crate::audio::recording_saver::TranscriptSegment {
                id: format!("seg_{}", update.sequence_id),
                text: update.text,
                audio_start_time: update.audio_start_time,
                audio_end_time: update.audio_end_time,
                duration: update.duration,
                display_time: update.timestamp,
                confidence: update.confidence,
                sequence_id: update.sequence_id,
                speaker: None, // Speaker identification not yet implemented
            });
        }
    });

    let runtime = recording_runtime(app);
    let session = RecordingSession {
        manager,
        transcription_task,
        transcript_listener_id: listener_id,
        transcript_updates_rx: rx,
        device_events: VecDeque::new(),
    };

    match runtime.start_session(session).await {
        Ok(()) => {}
        Err((error, mut orphaned_session)) => {
            app.unlisten(orphaned_session.transcript_listener_id);
            orphaned_session.transcription_task.abort();
            while let Ok(segment) = orphaned_session.transcript_updates_rx.try_recv() {
                orphaned_session.manager.add_transcript_segment(segment);
            }
            if let Err(cleanup_error) = orphaned_session
                .manager
                .stop_streams_and_force_flush()
                .await
            {
                warn!(
                    "Failed to clean up orphaned recording session after start conflict: {}",
                    cleanup_error
                );
            }
            return Err(error);
        }
    }

    IS_RECORDING.store(true, Ordering::SeqCst);
    IS_PAUSED.store(false, Ordering::SeqCst);
    reset_speech_detected_flag();
    Ok(())
}

pub async fn start_recording<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    start_recording_with_meeting_name(app, None).await
}

pub async fn start_recording_with_meeting_name<R: Runtime>(
    app: AppHandle<R>,
    meeting_name: Option<String>,
) -> Result<(), String> {
    if IS_RECORDING.load(Ordering::SeqCst) {
        return Err("Recording already in progress".to_string());
    }

    if let Err(error_message) = transcription::validate_transcription_model_ready(&app).await {
        validate_transcription_ready_error(&app, &error_message);
        return Err(error_message);
    }

    let prefs = super::recording_preferences::load_recording_preferences(&app)
        .await
        .unwrap_or_default();

    let microphone_device = prefs
        .preferred_mic_device
        .as_ref()
        .map(|name| Arc::new(AudioDevice::new(name.clone(), super::DeviceType::Input)))
        .or_else(|| default_input_device().ok().map(Arc::new))
        .ok_or_else(|| "No microphone device available".to_string())?;

    let system_device = prefs
        .preferred_system_device
        .as_ref()
        .map(|name| Arc::new(AudioDevice::new(name.clone(), super::DeviceType::Output)))
        .or_else(|| default_output_device().ok().map(Arc::new));

    create_session(
        &app,
        RecordingManager::new(),
        meeting_name,
        Some(microphone_device.clone()),
        system_device.clone(),
        prefs.auto_save,
    )
    .await?;

    if let Err(error) = app.emit(
        "recording-started",
        serde_json::json!({
            "message":"Recording started successfully with parallel processing",
            "devices":[
                microphone_device.name,
                system_device.map(|d| d.name.clone()).unwrap_or_else(|| "Default System Audio".to_string())
            ],
            "workers":3
        }),
    ) {
        warn!("Failed to emit recording-started event: {}", error);
    }
    crate::tray::update_tray_menu(&app);
    Ok(())
}

pub async fn start_recording_with_devices<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
) -> Result<(), String> {
    start_recording_with_devices_and_meeting(app, mic_device_name, system_device_name, None).await
}

pub async fn start_recording_with_devices_and_meeting<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
    meeting_name: Option<String>,
) -> Result<(), String> {
    if IS_RECORDING.load(Ordering::SeqCst) {
        return Err("Recording already in progress".to_string());
    }

    if let Err(error_message) = transcription::validate_transcription_model_ready(&app).await {
        validate_transcription_ready_error(&app, &error_message);
        return Err(error_message);
    }

    // Validate audio devices before starting recording
    if let Err(e) = crate::audio::device_validation::validate_audio_devices(
        mic_device_name.as_deref(),
        system_device_name.as_deref(),
    )
    .await
    {
        return Err(e.to_string());
    }

    let auto_save = super::recording_preferences::load_recording_preferences(&app)
        .await
        .map(|prefs| prefs.auto_save)
        .unwrap_or(true);

    let microphone_device = mic_device_name
        .as_ref()
        .map(|name| Arc::new(AudioDevice::new(name.clone(), super::DeviceType::Input)));

    let system_device = system_device_name
        .as_ref()
        .map(|name| Arc::new(AudioDevice::new(name.clone(), super::DeviceType::Output)));

    create_session(
        &app,
        RecordingManager::new(),
        meeting_name,
        microphone_device,
        system_device,
        auto_save,
    )
    .await?;

    if let Err(error) = app.emit(
        "recording-started",
        serde_json::json!({
            "message":"Recording started with custom devices and parallel processing",
            "devices":[
                mic_device_name.unwrap_or_else(|| "Default Microphone".to_string()),
                system_device_name.unwrap_or_else(|| "Default System Audio".to_string())
            ],
            "workers":3
        }),
    ) {
        warn!("Failed to emit recording-started event: {}", error);
    }
    crate::tray::update_tray_menu(&app);
    Ok(())
}

pub async fn stop_and_finalize_recording<R: Runtime>(
    app: AppHandle<R>,
) -> Result<MeetingFinalizationResult, String> {
    let runtime = recording_runtime(&app);
    let mut wait_elapsed_ms = 0u64;
    let mut session = loop {
        if let Some(session) = runtime.take_session().await {
            break session;
        }
        if !runtime.is_session_operation_in_progress() {
            IS_RECORDING.store(false, Ordering::SeqCst);
            IS_PAUSED.store(false, Ordering::SeqCst);
            return Ok(MeetingFinalizationResult {
                meeting_id: String::new(),
                meeting_title: fallback_meeting_name(),
                folder_path: None,
                transcript_count: 0,
                duration_seconds: 0.0,
                source_type: "recorded".to_string(),
                transcription_timed_out: false,
                save_error: None,
                finalized_at: chrono::Utc::now().to_rfc3339(),
            });
        }
        if wait_elapsed_ms >= 31_000 {
            return Err(
                "Recording session is busy with another operation. Please retry stop.".to_string(),
            );
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        wait_elapsed_ms += 100;
    };

    if runtime.is_session_operation_in_progress() {
        runtime.mark_session_operation_finished();
    }

    let _ = app.emit(
        "recording-shutdown-progress",
        serde_json::json!({"stage":"stopping_audio","message":"Stopping audio capture...","progress":20}),
    );

    while let Ok(segment) = session.transcript_updates_rx.try_recv() {
        session.manager.add_transcript_segment(segment);
    }

    session
        .manager
        .stop_streams_and_force_flush()
        .await
        .map_err(|e| format!("Failed to stop audio streams: {}", e))?;

    let _ = app.emit(
        "recording-shutdown-progress",
        serde_json::json!({"stage":"processing_transcripts","message":"Processing remaining transcript chunks...","progress":40}),
    );

    // Use the transcription timeout from preferences.
    let preferences = crate::preferences::load_app_preferences(&app)
        .await
        .unwrap_or_default();
    let timeout_seconds = preferences.transcription_timeout_seconds;

    log::info!(
        "Waiting up to {} seconds for transcription to complete...",
        timeout_seconds
    );

    let mut transcription_timed_out = false;
    let mut transcription_task = session.transcription_task;
    match tokio::time::timeout(
        tokio::time::Duration::from_secs(timeout_seconds),
        &mut transcription_task,
    )
    .await
    {
        Ok(Ok(())) => {}
        Ok(Err(join_error)) => warn!("Transcription task join error: {:?}", join_error),
        Err(_) => {
            transcription_timed_out = true;
            warn!("Transcription drain timeout reached");
            transcription_task.abort();
        }
    }

    while let Ok(segment) = session.transcript_updates_rx.try_recv() {
        session.manager.add_transcript_segment(segment);
    }

    let _ = app.emit(
        "recording-shutdown-progress",
        serde_json::json!({"stage":"unloading_model","message":"Unloading speech recognition model...","progress":70}),
    );

    let provider = match tokio::time::timeout(
        tokio::time::Duration::from_secs(30),
        crate::api::api_get_transcript_config(app.clone(), app.clone().state(), None),
    )
    .await
    {
        Ok(Ok(Some(config))) => Some(config.provider),
        _ => None,
    };

    match provider.as_deref() {
        Some("parakeet") => {
            let engine_clone = {
                let guard = crate::parakeet_engine::commands::PARAKEET_ENGINE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                guard.as_ref().cloned()
            };
            if let Some(engine) = engine_clone {
                let _ = engine.unload_model().await;
            }
        }
        _ => {
            let engine_clone = {
                let guard = crate::whisper_engine::commands::WHISPER_ENGINE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                guard.as_ref().cloned()
            };
            if let Some(engine) = engine_clone {
                let _ = engine.unload_model().await;
            }
        }
    }

    let _ = app.emit(
        "recording-shutdown-progress",
        serde_json::json!({"stage":"finalizing","message":"Finalizing recording and cleaning up resources...","progress":90}),
    );

    let meeting_folder = session.manager.get_meeting_folder();
    let meeting_name = session.manager.get_meeting_name();
    let transcript_segments = session.manager.get_transcript_segments();
    let transcript_count = transcript_segments.len();
    let duration_seconds = session
        .manager
        .get_active_recording_duration()
        .or_else(|| {
            transcript_segments
                .last()
                .map(|segment| segment.audio_end_time)
        })
        .unwrap_or(0.0);

    let recording_ended_at = chrono::Utc::now();
    let recording_started_at = if duration_seconds > 0.0 {
        recording_ended_at - chrono::Duration::milliseconds((duration_seconds * 1000.0) as i64)
    } else {
        recording_ended_at
    };

    let save_options = SaveTranscriptOptions {
        source_type: Some("recorded".to_string()),
        duration_seconds: Some(duration_seconds),
        recording_started_at: Some(recording_started_at.to_rfc3339()),
        recording_ended_at: Some(recording_ended_at.to_rfc3339()),
        ..Default::default()
    };

    let (meeting_id, save_error) = match persist_recording_to_database(
        &app,
        meeting_name.clone(),
        meeting_folder.clone(),
        transcript_segments,
        save_options,
    )
    .await
    {
        Ok(meeting_id) => {
            if let Err(error) = session.manager.set_persisted_meeting_id(meeting_id.clone()) {
                warn!("Failed to persist meeting_id into metadata: {}", error);
            }
            (Some(meeting_id), None)
        }
        Err(error) => (None, Some(error)),
    };

    if let Err(error) = session.manager.save_recording_only(&app).await {
        warn!("Recording file save failed: {}", error);
    }

    use tauri::Listener;
    app.unlisten(session.transcript_listener_id);

    IS_RECORDING.store(false, Ordering::SeqCst);
    IS_PAUSED.store(false, Ordering::SeqCst);

    let finalization_result = MeetingFinalizationResult {
        meeting_id: meeting_id.unwrap_or_default(),
        meeting_title: meeting_name.unwrap_or_else(fallback_meeting_name),
        folder_path: meeting_folder.map(|path| path.to_string_lossy().to_string()),
        transcript_count,
        duration_seconds,
        source_type: "recorded".to_string(),
        transcription_timed_out,
        save_error,
        finalized_at: chrono::Utc::now().to_rfc3339(),
    };

    let _ = app.emit(
        "recording-shutdown-progress",
        serde_json::json!({"stage":"complete","message":"Recording stopped successfully","progress":100}),
    );

    if let Err(error) = app.emit("recording-stopped", &finalization_result) {
        warn!("Failed to emit recording-stopped event: {}", error);
    }

    if !finalization_result.meeting_id.is_empty() && finalization_result.save_error.is_none() {
        crate::embeddings::spawn_meeting_embedding_reindex(
            app.clone(),
            finalization_result.meeting_id.clone(),
        );

        let preferences = crate::preferences::load_app_preferences(&app)
            .await
            .unwrap_or_default();
        if preferences.auto_export_markdown_on_finalize {
            let app_for_export = app.clone();
            let meeting_id_for_export = finalization_result.meeting_id.clone();
            tauri::async_runtime::spawn(async move {
                let pool = {
                    let state = app_for_export.state::<crate::state::AppState>();
                    state.db_manager.pool().clone()
                };

                if let Err(error) = crate::markdown_export::export_meeting_markdown(
                    &app_for_export,
                    &pool,
                    &meeting_id_for_export,
                    None,
                    false,
                )
                .await
                {
                    warn!(
                        "Auto-export markdown failed for meeting {}: {}",
                        meeting_id_for_export, error
                    );
                }
            });
        }
    }

    crate::tray::update_tray_menu(&app);
    Ok(finalization_result)
}

pub async fn stop_recording<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    stop_and_finalize_recording(app).await.map(|_| ())
}

pub async fn is_recording() -> bool {
    IS_RECORDING.load(Ordering::SeqCst)
}

pub async fn get_transcription_status() -> TranscriptionStatus {
    let status_tracker = crate::audio::transcription::get_global_status();
    TranscriptionStatus {
        chunks_in_queue: status_tracker.get_chunks_in_queue(),
        is_processing: status_tracker.is_processing(),
        last_activity_ms: status_tracker.last_activity_ms(),
    }
}

#[tauri::command]
pub async fn pause_recording<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let runtime = recording_runtime(&app);
    match runtime
        .with_session(|session| session.manager.pause_recording().map_err(|e| e.to_string()))
        .await
    {
        Some(Ok(())) => {
            IS_PAUSED.store(true, Ordering::SeqCst);
            if let Err(error) = app.emit(
                "recording-paused",
                serde_json::json!({"message":"Recording paused"}),
            ) {
                warn!("Failed to emit recording-paused event: {}", error);
            }
            crate::tray::update_tray_menu(&app);
            Ok(())
        }
        Some(Err(error)) => Err(error),
        None => Err("No recording manager found".to_string()),
    }
}

#[tauri::command]
pub async fn resume_recording<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let runtime = recording_runtime(&app);
    match runtime
        .with_session(|session| {
            session
                .manager
                .resume_recording()
                .map_err(|e| e.to_string())
        })
        .await
    {
        Some(Ok(())) => {
            IS_PAUSED.store(false, Ordering::SeqCst);
            if let Err(error) = app.emit(
                "recording-resumed",
                serde_json::json!({"message":"Recording resumed"}),
            ) {
                warn!("Failed to emit recording-resumed event: {}", error);
            }
            crate::tray::update_tray_menu(&app);
            Ok(())
        }
        Some(Err(error)) => Err(error),
        None => Err("No recording manager found".to_string()),
    }
}

#[tauri::command]
pub async fn is_recording_paused<R: Runtime>(app: AppHandle<R>) -> bool {
    let runtime = recording_runtime(&app);
    runtime
        .with_session(|session| session.manager.is_paused())
        .await
        .unwrap_or_else(|| IS_PAUSED.load(Ordering::SeqCst))
}

#[tauri::command]
pub async fn get_recording_state(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<serde_json::Value, String> {
    let is_recording = IS_RECORDING.load(Ordering::SeqCst);
    Ok(state
        .recording_runtime
        .with_session(|session| {
            serde_json::json!({
                "is_recording": is_recording,
                "is_paused": session.manager.is_paused(),
                "is_active": session.manager.is_active(),
                "recording_duration": session.manager.get_recording_duration(),
                "active_duration": session.manager.get_active_recording_duration(),
                "total_pause_duration": session.manager.get_total_pause_duration(),
                "current_pause_duration": session.manager.get_current_pause_duration()
            })
        })
        .await
        .unwrap_or_else(|| {
            serde_json::json!({
                "is_recording": is_recording,
                "is_paused": false,
                "is_active": false,
                "recording_duration": null,
                "active_duration": null,
                "total_pause_duration": 0.0,
                "current_pause_duration": null
            })
        }))
}

#[tauri::command]
pub async fn get_meeting_folder_path(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<Option<String>, String> {
    Ok(state
        .recording_runtime
        .with_session(|session| {
            session
                .manager
                .get_meeting_folder()
                .map(|p| p.to_string_lossy().to_string())
        })
        .await
        .flatten())
}

#[tauri::command]
pub async fn get_transcript_history(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<Vec<crate::audio::recording_saver::TranscriptSegment>, String> {
    Ok(state
        .recording_runtime
        .with_session(|session| {
            while let Ok(segment) = session.transcript_updates_rx.try_recv() {
                session.manager.add_transcript_segment(segment);
            }
            session.manager.get_transcript_segments()
        })
        .await
        .unwrap_or_default())
}

#[tauri::command]
pub async fn get_recording_meeting_name(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<Option<String>, String> {
    Ok(state
        .recording_runtime
        .with_session(|session| session.manager.get_meeting_name())
        .await
        .flatten())
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type")]
pub enum DeviceEventResponse {
    DeviceDisconnected {
        device_name: String,
        device_type: String,
    },
    DeviceReconnected {
        device_name: String,
        device_type: String,
    },
    DeviceListChanged,
}

impl From<DeviceEvent> for DeviceEventResponse {
    fn from(event: DeviceEvent) -> Self {
        match event {
            DeviceEvent::DeviceDisconnected {
                device_name,
                device_type,
            } => DeviceEventResponse::DeviceDisconnected {
                device_name,
                device_type: format!("{:?}", device_type),
            },
            DeviceEvent::DeviceReconnected {
                device_name,
                device_type,
            } => DeviceEventResponse::DeviceReconnected {
                device_name,
                device_type: format!("{:?}", device_type),
            },
            DeviceEvent::DeviceListChanged => DeviceEventResponse::DeviceListChanged,
        }
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct ReconnectionStatus {
    pub is_reconnecting: bool,
    pub disconnected_device: Option<DisconnectedDeviceInfo>,
}

#[derive(Debug, Serialize, Clone)]
pub struct DisconnectedDeviceInfo {
    pub name: String,
    pub device_type: String,
}

#[tauri::command]
pub async fn poll_audio_device_events(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<Option<DeviceEventResponse>, String> {
    Ok(state
        .recording_runtime
        .with_session(|session| {
            if let Some(event) = session.manager.poll_device_events() {
                session.device_events.push_back(event);
            }
            session
                .device_events
                .pop_front()
                .map(DeviceEventResponse::from)
        })
        .await
        .flatten())
}

#[tauri::command]
pub async fn get_reconnection_status(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<ReconnectionStatus, String> {
    Ok(state
        .recording_runtime
        .with_session(|session| {
            let disconnected =
                session
                    .manager
                    .get_disconnected_device()
                    .map(|(name, device_type)| DisconnectedDeviceInfo {
                        name,
                        device_type: format!("{:?}", device_type),
                    });
            ReconnectionStatus {
                is_reconnecting: session.manager.is_reconnecting(),
                disconnected_device: disconnected,
            }
        })
        .await
        .unwrap_or(ReconnectionStatus {
            is_reconnecting: false,
            disconnected_device: None,
        }))
}

#[tauri::command]
pub async fn get_active_audio_output() -> Result<super::playback_monitor::AudioOutputInfo, String> {
    super::playback_monitor::get_active_audio_output()
        .await
        .map_err(|e| format!("Failed to get audio output info: {}", e))
}

#[tauri::command]
pub async fn attempt_device_reconnect(
    state: tauri::State<'_, crate::state::AppState>,
    device_name: String,
    device_type: String,
) -> Result<bool, String> {
    let request = ReconnectRequest {
        device_name: device_name.clone(),
        device_type: match device_type.as_str() {
            "Microphone" => DeviceMonitorType::Microphone,
            "SystemAudio" => DeviceMonitorType::SystemAudio,
            _ => return Err(format!("Invalid device type: {}", device_type)),
        },
    };

    let device_name = request.device_name;
    let device_type = request.device_type;
    let runtime = state.recording_runtime.clone();
    runtime.mark_session_operation_started();

    let mut session = match runtime.take_session().await {
        Some(session) => session,
        None => {
            runtime.mark_session_operation_finished();
            return Err("Recording not active".to_string());
        }
    };

    let reconnect_result = match tokio::time::timeout(
        tokio::time::Duration::from_secs(30),
        session
            .manager
            .attempt_device_reconnect(&device_name, device_type),
    )
    .await
    {
        Ok(result) => result.map_err(|e| e.to_string()),
        Err(_) => Err("Device reconnection timed out".to_string()),
    };

    runtime.replace_session(session).await;
    runtime.mark_session_operation_finished();
    reconnect_result
}
