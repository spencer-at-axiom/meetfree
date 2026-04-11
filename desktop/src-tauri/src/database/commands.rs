use log::{error, info};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use super::manager::DatabaseManager;
use super::models::{
    ActionItemModel, DecisionModel, MeetingSpeakerModel, SpeakerIdentityModel, VoiceProfileModel,
};
use super::repositories::action_item::{ActionItemsRepository, UpdateActionItemReview};
use super::repositories::decision::{DecisionsRepository, UpdateDecisionReview};
use super::repositories::speaker_identity::{
    IdentityActionItem, IdentityMeetingAppearance, NewVoiceProfile, SpeakerIdentitiesRepository,
    UpdateVoiceProfile,
};
use crate::state::AppState;

/// Check if this is the first launch (no database exists yet)
#[tauri::command]
pub async fn check_first_launch(app: AppHandle) -> Result<bool, String> {
    DatabaseManager::is_first_launch(&app)
        .await
        .map_err(|e| format!("Failed to check first launch: {}", e))
}

/// Initialize a fresh database for first-run setup
#[tauri::command]
pub async fn initialize_fresh_database(app: AppHandle) -> Result<(), String> {
    info!("Initializing fresh database");

    let db_manager = DatabaseManager::new_from_app_handle(&app)
        .await
        .map_err(|e| {
            error!("Failed to initialize fresh database: {}", e);
            format!("Failed to initialize database: {}", e)
        })?;

    // Update app state with the new manager
    app.manage(AppState::new(db_manager.clone()));

    // Set default model configuration for fresh installs
    let pool = db_manager.pool();

    // Default summary configuration for fresh installs
    if let Err(e) = crate::database::repositories::setting::SettingsRepository::save_model_config(
        pool,
        crate::config::DEFAULT_SUMMARY_PROVIDER,
        crate::config::DEFAULT_SUMMARY_MODEL,
        crate::config::DEFAULT_WHISPER_MODEL,
        None,
    )
    .await
    {
        error!("Failed to set default summary model config: {}", e);
    }

    // Default Transcription Model: Parakeet
    if let Err(e) =
        crate::database::repositories::setting::SettingsRepository::save_transcript_config(
            pool,
            "parakeet",
            crate::config::DEFAULT_PARAKEET_MODEL,
        )
        .await
    {
        error!("Failed to set default transcription model config: {}", e);
    }

    info!("Fresh database initialized successfully with default models");

    // Emit event to notify frontend that database is ready
    app.emit("database-initialized", ())
        .map_err(|e| format!("Failed to emit database-initialized event: {}", e))?;

    Ok(())
}

/// Get the database directory path
#[tauri::command]
pub async fn get_database_directory(app: AppHandle) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    Ok(app_data_dir.to_string_lossy().to_string())
}

