use crate::database::repositories::action_item::{ActionItemsRepository, NewActionItem};
use crate::database::repositories::decision::{DecisionsRepository, NewDecision};
use crate::summary::contract::{create_markdown_payload, BlockNoteBlock, SummaryPayload};
use crate::summary::decision_action_linking::identify_related_action_items;
use crate::summary::extraction_heuristics::{
    extract_action_items_from_text, extract_decisions_from_text,
};
use crate::summary::owner_linking::find_owner_speaker_identity_id;
use crate::summary::provenance::{find_best_provenance_match, find_provenance_in_transcripts};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;
use sqlx::SqlitePool;

static OWNER_FIELD_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\[owner::\s*([^\]]+?)\s*\]").expect("owner regex should compile"));
static DUE_FIELD_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\[due::\s*([^\]]+?)\s*\]").expect("due regex should compile"));
static OWNER_LABEL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:^|[\|\;\,\-])\s*owner\s*:\s*([^\|\;\,\]\)]+)")
        .expect("owner label regex should compile")
});
static DUE_LABEL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:^|[\|\;\,\-])\s*due\s*:\s*([^\|\;\,\]\)]+)")
        .expect("due label regex should compile")
});

#[derive(Debug, Clone, Default)]
struct ParsedArtifacts {
    action_items: Vec<NewActionItem>,
    decisions: Vec<NewDecision>,
}

const HEURISTIC_EVIDENCE_SCORE_THRESHOLD: usize = 20;
const HEURISTIC_EVIDENCE_COVERAGE_THRESHOLD: f32 = 0.6;

impl ParsedArtifacts {
    fn is_empty(&self) -> bool {
        self.action_items.is_empty() && self.decisions.is_empty()
    }
}

pub async fn sync_structured_artifacts_from_summary_payload(
    pool: &SqlitePool,
    meeting_id: &str,
    payload: &SummaryPayload,
) -> Result<(), String> {
    let parsed =
        parse_structured_artifacts_from_summary_payload_async(pool, meeting_id, payload).await?;

    ActionItemsRepository::replace_meeting_action_items(pool, meeting_id, &parsed.action_items)
        .await
        .map_err(|e| format!("failed to replace action items: {}", e))?;

    DecisionsRepository::replace_meeting_decisions(pool, meeting_id, &parsed.decisions)
        .await
        .map_err(|e| format!("failed to replace decisions: {}", e))?;

    // After persistence, link decisions to action items
    link_decisions_to_action_items_post_persistence(pool, meeting_id).await?;

    // Log quality metrics if extraction count is below threshold
    log_extraction_quality_metrics(pool, meeting_id, &parsed).await?;

    Ok(())
}

pub async fn sync_structured_artifacts_from_markdown(
    pool: &SqlitePool,
    meeting_id: &str,
    markdown: &str,
) -> Result<(), String> {
    let payload = create_markdown_payload(markdown.to_string());
    sync_structured_artifacts_from_summary_payload(pool, meeting_id, &payload).await
}

