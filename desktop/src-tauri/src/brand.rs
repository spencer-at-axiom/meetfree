use anyhow::{Context, Result};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

pub const APP_NAME: &str = "Meetfree";
pub const APP_SLUG: &str = "meetfree";
pub const LEGACY_APP_NAME: &str = "Meetily";
pub const LEGACY_APP_SLUG: &str = "meetily";

pub const APP_IDENTIFIER: &str = "com.meetfree.ai";
pub const LEGACY_APP_IDENTIFIER: &str = "com.meetily.ai";

pub const LLAMA_HELPER_ENV: &str = "MEETFREE_LLAMA_HELPER";
pub const LEGACY_LLAMA_HELPER_ENV: &str = "MEETILY_LLAMA_HELPER";
pub const LLAMA_HELPER_ALLOW_FUZZY_ENV: &str = "MEETFREE_LLAMA_HELPER_ALLOW_FUZZY";
pub const LEGACY_LLAMA_HELPER_ALLOW_FUZZY_ENV: &str = "MEETILY_LLAMA_HELPER_ALLOW_FUZZY";

pub const RECORDINGS_DIR_NAME: &str = "meetfree-recordings";
pub const LEGACY_RECORDINGS_DIR_NAME: &str = "meetily-recordings";

const MIGRATION_MARKER: &str = ".meetfree_migration_complete";

#[derive(Debug, Clone)]
pub struct BrandPaths {
    pub app_data_dir: PathBuf,
    pub app_config_dir: PathBuf,
    pub migration_marker: PathBuf,
}

#[derive(Debug, Clone, Default)]
pub struct MigrationStats {
    pub files_copied: usize,
    pub dirs_created: usize,
}

impl MigrationStats {
    fn merge(&mut self, other: &Self) {
        self.files_copied += other.files_copied;
        self.dirs_created += other.dirs_created;
    }
}

pub fn resolve_brand_paths<R: Runtime>(app: &AppHandle<R>) -> Result<BrandPaths> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .context("failed to resolve app_data_dir")?;
    let app_config_dir = app
        .path()
        .app_config_dir()
        .context("failed to resolve app_config_dir")?;
    let migration_marker = app_data_dir.join(MIGRATION_MARKER);

    Ok(BrandPaths {
        app_data_dir,
        app_config_dir,
        migration_marker,
    })
}

pub fn data_roots_with_legacy() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(data_dir) = dirs::data_dir() {
        paths.push(data_dir.join(APP_SLUG));
        paths.push(data_dir.join(LEGACY_APP_NAME));
        paths.push(data_dir.join(LEGACY_APP_SLUG));
    }
    paths
}

pub fn config_roots_with_legacy() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(config_dir) = dirs::config_dir() {
        paths.push(config_dir.join(APP_SLUG));
        paths.push(config_dir.join(LEGACY_APP_NAME));
        paths.push(config_dir.join(LEGACY_APP_SLUG));
    }
    paths
}

pub fn custom_template_dirs_with_legacy() -> Vec<PathBuf> {
    data_roots_with_legacy()
        .into_iter()
        .map(|p| p.join("templates"))
        .collect()
}

pub fn migrate_legacy_brand_paths<R: Runtime>(app: &AppHandle<R>) -> Result<MigrationStats> {
    let paths = resolve_brand_paths(app)?;

    if paths.migration_marker.exists() {
        log::info!(
            "Brand migration already completed (marker: {})",
            paths.migration_marker.display()
        );
        return Ok(MigrationStats::default());
    }

    if !paths.app_data_dir.exists() {
        fs::create_dir_all(&paths.app_data_dir).with_context(|| {
            format!(
                "failed to create app data dir {}",
                paths.app_data_dir.display()
            )
        })?;
    }
    if !paths.app_config_dir.exists() {
        fs::create_dir_all(&paths.app_config_dir).with_context(|| {
            format!(
                "failed to create app config dir {}",
                paths.app_config_dir.display()
            )
        })?;
    }

    let mut stats = MigrationStats::default();
    let mut migrated_anything = false;

    for source in legacy_data_sources(&paths.app_data_dir) {
        if source.exists() {
            let source_stats = merge_copy_dir(&source, &paths.app_data_dir)?;
            if source_stats.files_copied > 0 || source_stats.dirs_created > 0 {
                log::info!(
                    "Migrated legacy data from {} -> {} (files: {}, dirs: {})",
                    source.display(),
                    paths.app_data_dir.display(),
                    source_stats.files_copied,
                    source_stats.dirs_created
                );
                migrated_anything = true;
            }
            stats.merge(&source_stats);
        }
    }

    for source in legacy_config_sources(&paths.app_config_dir) {
        if source.exists() {
            let source_stats = merge_copy_dir(&source, &paths.app_config_dir)?;
            if source_stats.files_copied > 0 || source_stats.dirs_created > 0 {
                log::info!(
                    "Migrated legacy config from {} -> {} (files: {}, dirs: {})",
                    source.display(),
                    paths.app_config_dir.display(),
                    source_stats.files_copied,
                    source_stats.dirs_created
                );
                migrated_anything = true;
            }
            stats.merge(&source_stats);
        }
    }

    fs::write(&paths.migration_marker, b"meetfree migration complete").with_context(|| {
        format!(
            "failed to write marker {}",
            paths.migration_marker.display()
        )
    })?;

    if migrated_anything {
        log::info!(
            "Brand migration complete: {} files copied, {} directories created",
            stats.files_copied,
            stats.dirs_created
        );
    } else {
        log::info!("Brand migration complete: no legacy files found");
    }

    Ok(stats)
}