/// Open the database folder in the system file explorer
#[tauri::command]
pub async fn open_database_folder(app: AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // Ensure directory exists before trying to open it
    if !app_data_dir.exists() {
        std::fs::create_dir_all(&app_data_dir)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    let folder_path = app_data_dir.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    info!("Opened database folder: {}", folder_path);
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructuredReviewSnapshot {
    pub meeting_speakers: Vec<MeetingSpeakerModel>,
    pub action_items: Vec<ActionItemModel>,
    pub decisions: Vec<DecisionModel>,
    pub speaker_identities: Vec<SpeakerIdentityModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ActionItemReviewUpdateRequest {
    pub title: Option<String>,
    pub details: Option<Option<String>>,
    pub owner_speaker_identity_id: Option<Option<String>>,
    pub owner_display_name: Option<Option<String>>,
    pub due_date: Option<Option<String>>,
    pub review_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DecisionReviewUpdateRequest {
    pub title: Option<String>,
    pub details: Option<Option<String>>,
    pub review_status: Option<String>,
}

fn normalize_review_status(
    value: Option<String>,
    default: &str,
    allowed: &[&str],
    field_name: &str,
) -> Result<String, String> {
    let normalized = value
        .unwrap_or_else(|| default.to_string())
        .trim()
        .to_lowercase();

    if allowed.contains(&normalized.as_str()) {
        Ok(normalized)
    } else {
        Err(format!(
            "{} must be one of: {}",
            field_name,
            allowed.join(", ")
        ))
    }
}

#[tauri::command]
pub async fn structured_review_get(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<StructuredReviewSnapshot, String> {
    if meeting_id.trim().is_empty() {
        return Err("meeting_id cannot be empty".to_string());
    }

    let pool = state.db_manager.pool();

    let meeting_speakers = SpeakerIdentitiesRepository::list_meeting_speakers(pool, &meeting_id)
        .await
        .map_err(|error| format!("Failed to load meeting speakers: {}", error))?;

    let action_items = ActionItemsRepository::list_meeting_action_items(pool, &meeting_id)
        .await
        .map_err(|error| format!("Failed to load action items: {}", error))?;

    let decisions = DecisionsRepository::list_meeting_decisions(pool, &meeting_id)
        .await
        .map_err(|error| format!("Failed to load decisions: {}", error))?;

    let speaker_identities = SpeakerIdentitiesRepository::list_identities(pool)
        .await
        .map_err(|error| format!("Failed to load speaker identities: {}", error))?;

    Ok(StructuredReviewSnapshot {
        meeting_speakers,
        action_items,
        decisions,
        speaker_identities,
    })
}

#[tauri::command]
pub async fn meeting_speaker_rename_local(
    state: tauri::State<'_, AppState>,
    meeting_speaker_id: String,
    display_name_override: Option<String>,
    review_status: Option<String>,
) -> Result<bool, String> {
    if meeting_speaker_id.trim().is_empty() {
        return Err("meeting_speaker_id cannot be empty".to_string());
    }

    let review_status = normalize_review_status(
        review_status,
        "confirmed",
        &["unreviewed", "confirmed"],
        "review_status",
    )?;

    SpeakerIdentitiesRepository::rename_meeting_speaker_local(
        state.db_manager.pool(),
        &meeting_speaker_id,
        display_name_override.as_deref(),
        &review_status,
    )
    .await
    .map_err(|error| format!("Failed to rename meeting speaker: {}", error))
}

#[tauri::command]
pub async fn meeting_speaker_link_identity(
    state: tauri::State<'_, AppState>,
    meeting_speaker_id: String,
    speaker_identity_id: String,
    match_confidence: Option<f64>,
    review_status: Option<String>,
) -> Result<bool, String> {
    if meeting_speaker_id.trim().is_empty() {
        return Err("meeting_speaker_id cannot be empty".to_string());
    }

    let review_status = normalize_review_status(
        review_status,
        "confirmed",
        &["unreviewed", "confirmed"],
        "review_status",
    )?;

    let normalized_identity_id = speaker_identity_id.trim();
    let identity_to_set = if normalized_identity_id.is_empty() {
        None
    } else {
        Some(normalized_identity_id)
    };

    SpeakerIdentitiesRepository::set_meeting_speaker_identity(
        state.db_manager.pool(),
        &meeting_speaker_id,
        identity_to_set,
        match_confidence,
        &review_status,
    )
    .await
    .map_err(|error| format!("Failed to link meeting speaker identity: {}", error))
}

#[tauri::command]
pub async fn speaker_identity_create(
    state: tauri::State<'_, AppState>,
    display_name: String,
    notes: Option<String>,
) -> Result<SpeakerIdentityModel, String> {
    let display_name = display_name.trim();
    if display_name.is_empty() {
        return Err("display_name cannot be empty".to_string());
    }

    SpeakerIdentitiesRepository::create_identity(
        state.db_manager.pool(),
        display_name,
        notes.as_deref(),
    )
    .await
    .map_err(|error| format!("Failed to create speaker identity: {}", error))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeakerIdentityWithCounts {
    #[serde(flatten)]
    pub identity: SpeakerIdentityModel,
    pub meeting_count: i64,
    pub action_item_count: i64,
}

#[tauri::command]
pub async fn speaker_identities_list_with_counts(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SpeakerIdentityWithCounts>, String> {
    let pool = state.db_manager.pool();

    let identities = SpeakerIdentitiesRepository::list_identities(pool)
        .await
        .map_err(|error| format!("Failed to list speaker identities: {}", error))?;

    let mut results = Vec::new();

    for identity in identities {
        // Count meetings where this identity appears
        let meeting_count: (i64,) = sqlx::query_as(
            "SELECT COUNT(DISTINCT meeting_id) 
             FROM meeting_speakers 
             WHERE speaker_identity_id = ?",
        )
        .bind(&identity.id)
        .fetch_one(pool)
        .await
        .map_err(|error| format!("Failed to count meetings: {}", error))?;

        // Count action items owned by this identity
        let action_item_count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) 
             FROM action_items 
             WHERE owner_speaker_identity_id = ?",
        )
        .bind(&identity.id)
        .fetch_one(pool)
        .await
        .map_err(|error| format!("Failed to count action items: {}", error))?;

        results.push(SpeakerIdentityWithCounts {
            identity,
            meeting_count: meeting_count.0,
            action_item_count: action_item_count.0,
        });
    }

    Ok(results)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeIdentitiesResult {
    pub meeting_speakers_updated: u64,
    pub action_items_updated: u64,
    pub voice_profiles_updated: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceProfileUpsertRequest {
    pub profile_kind: String,
    pub provider: Option<String>,
    pub model_version: Option<String>,
    pub sample_count: i64,
    pub profile_payload: Option<String>,
}

#[tauri::command]
pub async fn speaker_identities_merge(
    state: tauri::State<'_, AppState>,
    source_identity_id: String,
    target_identity_id: String,
) -> Result<MergeIdentitiesResult, String> {
    if source_identity_id.trim().is_empty() {
        return Err("source_identity_id cannot be empty".to_string());
    }

    if target_identity_id.trim().is_empty() {
        return Err("target_identity_id cannot be empty".to_string());
    }

    if source_identity_id == target_identity_id {
        return Err("Cannot merge an identity with itself".to_string());
    }

    let pool = state.db_manager.pool();

    // Verify both identities exist
    let source = SpeakerIdentitiesRepository::get_identity(pool, &source_identity_id)
        .await
        .map_err(|error| format!("Failed to get source identity: {}", error))?
        .ok_or_else(|| "Source identity not found".to_string())?;

    let _target = SpeakerIdentitiesRepository::get_identity(pool, &target_identity_id)
        .await
        .map_err(|error| format!("Failed to get target identity: {}", error))?
        .ok_or_else(|| "Target identity not found".to_string())?;

    // Count records before merge
    let meeting_speakers_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM meeting_speakers WHERE speaker_identity_id = ?")
            .bind(&source_identity_id)
            .fetch_one(pool)
            .await
            .map_err(|error| format!("Failed to count meeting speakers: {}", error))?;

    let action_items_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM action_items WHERE owner_speaker_identity_id = ?")
            .bind(&source_identity_id)
            .fetch_one(pool)
            .await
            .map_err(|error| format!("Failed to count action items: {}", error))?;

    let voice_profiles_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM voice_profiles WHERE speaker_identity_id = ?")
            .bind(&source_identity_id)
            .fetch_one(pool)
            .await
            .map_err(|error| format!("Failed to count voice profiles: {}", error))?;

    // Perform the merge
    SpeakerIdentitiesRepository::merge_identities(pool, &source_identity_id, &target_identity_id)
        .await
        .map_err(|error| format!("Failed to merge identities: {}", error))?;

    info!(
        "Merged identity '{}' into '{}': {} meeting speakers, {} action items, {} voice profiles",
        source.display_name,
        _target.display_name,
        meeting_speakers_count.0,
        action_items_count.0,
        voice_profiles_count.0
    );

    Ok(MergeIdentitiesResult {
        meeting_speakers_updated: meeting_speakers_count.0 as u64,
        action_items_updated: action_items_count.0 as u64,
        voice_profiles_updated: voice_profiles_count.0 as u64,
    })
}

#[tauri::command]
pub async fn action_item_review_update(
    state: tauri::State<'_, AppState>,
    action_item_id: String,
    review: ActionItemReviewUpdateRequest,
) -> Result<bool, String> {
    if action_item_id.trim().is_empty() {
        return Err("action_item_id cannot be empty".to_string());
    }

    let review_status = normalize_review_status(
        review.review_status,
        "edited",
        &["unreviewed", "accepted", "edited", "rejected"],
        "review.review_status",
    )?;
    let repository_review = UpdateActionItemReview {
        title: review.title,
        details: review.details,
        owner_speaker_identity_id: review.owner_speaker_identity_id,
        owner_display_name: review.owner_display_name,
        due_date: review.due_date,
        review_status,
    };

    ActionItemsRepository::update_action_item_review(
        state.db_manager.pool(),
        &action_item_id,
        repository_review,
    )
    .await
    .map_err(|error| format!("Failed to update action item review: {}", error))
}

#[tauri::command]
pub async fn action_item_status_update(
    state: tauri::State<'_, AppState>,
    action_item_id: String,
    status: String,
) -> Result<bool, String> {
    if action_item_id.trim().is_empty() {
        return Err("action_item_id cannot be empty".to_string());
    }

    let status = status.trim().to_lowercase();
    if !matches!(status.as_str(), "open" | "completed" | "dismissed") {
        return Err("status must be open, completed, or dismissed".to_string());
    }

    ActionItemsRepository::update_action_item_status(
        state.db_manager.pool(),
        &action_item_id,
        &status,
    )
    .await
    .map_err(|error| format!("Failed to update action item status: {}", error))
}

#[tauri::command]
pub async fn decision_review_update(
    state: tauri::State<'_, AppState>,
    decision_id: String,
    review: DecisionReviewUpdateRequest,
) -> Result<bool, String> {
    if decision_id.trim().is_empty() {
        return Err("decision_id cannot be empty".to_string());
    }

    let review_status = normalize_review_status(
        review.review_status,
        "edited",
        &["unreviewed", "accepted", "edited", "rejected"],
        "review.review_status",
    )?;
    let repository_review = UpdateDecisionReview {
        title: review.title,
        details: review.details,
        review_status,
    };

    DecisionsRepository::update_decision_review(
        state.db_manager.pool(),
        &decision_id,
        repository_review,
    )
    .await
    .map_err(|error| format!("Failed to update decision review: {}", error))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityInspectionDetail {
    pub identity: SpeakerIdentityModel,
    pub meetings: Vec<IdentityMeetingAppearance>,
    pub action_items: Vec<IdentityActionItem>,
    pub voice_profiles: Vec<super::models::VoiceProfileModel>,
    pub meeting_count: i64,
    pub action_item_count: i64,
}

#[tauri::command]
pub async fn speaker_identity_inspect(
    state: tauri::State<'_, AppState>,
    identity_id: String,
) -> Result<IdentityInspectionDetail, String> {
    if identity_id.trim().is_empty() {
        return Err("identity_id cannot be empty".to_string());
    }

    let pool = state.db_manager.pool();

    // Get the identity
    let identity = SpeakerIdentitiesRepository::get_identity(pool, &identity_id)
        .await
        .map_err(|error| format!("Failed to get identity: {}", error))?
        .ok_or_else(|| "Identity not found".to_string())?;

    // Get all meetings where this identity appears
    let meetings = SpeakerIdentitiesRepository::list_identity_meetings(pool, &identity_id)
        .await
        .map_err(|error| format!("Failed to list identity meetings: {}", error))?;

    // Get all action items owned by this identity
    let action_items = SpeakerIdentitiesRepository::list_identity_action_items(pool, &identity_id)
        .await
        .map_err(|error| format!("Failed to list identity action items: {}", error))?;

    // Get all voice profiles for this identity
    let voice_profiles =
        SpeakerIdentitiesRepository::list_identity_voice_profiles(pool, &identity_id)
            .await
            .map_err(|error| format!("Failed to list identity voice profiles: {}", error))?;

    let meeting_count = meetings.len() as i64;
    let action_item_count = action_items.len() as i64;

    Ok(IdentityInspectionDetail {
        identity,
        meetings,
        action_items,
        voice_profiles,
        meeting_count,
        action_item_count,
    })
}

#[tauri::command]
pub async fn speaker_identity_update(
    state: tauri::State<'_, AppState>,
    identity_id: String,
    display_name: Option<String>,
    notes: Option<Option<String>>,
) -> Result<bool, String> {
    if identity_id.trim().is_empty() {
        return Err("identity_id cannot be empty".to_string());
    }

    let pool = state.db_manager.pool();

    // Update display name if provided
    if let Some(name) = display_name {
        SpeakerIdentitiesRepository::update_identity_name(pool, &identity_id, &name)
            .await
            .map_err(|error| format!("Failed to update identity name: {}", error))?;
    }

    // Update notes if provided
    if let Some(notes_value) = notes {
        let normalized_notes = notes_value
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        SpeakerIdentitiesRepository::update_identity_notes(pool, &identity_id, normalized_notes)
            .await
            .map_err(|error| format!("Failed to update identity notes: {}", error))?;
    }

    Ok(true)
}

#[tauri::command]
pub async fn speaker_identity_add_voice_profile(
    state: tauri::State<'_, AppState>,
    identity_id: String,
    profile: VoiceProfileUpsertRequest,
) -> Result<VoiceProfileModel, String> {
    if identity_id.trim().is_empty() {
        return Err("identity_id cannot be empty".to_string());
    }

    let profile_kind = profile.profile_kind.trim().to_lowercase();
    if !matches!(profile_kind.as_str(), "manual" | "embedding_v1") {
        return Err("profile_kind must be manual or embedding_v1".to_string());
    }

    if profile.sample_count < 0 {
        return Err("sample_count cannot be negative".to_string());
    }

    SpeakerIdentitiesRepository::add_voice_profile(
        state.db_manager.pool(),
        NewVoiceProfile {
            speaker_identity_id: identity_id,
            profile_kind,
            provider: profile
                .provider
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            model_version: profile
                .model_version
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            sample_count: profile.sample_count,
            profile_payload: profile
                .profile_payload
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
        },
    )
    .await
    .map_err(|error| format!("Failed to add voice profile: {}", error))
}

#[tauri::command]
pub async fn speaker_identity_update_voice_profile(
    state: tauri::State<'_, AppState>,
    voice_profile_id: String,
    profile: VoiceProfileUpsertRequest,
) -> Result<bool, String> {
    if voice_profile_id.trim().is_empty() {
        return Err("voice_profile_id cannot be empty".to_string());
    }

    let profile_kind = profile.profile_kind.trim().to_lowercase();
    if !matches!(profile_kind.as_str(), "manual" | "embedding_v1") {
        return Err("profile_kind must be manual or embedding_v1".to_string());
    }

    if profile.sample_count < 0 {
        return Err("sample_count cannot be negative".to_string());
    }

    SpeakerIdentitiesRepository::update_voice_profile(
        state.db_manager.pool(),
        &voice_profile_id,
        UpdateVoiceProfile {
            profile_kind: Some(profile_kind),
            provider: Some(
                profile
                    .provider
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
            ),
            model_version: Some(
                profile
                    .model_version
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
            ),
            sample_count: Some(profile.sample_count),
            profile_payload: Some(
                profile
                    .profile_payload
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
            ),
        },
    )
    .await
    .map_err(|error| format!("Failed to update voice profile: {}", error))
}

#[tauri::command]
pub async fn speaker_identity_delete_voice_profile(
    state: tauri::State<'_, AppState>,
    voice_profile_id: String,
) -> Result<bool, String> {
    if voice_profile_id.trim().is_empty() {
        return Err("voice_profile_id cannot be empty".to_string());
    }

    SpeakerIdentitiesRepository::delete_voice_profile(state.db_manager.pool(), &voice_profile_id)
        .await
        .map_err(|error| format!("Failed to delete voice profile: {}", error))
}