/// Parse structured artifacts with enhanced heuristics, owner linking, and provenance capture
async fn parse_structured_artifacts_from_summary_payload_async(
    pool: &SqlitePool,
    meeting_id: &str,
    payload: &SummaryPayload,
) -> Result<ParsedArtifacts, String> {
    // First, parse using existing structured section parsing
    let mut artifacts = match payload {
        SummaryPayload::Blocknote(blocknote_payload) => {
            let parsed_from_blocks =
                parse_structured_artifacts_from_blocknote(&blocknote_payload.summary_json);

            if parsed_from_blocks.is_empty() {
                parse_structured_artifacts_from_markdown(payload.markdown())
            } else {
                parsed_from_blocks
            }
        }
        SummaryPayload::Markdown(markdown_payload) => {
            parse_structured_artifacts_from_markdown(&markdown_payload.markdown)
        }
    };

    // Apply enhanced heuristics to extract additional items from full text
    let full_text = payload.markdown();
    let heuristic_action_items = extract_action_items_from_text(&full_text);
    let heuristic_decisions = extract_decisions_from_text(&full_text);

    // Add heuristic-extracted action items only when transcript evidence is strong enough.
    for extracted in heuristic_action_items {
        if !artifacts
            .action_items
            .iter()
            .any(|item| normalize_title(&item.title) == normalize_title(&extracted.title))
        {
            let provenance_match = find_best_provenance_match(pool, meeting_id, &extracted.title)
                .await
                .unwrap_or(None);

            if !is_strong_heuristic_match(provenance_match.as_ref()) {
                continue;
            }

            // Find owner identity if owner name is present
            let owner_speaker_identity_id = if let Some(owner_name) = &extracted.owner_name {
                find_owner_speaker_identity_id(pool, meeting_id, owner_name)
                    .await
                    .unwrap_or(None)
            } else {
                None
            };

            let provenance = provenance_match
                .map(|matched| matched.data)
                .unwrap_or_default();

            artifacts.action_items.push(NewActionItem {
                title: extracted.title,
                details: None,
                owner_speaker_identity_id,
                owner_display_name: extracted.owner_name,
                due_date: None,
                status: "open".to_string(),
                review_status: "unreviewed".to_string(),
                source_transcript_id: provenance.source_transcript_id,
                source_start_ms: provenance.source_start_ms,
                source_end_ms: provenance.source_end_ms,
                source_excerpt: provenance
                    .source_excerpt
                    .or_else(|| Some(extracted.source_text)),
                extraction_method: "heuristic_evidence".to_string(),
                extraction_version: "v0.4.0".to_string(),
            });
        }
    }

    // Add heuristic-extracted decisions only when transcript evidence is strong enough.
    for extracted in heuristic_decisions {
        if !artifacts
            .decisions
            .iter()
            .any(|item| normalize_title(&item.title) == normalize_title(&extracted.title))
        {
            let provenance_match = find_best_provenance_match(pool, meeting_id, &extracted.title)
                .await
                .unwrap_or(None);

            if !is_strong_heuristic_match(provenance_match.as_ref()) {
                continue;
            }

            let provenance = provenance_match
                .map(|matched| matched.data)
                .unwrap_or_default();

            artifacts.decisions.push(NewDecision {
                title: extracted.title,
                details: None,
                review_status: "unreviewed".to_string(),
                source_transcript_id: provenance.source_transcript_id,
                source_start_ms: provenance.source_start_ms,
                source_end_ms: provenance.source_end_ms,
                source_excerpt: provenance
                    .source_excerpt
                    .or_else(|| Some(extracted.source_text)),
                extraction_method: "heuristic_evidence".to_string(),
                extraction_version: "v0.4.0".to_string(),
                related_action_item_ids: None,
            });
        }
    }

    // Enhance existing items with provenance if missing
    for item in &mut artifacts.action_items {
        if item.source_transcript_id.is_none() {
            let provenance = find_provenance_in_transcripts(pool, meeting_id, &item.title)
                .await
                .unwrap_or_default();

            item.source_transcript_id = provenance.source_transcript_id;
            item.source_start_ms = provenance.source_start_ms;
            item.source_end_ms = provenance.source_end_ms;
            if item.source_excerpt.is_none() {
                item.source_excerpt = provenance.source_excerpt;
            }
            if item.source_transcript_id.is_some() {
                item.extraction_method = add_evidence_suffix(&item.extraction_method);
            }
        }

        // Try to link owner if owner_display_name is present but not linked
        if item.owner_speaker_identity_id.is_none() {
            if let Some(owner_name) = &item.owner_display_name {
                item.owner_speaker_identity_id =
                    find_owner_speaker_identity_id(pool, meeting_id, owner_name)
                        .await
                        .unwrap_or(None);
            }
        }
    }

    for decision in &mut artifacts.decisions {
        if decision.source_transcript_id.is_none() {
            let provenance = find_provenance_in_transcripts(pool, meeting_id, &decision.title)
                .await
                .unwrap_or_default();

            decision.source_transcript_id = provenance.source_transcript_id;
            decision.source_start_ms = provenance.source_start_ms;
            decision.source_end_ms = provenance.source_end_ms;
            if decision.source_excerpt.is_none() {
                decision.source_excerpt = provenance.source_excerpt;
            }
            if decision.source_transcript_id.is_some() {
                decision.extraction_method = add_evidence_suffix(&decision.extraction_method);
            }
        }
    }

    Ok(artifacts)
}

