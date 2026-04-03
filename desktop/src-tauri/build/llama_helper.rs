use std::path::{Path, PathBuf};
use std::time::SystemTime;

pub fn ensure_llama_helper_binary() {
    let target = std::env::var("TARGET")
        .or_else(|_| std::env::var("HOST"))
        .expect("Neither TARGET nor HOST environment variable set");
    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR")
            .expect("CARGO_MANIFEST_DIR environment variable not set"),
    );
    let binaries_dir = manifest_dir.join("binaries");
    let bundled_binary = binaries_dir.join(sidecar_name(&target));
    let helper_dir = manifest_dir.join("../..").join("llama-helper");

    println!(
        "cargo:rerun-if-changed={}",
        helper_dir.join("Cargo.toml").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        helper_dir.join("src").display()
    );

    std::fs::create_dir_all(&binaries_dir).expect("Failed to create binaries directory");

    if let Some(existing) = find_existing_sidecar(&manifest_dir, &target, &profile) {
        ensure_sidecar_is_fresh(&helper_dir, &existing);
        copy_sidecar(&existing, &bundled_binary);
        return;
    }

    panic!(
        "llama-helper sidecar is missing for target {}. Build it first with 'cargo build -p llama-helper' and then rerun the Tauri build.",
        target,
    );
}

fn find_existing_sidecar(manifest_dir: &Path, target: &str, profile: &str) -> Option<PathBuf> {
    let workspace_root = manifest_dir
        .parent()
        .and_then(|path| path.parent())
        .expect("Failed to determine workspace root");
    let sidecar_target_dir = workspace_root.join("target").join("llama-helper-sidecar");
    let binary_file = if target.contains("windows") {
        "llama-helper.exe"
    } else {
        "llama-helper"
    };

    let candidates = [
        workspace_root
            .join("target")
            .join(profile)
            .join(binary_file),
        workspace_root
            .join("target")
            .join(target)
            .join(profile)
            .join(binary_file),
        sidecar_target_dir.join(profile).join(binary_file),
        sidecar_target_dir
            .join(target)
            .join(profile)
            .join(binary_file),
    ];

    candidates.into_iter().find(|path| path.exists())
}

fn copy_sidecar(source: &Path, destination: &Path) {
    std::fs::copy(source, destination).unwrap_or_else(|error| {
        panic!(
            "Failed to copy llama-helper sidecar from {} to {}: {error}",
            source.display(),
            destination.display()
        )
    });

    if let Ok(metadata) = std::fs::metadata(source) {
        let _ = std::fs::set_permissions(destination, metadata.permissions());
    }
}

fn ensure_sidecar_is_fresh(helper_dir: &Path, sidecar_binary: &Path) {
    let sidecar_mtime = modified_time(sidecar_binary);
    let helper_sources_mtime = latest_modified(helper_dir.join("Cargo.toml"))
        .into_iter()
        .chain(latest_modified_in_tree(&helper_dir.join("src")))
        .max()
        .unwrap_or(SystemTime::UNIX_EPOCH);

    assert!(
        sidecar_mtime >= helper_sources_mtime,
        "llama-helper binary at {} is older than helper sources in {}. Rebuild it with 'cargo build -p llama-helper' before building the desktop app.",
        sidecar_binary.display(),
        helper_dir.display()
    );
}

fn latest_modified(path: PathBuf) -> Option<SystemTime> {
    std::fs::metadata(path).ok()?.modified().ok()
}

fn latest_modified_in_tree(path: &Path) -> Vec<SystemTime> {
    let mut times = Vec::new();

    if let Ok(metadata) = std::fs::metadata(path) {
        if let Ok(modified) = metadata.modified() {
            times.push(modified);
        }

        if metadata.is_dir() {
            if let Ok(entries) = std::fs::read_dir(path) {
                for entry in entries.flatten() {
                    times.extend(latest_modified_in_tree(&entry.path()));
                }
            }
        }
    }

    times
}

fn modified_time(path: &Path) -> SystemTime {
    std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH)
}

fn sidecar_name(target: &str) -> String {
    if target.contains("windows") {
        format!("llama-helper-{target}.exe")
    } else {
        format!("llama-helper-{target}")
    }
}
