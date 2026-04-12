use serde::Serialize;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;

use crate::context::assemble_meeting_context;
use crate::database::models::{MeetingContextAssetModel, TagModel};
use crate::database::repositories::context_asset::{
    ContextAssetsRepository, NewContextAsset, UpdateContextAsset,
};
use crate::database::repositories::tag::TagsRepository;
use crate::state::AppState;

const MAX_ATTACHMENT_CONTENT_BYTES: usize = 2 * 1024 * 1024;
const MAX_ATTACHMENT_PREVIEW_CHARS: usize = 20_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextAttachmentSelection {
    pub path: String,
    pub filename: String,
    pub title: String,
    pub file_mime_type: Option<String>,
    pub file_size_bytes: i64,
    pub content: Option<String>,
    pub content_was_truncated: bool,
}

fn infer_attachment_mime_type(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_string_lossy().to_lowercase();
    let mime = match extension.as_str() {
        "txt" | "log" => "text/plain",
        "md" | "markdown" => "text/markdown",
        "json" => "application/json",
        "csv" => "text/csv",
        "yaml" | "yml" => "application/yaml",
        "toml" => "application/toml",
        "xml" => "application/xml",
        "html" | "htm" => "text/html",
        "pdf" => "application/pdf",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "doc" => "application/msword",
        "rtf" => "application/rtf",
        _ => return None,
    };

    Some(mime.to_string())
}

fn is_text_attachment(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };

    matches!(
        extension.to_lowercase().as_str(),
        "txt"
            | "log"
            | "md"
            | "markdown"
            | "json"
            | "csv"
            | "yaml"
            | "yml"
            | "toml"
            | "xml"
            | "html"
            | "htm"
    )
}

fn truncate_attachment_preview(content: &str) -> (String, bool) {
    let trimmed = content.trim();
    if trimmed.chars().count() <= MAX_ATTACHMENT_PREVIEW_CHARS {
        return (trimmed.to_string(), false);
    }

    let mut end = 0usize;
    for (count, (idx, ch)) in trimmed.char_indices().enumerate() {
        if count == MAX_ATTACHMENT_PREVIEW_CHARS {
            break;
        }
        end = idx + ch.len_utf8();
    }

    let mut preview = trimmed[..end].trim_end().to_string();
    preview.push_str("\n\n[Truncated preview]");
    (preview, true)
}

