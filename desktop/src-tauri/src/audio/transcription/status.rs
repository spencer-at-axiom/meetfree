// audio/transcription/status.rs
//
// Global transcription status tracking for real-time monitoring

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

/// Global transcription status tracker
pub struct TranscriptionStatusTracker {
    chunks_queued: Arc<AtomicU64>,
    chunks_completed: Arc<AtomicU64>,
    is_processing: Arc<AtomicBool>,
    last_activity_ms: Arc<AtomicU64>,
}

impl TranscriptionStatusTracker {
    pub fn new() -> Self {
        Self {
            chunks_queued: Arc::new(AtomicU64::new(0)),
            chunks_completed: Arc::new(AtomicU64::new(0)),
            is_processing: Arc::new(AtomicBool::new(false)),
            last_activity_ms: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn start_processing(&self) {
        self.is_processing.store(true, Ordering::SeqCst);
        self.update_activity();
    }

    pub fn stop_processing(&self) {
        self.is_processing.store(false, Ordering::SeqCst);
        self.update_activity();
    }

    pub fn increment_queued(&self) -> u64 {
        self.update_activity();
        self.chunks_queued.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn increment_completed(&self) -> u64 {
        self.update_activity();
        self.chunks_completed.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn reset(&self) {
        self.chunks_queued.store(0, Ordering::SeqCst);
        self.chunks_completed.store(0, Ordering::SeqCst);
        self.is_processing.store(false, Ordering::SeqCst);
        self.last_activity_ms.store(0, Ordering::SeqCst);
    }

    pub fn get_chunks_in_queue(&self) -> usize {
        let queued = self.chunks_queued.load(Ordering::SeqCst);
        let completed = self.chunks_completed.load(Ordering::SeqCst);
        queued.saturating_sub(completed) as usize
    }

    pub fn is_processing(&self) -> bool {
        self.is_processing.load(Ordering::SeqCst)
    }

    pub fn last_activity_ms(&self) -> u64 {
        self.last_activity_ms.load(Ordering::SeqCst)
    }

    fn update_activity(&self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        self.last_activity_ms.store(now, Ordering::SeqCst);
    }

    pub fn get_arc_queued(&self) -> Arc<AtomicU64> {
        self.chunks_queued.clone()
    }

    pub fn get_arc_completed(&self) -> Arc<AtomicU64> {
        self.chunks_completed.clone()
    }

    pub fn get_arc_processing(&self) -> Arc<AtomicBool> {
        self.is_processing.clone()
    }
}

impl Default for TranscriptionStatusTracker {
    fn default() -> Self {
        Self::new()
    }
}

// Global singleton instance
use once_cell::sync::Lazy;

static GLOBAL_STATUS: Lazy<TranscriptionStatusTracker> = Lazy::new(TranscriptionStatusTracker::new);

pub fn get_global_status() -> &'static TranscriptionStatusTracker {
    &GLOBAL_STATUS
}
