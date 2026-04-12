use async_trait::async_trait;
use log::warn;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::context::{assemble_meeting_context, format_context_for_prompt};
use crate::database::repositories::embedding::{
    EmbeddingsRepository, SimilarityResult as RepositorySimilarityResult,
};
use crate::database::repositories::setting::SettingsRepository;
use crate::database::repositories::transcript::TranscriptsRepository;
use crate::state::AppState;
use crate::summary::llm_client::LLMProvider;
use crate::summary::provider_capabilities::capabilities_for_provider;

const DEFAULT_OLLAMA_ENDPOINT: &str = "http://localhost:11434";
const DEFAULT_OLLAMA_EMBEDDING_MODEL: &str = "nomic-embed-text";
const DEFAULT_OPENAI_EMBEDDING_MODEL: &str = "text-embedding-3-small";
const DEFAULT_OPENAI_EMBEDDING_DIMENSIONS: usize = 1536;

#[async_trait]
pub trait EmbeddingProvider: Send + Sync {
    async fn embed_text(&self, text: &str) -> Result<Vec<f32>, String>;
    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String>;
    fn dimensions(&self) -> usize;
    fn model_name(&self) -> &str;
}

pub struct OllamaEmbeddingProvider {
    client: Client,
    endpoint: String,
    model: String,
    dims: AtomicUsize,
}

impl OllamaEmbeddingProvider {
    pub fn new(endpoint: &str, model: &str) -> Self {
        Self {
            client: Client::new(),
            endpoint: endpoint.to_string(),
            model: model.to_string(),
            dims: AtomicUsize::new(384),
        }
    }

    fn embed_url(&self) -> String {
        format!("{}/api/embed", self.endpoint.trim_end_matches('/'))
    }

    fn update_dims_from_embedding(&self, emb: &[f32]) {
        if !emb.is_empty() {
            self.dims.store(emb.len(), Ordering::Relaxed);
        }
    }
}

#[derive(Deserialize)]
struct OllamaEmbedResponse {
    embeddings: Vec<Vec<f32>>,
}

#[async_trait]
impl EmbeddingProvider for OllamaEmbeddingProvider {
    async fn embed_text(&self, text: &str) -> Result<Vec<f32>, String> {
        let body = serde_json::json!({
            "model": self.model,
            "input": text,
        });
        let res = self
            .client
            .post(self.embed_url())
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("Ollama embed HTTP {}", res.status()));
        }
        let parsed: OllamaEmbedResponse = res.json().await.map_err(|e| e.to_string())?;
        let emb = parsed
            .embeddings
            .into_iter()
            .next()
            .ok_or_else(|| "missing embedding".to_string())?;
        self.update_dims_from_embedding(&emb);
        Ok(emb)
    }

    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        let body = serde_json::json!({
            "model": self.model,
            "input": texts,
        });
        let res = self
            .client
            .post(self.embed_url())
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("Ollama embed HTTP {}", res.status()));
        }
        let parsed: OllamaEmbedResponse = res.json().await.map_err(|e| e.to_string())?;
        if let Some(first) = parsed.embeddings.first() {
            self.update_dims_from_embedding(first);
        }
        Ok(parsed.embeddings)
    }

    fn dimensions(&self) -> usize {
        self.dims.load(Ordering::Relaxed)
    }

    fn model_name(&self) -> &str {
        self.model.as_str()
    }
}

pub struct OpenAICompatibleEmbeddingProvider {
    client: Client,
    endpoint: String,
    model: String,
    api_key: String,
    dims: usize,
}

impl OpenAICompatibleEmbeddingProvider {
    pub fn new(endpoint: &str, model: &str, api_key: &str, dims: usize) -> Self {
        Self {
            client: Client::new(),
            endpoint: endpoint.to_string(),
            model: model.to_string(),
            api_key: api_key.to_string(),
            dims,
        }
    }

    fn embeddings_url(&self) -> String {
        format!("{}/v1/embeddings", self.endpoint.trim_end_matches('/'))
    }
}

#[derive(Deserialize)]
struct OpenAIEmbedDatum {
    embedding: Vec<f32>,
}

#[derive(Deserialize)]
struct OpenAIEmbedResponse {
    data: Vec<OpenAIEmbedDatum>,
}

