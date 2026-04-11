use crate::config::{
    DEFAULT_PARAKEET_MODEL, DEFAULT_SUMMARY_MODEL, DEFAULT_SUMMARY_PROVIDER,
    DEFAULT_WHISPER_MODEL,
};
use crate::database::models::{Setting, TranscriptSetting};
use crate::summary::CustomOpenAIConfig;
use keyring::{Entry, Error as KeyringError};
use sqlx::{Row, SqlitePool};

#[derive(serde::Deserialize, Debug)]
pub struct SaveModelConfigRequest {
    pub provider: String,
    pub model: String,
    #[serde(rename = "whisperModel")]
    pub whisper_model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    #[serde(rename = "ollamaEndpoint")]
    pub ollama_endpoint: Option<String>,
}

#[derive(serde::Deserialize, Debug)]
pub struct SaveTranscriptConfigRequest {
    pub provider: String,
    pub model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
}

pub struct SettingsRepository;

const SECRET_SERVICE: &str = "ai.meetfree.desktop";
const SUMMARY_SECRET_SCOPE: &str = "summary";
const CUSTOM_OPENAI_SECRET_SCOPE: &str = "custom-openai";
const CUSTOM_OPENAI_SECRET_PROVIDER: &str = "config";
const ACTIVE_TRANSCRIPT_PROVIDERS: [&str; 2] = ["parakeet", "localWhisper"];
const ACTIVE_SUMMARY_PROVIDERS: [&str; 6] = [
    "openai",
    "claude",
    "ollama",
    "groq",
    "openrouter",
    "custom-openai",
];

// Transcript providers (active): localWhisper, parakeet
// Legacy transcript providers are mapped to active providers on read.
// Summary providers: openai, claude, ollama, groq, openrouter, custom-openai
// Secrets are stored in OS-backed credential storage.

impl SettingsRepository {
    pub fn is_supported_transcript_provider(provider: &str) -> bool {
        ACTIVE_TRANSCRIPT_PROVIDERS.contains(&provider)
    }

    pub fn is_supported_summary_provider(provider: &str) -> bool {
        ACTIVE_SUMMARY_PROVIDERS.contains(&provider)
    }

    /// Normalizes persisted summary provider/model values.
    /// Returns: (provider, model, was_legacy_or_invalid)
    pub fn normalize_summary_config(provider: &str, model: &str) -> (String, String, bool) {
        let normalized_provider = provider.trim();
        let normalized_model = model.trim();

        match normalized_provider {
            "ollama" => (
                "ollama".to_string(),
                if normalized_model.is_empty() {
                    DEFAULT_SUMMARY_MODEL.to_string()
                } else {
                    normalized_model.to_string()
                },
                false,
            ),
            "openai" | "claude" | "groq" | "openrouter" | "custom-openai" => (
                normalized_provider.to_string(),
                normalized_model.to_string(),
                false,
            ),
            _ => (
                DEFAULT_SUMMARY_PROVIDER.to_string(),
                DEFAULT_SUMMARY_MODEL.to_string(),
                true,
            ),
        }
    }

    /// Normalizes persisted transcript provider/model values.
    /// Returns: (provider, model, was_legacy_or_invalid)
    pub fn normalize_transcript_config(provider: &str, model: &str) -> (String, String, bool) {
        let normalized_provider = provider.trim();
        let normalized_model = model.trim();

        match normalized_provider {
            "parakeet" => (
                "parakeet".to_string(),
                if normalized_model.is_empty() {
                    DEFAULT_PARAKEET_MODEL.to_string()
                } else {
                    normalized_model.to_string()
                },
                false,
            ),
            "localWhisper" => (
                "localWhisper".to_string(),
                if normalized_model.is_empty() {
                    DEFAULT_WHISPER_MODEL.to_string()
                } else {
                    normalized_model.to_string()
                },
                false,
            ),
            // Legacy providers are no longer supported in active runtime.
            "deepgram" | "elevenLabs" | "groq" | "openai" => (
                "parakeet".to_string(),
                DEFAULT_PARAKEET_MODEL.to_string(),
                true,
            ),
            _ => (
                "parakeet".to_string(),
                DEFAULT_PARAKEET_MODEL.to_string(),
                true,
            ),
        }
    }

    fn secure_storage_error(context: &str, err: KeyringError) -> sqlx::Error {
        sqlx::Error::Protocol(format!("{}: {}", context, err))
    }

