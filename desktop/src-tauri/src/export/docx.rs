// DOCX export implementation using docx-rs crate (bokuweb)
// Generates professional Word documents with proper formatting and metadata

use std::path::PathBuf;

use docx_rs::*;
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

use super::common::*;

#[derive(Debug, Serialize)]
pub struct MeetingDocxExportResult {
    pub meeting_id: String,
    pub output_path: Option<String>,
    pub wrote_file: bool,
    pub docx_preview: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MeetingBatchExportResult {
    pub meeting_id: String,
    pub output_path: Option<String>,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MeetingBatchExportResponse {
    pub results: Vec<MeetingBatchExportResult>,
}

/// Build a professional DOCX document from export context
pub fn build_docx_document(context: &ExportContext) -> Result<Vec<u8>, String> {
    let mut docx = Docx::new();

    // Title
    docx = docx.add_paragraph(
        Paragraph::new().add_run(Run::new().add_text(&context.meeting.title).size(32).bold()),
    );

    // Metadata
    let mut metadata_items = vec![
        format!("Date: {}", context.meeting.created_at),
        format!("Duration: {}", format_duration(context.meeting.duration_seconds)),
        format!("Source: {}", context.meeting.source_type),
        format!(
            "Language: {}",
            context.meeting.language.as_deref().unwrap_or("unknown")
        ),
        format!("Transcript segments: {}", context.transcript_rows.len()),
    ];

    if let Some(status) = &context.meeting.diarization_status {
        if status == "completed" && !context.speaker_turns.is_empty() {
            let unique_speakers: std::collections::HashSet<_> =
                context.speaker_turns.iter().map(|turn| turn.speaker_number).collect();
            metadata_items.push(format!("Speakers identified: {}", unique_speakers.len()));
        }
    }

    metadata_items.push(format!("Exported: {}", chrono::Utc::now().to_rfc3339()));

    for text in metadata_items {
        docx = docx.add_paragraph(Paragraph::new().add_run(Run::new().add_text(text)));
    }

    docx = docx.add_paragraph(Paragraph::new());

    // Summary section
    if !context.summary_markdown.is_empty() {
        docx = docx.add_paragraph(
            Paragraph::new().add_run(Run::new().add_text("Summary").size(28).bold()),
        );

        let (summary, action_items, decisions) = split_summary_sections(&context.summary_markdown);

        if !summary.is_empty() {
            let summary_clean = clean_markdown_text(&summary);
            docx =
                docx.add_paragraph(Paragraph::new().add_run(Run::new().add_text(summary_clean)));
        }

        if !action_items.is_empty() {
            docx = docx.add_paragraph(Paragraph::new());
            docx = docx.add_paragraph(
                Paragraph::new().add_run(Run::new().add_text("Action Items").size(24).bold()),
            );
            let items_clean = clean_markdown_text(&action_items);
            for line in items_clean.lines() {
                if !line.trim().is_empty() {
                    docx = docx.add_paragraph(
                        Paragraph::new().add_run(Run::new().add_text(format!("- {}", line))),
                    );
                }
            }
        }

        if !decisions.is_empty() {
            docx = docx.add_paragraph(Paragraph::new());
            docx = docx.add_paragraph(
                Paragraph::new().add_run(Run::new().add_text("Key Decisions").size(24).bold()),
            );
            let decisions_clean = clean_markdown_text(&decisions);
            for line in decisions_clean.lines() {
                if !line.trim().is_empty() {
                    docx = docx.add_paragraph(
                        Paragraph::new().add_run(Run::new().add_text(format!("- {}", line))),
                    );
                }
            }
        }
    } else {
        docx = docx
            .add_paragraph(Paragraph::new().add_run(Run::new().add_text("No summary available.")));
    }

    docx = docx.add_paragraph(Paragraph::new());

    // Full transcript section
    if !context.transcript_rows.is_empty() {
        docx = docx.add_paragraph(
            Paragraph::new().add_run(Run::new().add_text("Full Transcript").size(28).bold()),
        );
        docx = docx.add_paragraph(Paragraph::new());

        let transcript_lines = format_transcript_with_speakers(
            &context.transcript_rows,
            &context.speaker_turns,
            &context.vocabulary_rules,
        );

        for line in transcript_lines.iter().take(200) {
            let clean_line = line.replace("- **", "").replace("**", "");
            docx = docx.add_paragraph(Paragraph::new().add_run(Run::new().add_text(clean_line)));
        }

        if transcript_lines.len() > 200 {
            docx = docx.add_paragraph(Paragraph::new().add_run(Run::new().add_text(format!(
                "... and {} more segments (truncated for DOCX)",
                transcript_lines.len() - 200
            ))));
        }
    }

    // Footer
    docx = docx.add_paragraph(Paragraph::new());
    docx = docx.add_paragraph(
        Paragraph::new()
            .add_run(Run::new().add_text("Document Information").size(28).bold()),
    );
    docx = docx.add_paragraph(Paragraph::new());

    let footer_lines = vec![
        format!("Meeting ID: {}", context.meeting.id),
        format!("Generated by: MeetFree v{}", env!("CARGO_PKG_VERSION")),
        "This document contains the meeting transcript with applied vocabulary corrections."
            .to_string(),
    ];

    for line in footer_lines {
        docx = docx.add_paragraph(Paragraph::new().add_run(Run::new().add_text(line)));
    }

    let mut buf = Vec::new();
    docx.build()
        .pack(&mut std::io::Cursor::new(&mut buf))
        .map_err(|e| format!("Failed to build DOCX: {}", e))?;

    Ok(buf)
}

/// Export a single meeting as DOCX
#[tauri::command]
pub async fn meeting_export_docx<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, crate::state::AppState>,
    meeting_id: String,
    destination_root: Option<String>,
    preview: Option<bool>,
) -> Result<MeetingDocxExportResult, String> {
    export_meeting_docx(
        &app,
        state.db_manager.pool(),
        &meeting_id,
        destination_root,
        preview.unwrap_or(false),
    )
    .await
}

pub async fn export_meeting_docx<R: Runtime>(
    app: &AppHandle<R>,
    pool: &sqlx::SqlitePool,
    meeting_id: &str,
    destination_root: Option<String>,
    preview_mode: bool,
) -> Result<MeetingDocxExportResult, String> {
    let context = collect_export_context(pool, meeting_id).await?;
    let docx_bytes = build_docx_document(&context)?;

    if preview_mode {
        return Ok(MeetingDocxExportResult {
            meeting_id: meeting_id.to_string(),
            output_path: None,
            wrote_file: false,
            docx_preview: Some(format!(
                "DOCX generated successfully ({} bytes)",
                docx_bytes.len()
            )),
        });
    }

    let destination_dir = resolve_single_destination_dir(app, &context.meeting, destination_root)?;
    let output_path =
        write_export_file_with_collision(&destination_dir, &context.meeting.title, "docx", &docx_bytes)
            .await
            .map_err(|e| format!("Failed to write DOCX export: {}", e))?;

    persist_export_path(pool, meeting_id, "docx_export_path", &output_path).await?;

    Ok(MeetingDocxExportResult {
        meeting_id: meeting_id.to_string(),
        output_path: Some(output_path.to_string_lossy().to_string()),
        wrote_file: true,
        docx_preview: None,
    })
}

/// Batch export meetings as DOCX
#[tauri::command]
pub async fn meetings_export_docx_batch<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, crate::state::AppState>,
    meeting_ids: Vec<String>,
    destination_root: String,
    preview: Option<bool>,
) -> Result<MeetingBatchExportResponse, String> {
    if meeting_ids.is_empty() {
        return Ok(MeetingBatchExportResponse {
            results: Vec::new(),
        });
    }

    let pool = state.db_manager.pool();
    let root = std::path::PathBuf::from(destination_root);
    if !root.exists() {
        tokio::fs::create_dir_all(&root)
            .await
            .map_err(|e| format!("Failed to create destination root: {}", e))?;
    }

    let preview_mode = preview.unwrap_or(false);
    let mut results = Vec::with_capacity(meeting_ids.len());

    for meeting_id in meeting_ids {
        let export_result =
            export_single_batch_meeting_docx(pool, &meeting_id, &root, preview_mode).await;
        results.push(export_result);
    }

    Ok(MeetingBatchExportResponse { results })
}

