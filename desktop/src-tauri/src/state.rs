use crate::database::manager::DatabaseManager;
use crate::summary::service::SummaryRuntimeState;

pub struct AppState {
    pub db_manager: DatabaseManager,
    pub recording_runtime: crate::audio::recording_commands::RecordingRuntimeState,
    pub summary_runtime: SummaryRuntimeState,
}

impl AppState {
    pub fn new(db_manager: DatabaseManager) -> Self {
        Self {
            db_manager,
            recording_runtime: crate::audio::recording_commands::RecordingRuntimeState::new(),
            summary_runtime: SummaryRuntimeState::new(),
        }
    }
}
