use anyhow::Result;
use log::{info, warn};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

const APP_PREFERENCES_STORE: &str = "app_preferences.json";
const APP_PREFERENCES_KEY: &str = "preferences";
const MIN_TRANSCRIPTION_TIMEOUT_SECONDS: u64 = 30;
const MAX_TRANSCRIPTION_TIMEOUT_SECONDS: u64 = 3600;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TranscriptCleanupSettings {
    pub enabled: bool,
    pub remove_fillers: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppPreferences {
    pub auto_export_markdown_on_finalize: bool,
    pub transcript_cleanup: TranscriptCleanupSettings,
    /// Transcription flush timeout in seconds (default: 600)
    /// How long to wait for remaining transcripts after stopping recording
    #[serde(default = "default_transcription_timeout")]
    pub transcription_timeout_seconds: u64,
}

fn default_transcription_timeout() -> u64 {
    600 // 10 minutes default
}

impl Default for AppPreferences {
    fn default() -> Self {
        Self {
            auto_export_markdown_on_finalize: false,
            transcript_cleanup: TranscriptCleanupSettings {
                enabled: true,
                remove_fillers: true,
            },
            transcription_timeout_seconds: default_transcription_timeout(),
        }
    }
}

impl AppPreferences {
    pub fn sanitized(mut self) -> Self {
        let original_timeout = self.transcription_timeout_seconds;
        self.transcription_timeout_seconds = self.transcription_timeout_seconds.clamp(
            MIN_TRANSCRIPTION_TIMEOUT_SECONDS,
            MAX_TRANSCRIPTION_TIMEOUT_SECONDS,
        );

        if self.transcription_timeout_seconds != original_timeout {
            warn!(
                "Clamped transcription timeout from {}s to {}s (allowed range: {}s-{}s)",
                original_timeout,
                self.transcription_timeout_seconds,
                MIN_TRANSCRIPTION_TIMEOUT_SECONDS,
                MAX_TRANSCRIPTION_TIMEOUT_SECONDS
            );
        }

        self
    }
}

pub async fn load_app_preferences<R: Runtime>(app: &AppHandle<R>) -> Result<AppPreferences> {
    let store = match app.store(APP_PREFERENCES_STORE) {
        Ok(store) => store,
        Err(error) => {
            warn!(
                "Failed to access app preferences store: {}. Using defaults.",
                error
            );
            return Ok(AppPreferences::default());
        }
    };

    if let Some(value) = store.get(APP_PREFERENCES_KEY) {
        match serde_json::from_value::<AppPreferences>(value.clone()) {
            Ok(preferences) => Ok(preferences.sanitized()),
            Err(error) => {
                warn!(
                    "Failed to deserialize app preferences: {}. Using defaults.",
                    error
                );
                Ok(AppPreferences::default())
            }
        }
    } else {
        Ok(AppPreferences::default())
    }
}

pub async fn save_app_preferences<R: Runtime>(
    app: &AppHandle<R>,
    preferences: &AppPreferences,
) -> Result<AppPreferences> {
    let sanitized = preferences.clone().sanitized();
    let store = app
        .store(APP_PREFERENCES_STORE)
        .map_err(|e| anyhow::anyhow!("Failed to access app preferences store: {}", e))?;

    let value = serde_json::to_value(&sanitized)
        .map_err(|e| anyhow::anyhow!("Failed to serialize app preferences: {}", e))?;
    store.set(APP_PREFERENCES_KEY, value);
    store
        .save()
        .map_err(|e| anyhow::anyhow!("Failed to persist app preferences: {}", e))?;

    info!(
        "App preferences saved: auto_export_markdown_on_finalize={}, cleanup_enabled={}, remove_fillers={}, transcription_timeout_seconds={}",
        sanitized.auto_export_markdown_on_finalize,
        sanitized.transcript_cleanup.enabled,
        sanitized.transcript_cleanup.remove_fillers,
        sanitized.transcription_timeout_seconds
    );

    Ok(sanitized)
}

#[tauri::command]
pub async fn get_app_preferences<R: Runtime>(app: AppHandle<R>) -> Result<AppPreferences, String> {
    load_app_preferences(&app)
        .await
        .map_err(|e| format!("Failed to load app preferences: {}", e))
}

#[tauri::command]
pub async fn set_app_preferences<R: Runtime>(
    app: AppHandle<R>,
    preferences: AppPreferences,
) -> Result<AppPreferences, String> {
    save_app_preferences(&app, &preferences)
        .await
        .map_err(|e| format!("Failed to save app preferences: {}", e))
}

#[cfg(test)]
mod tests {
    use super::{
        AppPreferences, TranscriptCleanupSettings, MAX_TRANSCRIPTION_TIMEOUT_SECONDS,
        MIN_TRANSCRIPTION_TIMEOUT_SECONDS,
    };

    fn base_preferences(timeout: u64) -> AppPreferences {
        AppPreferences {
            auto_export_markdown_on_finalize: false,
            transcript_cleanup: TranscriptCleanupSettings {
                enabled: true,
                remove_fillers: true,
            },
            transcription_timeout_seconds: timeout,
        }
    }

    #[test]
    fn sanitized_clamps_timeout_to_minimum() {
        let sanitized = base_preferences(0).sanitized();
        assert_eq!(
            sanitized.transcription_timeout_seconds,
            MIN_TRANSCRIPTION_TIMEOUT_SECONDS
        );
    }

    #[test]
    fn sanitized_clamps_timeout_to_maximum() {
        let sanitized = base_preferences(999_999).sanitized();
        assert_eq!(
            sanitized.transcription_timeout_seconds,
            MAX_TRANSCRIPTION_TIMEOUT_SECONDS
        );
    }

    #[test]
    fn sanitized_keeps_timeout_when_in_range() {
        let sanitized = base_preferences(900).sanitized();
        assert_eq!(sanitized.transcription_timeout_seconds, 900);
    }
}
