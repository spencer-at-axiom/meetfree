use crate::database::models::{MeetingSpeakerModel, SpeakerIdentityModel, VoiceProfileModel};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{Error as SqlxError, FromRow, SqlitePool};
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct IdentityMeetingAppearance {
    pub meeting_id: String,
    pub meeting_title: String,
    pub meeting_date: String,
    pub speaker_display_name: Option<String>,
    pub meeting_speaker_id: String,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct IdentityActionItem {
    pub id: String,
    pub meeting_id: String,
    pub title: String,
    pub details: Option<String>,
    pub owner_display_name: Option<String>,
    pub due_date: Option<String>,
    pub status: String,
    pub review_status: String,
    pub created_at: String,
    pub meeting_title: String,
    pub meeting_date: String,
}

#[derive(Debug, Clone)]
pub struct NewVoiceProfile {
    pub speaker_identity_id: String,
    pub profile_kind: String,
    pub provider: Option<String>,
    pub model_version: Option<String>,
    pub sample_count: i64,
    pub profile_payload: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateVoiceProfile {
    pub profile_kind: Option<String>,
    pub provider: Option<Option<String>>,
    pub model_version: Option<Option<String>>,
    pub sample_count: Option<i64>,
    pub profile_payload: Option<Option<String>>,
}

#[derive(Debug, Clone)]
pub struct NewMeetingSpeaker {
    pub meeting_id: String,
    pub diarization_speaker_number: Option<i64>,
    pub display_name_override: Option<String>,
    pub speaker_identity_id: Option<String>,
    pub review_status: String,
    pub match_confidence: Option<f64>,
    pub is_active: bool,
}

pub struct SpeakerIdentitiesRepository;

impl SpeakerIdentitiesRepository {
    pub async fn create_identity(
        pool: &SqlitePool,
        display_name: &str,
        notes: Option<&str>,
    ) -> Result<SpeakerIdentityModel, SqlxError> {
        let display_name = display_name.trim();
        if display_name.is_empty() {
            return Err(SqlxError::Protocol(
                "display_name cannot be empty".to_string(),
            ));
        }

        let now = Utc::now().to_rfc3339();
        let id = format!("speaker-{}", Uuid::new_v4());
        let normalized_name = normalize_name(display_name);

        sqlx::query(
            "INSERT INTO speaker_identities (
                id, display_name, normalized_name, notes, created_at, updated_at, archived_at
             ) VALUES (?, ?, ?, ?, ?, ?, NULL)",
        )
        .bind(&id)
        .bind(display_name)
        .bind(&normalized_name)
        .bind(notes)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await?;

        Self::get_identity(pool, &id)
            .await?
            .ok_or_else(|| SqlxError::RowNotFound)
    }

    pub async fn get_identity(
        pool: &SqlitePool,
        identity_id: &str,
    ) -> Result<Option<SpeakerIdentityModel>, SqlxError> {
        sqlx::query_as::<_, SpeakerIdentityModel>(
            "SELECT id, display_name, normalized_name, notes, created_at, updated_at, archived_at
             FROM speaker_identities
             WHERE id = ?",
        )
        .bind(identity_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn list_identities(
        pool: &SqlitePool,
    ) -> Result<Vec<SpeakerIdentityModel>, SqlxError> {
        sqlx::query_as::<_, SpeakerIdentityModel>(
            "SELECT id, display_name, normalized_name, notes, created_at, updated_at, archived_at
             FROM speaker_identities
             ORDER BY updated_at DESC, created_at DESC",
        )
        .fetch_all(pool)
        .await
    }

    pub async fn update_identity_name(
        pool: &SqlitePool,
        identity_id: &str,
        display_name: &str,
    ) -> Result<bool, SqlxError> {
        let display_name = display_name.trim();
        if display_name.is_empty() {
            return Err(SqlxError::Protocol(
                "display_name cannot be empty".to_string(),
            ));
        }

        let now = Utc::now().to_rfc3339();
        let normalized_name = normalize_name(display_name);
        let result = sqlx::query(
            "UPDATE speaker_identities
             SET display_name = ?, normalized_name = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(display_name)
        .bind(normalized_name)
        .bind(now)
        .bind(identity_id)
        .execute(pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn update_identity_notes(
        pool: &SqlitePool,
        identity_id: &str,
        notes: Option<&str>,
    ) -> Result<bool, SqlxError> {
        let now = Utc::now().to_rfc3339();
        let result = sqlx::query(
            "UPDATE speaker_identities
             SET notes = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(notes)
        .bind(now)
        .bind(identity_id)
        .execute(pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn merge_identities(
        pool: &SqlitePool,
        source_identity_id: &str,
        target_identity_id: &str,
    ) -> Result<(), SqlxError> {
        if source_identity_id == target_identity_id {
            return Ok(());
        }

        let now = Utc::now().to_rfc3339();
        let mut tx = pool.begin().await?;

        sqlx::query(
            "UPDATE meeting_speakers
             SET speaker_identity_id = ?, updated_at = ?
             WHERE speaker_identity_id = ?",
        )
        .bind(target_identity_id)
        .bind(&now)
        .bind(source_identity_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "UPDATE action_items
             SET owner_speaker_identity_id = ?, updated_at = ?
             WHERE owner_speaker_identity_id = ?",
        )
        .bind(target_identity_id)
        .bind(&now)
        .bind(source_identity_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "UPDATE voice_profiles
             SET speaker_identity_id = ?, updated_at = ?
             WHERE speaker_identity_id = ?",
        )
        .bind(target_identity_id)
        .bind(&now)
        .bind(source_identity_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "UPDATE speaker_identities
             SET archived_at = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(&now)
        .bind(&now)
        .bind(source_identity_id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(())
    }

    pub async fn archive_identity(pool: &SqlitePool, identity_id: &str) -> Result<bool, SqlxError> {
        let now = Utc::now().to_rfc3339();
        let result = sqlx::query(
            "UPDATE speaker_identities
             SET archived_at = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(&now)
        .bind(&now)
        .bind(identity_id)
        .execute(pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn add_voice_profile(
        pool: &SqlitePool,
        new_profile: NewVoiceProfile,
    ) -> Result<VoiceProfileModel, SqlxError> {
        let now = Utc::now().to_rfc3339();
        let id = format!("voice-profile-{}", Uuid::new_v4());

        sqlx::query(
            "INSERT INTO voice_profiles (
                id, speaker_identity_id, profile_kind, provider, model_version,
                sample_count, profile_payload, created_at, updated_at, last_trained_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&new_profile.speaker_identity_id)
        .bind(&new_profile.profile_kind)
        .bind(&new_profile.provider)
        .bind(&new_profile.model_version)
        .bind(new_profile.sample_count)
        .bind(&new_profile.profile_payload)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await?;

        sqlx::query_as::<_, VoiceProfileModel>(
            "SELECT id, speaker_identity_id, profile_kind, provider, model_version,
                    sample_count, profile_payload, created_at, updated_at, last_trained_at
             FROM voice_profiles
             WHERE id = ?",
        )
        .bind(id)
        .fetch_one(pool)
        .await
    }

    pub async fn update_voice_profile(
        pool: &SqlitePool,
        voice_profile_id: &str,
        updates: UpdateVoiceProfile,
    ) -> Result<bool, SqlxError> {
        let existing = sqlx::query_as::<_, VoiceProfileModel>(
            "SELECT id, speaker_identity_id, profile_kind, provider, model_version,
                    sample_count, profile_payload, created_at, updated_at, last_trained_at
             FROM voice_profiles
             WHERE id = ?",
        )
        .bind(voice_profile_id)
        .fetch_optional(pool)
        .await?;

        let Some(existing) = existing else {
            return Ok(false);
        };

        let profile_kind = updates.profile_kind.unwrap_or(existing.profile_kind);
        let provider = updates.provider.unwrap_or(existing.provider);
        let model_version = updates.model_version.unwrap_or(existing.model_version);
        let sample_count = updates.sample_count.unwrap_or(existing.sample_count);
        let profile_payload = updates.profile_payload.unwrap_or(existing.profile_payload);
        let now = Utc::now().to_rfc3339();

        let result = sqlx::query(
            "UPDATE voice_profiles
             SET profile_kind = ?, provider = ?, model_version = ?, sample_count = ?,
                 profile_payload = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(profile_kind)
        .bind(provider)
        .bind(model_version)
        .bind(sample_count)
        .bind(profile_payload)
        .bind(now)
        .bind(voice_profile_id)
        .execute(pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn delete_voice_profile(
        pool: &SqlitePool,
        voice_profile_id: &str,
    ) -> Result<bool, SqlxError> {
        let result = sqlx::query("DELETE FROM voice_profiles WHERE id = ?")
            .bind(voice_profile_id)
            .execute(pool)
            .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn create_meeting_speaker(
        pool: &SqlitePool,
        new_speaker: NewMeetingSpeaker,
    ) -> Result<MeetingSpeakerModel, SqlxError> {
        let now = Utc::now().to_rfc3339();
        let id = format!("meeting-speaker-{}", Uuid::new_v4());

        sqlx::query(
            "INSERT INTO meeting_speakers (
                id, meeting_id, diarization_speaker_number, display_name_override,
                speaker_identity_id, review_status, match_confidence, is_active,
                created_at, updated_at, last_reviewed_at, last_generated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)",
        )
        .bind(&id)
        .bind(&new_speaker.meeting_id)
        .bind(new_speaker.diarization_speaker_number)
        .bind(&new_speaker.display_name_override)
        .bind(&new_speaker.speaker_identity_id)
        .bind(&new_speaker.review_status)
        .bind(new_speaker.match_confidence)
        .bind(new_speaker.is_active)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await?;

        Self::get_meeting_speaker(pool, &id)
            .await?
            .ok_or(SqlxError::RowNotFound)
    }

    pub async fn get_meeting_speaker(
        pool: &SqlitePool,
        meeting_speaker_id: &str,
    ) -> Result<Option<MeetingSpeakerModel>, SqlxError> {
        sqlx::query_as::<_, MeetingSpeakerModel>(
            "SELECT id, meeting_id, diarization_speaker_number, display_name_override,
                    speaker_identity_id, review_status, match_confidence, is_active,
                    created_at, updated_at, last_reviewed_at, last_generated_at
             FROM meeting_speakers
             WHERE id = ?",
        )
        .bind(meeting_speaker_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn list_meeting_speakers(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<MeetingSpeakerModel>, SqlxError> {
        sqlx::query_as::<_, MeetingSpeakerModel>(
            "SELECT id, meeting_id, diarization_speaker_number, display_name_override,
                    speaker_identity_id, review_status, match_confidence, is_active,
                    created_at, updated_at, last_reviewed_at, last_generated_at
             FROM meeting_speakers
             WHERE meeting_id = ?
             ORDER BY is_active DESC, diarization_speaker_number ASC, created_at ASC",
        )
        .bind(meeting_id)
        .fetch_all(pool)
        .await
    }

    pub async fn find_active_meeting_speaker_by_number(
        pool: &SqlitePool,
        meeting_id: &str,
        diarization_speaker_number: i64,
    ) -> Result<Option<MeetingSpeakerModel>, SqlxError> {
        sqlx::query_as::<_, MeetingSpeakerModel>(
            "SELECT id, meeting_id, diarization_speaker_number, display_name_override,
                    speaker_identity_id, review_status, match_confidence, is_active,
                    created_at, updated_at, last_reviewed_at, last_generated_at
             FROM meeting_speakers
             WHERE meeting_id = ? AND diarization_speaker_number = ? AND is_active = 1
             LIMIT 1",
        )
        .bind(meeting_id)
        .bind(diarization_speaker_number)
        .fetch_optional(pool)
        .await
    }

    pub async fn link_meeting_speaker_to_identity(
        pool: &SqlitePool,
        meeting_speaker_id: &str,
        speaker_identity_id: &str,
        match_confidence: Option<f64>,
        review_status: &str,
    ) -> Result<bool, SqlxError> {
        Self::set_meeting_speaker_identity(
            pool,
            meeting_speaker_id,
            Some(speaker_identity_id),
            match_confidence,
            review_status,
        )
        .await
    }

    pub async fn set_meeting_speaker_identity(
        pool: &SqlitePool,
        meeting_speaker_id: &str,
        speaker_identity_id: Option<&str>,
        match_confidence: Option<f64>,
        review_status: &str,
    ) -> Result<bool, SqlxError> {
        let now = Utc::now().to_rfc3339();
        let result = sqlx::query(
            "UPDATE meeting_speakers
             SET speaker_identity_id = ?, match_confidence = ?, review_status = ?,
                 updated_at = ?, last_reviewed_at = ?, is_active = 1
             WHERE id = ?",
        )
        .bind(speaker_identity_id)
        .bind(match_confidence)
        .bind(review_status)
        .bind(&now)
        .bind(&now)
        .bind(meeting_speaker_id)
        .execute(pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn rename_meeting_speaker_local(
        pool: &SqlitePool,
        meeting_speaker_id: &str,
        display_name_override: Option<&str>,
        review_status: &str,
    ) -> Result<bool, SqlxError> {
        let now = Utc::now().to_rfc3339();
        let normalized = display_name_override
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        let result = sqlx::query(
            "UPDATE meeting_speakers
             SET display_name_override = ?, review_status = ?,
                 updated_at = ?, last_reviewed_at = ?, is_active = 1
             WHERE id = ?",
        )
        .bind(normalized)
        .bind(review_status)
        .bind(&now)
        .bind(&now)
        .bind(meeting_speaker_id)
        .execute(pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn reactivate_meeting_speaker(
        pool: &SqlitePool,
        meeting_speaker_id: &str,
    ) -> Result<bool, SqlxError> {
        let now = Utc::now().to_rfc3339();
        let result = sqlx::query(
            "UPDATE meeting_speakers
             SET is_active = 1, updated_at = ?, last_generated_at = ?
             WHERE id = ?",
        )
        .bind(&now)
        .bind(&now)
        .bind(meeting_speaker_id)
        .execute(pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn retire_unmatched_meeting_speakers(
        pool: &SqlitePool,
        meeting_id: &str,
        active_ids: &[String],
    ) -> Result<(), SqlxError> {
        let now = Utc::now().to_rfc3339();
        if active_ids.is_empty() {
            sqlx::query(
                "UPDATE meeting_speakers
                 SET is_active = 0, updated_at = ?
                 WHERE meeting_id = ?",
            )
            .bind(&now)
            .bind(meeting_id)
            .execute(pool)
            .await?;
            return Ok(());
        }

        let placeholders = std::iter::repeat("?")
            .take(active_ids.len())
            .collect::<Vec<_>>()
            .join(", ");
        let query = format!(
            "UPDATE meeting_speakers
             SET is_active = 0, updated_at = ?
             WHERE meeting_id = ? AND id NOT IN ({})",
            placeholders
        );

        let mut sql = sqlx::query(&query).bind(&now).bind(meeting_id);
        for id in active_ids {
            sql = sql.bind(id);
        }
        sql.execute(pool).await?;
        Ok(())
    }

    /// Get all meetings where this identity appears via meeting_speakers
    pub async fn list_identity_meetings(
        pool: &SqlitePool,
        identity_id: &str,
    ) -> Result<Vec<IdentityMeetingAppearance>, SqlxError> {
        sqlx::query_as::<_, IdentityMeetingAppearance>(
            "SELECT DISTINCT 
                m.id as meeting_id,
                m.title as meeting_title,
                m.created_at as meeting_date,
                ms.display_name_override as speaker_display_name,
                ms.id as meeting_speaker_id
             FROM meeting_speakers ms
             INNER JOIN meetings m ON ms.meeting_id = m.id
             WHERE ms.speaker_identity_id = ?
             ORDER BY m.created_at DESC",
        )
        .bind(identity_id)
        .fetch_all(pool)
        .await
    }

    /// Get all action items owned by this identity
    pub async fn list_identity_action_items(
        pool: &SqlitePool,
        identity_id: &str,
    ) -> Result<Vec<IdentityActionItem>, SqlxError> {
        sqlx::query_as::<_, IdentityActionItem>(
            "SELECT 
                ai.id,
                ai.meeting_id,
                ai.title,
                ai.details,
                ai.owner_display_name,
                ai.due_date,
                ai.status,
                ai.review_status,
                ai.created_at,
                m.title as meeting_title,
                m.created_at as meeting_date
             FROM action_items ai
             INNER JOIN meetings m ON ai.meeting_id = m.id
             WHERE ai.owner_speaker_identity_id = ?
             ORDER BY m.created_at DESC, ai.created_at ASC",
        )
        .bind(identity_id)
        .fetch_all(pool)
        .await
    }

    /// Get all voice profiles for this identity
    pub async fn list_identity_voice_profiles(
        pool: &SqlitePool,
        identity_id: &str,
    ) -> Result<Vec<VoiceProfileModel>, SqlxError> {
        sqlx::query_as::<_, VoiceProfileModel>(
            "SELECT id, speaker_identity_id, profile_kind, provider, model_version,
                    sample_count, profile_payload, created_at, updated_at, last_trained_at
             FROM voice_profiles
             WHERE speaker_identity_id = ?
             ORDER BY created_at DESC",
        )
        .bind(identity_id)
        .fetch_all(pool)
        .await
    }
}

pub fn normalize_name(display_name: &str) -> String {
    display_name.trim().to_lowercase()
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
             VALUES (?, 'Speaker Test', '2026-04-11T00:00:00Z', '2026-04-11T00:00:00Z')",
        )
        .bind(meeting_id)
        .execute(pool)
        .await
        .expect("failed to seed meeting");
    }

    #[tokio::test]
    async fn create_and_link_and_clear_meeting_speaker_identity() {
        let pool = setup_pool_with_migrations().await;
        let meeting_id = "meeting-speaker-link";
        seed_meeting(&pool, meeting_id).await;

        let identity = SpeakerIdentitiesRepository::create_identity(&pool, "Alex", None)
            .await
            .expect("identity should be created");

        let meeting_speaker = SpeakerIdentitiesRepository::create_meeting_speaker(
            &pool,
            NewMeetingSpeaker {
                meeting_id: meeting_id.to_string(),
                diarization_speaker_number: Some(1),
                display_name_override: Some("Speaker 1".to_string()),
                speaker_identity_id: None,
                review_status: "unreviewed".to_string(),
                match_confidence: None,
                is_active: true,
            },
        )
        .await
        .expect("meeting speaker should be created");

        let linked = SpeakerIdentitiesRepository::set_meeting_speaker_identity(
            &pool,
            &meeting_speaker.id,
            Some(&identity.id),
            Some(0.91),
            "confirmed",
        )
        .await
        .expect("link should succeed");
        assert!(linked);

        let stored = SpeakerIdentitiesRepository::get_meeting_speaker(&pool, &meeting_speaker.id)
            .await
            .expect("get should succeed")
            .expect("meeting speaker should exist");
        assert_eq!(
            stored.speaker_identity_id.as_deref(),
            Some(identity.id.as_str())
        );
        assert_eq!(stored.review_status, "confirmed");

        let cleared = SpeakerIdentitiesRepository::set_meeting_speaker_identity(
            &pool,
            &meeting_speaker.id,
            None,
            None,
            "confirmed",
        )
        .await
        .expect("clear should succeed");
        assert!(cleared);

        let cleared_row =
            SpeakerIdentitiesRepository::get_meeting_speaker(&pool, &meeting_speaker.id)
                .await
                .expect("get should succeed")
                .expect("meeting speaker should exist");
        assert!(cleared_row.speaker_identity_id.is_none());
    }

    #[tokio::test]
    async fn test_merge_identities_updates_meeting_speakers() {
        let pool = setup_pool_with_migrations().await;
        let meeting_id = "meeting-merge-test";
        seed_meeting(&pool, meeting_id).await;

        // Create two identities
        let source = SpeakerIdentitiesRepository::create_identity(&pool, "John Doe", None)
            .await
            .expect("source identity should be created");

        let target = SpeakerIdentitiesRepository::create_identity(&pool, "John D.", None)
            .await
            .expect("target identity should be created");

        // Create meeting speakers linked to source identity
        let speaker1 = SpeakerIdentitiesRepository::create_meeting_speaker(
            &pool,
            NewMeetingSpeaker {
                meeting_id: meeting_id.to_string(),
                diarization_speaker_number: Some(1),
                display_name_override: None,
                speaker_identity_id: Some(source.id.clone()),
                review_status: "confirmed".to_string(),
                match_confidence: Some(0.95),
                is_active: true,
            },
        )
        .await
        .expect("speaker1 should be created");

        let speaker2 = SpeakerIdentitiesRepository::create_meeting_speaker(
            &pool,
            NewMeetingSpeaker {
                meeting_id: meeting_id.to_string(),
                diarization_speaker_number: Some(2),
                display_name_override: None,
                speaker_identity_id: Some(source.id.clone()),
                review_status: "confirmed".to_string(),
                match_confidence: Some(0.90),
                is_active: true,
            },
        )
        .await
        .expect("speaker2 should be created");

        // Merge source into target
        SpeakerIdentitiesRepository::merge_identities(&pool, &source.id, &target.id)
            .await
            .expect("merge should succeed");

        // Verify meeting speakers now point to target
        let updated_speaker1 =
            SpeakerIdentitiesRepository::get_meeting_speaker(&pool, &speaker1.id)
                .await
                .expect("get should succeed")
                .expect("speaker1 should exist");
        assert_eq!(
            updated_speaker1.speaker_identity_id.as_deref(),
            Some(target.id.as_str())
        );

        let updated_speaker2 =
            SpeakerIdentitiesRepository::get_meeting_speaker(&pool, &speaker2.id)
                .await
                .expect("get should succeed")
                .expect("speaker2 should exist");
        assert_eq!(
            updated_speaker2.speaker_identity_id.as_deref(),
            Some(target.id.as_str())
        );

        // Verify source identity is archived
        let archived_source = SpeakerIdentitiesRepository::get_identity(&pool, &source.id)
            .await
            .expect("get should succeed")
            .expect("source should exist");
        assert!(archived_source.archived_at.is_some());
    }

    #[tokio::test]
    async fn test_merge_same_identity_is_noop() {
        let pool = setup_pool_with_migrations().await;

        let identity = SpeakerIdentitiesRepository::create_identity(&pool, "Bob", None)
            .await
            .expect("identity should be created");

        // Merge identity with itself should succeed without error
        SpeakerIdentitiesRepository::merge_identities(&pool, &identity.id, &identity.id)
            .await
            .expect("merge with self should succeed");

        // Verify identity is not archived
        let unchanged = SpeakerIdentitiesRepository::get_identity(&pool, &identity.id)
            .await
            .expect("get should succeed")
            .expect("identity should exist");
        assert!(unchanged.archived_at.is_none());
    }

    #[tokio::test]
    async fn test_identity_inspection_queries() {
        let pool = setup_pool_with_migrations().await;
        let meeting_id = "meeting-inspection-test";
        seed_meeting(&pool, meeting_id).await;

        // Create identity
        let identity =
            SpeakerIdentitiesRepository::create_identity(&pool, "Alice", Some("Test notes"))
                .await
                .expect("identity should be created");

        // Create meeting speaker linked to identity
        let meeting_speaker = SpeakerIdentitiesRepository::create_meeting_speaker(
            &pool,
            NewMeetingSpeaker {
                meeting_id: meeting_id.to_string(),
                diarization_speaker_number: Some(1),
                display_name_override: Some("Alice Override".to_string()),
                speaker_identity_id: Some(identity.id.clone()),
                review_status: "confirmed".to_string(),
                match_confidence: Some(0.95),
                is_active: true,
            },
        )
        .await
        .expect("meeting speaker should be created");

        // Create action item owned by identity
        sqlx::query(
            "INSERT INTO action_items (
                id, meeting_id, title, details, owner_speaker_identity_id, owner_display_name,
                due_date, status, review_status, source_transcript_id, source_start_ms,
                source_end_ms, source_excerpt, extraction_method, extraction_version,
                created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("action-1")
        .bind(meeting_id)
        .bind("Test action item")
        .bind("Details")
        .bind(&identity.id)
        .bind("Alice")
        .bind("2026-05-01")
        .bind("open")
        .bind("unreviewed")
        .bind(None::<String>)
        .bind(None::<i64>)
        .bind(None::<i64>)
        .bind(None::<String>)
        .bind("summary_structured")
        .bind("v0.4.0")
        .bind("2026-04-11T00:00:00Z")
        .bind("2026-04-11T00:00:00Z")
        .execute(&pool)
        .await
        .expect("action item should be created");

        // Test list_identity_meetings
        let meetings = SpeakerIdentitiesRepository::list_identity_meetings(&pool, &identity.id)
            .await
            .expect("list meetings should succeed");
        assert_eq!(meetings.len(), 1);
        assert_eq!(meetings[0].meeting_id, meeting_id);
        assert_eq!(meetings[0].meeting_title, "Speaker Test");
        assert_eq!(
            meetings[0].speaker_display_name,
            Some("Alice Override".to_string())
        );
        assert_eq!(meetings[0].meeting_speaker_id, meeting_speaker.id);

        // Test list_identity_action_items
        let action_items =
            SpeakerIdentitiesRepository::list_identity_action_items(&pool, &identity.id)
                .await
                .expect("list action items should succeed");
        assert_eq!(action_items.len(), 1);
        assert_eq!(action_items[0].title, "Test action item");
        assert_eq!(action_items[0].meeting_title, "Speaker Test");

        // Test list_identity_voice_profiles (should be empty)
        let voice_profiles =
            SpeakerIdentitiesRepository::list_identity_voice_profiles(&pool, &identity.id)
                .await
                .expect("list voice profiles should succeed");
        assert_eq!(voice_profiles.len(), 0);
    }

    #[tokio::test]
    async fn test_update_identity_notes() {
        let pool = setup_pool_with_migrations().await;

        let identity =
            SpeakerIdentitiesRepository::create_identity(&pool, "Charlie", Some("Original notes"))
                .await
                .expect("identity should be created");

        // Update notes
        let updated = SpeakerIdentitiesRepository::update_identity_notes(
            &pool,
            &identity.id,
            Some("Updated notes"),
        )
        .await
        .expect("update should succeed");
        assert!(updated);

        // Verify notes were updated
        let retrieved = SpeakerIdentitiesRepository::get_identity(&pool, &identity.id)
            .await
            .expect("get should succeed")
            .expect("identity should exist");
        assert_eq!(retrieved.notes, Some("Updated notes".to_string()));

        // Clear notes
        let cleared = SpeakerIdentitiesRepository::update_identity_notes(&pool, &identity.id, None)
            .await
            .expect("clear should succeed");
        assert!(cleared);

        let retrieved = SpeakerIdentitiesRepository::get_identity(&pool, &identity.id)
            .await
            .expect("get should succeed")
            .expect("identity should exist");
        assert!(retrieved.notes.is_none());
    }

    #[tokio::test]
    async fn rename_meeting_speaker_respects_requested_review_status() {
        let pool = setup_pool_with_migrations().await;
        let meeting_id = "meeting-rename-review-status";
        seed_meeting(&pool, meeting_id).await;

        let meeting_speaker = SpeakerIdentitiesRepository::create_meeting_speaker(
            &pool,
            NewMeetingSpeaker {
                meeting_id: meeting_id.to_string(),
                diarization_speaker_number: Some(3),
                display_name_override: Some("Speaker 3".to_string()),
                speaker_identity_id: None,
                review_status: "unreviewed".to_string(),
                match_confidence: Some(0.42),
                is_active: true,
            },
        )
        .await
        .expect("meeting speaker should be created");

        let updated = SpeakerIdentitiesRepository::rename_meeting_speaker_local(
            &pool,
            &meeting_speaker.id,
            Some("Alex"),
            "unreviewed",
        )
        .await
        .expect("rename should succeed");
        assert!(updated);

        let stored = SpeakerIdentitiesRepository::get_meeting_speaker(&pool, &meeting_speaker.id)
            .await
            .expect("get should succeed")
            .expect("meeting speaker should exist");
        assert_eq!(stored.display_name_override.as_deref(), Some("Alex"));
        assert_eq!(stored.review_status, "unreviewed");
    }

    #[tokio::test]
    async fn test_voice_profile_crud() {
        let pool = setup_pool_with_migrations().await;

        let identity = SpeakerIdentitiesRepository::create_identity(&pool, "Dana", None)
            .await
            .expect("identity should be created");

        let created = SpeakerIdentitiesRepository::add_voice_profile(
            &pool,
            NewVoiceProfile {
                speaker_identity_id: identity.id.clone(),
                profile_kind: "manual".to_string(),
                provider: Some("reviewer".to_string()),
                model_version: Some("notes-v1".to_string()),
                sample_count: 2,
                profile_payload: Some("Initial notes".to_string()),
            },
        )
        .await
        .expect("voice profile should be created");

        assert_eq!(created.profile_kind, "manual");
        assert_eq!(created.sample_count, 2);

        let updated = SpeakerIdentitiesRepository::update_voice_profile(
            &pool,
            &created.id,
            UpdateVoiceProfile {
                provider: Some(Some("embedding-service".to_string())),
                model_version: Some(Some("embed-v1".to_string())),
                sample_count: Some(4),
                profile_payload: Some(Some("{\"note\":\"updated\"}".to_string())),
                ..Default::default()
            },
        )
        .await
        .expect("voice profile update should succeed");
        assert!(updated);

        let profiles =
            SpeakerIdentitiesRepository::list_identity_voice_profiles(&pool, &identity.id)
                .await
                .expect("list profiles should succeed");
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].provider.as_deref(), Some("embedding-service"));
        assert_eq!(profiles[0].model_version.as_deref(), Some("embed-v1"));
        assert_eq!(profiles[0].sample_count, 4);

        let deleted = SpeakerIdentitiesRepository::delete_voice_profile(&pool, &created.id)
            .await
            .expect("delete should succeed");
        assert!(deleted);

        let profiles =
            SpeakerIdentitiesRepository::list_identity_voice_profiles(&pool, &identity.id)
                .await
                .expect("list profiles should succeed");
        assert!(profiles.is_empty());
    }
}
