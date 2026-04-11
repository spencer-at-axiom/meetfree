//! MeetFree Native Backend Library
//!
//! This is the Rust/Tauri backend for MeetFree, a local-first desktop application
//! for meeting capture, transcription, search, and summaries.
//!
//! # Architecture Overview
//!
//! The backend is organized into the following major modules:
//!
//! ## Core Modules
//!
//! - **audio**: Audio capture, processing, and transcription pipeline
//!   - Microphone recording (all platforms)
//!   - System audio capture (platform-dependent loopback path)
//!   - Audio import and retranscription
//!   - Device management and monitoring
//!   - Audio processing (noise suppression, loudness normalization, VAD)
//!
//! - **whisper_engine**: Local transcription via whisper-rs
//!   - GPU acceleration (Metal, CUDA, Vulkan, HipBLAS)
//!   - Parallel processing with resource monitoring
//!   - Model management and download
//!
//! - **parakeet_engine**: Fast ONNX-based transcription
//!   - Alternative to Whisper for speed
//!   - Lightweight models (~100MB)
//!
//! - **database**: SQLite persistence layer
//!   - Connection pooling (max 10 connections)
//!   - Automatic migrations via sqlx
//!   - FTS5 full-text search with BM25 ranking
//!   - Repository pattern for data access
//!
//! - **summary**: Summary generation with multiple providers
//!   - Ollama (local), OpenAI, Claude, Groq, OpenRouter, custom endpoints
//!   - Template-based summary generation
//!   - Chunking strategy for large transcripts
//!   - Contract validation for summary structure
//!
//! - **export**: Multi-format export (Markdown, PDF, DOCX)
//!   - Unified export architecture
//!   - Format-specific renderers
//!   - Vocabulary correction application
//!   - Batch export support
//!   - Performance truncation (PDF: 100 segments, DOCX: 200 segments)
//!
//! - **diarization**: Speaker identification via sherpa-onnx (native Rust)
//!   - ONNX model integration (bundled, no external dependencies)
//!   - Speaker turn storage
//!   - Confidence scoring
//!
//! - **vocabulary**: Vocabulary correction rules
//!   - Global and meeting-scoped rules
//!   - Case-sensitive and case-insensitive matching
//!   - Live preview of corrections
//!
//! ## Supporting Modules
//!
//! - **api**: Tauri command handlers for frontend communication
//! - **state**: Application state management
//! - **bootstrap**: Application initialization and cleanup
//! - **secure_storage**: OS-backed credential storage for API keys
//! - **preferences**: User preferences and settings
//! - **notifications**: Notification system with DND support
//! - **onboarding**: First-run setup flow
//! - **tray**: System tray integration
//!
//! ## Provider Modules
//!
//! - **ollama**: Ollama API client
//! - **openai**: OpenAI API client
//! - **groq**: Groq API client
//! - **openrouter**: OpenRouter API client
//!
//! # Platform Support
//!
//! - **macOS**: Core Audio tap for system audio capture
//! - **Windows**: WASAPI-hosted loopback-compatible input sources for system audio
//! - **Linux**: PulseAudio/PipeWire monitor-source capture for system audio
//!
//! # Known Limitations
//!
//! - Windows/Linux system audio capture depends on local driver/stack exposing loopback/monitor sources
//!
//! # Data Storage
//!
//! All data is stored locally in SQLite database:
//! - macOS: `~/Library/Application Support/com.meetfree.ai/`
//! - Windows: `%APPDATA%\com.meetfree.ai\`
//! - Linux: `~/.local/share/com.meetfree.ai/`
//!
//! API keys are stored in OS-backed secure storage (Keychain, Credential Manager, Secret Service).
//!
//! # Performance Optimizations
//!
//! - Buffer pooling to reduce allocations
//! - Parallel processing with adaptive worker management
//! - Connection pooling for database access
//! - FTS5 with BM25 ranking for fast search
//! - GPU acceleration for transcription
//! - Conditional logging macros for hot paths (perf_debug!, perf_trace!)
//!
//! # Security
//!
//! - API keys stored in OS-backed credential stores (never in plaintext)
//! - Minimal Tauri capability set
//! - CSP headers configured
//! - Asset protocol scoped to $APPDATA
//! - No dangerous permissions granted
//!
//! # Version
//!
//! Current version: 0.3.0
//! - PDF/DOCX export
//! - Speaker diarization
//! - Batch export
//! - Export path tracking

