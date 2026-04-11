use crate::database::models::ActionItemModel;
use chrono::Utc;
use sqlx::{Error as SqlxError, SqlitePool};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct NewActionItem {
    pub title: String,
    pub details: Option<String>,
    pub owner_speaker_identity_id: Option<String>,
    pub owner_display_name: Option<String>,
    pub due_date: Option<String>,
    pub status: String,
    pub review_status: String,
    pub source_transcript_id: Option<String>,
    pub source_start_ms: Option<i64>,
    pub source_end_ms: Option<i64>,
    pub source_excerpt: Option<String>,
    pub extraction_method: String,
    pub extraction_version: String,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateActionItemReview {
    pub title: Option<String>,
    pub details: Option<Option<String>>,
    pub owner_speaker_identity_id: Option<Option<String>>,
    pub owner_display_name: Option<Option<String>>,
    pub due_date: Option<Option<String>>,
    pub review_status: String,
}

pub struct ActionItemsRepository;

#[derive(Debug, Clone)]
struct PersistedActionItemRow {
    id: String,
    meeting_id: String,
    title: String,
    details: Option<String>,
    owner_speaker_identity_id: Option<String>,
    owner_display_name: Option<String>,
    due_date: Option<String>,
    status: String,
    review_status: String,
    source_transcript_id: Option<String>,
    source_start_ms: Option<i64>,
    source_end_ms: Option<i64>,
    source_excerpt: Option<String>,
    extraction_method: String,
    extraction_version: String,
    created_at: String,
    updated_at: String,
}

impl ActionItemsRepository {
    pub async fn replace_meeting_action_items(
        pool: &SqlitePool,
        meeting_id: &str,
        items: &[NewActionItem],
    ) -> Result<(), SqlxError> {
        let now = Utc::now().to_rfc3339();
        let mut tx = pool.begin().await?;
        let mut existing = sqlx::query_as::<_, ActionItemModel>(
            "SELECT id, meeting_id, title, details, owner_speaker_identity_id, owner_display_name,
                    due_date, status, review_status, source_transcript_id, source_start_ms,
                    source_end_ms, source_excerpt, extraction_method, extraction_version,
                    created_at, updated_at
             FROM action_items
             WHERE meeting_id = ?
             ORDER BY created_at ASC",
        )
        .bind(meeting_id)
        .fetch_all(&mut *tx)
        .await?;

        let mut rows_to_persist: Vec<PersistedActionItemRow> = Vec::new();

        for item in items {
            let title = item.title.trim();
            if title.is_empty() {
                continue;
            }
            let matched_index = find_matching_action_item_index(&existing, title);

            if let Some(index) = matched_index {
                let matched = existing.remove(index);
                let preserve_reviewed_fields = is_reviewed(&matched.review_status);

                rows_to_persist.push(PersistedActionItemRow {
                    id: matched.id,
                    meeting_id: matched.meeting_id,
                    title: if preserve_reviewed_fields {
                        matched.title
                    } else {
                        title.to_string()
                    },
                    details: if preserve_reviewed_fields {
                        matched.details
                    } else {
                        item.details.clone()
                    },
                    owner_speaker_identity_id: if preserve_reviewed_fields {
                        matched.owner_speaker_identity_id
                    } else {
                        item.owner_speaker_identity_id.clone()
                    },
                    owner_display_name: if preserve_reviewed_fields {
                        matched.owner_display_name
                    } else {
                        item.owner_display_name.clone()
                    },
                    due_date: if preserve_reviewed_fields {
                        matched.due_date
                    } else {
                        item.due_date.clone()
                    },
                    // Preserve explicit progress state set during review.
                    status: matched.status,
                    review_status: if preserve_reviewed_fields {
                        matched.review_status
                    } else {
                        item.review_status.clone()
                    },
                    source_transcript_id: item.source_transcript_id.clone(),
                    source_start_ms: item.source_start_ms,
                    source_end_ms: item.source_end_ms,
                    source_excerpt: item.source_excerpt.clone(),
                    extraction_method: item.extraction_method.clone(),
                    extraction_version: item.extraction_version.clone(),
                    created_at: matched.created_at,
                    updated_at: now.clone(),
                });
                continue;
            }

            rows_to_persist.push(PersistedActionItemRow {
                id: format!("action-item-{}", Uuid::new_v4()),
                meeting_id: meeting_id.to_string(),
                title: title.to_string(),
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
                created_at: now.clone(),
                updated_at: now.clone(),
            });
        }

        // Preserve reviewed/progressed records if an extraction pass no longer emits them.
        for leftover in existing {
            if is_reviewed(&leftover.review_status) || !leftover.status.eq_ignore_ascii_case("open")
            {
                rows_to_persist.push(PersistedActionItemRow {
                    id: leftover.id,
                    meeting_id: leftover.meeting_id,
                    title: leftover.title,
                    details: leftover.details,
                    owner_speaker_identity_id: leftover.owner_speaker_identity_id,
                    owner_display_name: leftover.owner_display_name,
                    due_date: leftover.due_date,
                    status: leftover.status,
                    review_status: leftover.review_status,
                    source_transcript_id: leftover.source_transcript_id,
                    source_start_ms: leftover.source_start_ms,
                    source_end_ms: leftover.source_end_ms,
                    source_excerpt: leftover.source_excerpt,
                    extraction_method: leftover.extraction_method,
                    extraction_version: leftover.extraction_version,
                    created_at: leftover.created_at,
                    updated_at: now.clone(),
                });
            }
        }

        sqlx::query("DELETE FROM action_items WHERE meeting_id = ?")
            .bind(meeting_id)
            .execute(&mut *tx)
            .await?;

        for row in rows_to_persist {
            sqlx::query(
                "INSERT INTO action_items (
                    id, meeting_id, title, details, owner_speaker_identity_id, owner_display_name,
                    due_date, status, review_status, source_transcript_id, source_start_ms,
                    source_end_ms, source_excerpt, extraction_method, extraction_version,
                    created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&row.id)
            .bind(&row.meeting_id)
            .bind(&row.title)
            .bind(&row.details)
            .bind(&row.owner_speaker_identity_id)
            .bind(&row.owner_display_name)
            .bind(&row.due_date)
            .bind(&row.status)
            .bind(&row.review_status)
            .bind(&row.source_transcript_id)
            .bind(row.source_start_ms)
            .bind(row.source_end_ms)
            .bind(&row.source_excerpt)
            .bind(&row.extraction_method)
            .bind(&row.extraction_version)
            .bind(&row.created_at)
            .bind(&row.updated_at)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn list_meeting_action_items(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<ActionItemModel>, SqlxError> {
        sqlx::query_as::<_, ActionItemModel>(
            "SELECT id, meeting_id, title, details, owner_speaker_identity_id, owner_display_name,
                    due_date, status, review_status, source_transcript_id, source_start_ms,
                    source_end_ms, source_excerpt, extraction_method, extraction_version,
                    created_at, updated_at
             FROM action_items
             WHERE meeting_id = ?
             ORDER BY created_at ASC, title ASC",
        )
        .bind(meeting_id)
        .fetch_all(pool)
        .await
    }

    pub async fn update_action_item_review(
        pool: &SqlitePool,
        action_item_id: &str,
        review: UpdateActionItemReview,
    ) -> Result<bool, SqlxError> {
        let now = Utc::now().to_rfc3339();
        let current = sqlx::query_as::<_, ActionItemModel>(
            "SELECT id, meeting_id, title, details, owner_speaker_identity_id, owner_display_name,
                    due_date, status, review_status, source_transcript_id, source_start_ms,
                    source_end_ms, source_excerpt, extraction_method, extraction_version,
                    created_at, updated_at
             FROM action_items
             WHERE id = ?",
        )
        .bind(action_item_id)
        .fetch_optional(pool)
        .await?;

        let Some(current) = current else {
            return Ok(false);
        };

        let title = review.title.unwrap_or(current.title);
        let details = review.details.unwrap_or(current.details);
        let owner_speaker_identity_id = review
            .owner_speaker_identity_id
            .unwrap_or(current.owner_speaker_identity_id);
        let owner_display_name = review
            .owner_display_name
            .unwrap_or(current.owner_display_name);
        let due_date = review.due_date.unwrap_or(current.due_date);

        let result = sqlx::query(
            "UPDATE action_items
             SET title = ?, details = ?, owner_speaker_identity_id = ?, owner_display_name = ?,
                 due_date = ?, review_status = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(title)
        .bind(details)
        .bind(owner_speaker_identity_id)
        .bind(owner_display_name)
        .bind(due_date)
        .bind(review.review_status)
        .bind(now)
        .bind(action_item_id)
        .execute(pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn update_action_item_status(
        pool: &SqlitePool,
        action_item_id: &str,
        status: &str,
    ) -> Result<bool, SqlxError> {
        let result = sqlx::query(
            "UPDATE action_items
             SET status = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(status)
        .bind(Utc::now().to_rfc3339())
        .bind(action_item_id)
        .execute(pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }
}

fn normalize_match_key(title: &str) -> String {
    title
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn find_matching_action_item_index(
    existing: &[ActionItemModel],
    incoming_title: &str,
) -> Option<usize> {
    let incoming_key = normalize_match_key(incoming_title);
    if let Some(index) = existing
        .iter()
        .position(|row| normalize_match_key(&row.title) == incoming_key)
    {
        return Some(index);
    }

    let incoming_tokens = normalized_match_tokens(incoming_title);
    if incoming_tokens.is_empty() {
        return None;
    }

    existing
        .iter()
        .enumerate()
        .filter_map(|(index, row)| {
            let existing_tokens = normalized_match_tokens(&row.title);
            let score = fuzzy_match_score(&incoming_tokens, &existing_tokens)?;
            Some((index, score))
        })
        .max_by_key(|(_, score)| *score)
        .map(|(index, _)| index)
}

fn normalized_match_tokens(title: &str) -> Vec<String> {
    title
        .split(|ch: char| !ch.is_alphanumeric())
        .filter_map(|token| {
            let normalized = token.trim().to_lowercase();
            if normalized.is_empty()
                || matches!(normalized.as_str(), "a" | "an" | "the")
                || matches!(
                    normalized.as_str(),
                    "reviewed" | "confirmed" | "accepted" | "edited"
                )
            {
                None
            } else {
                Some(normalized)
            }
        })
        .collect()
}

fn fuzzy_match_score(left: &[String], right: &[String]) -> Option<usize> {
    if left.is_empty() || right.is_empty() {
        return None;
    }

    let prefix_len = common_prefix_len(left, right);
    let overlap = overlap_count(left, right);
    let subsequence_match = is_subsequence(left, right) || is_subsequence(right, left);

    if !subsequence_match || prefix_len < 2 || overlap < left.len().min(right.len()).min(3) {
        return None;
    }

    let length_closeness = 10usize.saturating_sub(usize::abs_diff(left.len(), right.len()));
    Some(prefix_len * 100 + overlap * 10 + length_closeness)
}

fn common_prefix_len(left: &[String], right: &[String]) -> usize {
    left.iter()
        .zip(right.iter())
        .take_while(|(a, b)| a == b)
        .count()
}

fn overlap_count(left: &[String], right: &[String]) -> usize {
    left.iter().filter(|token| right.contains(token)).count()
}

fn is_subsequence(needle: &[String], haystack: &[String]) -> bool {
    if needle.len() > haystack.len() {
        return false;
    }

    let mut position = 0usize;
    for token in haystack {
        if position < needle.len() && token == &needle[position] {
            position += 1;
        }
    }

    position == needle.len()
}

fn is_reviewed(review_status: &str) -> bool {
    !review_status.eq_ignore_ascii_case("unreviewed")
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

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
             VALUES (?, 'Action Item Test', '2026-04-11T00:00:00Z', '2026-04-11T00:00:00Z')",
        )
        .bind(meeting_id)
        .execute(pool)
        .await
        .expect("failed to seed meeting");
    }

    #[tokio::test]
    async fn replace_meeting_action_items_preserves_reviewed_match_and_status() {
        let pool = setup_pool_with_migrations().await;
        let meeting_id = "meeting-action-preserve";
        seed_meeting(&pool, meeting_id).await;

        ActionItemsRepository::replace_meeting_action_items(
            &pool,
            meeting_id,
            &[NewActionItem {
                title: "Prepare launch plan".to_string(),
                details: None,
                owner_speaker_identity_id: None,
                owner_display_name: None,
                due_date: None,
                status: "open".to_string(),
                review_status: "unreviewed".to_string(),
                source_transcript_id: None,
                source_start_ms: None,
                source_end_ms: None,
                source_excerpt: Some("initial".to_string()),
                extraction_method: "summary_structured".to_string(),
                extraction_version: "v0.4.0".to_string(),
            }],
        )
        .await
        .expect("initial replace should succeed");

        let original = ActionItemsRepository::list_meeting_action_items(&pool, meeting_id)
            .await
            .expect("expected action item")
            .into_iter()
            .next()
            .expect("missing action item");

        let original_id = original.id.clone();
        ActionItemsRepository::update_action_item_review(
            &pool,
            &original_id,
            UpdateActionItemReview {
                title: Some("Prepare launch plan (confirmed)".to_string()),
                owner_display_name: Some(Some("Alex".to_string())),
                due_date: Some(Some("2026-04-20".to_string())),
                review_status: "edited".to_string(),
                ..Default::default()
            },
        )
        .await
        .expect("review update should succeed");

        ActionItemsRepository::update_action_item_status(&pool, &original_id, "completed")
            .await
            .expect("status update should succeed");

        ActionItemsRepository::replace_meeting_action_items(
            &pool,
            meeting_id,
            &[NewActionItem {
                title: "Prepare launch plan".to_string(),
                details: Some("fresh extraction details".to_string()),
                owner_speaker_identity_id: None,
                owner_display_name: Some("Jordan".to_string()),
                due_date: Some("2026-05-01".to_string()),
                status: "open".to_string(),
                review_status: "unreviewed".to_string(),
                source_transcript_id: None,
                source_start_ms: None,
                source_end_ms: None,
                source_excerpt: Some("new extraction".to_string()),
                extraction_method: "summary_structured".to_string(),
                extraction_version: "v0.4.1".to_string(),
            }],
        )
        .await
        .expect("second replace should succeed");

        let final_rows = ActionItemsRepository::list_meeting_action_items(&pool, meeting_id)
            .await
            .expect("final rows");

        assert_eq!(final_rows.len(), 1);
        let row = &final_rows[0];
        assert_eq!(row.id, original_id);
        assert_eq!(row.title, "Prepare launch plan (confirmed)");
        assert_eq!(row.owner_display_name.as_deref(), Some("Alex"));
        assert_eq!(row.due_date.as_deref(), Some("2026-04-20"));
        assert_eq!(row.review_status, "edited");
        assert_eq!(row.status, "completed");
    }

    #[tokio::test]
    async fn replace_meeting_action_items_keeps_unmatched_reviewed_rows() {
        let pool = setup_pool_with_migrations().await;
        let meeting_id = "meeting-action-unmatched";
        seed_meeting(&pool, meeting_id).await;

        ActionItemsRepository::replace_meeting_action_items(
            &pool,
            meeting_id,
            &[NewActionItem {
                title: "Document API changes".to_string(),
                details: None,
                owner_speaker_identity_id: None,
                owner_display_name: None,
                due_date: None,
                status: "open".to_string(),
                review_status: "unreviewed".to_string(),
                source_transcript_id: None,
                source_start_ms: None,
                source_end_ms: None,
                source_excerpt: None,
                extraction_method: "summary_structured".to_string(),
                extraction_version: "v0.4.0".to_string(),
            }],
        )
        .await
        .expect("initial replace should succeed");

        let row = ActionItemsRepository::list_meeting_action_items(&pool, meeting_id)
            .await
            .expect("action item rows")
            .into_iter()
            .next()
            .expect("missing action item row");

        ActionItemsRepository::update_action_item_review(
            &pool,
            &row.id,
            UpdateActionItemReview {
                review_status: "accepted".to_string(),
                ..Default::default()
            },
        )
        .await
        .expect("review update should succeed");

        ActionItemsRepository::replace_meeting_action_items(&pool, meeting_id, &[])
            .await
            .expect("replace with empty set should succeed");

        let final_rows = ActionItemsRepository::list_meeting_action_items(&pool, meeting_id)
            .await
            .expect("expected preserved rows");
        assert_eq!(final_rows.len(), 1);
        assert_eq!(final_rows[0].title, "Document API changes");
        assert_eq!(final_rows[0].review_status, "accepted");
    }
}
