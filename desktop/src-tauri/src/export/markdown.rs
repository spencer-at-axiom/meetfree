// Markdown export implementation
// Refactored to use shared common.rs utilities

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};
use tokio::fs;

use super::common::*;

#[derive(Debug, Serialize)]
pub struct MeetingMarkdownExportResult {
    pub meeting_id: String,
    pub output_path: Option<String>,
    pub wrote_file: bool,
    pub markdown_preview: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MeetingMarkdownBatchExportResult {
    pub meeting_id: String,
    pub output_path: Option<String>,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MeetingsMarkdownBatchExportResponse {
    pub results: Vec<MeetingMarkdownBatchExportResult>,
}

#[tauri::command]
pub async fn meeting_export_markdown<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, crate::state::AppState>,
    meeting_id: String,
    destination_root: Option<String>,
    preview: Option<bool>,
) -> Result<MeetingMarkdownExportResult, String> {
    export_meeting_markdown(
        &app,
        state.db_manager.pool(),
        &meeting_id,
        destination_root,
        preview.unwrap_or(false),
    )
    .await
}

pub async fn export_meeting_markdown<R: Runtime>(
    app: &AppHandle<R>,
    pool: &sqlx::SqlitePool,
    meeting_id: &str,
    destination_root: Option<String>,
    preview_mode: bool,
) -> Result<MeetingMarkdownExportResult, String> {
    let context = collect_export_context(pool, meeting_id).await?;
    let rendered_markdown = render_meeting_markdown(&context);

    if preview_mode {
        return Ok(MeetingMarkdownExportResult {
            meeting_id: meeting_id.to_string(),
            output_path: None,
            wrote_file: false,
            markdown_preview: Some(rendered_markdown),
        });
    }

    let destination_dir = resolve_single_destination_dir(app, &context.meeting, destination_root)?;
    let output_path = write_export_file_with_collision(
        &destination_dir,
        &context.meeting.title,
        "md",
        rendered_markdown.as_bytes(),
    )
    .await
    .map_err(|e| format!("Failed to write markdown export: {}", e))?;

    persist_export_path(pool, meeting_id, "markdown_export_path", &output_path).await?;

    Ok(MeetingMarkdownExportResult {
        meeting_id: meeting_id.to_string(),
        output_path: Some(output_path.to_string_lossy().to_string()),
        wrote_file: true,
        markdown_preview: None,
    })
}

#[tauri::command]
pub async fn meetings_export_markdown_batch<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, crate::state::AppState>,
    meeting_ids: Vec<String>,
    destination_root: String,
    preview: Option<bool>,
) -> Result<MeetingsMarkdownBatchExportResponse, String> {
    if meeting_ids.is_empty() {
        return Ok(MeetingsMarkdownBatchExportResponse {
            results: Vec::new(),
        });
    }

    let pool = state.db_manager.pool();
    let root = PathBuf::from(destination_root);
    if !root.exists() {
        fs::create_dir_all(&root)
            .await
            .map_err(|e| format!("Failed to create destination root: {}", e))?;
    }

    let preview_mode = preview.unwrap_or(false);
    let mut results = Vec::with_capacity(meeting_ids.len());

    for meeting_id in meeting_ids {
        let export_result =
            export_single_batch_meeting(pool, &meeting_id, &root, preview_mode).await;
        results.push(export_result);
    }

    Ok(MeetingsMarkdownBatchExportResponse { results })
}

