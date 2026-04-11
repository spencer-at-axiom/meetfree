use anyhow::Result;
use log::{error, warn};
use std::time::Duration;

/// Retry a database operation with exponential backoff
///
/// # Arguments
/// * `operation` - Async function that returns Result<T>
/// * `max_retries` - Maximum number of retry attempts (default: 3)
/// * `operation_name` - Name of the operation for logging
///
/// # Returns
/// Result from the operation or the last error encountered
///
/// # Example
/// ```rust,ignore
/// let result = retry_db_operation(
///     || async {
///         TranscriptsRepository::save_transcript(pool, &title, &transcripts, folder, options).await
///     },
///     3,
///     "save_transcript"
/// ).await?;
/// ```
pub async fn retry_db_operation<T, F, Fut>(
    operation: F,
    max_retries: u32,
    operation_name: &str,
) -> Result<T>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T>>,
{
    let mut retries = max_retries;

    loop {
        match operation().await {
            Ok(result) => {
                if max_retries - retries > 0 {
                    log::info!(
                        "✅ Database operation '{}' succeeded after {} retries",
                        operation_name,
                        max_retries - retries
                    );
                }
                return Ok(result);
            }
            Err(e) if retries > 0 => {
                let backoff_ms = 100 * (max_retries - retries + 1) as u64;
                warn!(
                    "⚠️  Database operation '{}' failed (attempt {}/{}): {}. Retrying in {}ms...",
                    operation_name,
                    max_retries - retries + 1,
                    max_retries + 1,
                    e,
                    backoff_ms
                );

                tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                retries -= 1;
            }
            Err(e) => {
                error!(
                    "❌ Database operation '{}' failed after {} attempts: {}",
                    operation_name,
                    max_retries + 1,
                    e
                );
                return Err(e);
            }
        }
    }
}

/// Retry a database operation with custom retry configuration
pub struct RetryConfig {
    pub max_retries: u32,
    pub initial_backoff_ms: u64,
    pub max_backoff_ms: u64,
    pub backoff_multiplier: f64,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_retries: 3,
            initial_backoff_ms: 100,
            max_backoff_ms: 5000,
            backoff_multiplier: 2.0,
        }
    }
}

/// Retry with custom configuration
pub async fn retry_db_operation_with_config<T, F, Fut>(
    operation: F,
    config: RetryConfig,
    operation_name: &str,
) -> Result<T>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T>>,
{
    let mut retries = config.max_retries;
    let mut backoff_ms = config.initial_backoff_ms;

    loop {
        match operation().await {
            Ok(result) => {
                if config.max_retries - retries > 0 {
                    log::info!(
                        "✅ Database operation '{}' succeeded after {} retries",
                        operation_name,
                        config.max_retries - retries
                    );
                }
                return Ok(result);
            }
            Err(e) if retries > 0 => {
                warn!(
                    "⚠️  Database operation '{}' failed (attempt {}/{}): {}. Retrying in {}ms...",
                    operation_name,
                    config.max_retries - retries + 1,
                    config.max_retries + 1,
                    e,
                    backoff_ms
                );

                tokio::time::sleep(Duration::from_millis(backoff_ms)).await;

                // Exponential backoff with cap
                backoff_ms = ((backoff_ms as f64 * config.backoff_multiplier) as u64)
                    .min(config.max_backoff_ms);

                retries -= 1;
            }
            Err(e) => {
                error!(
                    "❌ Database operation '{}' failed after {} attempts: {}",
                    operation_name,
                    config.max_retries + 1,
                    e
                );
                return Err(e);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[tokio::test]
    async fn test_retry_succeeds_first_attempt() {
        let call_count = Arc::new(Mutex::new(0));
        let call_count_clone = call_count.clone();
        let result = retry_db_operation(
            move || {
                let count = call_count_clone.clone();
                async move {
                    *count.lock().unwrap() += 1;
                    Ok::<i32, anyhow::Error>(42)
                }
            },
            3,
            "test_operation",
        )
        .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 42);
        assert_eq!(*call_count.lock().unwrap(), 1);
    }

    #[tokio::test]
    async fn test_retry_succeeds_after_failures() {
        let call_count = Arc::new(Mutex::new(0));
        let call_count_clone = call_count.clone();
        let result = retry_db_operation(
            move || {
                let count = call_count_clone.clone();
                async move {
                    *count.lock().unwrap() += 1;
                    let current = *count.lock().unwrap();
                    if current < 3 {
                        Err(anyhow::anyhow!("Temporary failure"))
                    } else {
                        Ok::<i32, anyhow::Error>(42)
                    }
                }
            },
            3,
            "test_operation",
        )
        .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 42);
        assert_eq!(*call_count.lock().unwrap(), 3);
    }

    #[tokio::test]
    async fn test_retry_fails_after_max_attempts() {
        let call_count = Arc::new(Mutex::new(0));
        let call_count_clone = call_count.clone();
        let result = retry_db_operation(
            move || {
                let count = call_count_clone.clone();
                async move {
                    *count.lock().unwrap() += 1;
                    Err::<i32, anyhow::Error>(anyhow::anyhow!("Persistent failure"))
                }
            },
            3,
            "test_operation",
        )
        .await;

        assert!(result.is_err());
        assert_eq!(*call_count.lock().unwrap(), 4); // Initial + 3 retries
    }
}
