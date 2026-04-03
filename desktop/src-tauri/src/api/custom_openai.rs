use crate::{api::api, state::AppState, summary::CustomOpenAIConfig};
use tauri::{AppHandle, Runtime};

#[tauri::command]
pub async fn custom_openai_cfg_set<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    endpoint: String,
    api_key: Option<String>,
    model: String,
    max_tokens: Option<i32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
) -> Result<serde_json::Value, String> {
    api::api_save_custom_openai_config(
        app,
        state,
        endpoint,
        api_key,
        model,
        max_tokens,
        temperature,
        top_p,
    )
    .await
}

#[tauri::command]
pub async fn custom_openai_cfg_get<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
) -> Result<Option<CustomOpenAIConfig>, String> {
    api::api_get_custom_openai_config(app, state).await
}

#[tauri::command]
pub async fn custom_openai_conn_test<R: Runtime>(
    app: AppHandle<R>,
    endpoint: String,
    api_key: Option<String>,
    model: String,
) -> Result<serde_json::Value, String> {
    api::api_test_custom_openai_connection(app, endpoint, api_key, model).await
}
