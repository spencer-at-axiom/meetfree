use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};

/// Progress update for long-running operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressUpdate {
    pub operation_id: String,
    pub operation_type: String,
    pub stage: String,
    pub progress: f32, // 0.0 to 1.0
    pub message: String,
    pub current: Option<usize>,
    pub total: Option<usize>,
    pub timestamp: i64,
}

/// Progress stages for transcription finalization
pub mod transcription_stages {
    pub const STARTING: &str = "starting";
    pub const FLUSHING: &str = "flushing";
    pub const PROCESSING: &str = "processing";
    pub const SAVING: &str = "saving";
    pub const COMPLETE: &str = "complete";
    pub const ERROR: &str = "error";
}

/// Emit progress update to frontend
pub fn emit_progress<R: Runtime>(
    app: &AppHandle<R>,
    operation_id: &str,
    operation_type: &str,
    stage: &str,
    progress: f32,
    message: &str,
    current: Option<usize>,
    total: Option<usize>,
) -> Result<(), String> {
    let update = ProgressUpdate {
        operation_id: operation_id.to_string(),
        operation_type: operation_type.to_string(),
        stage: stage.to_string(),
        progress,
        message: message.to_string(),
        current,
        total,
        timestamp: chrono::Utc::now().timestamp_millis(),
    };

    app.emit("operation-progress", update)
        .map_err(|e| format!("Failed to emit progress: {}", e))
}

/// Emit transcription flush progress
pub fn emit_transcription_flush_progress<R: Runtime>(
    app: &AppHandle<R>,
    meeting_id: &str,
    processed: usize,
    total: usize,
    elapsed_seconds: u64,
    timeout_seconds: u64,
) -> Result<(), String> {
    let progress = if total > 0 {
        processed as f32 / total as f32
    } else {
        0.0
    };

    let remaining_seconds = timeout_seconds.saturating_sub(elapsed_seconds);
    let message = format!(
        "Processing transcripts: {}/{} ({:.0}% complete, {}s remaining)",
        processed,
        total,
        progress * 100.0,
        remaining_seconds
    );

    emit_progress(
        app,
        meeting_id,
        "transcription_flush",
        transcription_stages::FLUSHING,
        progress,
        &message,
        Some(processed),
        Some(total),
    )
}

/// Emit database save progress
pub fn emit_database_save_progress<R: Runtime>(
    app: &AppHandle<R>,
    meeting_id: &str,
    stage: &str,
    message: &str,
) -> Result<(), String> {
    let progress = match stage {
        "starting" => 0.0,
        "saving_meeting" => 0.3,
        "saving_transcripts" => 0.6,
        "finalizing" => 0.9,
        "complete" => 1.0,
        _ => 0.5,
    };

    emit_progress(
        app,
        meeting_id,
        "database_save",
        stage,
        progress,
        message,
        None,
        None,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_progress_update_serialization() {
        let update = ProgressUpdate {
            operation_id: "test-123".to_string(),
            operation_type: "transcription".to_string(),
            stage: "processing".to_string(),
            progress: 0.5,
            message: "Processing...".to_string(),
            current: Some(50),
            total: Some(100),
            timestamp: 1234567890,
        };

        let json = serde_json::to_string(&update).unwrap();
        assert!(json.contains("test-123"));
        assert!(json.contains("0.5"));
        assert!(json.contains("50"));
    }
}