use serde::Serialize;
use std::sync::{Arc, Mutex as StdMutex};
// Removed unused import

// Performance optimization: Conditional logging macros for hot paths
#[cfg(debug_assertions)]
macro_rules! perf_debug {
    ($($arg:tt)*) => {
        log::debug!($($arg)*)
    };
}

#[cfg(not(debug_assertions))]
macro_rules! perf_debug {
    ($($arg:tt)*) => {};
}

#[cfg(debug_assertions)]
macro_rules! perf_trace {
    ($($arg:tt)*) => {
        log::trace!($($arg)*)
    };
}

#[cfg(not(debug_assertions))]
macro_rules! perf_trace {
    ($($arg:tt)*) => {};
}

// Make these macros available to other modules

// Re-export async logging macros for external use (removed due to macro conflicts)

// Declare audio module
#[macro_use]
pub mod command_registry;
pub mod api;
pub mod audio;
pub mod bootstrap;
pub mod brand;
pub mod config;
pub mod console_utils;
pub mod database;
pub mod diarization;
pub mod groq;
pub mod export;
pub mod markdown_export;
pub mod notifications;
pub mod ollama;
pub mod onboarding;
pub mod openai;
pub mod openrouter;
pub mod parakeet_engine;
pub mod preferences;
pub mod progress;
pub mod secure_storage;
pub mod state;
pub mod summary;
pub mod transcript_processing;
pub mod tray;
pub mod utils;
pub mod vocabulary;
pub mod whisper_engine;

use audio::{list_audio_devices, trigger_audio_permission, AudioDevice};
use log::{error as log_error, info as log_info};
use notifications::commands::NotificationManagerState;
use tauri::{AppHandle, Manager, Runtime};

// CRITICAL FIX: Removed global RECORDING_FLAG - now managed in RecordingRuntimeState
// This was causing thread safety issues. Recording state is now properly managed
// through the RecordingRuntimeState in audio::recording_commands module.

// CRITICAL FIX: Thread-safe language preference storage
// Wrapped in Arc<Mutex<T>> for safe concurrent access across threads
static LANGUAGE_PREFERENCE: std::sync::LazyLock<Arc<StdMutex<String>>> =
    std::sync::LazyLock::new(|| Arc::new(StdMutex::new("auto-translate".to_string())));

#[derive(Debug, Serialize, Clone)]
struct TranscriptionStatus {
    chunks_in_queue: usize,
    is_processing: bool,
    last_activity_ms: u64,
}

#[tauri::command]
async fn start_recording<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
    meeting_name: Option<String>,
) -> Result<(), String> {
    log_info!("start_recording called with meeting: {:?}", meeting_name);
    log_info!(
        "Backend received parameters - mic: {:?}, system: {:?}, meeting: {:?}",
        mic_device_name,
        system_device_name,
        meeting_name
    );

    if is_recording().await {
        return Err("Recording already in progress".to_string());
    }

    // Call the actual audio recording system with meeting name
    match audio::recording_commands::start_recording_with_devices_and_meeting(
        app.clone(),
        mic_device_name,
        system_device_name,
        meeting_name.clone(),
    )
    .await
    {
        Ok(_) => {
            // RECORDING_FLAG removed - state managed in RecordingRuntimeState
            tray::update_tray_menu(&app);

            log_info!("Recording started successfully");

            // Show recording started notification through NotificationManager
            // This respects user's notification preferences
            let notification_manager_state = app.state::<NotificationManagerState<R>>();
            if let Err(e) = notifications::commands::show_recording_started_notification(
                &app,
                &notification_manager_state,
                meeting_name.clone(),
            )
            .await
            {
                log_error!("Failed to show recording started notification: {}", e);
            } else {
                log_info!("Successfully showed recording started notification");
            }

            Ok(())
        }
        Err(e) => {
            log_error!("Failed to start audio recording: {}", e);
            Err(format!("Failed to start recording: {}", e))
        }
    }
}

