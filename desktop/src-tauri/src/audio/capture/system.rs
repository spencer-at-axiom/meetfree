use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SupportedStreamConfig;
use futures_channel::mpsc;
use futures_util::{Stream, StreamExt};
use std::pin::Pin;
use std::task::{Context as TaskContext, Poll};

#[cfg(target_os = "macos")]
use super::core_audio::CoreAudioCapture;
#[cfg(target_os = "macos")]
use log::info;
#[cfg(any(target_os = "windows", target_os = "linux"))]
use log::warn;

/// System audio capture using Core Audio tap (macOS) or CPAL (other platforms)
pub struct SystemAudioCapture {
    _host: cpal::Host,
}

impl SystemAudioCapture {
    pub fn new() -> Result<Self> {
        let host = cpal::default_host();
        Ok(Self { _host: host })
    }

    pub fn list_system_devices() -> Result<Vec<String>> {
        #[cfg(target_os = "macos")]
        {
            let host = cpal::default_host();
            let devices = host
                .output_devices()
                .map_err(|e| anyhow!("Failed to enumerate output devices: {}", e))?;

            let mut device_names = Vec::new();
            for device in devices {
                if let Ok(name) = device.name() {
                    device_names.push(name);
                }
            }

            return Ok(device_names);
        }

        #[cfg(target_os = "windows")]
        {
            let wasapi_host = cpal::host_from_id(cpal::HostId::Wasapi)
                .map_err(|e| anyhow!("Failed to create WASAPI host: {}", e))?;

            let mut loopback_candidates = Vec::new();
            let input_devices = wasapi_host
                .input_devices()
                .map_err(|e| anyhow!("Failed to enumerate WASAPI input devices: {}", e))?;

            for device in input_devices {
                if let Ok(name) = device.name() {
                    if score_windows_loopback_device(&name, None) > 0 {
                        loopback_candidates.push(name);
                    }
                }
            }

            loopback_candidates.sort();
            loopback_candidates.dedup();

            return Ok(loopback_candidates);
        }

        #[cfg(target_os = "linux")]
        {
            let mut device_names = gather_linux_monitor_sources()?;
            device_names.sort();
            device_names.dedup();
            return Ok(device_names);
        }

        #[allow(unreachable_code)]
        let host = cpal::default_host();
        let devices = host
            .output_devices()
            .map_err(|e| anyhow!("Failed to enumerate output devices: {}", e))?;

        let mut device_names = Vec::new();
        for device in devices {
            if let Ok(name) = device.name() {
                device_names.push(name);
            }
        }

        Ok(device_names)
    }

    pub fn start_system_audio_capture(&self) -> Result<SystemAudioStream> {
        self.start_system_audio_capture_for_device(None)
    }