async fn export_single_batch_meeting_docx(
    pool: &sqlx::SqlitePool,
    meeting_id: &str,
    root: &std::path::Path,
    preview_mode: bool,
) -> MeetingBatchExportResult {
    let result = async {
        let context = collect_export_context(pool, meeting_id).await?;
        let docx_bytes = build_docx_document(&context)?;

        if preview_mode {
            return Ok::<Option<PathBuf>, String>(None);
        }

        let subfolder = root.join(format!(
            "{}-{}",
            sanitize_filename(&context.meeting.title),
            &context.meeting.id
        ));
        let output_path =
            write_export_file_with_collision(&subfolder, &context.meeting.title, "docx", &docx_bytes)
                .await
                .map_err(|e| format!("Failed to write DOCX export: {}", e))?;

        persist_export_path(pool, meeting_id, "docx_export_path", &output_path).await?;

        Ok(Some(output_path))
    }
    .await;

    match result {
        Ok(path) => MeetingBatchExportResult {
            meeting_id: meeting_id.to_string(),
            output_path: path.map(|p| p.to_string_lossy().to_string()),
            success: true,
            error: None,
        },
        Err(error) => MeetingBatchExportResult {
            meeting_id: meeting_id.to_string(),
            output_path: None,
            success: false,
            error: Some(error),
        },
    }
}

