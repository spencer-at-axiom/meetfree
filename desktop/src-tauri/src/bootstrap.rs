use crate::audio;
use crate::database;
use crate::notifications;
use crate::notifications::commands::NotificationManagerState;
use crate::parakeet_engine;
use crate::state;
use crate::summary;
use crate::tray;
use crate::whisper_engine;
use std::sync::Arc;
use tauri::{App, AppHandle, Builder, Manager, Wry};
use tokio::sync::RwLock;

pub fn configure_builder(builder: Builder<Wry>) -> Builder<Wry> {
    let builder = builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(whisper_engine::parallel_commands::ParallelProcessorState::new())
        .manage(Arc::new(RwLock::new(
            None::<notifications::manager::NotificationManager<Wry>>,
        )) as NotificationManagerState<Wry>);

    // Avoid updater startup instability in dev/debug runs on Windows.
    // Auto-updates remain enabled in release builds.
    if cfg!(debug_assertions) {
        log::info!("Updater plugin disabled for debug builds");
        builder.manage(audio::init_system_audio_state())
    } else {
        builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .manage(audio::init_system_audio_state())
    }
}

pub fn setup_app(app: &mut App<Wry>) -> Result<(), Box<dyn std::error::Error>> {
    log::info!("Application setup complete");

    initialize_tray(app.handle());
    initialize_notification_system(app.handle());
    initialize_model_engines(app.handle());
    initialize_database(app.handle())?;
    initialize_bundled_templates(app.handle());

    Ok(())
}

pub async fn cleanup_on_exit(app_handle: &AppHandle<Wry>) {
    if let Some(app_state) = app_handle.try_state::<state::AppState>() {
        log::info!("Starting database cleanup...");
        if let Err(e) = app_state.db_manager.cleanup().await {
            log::error!("Failed to cleanup database: {}", e);
        } else {
            log::info!("Database cleanup completed successfully");
        }
    } else {
        log::warn!("AppState not available for database cleanup (likely first launch)");
    }
    
    // No additional summary-engine shutdown hooks are required.
}

fn initialize_tray(app: &AppHandle<Wry>) {
    if let Err(e) = tray::create_tray(app) {
        log::error!("Failed to create system tray: {}", e);
    }
}

fn initialize_notification_system(app: &AppHandle<Wry>) {
    log::info!("Initializing notification system...");
    let app_for_notif = app.clone();

    tauri::async_runtime::spawn(async move {
        let notif_state = app_for_notif.state::<NotificationManagerState<Wry>>();
        match notifications::commands::initialize_notification_manager(app_for_notif.clone()).await
        {
            Ok(manager) => {
                let mut state_lock = notif_state.write().await;
                *state_lock = Some(manager);
                log::info!("Notification system initialized");
            }
            Err(e) => {
                log::error!("Failed to initialize notification manager: {}", e);
            }
        }
    });
}

fn initialize_model_engines(app: &AppHandle<Wry>) {
    whisper_engine::commands::set_models_directory(app);
    tauri::async_runtime::spawn(async {
        if let Err(e) = whisper_engine::commands::whisper_init().await {
            log::error!("Failed to initialize Whisper engine on startup: {}", e);
        }
    });

    parakeet_engine::commands::set_models_directory(app);
    tauri::async_runtime::spawn(async {
        if let Err(e) = parakeet_engine::commands::parakeet_init().await {
            log::error!("Failed to initialize Parakeet engine on startup: {}", e);
        }
    });
    
    // Summary providers are configured at runtime; no dedicated model manager bootstrapping here.
}

fn initialize_database(app: &AppHandle<Wry>) -> Result<(), Box<dyn std::error::Error>> {
    tauri::async_runtime::block_on(async {
        database::setup::initialize_database_on_startup(app).await
    })?;

    Ok(())
}

fn initialize_bundled_templates(app: &AppHandle<Wry>) {
    log::info!("Initializing bundled templates directory...");
    if let Ok(resource_path) = app.path().resource_dir() {
        let templates_dir = resource_path.join("templates");
        log::info!(
            "Setting bundled templates directory to: {:?}",
            templates_dir
        );
        summary::templates::set_bundled_templates_dir(templates_dir);
    } else {
        log::warn!("Failed to resolve resource directory for templates");
    }
}
