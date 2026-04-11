use anyhow::{anyhow, Result};
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::sync::atomic::AtomicU64;

lazy_static! {
    pub static ref LAST_AUDIO_CAPTURE: AtomicU64 = AtomicU64::new(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    );
}

#[derive(Clone, Debug, PartialEq, Default)]
pub enum AudioTranscriptionEngine {
    Deepgram,
    WhisperTiny,
    WhisperDistilLargeV3,
    #[default]
    WhisperLargeV3Turbo,
    WhisperLargeV3,
}

impl fmt::Display for AudioTranscriptionEngine {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AudioTranscriptionEngine::Deepgram => write!(f, "Deepgram"),
            AudioTranscriptionEngine::WhisperTiny => write!(f, "WhisperTiny"),
            AudioTranscriptionEngine::WhisperDistilLargeV3 => write!(f, "WhisperLarge"),
            AudioTranscriptionEngine::WhisperLargeV3Turbo => write!(f, "WhisperLargeV3Turbo"),
            AudioTranscriptionEngine::WhisperLargeV3 => write!(f, "WhisperLargeV3"),
        }
    }
}

#[derive(Clone, Debug)]
pub struct DeviceControl {
    pub is_running: bool,
    pub is_paused: bool,
}

#[derive(Clone, Eq, PartialEq, Hash, Serialize, Debug, Deserialize)]
pub enum DeviceType {
    Input,
    Output,
}

#[derive(Clone, Eq, PartialEq, Hash, Serialize, Debug)]
pub struct AudioDevice {
    pub name: String,
    pub device_type: DeviceType,
}

impl AudioDevice {
    pub fn new(name: String, device_type: DeviceType) -> Self {
        AudioDevice { name, device_type }
    }

    pub fn from_name(name: &str) -> Result<Self> {
        if name.trim().is_empty() {
            return Err(anyhow!("Device name cannot be empty"));
        }

        let (name, device_type) = if name.to_lowercase().ends_with("(input)") {
            (
                name.trim_end_matches("(input)").trim().to_string(),
                DeviceType::Input,
            )
        } else if name.to_lowercase().ends_with("(output)") {
            (
                name.trim_end_matches("(output)").trim().to_string(),
                DeviceType::Output,
            )
        } else {
            return Err(anyhow!(
                "Device type (input/output) not specified in the name"
            ));
        };

        Ok(AudioDevice::new(name, device_type))
    }
}

impl fmt::Display for AudioDevice {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(
            f,
            "{} ({})",
            self.name,
            match self.device_type {
                DeviceType::Input => "input",
                DeviceType::Output => "output",
            }
        )
    }
}

/// Parse audio device from string name
pub fn parse_audio_device(name: &str) -> Result<AudioDevice> {
    AudioDevice::from_name(name)
}

/// Get device and config for audio operations using a blocking call path.
pub fn get_device_and_config_blocking(
    audio_device: &AudioDevice,
) -> Result<(cpal::Device, cpal::SupportedStreamConfig)> {
    #[cfg(target_os = "windows")]
    {
        super::platform::get_windows_device(audio_device)
    }

    #[cfg(not(target_os = "windows"))]
    {
        use cpal::traits::{DeviceTrait, HostTrait};

        let host = cpal::default_host();

        match audio_device.device_type {
            DeviceType::Input => {
                for device in host.input_devices()? {
                    if let Ok(name) = device.name() {
                        if name == audio_device.name {
                            let default_config = device.default_input_config().map_err(|e| {
                                anyhow!("Failed to get default input config: {}", e)
                            })?;
                            return Ok((device, default_config));
                        }
                    }
                }
            }
            DeviceType::Output => {
                #[cfg(target_os = "macos")]
                {
                    // Use default host for all macOS output devices
                    // Core Audio backend uses direct cidre API for system capture, not cpal
                    for device in host.output_devices()? {
                        if let Ok(name) = device.name() {
                            if name == audio_device.name {
                                let default_config = device
                                    .default_output_config()
                                    .map_err(|e| anyhow!("Failed to get output config: {}", e))?;
                                return Ok((device, default_config));
                            }
                        }
                    }
                }

                #[cfg(target_os = "linux")]
                {
                    fn normalize(name: &str) -> String {
                        name.to_lowercase()
                            .chars()
                            .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { ' ' })
                            .collect::<String>()
                            .split_whitespace()
                            .collect::<Vec<_>>()
                            .join(" ")
                    }

                    fn score_monitor_candidate(name: &str, preferred: &str) -> i32 {
                        let normalized = normalize(name);
                        let preferred_norm = normalize(preferred);
                        let mut score = 0;

                        if normalized.contains("monitor") {
                            score += 100;
                        }
                        if normalized.contains("pipewire")
                            || normalized.contains("pulse")
                            || normalized.contains("loopback")
                        {
                            score += 40;
                        }
                        if !preferred_norm.is_empty() && normalized.contains(&preferred_norm) {
                            score += 75;
                        }

                        score
                    }

                    let preferred_name = audio_device.name.clone();
                    let mut best: Option<(cpal::Device, cpal::SupportedStreamConfig, i32)> = None;

                    let mut scan_host = |candidate_host: cpal::Host| -> Result<()> {
                        for device in candidate_host.input_devices()? {
                            if let Ok(name) = device.name() {
                                let score = score_monitor_candidate(&name, &preferred_name);
                                if score <= 0 {
                                    continue;
                                }

                                let config = match device.default_input_config() {
                                    Ok(cfg) => cfg,
                                    Err(_) => {
                                        let mut fallback = None;
                                        if let Ok(mut supported) = device.supported_input_configs()
                                        {
                                            for cfg in supported.by_ref() {
                                                let max_cfg = cfg.with_max_sample_rate();
                                                if max_cfg.sample_format()
                                                    == cpal::SampleFormat::F32
                                                {
                                                    fallback = Some(max_cfg);
                                                    break;
                                                }
                                                if fallback.is_none() {
                                                    fallback = Some(max_cfg);
                                                }
                                            }
                                        }

                                        match fallback {
                                            Some(cfg) => cfg,
                                            None => continue,
                                        }
                                    }
                                };

                                let should_replace =
                                    best.as_ref().map(|(_, _, s)| score > *s).unwrap_or(true);
                                if should_replace {
                                    best = Some((device, config, score));
                                }
                            }
                        }
                        Ok(())
                    };

                    scan_host(cpal::default_host())?;
                    if let Ok(alsa_host) = cpal::host_from_id(cpal::HostId::Alsa) {
                        let _ = scan_host(alsa_host);
                    }

                    if let Some((device, config, _)) = best {
                        return Ok((device, config));
                    }
                }
            }
        }

        Err(anyhow!("Device not found: {}", audio_device.name))
    }
}

/// Get device and config for audio operations
pub async fn get_device_and_config(
    audio_device: &AudioDevice,
) -> Result<(cpal::Device, cpal::SupportedStreamConfig)> {
    get_device_and_config_blocking(audio_device)
}
