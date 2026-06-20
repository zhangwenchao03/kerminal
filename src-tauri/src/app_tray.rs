//! Kerminal 系统托盘。
//!
//! @author kongweiguang

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    App, AppHandle, Manager, Runtime,
};

use crate::app_menu::MAIN_WINDOW_LABEL;

pub const TRAY_ID: &str = "kerminal:tray";

const TRAY_MENU_ID_PREFIX: &str = "kerminal:tray:";

/// 系统托盘菜单动作。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TrayMenuAction {
    Show,
    Hide,
    Quit,
}

impl TrayMenuAction {
    /// 返回托盘菜单 item id。
    pub const fn menu_id(self) -> &'static str {
        match self {
            Self::Show => "kerminal:tray:show",
            Self::Hide => "kerminal:tray:hide",
            Self::Quit => "kerminal:tray:quit",
        }
    }

    /// 从托盘菜单 item id 还原动作。
    pub fn from_menu_id(menu_id: &str) -> Option<Self> {
        let action_id = menu_id.strip_prefix(TRAY_MENU_ID_PREFIX)?;
        tray_menu_actions()
            .iter()
            .copied()
            .find(|action| action.action_id() == action_id)
    }

    const fn action_id(self) -> &'static str {
        match self {
            Self::Show => "show",
            Self::Hide => "hide",
            Self::Quit => "quit",
        }
    }
}

/// 返回所有托盘菜单动作。
pub const fn tray_menu_actions() -> &'static [TrayMenuAction] {
    &[
        TrayMenuAction::Show,
        TrayMenuAction::Hide,
        TrayMenuAction::Quit,
    ]
}

/// 设置主窗口运行时图标，降低 dev 二进制或平台图标缓存带来的旧图标概率。
pub fn apply_default_window_icon<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let Some(icon) = app.default_window_icon().cloned() else {
        return Ok(());
    };

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window.set_icon(icon)?;
    }
    Ok(())
}

/// 安装系统托盘，图标复用 Tauri 默认窗口图标。
pub fn setup_app_tray<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(
        app,
        TrayMenuAction::Show.menu_id(),
        "显示 Kerminal",
        true,
        None::<&str>,
    )?;
    let hide = MenuItem::with_id(
        app,
        TrayMenuAction::Hide.menu_id(),
        "隐藏 Kerminal",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(
        app,
        TrayMenuAction::Quit.menu_id(),
        "退出 Kerminal",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &hide, &separator, &quit])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Kerminal")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if let Some(action) = TrayMenuAction::from_menu_id(event.id().as_ref()) {
                handle_tray_menu_action(app, action);
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

fn handle_tray_menu_action<R: Runtime>(app: &AppHandle<R>, action: TrayMenuAction) {
    match action {
        TrayMenuAction::Show => {
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
        TrayMenuAction::Hide => {
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let _ = window.hide();
            }
        }
        TrayMenuAction::Quit => app.exit(0),
    }
}
