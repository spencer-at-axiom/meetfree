use anyhow::Result;
use cpal::traits::{DeviceTrait, HostTrait};
use std::collections::HashSet;

use crate::audio::devices::configuration::{AudioDevice, DeviceType};

/// Configure Linux audio devices using ALSA/PulseAudio
pub fn configure_linux_audio(host: &cpal::Host) -> Result<Vec<AudioDevice>> {
    let mut devices = Vec::new();
    let mut seen = HashSet::new();

    // Add input devices
    for device in host.input_devices()? {
        if let Ok(name) = device.name() {
            if seen.insert(format!("input:{}", name)) {
                devices.push(AudioDevice::new(name, DeviceType::Input));
            }
        }
    }

    // Add monitor/loopback sources as selectable system audio outputs.
    let mut add_monitor_sources = |candidate_host: cpal::Host| -> Result<()> {
        for device in candidate_host.input_devices()? {
            if let Ok(name) = device.name() {
                let normalized = name.to_lowercase();
                let is_monitor_source = normalized.contains("monitor")
                    || normalized.contains("loopback")
                    || normalized.contains("pipewire")
                    || normalized.contains("pulse");

                if is_monitor_source && seen.insert(format!("output:{}", name)) {
                    devices.push(AudioDevice::new(name, DeviceType::Output));
                }
            }
        }
        Ok(())
    };

    add_monitor_sources(cpal::default_host())?;
    if let Ok(alsa_host) = cpal::host_from_id(cpal::HostId::Alsa) {
        let _ = add_monitor_sources(alsa_host);
    }

    Ok(devices)
}
