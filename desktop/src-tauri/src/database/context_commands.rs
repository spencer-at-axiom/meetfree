use tauri::{AppHandle, Manager};

use crate::context::assemble_meeting_context;
use crate::database::models::{MeetingContextAssetModel, TagModel};
use crate::database::repositories::context_asset::{
    ContextAssetsRepository, NewContextAsset, UpdateContextAsset,
};
use crate::database::repositories::tag::TagsRepository;
use crate::state::AppState;

#[tauri::command]
pub async fn context_asset_create(
    app: AppHandle,
    meeting_id: String,
    asset_type: String,
    title: Option<String>,
    content: Option<String>,
    file_path: Option<String>,
    file_mime_type: Option<String>,
    file_size_bytes: Option<i64>,
) -> Result<MeetingContextAssetModel, String> {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();
    ContextAssetsRepository::create_asset(
        pool,
        &meeting_id,
        NewContextAsset {
            asset_type,
            title,
            content,
            file_path,
            file_mime_type,
            file_size_bytes,
            metadata: None,
            sort_order: 0,
        },
    )
    .await
    .map_err(|e| format!("Failed to create context asset: {}", e))
}

#[tauri::command]
pub async fn context_asset_list(
    app: AppHandle,
    meeting_id: String,
) -> Result<Vec<MeetingContextAssetModel>, String> {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();
    ContextAssetsRepository::list_assets(pool, &meeting_id)
        .await
        .map_err(|e| format!("Failed to list context assets: {}", e))
}

#[tauri::command]
pub async fn context_asset_update(
    app: AppHandle,
    asset_id: String,
    title: Option<String>,
    content: Option<String>,
) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();
    ContextAssetsRepository::update_asset(
        pool,
        &asset_id,
        UpdateContextAsset {
            title: title.map(Some),
            content: content.map(Some),
            metadata: None,
            sort_order: None,
        },
    )
    .await
    .map_err(|e| format!("Failed to update context asset: {}", e))
}

#[tauri::command]
pub async fn context_asset_delete(app: AppHandle, asset_id: String) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();
    ContextAssetsRepository::delete_asset(pool, &asset_id)
        .await
        .map_err(|e| format!("Failed to delete context asset: {}", e))
}

#[tauri::command]
pub async fn scratchpad_get(
    app: AppHandle,
    meeting_id: String,
) -> Result<Option<MeetingContextAssetModel>, String> {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();
    ContextAssetsRepository::get_scratchpad(pool, &meeting_id)
        .await
        .map_err(|e| format!("Failed to get scratchpad: {}", e))
}

#[tauri::command]
pub async fn scratchpad_upsert(
    app: AppHandle,
    meeting_id: String,
    content: String,
) -> Result<MeetingContextAssetModel, String> {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();
    ContextAssetsRepository::upsert_scratchpad(pool, &meeting_id, &content)
        .await
        .map_err(|e| format!("Failed to upsert scratchpad: {}", e))
}

#[tauri::command]
pub async fn tag_create(
    app: AppHandle,
    name: String,
    color: Option<String>,
) -> Result<TagModel, String> {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();
    TagsRepository::create_tag(pool, &name, color.as_deref())
        .await
        .map_err(|e| format!("Failed to create tag: {}", e))
}

#[tauri::command]
pub async fn tag_list(app: AppHandle) -> Result<Vec<TagModel>, String> {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();
    TagsRepository::list_tags(pool)
        .await
        .map_err(|e| format!("Failed to list tags: {}", e))
}

#[tauri::command]
pub async fn tag_delete(app: AppHandle, tag_id: String) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();
    TagsRepository::delete_tag(pool, &tag_id)
        .await
        .map_err(|e| format!("Failed to delete tag: {}", e))
}

#[tauri::command]
pub async fn meeting_tag_add(
    app: AppHandle,
    meeting_id: String,
    tag_id: String,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();
    TagsRepository::tag_meeting(pool, &meeting_id, &tag_id)
        .await
        .map_err(|e| format!("Failed to add tag to meeting: {}", e))
}

#[tauri::command]
pub async fn meeting_tag_remove(
    app: AppHandle,
    meeting_id: String,
    tag_id: String,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();
    TagsRepository::untag_meeting(pool, &meeting_id, &tag_id)
        .await
        .map_err(|e| format!("Failed to remove tag from meeting: {}", e))
}

#[tauri::command]
pub async fn meeting_tags_list(
    app: AppHandle,
    meeting_id: String,
) -> Result<Vec<TagModel>, String> {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();
    TagsRepository::list_meeting_tags(pool, &meeting_id)
        .await
        .map_err(|e| format!("Failed to list meeting tags: {}", e))
}

#[tauri::command]
pub async fn meeting_context_get(
    app: AppHandle,
    meeting_id: String,
) -> Result<serde_json::Value, String> {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();
    let package = assemble_meeting_context(pool, &meeting_id)
        .await
        .map_err(|e| format!("Failed to assemble meeting context: {}", e))?;
    serde_json::to_value(package).map_err(|e| format!("Failed to serialize meeting context: {}", e))
}
