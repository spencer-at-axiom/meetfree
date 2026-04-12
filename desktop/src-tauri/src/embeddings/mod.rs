use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;
use std::sync::atomic::{AtomicUsize, Ordering};

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

pub mod commands {
    use log::info;
    use serde::{Deserialize, Serialize};
    use tauri::{AppHandle, Manager};

    use crate::database::repositories::embedding::EmbeddingsRepository;
    use crate::state::AppState;

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct EmbeddingStatus {
        pub has_embeddings: bool,
        pub model_name: Option<String>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct SearchResult {
        pub source_type: String,
        pub source_id: String,
        pub meeting_id: String,
        pub score: f64,
    }

    #[tauri::command]
    pub async fn embedding_status(
        app: AppHandle,
        meeting_id: String,
    ) -> Result<EmbeddingStatus, String> {
        let state = app.state::<AppState>();
        let pool = state.db_manager.pool();
        let has_embeddings =
            EmbeddingsRepository::has_embeddings(pool, &meeting_id)
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
        _app: AppHandle,
        _query: String,
        _meeting_id_filter: Option<String>,
        _limit: usize,
    ) -> Result<Vec<SearchResult>, String> {
        info!("Embedding search requires a configured embedding provider");
        Ok(vec![])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
