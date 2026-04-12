use crate::database::models::MeetingContextAssetModel;
use sqlx::SqlitePool;

pub struct ContextAssetsRepository;

#[derive(Debug, Clone)]
pub struct NewContextAsset {
    pub asset_type: String,
    pub title: Option<String>,
    pub content: Option<String>,
    pub file_path: Option<String>,
    pub file_mime_type: Option<String>,
    pub file_size_bytes: Option<i64>,
    pub metadata: Option<String>,
    pub sort_order: i64,
}

#[derive(Debug, Clone)]
pub struct UpdateContextAsset {
    pub title: Option<Option<String>>,
    pub content: Option<Option<String>>,
    pub metadata: Option<Option<String>>,
    pub sort_order: Option<i64>,
}

impl ContextAssetsRepository {
    pub async fn create_asset(
        pool: &SqlitePool,
        meeting_id: &str,
        new: NewContextAsset,
    ) -> Result<MeetingContextAssetModel, sqlx::Error> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO meeting_context_assets
             (id, meeting_id, asset_type, title, content, file_path, file_mime_type, file_size_bytes, metadata, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(meeting_id)
        .bind(&new.asset_type)
        .bind(&new.title)
        .bind(&new.content)
        .bind(&new.file_path)
        .bind(&new.file_mime_type)
        .bind(new.file_size_bytes)
        .bind(&new.metadata)
        .bind(new.sort_order)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await?;

        Ok(MeetingContextAssetModel {
            id,
            meeting_id: meeting_id.to_string(),
            asset_type: new.asset_type,
            title: new.title,
            content: new.content,
            file_path: new.file_path,
            file_mime_type: new.file_mime_type,
            file_size_bytes: new.file_size_bytes,
            metadata: new.metadata,
            sort_order: new.sort_order,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub async fn list_assets(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<MeetingContextAssetModel>, sqlx::Error> {
        sqlx::query_as::<_, MeetingContextAssetModel>(
            "SELECT * FROM meeting_context_assets WHERE meeting_id = ? ORDER BY sort_order ASC, created_at ASC",
        )
        .bind(meeting_id)
        .fetch_all(pool)
        .await
    }

    pub async fn get_asset(
        pool: &SqlitePool,
        asset_id: &str,
    ) -> Result<Option<MeetingContextAssetModel>, sqlx::Error> {
        sqlx::query_as::<_, MeetingContextAssetModel>(
            "SELECT * FROM meeting_context_assets WHERE id = ?",
        )
        .bind(asset_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn update_asset(
        pool: &SqlitePool,
        asset_id: &str,
        updates: UpdateContextAsset,
    ) -> Result<bool, sqlx::Error> {
        let now = chrono::Utc::now().to_rfc3339();
        let mut query = String::from("UPDATE meeting_context_assets SET updated_at = ?");
        let mut binds: Vec<Option<String>> = vec![Some(now)];

        if let Some(title) = &updates.title {
            query.push_str(", title = ?");
            binds.push(title.clone());
        }
        if let Some(content) = &updates.content {
            query.push_str(", content = ?");
            binds.push(content.clone());
        }
        if let Some(metadata) = &updates.metadata {
            query.push_str(", metadata = ?");
            binds.push(metadata.clone());
        }
        if let Some(sort_order) = updates.sort_order {
            query.push_str(&format!(", sort_order = {}", sort_order));
        }

        query.push_str(" WHERE id = ?");
        binds.push(Some(asset_id.to_string()));

        let mut q = sqlx::query(&query);
        for b in &binds {
            q = q.bind(b);
        }

        let result = q.execute(pool).await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn delete_asset(pool: &SqlitePool, asset_id: &str) -> Result<bool, sqlx::Error> {
        let result = sqlx::query("DELETE FROM meeting_context_assets WHERE id = ?")
            .bind(asset_id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn get_scratchpad(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<MeetingContextAssetModel>, sqlx::Error> {
        sqlx::query_as::<_, MeetingContextAssetModel>(
            "SELECT * FROM meeting_context_assets WHERE meeting_id = ? AND asset_type = 'scratchpad' LIMIT 1",
        )
        .bind(meeting_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn upsert_scratchpad(
        pool: &SqlitePool,
        meeting_id: &str,
        content: &str,
    ) -> Result<MeetingContextAssetModel, sqlx::Error> {
        let existing = Self::get_scratchpad(pool, meeting_id).await?;

        if let Some(existing) = existing {
            let now = chrono::Utc::now().to_rfc3339();
            sqlx::query(
                "UPDATE meeting_context_assets SET content = ?, updated_at = ? WHERE id = ?",
            )
            .bind(content)
            .bind(&now)
            .bind(&existing.id)
            .execute(pool)
            .await?;

            Ok(MeetingContextAssetModel {
                content: Some(content.to_string()),
                updated_at: now,
                ..existing
            })
        } else {
            Self::create_asset(
                pool,
                meeting_id,
                NewContextAsset {
                    asset_type: "scratchpad".to_string(),
                    title: Some("Notes".to_string()),
                    content: Some(content.to_string()),
                    file_path: None,
                    file_mime_type: None,
                    file_size_bytes: None,
                    metadata: None,
                    sort_order: 0,
                },
            )
            .await
        }
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
            "CREATE TABLE meeting_context_assets (
                id TEXT PRIMARY KEY NOT NULL,
                meeting_id TEXT NOT NULL,
                asset_type TEXT NOT NULL,
                title TEXT,
                content TEXT,
                file_path TEXT,
                file_mime_type TEXT,
                file_size_bytes INTEGER,
                metadata TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
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
    async fn test_create_and_list_assets() {
        let pool = setup_test_db().await;
        let asset = ContextAssetsRepository::create_asset(
            &pool,
            "m1",
            NewContextAsset {
                asset_type: "attachment".to_string(),
                title: Some("agenda.md".to_string()),
                content: Some("# Agenda\n- Item 1".to_string()),
                file_path: None,
                file_mime_type: Some("text/markdown".to_string()),
                file_size_bytes: Some(20),
                metadata: None,
                sort_order: 0,
            },
        )
        .await
        .unwrap();

        assert_eq!(asset.asset_type, "attachment");
        assert_eq!(asset.title, Some("agenda.md".to_string()));

        let assets = ContextAssetsRepository::list_assets(&pool, "m1")
            .await
            .unwrap();
        assert_eq!(assets.len(), 1);
    }

    #[tokio::test]
    async fn test_scratchpad_upsert() {
        let pool = setup_test_db().await;

        let pad1 = ContextAssetsRepository::upsert_scratchpad(&pool, "m1", "First notes")
            .await
            .unwrap();
        assert_eq!(pad1.content, Some("First notes".to_string()));
        assert_eq!(pad1.asset_type, "scratchpad");

        let pad2 = ContextAssetsRepository::upsert_scratchpad(&pool, "m1", "Updated notes")
            .await
            .unwrap();
        assert_eq!(pad2.id, pad1.id);
        assert_eq!(pad2.content, Some("Updated notes".to_string()));

        let all = ContextAssetsRepository::list_assets(&pool, "m1")
            .await
            .unwrap();
        assert_eq!(all.len(), 1);
    }

    #[tokio::test]
    async fn test_delete_asset() {
        let pool = setup_test_db().await;
        let asset = ContextAssetsRepository::create_asset(
            &pool,
            "m1",
            NewContextAsset {
                asset_type: "note".to_string(),
                title: Some("Quick note".to_string()),
                content: Some("Some text".to_string()),
                file_path: None,
                file_mime_type: None,
                file_size_bytes: None,
                metadata: None,
                sort_order: 0,
            },
        )
        .await
        .unwrap();

        let deleted = ContextAssetsRepository::delete_asset(&pool, &asset.id)
            .await
            .unwrap();
        assert!(deleted);

        let fetched = ContextAssetsRepository::get_asset(&pool, &asset.id)
            .await
            .unwrap();
        assert!(fetched.is_none());
    }
}
