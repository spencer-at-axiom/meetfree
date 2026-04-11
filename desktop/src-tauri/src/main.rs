#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

fn configure_process_environment() {
    // SAFETY: This runs before the async runtime starts and before any threads are spawned,
    // which is the only safe point for process-wide environment mutation in Rust.
    // These environment variables control logging levels for C libraries (GGML, Whisper)
    // and must be set before those libraries are initialized.
    // No other threads exist at this point, so there's no risk of data races.
    unsafe {
        std::env::set_var("RUST_LOG", "info");
        std::env::set_var("GGML_METAL_LOG_LEVEL", "1");
        std::env::set_var("WHISPER_LOG_LEVEL", "1");
    }
}

fn main() {
    configure_process_environment();
    env_logger::init();

    // Async logger will be initialized lazily when first needed (after Tauri runtime starts)
    log::info!("Starting application...");
    app_lib::run();
}