async fn export_single_batch_meeting(
    pool: &sqlx::SqlitePool,
    meeting_id: &str,
    root: &std::path::Path,
    preview_mode: bool,
) -> MeetingMarkdownBatchExportResult {
    let result = async {
        let context = collect_export_context(pool, meeting_id).await?;
        let rendered_markdown = render_meeting_markdown(&context);

        if preview_mode {
            return Ok::<Option<PathBuf>, String>(None);
        }

        let subfolder = root.join(format!(
            "{}-{}",
            sanitize_filename(&context.meeting.title),
            &context.meeting.id
        ));
        let output_path = write_export_file_with_collision(
            &subfolder,
            &context.meeting.title,
            "md",
            rendered_markdown.as_bytes(),
        )
        .await
        .map_err(|e| format!("Failed to write markdown export: {}", e))?;

        persist_export_path(pool, meeting_id, "markdown_export_path", &output_path).await?;

        Ok(Some(output_path))
    }
    .await;

    match result {
        Ok(path) => MeetingMarkdownBatchExportResult {
            meeting_id: meeting_id.to_string(),
            output_path: path.map(|p| p.to_string_lossy().to_string()),
            success: true,
            error: None,
        },
        Err(error) => MeetingMarkdownBatchExportResult {
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

pub fn render_meeting_markdown(ctx: &ExportContext) -> String {
    let meeting = &ctx.meeting;
    let (summary_section, fallback_action_items, fallback_decisions) =
        split_summary_markdown_sections(&ctx.summary_markdown);
    let action_items_section = if ctx.action_items.is_empty() {
        fallback_action_items
    } else {
        render_action_items_markdown(&ctx.action_items)
    };
    let decisions_section = if ctx.decisions.is_empty() {
        fallback_decisions
    } else {
        render_decisions_markdown(&ctx.decisions)
    };

    let transcript_lines = if ctx.transcript_rows.is_empty() {
        vec!["_No transcript available._".to_string()]
    } else {
        format_transcript_with_speakers(
            &ctx.transcript_rows,
            &ctx.speaker_turns,
            &ctx.vocabulary_rules,
        )
    };

    let transcript_markdown = transcript_lines.join("\n");

    let mut output = String::new();
    output.push_str("---\n");
    output.push_str(&format!("id: {}\n", yaml_quote(&meeting.id)));
    output.push_str(&format!("title: {}\n", yaml_quote(&meeting.title)));
    output.push_str(&format!(
        "created_at: {}\n",
        yaml_quote(&meeting.created_at)
    ));
    output.push_str(&format!(
        "updated_at: {}\n",
        yaml_quote(&meeting.updated_at)
    ));
    output.push_str(&format!(
        "source_type: {}\n",
        yaml_quote(&meeting.source_type)
    ));
    output.push_str(&format!(
        "language: {}\n",
        meeting
            .language
            .as_ref()
            .map(|language| yaml_quote(language))
            .unwrap_or_else(|| "null".to_string())
    ));
    output.push_str(&format!(
        "duration_seconds: {}\n",
        meeting
            .duration_seconds
            .map(|seconds| format!("{:.3}", seconds))
            .unwrap_or_else(|| "null".to_string())
    ));
    output.push_str(&format!(
        "transcript_count: {}\n",
        ctx.transcript_rows.len()
    ));

    if let Some(status) = &meeting.diarization_status {
        output.push_str(&format!("diarization_status: {}\n", yaml_quote(status)));
        if status == "completed" && !ctx.speaker_turns.is_empty() {
            let unique_speakers: std::collections::HashSet<_> =
                ctx.speaker_turns.iter().map(|t| t.speaker_number).collect();
            output.push_str(&format!("speaker_count: {}\n", unique_speakers.len()));
        }
    }

    if !ctx.tags.is_empty() {
        output.push_str("tags:\n");
        for tag in &ctx.tags {
            output.push_str(&format!("  - {}\n", yaml_quote(tag)));
        }
    }

    output.push_str(&format!(
        "exported_at: {}\n",
        yaml_quote(&chrono::Utc::now().to_rfc3339())
    ));
    output.push_str("---\n\n");

    output.push_str("## Summary\n\n");
    output.push_str(&empty_section_fallback(
        &summary_section,
        "_No summary available._",
    ));
    output.push_str("\n\n## Action Items\n\n");
    output.push_str(&empty_section_fallback(
        &action_items_section,
        "_No action items captured._",
    ));
    output.push_str("\n\n## Decisions\n\n");
    output.push_str(&empty_section_fallback(
        &decisions_section,
        "_No decisions captured._",
    ));

    if let Some(ref scratchpad) = ctx.scratchpad {
        output.push_str("\n\n## Meeting Notes\n\n");
        output.push_str(scratchpad.trim());
        output.push('\n');
    }

    output.push_str("\n\n## Transcript\n\n");
    output.push_str(&transcript_markdown);
    output.push('\n');
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::repositories::vocabulary::VocabularyRule;

    #[test]
    fn split_summary_sections_extracts_headings() {
        let input = r#"
## Summary
Status update
## Action Items
- Send notes
## Key Decisions
- Ship on Friday
"#;

        let (summary, actions, decisions) = split_summary_markdown_sections(input);
        assert!(summary.contains("Status update"));
        assert_eq!(actions.trim(), "- Send notes");
        assert_eq!(decisions.trim(), "- Ship on Friday");
    }

    fn test_export_context(
        meeting: MeetingExportData,
        summary: &str,
        transcript_rows: Vec<TranscriptExportRow>,
        speaker_turns: Vec<SpeakerTurnExportRow>,
        action_items: Vec<ActionItemExportRow>,
        decisions: Vec<DecisionExportRow>,
        vocabulary_rules: Vec<VocabularyRule>,
    ) -> ExportContext {
        ExportContext {
            meeting,
            summary_markdown: summary.to_string(),
            transcript_rows,
            speaker_turns,
            action_items,
            decisions,
            vocabulary_rules,
            scratchpad: None,
            tags: vec![],
        }
    }

    #[test]
    fn render_meeting_markdown_includes_all_sections_and_vocabulary() {
        let meeting = MeetingExportData {
            id: "meeting-1".to_string(),
            title: "Weekly Sync".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            folder_path: None,
            source_type: "recorded".to_string(),
            language: Some("en".to_string()),
            duration_seconds: Some(123.0),
            diarization_status: None,
        };

        let transcript_rows = vec![TranscriptExportRow {
            id: "t1".to_string(),
            timestamp: "2026-01-01T00:01:00Z".to_string(),
            text: "open ai roadmap".to_string(),
            audio_start_time: 0.0,
            audio_end_time: 1000.0,
        }];

        let rules = vec![VocabularyRule {
            source_text: "open ai".to_string(),
            target_text: "OpenAI".to_string(),
            case_sensitive: false,
        }];

        let ctx = test_export_context(
            meeting,
            "## Action Items\n- Follow up",
            transcript_rows,
            vec![],
            vec![],
            vec![],
            rules,
        );

        let rendered = render_meeting_markdown(&ctx);

        assert!(rendered.contains("## Summary"));
        assert!(rendered.contains("## Action Items"));
        assert!(rendered.contains("## Decisions"));
        assert!(rendered.contains("## Transcript"));
        assert!(rendered.contains("OpenAI roadmap"));
        assert!(rendered.contains("- Follow up"));
        assert!(rendered.contains("_No decisions captured._"));
    }

    #[test]
    fn render_meeting_markdown_prefers_structured_entities() {
        let meeting = MeetingExportData {
            id: "meeting-2".to_string(),
            title: "Product Review".to_string(),
            created_at: "2026-01-02T00:00:00Z".to_string(),
            updated_at: "2026-01-02T00:00:00Z".to_string(),
            folder_path: None,
            source_type: "recorded".to_string(),
            language: Some("en".to_string()),
            duration_seconds: Some(60.0),
            diarization_status: None,
        };

        let ctx = test_export_context(
            meeting,
            "## Action Items\n- Legacy fallback\n## Decisions\n- Legacy decision",
            vec![],
            vec![],
            vec![ActionItemExportRow {
                title: "Structured follow up".to_string(),
                owner_display_name: Some("Alex".to_string()),
                due_date: Some("2026-01-05".to_string()),
                status: "open".to_string(),
                source_excerpt: None,
            }],
            vec![DecisionExportRow {
                title: "Use structured export".to_string(),
                source_excerpt: None,
            }],
            vec![],
        );

        let rendered = render_meeting_markdown(&ctx);

        assert!(rendered.contains("Structured follow up"));
        assert!(rendered.contains("[owner:: Alex]"));
        assert!(rendered.contains("Use structured export"));
        assert!(!rendered.contains("Legacy fallback"));
        assert!(!rendered.contains("Legacy decision"));
    }

    #[test]
    fn render_meeting_markdown_includes_tags_and_scratchpad() {
        let meeting = MeetingExportData {
            id: "meeting-3".to_string(),
            title: "Tagged Meeting".to_string(),
            created_at: "2026-01-03T00:00:00Z".to_string(),
            updated_at: "2026-01-03T00:00:00Z".to_string(),
            folder_path: None,
            source_type: "recorded".to_string(),
            language: None,
            duration_seconds: None,
            diarization_status: None,
        };

        let mut ctx = test_export_context(meeting, "", vec![], vec![], vec![], vec![], vec![]);
        ctx.tags = vec!["sprint-planning".to_string(), "engineering".to_string()];
        ctx.scratchpad = Some("Ask about Q3 budget".to_string());

        let rendered = render_meeting_markdown(&ctx);

        assert!(rendered.contains("tags:"));
        assert!(rendered.contains("sprint-planning"));
        assert!(rendered.contains("engineering"));
        assert!(rendered.contains("## Meeting Notes"));
        assert!(rendered.contains("Ask about Q3 budget"));
    }
}
