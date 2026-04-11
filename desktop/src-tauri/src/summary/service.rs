use crate::database::repositories::{
    meeting::MeetingsRepository, setting::SettingsRepository, summary::SummaryProcessesRepository,
};
use crate::ollama::metadata::ModelMetadataCache;
use crate::summary::contract::markdown_payload_value;
use crate::summary::llm_client::{LLMProvider, LLMTransportConfig};
use crate::summary::processor::{
    extract_meeting_name_from_markdown, generate_meeting_summary, ResolvedProviderConfig,
    SummaryGenerationOptions, SummaryJob,
};
use crate::summary::structured_artifacts::sync_structured_artifacts_from_markdown;
use once_cell::sync::Lazy;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};

// Global cache for model metadata (5 minute TTL)
static METADATA_CACHE: Lazy<ModelMetadataCache> =
    Lazy::new(|| ModelMetadataCache::new(Duration::from_secs(300)));

#[derive(Clone, Default)]
pub struct SummaryRuntimeState {
    cancellation_registry: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl SummaryRuntimeState {
    pub fn new() -> Self {
        Self::default()
    }

    async fn register_token(&self, meeting_id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        self.cancellation_registry
            .lock()
            .await
            .insert(meeting_id.to_string(), token.clone());
        info!("Registered cancellation token for meeting: {}", meeting_id);
        token
    }

    pub async fn cancel(&self, meeting_id: &str) -> bool {
        if let Some(token) = self
            .cancellation_registry
            .lock()
            .await
            .get(meeting_id)
            .cloned()
        {
            info!("Cancelling summary generation for meeting: {}", meeting_id);
            token.cancel();
            true
        } else {
            warn!(
                "No active summary generation found for meeting: {}",
                meeting_id
            );
            false
        }
    }

    async fn cleanup_token(&self, meeting_id: &str) {
        if self
            .cancellation_registry
            .lock()
            .await
            .remove(meeting_id)
            .is_some()
        {
            info!("Cleaned up cancellation token for meeting: {}", meeting_id);
        }
    }
}

/// Summary service - handles all summary generation logic
pub struct SummaryService;

pub struct SummaryJobRequest {
    pub meeting_id: String,
    pub text: String,
    pub model_provider: String,
    pub model_name: String,
    pub custom_prompt: String,
    pub template_id: String,
}

impl SummaryService {
    pub async fn cancel_summary(runtime: &SummaryRuntimeState, meeting_id: &str) -> bool {
        runtime.cancel(meeting_id).await
    }

    pub async fn generate_summary_for_text<R: Runtime>(
        app: &AppHandle<R>,
        pool: &SqlitePool,
        text: &str,
        template_id: &str,
    ) -> Result<String, String> {
        let config = SettingsRepository::get_model_config(pool)
            .await
            .map_err(|e| format!("Failed to load summary model config: {}", e))?
            .ok_or_else(|| "No summary model configuration found".to_string())?;

        let summary_job = Self::resolve_summary_job(
            app,
            pool,
            SummaryJobRequest {
                meeting_id: "streaming-preview".to_string(),
                text: text.to_string(),
                model_provider: config.provider,
                model_name: config.model,
                custom_prompt: String::new(),
                template_id: template_id.to_string(),
            },
        )
        .await?;

        let client = reqwest::Client::new();
        let (summary, _) = generate_meeting_summary(&client, &summary_job, None).await?;
        Ok(summary)
    }

    pub async fn resolve_summary_job<R: Runtime>(
        app: &AppHandle<R>,
        pool: &SqlitePool,
        request: SummaryJobRequest,
    ) -> Result<SummaryJob, String> {
        let SummaryJobRequest {
            meeting_id,
            text,
            model_provider,
            model_name,
            custom_prompt,
            template_id,
        } = request;

        let provider: LLMProvider = model_provider.parse()?;

        let api_key = if provider == LLMProvider::Ollama || provider == LLMProvider::CustomOpenAI {
            String::new()
        } else {
            match SettingsRepository::get_api_key(pool, &model_provider).await {
                Ok(Some(key)) if !key.is_empty() => key,
                Ok(None) | Ok(Some(_)) => {
                    return Err(format!("API key not found for {}", &model_provider));
                }
                Err(error) => {
                    return Err(format!(
                        "Failed to retrieve API key for {}: {}",
                        &model_provider, error
                    ));
                }
            }
        };

        let ollama_endpoint = if provider == LLMProvider::Ollama {
            match SettingsRepository::get_model_config(pool).await {
                Ok(Some(config)) => config.ollama_endpoint,
                Ok(None) => None,
                Err(error) => {
                    info!(
                        "Failed to retrieve Ollama endpoint: {}, using default",
                        error
                    );
                    None
                }
            }
        } else {
            None
        };

        let (
            custom_openai_endpoint,
            custom_openai_api_key,
            custom_openai_max_tokens,
            custom_openai_temperature,
            custom_openai_top_p,
        ) = if provider == LLMProvider::CustomOpenAI {
            match SettingsRepository::get_custom_openai_config(pool).await {
                Ok(Some(config)) => {
                    info!("Using custom OpenAI endpoint: {}", config.endpoint);
                    (
                        Some(config.endpoint),
                        config.api_key,
                        config.max_tokens.map(|tokens| tokens as u32),
                        config.temperature,
                        config.top_p,
                    )
                }
                Ok(None) => {
                    return Err(
                        "Custom OpenAI provider selected but no configuration found".to_string()
                    );
                }
                Err(error) => {
                    return Err(format!(
                        "Failed to retrieve custom OpenAI config: {}",
                        error
                    ));
                }
            }
        } else {
            (None, None, None, None, None)
        };

        let token_threshold = if provider == LLMProvider::Ollama {
            match METADATA_CACHE
                .get_or_fetch(&model_name, ollama_endpoint.as_deref())
                .await
            {
                Ok(metadata) => {
                    let optimal = metadata.context_size.saturating_sub(300);
                    info!(
                        "Using dynamic context for {}: {} tokens (chunk size: {})",
                        model_name, metadata.context_size, optimal
                    );
                    optimal
                }
                Err(error) => {
                    warn!(
                        "Failed to fetch context for {}: {}. Using default 4000",
                        model_name, error
                    );
                    4000
                }
            }
        } else {
            100000
        };

        let resolved = ResolvedProviderConfig {
            provider: provider.clone(),
            model_name,
            api_key: if provider == LLMProvider::CustomOpenAI {
                custom_openai_api_key.unwrap_or_default()
            } else {
                api_key
            },
            transport: LLMTransportConfig {
                ollama_endpoint,
                custom_openai_endpoint,
                max_tokens: custom_openai_max_tokens,
                temperature: custom_openai_temperature,
                top_p: custom_openai_top_p,
                app_data_dir: app.path().app_data_dir().ok(),
            },
        };

        Ok(SummaryJob {
            meeting_id,
            text,
            provider: resolved,
            options: SummaryGenerationOptions {
                custom_prompt,
                template_id,
                token_threshold,
            },
        })
    }

