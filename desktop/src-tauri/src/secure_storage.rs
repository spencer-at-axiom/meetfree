//! Secure storage for API keys using OS-backed credential stores
//!
//! This module provides secure storage for sensitive data like API keys
//! using the operating system's native credential storage:
//! - macOS: Keychain
//! - Windows: Credential Manager
//! - Linux: Secret Service (libsecret)
//!
//! API keys are never stored in plaintext in SQLite or configuration files.

use anyhow::{Context, Result};
use keyring::Entry;
use log::{error, info, warn};

const SERVICE_NAME: &str = "com.meetfree.app";

/// Store an API key securely in the OS credential store
///
/// # Arguments
/// * `provider` - Provider identifier (e.g., "openai", "claude", "groq")
/// * `api_key` - The API key to store
///
/// # Returns
/// Result indicating success or failure
pub fn store_api_key(provider: &str, api_key: &str) -> Result<()> {
    let key_name = format!("api_key_{}", provider);

    let entry = Entry::new(SERVICE_NAME, &key_name).context("Failed to create keyring entry")?;

    entry.set_password(api_key).context(format!(
        "Failed to store API key for provider: {}",
        provider
    ))?;

    info!("✅ Securely stored API key for provider: {}", provider);
    Ok(())
}

/// Retrieve an API key from the OS credential store
///
/// # Arguments
/// * `provider` - Provider identifier (e.g., "openai", "claude", "groq")
///
/// # Returns
/// Result containing the API key or an error if not found
pub fn retrieve_api_key(provider: &str) -> Result<String> {
    let key_name = format!("api_key_{}", provider);

    let entry = Entry::new(SERVICE_NAME, &key_name).context("Failed to create keyring entry")?;

    let api_key = entry.get_password().context(format!(
        "Failed to retrieve API key for provider: {}",
        provider
    ))?;

    info!("✅ Retrieved API key for provider: {}", provider);
    Ok(api_key)
}

/// Delete an API key from the OS credential store
///
/// # Arguments
/// * `provider` - Provider identifier (e.g., "openai", "claude", "groq")
///
/// # Returns
/// Result indicating success or failure
pub fn delete_api_key(provider: &str) -> Result<()> {
    let key_name = format!("api_key_{}", provider);

    let entry = Entry::new(SERVICE_NAME, &key_name).context("Failed to create keyring entry")?;

    entry.delete_credential().context(format!(
        "Failed to delete API key for provider: {}",
        provider
    ))?;

    info!("✅ Deleted API key for provider: {}", provider);
    Ok(())
}

/// Check if an API key exists for a provider
///
/// # Arguments
/// * `provider` - Provider identifier (e.g., "openai", "claude", "groq")
///
/// # Returns
/// true if an API key exists, false otherwise
pub fn has_api_key(provider: &str) -> bool {
    retrieve_api_key(provider).is_ok()
}

/// Migrate API keys from SQLite to secure storage
///
/// This function should be called once during app initialization to migrate
/// existing API keys from plaintext SQLite storage to secure OS credential storage.
///
/// # Arguments
/// * `keys` - Map of provider names to API keys from SQLite
///
/// # Returns
/// Number of keys successfully migrated
pub fn migrate_keys_from_sqlite(keys: Vec<(String, String)>) -> usize {
    let mut migrated = 0;

    for (provider, api_key) in keys {
        if api_key.is_empty() {
            continue;
        }

        // Check if key already exists in secure storage
        if has_api_key(&provider) {
            info!(
                "API key for {} already in secure storage, skipping",
                provider
            );
            continue;
        }

        // Store in secure storage
        match store_api_key(&provider, &api_key) {
            Ok(_) => {
                info!("✅ Migrated API key for {} to secure storage", provider);
                migrated += 1;
            }
            Err(e) => {
                error!("❌ Failed to migrate API key for {}: {}", provider, e);
            }
        }
    }

    if migrated > 0 {
        info!("✅ Migrated {} API keys to secure storage", migrated);
        warn!("⚠️  Remember to delete plaintext keys from SQLite after migration");
    }

    migrated
}

/// List all providers that have stored API keys
///
/// Note: This function attempts to retrieve keys for known providers.
/// It cannot enumerate all keys in the keyring.
///
/// # Returns
/// Vector of provider names that have stored API keys
pub fn list_stored_providers() -> Vec<String> {
    let known_providers = vec![
        "openai",
        "claude",
        "groq",
        "ollama",
        "openrouter",
        "custom_openai",
    ];

    known_providers
        .into_iter()
        .filter(|provider| has_api_key(provider))
        .map(|s| s.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Note: These tests require access to the OS keyring/credential manager
    // On Windows in test environments, the credential manager may not be accessible
    // Run these tests manually in a normal user session to verify functionality
    #[test]
    #[ignore = "Requires OS keyring access - run manually with 'cargo test -- --ignored'"]
    fn test_store_and_retrieve() {
        let provider = "test_provider";
        let api_key = "test_key_12345";

        // Store
        let store_result = store_api_key(provider, api_key);
        assert!(
            store_result.is_ok(),
            "Failed to store: {:?}",
            store_result.err()
        );

        // Retrieve
        let retrieved = retrieve_api_key(provider);
        assert!(
            retrieved.is_ok(),
            "Failed to retrieve: {:?}",
            retrieved.err()
        );
        assert_eq!(retrieved.unwrap(), api_key);

        // Cleanup
        let _ = delete_api_key(provider);
    }

    #[test]
    #[ignore = "Requires OS keyring access - run manually with 'cargo test -- --ignored'"]
    fn test_has_api_key() {
        let provider = "test_provider_2";
        let api_key = "test_key_67890";

        // Should not exist initially
        assert!(!has_api_key(provider));

        // Store
        let store_result = store_api_key(provider, api_key);
        assert!(
            store_result.is_ok(),
            "Failed to store: {:?}",
            store_result.err()
        );

        // Should exist now
        assert!(has_api_key(provider), "API key should exist after storing");

        // Cleanup
        let _ = delete_api_key(provider);

        // Should not exist after deletion
        assert!(!has_api_key(provider));
    }

    #[test]
    fn test_delete_nonexistent() {
        let provider = "nonexistent_provider";

        // Deleting nonexistent key should fail gracefully
        let result = delete_api_key(provider);
        assert!(result.is_err());
    }
}
