use anyhow::Result;
use log::{error, info};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Streaming summary chunk sent to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummaryChunk {
    pub meeting_id: String,
    pub chunk_index: usize,
    pub total_chunks: usize,
    pub content: String,
    pub is_final: bool,
}

/// Streaming summary progress update
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummaryProgress {
    pub meeting_id: String,
    pub stage: String,
    pub progress: f32, // 0.0 to 1.0
    pub message: String,
}

/// Streaming summary error
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummaryError {
    pub meeting_id: String,
    pub error: String,
}

/// Stream summary chunks to the frontend
///
/// This function processes a transcript in chunks and emits each chunk
/// as it's generated, providing real-time feedback to the user.
pub async fn stream_summary_generation<R: Runtime>(
    app: &AppHandle<R>,
    meeting_id: &str,
    transcript: &str,
    template_id: &str,
) -> Result<String> {
    info!(
        "Starting streaming summary generation for meeting: {}",
        meeting_id
    );

    // Emit progress: Starting
    emit_progress(
        app,
        meeting_id,
        "initializing",
        0.0,
        "Initializing summary generation...",
    )?;

    // Get token counter for accurate chunking
    let counter = crate::summary::TokenCounter::new()?;

    // Determine chunk size based on transcript length
    let token_count = counter.count_tokens(transcript);
    let chunk_size = if token_count > 10000 {
        4000 // Large transcripts: smaller chunks
    } else if token_count > 5000 {
        6000 // Medium transcripts
    } else {
        token_count // Small transcripts: process in one go
    };

    info!(
        "Transcript has {} tokens, using chunk size of {}",
        token_count, chunk_size
    );

    // Emit progress: Chunking
    emit_progress(
        app,
        meeting_id,
        "chunking",
        0.1,
        &format!(
            "Splitting transcript into chunks ({} tokens)...",
            token_count
        ),
    )?;

    // Chunk the transcript with overlap for context
    let chunks = counter.chunk_text(transcript, chunk_size, 100);
    let total_chunks = chunks.len();

    info!("Split transcript into {} chunks", total_chunks);

    // Emit progress: Processing chunks
    emit_progress(
        app,
        meeting_id,
        "processing",
        0.2,
        &format!("Processing {} chunks...", total_chunks),
    )?;

    // Process each chunk and stream results
    let mut full_summary = String::new();

    for (index, chunk) in chunks.iter().enumerate() {
        let chunk_num = index + 1;
        let progress = 0.2 + (0.7 * (chunk_num as f32 / total_chunks as f32));

        emit_progress(
            app,
            meeting_id,
            "processing",
            progress,
            &format!("Processing chunk {}/{}...", chunk_num, total_chunks),
        )?;

        // Generate summary for this chunk
        match generate_chunk_summary(app, chunk, template_id).await {
            Ok(chunk_summary) => {
                // Emit the chunk to frontend
                emit_chunk(app, meeting_id, index, total_chunks, &chunk_summary, false)?;

                full_summary.push_str(&chunk_summary);
                full_summary.push_str("\n\n");
            }
            Err(e) => {
                error!("Failed to generate summary for chunk {}: {}", chunk_num, e);
                emit_error(
                    app,
                    meeting_id,
                    &format!("Failed to process chunk {}: {}", chunk_num, e),
                )?;
                return Err(e);
            }
        }
    }

    // Emit progress: Finalizing
    emit_progress(app, meeting_id, "finalizing", 0.95, "Finalizing summary...")?;

    // Clean up the combined summary
    let final_summary = crate::summary::processor::clean_llm_markdown_output(&full_summary);

    // Emit final chunk
    emit_chunk(
        app,
        meeting_id,
        total_chunks,
        total_chunks,
        &final_summary,
        true,
    )?;

    // Emit progress: Complete
    emit_progress(
        app,
        meeting_id,
        "complete",
        1.0,
        "Summary generation complete!",
    )?;

    info!(
        "Completed streaming summary generation for meeting: {}",
        meeting_id
    );
    Ok(final_summary)
}

