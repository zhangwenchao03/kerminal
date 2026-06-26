//! Kerminal Tauri 入口。
//!
//! @author kongweiguang

#[cfg(not(test))]
pub mod app_menu;
#[cfg(not(test))]
pub mod app_tray;
pub mod commands;
#[cfg(all(not(test), any(target_os = "macos", windows, target_os = "linux")))]
mod desktop_plugins;
pub mod error;
pub mod models;
pub mod paths;
pub mod security;
pub mod services;
pub mod state;
pub mod storage;
#[cfg(all(not(test), target_os = "windows"))]
mod window_frame;

#[cfg(not(test))]
use state::AppState;
#[cfg(not(test))]
use tauri::Manager;

#[cfg(not(test))]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        let desktop_log_dir = paths::KerminalPaths::from_environment_or_current_home()
            .expect("failed to resolve Kerminal log directory")
            .logs;
        builder = desktop_plugins::apply_desktop_plugins(builder, desktop_log_dir);
    }

    let builder = builder.plugin(tauri_plugin_dialog::init()).setup(|app| {
        tauri_plugin_log::log::info!(
            target: "desktop.lifecycle",
            "starting Kerminal desktop setup"
        );
        let app_state = AppState::initialize().expect("failed to initialize Kerminal data stores");
        assert!(
            app.manage(app_state),
            "AppState should only be managed once during Kerminal setup"
        );
        tauri_plugin_log::log::info!(
            target: "desktop.lifecycle",
            "AppState initialized and managed"
        );
        let config_observer = app.state::<AppState>().config_change_observer().clone();
        if let Err(error) = config_observer.start(app.handle().clone()) {
            eprintln!("config watcher failed to start: {error}");
            tauri_plugin_log::log::warn!(
                target: "desktop.lifecycle",
                "config watcher failed to start"
            );
        } else {
            tauri_plugin_log::log::info!(
                target: "desktop.lifecycle",
                "config watcher started"
            );
        }
        #[cfg(target_os = "windows")]
        window_frame::apply_windows_main_window_frame(app)?;
        app_tray::apply_default_window_icon(app)?;
        app_tray::setup_close_to_tray(app)?;
        app_tray::setup_app_tray(app)?;
        tauri_plugin_log::log::info!(
            target: "desktop.lifecycle",
            "Kerminal desktop setup completed"
        );
        Ok(())
    });

    commands::registry::register_kerminal_commands(builder)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