#[tauri::command]
async fn stop_and_finalize_recording<R: Runtime>(
    app: AppHandle<R>,
) -> Result<audio::recording_commands::MeetingFinalizationResult, String> {
    log_info!("Attempting to stop recording...");

    match audio::recording_commands::stop_and_finalize_recording(app.clone()).await {
        Ok(finalization_result) => {
            // RECORDING_FLAG removed - state managed in RecordingRuntimeState
            tray::update_tray_menu(&app);

            // Show recording stopped notification through NotificationManager
            // This respects user's notification preferences
            let notification_manager_state = app.state::<NotificationManagerState<R>>();
            if let Err(e) = notifications::commands::show_recording_stopped_notification(
                &app,
                &notification_manager_state,
            )
            .await
            {
                log_error!("Failed to show recording stopped notification: {}", e);
            } else {
                log_info!("Successfully showed recording stopped notification");
            }

            Ok(finalization_result)
        }
        Err(e) => {
            log_error!("Failed to stop audio recording: {}", e);
            // RECORDING_FLAG removed - state managed in RecordingRuntimeState
            tray::update_tray_menu(&app);
            Err(format!("Failed to stop recording: {}", e))
        }
    }
}

#[tauri::command]
async fn stop_recording<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    // Deprecated compatibility wrapper. Prefer `stop_and_finalize_recording`.
    stop_and_finalize_recording(app).await.map(|_| ())
}

#[tauri::command]
async fn is_recording() -> bool {
    audio::recording_commands::is_recording().await
}

#[tauri::command]
fn get_transcription_status() -> TranscriptionStatus {
    let status_tracker = audio::transcription::get_global_status();
    TranscriptionStatus {
        chunks_in_queue: status_tracker.get_chunks_in_queue(),
        is_processing: status_tracker.is_processing(),
        last_activity_ms: status_tracker.last_activity_ms(),
    }
}

fn validate_audio_file_path(file_path: &str) -> Result<std::path::PathBuf, String> {
    let path = std::path::PathBuf::from(file_path);
    if !path.exists() {
        return Err("Audio file not found".to_string());
    }

    if !path.is_file() {
        return Err("Audio path must point to a file".to_string());
    }

    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase());
    let is_supported = matches!(
        extension.as_deref(),
        Some("mp4")
            | Some("m4a")
            | Some("wav")
            | Some("mp3")
            | Some("flac")
            | Some("ogg")
            | Some("aac")
            | Some("mkv")
            | Some("webm")
            | Some("wma")
    );

    if !is_supported {
        return Err("Unsupported audio file type".to_string());
    }

    Ok(path)
}

#[tauri::command]
fn read_audio_file(file_path: String) -> Result<Vec<u8>, String> {
    let path = validate_audio_file_path(&file_path)?;
    match std::fs::read(&path) {
        Ok(data) => Ok(data),
        Err(e) => Err(format!("Failed to read audio file: {}", e)),
    }
}

// Audio level monitoring commands
#[tauri::command]
async fn start_audio_level_monitoring<R: Runtime>(
    app: AppHandle<R>,
    device_names: Vec<String>,
) -> Result<(), String> {
    log_info!(
        "Starting audio level monitoring for devices: {:?}",
        device_names
    );

    audio::simple_level_monitor::start_monitoring(app, device_names)
        .await
        .map_err(|e| format!("Failed to start audio level monitoring: {}", e))
}

