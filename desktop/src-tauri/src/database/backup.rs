use anyhow::{Context, Result};
use log::{error, info, warn};
use std::path::{Path, PathBuf};
use tokio::fs;

/// Database backup manager
///
/// Provides functionality to create, restore, and manage SQLite database backups.
/// Backups are created with timestamps and can be automatically cleaned up.
pub struct BackupManager {
    db_path: PathBuf,
    backup_dir: PathBuf,
}

impl BackupManager {
    /// Create a new backup manager
    ///
    /// # Arguments
    /// * `db_path` - Path to the SQLite database file
    /// * `backup_dir` - Directory where backups will be stored
    pub fn new(db_path: PathBuf, backup_dir: PathBuf) -> Self {
        Self {
            db_path,
            backup_dir,
        }
    }

    /// Create a backup of the database
    ///
    /// Returns the path to the created backup file
    pub async fn create_backup(&self) -> Result<PathBuf> {
        // Ensure backup directory exists
        fs::create_dir_all(&self.backup_dir)
            .await
            .context("Failed to create backup directory")?;

        // Generate backup filename with timestamp
        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
        let backup_filename = format!("meetfree_backup_{}.db", timestamp);
        let backup_path = self.backup_dir.join(&backup_filename);

        info!("Creating database backup: {}", backup_path.display());

        // Copy database file
        fs::copy(&self.db_path, &backup_path)
            .await
            .context("Failed to copy database file")?;

        // Also backup WAL file if it exists
        let wal_path = self.db_path.with_extension("db-wal");
        if wal_path.exists() {
            let backup_wal = backup_path.with_extension("db-wal");
            if let Err(e) = fs::copy(&wal_path, &backup_wal).await {
                warn!("Failed to backup WAL file: {}", e);
            }
        }

        // Also backup SHM file if it exists
        let shm_path = self.db_path.with_extension("db-shm");
        if shm_path.exists() {
            let backup_shm = backup_path.with_extension("db-shm");
            if let Err(e) = fs::copy(&shm_path, &backup_shm).await {
                warn!("Failed to backup SHM file: {}", e);
            }
        }

        info!(
            "✅ Database backup created successfully: {}",
            backup_path.display()
        );
        Ok(backup_path)
    }

    /// Restore database from a backup
    ///
    /// # Arguments
    /// * `backup_path` - Path to the backup file to restore from
    pub async fn restore_backup(&self, backup_path: &Path) -> Result<()> {
        if !backup_path.exists() {
            return Err(anyhow::anyhow!(
                "Backup file does not exist: {}",
                backup_path.display()
            ));
        }

        info!("Restoring database from backup: {}", backup_path.display());

        // Create a backup of current database before restoring
        let safety_backup = self.db_path.with_extension("db.before_restore");
        if self.db_path.exists() {
            fs::copy(&self.db_path, &safety_backup)
                .await
                .context("Failed to create safety backup")?;
            info!("Created safety backup: {}", safety_backup.display());
        }

        // Restore the backup
        fs::copy(backup_path, &self.db_path)
            .await
            .context("Failed to restore database")?;

        // Restore WAL file if it exists
        let backup_wal = backup_path.with_extension("db-wal");
        if backup_wal.exists() {
            let wal_path = self.db_path.with_extension("db-wal");
            if let Err(e) = fs::copy(&backup_wal, &wal_path).await {
                warn!("Failed to restore WAL file: {}", e);
            }
        }

        // Restore SHM file if it exists
        let backup_shm = backup_path.with_extension("db-shm");
        if backup_shm.exists() {
            let shm_path = self.db_path.with_extension("db-shm");
            if let Err(e) = fs::copy(&backup_shm, &shm_path).await {
                warn!("Failed to restore SHM file: {}", e);
            }
        }

        info!(
            "✅ Database restored successfully from: {}",
            backup_path.display()
        );
        Ok(())
    }

    /// List all available backups
    ///
    /// Returns a list of backup file paths, sorted by creation time (newest first)
    pub async fn list_backups(&self) -> Result<Vec<PathBuf>> {
        if !self.backup_dir.exists() {
            return Ok(Vec::new());
        }

        let mut backups = Vec::new();
        let mut entries = fs::read_dir(&self.backup_dir)
            .await
            .context("Failed to read backup directory")?;

        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("db") {
                if let Some(filename) = path.file_name().and_then(|s| s.to_str()) {
                    if filename.starts_with("meetfree_backup_") {
                        backups.push(path);
                    }
                }
            }
        }

