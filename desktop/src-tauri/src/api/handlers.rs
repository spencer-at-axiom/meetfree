use log::{error as log_error, info as log_info, warn as log_warn};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::{
    database::repositories::setting::SettingsRepository,
    state::AppState,
};

#[derive(Debug, Serialize, Deserialize)]
pub struct Meeting {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptSearchResult {
    pub id: String,
    pub title: String,
    #[serde(rename = "matchContext")]
    pub match_context: String,
    pub timestamp: String,
    pub score: f64,
    #[serde(rename = "sourceType")]
    pub source_type: String,
    #[serde(rename = "hasSummary")]
    pub has_summary: bool,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct TranscriptSearchRequest {
    pub query: Option<String>,
    #[serde(rename = "dateFrom")]
    pub date_from: Option<String>,
    #[serde(rename = "dateTo")]
    pub date_to: Option<String>,
    #[serde(rename = "sourceType")]
    pub source_type: Option<String>,
    #[serde(rename = "hasSummary")]
    pub has_summary: Option<bool>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptSearchResponse {
    pub results: Vec<TranscriptSearchResult>,
    #[serde(rename = "totalCount")]
    pub total_count: i64,
    pub limit: i64,
    pub offset: i64,
    #[serde(rename = "hasMore")]
    pub has_more: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelConfig {
    pub provider: String,
    pub model: String,
    #[serde(rename = "whisperModel")]
    pub whisper_model: String,
    #[serde(rename = "ollamaEndpoint")]
    pub ollama_endpoint: Option<String>,
    #[serde(rename = "hasStoredKey")]
    pub has_stored_key: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptConfig {
    pub provider: String,
    pub model: String,
    #[serde(rename = "hasStoredKey")]
    pub has_stored_key: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingDetails {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_path: Option<String>,
    pub source_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recording_started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recording_ended_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub markdown_export_path: Option<String>,
    pub transcripts: Vec<MeetingTranscript>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingTranscript {
    pub id: String,
    pub text: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_start_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_end_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
}

/// Meeting metadata without transcripts (for pagination)
#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingMetadata {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_path: Option<String>,
    pub source_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recording_started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recording_ended_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub markdown_export_path: Option<String>,
}

/// Paginated transcripts response with total count
#[derive(Debug, Serialize, Deserialize)]
pub struct PaginatedTranscriptsResponse {
    pub transcripts: Vec<MeetingTranscript>,
    pub total_count: i64,
    pub has_more: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptSegment {
    pub id: String,
    pub text: String,
    #[serde(default)]
    #[serde(rename = "rawText")]
    pub raw_text: Option<String>,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_start_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_end_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
}

/// Used internally by the transcription engine to read transcript settings.
#[tauri::command]
pub async fn api_get_transcript_config<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    _auth_token: Option<String>,
) -> Result<Option<TranscriptConfig>, String> {
    log_info!("api_get_transcript_config called (native)");
    let pool = state.db_manager.pool();

    match SettingsRepository::get_transcript_config(pool).await {
        Ok(Some(config)) => {
            let (normalized_provider, normalized_model, was_legacy_or_invalid) =
                SettingsRepository::normalize_transcript_config(&config.provider, &config.model);

            if was_legacy_or_invalid
                || normalized_provider != config.provider
                || normalized_model != config.model
            {
                log_warn!(
                    "Normalizing legacy transcript config provider/model from ('{}', '{}') to ('{}', '{}')",
                    config.provider,
                    config.model,
                    normalized_provider,
                    normalized_model
                );

                if let Err(error) = SettingsRepository::save_transcript_config(
                    pool,
                    &normalized_provider,
                    &normalized_model,
                )
                .await
                {
                    log_warn!(
                        "Failed to persist normalized transcript config (non-fatal): {}",
                        error
                    );
                }
            }

            log_info!(
                "Found transcript config: provider={}, model={}",
                &normalized_provider,
                &normalized_model
            );
            match SettingsRepository::get_transcript_api_key(pool, &normalized_provider).await {
                Ok(api_key) => {
                    log_info!("Successfully retrieved transcript config metadata.");
                    Ok(Some(TranscriptConfig {
                        provider: normalized_provider,
                        model: normalized_model,
                        has_stored_key: api_key.is_some(),
                    }))
                }
                Err(e) => {
                    log_error!(
                        "Failed to get transcript API key for provider {}: {}",
                        &normalized_provider,
                        e
                    );
                    Err(e.to_string())
                }
            }
        }
        Ok(None) => {
            log_info!("No transcript config found, returning default.");
            Ok(Some(TranscriptConfig {
                provider: "parakeet".to_string(),
                model: crate::config::DEFAULT_PARAKEET_MODEL.to_string(),
                has_stored_key: false,
            }))
        }
        Err(e) => {
            log_error!("Failed to get transcript config: {}", e);
            Err(e.to_string())
        }
    }
}
