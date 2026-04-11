use crate::summary::contract::run_startup_migration;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    Result, Sqlite, SqlitePool, Transaction,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::Manager;

#[derive(Clone)]
pub struct DatabaseManager {
    pool: SqlitePool,
    db_path: PathBuf,
}

impl DatabaseManager {
    pub async fn new(tauri_db_path: &str) -> Result<Self> {
        if let Some(parent_dir) = Path::new(tauri_db_path).parent() {
            if !parent_dir.exists() {
                fs::create_dir_all(parent_dir).map_err(sqlx::Error::Io)?;
            }
        }

        let connect_options = SqliteConnectOptions::new()
            .filename(tauri_db_path)
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal)
            .busy_timeout(Duration::from_secs(10)); // Increased from 5s to 10s for large writes

        // CRITICAL FIX: Set connection pool limits to prevent resource exhaustion
        // Max 10 connections prevents file descriptor leaks
        let pool = SqlitePoolOptions::new()
            .max_connections(10)
            .min_connections(1)
            .acquire_timeout(Duration::from_secs(30))
            .connect_with(connect_options)
            .await?;

        sqlx::migrate!("./migrations").run(&pool).await?;

        let migration_report = run_startup_migration(&pool).await.map_err(|error| {
            sqlx::Error::Protocol(format!("summary startup migration failed: {}", error))
        })?;
        log::info!(
            "Summary contract startup migration: scanned={}, canonical={}, migrated={}, failed={}",
            migration_report.scanned,
            migration_report.already_canonical,
            migration_report.migrated,
            migration_report.failed
        );

