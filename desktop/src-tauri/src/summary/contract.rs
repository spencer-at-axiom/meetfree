use chrono::Utc;
use jsonschema::{Draft, JSONSchema};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::{FromRow, SqlitePool};
use std::collections::{BTreeMap, BTreeSet};

pub const SUMMARY_SCHEMA_VERSION: u32 = 1;
pub const SUMMARY_CONTRACT_VERSION: &str = "v0.1.0";

static SUMMARY_SCHEMA_DOCUMENT: Lazy<Value> = Lazy::new(|| {
    serde_json::from_str(include_str!(
        "../../../src/contracts/summary-contract.v0.1.0.schema.json"
    ))
    .expect("summary contract schema must be valid JSON")
});

// JSON Schema Draft 2020-12: oneOf validates when exactly one subschema matches.
// Source: https://json-schema.org/draft/2020-12/json-schema-core#section-10.2.1.3
static SUMMARY_SCHEMA_VALIDATOR: Lazy<JSONSchema> = Lazy::new(|| {
    JSONSchema::options()
        .with_draft(Draft::Draft202012)
        .compile(&SUMMARY_SCHEMA_DOCUMENT)
        .expect("summary contract schema must compile")
});

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ValidationIssue {
    pub instance_path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractValidationError {
    pub code: String,
    pub message: String,
    pub details: Vec<ValidationIssue>,
}

impl ContractValidationError {
    fn invalid_payload(message: impl Into<String>, details: Vec<ValidationIssue>) -> Self {
        Self {
            code: "SUMMARY_PAYLOAD_INVALID".to_string(),
            message: message.into(),
            details,
        }
    }

    fn migration_failed(message: impl Into<String>) -> Self {
        Self {
            code: "SUMMARY_MIGRATION_FAILED".to_string(),
            message: message.into(),
            details: Vec::new(),
        }
    }

    pub fn to_json_value(&self) -> Value {
        serde_json::to_value(self).unwrap_or_else(|_| {
            serde_json::json!({
                "code": "SUMMARY_PAYLOAD_INVALID",
                "message": "Failed to serialize validation error",
                "details": []
            })
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "format", rename_all = "lowercase")]
pub enum SummaryPayload {
    Markdown(SummaryMarkdownPayload),
    Blocknote(SummaryBlocknotePayload),
}

// Serde strict unknown-field rejection is intentional for top-level payload fields.
// Source: https://serde.rs/container-attrs (deny_unknown_fields)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SummaryMarkdownPayload {
    pub schema_version: u32,
    pub contract_version: String,
    pub markdown: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SummaryBlocknotePayload {
    pub schema_version: u32,
    pub contract_version: String,
    pub markdown: String,
    // BlockNote recommends JSON blocks as durable/lossless while markdown import/export is lossy.
    // Source: https://www.blocknotejs.org/docs/foundations/supported-formats
    pub summary_json: Vec<BlockNoteBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BlockNoteBlock {
    pub id: String,
    #[serde(rename = "type")]
    pub block_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub props: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<BlockNoteBlock>>,
    #[serde(flatten, default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extra: BTreeMap<String, Value>,
}

impl SummaryPayload {
    pub fn markdown(&self) -> &str {
        match self {
            SummaryPayload::Markdown(payload) => &payload.markdown,
            SummaryPayload::Blocknote(payload) => &payload.markdown,
        }
    }

    fn schema_version(&self) -> u32 {
        match self {
            SummaryPayload::Markdown(payload) => payload.schema_version,
            SummaryPayload::Blocknote(payload) => payload.schema_version,
        }
    }

    fn contract_version(&self) -> &str {
        match self {
            SummaryPayload::Markdown(payload) => &payload.contract_version,
            SummaryPayload::Blocknote(payload) => &payload.contract_version,
        }
    }

    fn ensure_version_fields(&self) -> Result<(), ContractValidationError> {
        let schema_version = self.schema_version();
        if schema_version != SUMMARY_SCHEMA_VERSION {
            return Err(ContractValidationError::invalid_payload(
                format!(
                    "Unsupported summary schema_version: {} (expected {})",
                    schema_version, SUMMARY_SCHEMA_VERSION
                ),
                vec![ValidationIssue {
                    instance_path: "/schema_version".to_string(),
                    message: "schema_version must be 1".to_string(),
                }],
            ));
        }

        let contract_version = self.contract_version();
        if contract_version != SUMMARY_CONTRACT_VERSION {
            return Err(ContractValidationError::invalid_payload(
                format!(
                    "Unsupported summary contract_version: {} (expected {})",
                    contract_version, SUMMARY_CONTRACT_VERSION
                ),
                vec![ValidationIssue {
                    instance_path: "/contract_version".to_string(),
                    message: "contract_version must be v0.1.0".to_string(),
                }],
            ));
        }

        Ok(())
    }

    pub fn to_json_value(&self) -> Value {
        serde_json::to_value(self).expect("summary payload serialization should not fail")
    }
}

pub fn create_markdown_payload(markdown: impl Into<String>) -> SummaryPayload {
    SummaryPayload::Markdown(SummaryMarkdownPayload {
        schema_version: SUMMARY_SCHEMA_VERSION,
        contract_version: SUMMARY_CONTRACT_VERSION.to_string(),
        markdown: markdown.into(),
    })
}

pub fn create_blocknote_payload(
    markdown: impl Into<String>,
    summary_json: Vec<BlockNoteBlock>,
) -> SummaryPayload {
    SummaryPayload::Blocknote(SummaryBlocknotePayload {
        schema_version: SUMMARY_SCHEMA_VERSION,
        contract_version: SUMMARY_CONTRACT_VERSION.to_string(),
        markdown: markdown.into(),
        summary_json,
    })
}

pub fn markdown_payload_value(markdown: impl Into<String>) -> Value {
    create_markdown_payload(markdown).to_json_value()
}

pub fn validate_summary_payload_value(
    value: &Value,
) -> Result<SummaryPayload, ContractValidationError> {
    if let Err(errors) = SUMMARY_SCHEMA_VALIDATOR.validate(value) {
        let mut details = errors
            .map(|error| {
                let instance_path = error.instance_path.to_string();
                ValidationIssue {
                    instance_path: if instance_path.is_empty() {
                        "/".to_string()
                    } else {
                        instance_path
                    },
                    message: error.to_string(),
                }
            })
            .collect::<Vec<_>>();
        details.sort_by(|left, right| {
            left.instance_path
                .cmp(&right.instance_path)
                .then(left.message.cmp(&right.message))
        });

        return Err(ContractValidationError::invalid_payload(
            "Summary payload does not match contract v0.1.0 schema.",
            details,
        ));
    }

    let payload: SummaryPayload = serde_json::from_value(value.clone()).map_err(|error| {
        ContractValidationError::invalid_payload(
            "Summary payload could not be deserialized.",
            vec![ValidationIssue {
                instance_path: "/".to_string(),
                message: error.to_string(),
            }],
        )
    })?;

    payload.ensure_version_fields()?;
    Ok(payload)
}

pub fn validate_and_normalize_summary_payload(
    value: Value,
) -> Result<Value, ContractValidationError> {
    let payload = validate_summary_payload_value(&value)?;
    Ok(payload.to_json_value())
}

pub fn migrate_legacy_summary_payload(
    value: &Value,
) -> Result<SummaryPayload, ContractValidationError> {
    if let Ok(payload) = validate_summary_payload_value(value) {
        return Ok(payload);
    }

    if let Some(markdown) = extract_markdown_string(value) {
        if let Some(summary_json_value) = value.get("summary_json") {
            let blocks: Vec<BlockNoteBlock> = serde_json::from_value(summary_json_value.clone())
                .map_err(|error| {
                    ContractValidationError::migration_failed(format!(
                        "Legacy blocknote summary_json cannot be parsed: {}",
                        error
                    ))
                })?;
            return Ok(create_blocknote_payload(markdown, blocks));
        }

        return Ok(create_markdown_payload(markdown));
    }

    if let Some(markdown) = legacy_sections_to_markdown(value) {
        return Ok(create_markdown_payload(markdown));
    }

    Err(ContractValidationError::migration_failed(
        "Payload is not convertible to summary contract v0.1.0",
    ))
}

fn extract_markdown_string(value: &Value) -> Option<String> {
    value
        .as_object()
        .and_then(|object| object.get("markdown"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn legacy_sections_to_markdown(value: &Value) -> Option<String> {
    let object = value.as_object()?;
    let mut sections = collect_meeting_notes_sections(object);

    if sections.is_empty() {
        sections = collect_keyed_sections(object);
    }

    if sections.is_empty() {
        return None;
    }

    let meeting_name = object
        .get("MeetingName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string);

    let mut markdown = String::new();
    if let Some(name) = meeting_name {
        markdown.push_str("# ");
        markdown.push_str(&name);
        markdown.push_str("\n\n");
    }

    for (index, section) in sections.iter().enumerate() {
        if index > 0 {
            markdown.push('\n');
        }
        markdown.push_str("## ");
        markdown.push_str(&section.title);
        markdown.push_str("\n\n");
        markdown.push_str(&section.body);
        markdown.push('\n');
    }

    let normalized = markdown.trim().to_string();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

#[derive(Debug, Clone)]
struct LegacyMarkdownSection {
    title: String,
    body: String,
}

fn collect_meeting_notes_sections(object: &Map<String, Value>) -> Vec<LegacyMarkdownSection> {
    let mut output = Vec::new();
    let sections = object
        .get("MeetingNotes")
        .and_then(Value::as_object)
        .and_then(|meeting_notes| meeting_notes.get("sections"))
        .and_then(Value::as_array);

    if let Some(sections) = sections {
        for section in sections {
            if let Some(section_obj) = section.as_object() {
                if let Some(parsed) = parse_section_map(section_obj, None) {
                    output.push(parsed);
                }
            }
        }
    }

    output
}

fn collect_keyed_sections(object: &Map<String, Value>) -> Vec<LegacyMarkdownSection> {
    let mut ordered_keys = Vec::new();
    if let Some(section_order) = object.get("_section_order").and_then(Value::as_array) {
        for key in section_order.iter().filter_map(Value::as_str) {
            ordered_keys.push(key.to_string());
        }
    }

    let ignored_keys = BTreeSet::from([
        "MeetingName",
        "_section_order",
        "markdown",
        "summary_json",
        "schema_version",
        "contract_version",
        "format",
        "MeetingNotes",
    ]);

    let mut candidate_keys = BTreeSet::new();
    for (key, value) in object {
        if ignored_keys.contains(key.as_str()) {
            continue;
        }
        if looks_like_legacy_section(value) {
            candidate_keys.insert(key.clone());
        }
    }

    let mut final_keys = Vec::new();
    for key in ordered_keys {
        if candidate_keys.remove(&key) {
            final_keys.push(key);
        }
    }
    final_keys.extend(candidate_keys.into_iter());

    let mut sections = Vec::new();
    for key in final_keys {
        if let Some(section_obj) = object.get(&key).and_then(Value::as_object) {
            if let Some(parsed) = parse_section_map(section_obj, Some(&key)) {
                sections.push(parsed);
            }
        }
    }

    sections
}

fn looks_like_legacy_section(value: &Value) -> bool {
    value
        .as_object()
        .map(|section| section.contains_key("title") || section.contains_key("blocks"))
        .unwrap_or(false)
}

fn parse_section_map(
    section: &Map<String, Value>,
    fallback_title: Option<&str>,
) -> Option<LegacyMarkdownSection> {
    let title = section
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| fallback_title.map(str::to_string))
        .unwrap_or_else(|| "Untitled Section".to_string());

    let blocks = section.get("blocks").and_then(Value::as_array)?;
    let mut lines = Vec::new();

    for block in blocks {
        if let Some(line) = legacy_block_to_markdown_line(block) {
            lines.push(line);
        }
    }

    if lines.is_empty() {
        return None;
    }

    Some(LegacyMarkdownSection {
        title,
        body: lines.join("\n"),
    })
}

fn legacy_block_to_markdown_line(block: &Value) -> Option<String> {
    let block_obj = block.as_object()?;
    let content = extract_block_content_text(block_obj.get("content")?)?;
    if content.trim().is_empty() {
        return None;
    }

    let block_type = block_obj
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("bullet");

    let prefix = match block_type {
        "bullet" => "- ",
        "numbered" => "1. ",
        _ => "",
    };

    Some(format!("{}{}", prefix, content.trim()))
}

fn extract_block_content_text(value: &Value) -> Option<String> {
    match value {
        Value::String(content) => Some(content.to_string()),
        Value::Array(parts) => {
            let mut output = String::new();
            for part in parts {
                if let Some(text) = part.as_str() {
                    output.push_str(text);
                    continue;
                }
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    output.push_str(text);
                }
            }
            if output.is_empty() {
                None
            } else {
                Some(output)
            }
        }
        _ => None,
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct StartupMigrationReport {
    pub scanned: usize,
    pub already_canonical: usize,
    pub migrated: usize,
    pub failed: usize,
}

#[derive(Debug, Clone, FromRow)]
struct SummaryRowForMigration {
    meeting_id: String,
    result: String,
}

pub async fn run_startup_migration(
    pool: &SqlitePool,
) -> Result<StartupMigrationReport, sqlx::Error> {
    let rows: Vec<SummaryRowForMigration> =
        sqlx::query_as("SELECT meeting_id, result FROM summary_processes WHERE result IS NOT NULL")
            .fetch_all(pool)
            .await?;

    let mut report = StartupMigrationReport::default();
    report.scanned = rows.len();

    for row in rows {
        let raw_result = row.result.clone();
        let parsed_value: Value = match serde_json::from_str(&raw_result) {
            Ok(value) => value,
            Err(error) => {
                mark_row_incompatible(
                    pool,
                    &row.meeting_id,
                    &raw_result,
                    &format!("invalid JSON payload: {}", error),
                )
                .await?;
                report.failed += 1;
                continue;
            }
        };

        if validate_summary_payload_value(&parsed_value).is_ok() {
            report.already_canonical += 1;
            continue;
        }

        match migrate_legacy_summary_payload(&parsed_value) {
            Ok(payload) => {
                let canonical_payload = payload.to_json_value();
                let canonical_string =
                    serde_json::to_string(&canonical_payload).map_err(|error| {
                        sqlx::Error::Protocol(format!(
                            "failed to serialize canonical summary payload for {}: {}",
                            row.meeting_id, error
                        ))
                    })?;

                let now = Utc::now();
                sqlx::query(
                    "UPDATE summary_processes SET result = ?, updated_at = ? WHERE meeting_id = ?",
                )
                .bind(canonical_string)
                .bind(now)
                .bind(&row.meeting_id)
                .execute(pool)
                .await?;

                report.migrated += 1;
            }
            Err(error) => {
                mark_row_incompatible(pool, &row.meeting_id, &raw_result, &error.message).await?;
                report.failed += 1;
            }
        }
    }

    Ok(report)
}

async fn mark_row_incompatible(
    pool: &SqlitePool,
    meeting_id: &str,
    raw_result: &str,
    reason: &str,
) -> Result<(), sqlx::Error> {
    let now = Utc::now();
    let migration_error = format!(
        "summary-contract-v0.1.0 incompatible payload; migration failed: {}",
        reason
    );

    sqlx::query(
        r#"
        UPDATE summary_processes
        SET
            status = 'failed',
            error = ?,
            result_backup = ?,
            result_backup_timestamp = ?,
            result = NULL,
            updated_at = ?,
            end_time = ?
        WHERE meeting_id = ?
        "#,
    )
    .bind(migration_error)
    .bind(raw_result)
    .bind(now)
    .bind(now)
    .bind(now)
    .bind(meeting_id)
    .execute(pool)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validates_markdown_payload() {
        let payload = json!({
            "schema_version": 1,
            "contract_version": "v0.1.0",
            "format": "markdown",
            "markdown": "## Notes\n- item"
        });

        let parsed = validate_summary_payload_value(&payload).expect("payload should validate");
        assert!(matches!(parsed, SummaryPayload::Markdown(_)));
    }

    #[test]
    fn validates_blocknote_payload() {
        let payload = json!({
            "schema_version": 1,
            "contract_version": "v0.1.0",
            "format": "blocknote",
            "markdown": "hello",
            "summary_json": [
                {
                    "id": "block-1",
                    "type": "paragraph",
                    "props": {
                        "textColor": "default"
                    }
                }
            ]
        });

        let parsed = validate_summary_payload_value(&payload).expect("payload should validate");
        assert!(matches!(parsed, SummaryPayload::Blocknote(_)));
    }

    #[test]
    fn rejects_bad_versions_and_unknown_fields() {
        let payload = json!({
            "schema_version": 2,
            "contract_version": "v0.1.1",
            "format": "markdown",
            "markdown": "hello",
            "extra": true
        });

        let error = validate_summary_payload_value(&payload).expect_err("payload should fail");
        assert_eq!(error.code, "SUMMARY_PAYLOAD_INVALID");
        assert!(!error.details.is_empty());
    }

    #[test]
    fn migrates_old_markdown_payload() {
        let legacy = json!({
            "markdown": "## Notes\n- item"
        });

        let migrated = migrate_legacy_summary_payload(&legacy).expect("migration should succeed");
        let migrated_json = migrated.to_json_value();

        assert_eq!(migrated_json["schema_version"], 1);
        assert_eq!(migrated_json["contract_version"], "v0.1.0");
        assert_eq!(migrated_json["format"], "markdown");
    }

    #[test]
    fn migrates_old_blocknote_payload() {
        let legacy = json!({
            "markdown": "hello",
            "summary_json": [
                {
                    "id": "block-1",
                    "type": "paragraph",
                    "custom_field": "kept"
                }
            ]
        });

        let migrated = migrate_legacy_summary_payload(&legacy).expect("migration should succeed");
        let migrated_json = migrated.to_json_value();

        assert_eq!(migrated_json["format"], "blocknote");
        assert_eq!(migrated_json["summary_json"][0]["custom_field"], "kept");
    }

    #[test]
    fn migrates_legacy_sections_to_markdown_payload() {
        let legacy = json!({
            "MeetingName": "Daily Sync",
            "_section_order": ["ActionItems", "Decisions"],
            "ActionItems": {
                "title": "Action Items",
                "blocks": [
                    { "type": "bullet", "content": "Ship the patch" }
                ]
            },
            "Decisions": {
                "title": "Decisions",
                "blocks": [
                    { "type": "text", "content": "Roll out on Friday" }
                ]
            }
        });

        let migrated = migrate_legacy_summary_payload(&legacy).expect("migration should succeed");
        let migrated_json = migrated.to_json_value();
        let markdown = migrated_json["markdown"]
            .as_str()
            .expect("markdown should be string");

        assert_eq!(migrated_json["format"], "markdown");
        assert!(markdown.contains("# Daily Sync"));
        assert!(markdown.contains("## Action Items"));
        assert!(markdown.contains("- Ship the patch"));
        assert!(markdown.contains("## Decisions"));
    }

    #[test]
    fn malformed_legacy_payload_fails_migration() {
        let legacy = json!({
            "summary_json": "not-an-array"
        });

        let error = migrate_legacy_summary_payload(&legacy).expect_err("migration should fail");
        assert_eq!(error.code, "SUMMARY_MIGRATION_FAILED");
    }

    #[tokio::test]
    async fn startup_migration_rewrites_rows_and_marks_invalid_rows_failed() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite pool");

        sqlx::query(
            r#"
            CREATE TABLE summary_processes (
                meeting_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                error TEXT,
                result TEXT,
                start_time TEXT,
                end_time TEXT,
                chunk_count INTEGER DEFAULT 0,
                processing_time REAL DEFAULT 0.0,
                metadata TEXT,
                result_backup TEXT,
                result_backup_timestamp TEXT
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create summary_processes");

        let now = Utc::now().to_rfc3339();
        let canonical = json!({
            "schema_version": 1,
            "contract_version": "v0.1.0",
            "format": "markdown",
            "markdown": "already canonical"
        });
        let legacy_markdown = json!({
            "markdown": "legacy markdown"
        });
        let legacy_sections = json!({
            "Agenda": {
                "title": "Agenda",
                "blocks": [{ "type": "bullet", "content": "Demo" }]
            }
        });
        let malformed = "{not-json";

        for (meeting_id, result) in [
            ("m1", serde_json::to_string(&canonical).unwrap()),
            ("m2", serde_json::to_string(&legacy_markdown).unwrap()),
            ("m3", serde_json::to_string(&legacy_sections).unwrap()),
            ("m4", malformed.to_string()),
        ] {
            sqlx::query(
                r#"
                INSERT INTO summary_processes (
                    meeting_id, status, created_at, updated_at, result
                ) VALUES (?, 'completed', ?, ?, ?)
                "#,
            )
            .bind(meeting_id)
            .bind(&now)
            .bind(&now)
            .bind(result)
            .execute(&pool)
            .await
            .expect("insert row");
        }

        let report = run_startup_migration(&pool)
            .await
            .expect("migration should run");
        assert_eq!(
            report,
            StartupMigrationReport {
                scanned: 4,
                already_canonical: 1,
                migrated: 2,
                failed: 1,
            }
        );

        let migrated_row_m2: (String,) =
            sqlx::query_as("SELECT result FROM summary_processes WHERE meeting_id = 'm2'")
                .fetch_one(&pool)
                .await
                .expect("row m2");
        let migrated_m2_value: Value =
            serde_json::from_str(&migrated_row_m2.0).expect("m2 result must be JSON");
        assert!(validate_summary_payload_value(&migrated_m2_value).is_ok());
        assert_eq!(migrated_m2_value["format"], "markdown");

        let migrated_row_m3: (String,) =
            sqlx::query_as("SELECT result FROM summary_processes WHERE meeting_id = 'm3'")
                .fetch_one(&pool)
                .await
                .expect("row m3");
        let migrated_m3_value: Value =
            serde_json::from_str(&migrated_row_m3.0).expect("m3 result must be JSON");
        assert!(validate_summary_payload_value(&migrated_m3_value).is_ok());

        let failed_row: (Option<String>, String, Option<String>) = sqlx::query_as(
            "SELECT result, status, result_backup FROM summary_processes WHERE meeting_id = 'm4'",
        )
        .fetch_one(&pool)
        .await
        .expect("row m4");
        assert!(failed_row.0.is_none());
        assert_eq!(failed_row.1, "failed");
        assert_eq!(failed_row.2.as_deref(), Some(malformed));
    }
}
