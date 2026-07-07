//! Desktop-only Tauri plugin registration.
//!
//! @author kongweiguang

use std::path::PathBuf;

use tauri::{plugin::TauriPlugin, Builder, Emitter, Manager, Runtime};
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_window_state::StateFlags;

use crate::{
    app_tray,
    paths::{APP_LOG_FILE_STEM, APP_LOG_MAX_FILE_SIZE_BYTES, APP_LOG_ROTATION_KEEP_FILES},
    services::external_launch::{
        direct_parent_command_line_for_args, ExternalLaunchEntrypoint, EXTERNAL_SSH_LAUNCH_EVENT,
    },
    state::AppState,
};

/// Register desktop plugins in a fixed order.
pub fn apply_desktop_plugins<R: Runtime>(builder: Builder<R>, log_dir: PathBuf) -> Builder<R> {
    builder
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            tauri_plugin_log::log::info!(
                target: "desktop.lifecycle",
                "single-instance activation requested; focusing main window"
            );
            if let Some(state) = app.try_state::<AppState>() {
                let parent_command_line = direct_parent_command_line_for_args(&args);
                match state
                    .external_launch_intake()
                    .accept_args_with_parent_command_line(
                        args,
                        Some(cwd),
                        ExternalLaunchEntrypoint::SingleInstance,
                        parent_command_line,
                    ) {
                    Ok(outcome) => {
                        if let Some(payload) = outcome.event_payload() {
                            if let Err(error) = app.emit(EXTERNAL_SSH_LAUNCH_EVENT, payload) {
                                tauri_plugin_log::log::warn!(
                                    target: "desktop.lifecycle",
                                    "failed to emit external SSH launch event: {error}"
                                );
                            }
                        }
                    }
                    Err(error) => {
                        tauri_plugin_log::log::warn!(
                            target: "desktop.lifecycle",
                            "external SSH launch intake failed: {error}"
                        );
                    }
                }
            }
            app_tray::show_main_window(app);
        }))
        .plugin(build_log_plugin(log_dir))
        .plugin(build_window_state_plugin())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
}

fn build_log_plugin<R: Runtime>(log_dir: PathBuf) -> TauriPlugin<R> {
    tauri_plugin_log::Builder::new()
        .level(tauri_plugin_log::log::LevelFilter::Info)
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(
            APP_LOG_ROTATION_KEEP_FILES,
        ))
        .max_file_size(APP_LOG_MAX_FILE_SIZE_BYTES.into())
        .targets([
            Target::new(TargetKind::Stdout),
            Target::new(TargetKind::Folder {
                path: log_dir,
                file_name: Some(APP_LOG_FILE_STEM.into()),
            }),
        ])
        .build()
}

fn build_window_state_plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_window_state::Builder::default()
        .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
        .build()
}
