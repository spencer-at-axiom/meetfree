// Audio device management module
pub mod configuration;
pub mod discovery;
pub mod fallback;
pub mod microphone;
pub mod platform;
pub mod speakers;

pub use configuration::{
    get_device_and_config, get_device_and_config_blocking, parse_audio_device, AudioDevice,
    AudioTranscriptionEngine, DeviceControl, DeviceType, LAST_AUDIO_CAPTURE,
};
pub use discovery::{list_audio_devices, trigger_audio_permission};
pub use microphone::{default_input_device, find_builtin_input_device};
pub use speakers::{default_output_device, find_builtin_output_device};

#[cfg(target_os = "macos")]
pub use fallback::get_safe_recording_devices_macos;

#[cfg(not(target_os = "macos"))]
pub use fallback::get_safe_recording_devices;