/// Link decisions to action items after both have been persisted to the database
async fn link_decisions_to_action_items_post_persistence(
    pool: &SqlitePool,
    meeting_id: &str,
) -> Result<(), String> {
    // Fetch all decisions and action items for this meeting
    let decisions = DecisionsRepository::list_meeting_decisions(pool, meeting_id)
        .await
        .map_err(|e| format!("Failed to fetch decisions: {}", e))?;

    let action_items = ActionItemsRepository::list_meeting_action_items(pool, meeting_id)
        .await
        .map_err(|e| format!("Failed to fetch action items: {}", e))?;

    // For each decision, identify related action items
    for decision in decisions {
        let decision_for_matching = NewDecision {
            title: decision.title.clone(),
            details: decision.details.clone(),
            review_status: decision.review_status.clone(),
            source_transcript_id: decision.source_transcript_id.clone(),
            source_start_ms: decision.source_start_ms,
            source_end_ms: decision.source_end_ms,
            source_excerpt: decision.source_excerpt.clone(),
            extraction_method: decision.extraction_method.clone(),
            extraction_version: decision.extraction_version.clone(),
            related_action_item_ids: None,
        };

        let action_items_for_matching: Vec<NewActionItem> = action_items
            .iter()
            .map(|item| NewActionItem {
                title: item.title.clone(),
                details: item.details.clone(),
                owner_speaker_identity_id: item.owner_speaker_identity_id.clone(),
                owner_display_name: item.owner_display_name.clone(),
                due_date: item.due_date.clone(),
                status: item.status.clone(),
                review_status: item.review_status.clone(),
                source_transcript_id: item.source_transcript_id.clone(),
                source_start_ms: item.source_start_ms,
                source_end_ms: item.source_end_ms,
                source_excerpt: item.source_excerpt.clone(),
                extraction_method: item.extraction_method.clone(),
                extraction_version: item.extraction_version.clone(),
            })
            .collect();

        let related_indices =
            identify_related_action_items(&decision_for_matching, &action_items_for_matching);

        if !related_indices.is_empty() {
            // Convert indices to IDs
            let related_ids: Vec<String> = related_indices
                .iter()
                .filter_map(|&idx| action_items.get(idx).map(|item| item.id.clone()))
                .collect();

            if !related_ids.is_empty() {
                // Store as JSON array
                let related_ids_json = serde_json::to_string(&related_ids)
                    .map_err(|e| format!("Failed to serialize related IDs: {}", e))?;

                // Update the decision with related action item IDs
                sqlx::query(
                    "UPDATE decisions SET related_action_item_ids = ?, updated_at = ? WHERE id = ?",
                )
                .bind(&related_ids_json)
                .bind(chrono::Utc::now().to_rfc3339())
                .bind(&decision.id)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to update decision relationships: {}", e))?;
            }
        }
    }

    Ok(())
}