#[async_trait]
impl EmbeddingProvider for OpenAICompatibleEmbeddingProvider {
    async fn embed_text(&self, text: &str) -> Result<Vec<f32>, String> {
        let body = serde_json::json!({
            "model": self.model,
            "input": text,
        });
        let res = self
            .client
            .post(self.embeddings_url())
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("OpenAI-compatible embed HTTP {}", res.status()));
        }
        let parsed: OpenAIEmbedResponse = res.json().await.map_err(|e| e.to_string())?;
        parsed
            .data
            .into_iter()
            .next()
            .map(|d| d.embedding)
            .ok_or_else(|| "missing embedding".to_string())
    }

    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        let body = serde_json::json!({
            "model": self.model,
            "input": texts,
        });
        let res = self
            .client
            .post(self.embeddings_url())
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("OpenAI-compatible embed HTTP {}", res.status()));
        }
        let parsed: OpenAIEmbedResponse = res.json().await.map_err(|e| e.to_string())?;
        Ok(parsed.data.into_iter().map(|d| d.embedding).collect())
    }

    fn dimensions(&self) -> usize {
        self.dims
    }

    fn model_name(&self) -> &str {
        self.model.as_str()
    }
}

struct ResolvedEmbeddingProvider {
    model_name: String,
    provider: Box<dyn EmbeddingProvider>,
}

#[derive(Debug, Clone)]
struct EmbeddingSource {
    source_type: String,
    source_id: String,
    text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddingProgressEvent {
    meeting_id: String,
    stage: String,
    progress_percentage: u32,
    message: String,
    total_sources: usize,
    processed_sources: usize,
}

fn truncate_preview(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }

    let mut end = 0usize;
    for (count, (idx, ch)) in trimmed.char_indices().enumerate() {
        if count == max_chars {
            break;
        }
        end = idx + ch.len_utf8();
    }

    let mut preview = trimmed[..end].trim_end().to_string();
    preview.push_str("...");
    preview
}

async fn resolve_embedding_provider(
    pool: &sqlx::SqlitePool,
) -> Result<ResolvedEmbeddingProvider, String> {
    let config = SettingsRepository::get_model_config(pool)
        .await
        .map_err(|e| format!("Failed to load model config: {}", e))?
        .ok_or_else(|| "No summary model configuration found".to_string())?;

    let provider: LLMProvider = config.provider.parse()?;
    let capabilities = capabilities_for_provider(&provider, &config.model);
    if !capabilities.supports_embeddings {
        return Err(format!(
            "Configured summary provider '{}' does not support embeddings",
            config.provider
        ));
    }

    match provider {
        LLMProvider::Ollama => {
            let endpoint = config
                .ollama_endpoint
                .unwrap_or_else(|| DEFAULT_OLLAMA_ENDPOINT.to_string());
            let model_name = DEFAULT_OLLAMA_EMBEDDING_MODEL.to_string();
            Ok(ResolvedEmbeddingProvider {
                model_name: model_name.clone(),
                provider: Box::new(OllamaEmbeddingProvider::new(&endpoint, &model_name)),
            })
        }
        LLMProvider::OpenAI => {
            let api_key = SettingsRepository::get_api_key(pool, &config.provider)
                .await
                .map_err(|e| format!("Failed to load API key for embeddings: {}", e))?
                .filter(|key| !key.trim().is_empty())
                .ok_or_else(|| "OpenAI API key is required for embeddings".to_string())?;
            let model_name = DEFAULT_OPENAI_EMBEDDING_MODEL.to_string();
            Ok(ResolvedEmbeddingProvider {
                model_name: model_name.clone(),
                provider: Box::new(OpenAICompatibleEmbeddingProvider::new(
                    "https://api.openai.com",
                    &model_name,
                    &api_key,
                    DEFAULT_OPENAI_EMBEDDING_DIMENSIONS,
                )),
            })
        }
        other => Err(format!(
            "Embeddings are not configured for provider '{:?}' in v0.5.0",
            other
        )),
    }
}

