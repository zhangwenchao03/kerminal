//! Platform-specific main window frame adjustments.
//!
//! @author kongweiguang

use tauri::{App, Manager, Runtime};

use crate::app_menu::MAIN_WINDOW_LABEL;

/// Disable Tao's undecorated shadow on Windows.
///
/// On Windows this shadow adds a 1px white border and Windows 11 rounds the
/// native window corners. macOS keeps the default native shadow via config.
pub fn apply_windows_main_window_frame<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window.set_shadow(false)?;
        tauri_plugin_log::log::info!(
            target: "desktop.window",
            "windows undecorated window shadow disabled"
        );
    }
    Ok(())
}