/// Normalize title for duplicate detection
fn normalize_title(title: &str) -> String {
    title
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Log extraction quality metrics when count is below threshold
async fn log_extraction_quality_metrics(
    pool: &SqlitePool,
    meeting_id: &str,
    artifacts: &ParsedArtifacts,
) -> Result<(), String> {
    // Get meeting duration
    let meeting =
        sqlx::query_as::<_, (Option<f64>,)>("SELECT duration_seconds FROM meetings WHERE id = ?")
            .bind(meeting_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to fetch meeting duration: {}", e))?;

    if let Some((Some(duration_seconds),)) = meeting {
        let duration_minutes = duration_seconds / 60.0;

        // Log if action item count is below threshold (< 2 items for 30+ min meeting)
        if duration_minutes >= 30.0 && artifacts.action_items.len() < 2 {
            log::warn!(
                "Low action item extraction quality for meeting {}: {} items for {:.1} minute meeting",
                meeting_id,
                artifacts.action_items.len(),
                duration_minutes
            );
        }

        // Log if decision count is below threshold (< 1 decision for 30+ min meeting)
        if duration_minutes >= 30.0 && artifacts.decisions.is_empty() {
            log::warn!(
                "Low decision extraction quality for meeting {}: {} decisions for {:.1} minute meeting",
                meeting_id,
                artifacts.decisions.len(),
                duration_minutes
            );
        }
    }

    let total_artifacts = artifacts.action_items.len() + artifacts.decisions.len();
    if total_artifacts > 0 {
        let evidence_backed = artifacts
            .action_items
            .iter()
            .filter(|item| item.source_transcript_id.is_some())
            .count()
            + artifacts
                .decisions
                .iter()
                .filter(|item| item.source_transcript_id.is_some())
                .count();

        let evidence_ratio = evidence_backed as f32 / total_artifacts as f32;
        if evidence_ratio < 0.6 {
            log::warn!(
                "Low transcript-evidence coverage for meeting {}: {}/{} structured artifacts grounded",
                meeting_id,
                evidence_backed,
                total_artifacts
            );
        }
    }

    Ok(())
}

fn parse_structured_artifacts_from_markdown(markdown: &str) -> ParsedArtifacts {
    let mut artifacts = ParsedArtifacts::default();
    let mut current_section = SectionKind::Summary;

    for raw_line in markdown.lines() {
        if let Some(heading) = parse_heading(raw_line) {
            current_section = classify_heading(&heading);
            continue;
        }

        match current_section {
            SectionKind::ActionItems => {
                if let Some(item) = parse_action_item_line(raw_line, None, false) {
                    artifacts.action_items.push(item);
                }
            }
            SectionKind::Decisions => {
                if let Some(decision) = parse_decision_line(raw_line, false) {
                    artifacts.decisions.push(decision);
                }
            }
            SectionKind::Summary => {}
        }
    }

    artifacts
}

fn parse_structured_artifacts_from_blocknote(blocks: &[BlockNoteBlock]) -> ParsedArtifacts {
    let mut artifacts = ParsedArtifacts::default();
    let mut section = SectionKind::Summary;

    visit_blocks(blocks, &mut section, &mut artifacts);
    artifacts
}

fn visit_blocks(
    blocks: &[BlockNoteBlock],
    section: &mut SectionKind,
    artifacts: &mut ParsedArtifacts,
) {
    for block in blocks {
        visit_block(block, section, artifacts);
    }
}

fn visit_block(block: &BlockNoteBlock, section: &mut SectionKind, artifacts: &mut ParsedArtifacts) {
    if let Some(heading_text) = block_heading_text(block) {
        *section = classify_heading(&heading_text);
    } else {
        let text = extract_block_text(block);
        if let Some(text) = text {
            match section {
                SectionKind::ActionItems => {
                    if let Some(action_item) =
                        parse_action_item_line(&text, extract_checklist_checked_flag(block), true)
                    {
                        artifacts.action_items.push(action_item);
                    }
                }
                SectionKind::Decisions => {
                    if let Some(decision) = parse_decision_line(&text, true) {
                        artifacts.decisions.push(decision);
                    }
                }
                SectionKind::Summary => {}
            }
        }
    }

    if let Some(children) = &block.children {
        visit_blocks(children, section, artifacts);
    }
}

#[derive(Debug, Clone, Copy)]
enum SectionKind {
    Summary,
    ActionItems,
    Decisions,
}

fn parse_heading(line: &str) -> Option<String> {
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

fn classify_heading(heading: &str) -> SectionKind {
    let normalized = heading.trim().to_lowercase();
    if normalized.contains("action item") {
        return SectionKind::ActionItems;
    }
    if normalized == "decisions"
        || normalized == "key decisions"
        || normalized.contains(" decision")
    {
        return SectionKind::Decisions;
    }

    SectionKind::Summary
}

fn parse_action_item_line(
    line: &str,
    checked: Option<bool>,
    allow_plain_text: bool,
) -> Option<NewActionItem> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let content = if let Some(stripped) = strip_list_prefix(trimmed) {
        stripped
    } else if allow_plain_text {
        trimmed
    } else {
        return None;
    };
    let (title, owner_display_name, due_date) = parse_inline_metadata(content);
    if title.is_empty() {
        return None;
    }

    let is_checked = checked.unwrap_or_else(|| {
        trimmed.starts_with("- [x]")
            || trimmed.starts_with("- [X]")
            || trimmed.starts_with("* [x]")
            || trimmed.starts_with("* [X]")
    });

    Some(NewActionItem {
        title,
        details: None,
        owner_speaker_identity_id: None,
        owner_display_name,
        due_date,
        status: if is_checked {
            "completed".to_string()
        } else {
            "open".to_string()
        },
        review_status: "unreviewed".to_string(),
        source_transcript_id: None,
        source_start_ms: None,
        source_end_ms: None,
        source_excerpt: Some(trimmed.to_string()),
        extraction_method: "summary_structured".to_string(),
        extraction_version: "v0.4.0".to_string(),
    })
}

fn parse_decision_line(line: &str, allow_plain_text: bool) -> Option<NewDecision> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let title = if let Some(stripped) = strip_list_prefix(trimmed) {
        stripped.trim().to_string()
    } else if allow_plain_text {
        trimmed.to_string()
    } else {
        return None;
    };
    if title.is_empty() {
        return None;
    }

    Some(NewDecision {
        title,
        details: None,
        review_status: "unreviewed".to_string(),
        source_transcript_id: None,
        source_start_ms: None,
        source_end_ms: None,
        source_excerpt: Some(trimmed.to_string()),
        extraction_method: "summary_structured".to_string(),
        extraction_version: "v0.4.0".to_string(),
        related_action_item_ids: None,
    })
}

fn parse_inline_metadata(content: &str) -> (String, Option<String>, Option<String>) {
    let owner_display_name = OWNER_FIELD_RE
        .captures(content)
        .and_then(|captures| {
            captures
                .get(1)
                .map(|value| value.as_str().trim().to_string())
        })
        .or_else(|| {
            OWNER_LABEL_RE.captures(content).and_then(|captures| {
                captures
                    .get(1)
                    .map(|value| value.as_str().trim().to_string())
            })
        });

    let due_date = DUE_FIELD_RE
        .captures(content)
        .and_then(|captures| {
            captures
                .get(1)
                .map(|value| value.as_str().trim().to_string())
        })
        .or_else(|| {
            DUE_LABEL_RE.captures(content).and_then(|captures| {
                captures
                    .get(1)
                    .map(|value| value.as_str().trim().to_string())
            })
        });

    let title = OWNER_FIELD_RE.replace_all(content, "").to_string();
    let title = DUE_FIELD_RE.replace_all(&title, "").to_string();
    let title = OWNER_LABEL_RE.replace_all(&title, "").to_string();
    let title = DUE_LABEL_RE.replace_all(&title, "").to_string();
    let title = normalize_whitespace(&title);

    (title, owner_display_name, due_date)
}

fn strip_list_prefix(line: &str) -> Option<&str> {
    let trimmed = line.trim();
    if trimmed.starts_with("- [ ] ")
        || trimmed.starts_with("- [x] ")
        || trimmed.starts_with("- [X] ")
        || trimmed.starts_with("* [ ] ")
        || trimmed.starts_with("* [x] ")
        || trimmed.starts_with("* [X] ")
    {
        return Some(&trimmed[6..]);
    }
    if trimmed.starts_with("- ") || trimmed.starts_with("* ") {
        return Some(&trimmed[2..]);
    }

    let numbered = trimmed
        .char_indices()
        .find_map(|(index, ch)| if ch == '.' { Some(index) } else { None });
    if let Some(dot_index) = numbered {
        if trimmed[..dot_index].chars().all(|c| c.is_ascii_digit())
            && trimmed[dot_index + 1..].starts_with(' ')
        {
            return Some(trimmed[dot_index + 2..].trim_start());
        }
    }

    None
}

fn block_heading_text(block: &BlockNoteBlock) -> Option<String> {
    if !block.block_type.to_lowercase().contains("heading") {
        return None;
    }

    extract_block_text(block)
}

fn extract_checklist_checked_flag(block: &BlockNoteBlock) -> Option<bool> {
    if !block.block_type.to_lowercase().contains("check") {
        return None;
    }

    block
        .props
        .as_ref()
        .and_then(|props| props.get("checked").and_then(Value::as_bool))
}

fn extract_block_text(block: &BlockNoteBlock) -> Option<String> {
    let content = block.content.as_ref()?;
    let mut text = String::new();
    collect_value_text(content, &mut text);
    let normalized = normalize_whitespace(&text);
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn collect_value_text(value: &Value, output: &mut String) {
    match value {
        Value::String(text) => {
            if !text.is_empty() {
                if !output.is_empty() {
                    output.push(' ');
                }
                output.push_str(text);
            }
        }
        Value::Array(values) => {
            for value in values {
                collect_value_text(value, output);
            }
        }
        Value::Object(object) => {
            if let Some(text) = object.get("text").and_then(Value::as_str) {
                if !text.is_empty() {
                    if !output.is_empty() {
                        output.push(' ');
                    }
                    output.push_str(text);
                }
            }

            if let Some(content) = object.get("content") {
                collect_value_text(content, output);
            }

            if let Some(children) = object.get("children") {
                collect_value_text(children, output);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}

fn normalize_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_strong_heuristic_match(
    provenance_match: Option<&crate::summary::provenance::ProvenanceMatch>,
) -> bool {
    provenance_match.is_some_and(|matched| {
        matched.score >= HEURISTIC_EVIDENCE_SCORE_THRESHOLD
            && (matched.coverage_ratio >= HEURISTIC_EVIDENCE_COVERAGE_THRESHOLD
                || matched.exact_phrase_match)
    })
}

fn add_evidence_suffix(extraction_method: &str) -> String {
    if extraction_method.ends_with("_evidence") {
        extraction_method.to_string()
    } else {
        format!("{}_evidence", extraction_method)
    }
}

/// Synchronous version for testing (without async features like provenance and owner linking)
#[cfg(test)]
fn parse_structured_artifacts_from_summary_payload(payload: &SummaryPayload) -> ParsedArtifacts {
    match payload {
        SummaryPayload::Blocknote(blocknote_payload) => {
            let parsed_from_blocks =
                parse_structured_artifacts_from_blocknote(&blocknote_payload.summary_json);

            if parsed_from_blocks.is_empty() {
                parse_structured_artifacts_from_markdown(payload.markdown())
            } else {
                parsed_from_blocks
            }
        }
        SummaryPayload::Markdown(markdown_payload) => {
            parse_structured_artifacts_from_markdown(&markdown_payload.markdown)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::summary::contract::create_blocknote_payload;
    use sqlx::sqlite::SqlitePoolOptions;

    fn text_span(text: &str) -> Value {
        serde_json::json!({
            "type": "text",
            "text": text
        })
    }

    async fn setup_pool_with_migrations() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("failed to create sqlite memory pool");

        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("baseline migration should execute");

        pool
    }

    async fn seed_meeting(pool: &SqlitePool, meeting_id: &str) {
        sqlx::query(
            "INSERT INTO meetings (id, title, created_at, updated_at)
             VALUES (?, 'Structured Artifact Test', '2026-04-11T00:00:00Z', '2026-04-11T00:00:00Z')",
        )
        .bind(meeting_id)
        .execute(pool)
        .await
        .expect("failed to seed meeting");
    }

    #[test]
    fn parses_markdown_action_items_and_decisions() {
        let markdown = r#"
## Summary

Shipped the change.

## Action Items

- [ ] Follow up with Alex [owner:: Alex] [due:: 2026-04-12]
- [x] Send notes

## Decisions

- Ship on Friday
1. Keep desktop-first scope
"#;

        let payload = create_markdown_payload(markdown.to_string());
        let parsed = parse_structured_artifacts_from_summary_payload(&payload);
        assert_eq!(parsed.action_items.len(), 2);
        assert_eq!(
            parsed.action_items[0].owner_display_name.as_deref(),
            Some("Alex")
        );
        assert_eq!(
            parsed.action_items[0].due_date.as_deref(),
            Some("2026-04-12")
        );
        assert_eq!(parsed.action_items[0].status, "open");
        assert_eq!(parsed.action_items[1].status, "completed");
        assert_eq!(parsed.decisions.len(), 2);
    }

    #[test]
    fn parses_blocknote_structured_sections_before_markdown_fallback() {
        let payload = create_blocknote_payload(
            "## Action Items\n- markdown fallback item".to_string(),
            vec![
                BlockNoteBlock {
                    id: "heading-actions".to_string(),
                    block_type: "heading".to_string(),
                    props: None,
                    content: Some(Value::Array(vec![text_span("Action Items")])),
                    children: None,
                    extra: Default::default(),
                },
                BlockNoteBlock {
                    id: "action-1".to_string(),
                    block_type: "checkListItem".to_string(),
                    props: Some(serde_json::json!({ "checked": true })),
                    content: Some(Value::Array(vec![text_span(
                        "Follow up with Jordan | owner: Jordan | due: 2026-05-01",
                    )])),
                    children: None,
                    extra: Default::default(),
                },
                BlockNoteBlock {
                    id: "heading-decisions".to_string(),
                    block_type: "heading".to_string(),
                    props: None,
                    content: Some(Value::Array(vec![text_span("Decisions")])),
                    children: None,
                    extra: Default::default(),
                },
                BlockNoteBlock {
                    id: "decision-1".to_string(),
                    block_type: "bulletListItem".to_string(),
                    props: None,
                    content: Some(Value::Array(vec![text_span(
                        "Ship the beta behind a feature flag",
                    )])),
                    children: None,
                    extra: Default::default(),
                },
            ],
        );

        let parsed = parse_structured_artifacts_from_summary_payload(&payload);
        assert_eq!(parsed.action_items.len(), 1);
        assert_eq!(
            parsed.action_items[0].owner_display_name.as_deref(),
            Some("Jordan")
        );
        assert_eq!(
            parsed.action_items[0].due_date.as_deref(),
            Some("2026-05-01")
        );
        assert_eq!(parsed.action_items[0].status, "completed");
        assert_eq!(parsed.decisions.len(), 1);
        assert_eq!(
            parsed.decisions[0].title,
            "Ship the beta behind a feature flag"
        );
    }

    #[tokio::test]
    async fn sync_structured_artifacts_preserves_reviewed_rows_across_regeneration() {
        let pool = setup_pool_with_migrations().await;
        let meeting_id = "meeting-structured-sync";
        seed_meeting(&pool, meeting_id).await;

        let initial_payload = create_markdown_payload(
            "## Action Items\n- Prepare launch plan\n\n## Decisions\n- Ship beta behind a flag"
                .to_string(),
        );

        sync_structured_artifacts_from_summary_payload(&pool, meeting_id, &initial_payload)
            .await
            .expect("initial sync should succeed");

        let action_item_id = sqlx::query_as::<_, (String,)>(
            "SELECT id FROM action_items WHERE meeting_id = ? LIMIT 1",
        )
        .bind(meeting_id)
        .fetch_one(&pool)
        .await
        .expect("expected action item")
        .0;

        let decision_id =
            sqlx::query_as::<_, (String,)>("SELECT id FROM decisions WHERE meeting_id = ? LIMIT 1")
                .bind(meeting_id)
                .fetch_one(&pool)
                .await
                .expect("expected decision")
                .0;

        sqlx::query(
            "UPDATE action_items
             SET title = 'Prepare launch plan (reviewed)', review_status = 'edited', status = 'completed'
             WHERE id = ?",
        )
        .bind(&action_item_id)
        .execute(&pool)
        .await
        .expect("update action item");

        sqlx::query(
            "UPDATE decisions
             SET title = 'Ship beta behind feature flag (reviewed)', review_status = 'edited'
             WHERE id = ?",
        )
        .bind(&decision_id)
        .execute(&pool)
        .await
        .expect("update decision");

        let regenerated_payload = create_markdown_payload(
            "## Action Items\n- Prepare launch plan\n\n## Decisions\n- Ship beta behind a flag"
                .to_string(),
        );

        sync_structured_artifacts_from_summary_payload(&pool, meeting_id, &regenerated_payload)
            .await
            .expect("regenerated sync should succeed");

        let action_row = sqlx::query_as::<_, (String, String, String)>(
            "SELECT title, review_status, status FROM action_items WHERE meeting_id = ? LIMIT 1",
        )
        .bind(meeting_id)
        .fetch_one(&pool)
        .await
        .expect("expected action row");
        assert_eq!(action_row.0, "Prepare launch plan (reviewed)");
        assert_eq!(action_row.1, "edited");
        assert_eq!(action_row.2, "completed");

        let decision_row = sqlx::query_as::<_, (String, String)>(
            "SELECT title, review_status FROM decisions WHERE meeting_id = ? LIMIT 1",
        )
        .bind(meeting_id)
        .fetch_one(&pool)
        .await
        .expect("expected decision row");
        assert_eq!(decision_row.0, "Ship beta behind feature flag (reviewed)");
        assert_eq!(decision_row.1, "edited");
    }

    #[tokio::test]
    async fn sync_structured_artifacts_only_keeps_heuristics_with_strong_transcript_evidence() {
        let pool = setup_pool_with_migrations().await;
        let meeting_id = "meeting-heuristic-evidence";
        seed_meeting(&pool, meeting_id).await;

        sqlx::query(
            "INSERT INTO transcripts (id, meeting_id, transcript, timestamp, processing_version,
                                      audio_start_time, audio_end_time)
             VALUES
             ('transcript-1', ?, 'We decided to ship the beta behind a feature flag after QA review.',
              '2026-04-11T10:00:00Z', 'v0.2.0', 0.0, 6.0),
             ('transcript-2', ?, 'General discussion without a follow-up task.',
              '2026-04-11T10:01:00Z', 'v0.2.0', 6.0, 12.0)",
        )
        .bind(meeting_id)
        .bind(meeting_id)
        .execute(&pool)
        .await
        .expect("seed transcripts");

        let payload = create_markdown_payload(
            "## Summary\nWe decided to ship the beta behind a feature flag. We need to do it."
                .to_string(),
        );

        sync_structured_artifacts_from_summary_payload(&pool, meeting_id, &payload)
            .await
            .expect("sync should succeed");

        let decision_rows = sqlx::query_as::<_, (String, String)>(
            "SELECT title, extraction_method FROM decisions WHERE meeting_id = ? ORDER BY created_at",
        )
        .bind(meeting_id)
        .fetch_all(&pool)
        .await
        .expect("fetch decisions");

        let action_rows = sqlx::query_as::<_, (String, String)>(
            "SELECT title, extraction_method FROM action_items WHERE meeting_id = ? ORDER BY created_at",
        )
        .bind(meeting_id)
        .fetch_all(&pool)
        .await
        .expect("fetch action items");

        assert_eq!(decision_rows.len(), 1);
        assert_eq!(decision_rows[0].0, "ship the beta behind a feature flag");
        assert_eq!(decision_rows[0].1, "heuristic_evidence");
        assert!(action_rows.is_empty());
    }

    #[tokio::test]
    async fn sync_structured_artifacts_enriches_blocknote_rows_with_transcript_evidence() {
        let pool = setup_pool_with_migrations().await;
        let meeting_id = "meeting-blocknote-evidence";
        seed_meeting(&pool, meeting_id).await;

        sqlx::query(
            "INSERT INTO transcripts (id, meeting_id, transcript, timestamp, processing_version,
                                      audio_start_time, audio_end_time)
             VALUES ('transcript-1', ?, 'Jordan will prepare the launch plan by Friday.',
                     '2026-04-11T10:00:00Z', 'v0.2.0', 0.0, 5.0)",
        )
        .bind(meeting_id)
        .execute(&pool)
        .await
        .expect("insert transcript");

        let payload = create_blocknote_payload(
            "fallback".to_string(),
            vec![
                BlockNoteBlock {
                    id: "heading-actions".to_string(),
                    block_type: "heading".to_string(),
                    props: None,
                    content: Some(Value::Array(vec![text_span("Action Items")])),
                    children: None,
                    extra: Default::default(),
                },
                BlockNoteBlock {
                    id: "action-1".to_string(),
                    block_type: "checkListItem".to_string(),
                    props: Some(serde_json::json!({ "checked": false })),
                    content: Some(Value::Array(vec![text_span(
                        "Prepare the launch plan | owner: Jordan",
                    )])),
                    children: None,
                    extra: Default::default(),
                },
            ],
        );

        sync_structured_artifacts_from_summary_payload(&pool, meeting_id, &payload)
            .await
            .expect("sync should succeed");

        let row = sqlx::query_as::<_, (Option<String>, String)>(
            "SELECT source_transcript_id, extraction_method FROM action_items WHERE meeting_id = ? LIMIT 1",
        )
        .bind(meeting_id)
        .fetch_one(&pool)
        .await
        .expect("fetch action item");

        assert_eq!(row.0, Some("transcript-1".to_string()));
        assert_eq!(row.1, "summary_structured_evidence");
    }
}