    pub fn start_system_audio_capture_for_device(
        &self,
        preferred_output_device_name: Option<&str>,
    ) -> Result<SystemAudioStream> {
        #[cfg(target_os = "macos")]
        {
            info!("Starting Core Audio system capture (macOS)");
            // Use Core Audio tap for system audio capture
            let core_audio = CoreAudioCapture::new()?;
            let core_audio_stream = core_audio.stream()?;
            let sample_rate = core_audio_stream.sample_rate();

            // Convert CoreAudioStream to SystemAudioStream
            let (tx, rx) = mpsc::unbounded::<Vec<f32>>();
            let (drop_tx, drop_rx) = std::sync::mpsc::channel::<()>();

            // Spawn task to forward Core Audio samples
            tokio::spawn(async move {
                use futures_util::StreamExt;
                let mut stream = core_audio_stream;
                let mut buffer = Vec::new();
                let chunk_size = 1024;

                loop {
                    // Check if we should stop
                    if drop_rx.try_recv().is_ok() {
                        break;
                    }

                    // Poll the Core Audio stream
                    match stream.next().await {
                        Some(sample) => {
                            buffer.push(sample);
                            if buffer.len() >= chunk_size {
                                if tx.unbounded_send(buffer.clone()).is_err() {
                                    break;
                                }
                                buffer.clear();
                            }
                        }
                        None => break,
                    }
                }

                // Send any remaining samples
                if !buffer.is_empty() {
                    let _ = tx.unbounded_send(buffer);
                }
            });

            let receiver = rx.map(futures_util::stream::iter).flatten();

            info!("Core Audio system capture started successfully");

            Ok(SystemAudioStream {
                drop_tx,
                sample_rate,
                channels: 1,
                input_stream: None,
                receiver: Box::pin(receiver),
            })
        }

        #[cfg(target_os = "windows")]
        {
            let wasapi_host = cpal::host_from_id(cpal::HostId::Wasapi)
                .map_err(|e| anyhow!("Failed to initialize WASAPI host: {}", e))?;

            let preferred_output_name =
                preferred_output_device_name
                    .map(str::to_string)
                    .or_else(|| {
                        wasapi_host
                            .default_output_device()
                            .and_then(|d| d.name().ok())
                    });

            let (device, resolved_name) = select_windows_loopback_input_device(
                &wasapi_host,
                preferred_output_name.as_deref(),
            )?;

            let config = select_supported_input_config(&device)
                .with_context(|| format!("Failed to find input config for '{}'", resolved_name))?;

            let (tx, rx) = mpsc::unbounded::<Vec<f32>>();
            let stream = build_loopback_input_stream(&device, &config, tx).with_context(|| {
                format!("Failed to build loopback stream for '{}'", resolved_name)
            })?;
            stream.play().map_err(|e| {
                anyhow!(
                    "Failed to start loopback stream for '{}': {}",
                    resolved_name,
                    e
                )
            })?;

            let (drop_tx, _drop_rx) = std::sync::mpsc::channel::<()>();
            let receiver = rx.map(futures_util::stream::iter).flatten();

            Ok(SystemAudioStream {
                drop_tx,
                sample_rate: config.sample_rate().0,
                channels: config.channels(),
                input_stream: Some(stream),
                receiver: Box::pin(receiver),
            })
        }

        #[cfg(target_os = "linux")]
        {
            let preferred_output_name = preferred_output_device_name
                .map(str::to_string)
                .or_else(get_default_output_name);
            let (device, resolved_name) =
                select_linux_monitor_input_device(preferred_output_name.as_deref())?;

            let config = select_supported_input_config(&device)
                .with_context(|| format!("Failed to find input config for '{}'", resolved_name))?;

            let (tx, rx) = mpsc::unbounded::<Vec<f32>>();
            let stream = build_loopback_input_stream(&device, &config, tx).with_context(|| {
                format!("Failed to build monitor stream for '{}'", resolved_name)
            })?;
            stream.play().map_err(|e| {
                anyhow!(
                    "Failed to start monitor stream for '{}': {}",
                    resolved_name,
                    e
                )
            })?;

            let (drop_tx, _drop_rx) = std::sync::mpsc::channel::<()>();
            let receiver = rx.map(futures_util::stream::iter).flatten();

            Ok(SystemAudioStream {
                drop_tx,
                sample_rate: config.sample_rate().0,
                channels: config.channels(),
                input_stream: Some(stream),
                receiver: Box::pin(receiver),
            })
        }
    }

    pub fn check_system_audio_permissions() -> bool {
        // Check if we can enumerate audio devices
        cpal::default_host().output_devices().is_ok()
    }
}

pub struct SystemAudioStream {
    drop_tx: std::sync::mpsc::Sender<()>,
    sample_rate: u32,
    channels: u16,
    input_stream: Option<cpal::Stream>,
    receiver: Pin<Box<dyn Stream<Item = f32> + Send + Sync>>,
}

impl Drop for SystemAudioStream {
    fn drop(&mut self) {
        let _ = self.drop_tx.send(());
        self.input_stream.take();
    }
}

impl Stream for SystemAudioStream {
    type Item = f32;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<Option<Self::Item>> {
        self.receiver.as_mut().poll_next_unpin(cx)
    }
}

impl SystemAudioStream {
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn channels(&self) -> u16 {
        self.channels
    }
}

/// Public interface for system audio capture
pub async fn start_system_audio_capture() -> Result<SystemAudioStream> {
    let capture = SystemAudioCapture::new()?;
    capture.start_system_audio_capture()
}

pub fn list_system_audio_devices() -> Result<Vec<String>> {
    SystemAudioCapture::list_system_devices()
}

pub fn check_system_audio_permissions() -> bool {
    SystemAudioCapture::check_system_audio_permissions()
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn normalized_device_name(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(target_os = "windows")]
fn score_windows_loopback_device(name: &str, preferred_output: Option<&str>) -> i32 {
    let normalized = normalized_device_name(name);
    let mut score = 0;

    let strong_markers = ["loopback", "stereo mix", "what u hear", "wave out"];
    if strong_markers
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        score += 100;
    }

    if normalized.contains("monitor") {
        score += 40;
    }

    if let Some(output_name) = preferred_output {
        let normalized_output = normalized_device_name(output_name);
        if !normalized_output.is_empty() && normalized.contains(&normalized_output) {
            score += 75;
        }
    }

    score
}

