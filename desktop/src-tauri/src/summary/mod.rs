/// Summary module - handles all meeting summary generation functionality
///
/// This module contains:
/// - LLM client for communicating with various AI providers (OpenAI, Claude, Groq, Ollama, OpenRouter, CustomOpenAI)
/// - Processor for chunking transcripts and generating summaries
/// - Service layer for orchestrating summary generation
/// - Templates for structured meeting summary generation
/// - Tauri commands for frontend integration
use serde::{Deserialize, Serialize};

/// Custom OpenAI-compatible endpoint configuration
/// Non-secret settings are stored in SQLite, while the API key is stored in OS-backed secure credential storage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomOpenAIConfig {
    /// Base URL of the OpenAI-compatible API endpoint (e.g., "http://localhost:8000/v1")
    pub endpoint: String,
    /// API key for authentication (optional if server doesn't require it)
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    /// Model identifier to use (e.g., "gpt-4", "llama-3-70b", "mistral-7b")
    pub model: String,
    /// Maximum tokens for completion (optional)
    #[serde(rename = "maxTokens")]
    pub max_tokens: Option<i32>,
    /// Temperature parameter (0.0-2.0, optional)
    pub temperature: Option<f32>,
    /// Top-P sampling parameter (0.0-1.0, optional)
    #[serde(rename = "topP")]
    pub top_p: Option<f32>,
}

/// Read-only view of the custom OpenAI-compatible endpoint configuration.
/// The stored API key never crosses into the webview; callers only get presence metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomOpenAIConfigView {
    pub endpoint: String,
    pub model: String,
    #[serde(rename = "maxTokens")]
    pub max_tokens: Option<i32>,
    pub temperature: Option<f32>,
    #[serde(rename = "topP")]
    pub top_p: Option<f32>,
    #[serde(rename = "hasStoredApiKey")]
    pub has_stored_api_key: bool,
}

pub mod commands;
pub mod contract;
pub mod decision_action_linking;
pub mod extraction_heuristics;
pub mod llm_client;
pub mod owner_linking;
pub mod processor;
pub mod provenance;
pub mod provider_capabilities;
pub mod service;
pub mod streaming;
pub mod structured_artifacts;
pub mod template_commands;
pub mod templates;
pub mod token_counter;

pub use commands::{
    __cmd__api_cancel_summary, __cmd__api_get_summary, __cmd__api_process_transcript,
    __cmd__api_save_meeting_summary, api_cancel_summary, api_get_summary, api_process_transcript,
    api_save_meeting_summary,
};

pub use template_commands::{
    __cmd__api_get_template_details, __cmd__api_list_templates, __cmd__api_validate_template,
    api_get_template_details, api_list_templates, api_validate_template,
};

pub use llm_client::LLMProvider;
pub use processor::{
    accurate_token_count, chunk_text_accurate, clean_llm_markdown_output,
    extract_meeting_name_from_markdown, generate_meeting_summary,
};
pub use service::SummaryService;
pub use streaming::{
    __cmd__generate_summary_streaming, generate_summary_streaming, SummaryChunk, SummaryProgress,
};
pub use token_counter::TokenCounter;
