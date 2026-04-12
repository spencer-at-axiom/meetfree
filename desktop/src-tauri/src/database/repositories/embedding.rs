use crate::database::models::EmbeddingModel;
use chrono::Utc;
use sqlx::SqlitePool;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq)]
pub struct SimilarityResult {
    pub source_type: String,
    pub source_id: String,
    pub meeting_id: String,
    pub score: f64,
}

pub struct EmbeddingsRepository;

pub fn f32_slice_to_bytes(embedding: &[f32]) -> Vec<u8> {
    bytemuck::cast_slice(embedding).to_vec()
}

pub fn bytes_to_f32_slice(bytes: &[u8]) -> &[f32] {
    bytemuck::cast_slice(bytes)
}

pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f64;
    let mut na = 0.0f64;
    let mut nb = 0.0f64;
    for i in 0..a.len() {
        let ai = a[i] as f64;
        let bi = b[i] as f64;
        dot += ai * bi;
        na += ai * ai;
        nb += bi * bi;
    }
    let denom = na.sqrt() * nb.sqrt();
    if denom == 0.0 {
        0.0
    } else {
        dot / denom
    }
}

impl EmbeddingsRepository {
    pub async fn store_embedding(
        pool: &SqlitePool,
        source_type: &str,
        source_id: &str,
        meeting_id: &str,
        embedding: &[f32],
        model_name: &str,
    ) -> Result<String, sqlx::Error> {
        let id = Uuid::new_v4().to_string();
        let blob = f32_slice_to_bytes(embedding);
        let dimensions = embedding.len() as i64;
        let created_at = Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO embeddings (id, source_type, source_id, meeting_id, embedding, model_name, dimensions, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(source_type)
        .bind(source_id)
        .bind(meeting_id)
        .bind(blob)
        .bind(model_name)
        .bind(dimensions)
        .bind(&created_at)
        .execute(pool)
        .await?;

        Ok(id)
    }

    pub async fn get_embeddings_for_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<EmbeddingModel>, sqlx::Error> {
        sqlx::query_as::<_, EmbeddingModel>(
            "SELECT id, source_type, source_id, meeting_id, embedding, model_name, dimensions, created_at
             FROM embeddings
             WHERE meeting_id = ?
             ORDER BY created_at ASC",
        )
        .bind(meeting_id)
        .fetch_all(pool)
        .await
    }

    pub async fn delete_embeddings_for_source(
        pool: &SqlitePool,
        source_type: &str,
        source_id: &str,
    ) -> Result<u64, sqlx::Error> {
        let res = sqlx::query("DELETE FROM embeddings WHERE source_type = ? AND source_id = ?")
            .bind(source_type)
            .bind(source_id)
            .execute(pool)
            .await?;
        Ok(res.rows_affected())
    }

    pub async fn delete_embeddings_for_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<u64, sqlx::Error> {
        let res = sqlx::query("DELETE FROM embeddings WHERE meeting_id = ?")
            .bind(meeting_id)
            .execute(pool)
            .await?;
        Ok(res.rows_affected())
    }

    pub async fn has_embeddings(pool: &SqlitePool, meeting_id: &str) -> Result<bool, sqlx::Error> {
        let exists: i64 =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM embeddings WHERE meeting_id = ?)")
                .bind(meeting_id)
                .fetch_one(pool)
                .await?;
        Ok(exists != 0)
    }

    pub async fn find_similar(
        pool: &SqlitePool,
        query_embedding: &[f32],
        limit: usize,
        meeting_id_filter: Option<&str>,
    ) -> Result<Vec<SimilarityResult>, sqlx::Error> {
        let rows: Vec<EmbeddingModel> = if let Some(mid) = meeting_id_filter {
            sqlx::query_as::<_, EmbeddingModel>(
                "SELECT id, source_type, source_id, meeting_id, embedding, model_name, dimensions, created_at
                 FROM embeddings
                 WHERE meeting_id = ?",
            )
            .bind(mid)
            .fetch_all(pool)
            .await?
        } else {
            sqlx::query_as::<_, EmbeddingModel>(
                "SELECT id, source_type, source_id, meeting_id, embedding, model_name, dimensions, created_at
                 FROM embeddings",
            )
            .fetch_all(pool)
            .await?
        };

        let mut scored: Vec<SimilarityResult> = Vec::new();
        for row in rows {
            let slice = bytes_to_f32_slice(&row.embedding);
            if slice.len() != query_embedding.len() {
                continue;
            }
            let score = cosine_similarity(query_embedding, slice);
            scored.push(SimilarityResult {
                source_type: row.source_type,
                source_id: row.source_id,
                meeting_id: row.meeting_id,
                score,
            });
        }

        scored.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        scored.truncate(limit);
        Ok(scored)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.expect("pool");

        sqlx::query(
            "CREATE TABLE meetings (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("meetings");

        sqlx::query(
            "CREATE TABLE embeddings (
                id TEXT PRIMARY KEY NOT NULL,
                source_type TEXT NOT NULL,
                source_id TEXT NOT NULL,
                meeting_id TEXT NOT NULL,
                embedding BLOB NOT NULL,
                model_name TEXT NOT NULL,
                dimensions INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
            )",
        )
        .execute(&pool)
        .await
        .expect("embeddings");

        pool
    }