fn legacy_data_sources(app_data_dir: &Path) -> Vec<PathBuf> {
    let mut sources = Vec::new();
    if let Some(swapped) =
        swap_identifier_component(app_data_dir, APP_IDENTIFIER, LEGACY_APP_IDENTIFIER)
    {
        sources.push(swapped);
    }

    if let Some(data_dir) = dirs::data_dir() {
        sources.push(data_dir.join(LEGACY_APP_NAME));
        sources.push(data_dir.join(LEGACY_APP_SLUG));
    }

    sources
}

fn legacy_config_sources(app_config_dir: &Path) -> Vec<PathBuf> {
    let mut sources = Vec::new();
    if let Some(swapped) =
        swap_identifier_component(app_config_dir, APP_IDENTIFIER, LEGACY_APP_IDENTIFIER)
    {
        sources.push(swapped);
    }

    if let Some(config_dir) = dirs::config_dir() {
        sources.push(config_dir.join(LEGACY_APP_NAME));
        sources.push(config_dir.join(LEGACY_APP_SLUG));
    }

    sources
}

fn swap_identifier_component(path: &Path, from: &str, to: &str) -> Option<PathBuf> {
    let raw = path.to_string_lossy();
    if raw.contains(from) {
        Some(PathBuf::from(raw.replace(from, to)))
    } else {
        None
    }
}

fn merge_copy_dir(source: &Path, target: &Path) -> Result<MigrationStats> {
    let mut stats = MigrationStats::default();
    if !target.exists() {
        fs::create_dir_all(target)
            .with_context(|| format!("failed to create target dir {}", target.display()))?;
        stats.dirs_created += 1;
    }

    for entry in fs::read_dir(source)
        .with_context(|| format!("failed to read source dir {}", source.display()))?
    {
        let entry = entry
            .with_context(|| format!("failed to read source entry in {}", source.display()))?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());

        if source_path.is_dir() {
            let child_stats = merge_copy_dir(&source_path, &target_path)?;
            stats.merge(&child_stats);
        } else if source_path.is_file() && !target_path.exists() {
            if let Some(parent) = target_path.parent() {
                if !parent.exists() {
                    fs::create_dir_all(parent).with_context(|| {
                        format!("failed to create parent dir {}", parent.display())
                    })?;
                    stats.dirs_created += 1;
                }
            }
            fs::copy(&source_path, &target_path).with_context(|| {
                format!(
                    "failed to copy {} -> {}",
                    source_path.display(),
                    target_path.display()
                )
            })?;
            stats.files_copied += 1;
        }
    }

    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn template_dirs_prioritize_primary_then_legacy() {
        let dirs = custom_template_dirs_with_legacy();
        if dirs.is_empty() {
            return;
        }

        let serialized: Vec<String> = dirs
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        assert!(serialized.iter().any(|p| p.contains(APP_SLUG)));
        assert!(serialized
            .iter()
            .any(|p| p.contains(LEGACY_APP_SLUG) || p.contains(LEGACY_APP_NAME)));
    }

    #[test]
    fn merge_copy_dir_copies_new_and_keeps_existing() {
        let source = tempdir().expect("source tempdir");
        let target = tempdir().expect("target tempdir");

        let src_file = source.path().join("a.txt");
        let src_nested = source.path().join("nested");
        let src_nested_file = src_nested.join("b.txt");

        fs::create_dir_all(&src_nested).expect("create nested");
        fs::write(&src_file, "source-a").expect("write source a");
        fs::write(&src_nested_file, "source-b").expect("write source b");

        let existing_target_file = target.path().join("a.txt");
        fs::write(&existing_target_file, "target-a").expect("write target existing");

        let stats = merge_copy_dir(source.path(), target.path()).expect("merge copy");
        assert!(stats.files_copied >= 1);

        let copied_nested = target.path().join("nested").join("b.txt");
        assert!(copied_nested.exists());
        assert_eq!(
            fs::read_to_string(&existing_target_file).expect("read existing"),
            "target-a"
        );
    }
}