async fn collect_embedding_sources(
    pool: &sqlx::SqlitePool,
    meeting_id: &str,
) -> Result<Vec<EmbeddingSource>, String> {
    let transcripts = TranscriptsRepository::get_transcripts_by_meeting_id(pool, meeting_id)
        .await
        .map_err(|e| format!("Failed to load transcripts for embeddings: {}", e))?;

    let mut sources = transcripts
        .into_iter()
        .filter_map(|segment| {
            let text = segment.transcript.trim().to_string();
            if text.is_empty() {
                None
            } else {
                Some(EmbeddingSource {
                    source_type: "transcript_segment".to_string(),
                    source_id: segment.id,
                    text,
                })
            }
        })
        .collect::<Vec<_>>();

    let context_package = assemble_meeting_context(pool, meeting_id).await?;
    let context_text = format_context_for_prompt(&context_package);
    if !context_text.trim().is_empty() {
        sources.push(EmbeddingSource {
            source_type: "meeting_context".to_string(),
            source_id: meeting_id.to_string(),
            text: context_text,
        });
    }

    Ok(sources)
}

async fn meeting_exists(pool: &sqlx::SqlitePool, meeting_id: &str) -> Result<bool, String> {
    let exists: i64 = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM meetings WHERE id = ?)")
        .bind(meeting_id)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to verify meeting for embeddings: {}", e))?;
    Ok(exists != 0)
}

fn emit_progress<R: Runtime>(
    app: &AppHandle<R>,
    meeting_id: &str,
    stage: &str,
    progress_percentage: u32,
    message: &str,
    total_sources: usize,
    processed_sources: usize,
) {
    let _ = app.emit(
        "embedding-progress",
        EmbeddingProgressEvent {
            meeting_id: meeting_id.to_string(),
            stage: stage.to_string(),
            progress_percentage,
            message: message.to_string(),
            total_sources,
            processed_sources,
        },
    );
}

async fn embed_sources(
    provider: &dyn EmbeddingProvider,
    sources: &[EmbeddingSource],
) -> Result<Vec<Vec<f32>>, String> {
    let batch_input = sources
        .iter()
        .map(|source| source.text.clone())
        .collect::<Vec<_>>();

    match provider.embed_batch(&batch_input).await {
        Ok(embeddings) if embeddings.len() == batch_input.len() => Ok(embeddings),
        Ok(embeddings) => Err(format!(
            "Embedding provider returned {} vectors for {} sources",
            embeddings.len(),
            batch_input.len()
        )),
        Err(error) => {
            warn!(
                "Embedding batch request failed, falling back to sequential requests: {}",
                error
            );
            let mut embeddings = Vec::with_capacity(batch_input.len());
            for text in batch_input {
                embeddings.push(provider.embed_text(&text).await?);
            }
            Ok(embeddings)
        }
    }
}

async fn index_meeting_embeddings_with_pool<R: Runtime>(
    app: &AppHandle<R>,
    pool: &sqlx::SqlitePool,
    meeting_id: &str,
) -> Result<commands::EmbeddingReindexResult, String> {
    emit_progress(
        app,
        meeting_id,
        "resolving_provider",
        5,
        "Resolving embedding provider...",
        0,
        0,
    );

    let resolved = resolve_embedding_provider(pool).await?;

    emit_progress(
        app,
        meeting_id,
        "collecting_sources",
        15,
        "Collecting meeting content for embeddings...",
        0,
        0,
    );
    let sources = collect_embedding_sources(pool, meeting_id).await?;
    let total_sources = sources.len();

    emit_progress(
        app,
        meeting_id,
        "clearing_old_embeddings",
        25,
        "Clearing previous embeddings...",
        total_sources,
        0,
    );
    EmbeddingsRepository::delete_embeddings_for_meeting(pool, meeting_id)
        .await
        .map_err(|e| format!("Failed to clear existing embeddings: {}", e))?;

    if total_sources == 0 {
        let result = commands::EmbeddingReindexResult {
            meeting_id: meeting_id.to_string(),
            indexed_sources: 0,
            model_name: resolved.model_name,
        };
        let _ = app.emit("embedding-complete", &result);
        return Ok(result);
    }

    emit_progress(
        app,
        meeting_id,
        "embedding",
        45,
        "Generating embeddings...",
        total_sources,
        0,
    );
    let embeddings = embed_sources(resolved.provider.as_ref(), &sources).await?;

    if !meeting_exists(pool, meeting_id).await? {
        return Err(format!(
            "Meeting '{}' was removed before embeddings could be stored",
            meeting_id
        ));
    }

    for (index, (source, embedding)) in sources.iter().zip(embeddings.iter()).enumerate() {
        EmbeddingsRepository::store_embedding(
            pool,
            &source.source_type,
            &source.source_id,
            meeting_id,
            embedding,
            &resolved.model_name,
        )
        .await
        .map_err(|e| format!("Failed to store embedding for {}: {}", source.source_id, e))?;

        let progress = 60 + (((index + 1) * 40) / total_sources) as u32;
        emit_progress(
            app,
            meeting_id,
            "storing",
            progress.min(100),
            "Saving embeddings...",
            total_sources,
            index + 1,
        );
    }

    let result = commands::EmbeddingReindexResult {
        meeting_id: meeting_id.to_string(),
        indexed_sources: total_sources,
        model_name: resolved.model_name,
    };
    let _ = app.emit("embedding-complete", &result);
    Ok(result)
}

