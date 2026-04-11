// Shared export utilities and data collection
// This module contains common functionality reused across all export formats (Markdown, PDF, DOCX)

use std::path::{Path, PathBuf};
use crate::database::repositories::vocabulary::VocabularyRule;

/// Complete context for rendering an export - all data needed for any format
#[derive(Debug, Clone)]
pub struct ExportContext {
    pub meeting: MeetingExportData,
    pub transcript_rows: Vec<TranscriptExportRow>,
    pub speaker_turns: Vec<SpeakerTurnExportRow>,
    pub summary_markdown: String,
    pub vocabulary_rules: Vec<VocabularyRule>,
}

#[derive(Debug, Clone)]
pub struct MeetingExportData {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub folder_path: Option<String>,
    pub source_type: String,
    pub language: Option<String>,
    pub duration_seconds: Option<f64>,
    pub diarization_status: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TranscriptExportRow {
    pub id: String,
    pub timestamp: String,
    pub text: String,
    pub audio_start_time: f64,
    pub audio_end_time: f64,
}

#[derive(Debug, Clone)]
pub struct SpeakerTurnExportRow {
    pub speaker_number: i32,
    pub speaker_name: Option<String>,
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub confidence: f64,
}

/// Fetch all data needed for export rendering
pub async fn collect_export_context(
    pool: &sqlx::SqlitePool,
    meeting_id: &str,
) -> Result<ExportContext, String> {
    let meeting = fetch_meeting_export_data(pool, meeting_id)
        .await?
        .ok_or_else(|| format!("Meeting not found: {}", meeting_id))?;

    let summary_markdown = fetch_summary_markdown(pool, meeting_id).await?;
    let transcript_rows = fetch_transcript_rows(pool, meeting_id).await?;
    let speaker_turns = fetch_speaker_turns(pool, meeting_id).await?;
    let vocabulary_rules =
        crate::vocabulary::get_effective_rules_for_meeting(pool, Some(meeting_id)).await?;

    Ok(ExportContext {
        meeting,
        transcript_rows,
        speaker_turns,
        summary_markdown,
        vocabulary_rules,
    })
}

pub async fn fetch_meeting_export_data(
    pool: &sqlx::SqlitePool,
    meeting_id: &str,
) -> Result<Option<MeetingExportData>, String> {
    let row = sqlx::query_as::<_, (String, String, String, String, Option<String>, String, Option<String>, Option<f64>, Option<String>)>(
        "SELECT id, title, created_at, updated_at, folder_path, source_type, language, duration_seconds, diarization_status
         FROM meetings
         WHERE id = ?",
    )
    .bind(meeting_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to fetch meeting metadata: {}", e))?;

    Ok(row.map(
        |(
            id,
            title,
            created_at,
            updated_at,
            folder_path,
            source_type,
            language,
            duration_seconds,
            diarization_status,
        )| {
            MeetingExportData {
                id,
                title,
                created_at,
                updated_at,
                folder_path,
                source_type,
                language,
                duration_seconds,
                diarization_status,
            }
        },
    ))
}

pub async fn fetch_transcript_rows(
    pool: &sqlx::SqlitePool,
    meeting_id: &str,
) -> Result<Vec<TranscriptExportRow>, String> {
    let rows = sqlx::query_as::<_, (String, String, String, f64, f64)>(
        "SELECT id, timestamp, transcript, audio_start_time, audio_end_time
         FROM transcripts
         WHERE meeting_id = ?
         ORDER BY audio_start_time ASC, timestamp ASC",
    )
    .bind(meeting_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to fetch transcripts for export: {}", e))?;

    Ok(rows
        .into_iter()
        .map(|(id, timestamp, text, audio_start_time, audio_end_time)| TranscriptExportRow { 
            id,
            timestamp, 
            text,
            audio_start_time,
            audio_end_time,
        })
        .collect())
}

/// Fetch speaker turns for diarized meetings
pub async fn fetch_speaker_turns(
    pool: &sqlx::SqlitePool,
    meeting_id: &str,
) -> Result<Vec<SpeakerTurnExportRow>, String> {
    let rows = sqlx::query_as::<_, (i32, Option<String>, i64, i64, String, f64)>(
        "SELECT speaker_number, speaker_name, start_ms, end_ms, text, confidence
         FROM speaker_turns
         WHERE meeting_id = ?
         ORDER BY start_ms ASC",
    )
    .bind(meeting_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to fetch speaker turns for export: {}", e))?;

    Ok(rows
        .into_iter()
        .map(|(speaker_number, speaker_name, start_ms, end_ms, text, confidence)| {
            SpeakerTurnExportRow {
                speaker_number,
                speaker_name,
                start_ms,
                end_ms,
                text,
                confidence,
            }
        })
        .collect())
}

pub async fn fetch_summary_markdown(
    pool: &sqlx::SqlitePool,
    meeting_id: &str,
) -> Result<String, String> {
    let row = sqlx::query_as::<_, (Option<String>,)>(
        "SELECT result
         FROM summary_processes
         WHERE meeting_id = ?
         ORDER BY updated_at DESC
         LIMIT 1",
    )
    .bind(meeting_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to fetch summary for export: {}", e))?;

    let Some((raw_result,)) = row else {
        return Ok(String::new());
    };

    let Some(raw_result) = raw_result else {
        return Ok(String::new());
    };

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw_result) {
        if let Ok(payload) = crate::summary::contract::migrate_legacy_summary_payload(&value) {
            return Ok(payload.markdown().trim().to_string());
        }

        if let Some(markdown) = value.get("markdown").and_then(|item| item.as_str()) {
            return Ok(markdown.trim().to_string());
        }
    }

    Ok(raw_result.trim().to_string())
}

/// Sanitize filename for filesystem use
pub fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

/// Quote a string for YAML frontmatter
pub fn yaml_quote(value: &str) -> String {
    if value.contains('\n') || value.contains('"') || value.contains(':') {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        value.to_string()
    }
}

/// Write a file with collision avoidance (create .md, .md-1, .md-2, etc.)
pub async fn write_export_file_with_collision(
    destination_dir: &Path,
    base_name: &str,
    extension: &str,
    content: &[u8],
) -> Result<PathBuf, std::io::Error> {
    tokio::fs::create_dir_all(destination_dir).await?;

    let sanitized = if base_name.trim().is_empty() {
        "export".to_string()
    } else {
        sanitize_filename(base_name)
    };

    let mut candidate = destination_dir.join(format!("{}.{}", sanitized, extension));
    let mut counter = 1usize;
    while candidate.exists() {
        candidate = destination_dir.join(format!("{}-{}.{}", sanitized, counter, extension));
        counter += 1;
    }

    tokio::fs::write(&candidate, content).await?;
    Ok(candidate)
}

/// Update database with export path after successful write
pub async fn persist_export_path(
    pool: &sqlx::SqlitePool,
    meeting_id: &str,
    export_column: &str,
    path: &Path,
) -> Result<(), String> {
    let path_str = path.to_string_lossy().to_string();
    sqlx::query(&format!(
        "UPDATE meetings SET {} = ?, updated_at = ? WHERE id = ?",
        export_column
    ))
    .bind(&path_str)
    .bind(chrono::Utc::now())
    .bind(meeting_id)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to persist export path: {}", e))?;
    Ok(())
}

/// Parse markdown heading (##, ###, etc.)
pub fn parse_markdown_heading(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if !trimmed.starts_with('#') {
        return None;
    }
    let heading = trimmed.trim_start_matches('#').trim();
    if heading.is_empty() {
        None
    } else {
        Some(heading.to_string())
    }
}

/// Normalize heading text for comparison
pub fn normalize_heading(heading: &str) -> String {
    heading.to_lowercase().trim().to_string()
}

/// Fallback text if section is empty
pub fn empty_section_fallback(section: &str, fallback: &str) -> String {
    if section.trim().is_empty() {
        fallback.to_string()
    } else {
        section.to_string()
    }
}

/// Format transcript with speaker labels if diarization is available
pub fn format_transcript_with_speakers(
    transcript_rows: &[TranscriptExportRow],
    speaker_turns: &[SpeakerTurnExportRow],
    vocabulary_rules: &[VocabularyRule],
) -> Vec<String> {
    if speaker_turns.is_empty() {
        // No diarization - use regular format
        return transcript_rows
            .iter()
            .map(|row| {
                let corrected = crate::vocabulary::apply_vocabulary_rules(&row.text, vocabulary_rules);
                format!("- **{}** {}", row.timestamp, corrected)
            })
            .collect();
    }

    // Diarization available - map transcripts to speakers
    let mut formatted_lines = Vec::new();
    
    for row in transcript_rows {
        let row_start_ms = row.audio_start_time as i64;
        let row_end_ms = row.audio_end_time as i64;
        
        // Find overlapping speaker turn
        let speaker_turn = speaker_turns.iter().find(|turn| {
            // Check if transcript segment overlaps with speaker turn
            turn.start_ms <= row_end_ms && turn.end_ms >= row_start_ms
        });
        
        let corrected = crate::vocabulary::apply_vocabulary_rules(&row.text, vocabulary_rules);
        
        if let Some(turn) = speaker_turn {
            let speaker_label = turn.speaker_name.clone()
                .unwrap_or_else(|| format!("Speaker {}", turn.speaker_number));
            
            formatted_lines.push(format!("- **{}** {}: {}", row.timestamp, speaker_label, corrected));
        } else {
            // No speaker found for this segment
            formatted_lines.push(format!("- **{}** {}", row.timestamp, corrected));
        }
    }
    
    formatted_lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_filename() {
        assert_eq!(sanitize_filename("meeting:2024"), "meeting_2024");
        assert_eq!(sanitize_filename("my/folder/file"), "my_folder_file");
        assert_eq!(sanitize_filename("test<file>"), "test_file_");
    }

    #[test]
    fn test_yaml_quote() {
        assert_eq!(yaml_quote("simple"), "simple");
        assert_eq!(yaml_quote("has:colon"), "\"has:colon\"");
        assert_eq!(yaml_quote("has\"quote"), "\"has\\\"quote\"");
    }

    #[test]
    fn test_parse_markdown_heading() {
        assert_eq!(parse_markdown_heading("## Section"), Some("Section".to_string()));
        assert_eq!(parse_markdown_heading("### Subsection"), Some("Subsection".to_string()));
        assert_eq!(parse_markdown_heading("Not a heading"), None);
        assert_eq!(parse_markdown_heading("##"), None);
    }
}
