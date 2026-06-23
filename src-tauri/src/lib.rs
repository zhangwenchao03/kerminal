//! Kerminal Tauri 入口。
//!
//! @author kongweiguang

#[cfg(not(test))]
pub mod app_menu;
#[cfg(not(test))]
pub mod app_tray;
pub mod commands;
pub mod error;
pub mod models;
pub mod paths;
pub mod security;
pub mod services;
pub mod state;
pub mod storage;

#[cfg(not(test))]
use state::AppState;

#[cfg(not(test))]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state =
        AppState::initialize().expect("failed to initialize Kerminal data directory and SQLite");

    let mut builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());

    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        builder = builder
            .plugin(tauri_plugin_opener::init())
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_updater::Builder::new().build());
    }

    let builder = builder.manage(app_state).setup(|app| {
        app_tray::apply_default_window_icon(app)?;
        app_tray::setup_app_tray(app)?;
        Ok(())
    });

    commands::registry::register_kerminal_commands(builder)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
