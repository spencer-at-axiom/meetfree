use anyhow::Result;
use log::info;

use super::devices::{list_audio_devices, AudioDevice, DeviceType};

/// Validate that specified audio devices exist and are available
///
/// # Arguments
/// * `mic_device_name` - Optional microphone device name to validate
/// * `system_device_name` - Optional system audio device name to validate
///
/// # Returns
/// * `Ok(())` if all specified devices are valid
/// * `Err` with helpful error message if any device is invalid
///
/// # Example
/// ```rust,ignore
/// validate_audio_devices(
///     Some("MacBook Pro Microphone"),
///     Some("MacBook Pro Speakers")
/// ).await?;
/// ```
pub async fn validate_audio_devices(
    mic_device_name: Option<&str>,
    system_device_name: Option<&str>,
) -> Result<()> {
    // If no devices specified, validation passes
    if mic_device_name.is_none() && system_device_name.is_none() {
        info!("No specific devices to validate, using defaults");
        return Ok(());
    }

    info!("Validating audio devices...");

    // List all available devices
    let available_devices = list_audio_devices()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to list audio devices: {}", e))?;

    if available_devices.is_empty() {
        return Err(anyhow::anyhow!(
            "No audio devices found on this system. Please check your audio hardware."
        ));
    }

    // Validate microphone device
    if let Some(mic_name) = mic_device_name {
        let mic_exists = available_devices.iter().any(|d| d.name == mic_name);

        if !mic_exists {
            let available_mics: Vec<String> = available_devices
                .iter()
                .filter(|d| d.device_type == DeviceType::Input)
                .map(|d| d.name.clone())
                .collect();

            return Err(anyhow::anyhow!(
                "Microphone device '{}' not found.\n\nAvailable microphones:\n{}",
                mic_name,
                if available_mics.is_empty() {
                    "  (No microphones detected)".to_string()
                } else {
                    available_mics
                        .iter()
                        .map(|name| format!("  - {}", name))
                        .collect::<Vec<_>>()
                        .join("\n")
                }
            ));
        }

        info!("✅ Microphone device '{}' validated", mic_name);
    }

    // Validate system audio device
    if let Some(sys_name) = system_device_name {
        let sys_exists = available_devices.iter().any(|d| d.name == sys_name);

        if !sys_exists {
            let available_outputs: Vec<String> = available_devices
                .iter()
                .filter(|d| d.device_type == DeviceType::Output)
                .map(|d| d.name.clone())
                .collect();

            return Err(anyhow::anyhow!(
                "System audio device '{}' not found.\n\nAvailable output devices:\n{}",
                sys_name,
                if available_outputs.is_empty() {
                    "  (No output devices detected)".to_string()
                } else {
                    available_outputs
                        .iter()
                        .map(|name| format!("  - {}", name))
                        .collect::<Vec<_>>()
                        .join("\n")
                }
            ));
        }

        info!("✅ System audio device '{}' validated", sys_name);
    }

    info!("✅ All specified audio devices validated successfully");
    Ok(())
}

/// Get detailed device information for error messages
pub async fn get_device_info_string() -> String {
    match list_audio_devices().await {
        Ok(devices) => {
            if devices.is_empty() {
                "No audio devices detected on this system.".to_string()
            } else {
                let mut info = String::from("Available audio devices:\n");

                let inputs: Vec<&AudioDevice> = devices
                    .iter()
                    .filter(|d| d.device_type == DeviceType::Input)
                    .collect();
                let outputs: Vec<&AudioDevice> = devices
                    .iter()
                    .filter(|d| d.device_type == DeviceType::Output)
                    .collect();

                if !inputs.is_empty() {
                    info.push_str("\nInput devices (microphones):\n");
                    for device in inputs {
                        info.push_str(&format!("  - {}\n", device.name));
                    }
                }

                if !outputs.is_empty() {
                    info.push_str("\nOutput devices (speakers/system audio):\n");
                    for device in outputs {
                        info.push_str(&format!("  - {}\n", device.name));
                    }
                }

                info
            }
        }
        Err(e) => {
            format!("Failed to list audio devices: {}", e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_validate_no_devices_specified() {
        // Should pass when no devices specified
        let result = validate_audio_devices(None, None).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_get_device_info_string() {
        // Should not panic
        let info = get_device_info_string().await;
        assert!(!info.is_empty());
    }
}