    /// Processes transcript in the background and generates summary.
    pub async fn process_transcript_background<R: Runtime>(
        _app: AppHandle<R>,
        pool: SqlitePool,
        runtime: SummaryRuntimeState,
        job: SummaryJob,
    ) {
        let start_time = Instant::now();
        let meeting_id = job.meeting_id.clone();

        info!(
            "Starting background processing for meeting_id: {} with provider {:?}",
            meeting_id, job.provider.provider
        );

        let cancellation_token = runtime.register_token(&meeting_id).await;

        let client = reqwest::Client::new();
        let result = generate_meeting_summary(&client, &job, Some(&cancellation_token)).await;
        let duration = start_time.elapsed().as_secs_f64();

        runtime.cleanup_token(&meeting_id).await;

        match result {
            Ok((mut final_markdown, num_chunks)) => {
                if num_chunks == 0 && final_markdown.is_empty() {
                    Self::update_process_failed(
                        &pool,
                        &meeting_id,
                        "Summary generation failed: No content was processed.",
                    )
                    .await;
                    return;
                }

                info!(
                    "Successfully processed {} chunks for meeting_id: {}. Duration: {:.2}s",
                    num_chunks, meeting_id, duration
                );

                if let Some(name) = extract_meeting_name_from_markdown(&final_markdown) {
                    if !name.is_empty() {
                        info!(
                            "Updating meeting name to '{}' for meeting_id: {}",
                            name, meeting_id
                        );
                        if let Err(error) =
                            MeetingsRepository::update_meeting_title(&pool, &meeting_id, &name)
                                .await
                        {
                            error!(
                                "Failed to update meeting name for {}: {}",
                                meeting_id, error
                            );
                        }

                        if let Some(hash_pos) = final_markdown.find('#') {
                            let body_start =
                                if let Some(line_end) = final_markdown[hash_pos..].find('\n') {
                                    hash_pos + line_end
                                } else {
                                    final_markdown.len()
                                };
                            final_markdown = final_markdown[body_start..].trim_start().to_string();
                        } else {
                            final_markdown.clear();
                        }
                    }
                }

                let result_json = markdown_payload_value(&final_markdown);
                if let Err(error) = SummaryProcessesRepository::update_process_completed(
                    &pool,
                    &meeting_id,
                    result_json,
                    num_chunks,
                    duration,
                )
                .await
                {
                    error!(
                        "Failed to save completed process for {}: {}",
                        meeting_id, error
                    );
                } else {
                    if let Err(error) =
                        sync_structured_artifacts_from_markdown(&pool, &meeting_id, &final_markdown)
                            .await
                    {
                        warn!(
                            "Failed to sync structured artifacts for meeting {}: {}",
                            meeting_id, error
                        );
                    }
                    info!("Summary saved successfully for meeting_id: {}", meeting_id);
                }
            }
            Err(error_message) => {
                if error_message.contains("cancelled") {
                    info!(
                        "Summary generation was cancelled for meeting_id: {}",
                        meeting_id
                    );
                    if let Err(error) =
                        SummaryProcessesRepository::update_process_cancelled(&pool, &meeting_id)
                            .await
                    {
                        error!(
                            "Failed to update DB status to cancelled for {}: {}",
                            meeting_id, error
                        );
                    }
                } else {
                    Self::update_process_failed(&pool, &meeting_id, &error_message).await;
                }
            }
        }
    }

    async fn update_process_failed(pool: &SqlitePool, meeting_id: &str, error_msg: &str) {
        error!(
            "Processing failed for meeting_id {}: {}",
            meeting_id, error_msg
        );
        if let Err(error) =
            SummaryProcessesRepository::update_process_failed(pool, meeting_id, error_msg).await
        {
            error!(
                "Failed to update DB status to failed for {}: {}",
                meeting_id, error
            );
        }
    }
}