fn read_attachment_content(path: &Path) -> Result<(Option<String>, bool), String> {
    if !is_text_attachment(path) {
        return Ok((None, false));
    }

    let file = File::open(path)
        .map_err(|e| format!("Failed to open attachment '{}': {}", path.display(), e))?;
    let mut bytes = Vec::with_capacity(MAX_ATTACHMENT_CONTENT_BYTES.min(8192));
    file.take((MAX_ATTACHMENT_CONTENT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Failed to read attachment '{}': {}", path.display(), e))?;

    let mut truncated = bytes.len() > MAX_ATTACHMENT_CONTENT_BYTES;
    if truncated {
        bytes.truncate(MAX_ATTACHMENT_CONTENT_BYTES);
    }

    if bytes.contains(&0) {
        return Ok((None, truncated));
    }

    let text = match String::from_utf8(bytes) {
        Ok(value) => value,
        Err(_) => return Ok((None, truncated)),
    };

    let (preview, preview_truncated) = truncate_attachment_preview(&text);
    truncated |= preview_truncated;

    Ok((Some(preview), truncated))
}

fn inspect_context_attachment(path: &Path) -> Result<ContextAttachmentSelection, String> {
    let metadata = std::fs::metadata(path).map_err(|e| {
        format!(
            "Failed to read attachment metadata '{}': {}",
            path.display(),
            e
        )
    })?;
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("Attachment path '{}' has no filename", path.display()))?
        .to_string();
    let title = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(&filename)
        .to_string();
    let (content, content_was_truncated) = read_attachment_content(path)?;

    Ok(ContextAttachmentSelection {
        path: path.to_string_lossy().to_string(),
        filename,
        title,
        file_mime_type: infer_attachment_mime_type(path),
        file_size_bytes: metadata.len() as i64,
        content,
        content_was_truncated,
    })
}

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
    let asset = ContextAssetsRepository::create_asset(
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
    .map_err(|e| format!("Failed to create context asset: {}", e))?;

    crate::embeddings::spawn_meeting_embedding_reindex(app, meeting_id);
    Ok(asset)
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
    let meeting_id = ContextAssetsRepository::get_asset(pool, &asset_id)
        .await
        .map_err(|e| format!("Failed to load context asset before update: {}", e))?
        .map(|asset| asset.meeting_id);
    let updated = ContextAssetsRepository::update_asset(
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
    .map_err(|e| format!("Failed to update context asset: {}", e))?;

    if updated {
        if let Some(meeting_id) = meeting_id {
            crate::embeddings::spawn_meeting_embedding_reindex(app, meeting_id);
        }
    }

    Ok(updated)
}

#[tauri::command]
pub async fn context_asset_delete(app: AppHandle, asset_id: String) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();
    let meeting_id = ContextAssetsRepository::get_asset(pool, &asset_id)
        .await
        .map_err(|e| format!("Failed to load context asset before delete: {}", e))?
        .map(|asset| asset.meeting_id);
    let deleted = ContextAssetsRepository::delete_asset(pool, &asset_id)
        .await
        .map_err(|e| format!("Failed to delete context asset: {}", e))?;

    if deleted {
        if let Some(meeting_id) = meeting_id {
            crate::embeddings::spawn_meeting_embedding_reindex(app, meeting_id);
        }
    }

    Ok(deleted)
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
    let scratchpad = ContextAssetsRepository::upsert_scratchpad(pool, &meeting_id, &content)
        .await
        .map_err(|e| format!("Failed to upsert scratchpad: {}", e))?;

    crate::embeddings::spawn_meeting_embedding_reindex(app, meeting_id);
    Ok(scratchpad)
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
    let affected_meeting_ids = TagsRepository::list_meetings_for_tag(pool, &tag_id)
        .await
        .map_err(|e| format!("Failed to load meetings for tag delete: {}", e))?;
    let deleted = TagsRepository::delete_tag(pool, &tag_id)
        .await
        .map_err(|e| format!("Failed to delete tag: {}", e))?;

    if deleted {
        for meeting_id in affected_meeting_ids {
            crate::embeddings::spawn_meeting_embedding_reindex(app.clone(), meeting_id);
        }
    }

    Ok(deleted)
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
        .map_err(|e| format!("Failed to add tag to meeting: {}", e))?;

    crate::embeddings::spawn_meeting_embedding_reindex(app, meeting_id);
    Ok(())
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
        .map_err(|e| format!("Failed to remove tag from meeting: {}", e))?;

    crate::embeddings::spawn_meeting_embedding_reindex(app, meeting_id);
    Ok(())
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

#[tauri::command]
pub async fn select_context_attachment<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<ContextAttachmentSelection>, String> {
    let app_clone = app.clone();
    let file_path =
        tokio::task::spawn_blocking(move || app_clone.dialog().file().blocking_pick_file())
            .await
            .map_err(|e| format!("Attachment dialog task failed: {}", e))?;

    let Some(file_path) = file_path else {
        return Ok(None);
    };

    tokio::task::spawn_blocking(move || {
        inspect_context_attachment(Path::new(&file_path.to_string()))
    })
    .await
    .map_err(|e| format!("Attachment inspection task failed: {}", e))?
    .map(Some)
}

#[cfg(test)]
mod tests {
    use super::{inspect_context_attachment, is_text_attachment};

    #[test]
    fn inspect_context_attachment_loads_text_preview() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("agenda.md");
        std::fs::write(&path, "# Agenda\n- Review roadmap").expect("write attachment");

        let attachment = inspect_context_attachment(&path).expect("inspect attachment");
        assert_eq!(attachment.filename, "agenda.md");
        assert_eq!(attachment.title, "agenda");
        assert_eq!(attachment.file_mime_type.as_deref(), Some("text/markdown"));
        assert_eq!(
            attachment.content.as_deref(),
            Some("# Agenda\n- Review roadmap")
        );
        assert!(!attachment.content_was_truncated);
        assert!(is_text_attachment(&path));
    }

    #[test]
    fn inspect_context_attachment_keeps_binary_as_metadata_only() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("slides.pdf");
        std::fs::write(&path, b"%PDF-1.7 binary").expect("write attachment");

        let attachment = inspect_context_attachment(&path).expect("inspect attachment");
        assert_eq!(attachment.filename, "slides.pdf");
        assert_eq!(
            attachment.file_mime_type.as_deref(),
            Some("application/pdf")
        );
        assert!(attachment.content.is_none());
        assert!(!attachment.content_was_truncated);
        assert!(!is_text_attachment(&path));
    }
}