#[tauri::command]
async fn stop_audio_level_monitoring() -> Result<(), String> {
    log_info!("Stopping audio level monitoring");

    audio::simple_level_monitor::stop_monitoring()
        .await
        .map_err(|e| format!("Failed to stop audio level monitoring: {}", e))
}

#[tauri::command]
async fn is_audio_level_monitoring() -> bool {
    audio::simple_level_monitor::is_monitoring()
}

// Whisper commands are now handled by whisper_engine::commands module

#[tauri::command]
async fn get_audio_devices() -> Result<Vec<AudioDevice>, String> {
    list_audio_devices()
        .await
        .map_err(|e| format!("Failed to list audio devices: {}", e))
}

#[tauri::command]
async fn trigger_microphone_permission() -> Result<bool, String> {
    trigger_audio_permission()
        .map_err(|e| format!("Failed to trigger microphone permission: {}", e))
}

#[tauri::command]
async fn start_recording_with_devices<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
) -> Result<(), String> {
    start_recording_with_devices_and_meeting(app, mic_device_name, system_device_name, None).await
}

#[tauri::command]
async fn start_recording_with_devices_and_meeting<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
    meeting_name: Option<String>,
) -> Result<(), String> {
    log_info!(
        "start_recording_with_devices_and_meeting called - Mic: {:?}, System: {:?}, Meeting: {:?}",
        mic_device_name,
        system_device_name,
        meeting_name
    );

    // Clone meeting_name for notification use later
    let meeting_name_for_notification = meeting_name.clone();

    // Call the recording module functions that support meeting names
    let recording_result = match (mic_device_name.clone(), system_device_name.clone()) {
        (None, None) => {
            log_info!(
                "No devices specified, starting with defaults and meeting: {:?}",
                meeting_name
            );
            audio::recording_commands::start_recording_with_meeting_name(app.clone(), meeting_name)
                .await
        }
        _ => {
            log_info!(
                "Starting with specified devices: mic={:?}, system={:?}, meeting={:?}",
                mic_device_name,
                system_device_name,
                meeting_name
            );
            audio::recording_commands::start_recording_with_devices_and_meeting(
                app.clone(),
                mic_device_name,
                system_device_name,
                meeting_name,
            )
            .await
        }
    };

    match recording_result {
        Ok(_) => {
            log_info!("Recording started successfully via tauri command");

            // Show recording started notification through NotificationManager
            // This respects user's notification preferences
            let notification_manager_state = app.state::<NotificationManagerState<R>>();
            if let Err(e) = notifications::commands::show_recording_started_notification(
                &app,
                &notification_manager_state,
                meeting_name_for_notification.clone(),
            )
            .await
            {
                log_error!("Failed to show recording started notification: {}", e);
            }

            Ok(())
        }
        Err(e) => {
            log_error!("Failed to start recording via tauri command: {}", e);
            Err(e)
        }
    }
}

#[tauri::command]
async fn set_language_preference(language: String) -> Result<(), String> {
    let mut lang_pref = LANGUAGE_PREFERENCE
        .lock()
        .map_err(|e| format!("Failed to set language preference: {}", e))?;
    log_info!("Setting language preference to: {}", language);
    *lang_pref = language;
    Ok(())
}

// Internal helper function to get language preference (for use within Rust code)
pub fn get_language_preference_internal() -> Option<String> {
    LANGUAGE_PREFERENCE.lock().ok().map(|lang| lang.clone())
}

pub fn run() {
    log::set_max_level(log::LevelFilter::Info);

    let builder = bootstrap::configure_builder(tauri::Builder::default())
        .setup(bootstrap::setup_app)
        .invoke_handler(app_invoke_handler!());

    let app = match builder.build(tauri::generate_context!()) {
        Ok(app) => app,
        Err(error) => {
            log::error!("error while building tauri application: {}", error);
            return;
        }
    };

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            log::info!("Application exiting, cleaning up resources...");
            tauri::async_runtime::block_on(bootstrap::cleanup_on_exit(app_handle));
            log::info!("Application cleanup complete");
        }
    });
}