fn resolve_single_destination_dir<R: Runtime>(
    app: &AppHandle<R>,
    meeting: &MeetingExportData,
    destination_root: Option<String>,
) -> Result<std::path::PathBuf, String> {
    if let Some(root) = destination_root {
        return Ok(std::path::PathBuf::from(root));
    }

    if let Some(folder_path) = &meeting.folder_path {
        return Ok(std::path::PathBuf::from(folder_path));
    }

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    Ok(app_data.join("exports").join(&meeting.id))
}

fn format_duration(seconds: Option<f64>) -> String {
    match seconds {
        Some(s) => {
            let hours = (s / 3600.0).floor() as u32;
            let minutes = ((s % 3600.0) / 60.0).floor() as u32;
            let secs = (s % 60.0).floor() as u32;
            format!("{:02}:{:02}:{:02}", hours, minutes, secs)
        }
        None => "unknown".to_string(),
    }
}

fn clean_markdown_text(text: &str) -> String {
    text.replace("## ", "")
        .replace("# ", "")
        .replace("**", "")
        .replace("*", "")
        .trim()
        .to_string()
}

fn split_summary_sections(summary_markdown: &str) -> (String, String, String) {
    let trimmed = summary_markdown.trim();
    if trimmed.is_empty() {
        return (String::new(), String::new(), String::new());
    }

    let mut action_items = String::new();
    let mut decisions = String::new();
    let mut summary_lines = Vec::<String>::new();
    let mut current_section = "summary";

    for line in trimmed.lines() {
        let heading = parse_markdown_heading(line);
        if let Some(heading_text) = heading {
            let normalized = normalize_heading(&heading_text);
            if normalized.contains("action item") {
                current_section = "action";
                continue;
            }
            if normalized == "decisions"
                || normalized == "key decisions"
                || normalized.contains(" decision")
            {
                current_section = "decisions";
                continue;
            }
            current_section = "summary";
            summary_lines.push(line.to_string());
            continue;
        }

        match current_section {
            "action" => {
                if !action_items.is_empty() {
                    action_items.push('\n');
                }
                action_items.push_str(line);
            }
            "decisions" => {
                if !decisions.is_empty() {
                    decisions.push('\n');
                }
                decisions.push_str(line);
            }
            _ => summary_lines.push(line.to_string()),
        }
    }

    if action_items.trim().is_empty() && decisions.trim().is_empty() {
        return (trimmed.to_string(), String::new(), String::new());
    }

    (
        summary_lines.join("\n").trim().to_string(),
        action_items.trim().to_string(),
        decisions.trim().to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_duration_calculates_correctly() {
        assert_eq!(format_duration(Some(3665.0)), "01:01:05");
        assert_eq!(format_duration(Some(60.0)), "00:01:00");
        assert_eq!(format_duration(Some(3600.0)), "01:00:00");
        assert_eq!(format_duration(None), "unknown");
    }

    #[test]
    fn clean_markdown_removes_formatting() {
        assert_eq!(clean_markdown_text("## Title"), "Title");
        assert_eq!(clean_markdown_text("**bold** text"), "bold text");
    }
}