pub fn spawn_meeting_embedding_reindex<R: Runtime>(app: AppHandle<R>, meeting_id: String) {
    tauri::async_runtime::spawn(async move {
        let pool = {
            let state = app.state::<AppState>();
            state.db_manager.pool().clone()
        };

        if let Err(error) = index_meeting_embeddings_with_pool(&app, &pool, &meeting_id).await {
            warn!(
                "Automatic embedding reindex failed for meeting {}: {}",
                meeting_id, error
            );
            let _ = app.emit(
                "embedding-error",
                serde_json::json!({
                    "meetingId": meeting_id,
                    "error": error,
                }),
            );
        }
    });
}

async fn enrich_search_result(
    pool: &sqlx::SqlitePool,
    hit: &RepositorySimilarityResult,
) -> Result<commands::SearchResult, String> {
    let meeting_title: Option<String> =
        sqlx::query_scalar("SELECT title FROM meetings WHERE id = ?")
            .bind(&hit.meeting_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to load meeting title for search result: {}", e))?;

    let preview = match hit.source_type.as_str() {
        "transcript_segment" => {
            let text: Option<String> =
                sqlx::query_scalar("SELECT transcript FROM transcripts WHERE id = ? LIMIT 1")
                    .bind(&hit.source_id)
                    .fetch_optional(pool)
                    .await
                    .map_err(|e| {
                        format!("Failed to load transcript preview for search result: {}", e)
                    })?;
            text.map(|value| truncate_preview(&value, 180))
        }
        "meeting_context" => {
            let package = assemble_meeting_context(pool, &hit.meeting_id).await?;
            let text = format_context_for_prompt(&package);
            if text.trim().is_empty() {
                None
            } else {
                Some(truncate_preview(&text, 180))
            }
        }
        _ => None,
    };

    Ok(commands::SearchResult {
        source_type: hit.source_type.clone(),
        source_id: hit.source_id.clone(),
        meeting_id: hit.meeting_id.clone(),
        score: hit.score,
        meeting_title,
        preview,
    })
}

pub mod commands {
    use serde::{Deserialize, Serialize};
    use tauri::{AppHandle, Emitter, Manager};

    use super::{
        enrich_search_result, index_meeting_embeddings_with_pool, resolve_embedding_provider,
    };
    use crate::database::repositories::embedding::EmbeddingsRepository;
    use crate::state::AppState;

    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct EmbeddingStatus {
        pub has_embeddings: bool,
        pub model_name: Option<String>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct SearchResult {
        pub source_type: String,
        pub source_id: String,
        pub meeting_id: String,
        pub score: f64,
        pub meeting_title: Option<String>,
        pub preview: Option<String>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct EmbeddingReindexResult {
        pub meeting_id: String,
        pub indexed_sources: usize,
        pub model_name: String,
    }

    #[tauri::command]
    pub async fn embedding_status(
        app: AppHandle,
        meeting_id: String,
    ) -> Result<EmbeddingStatus, String> {
        let state = app.state::<AppState>();
        let pool = state.db_manager.pool();
        let has_embeddings = EmbeddingsRepository::has_embeddings(pool, &meeting_id)
            .await
            .map_err(|e| format!("Failed to check embeddings: {}", e))?;
        let model_name = if has_embeddings {
            sqlx::query_scalar::<_, String>(
                "SELECT model_name FROM embeddings WHERE meeting_id = ? LIMIT 1",
            )
            .bind(&meeting_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to query embedding model: {}", e))?
        } else {
            None
        };
        Ok(EmbeddingStatus {
            has_embeddings,
            model_name,
        })
    }

    #[tauri::command]
    pub async fn embedding_search(
        app: AppHandle,
        query: String,
        meeting_id_filter: Option<String>,
        limit: usize,
    ) -> Result<Vec<SearchResult>, String> {
        let trimmed_query = query.trim();
        if trimmed_query.is_empty() {
            return Ok(Vec::new());
        }

        let state = app.state::<AppState>();
        let pool = state.db_manager.pool();
        let resolved = resolve_embedding_provider(pool).await?;
        let query_embedding = resolved.provider.embed_text(trimmed_query).await?;
        let hits = EmbeddingsRepository::find_similar(
            pool,
            &query_embedding,
            limit.clamp(1, 50),
            meeting_id_filter.as_deref(),
        )
        .await
        .map_err(|e| format!("Failed to search embeddings: {}", e))?;

        let mut results = Vec::with_capacity(hits.len());
        for hit in hits {
            results.push(enrich_search_result(pool, &hit).await?);
        }
        Ok(results)
    }

    #[tauri::command]
    pub async fn embedding_reindex(
        app: AppHandle,
        meeting_id: String,
    ) -> Result<EmbeddingReindexResult, String> {
        let pool = {
            let state = app.state::<AppState>();
            state.db_manager.pool().clone()
        };

        match index_meeting_embeddings_with_pool(&app, &pool, &meeting_id).await {
            Ok(result) => Ok(result),
            Err(error) => {
                let _ = app.emit(
                    "embedding-error",
                    serde_json::json!({
                        "meetingId": meeting_id,
                        "error": error,
                    }),
                );
                Err(error)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;

    struct MockEmbeddingProvider;

    #[async_trait]
    impl EmbeddingProvider for MockEmbeddingProvider {
        async fn embed_text(&self, text: &str) -> Result<Vec<f32>, String> {
            Ok(mock_embedding_for_text(text))
        }

        async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
            Ok(texts
                .iter()
                .map(|text| mock_embedding_for_text(text))
                .collect())
        }

        fn dimensions(&self) -> usize {
            3
        }

        fn model_name(&self) -> &str {
            "mock-embed"
        }
    }

    fn mock_embedding_for_text(text: &str) -> Vec<f32> {
        let normalized = text.to_lowercase();
        if normalized.contains("roadmap") {
            vec![1.0, 0.0, 0.0]
        } else if normalized.contains("customer") {
            vec![0.0, 1.0, 0.0]
        } else {
            vec![0.0, 0.0, 1.0]
        }
    }

    async fn setup_embedding_roundtrip_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.expect("pool");
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "CREATE TABLE meetings (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                folder_path TEXT,
                source_type TEXT NOT NULL,
                language TEXT,
                duration_seconds REAL,
                recording_started_at TEXT,
                recording_ended_at TEXT,
                markdown_export_path TEXT
            )",
        )
        .execute(&pool)
        .await
        .expect("meetings");

        sqlx::query(
            "CREATE TABLE transcripts (
                id TEXT PRIMARY KEY NOT NULL,
                meeting_id TEXT NOT NULL,
                transcript TEXT NOT NULL,
                raw_transcript TEXT,
                processing_version TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                audio_start_time REAL,
                audio_end_time REAL,
                duration REAL,
                speaker TEXT
            )",
        )
        .execute(&pool)
        .await
        .expect("transcripts");

        sqlx::query(
            "CREATE TABLE speaker_turns (
                id TEXT PRIMARY KEY NOT NULL,
                meeting_id TEXT NOT NULL,
                meeting_speaker_id TEXT,
                speaker_number INTEGER NOT NULL,
                speaker_name TEXT,
                start_ms INTEGER NOT NULL,
                end_ms INTEGER NOT NULL,
                text TEXT NOT NULL,
                confidence REAL NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("speaker_turns");

        sqlx::query(
            "CREATE TABLE speaker_identities (
                id TEXT PRIMARY KEY NOT NULL,
                display_name TEXT NOT NULL,
                normalized_name TEXT NOT NULL,
                notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                archived_at TEXT
            )",
        )
        .execute(&pool)
        .await
        .expect("speaker_identities");

        sqlx::query(
            "CREATE TABLE meeting_speakers (
                id TEXT PRIMARY KEY NOT NULL,
                meeting_id TEXT NOT NULL,
                diarization_speaker_number INTEGER,
                display_name_override TEXT,
                speaker_identity_id TEXT,
                review_status TEXT NOT NULL,
                match_confidence REAL,
                is_active INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_reviewed_at TEXT,
                last_generated_at TEXT
            )",
        )
        .execute(&pool)
        .await
        .expect("meeting_speakers");

        sqlx::query(
            "CREATE TABLE action_items (
                id TEXT PRIMARY KEY NOT NULL,
                meeting_id TEXT NOT NULL,
                title TEXT NOT NULL,
                details TEXT,
                owner_speaker_identity_id TEXT,
                owner_display_name TEXT,
                due_date TEXT,
                status TEXT NOT NULL,
                review_status TEXT NOT NULL,
                source_transcript_id TEXT,
                source_start_ms INTEGER,
                source_end_ms INTEGER,
                source_excerpt TEXT,
                extraction_method TEXT NOT NULL,
                extraction_version TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("action_items");

        sqlx::query(
            "CREATE TABLE decisions (
                id TEXT PRIMARY KEY NOT NULL,
                meeting_id TEXT NOT NULL,
                title TEXT NOT NULL,
                details TEXT,
                review_status TEXT NOT NULL,
                source_transcript_id TEXT,
                source_start_ms INTEGER,
                source_end_ms INTEGER,
                source_excerpt TEXT,
                extraction_method TEXT NOT NULL,
                extraction_version TEXT NOT NULL,
                related_action_item_ids TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("decisions");

        sqlx::query(
            "CREATE TABLE meeting_context_assets (
                id TEXT PRIMARY KEY NOT NULL,
                meeting_id TEXT NOT NULL,
                asset_type TEXT NOT NULL,
                title TEXT,
                content TEXT,
                file_path TEXT,
                file_mime_type TEXT,
                file_size_bytes INTEGER,
                metadata TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("meeting_context_assets");

        sqlx::query(
            "CREATE TABLE tags (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                normalized_name TEXT NOT NULL,
                color TEXT,
                created_at TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("tags");

        sqlx::query(
            "CREATE TABLE meeting_tags (
                meeting_id TEXT NOT NULL,
                tag_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (meeting_id, tag_id)
            )",
        )
        .execute(&pool)
        .await
        .expect("meeting_tags");

        sqlx::query(
            "CREATE TABLE vocabulary_entries (
                id TEXT PRIMARY KEY NOT NULL,
                scope_type TEXT NOT NULL,
                scope_id TEXT,
                source_text TEXT NOT NULL,
                target_text TEXT NOT NULL,
                case_sensitive INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("vocabulary_entries");

        sqlx::query(
            "CREATE TABLE embeddings (
                id TEXT PRIMARY KEY NOT NULL,
                source_type TEXT NOT NULL,
                source_id TEXT NOT NULL,
                meeting_id TEXT NOT NULL,
                embedding BLOB NOT NULL,
                model_name TEXT NOT NULL,
                dimensions INTEGER NOT NULL,
                created_at TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("embeddings");

        sqlx::query(
            "INSERT INTO meetings (
                id, title, created_at, updated_at, folder_path, source_type, language,
                duration_seconds, recording_started_at, recording_ended_at, markdown_export_path
            ) VALUES (?, ?, ?, ?, NULL, 'recorded', NULL, NULL, NULL, NULL, NULL)",
        )
        .bind("meeting-1")
        .bind("Roadmap Review")
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .expect("seed meeting");

        sqlx::query(
            "INSERT INTO transcripts (
                id, meeting_id, transcript, raw_transcript, processing_version, timestamp,
                audio_start_time, audio_end_time, duration, speaker
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("transcript-1")
        .bind("meeting-1")
        .bind("Roadmap decisions were finalized for the desktop launch.")
        .bind("Roadmap decisions were finalized for the desktop launch.")
        .bind("v0.5.0")
        .bind(&now)
        .bind(0.0f64)
        .bind(4.0f64)
        .bind(4.0f64)
        .bind(Option::<String>::None)
        .execute(&pool)
        .await
        .expect("seed transcript");

        sqlx::query(
            "INSERT INTO meeting_context_assets (
                id, meeting_id, asset_type, title, content, file_path, file_mime_type,
                file_size_bytes, metadata, sort_order, created_at, updated_at
            ) VALUES (?, ?, 'scratchpad', 'Notes', ?, NULL, NULL, NULL, NULL, 0, ?, ?)",
        )
        .bind("scratchpad-1")
        .bind("meeting-1")
        .bind("Remember customer concerns before rollout.")
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .expect("seed scratchpad");

        sqlx::query(
            "INSERT INTO meeting_context_assets (
                id, meeting_id, asset_type, title, content, file_path, file_mime_type,
                file_size_bytes, metadata, sort_order, created_at, updated_at
            ) VALUES (?, ?, 'attachment', ?, ?, ?, 'text/markdown', 128, NULL, 1, ?, ?)",
        )
        .bind("attachment-1")
        .bind("meeting-1")
        .bind("Customer Memo")
        .bind("Customer success wants a clearer migration guide.")
        .bind("C:\\memo.md")
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .expect("seed attachment");

        sqlx::query(
            "INSERT INTO tags (id, name, normalized_name, color, created_at)
             VALUES (?, ?, ?, NULL, ?)",
        )
        .bind("tag-1")
        .bind("Customer")
        .bind("customer")
        .bind(&now)
        .execute(&pool)
        .await
        .expect("seed tag");

        sqlx::query("INSERT INTO meeting_tags (meeting_id, tag_id, created_at) VALUES (?, ?, ?)")
            .bind("meeting-1")
            .bind("tag-1")
            .bind(&now)
            .execute(&pool)
            .await
            .expect("seed meeting tag");

        pool
    }

    #[test]
    fn test_ollama_provider_creation() {
        let p = OllamaEmbeddingProvider::new("http://127.0.0.1:11434", "nomic-embed-text");
        assert_eq!(p.model_name(), "nomic-embed-text");
        assert_eq!(p.dimensions(), 384);
    }

    #[test]
    fn test_openai_provider_creation() {
        let p = OpenAICompatibleEmbeddingProvider::new(
            "https://api.openai.com",
            "text-embedding-3-small",
            "sk-test",
            1536,
        );
        assert_eq!(p.model_name(), "text-embedding-3-small");
        assert_eq!(p.dimensions(), 1536);
    }

    #[tokio::test]
    async fn test_collect_index_and_search_embeddings_roundtrip() {
        let pool = setup_embedding_roundtrip_pool().await;
        let provider = MockEmbeddingProvider;

        let sources = collect_embedding_sources(&pool, "meeting-1")
            .await
            .expect("collect sources");
        assert_eq!(sources.len(), 2);
        assert!(sources
            .iter()
            .any(|source| source.source_type == "transcript_segment"));
        assert!(sources
            .iter()
            .any(|source| source.source_type == "meeting_context"));

        let embeddings = embed_sources(&provider, &sources)
            .await
            .expect("embed sources");
        for (source, embedding) in sources.iter().zip(embeddings.iter()) {
            EmbeddingsRepository::store_embedding(
                &pool,
                &source.source_type,
                &source.source_id,
                "meeting-1",
                embedding,
                provider.model_name(),
            )
            .await
            .expect("store embedding");
        }

        let roadmap_hits = EmbeddingsRepository::find_similar(
            &pool,
            &provider
                .embed_text("roadmap follow-up")
                .await
                .expect("query embedding"),
            5,
            Some("meeting-1"),
        )
        .await
        .expect("roadmap search");
        assert_eq!(roadmap_hits[0].source_type, "transcript_segment");
        assert_eq!(roadmap_hits[0].source_id, "transcript-1");

        let roadmap_result = enrich_search_result(&pool, &roadmap_hits[0])
            .await
            .expect("enrich transcript result");
        assert_eq!(
            roadmap_result.meeting_title.as_deref(),
            Some("Roadmap Review")
        );
        assert!(roadmap_result
            .preview
            .as_deref()
            .is_some_and(|preview| preview.contains("Roadmap decisions")));

        let customer_hits = EmbeddingsRepository::find_similar(
            &pool,
            &provider
                .embed_text("customer migration")
                .await
                .expect("query embedding"),
            5,
            Some("meeting-1"),
        )
        .await
        .expect("customer search");
        assert_eq!(customer_hits[0].source_type, "meeting_context");

        let customer_result = enrich_search_result(&pool, &customer_hits[0])
            .await
            .expect("enrich context result");
        assert!(customer_result
            .preview
            .as_deref()
            .is_some_and(|preview| preview.contains("Customer Memo")));
    }
}