        // Sort by filename (which includes timestamp) in reverse order
        backups.sort_by(|a, b| b.cmp(a));

        Ok(backups)
    }

    /// Clean up old backups, keeping only the most recent N backups
    ///
    /// # Arguments
    /// * `keep_count` - Number of most recent backups to keep
    pub async fn cleanup_old_backups(&self, keep_count: usize) -> Result<usize> {
        let backups = self.list_backups().await?;

        if backups.len() <= keep_count {
            return Ok(0);
        }

        let to_delete = &backups[keep_count..];
        let mut deleted = 0;

        for backup_path in to_delete {
            info!("Deleting old backup: {}", backup_path.display());

            // Delete main backup file
            if let Err(e) = fs::remove_file(backup_path).await {
                error!("Failed to delete backup {}: {}", backup_path.display(), e);
                continue;
            }

            // Delete associated WAL file if exists
            let wal_path = backup_path.with_extension("db-wal");
            if wal_path.exists() {
                let _ = fs::remove_file(&wal_path).await;
            }

            // Delete associated SHM file if exists
            let shm_path = backup_path.with_extension("db-shm");
            if shm_path.exists() {
                let _ = fs::remove_file(&shm_path).await;
            }

            deleted += 1;
        }

        info!("✅ Cleaned up {} old backups", deleted);
        Ok(deleted)
    }

    /// Get the size of all backups in bytes
    pub async fn get_total_backup_size(&self) -> Result<u64> {
        let backups = self.list_backups().await?;
        let mut total_size = 0u64;

        for backup_path in backups {
            if let Ok(metadata) = fs::metadata(&backup_path).await {
                total_size += metadata.len();
            }

            // Add WAL file size
            let wal_path = backup_path.with_extension("db-wal");
            if let Ok(metadata) = fs::metadata(&wal_path).await {
                total_size += metadata.len();
            }

            // Add SHM file size
            let shm_path = backup_path.with_extension("db-shm");
            if let Ok(metadata) = fs::metadata(&shm_path).await {
                total_size += metadata.len();
            }
        }

        Ok(total_size)
    }
}

/// Tauri commands for database backup
#[tauri::command]
pub async fn create_database_backup(app: tauri::AppHandle) -> Result<String, String> {
    use crate::state::AppState;
    use tauri::Manager;

    let state = app.state::<AppState>();
    let db_path = state.db_manager.db_path();

    // Get backup directory (in app data dir)
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let backup_dir = app_data_dir.join("backups");

    let manager = BackupManager::new(db_path.to_path_buf(), backup_dir);
    let backup_path = manager
        .create_backup()
        .await
        .map_err(|e| format!("Failed to create backup: {}", e))?;

    Ok(backup_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn list_database_backups(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    use crate::state::AppState;
    use tauri::Manager;

    let state = app.state::<AppState>();
    let db_path = state.db_manager.db_path();

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let backup_dir = app_data_dir.join("backups");

    let manager = BackupManager::new(db_path.to_path_buf(), backup_dir);
    let backups = manager
        .list_backups()
        .await
        .map_err(|e| format!("Failed to list backups: {}", e))?;

    Ok(backups
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect())
}

#[tauri::command]
pub async fn cleanup_old_backups(
    app: tauri::AppHandle,
    keep_count: usize,
) -> Result<usize, String> {
    use crate::state::AppState;
    use tauri::Manager;

    let state = app.state::<AppState>();
    let db_path = state.db_manager.db_path();

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let backup_dir = app_data_dir.join("backups");

    let manager = BackupManager::new(db_path.to_path_buf(), backup_dir);
    manager
        .cleanup_old_backups(keep_count)
        .await
        .map_err(|e| format!("Failed to cleanup backups: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_backup_manager_creation() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let backup_dir = temp_dir.path().join("backups");

        let manager = BackupManager::new(db_path, backup_dir);
        assert!(manager.db_path.to_string_lossy().contains("test.db"));
    }
}
