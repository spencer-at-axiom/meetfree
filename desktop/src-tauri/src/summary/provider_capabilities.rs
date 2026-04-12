use super::llm_client::LLMProvider;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::database::repositories::setting::SettingsRepository;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCapabilities {
    pub supports_tool_use: bool,
    pub supports_json_mode: bool,
    pub supports_streaming: bool,
    pub max_context_tokens: Option<usize>,
    pub supports_system_prompt: bool,
    pub supports_embeddings: bool,
    pub supports_structured_output: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExtractionStrategy {
    ToolUse,
    JsonMode,
    MarkdownParsing,
}

impl ProviderCapabilities {
    pub fn extraction_strategy(&self) -> ExtractionStrategy {
        if self.supports_tool_use {
            ExtractionStrategy::ToolUse
        } else if self.supports_json_mode {
            ExtractionStrategy::JsonMode
        } else {
            ExtractionStrategy::MarkdownParsing
        }
    }
}

pub fn default_capabilities() -> ProviderCapabilities {
    ProviderCapabilities {
        supports_tool_use: false,
        supports_json_mode: false,
        supports_streaming: false,
        max_context_tokens: None,
        supports_system_prompt: false,
        supports_embeddings: false,
        supports_structured_output: false,
    }
}

pub fn capabilities_for_provider(provider: &LLMProvider, model_name: &str) -> ProviderCapabilities {
    let m = model_name.to_lowercase();
    match provider {
        LLMProvider::OpenAI => {
            let max_context_tokens = if m.contains("gpt-3.5-turbo") {
                Some(16_384)
            } else {
                Some(128_000)
            };
            ProviderCapabilities {
                supports_tool_use: true,
                supports_json_mode: true,
                supports_streaming: true,
                max_context_tokens,
                supports_system_prompt: true,
                supports_embeddings: true,
                supports_structured_output: true,
            }
        }
        LLMProvider::Claude => ProviderCapabilities {
            supports_tool_use: true,
            supports_json_mode: false,
            supports_streaming: true,
            max_context_tokens: Some(200_000),
            supports_system_prompt: true,
            supports_embeddings: false,
            supports_structured_output: true,
        },
        LLMProvider::Groq => ProviderCapabilities {
            supports_tool_use: true,
            supports_json_mode: true,
            supports_streaming: true,
            max_context_tokens: if m.contains("llama") {
                Some(131_072)
            } else {
                Some(32_768)
            },
            supports_system_prompt: true,
            supports_embeddings: false,
            supports_structured_output: true,
        },
        LLMProvider::Ollama => ProviderCapabilities {
            supports_tool_use: false,
            supports_json_mode: false,
            supports_streaming: true,
            max_context_tokens: None,
            supports_system_prompt: true,
            supports_embeddings: true,
            supports_structured_output: false,
        },
        LLMProvider::OpenRouter => ProviderCapabilities {
            supports_tool_use: true,
            supports_json_mode: true,
            supports_streaming: true,
            max_context_tokens: None,
            supports_system_prompt: true,
            supports_embeddings: false,
            supports_structured_output: true,
        },
        LLMProvider::CustomOpenAI => ProviderCapabilities {
            supports_tool_use: false,
            supports_json_mode: false,
            supports_streaming: true,
            max_context_tokens: None,
            supports_system_prompt: true,
            supports_embeddings: false,
            supports_structured_output: false,
        },
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilitiesView {
    pub provider: String,
    pub model_name: String,
    pub supports_tool_use: bool,
    pub supports_json_mode: bool,
    pub supports_streaming: bool,
    pub max_context_tokens: Option<usize>,
    pub supports_system_prompt: bool,
    pub supports_embeddings: bool,
    pub supports_structured_output: bool,
    pub extraction_strategy: ExtractionStrategy,
}

impl ProviderCapabilitiesView {
    fn from_parts(provider: &str, model_name: &str, capabilities: ProviderCapabilities) -> Self {
        let extraction_strategy = capabilities.extraction_strategy();
        Self {
            provider: provider.to_string(),
            model_name: model_name.to_string(),
            supports_tool_use: capabilities.supports_tool_use,
            supports_json_mode: capabilities.supports_json_mode,
            supports_streaming: capabilities.supports_streaming,
            max_context_tokens: capabilities.max_context_tokens,
            supports_system_prompt: capabilities.supports_system_prompt,
            supports_embeddings: capabilities.supports_embeddings,
            supports_structured_output: capabilities.supports_structured_output,
            extraction_strategy,
        }
    }
}

#[tauri::command]
pub async fn summary_provider_capabilities(
    provider: String,
    model_name: String,
) -> Result<ProviderCapabilitiesView, String> {
    let parsed_provider: LLMProvider = provider.parse()?;
    let capabilities = capabilities_for_provider(&parsed_provider, &model_name);
    Ok(ProviderCapabilitiesView::from_parts(
        &provider,
        &model_name,
        capabilities,
    ))
}

#[tauri::command]
pub async fn current_summary_provider_capabilities(
    app: AppHandle,
) -> Result<Option<ProviderCapabilitiesView>, String> {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();
    let config = SettingsRepository::get_model_config(pool)
        .await
        .map_err(|e| format!("Failed to load model config: {}", e))?;

    let Some(config) = config else {
        return Ok(None);
    };

    let parsed_provider: LLMProvider = config.provider.parse()?;
    let capabilities = capabilities_for_provider(&parsed_provider, &config.model);
    Ok(Some(ProviderCapabilitiesView::from_parts(
        &config.provider,
        &config.model,
        capabilities,
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_openai_capabilities() {
        let c = capabilities_for_provider(&LLMProvider::OpenAI, "gpt-4o");
        assert!(c.supports_tool_use);
        assert!(c.supports_json_mode);
        assert!(c.supports_streaming);
        assert_eq!(c.max_context_tokens, Some(128_000));
        assert!(c.supports_system_prompt);
        assert!(c.supports_embeddings);
        assert!(c.supports_structured_output);

        let c35 = capabilities_for_provider(&LLMProvider::OpenAI, "gpt-3.5-turbo");
        assert_eq!(c35.max_context_tokens, Some(16_384));
    }

    #[test]
    fn test_claude_capabilities() {
        let c = capabilities_for_provider(&LLMProvider::Claude, "claude-3-5-sonnet-20241022");
        assert!(c.supports_tool_use);
        assert!(!c.supports_json_mode);
        assert!(c.supports_streaming);
        assert_eq!(c.max_context_tokens, Some(200_000));
        assert!(c.supports_system_prompt);
        assert!(!c.supports_embeddings);
        assert!(c.supports_structured_output);
    }

    #[test]
    fn test_ollama_capabilities() {
        let c = capabilities_for_provider(&LLMProvider::Ollama, "llama3.2");
        assert!(!c.supports_tool_use);
        assert!(!c.supports_json_mode);
        assert!(c.supports_streaming);
        assert!(c.max_context_tokens.is_none());
        assert!(c.supports_system_prompt);
        assert!(c.supports_embeddings);
        assert!(!c.supports_structured_output);
    }

    #[test]
    fn test_extraction_strategy_selection() {
        let openai = capabilities_for_provider(&LLMProvider::OpenAI, "gpt-4o");
        assert_eq!(openai.extraction_strategy(), ExtractionStrategy::ToolUse);

        let ollama = capabilities_for_provider(&LLMProvider::Ollama, "mistral");
        assert_eq!(
            ollama.extraction_strategy(),
            ExtractionStrategy::MarkdownParsing
        );
    }

    #[test]
    fn test_default_capabilities() {
        let d = default_capabilities();
        assert!(!d.supports_tool_use);
        assert!(!d.supports_json_mode);
        assert!(!d.supports_streaming);
        assert!(d.max_context_tokens.is_none());
        assert!(!d.supports_system_prompt);
        assert!(!d.supports_embeddings);
        assert!(!d.supports_structured_output);
    }
}
