/// Owner identification and linking for action items.
///
/// This module provides functionality to link action item owners to Meeting_Speakers
/// and Speaker_Identities based on name matching.
use crate::database::models::MeetingSpeakerModel;
use sqlx::SqlitePool;

/// Find the best matching speaker identity ID for a given owner name
pub async fn find_owner_speaker_identity_id(
    pool: &SqlitePool,
    meeting_id: &str,
    owner_name: &str,
) -> Result<Option<String>, String> {
    let normalized_owner = normalize_name(owner_name);

    // First, try to find a meeting speaker with a matching display name override
    let meeting_speakers = sqlx::query_as::<_, MeetingSpeakerModel>(
        "SELECT id, meeting_id, diarization_speaker_number, display_name_override,
                speaker_identity_id, review_status, match_confidence, is_active,
                created_at, updated_at, last_reviewed_at, last_generated_at
         FROM meeting_speakers
         WHERE meeting_id = ? AND is_active = 1",
    )
    .bind(meeting_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to fetch meeting speakers: {}", e))?;

    // Try to match by display_name_override
    for speaker in &meeting_speakers {
        if let Some(display_name) = &speaker.display_name_override {
            if normalize_name(display_name) == normalized_owner {
                return Ok(speaker.speaker_identity_id.clone());
            }
        }
    }

    // Try to match by linked speaker identity display name
    for speaker in &meeting_speakers {
        if let Some(identity_id) = &speaker.speaker_identity_id {
            let identity = sqlx::query_as::<_, (String,)>(
                "SELECT display_name FROM speaker_identities WHERE id = ?",
            )
            .bind(identity_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to fetch speaker identity: {}", e))?;

            if let Some((display_name,)) = identity {
                if normalize_name(&display_name) == normalized_owner {
                    return Ok(Some(identity_id.clone()));
                }
            }
        }
    }

    // No match found
    Ok(None)
}

/// Normalize a name for matching (lowercase, trim whitespace, remove punctuation)
fn normalize_name(name: &str) -> String {
    name.trim()
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_name_handles_various_formats() {
        assert_eq!(normalize_name("John Doe"), "john doe");
        assert_eq!(normalize_name("  John  Doe  "), "john doe");
        assert_eq!(normalize_name("John-Doe"), "johndoe");
        assert_eq!(normalize_name("JOHN DOE"), "john doe");
        assert_eq!(normalize_name("John.Doe"), "johndoe");
    }

    #[tokio::test]
    async fn find_owner_speaker_identity_id_returns_none_for_no_match() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("failed to create pool");

        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("migrations should run");

        sqlx::query(
            "INSERT INTO meetings (id, title, created_at, updated_at)
             VALUES ('meeting-1', 'Test', '2026-04-11T00:00:00Z', '2026-04-11T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("insert meeting");

        let result = find_owner_speaker_identity_id(&pool, "meeting-1", "Unknown Person")
            .await
            .expect("query should succeed");

        assert_eq!(result, None);
    }

    #[tokio::test]
    async fn find_owner_speaker_identity_id_matches_display_name_override() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("failed to create pool");

        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("migrations should run");

        sqlx::query(
            "INSERT INTO meetings (id, title, created_at, updated_at)
             VALUES ('meeting-1', 'Test', '2026-04-11T00:00:00Z', '2026-04-11T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("insert meeting");

        sqlx::query(
            "INSERT INTO speaker_identities (id, display_name, normalized_name, created_at, updated_at)
             VALUES ('identity-1', 'John Doe', 'john doe', '2026-04-11T00:00:00Z', '2026-04-11T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("insert identity");

        sqlx::query(
            "INSERT INTO meeting_speakers (id, meeting_id, display_name_override, speaker_identity_id,
                                           review_status, is_active, created_at, updated_at)
             VALUES ('speaker-1', 'meeting-1', 'John Doe', 'identity-1', 'confirmed', 1,
                     '2026-04-11T00:00:00Z', '2026-04-11T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("insert meeting speaker");

        let result = find_owner_speaker_identity_id(&pool, "meeting-1", "John Doe")
            .await
            .expect("query should succeed");

        assert_eq!(result, Some("identity-1".to_string()));
    }

    #[tokio::test]
    async fn find_owner_speaker_identity_id_matches_linked_identity() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("failed to create pool");

        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("migrations should run");

        sqlx::query(
            "INSERT INTO meetings (id, title, created_at, updated_at)
             VALUES ('meeting-1', 'Test', '2026-04-11T00:00:00Z', '2026-04-11T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("insert meeting");

        sqlx::query(
            "INSERT INTO speaker_identities (id, display_name, normalized_name, created_at, updated_at)
             VALUES ('identity-1', 'Sarah Smith', 'sarah smith', '2026-04-11T00:00:00Z', '2026-04-11T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("insert identity");

        sqlx::query(
            "INSERT INTO meeting_speakers (id, meeting_id, speaker_identity_id,
                                           review_status, is_active, created_at, updated_at)
             VALUES ('speaker-1', 'meeting-1', 'identity-1', 'confirmed', 1,
                     '2026-04-11T00:00:00Z', '2026-04-11T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("insert meeting speaker");

        let result = find_owner_speaker_identity_id(&pool, "meeting-1", "Sarah Smith")
            .await
            .expect("query should succeed");

        assert_eq!(result, Some("identity-1".to_string()));
    }
}
