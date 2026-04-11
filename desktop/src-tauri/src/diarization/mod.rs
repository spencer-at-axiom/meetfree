// Speaker diarization module
// Identifies different speakers in audio and labels transcript segments with speaker information
//
// Architecture:
// - Uses sherpa-onnx (native Rust) for speaker identification
// - Maps speaker segments to transcript timestamps
// - Stores results in speaker_turns table
// - Bundled ONNX models (no external dependencies)

pub mod model_manager;
pub mod sherpa_handler;
pub mod speaker_mapping;

#[cfg(test)]
mod tests;

use crate::database::repositories::speaker_identity::{
    NewMeetingSpeaker, SpeakerIdentitiesRepository,
};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime};

#[derive(Debug, Serialize)]
pub struct DiarizationResult {
    pub meeting_id: String,
    pub success: bool,
    pub speaker_count: Option<usize>,
    pub error: Option<String>,
}

/// Start diarization for a meeting's audio file
#[tauri::command]
pub async fn start_diarization<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, crate::state::AppState>,
    meeting_id: String,
    audio_path: String,
) -> Result<DiarizationResult, String> {
    let pool = state.db_manager.pool();

    // Update meeting diarization status to "in_progress"
    sqlx::query("UPDATE meetings SET diarization_status = ? WHERE id = ?")
        .bind("in_progress")
        .bind(&meeting_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to update diarization status: {}", e))?;

    // Attempt diarization
    match diarize_audio_and_store(&meeting_id, &audio_path, pool).await {
        Ok(speaker_count) => {
            // Update status to completed
            sqlx::query("UPDATE meetings SET diarization_status = ? WHERE id = ?")
                .bind("completed")
                .bind(&meeting_id)
                .execute(pool)
                .await
                .ok(); // Ignore error on status update

            Ok(DiarizationResult {
                meeting_id,
                success: true,
                speaker_count: Some(speaker_count),
                error: None,
            })
        }
        Err(e) => {
            // Update status to failed
            sqlx::query("UPDATE meetings SET diarization_status = ? WHERE id = ?")
                .bind("failed")
                .bind(&meeting_id)
                .execute(pool)
                .await
                .ok(); // Ignore error on status update

            Ok(DiarizationResult {
                meeting_id,
                success: false,
                speaker_count: None,
                error: Some(e),
            })
        }
    }
}

/// Perform diarization and store results
async fn diarize_audio_and_store(
    meeting_id: &str,
    audio_path: &str,
    pool: &sqlx::SqlitePool,
) -> Result<usize, String> {
    // Get speaker segments from sherpa-onnx
    let handler = sherpa_handler::SherpaDiarizationHandler::new(None)
        .map_err(|e| format!("Failed to create diarization handler: {}", e))?;

    // Check if models are available
    if !handler.models_available().await {
        return Err(format!(
            "Diarization models not found. Please download models to: {}",
            handler.get_models_dir().display()
        ));
    }

    let speaker_segments = handler
        .diarize_audio(audio_path)
        .await
        .map_err(|e| format!("Diarization failed: {}", e))?;

    if speaker_segments.is_empty() {
        return Err("No speaker segments detected".to_string());
    }

    // Get transcript for this meeting
    let transcripts = fetch_meeting_transcripts(pool, meeting_id)
        .await
        .map_err(|e| format!("Failed to fetch transcripts: {}", e))?;

    if transcripts.is_empty() {
        return Err("No transcripts found for meeting".to_string());
    }

    // Map speaker segments to transcript words
    let speaker_turns =
        speaker_mapping::map_speakers_to_transcripts(&speaker_segments, &transcripts);

    // Store speaker turns in database
    store_speaker_turns(pool, meeting_id, &speaker_turns)
        .await
        .map_err(|e| format!("Failed to store speaker turns: {}", e))?;

    // Return unique speaker count
    let unique_speakers: std::collections::HashSet<_> =
        speaker_turns.iter().map(|t| t.speaker_number).collect();
    Ok(unique_speakers.len())
}

/// Fetch all transcripts for a meeting
async fn fetch_meeting_transcripts(
    pool: &sqlx::SqlitePool,
    meeting_id: &str,
) -> Result<Vec<TranscriptSegment>, String> {
    let rows = sqlx::query_as::<_, (String, String, f64, f64)>(
        "SELECT id, transcript, audio_start_time, audio_end_time
         FROM transcripts
         WHERE meeting_id = ?
         ORDER BY audio_start_time ASC",
    )
    .bind(meeting_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Database query failed: {}", e))?;

    Ok(rows
        .into_iter()
        .map(|(id, text, start_ms, end_ms)| TranscriptSegment {
            id,
            text,
            start_ms: start_ms as i64,
            end_ms: end_ms as i64,
        })
        .collect())
}

/// Store speaker turns in database
async fn store_speaker_turns(
    pool: &sqlx::SqlitePool,
    meeting_id: &str,
    speaker_turns: &[SpeakerTurn],
) -> Result<(), String> {
    let existing_meeting_speakers =
        SpeakerIdentitiesRepository::list_meeting_speakers(pool, meeting_id)
            .await
            .map_err(|e| format!("Failed to fetch meeting speakers: {}", e))?;

    let mut existing_by_number: HashMap<i64, crate::database::models::MeetingSpeakerModel> =
        existing_meeting_speakers
            .into_iter()
            .filter(|speaker| speaker.is_active)
            .filter_map(|speaker| {
                speaker
                    .diarization_speaker_number
                    .map(|number| (number, speaker))
            })
            .collect();

    let unique_speaker_numbers: HashSet<i64> = speaker_turns
        .iter()
        .map(|turn| turn.speaker_number as i64)
        .collect();

    let mut meeting_speaker_ids = HashMap::new();
    let mut active_ids = Vec::new();

    for speaker_number in unique_speaker_numbers {
        let meeting_speaker = if let Some(existing) = existing_by_number.remove(&speaker_number) {
            let _ =
                SpeakerIdentitiesRepository::reactivate_meeting_speaker(pool, &existing.id).await;
            existing
        } else {
            SpeakerIdentitiesRepository::create_meeting_speaker(
                pool,
                NewMeetingSpeaker {
                    meeting_id: meeting_id.to_string(),
                    diarization_speaker_number: Some(speaker_number),
                    display_name_override: None,
                    speaker_identity_id: None,
                    review_status: "unreviewed".to_string(),
                    match_confidence: None,
                    is_active: true,
                },
            )
            .await
            .map_err(|e| format!("Failed to create meeting speaker: {}", e))?
        };

        active_ids.push(meeting_speaker.id.clone());
        meeting_speaker_ids.insert(speaker_number as u32, meeting_speaker);
    }

    SpeakerIdentitiesRepository::retire_unmatched_meeting_speakers(pool, meeting_id, &active_ids)
        .await
        .map_err(|e| format!("Failed to retire stale meeting speakers: {}", e))?;

    // Clear any existing speaker turns for this meeting
    sqlx::query("DELETE FROM speaker_turns WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to clear existing speaker turns: {}", e))?;

    // Insert new speaker turns
    for turn in speaker_turns {
        let turn_id = uuid::Uuid::new_v4().to_string();
        let meeting_speaker = meeting_speaker_ids
            .get(&turn.speaker_number)
            .ok_or_else(|| {
                format!(
                    "No meeting speaker mapping found for speaker number {}",
                    turn.speaker_number
                )
            })?;
        let denormalized_name = meeting_speaker.display_name_override.clone();

        sqlx::query(
            "INSERT INTO speaker_turns (
                id, meeting_id, meeting_speaker_id, speaker_number, speaker_name,
                start_ms, end_ms, text, confidence, created_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(turn_id)
        .bind(meeting_id)
        .bind(&meeting_speaker.id)
        .bind(turn.speaker_number as i32)
        .bind(denormalized_name)
        .bind(turn.start_ms)
        .bind(turn.end_ms)
        .bind(&turn.text)
        .bind(turn.confidence)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to insert speaker turn: {}", e))?;
    }

    Ok(())
}

// === DATA STRUCTURES ===

#[derive(Debug, Clone)]
pub struct TranscriptSegment {
    pub id: String,
    pub text: String,
    pub start_ms: i64,
    pub end_ms: i64,
}

#[derive(Debug, Clone)]
pub struct SpeakerTurn {
    pub speaker_number: u32,
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SpeakerSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub speaker_id: u32,
}

// === MODEL MANAGEMENT COMMANDS ===

/// Get available diarization models
#[tauri::command]
pub async fn get_diarization_models<R: Runtime>(
    _app: AppHandle<R>,
) -> Result<Vec<model_manager::DiarizationModelInfo>, String> {
    let models_dir = if cfg!(debug_assertions) {
        std::env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {}", e))?
            .join("models")
            .join("diarization")
    } else {
        crate::brand::data_root()
            .map_err(|e| format!("Failed to get data root: {}", e))?
            .join("models")
            .join("diarization")
    };

    let manager = model_manager::DiarizationModelManager::new(models_dir);
    manager
        .get_models()
        .await
        .map_err(|e| format!("Failed to get models: {}", e))
}

/// Download diarization models
#[tauri::command]
pub async fn download_diarization_models<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let models_dir = if cfg!(debug_assertions) {
        std::env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {}", e))?
            .join("models")
            .join("diarization")
    } else {
        crate::brand::data_root()
            .map_err(|e| format!("Failed to get data root: {}", e))?
            .join("models")
            .join("diarization")
    };

    let manager = model_manager::DiarizationModelManager::new(models_dir);

    // Download with progress events
    let app_clone = app.clone();
    let progress_callback: Arc<dyn Fn(String, model_manager::DownloadProgress) + Send + Sync> =
        Arc::new(
            move |model_type: String, progress: model_manager::DownloadProgress| {
                let _ = app_clone.emit(
                    "diarization-model-download-progress",
                    (model_type, progress),
                );
            },
        );

    manager
        .download_all_models(Some(progress_callback))
        .await
        .map_err(|e| format!("Failed to download models: {}", e))?;

    Ok("Models downloaded successfully".to_string())
}

/// Delete a diarization model
#[tauri::command]
pub async fn delete_diarization_model<R: Runtime>(
    _app: AppHandle<R>,
    model_type: String,
) -> Result<String, String> {
    let models_dir = if cfg!(debug_assertions) {
        std::env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {}", e))?
            .join("models")
            .join("diarization")
    } else {
        crate::brand::data_root()
            .map_err(|e| format!("Failed to get data root: {}", e))?
            .join("models")
            .join("diarization")
    };

    let manager = model_manager::DiarizationModelManager::new(models_dir);
    manager
        .delete_model(&model_type)
        .await
        .map_err(|e| format!("Failed to delete model: {}", e))?;

    Ok(format!("Model {} deleted successfully", model_type))
}
