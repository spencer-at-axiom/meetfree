use crate::database::models::DecisionModel;
use chrono::Utc;
use sqlx::{Error as SqlxError, SqlitePool};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct NewDecision {
    pub title: String,
    pub details: Option<String>,
    pub review_status: String,
    pub source_transcript_id: Option<String>,
    pub source_start_ms: Option<i64>,
    pub source_end_ms: Option<i64>,
    pub source_excerpt: Option<String>,
    pub extraction_method: String,
    pub extraction_version: String,
    pub related_action_item_ids: Option<String>, // JSON array of action item IDs
}

#[derive(Debug, Clone, Default)]
pub struct UpdateDecisionReview {
    pub title: Option<String>,
    pub details: Option<Option<String>>,
    pub review_status: String,
}

pub struct DecisionsRepository;

#[derive(Debug, Clone)]
struct PersistedDecisionRow {
    id: String,
    meeting_id: String,
    title: String,
    details: Option<String>,
    review_status: String,
    source_transcript_id: Option<String>,
    source_start_ms: Option<i64>,
    source_end_ms: Option<i64>,
    source_excerpt: Option<String>,
    extraction_method: String,
    extraction_version: String,
    related_action_item_ids: Option<String>,
    created_at: String,
    updated_at: String,
}

impl DecisionsRepository {
    pub async fn replace_meeting_decisions(
        pool: &SqlitePool,
        meeting_id: &str,
        decisions: &[NewDecision],
    ) -> Result<(), SqlxError> {
        let now = Utc::now().to_rfc3339();
        let mut tx = pool.begin().await?;
        let mut existing = sqlx::query_as::<_, DecisionModel>(
            "SELECT id, meeting_id, title, details, review_status, source_transcript_id,
                    source_start_ms, source_end_ms, source_excerpt, extraction_method,
                    extraction_version, related_action_item_ids, created_at, updated_at
             FROM decisions
             WHERE meeting_id = ?
             ORDER BY created_at ASC",
        )
        .bind(meeting_id)
        .fetch_all(&mut *tx)
        .await?;

        let mut rows_to_persist: Vec<PersistedDecisionRow> = Vec::new();

        for decision in decisions {
            let title = decision.title.trim();
            if title.is_empty() {
                continue;
            }
            let matched_index = find_matching_decision_index(&existing, title);

            if let Some(index) = matched_index {
                let matched = existing.remove(index);
                let preserve_reviewed_fields = is_reviewed(&matched.review_status);

                rows_to_persist.push(PersistedDecisionRow {
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
                        decision.details.clone()
                    },
                    review_status: if preserve_reviewed_fields {
                        matched.review_status
                    } else {
                        decision.review_status.clone()
                    },
                    source_transcript_id: decision.source_transcript_id.clone(),
                    source_start_ms: decision.source_start_ms,
                    source_end_ms: decision.source_end_ms,
                    source_excerpt: decision.source_excerpt.clone(),
                    extraction_method: decision.extraction_method.clone(),
                    extraction_version: decision.extraction_version.clone(),
                    related_action_item_ids: decision.related_action_item_ids.clone(),
                    created_at: matched.created_at,
                    updated_at: now.clone(),
                });
                continue;
            }

            rows_to_persist.push(PersistedDecisionRow {
                id: format!("decision-{}", Uuid::new_v4()),
                meeting_id: meeting_id.to_string(),
                title: title.to_string(),
                details: decision.details.clone(),
                review_status: decision.review_status.clone(),
                source_transcript_id: decision.source_transcript_id.clone(),
                source_start_ms: decision.source_start_ms,
                source_end_ms: decision.source_end_ms,
                source_excerpt: decision.source_excerpt.clone(),
                extraction_method: decision.extraction_method.clone(),
                extraction_version: decision.extraction_version.clone(),
                related_action_item_ids: decision.related_action_item_ids.clone(),
                created_at: now.clone(),
                updated_at: now.clone(),
            });
        }

        for leftover in existing {
            if is_reviewed(&leftover.review_status) {
                rows_to_persist.push(PersistedDecisionRow {
                    id: leftover.id,
                    meeting_id: leftover.meeting_id,
                    title: leftover.title,
                    details: leftover.details,
                    review_status: leftover.review_status,
                    source_transcript_id: leftover.source_transcript_id,
                    source_start_ms: leftover.source_start_ms,
                    source_end_ms: leftover.source_end_ms,
                    source_excerpt: leftover.source_excerpt,
                    extraction_method: leftover.extraction_method,
                    extraction_version: leftover.extraction_version,
                    related_action_item_ids: leftover.related_action_item_ids,
                    created_at: leftover.created_at,
                    updated_at: now.clone(),
                });
            }
        }

        sqlx::query("DELETE FROM decisions WHERE meeting_id = ?")
            .bind(meeting_id)
            .execute(&mut *tx)
            .await?;