    async fn seed_meeting(pool: &SqlitePool, id: &str) {
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO meetings (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
            .bind(id)
            .bind("t")
            .bind(&now)
            .bind(&now)
            .execute(pool)
            .await
            .expect("insert meeting");
    }

    #[tokio::test]
    async fn test_store_and_retrieve_embeddings() {
        let pool = setup_pool().await;
        seed_meeting(&pool, "m1").await;

        let v = vec![1.0f32, 0.0, 0.0];
        let id = EmbeddingsRepository::store_embedding(
            &pool,
            "transcript_segment",
            "seg-1",
            "m1",
            &v,
            "test-model",
        )
        .await
        .unwrap();

        let list = EmbeddingsRepository::get_embeddings_for_meeting(&pool, "m1")
            .await
            .unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, id);
        assert_eq!(list[0].source_type, "transcript_segment");
        assert_eq!(list[0].source_id, "seg-1");
        assert_eq!(list[0].meeting_id, "m1");
        assert_eq!(list[0].model_name, "test-model");
        assert_eq!(list[0].dimensions, 3);
        let back = bytes_to_f32_slice(&list[0].embedding);
        assert_eq!(back, v.as_slice());
    }

    #[tokio::test]
    async fn test_has_embeddings() {
        let pool = setup_pool().await;
        seed_meeting(&pool, "m1").await;

        assert!(!EmbeddingsRepository::has_embeddings(&pool, "m1")
            .await
            .unwrap());

        EmbeddingsRepository::store_embedding(
            &pool,
            "transcript_segment",
            "s",
            "m1",
            &[0.0f32],
            "m",
        )
        .await
        .unwrap();

        assert!(EmbeddingsRepository::has_embeddings(&pool, "m1")
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn test_find_similar() {
        let pool = setup_pool().await;
        seed_meeting(&pool, "m1").await;

        let e1 = [1.0f32, 0.0, 0.0];
        let e2 = [0.0f32, 1.0, 0.0];
        let e3 = [0.0f32, 0.0, 1.0];

        EmbeddingsRepository::store_embedding(&pool, "transcript_segment", "a", "m1", &e1, "m")
            .await
            .unwrap();
        EmbeddingsRepository::store_embedding(&pool, "transcript_segment", "b", "m1", &e2, "m")
            .await
            .unwrap();
        EmbeddingsRepository::store_embedding(&pool, "context_asset", "c", "m1", &e3, "m")
            .await
            .unwrap();

        let query = [0.99f32, 0.01, 0.0];
        let hits = EmbeddingsRepository::find_similar(&pool, &query, 3, Some("m1"))
            .await
            .unwrap();

        assert_eq!(hits.len(), 3);
        assert_eq!(hits[0].source_id, "a");
        assert!(hits[0].score > hits[1].score);
        assert!(hits[1].score > hits[2].score);
    }

    #[tokio::test]
    async fn test_delete_by_source() {
        let pool = setup_pool().await;
        seed_meeting(&pool, "m1").await;

        EmbeddingsRepository::store_embedding(
            &pool,
            "transcript_segment",
            "x",
            "m1",
            &[1.0f32],
            "m",
        )
        .await
        .unwrap();
        EmbeddingsRepository::store_embedding(
            &pool,
            "transcript_segment",
            "x",
            "m1",
            &[2.0f32],
            "m",
        )
        .await
        .unwrap();

        let n =
            EmbeddingsRepository::delete_embeddings_for_source(&pool, "transcript_segment", "x")
                .await
                .unwrap();
        assert_eq!(n, 2);

        let list = EmbeddingsRepository::get_embeddings_for_meeting(&pool, "m1")
            .await
            .unwrap();
        assert!(list.is_empty());
    }
}
