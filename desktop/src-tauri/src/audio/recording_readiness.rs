use log::{info, warn};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

use super::{default_input_device, default_output_device};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum ReadinessStatus {
    Ready,
    MissingModel,
    ModelDownloading,
    MissingMicrophone,
    SystemAudioUnavailable,
    ConfigurationError,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlatformLimitation {
    pub feature: String,
    pub available: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecordingReadiness {
    pub status: ReadinessStatus,
    pub can_record: bool,
    pub provider: String,
    pub model: String,
    pub has_microphone: bool,
    pub has_system_audio: bool,
    pub microphone_device: Option<String>,
    pub system_audio_device: Option<String>,
    pub platform_limitations: Vec<PlatformLimitation>,
    pub issues: Vec<String>,
}

/// Check if system audio capture is available on this platform
fn check_system_audio_platform_support() -> PlatformLimitation {
    #[cfg(target_os = "macos")]
    {
        PlatformLimitation {
            feature: "system_audio".to_string(),
            available: true,
            reason: None,
        }
    }

    #[cfg(target_os = "windows")]
    {
        PlatformLimitation {
            feature: "system_audio".to_string(),
            available: true,
            reason: Some(
                "Uses WASAPI loopback-compatible input sources (for example Stereo Mix / What U Hear). Availability depends on the installed audio driver."
                    .to_string(),
            ),
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        PlatformLimitation {
            feature: "system_audio".to_string(),
            available: true,
            reason: Some(
                "Uses PulseAudio/PipeWire monitor sources. Availability depends on monitor source exposure in the active audio stack."
                    .to_string(),
            ),
        }
    }
}

/// Get comprehensive recording readiness status
pub async fn get_recording_readiness<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<RecordingReadiness, String> {
    info!("🔍 Checking recording readiness...");

    let mut issues = Vec::new();
    let mut platform_limitations = Vec::new();

    // Load persisted recording preferences to check selected devices
    let preferences = super::recording_preferences::load_recording_preferences(app)
        .await
        .unwrap_or_default();

    // Check transcript configuration
    let (provider, model, model_ready) = match crate::api::api_get_transcript_config(
        app.clone(),
        app.clone().state(),
        None,
    )
    .await
    {
        Ok(Some(config)) => {
            info!(
                "📝 Transcript config - provider: {}, model: {}",
                config.provider, config.model
            );
            (config.provider, config.model, true)
        }
        Ok(None) => {
            warn!("⚠️ No transcript config found");
            issues.push("No transcription model configured".to_string());
            (
                "parakeet".to_string(),
                "unknown".to_string(),
                false,
            )
        }
        Err(e) => {
            warn!("❌ Failed to get transcript config: {}", e);
            issues.push(format!("Configuration error: {}", e));
            (
                "unknown".to_string(),
                "unknown".to_string(),
                false,
            )
        }
    };

    // Validate model readiness
    let model_status = if model_ready {
        match crate::audio::transcription::check_transcription_model_available(app).await {
            Ok(()) => {
                info!("✅ Transcription model is ready");
                ReadinessStatus::Ready
            }
            Err(e) => {
                warn!("❌ Model validation failed: {}", e);
                
                // Check if it's a download-in-progress error
                if e.to_lowercase().contains("download") {
                    issues.push("Transcription model is downloading".to_string());
                    ReadinessStatus::ModelDownloading
                } else {
                    issues.push(format!("Transcription model not ready: {}", e));
                    ReadinessStatus::MissingModel
                }
            }
        }
    } else {
        issues.push("Transcription model not configured".to_string());
        ReadinessStatus::MissingModel
    };

    let system_audio_selected = preferences.preferred_system_device.is_some();

    // Check microphone availability using selected device or default
    let (has_microphone, mic_device) = if let Some(selected_mic) = &preferences.preferred_mic_device {
        // Validate the selected microphone device
        match super::device_validation::validate_audio_devices(
            Some(selected_mic.as_str()),
            None,
        )
        .await
        {
            Ok(()) => {
                info!("🎤 Selected microphone available: {}", selected_mic);
                (true, Some(selected_mic.clone()))
            }
            Err(e) => {
                warn!("❌ Selected microphone '{}' not available: {}", selected_mic, e);
                issues.push(format!("Selected microphone '{}' is not available", selected_mic));
                (false, Some(selected_mic.clone()))
            }
        }
    } else {
        // Fall back to default device check
        match default_input_device() {
            Ok(device) => {
                info!("🎤 Default microphone available: {}", device.name);
                (true, Some(device.name))
            }
            Err(e) => {
                warn!("❌ No microphone available: {}", e);
                issues.push("No microphone device available".to_string());
                (false, None)
            }
        }
    };

    // Check system audio availability (platform-dependent)
    let system_audio_limitation = check_system_audio_platform_support();
    let (has_system_audio, system_device) = if system_audio_limitation.available {
        if let Some(selected_system) = &preferences.preferred_system_device {
            // Validate the selected system audio device
            match super::device_validation::validate_audio_devices(
                None,
                Some(selected_system.as_str()),
            )
            .await
            {
                Ok(()) => {
                    info!("🔊 Selected system audio available: {}", selected_system);
                    (true, Some(selected_system.clone()))
                }
                Err(e) => {
                    warn!("❌ Selected system audio '{}' not available: {}", selected_system, e);
                    issues.push(format!("Selected system audio device '{}' is not available", selected_system));
                    (false, Some(selected_system.clone()))
                }
            }
        } else {
            // Fall back to default device check
            match default_output_device() {
                Ok(device) => {
                    info!("🔊 Default system audio available: {}", device.name);
                    (true, Some(device.name))
                }
                Err(e) => {
                    info!("ℹ️ System audio not available: {}", e);
                    (false, None)
                }
            }
        }
    } else {
        if system_audio_selected {
            issues.push(
                "System audio capture is not available on this platform. Clear the system audio selection to record microphone-only."
                    .to_string(),
            );
        }
        info!(
            "ℹ️ System audio not supported on this platform: {}",
            system_audio_limitation.reason.as_ref().unwrap_or(&"Unknown reason".to_string())
        );
        (false, None)
    };

    platform_limitations.push(system_audio_limitation.clone());

    // Determine overall status
    let system_audio_blocked = system_audio_selected
        && (!system_audio_limitation.available || !has_system_audio);

    let final_status = if !has_microphone {
        ReadinessStatus::MissingMicrophone
    } else if !matches!(model_status, ReadinessStatus::Ready) {
        model_status
    } else if system_audio_blocked {
        ReadinessStatus::SystemAudioUnavailable
    } else {
        ReadinessStatus::Ready
    };

    let can_record = matches!(final_status, ReadinessStatus::Ready) && has_microphone;

    let readiness = RecordingReadiness {
        status: final_status,
        can_record,
        provider,
        model,
        has_microphone,
        has_system_audio,
        microphone_device: mic_device,
        system_audio_device: system_device,
        platform_limitations,
        issues,
    };

    info!(
        "📊 Recording readiness: can_record={}, status={:?}, issues={}",
        readiness.can_record,
        readiness.status,
        readiness.issues.len()
    );

    Ok(readiness)
}

/// Tauri command for getting recording readiness
#[tauri::command]
pub async fn get_recording_readiness_command<R: Runtime>(
    app: AppHandle<R>,
) -> Result<RecordingReadiness, String> {
    get_recording_readiness(&app).await
}