        for row in rows_to_persist {
            sqlx::query(
                "INSERT INTO decisions (
                    id, meeting_id, title, details, review_status, source_transcript_id,
                    source_start_ms, source_end_ms, source_excerpt, extraction_method,
                    extraction_version, related_action_item_ids, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&row.id)
            .bind(&row.meeting_id)
            .bind(&row.title)
            .bind(&row.details)
            .bind(&row.review_status)
            .bind(&row.source_transcript_id)
            .bind(row.source_start_ms)
            .bind(row.source_end_ms)
            .bind(&row.source_excerpt)
            .bind(&row.extraction_method)
            .bind(&row.extraction_version)
            .bind(&row.related_action_item_ids)
            .bind(&row.created_at)
            .bind(&row.updated_at)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn list_meeting_decisions(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<DecisionModel>, SqlxError> {
        sqlx::query_as::<_, DecisionModel>(
            "SELECT id, meeting_id, title, details, review_status, source_transcript_id,
                    source_start_ms, source_end_ms, source_excerpt, extraction_method,
                    extraction_version, related_action_item_ids, created_at, updated_at
             FROM decisions
             WHERE meeting_id = ?
             ORDER BY created_at ASC, title ASC",
        )
        .bind(meeting_id)
        .fetch_all(pool)
        .await
    }

    pub async fn update_decision_review(
        pool: &SqlitePool,
        decision_id: &str,
        review: UpdateDecisionReview,
    ) -> Result<bool, SqlxError> {
        let current = sqlx::query_as::<_, DecisionModel>(
            "SELECT id, meeting_id, title, details, review_status, source_transcript_id,
                    source_start_ms, source_end_ms, source_excerpt, extraction_method,
                    extraction_version, related_action_item_ids, created_at, updated_at
             FROM decisions
             WHERE id = ?",
        )
        .bind(decision_id)
        .fetch_optional(pool)
        .await?;

        let Some(current) = current else {
            return Ok(false);
        };

        let result = sqlx::query(
            "UPDATE decisions
             SET title = ?, details = ?, review_status = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(review.title.unwrap_or(current.title))
        .bind(review.details.unwrap_or(current.details))
        .bind(review.review_status)
        .bind(Utc::now().to_rfc3339())
        .bind(decision_id)
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

fn find_matching_decision_index(existing: &[DecisionModel], incoming_title: &str) -> Option<usize> {
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
             VALUES (?, 'Decision Test', '2026-04-11T00:00:00Z', '2026-04-11T00:00:00Z')",
        )
        .bind(meeting_id)
        .execute(pool)
        .await
        .expect("failed to seed meeting");
    }

    #[tokio::test]
    async fn replace_meeting_decisions_preserves_reviewed_match() {
        let pool = setup_pool_with_migrations().await;
        let meeting_id = "meeting-decision-preserve";
        seed_meeting(&pool, meeting_id).await;

        DecisionsRepository::replace_meeting_decisions(
            &pool,
            meeting_id,
            &[NewDecision {
                title: "Ship beta behind a flag".to_string(),
                details: None,
                review_status: "unreviewed".to_string(),
                source_transcript_id: None,
                source_start_ms: None,
                source_end_ms: None,
                source_excerpt: None,
                extraction_method: "summary_structured".to_string(),
                extraction_version: "v0.4.0".to_string(),
                related_action_item_ids: None,
            }],
        )
        .await
        .expect("initial replace should succeed");

        let original = DecisionsRepository::list_meeting_decisions(&pool, meeting_id)
            .await
            .expect("list decisions")
            .into_iter()
            .next()
            .expect("missing decision");

        let original_id = original.id.clone();
        DecisionsRepository::update_decision_review(
            &pool,
            &original_id,
            UpdateDecisionReview {
                title: Some("Ship beta behind feature flag (confirmed)".to_string()),
                review_status: "edited".to_string(),
                ..Default::default()
            },
        )
        .await
        .expect("review update should succeed");

        DecisionsRepository::replace_meeting_decisions(
            &pool,
            meeting_id,
            &[NewDecision {
                title: "Ship beta behind a flag".to_string(),
                details: Some("fresh extraction".to_string()),
                review_status: "unreviewed".to_string(),
                source_transcript_id: None,
                source_start_ms: None,
                source_end_ms: None,
                source_excerpt: None,
                extraction_method: "summary_structured".to_string(),
                extraction_version: "v0.4.1".to_string(),
                related_action_item_ids: None,
            }],
        )
        .await
        .expect("second replace should succeed");

        let final_rows = DecisionsRepository::list_meeting_decisions(&pool, meeting_id)
            .await
            .expect("final rows");

        assert_eq!(final_rows.len(), 1);
        let row = &final_rows[0];
        assert_eq!(row.id, original_id);
        assert_eq!(row.title, "Ship beta behind feature flag (confirmed)");
        assert_eq!(row.review_status, "edited");
    }

    #[tokio::test]
    async fn replace_meeting_decisions_keeps_unmatched_reviewed_rows() {
        let pool = setup_pool_with_migrations().await;
        let meeting_id = "meeting-decision-unmatched";
        seed_meeting(&pool, meeting_id).await;

        DecisionsRepository::replace_meeting_decisions(
            &pool,
            meeting_id,
            &[NewDecision {
                title: "Keep desktop-first scope".to_string(),
                details: None,
                review_status: "unreviewed".to_string(),
                source_transcript_id: None,
                source_start_ms: None,
                source_end_ms: None,
                source_excerpt: None,
                extraction_method: "summary_structured".to_string(),
                extraction_version: "v0.4.0".to_string(),
                related_action_item_ids: None,
            }],
        )
        .await
        .expect("initial replace should succeed");

        let row = DecisionsRepository::list_meeting_decisions(&pool, meeting_id)
            .await
            .expect("decision rows")
            .into_iter()
            .next()
            .expect("missing decision row");

        DecisionsRepository::update_decision_review(
            &pool,
            &row.id,
            UpdateDecisionReview {
                review_status: "accepted".to_string(),
                ..Default::default()
            },
        )
        .await
        .expect("review update should succeed");

        DecisionsRepository::replace_meeting_decisions(&pool, meeting_id, &[])
            .await
            .expect("replace with empty should succeed");

        let final_rows = DecisionsRepository::list_meeting_decisions(&pool, meeting_id)
            .await
            .expect("final rows");
        assert_eq!(final_rows.len(), 1);
        assert_eq!(final_rows[0].title, "Keep desktop-first scope");
        assert_eq!(final_rows[0].review_status, "accepted");
    }
}
