#[cfg(test)]
use crate::database::models::MeetingTagModel;
use crate::database::models::TagModel;
use sqlx::SqlitePool;

pub struct TagsRepository;

impl TagsRepository {
    pub async fn create_tag(
        pool: &SqlitePool,
        name: &str,
        color: Option<&str>,
    ) -> Result<TagModel, sqlx::Error> {
        let name = name.trim();
        let normalized_name = name.to_lowercase();
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO tags (id, name, normalized_name, color, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(name)
        .bind(&normalized_name)
        .bind(color)
        .bind(&now)
        .execute(pool)
        .await?;

        Ok(TagModel {
            id,
            name: name.to_string(),
            normalized_name,
            color: color.map(|s| s.to_string()),
            created_at: now,
        })
    }

    pub async fn list_tags(pool: &SqlitePool) -> Result<Vec<TagModel>, sqlx::Error> {
        sqlx::query_as::<_, TagModel>("SELECT * FROM tags ORDER BY name ASC")
            .fetch_all(pool)
            .await
    }

    pub async fn delete_tag(pool: &SqlitePool, tag_id: &str) -> Result<bool, sqlx::Error> {
        let result = sqlx::query("DELETE FROM tags WHERE id = ?")
            .bind(tag_id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn tag_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
        tag_id: &str,
    ) -> Result<(), sqlx::Error> {
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT OR IGNORE INTO meeting_tags (meeting_id, tag_id, created_at) VALUES (?, ?, ?)",
        )
        .bind(meeting_id)
        .bind(tag_id)
        .bind(&now)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn untag_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
        tag_id: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM meeting_tags WHERE meeting_id = ? AND tag_id = ?")
            .bind(meeting_id)
            .bind(tag_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn list_meeting_tags(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<TagModel>, sqlx::Error> {
        sqlx::query_as::<_, TagModel>(
            "SELECT t.id, t.name, t.normalized_name, t.color, t.created_at
             FROM tags t
             INNER JOIN meeting_tags mt ON mt.tag_id = t.id
             WHERE mt.meeting_id = ?
             ORDER BY t.name ASC",
        )
        .bind(meeting_id)
        .fetch_all(pool)
        .await
    }

    pub async fn list_meetings_for_tag(
        pool: &SqlitePool,
        tag_id: &str,
    ) -> Result<Vec<String>, sqlx::Error> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT meeting_id FROM meeting_tags WHERE tag_id = ? ORDER BY created_at ASC",
        )
        .bind(tag_id)
        .fetch_all(pool)
        .await?;
        Ok(rows.into_iter().map(|r| r.0).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        sqlx::query("CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, folder_path TEXT, source_type TEXT NOT NULL DEFAULT 'recorded', language TEXT, duration_seconds REAL, recording_started_at TEXT, recording_ended_at TEXT, markdown_export_path TEXT)")
            .execute(&pool).await.unwrap();
        sqlx::query(
            "CREATE TABLE tags (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                normalized_name TEXT NOT NULL,
                color TEXT,
                created_at TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE meeting_tags (
                meeting_id TEXT NOT NULL,
                tag_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (meeting_id, tag_id),
                FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&pool)
            .await
            .unwrap();

        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO meetings (id, title, created_at, updated_at, source_type) VALUES ('m1', 'Test Meeting', ?, ?, 'recorded')")
            .bind(&now).bind(&now)
            .execute(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn test_create_and_list_tags() {
        let pool = setup_test_db().await;

        let beta = TagsRepository::create_tag(&pool, "  Beta  ", Some("#ff0000"))
            .await
            .unwrap();
        assert_eq!(beta.name, "Beta");
        assert_eq!(beta.normalized_name, "beta");
        assert_eq!(beta.color, Some("#ff0000".to_string()));

        let alpha = TagsRepository::create_tag(&pool, "Alpha", None)
            .await
            .unwrap();
        assert_eq!(alpha.normalized_name, "alpha");

        let tags = TagsRepository::list_tags(&pool).await.unwrap();
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0].name, "Alpha");
        assert_eq!(tags[1].name, "Beta");
    }

    #[tokio::test]
    async fn test_tag_and_untag_meeting() {
        let pool = setup_test_db().await;
        let tag = TagsRepository::create_tag(&pool, "work", None)
            .await
            .unwrap();

        TagsRepository::tag_meeting(&pool, "m1", &tag.id)
            .await
            .unwrap();

        let junction: Vec<MeetingTagModel> = sqlx::query_as(
            "SELECT meeting_id, tag_id, created_at FROM meeting_tags WHERE meeting_id = ?",
        )
        .bind("m1")
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(junction.len(), 1);
        assert_eq!(junction[0].tag_id, tag.id);

        let listed = TagsRepository::list_meeting_tags(&pool, "m1")
            .await
            .unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, tag.id);

        let meeting_ids = TagsRepository::list_meetings_for_tag(&pool, &tag.id)
            .await
            .unwrap();
        assert_eq!(meeting_ids, vec!["m1".to_string()]);

        TagsRepository::untag_meeting(&pool, "m1", &tag.id)
            .await
            .unwrap();
        let listed_after = TagsRepository::list_meeting_tags(&pool, "m1")
            .await
            .unwrap();
        assert!(listed_after.is_empty());
    }

    #[tokio::test]
    async fn test_delete_tag_cascades() {
        let pool = setup_test_db().await;
        let tag = TagsRepository::create_tag(&pool, "temp", None)
            .await
            .unwrap();
        TagsRepository::tag_meeting(&pool, "m1", &tag.id)
            .await
            .unwrap();

        assert!(TagsRepository::delete_tag(&pool, &tag.id).await.unwrap());

        let junction: Vec<MeetingTagModel> = sqlx::query_as(
            "SELECT meeting_id, tag_id, created_at FROM meeting_tags WHERE tag_id = ?",
        )
        .bind(&tag.id)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert!(junction.is_empty());
    }
}