    fn secure_entry(scope: &str, provider: &str) -> std::result::Result<Entry, sqlx::Error> {
        let account = format!("{}:{}", scope, provider);
        Entry::new(SECRET_SERVICE, &account).map_err(|err| {
            Self::secure_storage_error("Failed to initialize secure storage entry", err)
        })
    }

    fn read_secret(
        scope: &str,
        provider: &str,
    ) -> std::result::Result<Option<String>, sqlx::Error> {
        let entry = Self::secure_entry(scope, provider)?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(err) => Err(Self::secure_storage_error(
                "Failed to read secret from secure storage",
                err,
            )),
        }
    }

    fn store_secret(
        scope: &str,
        provider: &str,
        secret: &str,
    ) -> std::result::Result<(), sqlx::Error> {
        if secret.trim().is_empty() {
            return Self::delete_secret(scope, provider);
        }

        let entry = Self::secure_entry(scope, provider)?;
        entry.set_password(secret).map_err(|err| {
            Self::secure_storage_error("Failed to store secret in secure storage", err)
        })
    }

    fn delete_secret(scope: &str, provider: &str) -> std::result::Result<(), sqlx::Error> {
        let entry = Self::secure_entry(scope, provider)?;
        match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(err) => Err(Self::secure_storage_error(
                "Failed to delete secret from secure storage",
                err,
            )),
        }
    }

    async fn load_custom_openai_config_from_db(
        pool: &SqlitePool,
    ) -> std::result::Result<Option<CustomOpenAIConfig>, sqlx::Error> {
        let row = sqlx::query(
            r#"
            SELECT customOpenAIConfig
            FROM settings
            WHERE id = '1'
            LIMIT 1
            "#,
        )
        .fetch_optional(pool)
        .await?;

        match row {
            Some(record) => {
                let config_json: Option<String> = record.get("customOpenAIConfig");

                if let Some(json) = config_json {
                    let config: CustomOpenAIConfig = serde_json::from_str(&json).map_err(|e| {
                        sqlx::Error::Protocol(format!("Invalid JSON in customOpenAIConfig: {}", e))
                    })?;

                    Ok(Some(config))
                } else {
                    Ok(None)
                }
            }
            None => Ok(None),
        }
    }

    async fn save_custom_openai_config_without_secret(
        pool: &SqlitePool,
        config: &CustomOpenAIConfig,
    ) -> std::result::Result<(), sqlx::Error> {
        let mut sanitized = config.clone();
        sanitized.api_key = None;

        let config_json = serde_json::to_string(&sanitized).map_err(|e| {
            sqlx::Error::Protocol(format!("Failed to serialize config to JSON: {}", e))
        })?;

        sqlx::query(
            r#"
            INSERT INTO settings (id, provider, model, whisperModel, customOpenAIConfig)
            VALUES ('1', 'custom-openai', $1, 'large-v3', $2)
            ON CONFLICT(id) DO UPDATE SET
                provider = excluded.provider,
                model = excluded.model,
                customOpenAIConfig = excluded.customOpenAIConfig
            "#,
        )
        .bind(&sanitized.model)
        .bind(config_json)
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn get_model_config(
        pool: &SqlitePool,
    ) -> std::result::Result<Option<Setting>, sqlx::Error> {
        let mut setting = sqlx::query_as::<_, Setting>("SELECT * FROM settings LIMIT 1")
            .fetch_optional(pool)
            .await?;

        if let Some(config) = setting.as_mut() {
            let (provider, model, migrated) =
                Self::normalize_summary_config(&config.provider, &config.model);
            if migrated || provider != config.provider || model != config.model {
                // Best-effort persistence of normalized values.
                let _ = Self::save_model_config(
                    pool,
                    &provider,
                    &model,
                    &config.whisper_model,
                    config.ollama_endpoint.as_deref(),
                )
                .await;
                config.provider = provider;
                config.model = model;
            }
        }

        Ok(setting)
    }

    pub async fn save_model_config(
        pool: &SqlitePool,
        provider: &str,
        model: &str,
        whisper_model: &str,
        ollama_endpoint: Option<&str>,
    ) -> std::result::Result<(), sqlx::Error> {
        let provider = provider.trim();
        let model = model.trim();
        let whisper_model = whisper_model.trim();

        if !Self::is_supported_summary_provider(provider) {
            return Err(sqlx::Error::Protocol(format!(
                "Unsupported summary provider '{}'. Supported providers: {}",
                provider,
                ACTIVE_SUMMARY_PROVIDERS.join(", ")
            )));
        }

        let normalized_model = if provider == "ollama" && model.is_empty() {
            DEFAULT_SUMMARY_MODEL
        } else {
            model
        };

        if normalized_model.is_empty() {
            return Err(sqlx::Error::Protocol(format!(
                "Summary model is required for provider '{}'",
                provider
            )));
        }

        let normalized_whisper_model = if whisper_model.is_empty() {
            DEFAULT_WHISPER_MODEL
        } else {
            whisper_model
        };

        sqlx::query(
            r#"
            INSERT INTO settings (id, provider, model, whisperModel, ollamaEndpoint)
            VALUES ('1', $1, $2, $3, $4)
            ON CONFLICT(id) DO UPDATE SET
                provider = excluded.provider,
                model = excluded.model,
                whisperModel = excluded.whisperModel,
                ollamaEndpoint = excluded.ollamaEndpoint
            "#,
        )
        .bind(provider)
        .bind(normalized_model)
        .bind(normalized_whisper_model)
        .bind(ollama_endpoint)
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn save_api_key(
        _pool: &SqlitePool,
        provider: &str,
        api_key: &str,
    ) -> std::result::Result<(), sqlx::Error> {
        if provider == "custom-openai" {
            return Err(sqlx::Error::Protocol(
                "custom-openai provider should use save_custom_openai_config() instead of save_api_key()".into(),
            ));
        }

        if !Self::is_supported_summary_provider(provider) {
            return Err(sqlx::Error::Protocol(format!(
                "Unsupported summary provider '{}'. Supported providers: {}",
                provider,
                ACTIVE_SUMMARY_PROVIDERS.join(", ")
            )));
        }

        Self::store_secret(SUMMARY_SECRET_SCOPE, provider, api_key)?;

        Ok(())
    }

    pub async fn get_api_key(
        pool: &SqlitePool,
        provider: &str,
    ) -> std::result::Result<Option<String>, sqlx::Error> {
        if provider == "custom-openai" {
            let config = Self::get_custom_openai_config(pool).await?;
            return Ok(config.and_then(|c| c.api_key));
        }

        if !Self::is_supported_summary_provider(provider) {
            return Err(sqlx::Error::Protocol(format!(
                "Unsupported summary provider '{}'. Supported providers: {}",
                provider,
                ACTIVE_SUMMARY_PROVIDERS.join(", ")
            )));
        }

        Self::read_secret(SUMMARY_SECRET_SCOPE, provider)
    }

    pub async fn get_transcript_config(
        pool: &SqlitePool,
    ) -> std::result::Result<Option<TranscriptSetting>, sqlx::Error> {
        let setting =
            sqlx::query_as::<_, TranscriptSetting>("SELECT * FROM transcript_settings LIMIT 1")
                .fetch_optional(pool)
                .await?;
        Ok(setting)
    }

    pub async fn save_transcript_config(
        pool: &SqlitePool,
        provider: &str,
        model: &str,
    ) -> std::result::Result<(), sqlx::Error> {
        if !Self::is_supported_transcript_provider(provider) {
            return Err(sqlx::Error::Protocol(format!(
                "Unsupported transcript provider '{}'. Supported providers: {}",
                provider,
                ACTIVE_TRANSCRIPT_PROVIDERS.join(", ")
            )));
        }

        let normalized_model = if model.trim().is_empty() {
            match provider {
                "parakeet" => DEFAULT_PARAKEET_MODEL,
                "localWhisper" => DEFAULT_WHISPER_MODEL,
                _ => model,
            }
        } else {
            model
        };

        sqlx::query(
            r#"
            INSERT INTO transcript_settings (id, provider, model)
            VALUES ('1', $1, $2)
            ON CONFLICT(id) DO UPDATE SET
                provider = excluded.provider,
                model = excluded.model
            "#,
        )
        .bind(provider)
        .bind(normalized_model)
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn save_transcript_api_key(
        _pool: &SqlitePool,
        provider: &str,
        _api_key: &str,
    ) -> std::result::Result<(), sqlx::Error> {
        if !Self::is_supported_transcript_provider(provider) {
            return Err(sqlx::Error::Protocol(format!(
                "Unsupported transcript provider '{}'. Supported providers: {}",
                provider,
                ACTIVE_TRANSCRIPT_PROVIDERS.join(", ")
            )));
        }

        Ok(())
    }

    pub async fn get_transcript_api_key(
        _pool: &SqlitePool,
        provider: &str,
    ) -> std::result::Result<Option<String>, sqlx::Error> {
        if !Self::is_supported_transcript_provider(provider) {
            return Err(sqlx::Error::Protocol(format!(
                "Unsupported transcript provider '{}'. Supported providers: {}",
                provider,
                ACTIVE_TRANSCRIPT_PROVIDERS.join(", ")
            )));
        }

        Ok(None)
    }

    pub async fn delete_api_key(
        pool: &SqlitePool,
        provider: &str,
    ) -> std::result::Result<(), sqlx::Error> {
        if provider == "custom-openai" {
            Self::delete_secret(CUSTOM_OPENAI_SECRET_SCOPE, CUSTOM_OPENAI_SECRET_PROVIDER)?;

            if let Some(mut config) = Self::load_custom_openai_config_from_db(pool).await? {
                config.api_key = None;
                Self::save_custom_openai_config_without_secret(pool, &config).await?;
            }

            return Ok(());
        }

        if !Self::is_supported_summary_provider(provider) {
            return Err(sqlx::Error::Protocol(format!(
                "Unsupported summary provider '{}'. Supported providers: {}",
                provider,
                ACTIVE_SUMMARY_PROVIDERS.join(", ")
            )));
        }

        Self::delete_secret(SUMMARY_SECRET_SCOPE, provider)?;

        Ok(())
    }

    // ===== CUSTOM OPENAI CONFIG METHODS =====

    /// Gets the custom OpenAI configuration from the database plus secure credential storage.
    pub async fn get_custom_openai_config(
        pool: &SqlitePool,
    ) -> std::result::Result<Option<CustomOpenAIConfig>, sqlx::Error> {
        let config = Self::load_custom_openai_config_from_db(pool).await?;

        match config {
            Some(mut config) => {
                if let Some(legacy_key) = config.api_key.clone() {
                    if !legacy_key.trim().is_empty() {
                        Self::store_secret(
                            CUSTOM_OPENAI_SECRET_SCOPE,
                            CUSTOM_OPENAI_SECRET_PROVIDER,
                            &legacy_key,
                        )?;
                    }

                    config.api_key = None;
                    Self::save_custom_openai_config_without_secret(pool, &config).await?;
                }

                config.api_key =
                    Self::read_secret(CUSTOM_OPENAI_SECRET_SCOPE, CUSTOM_OPENAI_SECRET_PROVIDER)?;
                Ok(Some(config))
            }
            None => Ok(None),
        }
    }

    /// Saves the custom OpenAI configuration with the API key stored in secure storage.
    pub async fn save_custom_openai_config(
        pool: &SqlitePool,
        config: &CustomOpenAIConfig,
    ) -> std::result::Result<(), sqlx::Error> {
        if let Some(api_key) = config.api_key.as_deref() {
            Self::store_secret(
                CUSTOM_OPENAI_SECRET_SCOPE,
                CUSTOM_OPENAI_SECRET_PROVIDER,
                api_key,
            )?;
        }

        Self::save_custom_openai_config_without_secret(pool, config).await
    }
}

#[cfg(test)]
mod tests {
    use super::SettingsRepository;
    use crate::config::{DEFAULT_PARAKEET_MODEL, DEFAULT_SUMMARY_MODEL, DEFAULT_SUMMARY_PROVIDER};

    #[test]
    fn normalize_transcript_config_maps_legacy_provider_to_parakeet_default() {
        let (provider, model, migrated) =
            SettingsRepository::normalize_transcript_config("deepgram", "nova-2-phonecall");

        assert_eq!(provider, "parakeet");
        assert_eq!(model, DEFAULT_PARAKEET_MODEL);
        assert!(migrated);
    }

    #[test]
    fn normalize_summary_config_maps_invalid_provider_to_defaults() {
        let (provider, model, migrated) =
            SettingsRepository::normalize_summary_config("not-a-provider", "");

        assert_eq!(provider, DEFAULT_SUMMARY_PROVIDER);
        assert_eq!(model, DEFAULT_SUMMARY_MODEL);
        assert!(migrated);
    }

    #[tokio::test]
    async fn save_transcript_config_rejects_legacy_provider() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("failed to create sqlite memory pool");

        sqlx::query(
            r#"
            CREATE TABLE transcript_settings (
                id TEXT PRIMARY KEY NOT NULL,
                provider TEXT NOT NULL,
                model TEXT NOT NULL
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("failed to create transcript_settings table");

        let result =
            SettingsRepository::save_transcript_config(&pool, "deepgram", "nova-2-phonecall").await;

        assert!(result.is_err());
    }
}