#[cfg(target_os = "windows")]
fn select_windows_loopback_input_device(
    host: &cpal::Host,
    preferred_output: Option<&str>,
) -> Result<(cpal::Device, String)> {
    let input_devices = host
        .input_devices()
        .map_err(|e| anyhow!("Failed to enumerate WASAPI input devices: {}", e))?;

    let mut best: Option<(cpal::Device, String, i32)> = None;
    let mut seen_names = Vec::new();

    for device in input_devices {
        if let Ok(name) = device.name() {
            seen_names.push(name.clone());
            let score = score_windows_loopback_device(&name, preferred_output);
            if score <= 0 {
                continue;
            }

            let should_replace = best.as_ref().map(|(_, _, s)| score > *s).unwrap_or(true);
            if should_replace {
                best = Some((device, name, score));
            }
        }
    }

    if let Some((device, name, score)) = best {
        log::info!(
            "Selected WASAPI loopback input '{}' (score={}, preferred_output={:?})",
            name,
            score,
            preferred_output
        );
        return Ok((device, name));
    }

    Err(anyhow!(
        "No WASAPI loopback input source found. Available input devices: {}",
        if seen_names.is_empty() {
            "(none)".to_string()
        } else {
            seen_names.join(", ")
        }
    ))
}

#[cfg(target_os = "linux")]
fn score_linux_monitor_source(name: &str, preferred_output: Option<&str>) -> i32 {
    let normalized = normalized_device_name(name);
    let mut score = 0;

    if normalized.contains("monitor") {
        score += 100;
    }
    if normalized.contains("pipewire") || normalized.contains("pulse") {
        score += 40;
    }
    if normalized.contains("loopback") {
        score += 30;
    }

    if let Some(output_name) = preferred_output {
        let normalized_output = normalized_device_name(output_name);
        if !normalized_output.is_empty() && normalized.contains(&normalized_output) {
            score += 75;
        }
    }

    score
}

#[cfg(target_os = "linux")]
fn gather_linux_monitor_sources() -> Result<Vec<String>> {
    let mut device_names = Vec::new();
    let mut try_host = |host: cpal::Host| -> Result<()> {
        let input_devices = host
            .input_devices()
            .map_err(|e| anyhow!("Failed to enumerate Linux input devices: {}", e))?;
        for device in input_devices {
            if let Ok(name) = device.name() {
                if score_linux_monitor_source(&name, None) > 0 {
                    device_names.push(name);
                }
            }
        }
        Ok(())
    };

    try_host(cpal::default_host())?;
    if let Ok(alsa_host) = cpal::host_from_id(cpal::HostId::Alsa) {
        let _ = try_host(alsa_host);
    }

    Ok(device_names)
}

#[cfg(target_os = "linux")]
fn get_default_output_name() -> Option<String> {
    cpal::default_host()
        .default_output_device()
        .and_then(|d| d.name().ok())
}

