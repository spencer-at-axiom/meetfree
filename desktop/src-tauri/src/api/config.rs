use crate::{api::api, state::AppState};
use tauri::{AppHandle, Runtime};

#[tauri::command]
pub async fn model_cfg_get<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    auth_token: Option<String>,
) -> Result<Option<api::ModelConfig>, String> {
    api::api_get_model_config(app, state, auth_token).await
}

#[tauri::command]
pub async fn model_cfg_set<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    provider: String,
    model: String,
    whisper_model: String,
    api_key: Option<String>,
    ollama_endpoint: Option<String>,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    api::api_save_model_config(
        app,
        state,
        provider,
        model,
        whisper_model,
        api_key,
        ollama_endpoint,
        auth_token,
    )
    .await
}

#[tauri::command]
pub async fn model_api_key_get<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    provider: String,
    auth_token: Option<String>,
) -> Result<String, String> {
    api::api_get_api_key(app, state, provider, auth_token).await
}

#[tauri::command]
pub async fn transcript_cfg_get<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    auth_token: Option<String>,
) -> Result<Option<api::TranscriptConfig>, String> {
    api::api_get_transcript_config(app, state, auth_token).await
}

#[tauri::command]
pub async fn transcript_cfg_set<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    provider: String,
    model: String,
    api_key: Option<String>,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    api::api_save_transcript_config(app, state, provider, model, api_key, auth_token).await
}

#[tauri::command]
pub async fn transcript_api_key_get<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    provider: String,
    auth_token: Option<String>,
) -> Result<String, String> {
    api::api_get_transcript_api_key(app, state, provider, auth_token).await
}

#[tauri::command]
pub async fn provider_api_key_delete<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    provider: String,
    auth_token: Option<String>,
) -> Result<(), String> {
    api::api_delete_api_key(app, state, provider, auth_token).await
}