        Ok(DatabaseManager {
            pool,
            db_path: PathBuf::from(tauri_db_path),
        })
    }

    pub async fn new_from_app_handle(app_handle: &tauri::AppHandle) -> Result<Self> {
        // Resolve the app's data directory
        let app_data_dir = app_handle.path().app_data_dir().map_err(|error| {
            sqlx::Error::Protocol(format!("failed to get app data dir: {}", error))
        })?;
        if !app_data_dir.exists() {
            fs::create_dir_all(&app_data_dir).map_err(sqlx::Error::Io)?;
        }

        // Define database paths
        let tauri_db_path = app_data_dir
            .join("meeting_minutes.sqlite")
            .to_string_lossy()
            .to_string();
        // WAL file paths for defensive cleanup
        let wal_path = app_data_dir.join("meeting_minutes.sqlite-wal");
        let shm_path = app_data_dir.join("meeting_minutes.sqlite-shm");

        log::info!("Tauri DB path: {}", tauri_db_path);

        // Try to open database with defensive WAL handling
        match Self::new(&tauri_db_path).await {
            Ok(db_manager) => {
                log::info!("Database opened successfully");
                Ok(db_manager)
            }
            Err(e) => {
                // Check if error is due to corrupted WAL file
                let error_msg = e.to_string();
                if error_msg.contains("malformed") || error_msg.contains("corrupt") {
                    log::warn!("Database appears corrupted, likely due to orphaned WAL file. Attempting recovery...");
                    log::warn!("Error details: {}", error_msg);

                    // Delete potentially corrupted WAL/SHM files
                    if wal_path.exists() {
                        match fs::remove_file(&wal_path) {
                            Ok(_) => log::info!("Removed orphaned WAL file: {:?}", wal_path),
                            Err(e) => log::warn!("Failed to remove WAL file: {}", e),
                        }
                    }
                    if shm_path.exists() {
                        match fs::remove_file(&shm_path) {
                            Ok(_) => log::info!("Removed orphaned SHM file: {:?}", shm_path),
                            Err(e) => log::warn!("Failed to remove SHM file: {}", e),
                        }
                    }

                    // Retry connection without WAL files
                    log::info!("Retrying database connection after WAL cleanup...");
                    match Self::new(&tauri_db_path).await {
                        Ok(db_manager) => {
                            log::info!("Database opened successfully after WAL recovery");
                            Ok(db_manager)
                        }
                        Err(retry_err) => {
                            log::error!(
                                "Database connection failed even after WAL cleanup: {}",
                                retry_err
                            );
                            Err(retry_err)
                        }
                    }
                } else {
                    // Not a WAL-related error, propagate original error
                    log::error!("Database connection failed: {}", error_msg);
                    Err(e)
                }
            }
        }
    }

    /// Check if this is the first launch (sqlite database doesn't exist yet)
    pub async fn is_first_launch(app_handle: &tauri::AppHandle) -> Result<bool> {
        let app_data_dir = app_handle.path().app_data_dir().map_err(|error| {
            sqlx::Error::Protocol(format!("failed to get app data dir: {}", error))
        })?;

        let tauri_db_path = app_data_dir.join("meeting_minutes.sqlite");

        Ok(!tauri_db_path.exists())
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    pub async fn with_transaction<T, F, Fut>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&mut Transaction<'_, Sqlite>) -> Fut,
        Fut: std::future::Future<Output = Result<T>>,
    {
        let mut tx = self.pool.begin().await?;
        let result = f(&mut tx).await;

        match result {
            Ok(val) => {
                tx.commit().await?;
                Ok(val)
            }
            Err(err) => {
                tx.rollback().await?;
                Err(err)
            }
        }
    }

    /// Cleanup database connection and checkpoint WAL
    /// This should be called on application shutdown to ensure:
    /// - All WAL changes are written to the main database file
    /// - The .wal and .shm files are deleted
    /// - Connection pool is gracefully closed
    pub async fn cleanup(&self) -> Result<()> {
        log::info!("Starting database cleanup...");

        // Force checkpoint of WAL to main database file and remove WAL file
        // TRUNCATE mode: checkpoints all pages AND deletes the WAL file
        match sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .execute(&self.pool)
            .await
        {
            Ok(_) => log::info!("WAL checkpoint completed successfully"),
            Err(e) => log::warn!("WAL checkpoint failed (non-fatal): {}", e),
        }

        // Close the connection pool gracefully
        self.pool.close().await;
        log::info!("Database connection pool closed");

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use sqlx::{sqlite::SqlitePoolOptions, Row, SqlitePool};

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

    #[tokio::test]
    async fn baseline_migration_creates_active_tables_and_drops_legacy_ones() {
        let pool = setup_pool_with_migrations().await;

        let expected_tables = [
            "meetings",
            "transcripts",
            "summary_processes",
            "settings",
            "transcript_settings",
            "vocabulary_entries",
            "speaker_turns",
            "transcripts_fts",
        ];

        for table in expected_tables {
            let row = sqlx::query(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
            )
            .bind(table)
            .fetch_optional(&pool)
            .await
            .expect("failed to query sqlite_master");
            assert!(row.is_some(), "expected table '{}' to exist", table);
        }

        let removed_table = sqlx::query(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'transcript_chunks' LIMIT 1",
        )
        .fetch_optional(&pool)
        .await
        .expect("failed to query sqlite_master");
        assert!(
            removed_table.is_none(),
            "transcript_chunks should not exist in baseline schema"
        );

        let transcript_columns = sqlx::query("PRAGMA table_info(transcripts)")
            .fetch_all(&pool)
            .await
            .expect("failed to read transcripts columns")
            .into_iter()
            .map(|row| row.get::<String, _>("name"))
            .collect::<Vec<_>>();
        assert!(transcript_columns.contains(&"raw_transcript".to_string()));
        assert!(transcript_columns.contains(&"processing_version".to_string()));
        assert!(!transcript_columns.contains(&"summary".to_string()));
        assert!(!transcript_columns.contains(&"action_items".to_string()));
        assert!(!transcript_columns.contains(&"key_points".to_string()));

        let settings_columns = sqlx::query("PRAGMA table_info(settings)")
            .fetch_all(&pool)
            .await
            .expect("failed to read settings columns")
            .into_iter()
            .map(|row| row.get::<String, _>("name"))
            .collect::<Vec<_>>();
        assert!(settings_columns.contains(&"customOpenAIConfig".to_string()));
        assert!(!settings_columns.contains(&"openaiApiKey".to_string()));
        assert!(!settings_columns.contains(&"anthropicApiKey".to_string()));
        assert!(!settings_columns.contains(&"ollamaApiKey".to_string()));
        assert!(!settings_columns.contains(&"groqApiKey".to_string()));
        assert!(!settings_columns.contains(&"openRouterApiKey".to_string()));
        assert!(!settings_columns.contains(&"geminiApiKey".to_string()));

        let transcript_settings_columns = sqlx::query("PRAGMA table_info(transcript_settings)")
            .fetch_all(&pool)
            .await
            .expect("failed to read transcript_settings columns")
            .into_iter()
            .map(|row| row.get::<String, _>("name"))
            .collect::<Vec<_>>();
        assert!(!transcript_settings_columns.contains(&"whisperApiKey".to_string()));
        assert!(!transcript_settings_columns.contains(&"deepgramApiKey".to_string()));
        assert!(!transcript_settings_columns.contains(&"elevenLabsApiKey".to_string()));
        assert!(!transcript_settings_columns.contains(&"groqApiKey".to_string()));
        assert!(!transcript_settings_columns.contains(&"openaiApiKey".to_string()));
    }

    #[tokio::test]
    async fn baseline_migration_creates_transcript_fts_triggers() {
        let pool = setup_pool_with_migrations().await;

        sqlx::query(
            "INSERT INTO meetings (id, title, created_at, updated_at)
             VALUES ('m1', 'Test Meeting', '2026-04-10T00:00:00Z', '2026-04-10T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("failed to seed meeting");

        sqlx::query(
            "INSERT INTO transcripts (
                id, meeting_id, transcript, timestamp, raw_transcript, processing_version,
                audio_start_time, audio_end_time, duration, speaker
             ) VALUES (
                't1', 'm1', 'hello baseline', '2026-04-10T00:00:01Z', 'hello baseline', 'v0.2.0',
                0.0, 1.0, 1.0, 'mic'
             )",
        )
        .execute(&pool)
        .await
        .expect("failed to seed transcript");

        let hits = sqlx::query_as::<_, (i64,)>(
            "SELECT COUNT(*) FROM transcripts_fts WHERE transcripts_fts MATCH 'hello'",
        )
        .fetch_one(&pool)
        .await
        .expect("failed to query transcripts_fts");
        assert_eq!(hits.0, 1);
    }
}