#[cfg(target_os = "linux")]
fn select_linux_monitor_input_device(
    preferred_output: Option<&str>,
) -> Result<(cpal::Device, String)> {
    let mut best: Option<(cpal::Device, String, i32)> = None;
    let mut seen_names = Vec::new();

    let mut scan_host = |host: cpal::Host| -> Result<()> {
        let input_devices = host
            .input_devices()
            .map_err(|e| anyhow!("Failed to enumerate Linux input devices: {}", e))?;

        for device in input_devices {
            if let Ok(name) = device.name() {
                seen_names.push(name.clone());
                let score = score_linux_monitor_source(&name, preferred_output);
                if score <= 0 {
                    continue;
                }

                let should_replace = best.as_ref().map(|(_, _, s)| score > *s).unwrap_or(true);
                if should_replace {
                    best = Some((device, name, score));
                }
            }
        }
        Ok(())
    };

    scan_host(cpal::default_host())?;
    if let Ok(alsa_host) = cpal::host_from_id(cpal::HostId::Alsa) {
        let _ = scan_host(alsa_host);
    }

    if let Some((device, name, score)) = best {
        log::info!(
            "Selected Linux monitor source '{}' (score={}, preferred_output={:?})",
            name,
            score,
            preferred_output
        );
        return Ok((device, name));
    }

    Err(anyhow!(
        "No PulseAudio/PipeWire monitor source found. Available input devices: {}",
        if seen_names.is_empty() {
            "(none)".to_string()
        } else {
            seen_names.join(", ")
        }
    ))
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn select_supported_input_config(device: &cpal::Device) -> Result<SupportedStreamConfig> {
    if let Ok(default_cfg) = device.default_input_config() {
        return Ok(default_cfg);
    }

    let mut fallback = None;
    let mut configs = device
        .supported_input_configs()
        .map_err(|e| anyhow!("Failed to enumerate supported input configs: {}", e))?;

    for cfg in configs.by_ref() {
        let max_cfg = cfg.with_max_sample_rate();

        if max_cfg.sample_format() == cpal::SampleFormat::F32 && max_cfg.channels() >= 1 {
            return Ok(max_cfg);
        }

        if fallback.is_none() {
            fallback = Some(max_cfg);
        }
    }

    fallback.ok_or_else(|| anyhow!("No supported input configs for selected device"))
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn build_loopback_input_stream(
    device: &cpal::Device,
    config: &SupportedStreamConfig,
    tx: mpsc::UnboundedSender<Vec<f32>>,
) -> Result<cpal::Stream> {
    let cfg = config.clone().into();
    let err_cb = move |err| warn!("System audio loopback stream error: {}", err);

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let tx = tx.clone();
            device.build_input_stream(
                &cfg,
                move |data: &[f32], _| {
                    let _ = tx.unbounded_send(data.to_vec());
                },
                err_cb,
                None,
            )?
        }
        cpal::SampleFormat::I16 => {
            let tx = tx.clone();
            device.build_input_stream(
                &cfg,
                move |data: &[i16], _| {
                    let samples: Vec<f32> = data
                        .iter()
                        .map(|sample| *sample as f32 / i16::MAX as f32)
                        .collect();
                    let _ = tx.unbounded_send(samples);
                },
                err_cb,
                None,
            )?
        }
        cpal::SampleFormat::U16 => {
            let tx = tx.clone();
            device.build_input_stream(
                &cfg,
                move |data: &[u16], _| {
                    let midpoint = u16::MAX as f32 / 2.0;
                    let samples: Vec<f32> = data
                        .iter()
                        .map(|sample| (*sample as f32 - midpoint) / midpoint)
                        .collect();
                    let _ = tx.unbounded_send(samples);
                },
                err_cb,
                None,
            )?
        }
        cpal::SampleFormat::I8 => {
            let tx = tx.clone();
            device.build_input_stream(
                &cfg,
                move |data: &[i8], _| {
                    let samples: Vec<f32> = data
                        .iter()
                        .map(|sample| *sample as f32 / i8::MAX as f32)
                        .collect();
                    let _ = tx.unbounded_send(samples);
                },
                err_cb,
                None,
            )?
        }
        cpal::SampleFormat::U8 => {
            let tx = tx.clone();
            device.build_input_stream(
                &cfg,
                move |data: &[u8], _| {
                    let midpoint = u8::MAX as f32 / 2.0;
                    let samples: Vec<f32> = data
                        .iter()
                        .map(|sample| (*sample as f32 - midpoint) / midpoint)
                        .collect();
                    let _ = tx.unbounded_send(samples);
                },
                err_cb,
                None,
            )?
        }
        cpal::SampleFormat::I32 => {
            let tx = tx.clone();
            device.build_input_stream(
                &cfg,
                move |data: &[i32], _| {
                    let samples: Vec<f32> = data
                        .iter()
                        .map(|sample| *sample as f32 / i32::MAX as f32)
                        .collect();
                    let _ = tx.unbounded_send(samples);
                },
                err_cb,
                None,
            )?
        }
        cpal::SampleFormat::U32 => {
            let tx = tx.clone();
            device.build_input_stream(
                &cfg,
                move |data: &[u32], _| {
                    let midpoint = u32::MAX as f32 / 2.0;
                    let samples: Vec<f32> = data
                        .iter()
                        .map(|sample| (*sample as f32 - midpoint) / midpoint)
                        .collect();
                    let _ = tx.unbounded_send(samples);
                },
                err_cb,
                None,
            )?
        }
        other => {
            return Err(anyhow!(
                "Unsupported sample format for loopback capture: {:?}",
                other
            ))
        }
    };

    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_loopback_scoring_prefers_explicit_loopback_markers() {
        let explicit = score_windows_loopback_device("Stereo Mix (Realtek)", None);
        let vague = score_windows_loopback_device("Microphone Array", None);
        assert!(explicit > vague);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_monitor_scoring_prefers_monitor_sources() {
        let monitor =
            score_linux_monitor_source("alsa_output.pci-0000_00_1f.3.analog-stereo.monitor", None);
        let plain = score_linux_monitor_source("Built-in Microphone", None);
        assert!(monitor > plain);
    }
}