/// Generate summary for a single chunk
async fn generate_chunk_summary<R: Runtime>(
    app: &AppHandle<R>,
    chunk: &str,
    template_id: &str,
) -> Result<String> {
    use crate::state::AppState;
    use crate::summary::service::SummaryService;

    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    // Use the existing summary service to generate for this chunk
    let summary = SummaryService::generate_summary_for_text(app, pool, chunk, template_id)
        .await
        .map_err(|e| anyhow::anyhow!(e))?;

    Ok(summary)
}

/// Emit a summary chunk to the frontend
fn emit_chunk<R: Runtime>(
    app: &AppHandle<R>,
    meeting_id: &str,
    chunk_index: usize,
    total_chunks: usize,
    content: &str,
    is_final: bool,
) -> Result<()> {
    let chunk = SummaryChunk {
        meeting_id: meeting_id.to_string(),
        chunk_index,
        total_chunks,
        content: content.to_string(),
        is_final,
    };

    app.emit("summary-chunk", chunk)
        .map_err(|e| anyhow::anyhow!("Failed to emit summary chunk: {}", e))?;

    Ok(())
}

/// Emit progress update to the frontend
fn emit_progress<R: Runtime>(
    app: &AppHandle<R>,
    meeting_id: &str,
    stage: &str,
    progress: f32,
    message: &str,
) -> Result<()> {
    let update = SummaryProgress {
        meeting_id: meeting_id.to_string(),
        stage: stage.to_string(),
        progress,
        message: message.to_string(),
    };

    app.emit("summary-progress", update)
        .map_err(|e| anyhow::anyhow!("Failed to emit progress: {}", e))?;

    Ok(())
}

/// Emit error to the frontend
fn emit_error<R: Runtime>(app: &AppHandle<R>, meeting_id: &str, error: &str) -> Result<()> {
    let err = SummaryError {
        meeting_id: meeting_id.to_string(),
        error: error.to_string(),
    };

    app.emit("summary-error", err)
        .map_err(|e| anyhow::anyhow!("Failed to emit error: {}", e))?;

    Ok(())
}

/// Tauri command for streaming summary generation
#[tauri::command]
pub async fn generate_summary_streaming<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
    template_id: String,
) -> Result<String, String> {
    use crate::database::repositories::transcript::TranscriptsRepository;
    use crate::state::AppState;

    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    // Get transcript from database
    let transcripts = TranscriptsRepository::get_transcripts_by_meeting_id(pool, &meeting_id)
        .await
        .map_err(|e| format!("Failed to get transcripts: {}", e))?;

    if transcripts.is_empty() {
        return Err("No transcripts found for meeting".to_string());
    }

    // Combine all transcript segments
    let full_transcript: String = transcripts
        .iter()
        .map(|t| t.transcript.as_str())
        .collect::<Vec<_>>()
        .join(" ");

    // Stream the summary generation
    stream_summary_generation(&app, &meeting_id, &full_transcript, &template_id)
        .await
        .map_err(|e| format!("Failed to generate streaming summary: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_summary_chunk_serialization() {
        let chunk = SummaryChunk {
            meeting_id: "test-123".to_string(),
            chunk_index: 0,
            total_chunks: 3,
            content: "Test content".to_string(),
            is_final: false,
        };

        let json = serde_json::to_string(&chunk).unwrap();
        assert!(json.contains("test-123"));
        assert!(json.contains("Test content"));
    }

    #[test]
    fn test_progress_serialization() {
        let progress = SummaryProgress {
            meeting_id: "test-123".to_string(),
            stage: "processing".to_string(),
            progress: 0.5,
            message: "Processing...".to_string(),
        };

        let json = serde_json::to_string(&progress).unwrap();
        assert!(json.contains("0.5"));
        assert!(json.contains("processing"));
    }
}
