//! Kerminal 原生应用菜单。
//!
//! @author kongweiguang

use serde::Serialize;
use tauri::{
    menu::{AboutMetadata, Menu, MenuBuilder, MenuItem, MenuItemBuilder, SubmenuBuilder},
    App, Emitter, Manager, Runtime,
};

/// 原生菜单动作发给前端的事件名。
pub const NATIVE_MENU_ACTION_EVENT: &str = "kerminal://native-menu-action";

/// 当前主窗口标签。
pub const MAIN_WINDOW_LABEL: &str = "main";

const MENU_ID_PREFIX: &str = "kerminal:";

/// 原生菜单可触发的工作台动作。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum NativeMenuAction {
    NewTerminal,
    CloseTab,
    ClosePane,
    OpenSettings,
    SplitHorizontal,
    SplitVertical,
    OpenLogs,
    OpenAgentLauncher,
    OpenSystem,
    OpenSftp,
    OpenPorts,
    OpenSnippets,
    EditUndo,
    EditRedo,
    EditCut,
    EditCopy,
    EditPaste,
    EditSelectAll,
}

impl NativeMenuAction {
    /// 返回前端使用的稳定 action id。
    pub const fn action_id(self) -> &'static str {
        match self {
            Self::NewTerminal => "newTerminal",
            Self::CloseTab => "closeTab",
            Self::ClosePane => "closePane",
            Self::OpenSettings => "openSettings",
            Self::SplitHorizontal => "splitHorizontal",
            Self::SplitVertical => "splitVertical",
            Self::OpenLogs => "openLogs",
            Self::OpenAgentLauncher => "openAgentLauncher",
            Self::OpenSystem => "openSystem",
            Self::OpenSftp => "openSftp",
            Self::OpenPorts => "openPorts",
            Self::OpenSnippets => "openSnippets",
            Self::EditUndo => "editUndo",
            Self::EditRedo => "editRedo",
            Self::EditCut => "editCut",
            Self::EditCopy => "editCopy",
            Self::EditPaste => "editPaste",
            Self::EditSelectAll => "editSelectAll",
        }
    }

    /// 返回原生菜单 item id，带 Kerminal 命名空间。
    pub const fn menu_id(self) -> &'static str {
        match self {
            Self::NewTerminal => "kerminal:newTerminal",
            Self::CloseTab => "kerminal:closeTab",
            Self::ClosePane => "kerminal:closePane",
            Self::OpenSettings => "kerminal:openSettings",
            Self::SplitHorizontal => "kerminal:splitHorizontal",
            Self::SplitVertical => "kerminal:splitVertical",
            Self::OpenLogs => "kerminal:openLogs",
            Self::OpenAgentLauncher => "kerminal:openAgentLauncher",
            Self::OpenSystem => "kerminal:openSystem",
            Self::OpenSftp => "kerminal:openSftp",
            Self::OpenPorts => "kerminal:openPorts",
            Self::OpenSnippets => "kerminal:openSnippets",
            Self::EditUndo => "kerminal:editUndo",
            Self::EditRedo => "kerminal:editRedo",
            Self::EditCut => "kerminal:editCut",
            Self::EditCopy => "kerminal:editCopy",
            Self::EditPaste => "kerminal:editPaste",
            Self::EditSelectAll => "kerminal:editSelectAll",
        }
    }

    /// 从原生菜单 item id 还原动作。
    pub fn from_menu_id(menu_id: &str) -> Option<Self> {
        let action_id = menu_id.strip_prefix(MENU_ID_PREFIX)?;
        native_menu_actions()
            .iter()
            .copied()
            .find(|action| action.action_id() == action_id)
    }
}

/// 发给前端的原生菜单动作 payload。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NativeMenuActionPayload {
    /// 前端工作台动作 id。
    pub action: &'static str,
}

impl From<NativeMenuAction> for NativeMenuActionPayload {
    fn from(action: NativeMenuAction) -> Self {
        Self {
            action: action.action_id(),
        }
    }
}

/// 返回所有由 Kerminal 处理的原生菜单动作。
pub const fn native_menu_actions() -> &'static [NativeMenuAction] {
    &[
        NativeMenuAction::NewTerminal,
        NativeMenuAction::CloseTab,
        NativeMenuAction::ClosePane,
        NativeMenuAction::OpenSettings,
        NativeMenuAction::SplitHorizontal,
        NativeMenuAction::SplitVertical,
        NativeMenuAction::OpenLogs,
        NativeMenuAction::OpenAgentLauncher,
        NativeMenuAction::OpenSystem,
        NativeMenuAction::OpenSftp,
        NativeMenuAction::OpenPorts,
        NativeMenuAction::OpenSnippets,
        NativeMenuAction::EditUndo,
        NativeMenuAction::EditRedo,
        NativeMenuAction::EditCut,
        NativeMenuAction::EditCopy,
        NativeMenuAction::EditPaste,
        NativeMenuAction::EditSelectAll,
    ]
}

/// 为 Tauri 桌面应用安装 Kerminal 原生菜单。
pub fn setup_app_menu<R: Runtime>(app: &mut App<R>) -> tauri::Result<()> {
    let menu = build_app_menu(app.handle())?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if let Some(action) = NativeMenuAction::from_menu_id(event.id().as_ref()) {
            let _ = app.emit_to(
                MAIN_WINDOW_LABEL,
                NATIVE_MENU_ACTION_EVENT,
                NativeMenuActionPayload::from(action),
            );
        }
    });
    Ok(())
}

fn build_app_menu<R: Runtime, M: Manager<R>>(manager: &M) -> tauri::Result<Menu<R>> {
    let new_terminal = menu_item(
        manager,
        NativeMenuAction::NewTerminal,
        "新建本地终端",
        Some(platform_accelerator("Ctrl+Shift+T", "Cmd+Shift+T")),
    )?;
    let close_tab = menu_item(
        manager,
        NativeMenuAction::CloseTab,
        "关闭当前终端 Tab",
        Some(platform_accelerator("Ctrl+F4", "Cmd+W")),
    )?;
    let close_pane = menu_item(
        manager,
        NativeMenuAction::ClosePane,
        "关闭当前分屏",
        Some(platform_accelerator("Ctrl+Shift+W", "Cmd+Shift+W")),
    )?;
    let open_settings = menu_item(
        manager,
        NativeMenuAction::OpenSettings,
        "打开设置",
        Some(platform_accelerator("Ctrl+Alt+S", "Cmd+,")),
    )?;
    let split_horizontal = menu_item(
        manager,
        NativeMenuAction::SplitHorizontal,
        "左右分屏",
        Some("Ctrl+Alt+Right"),
    )?;
    let split_vertical = menu_item(
        manager,
        NativeMenuAction::SplitVertical,
        "上下分屏",
        Some("Ctrl+Alt+Down"),
    )?;
    let open_logs = menu_item(
        manager,
        NativeMenuAction::OpenLogs,
        "打开日志",
        Some(platform_accelerator("Alt+7", "Cmd+7")),
    )?;
    let open_agent_launcher = menu_item(
        manager,
        NativeMenuAction::OpenAgentLauncher,
        "打开 Agent Launcher",
        Some(platform_accelerator("Alt+2", "Cmd+2")),
    )?;
    let open_system = menu_item(
        manager,
        NativeMenuAction::OpenSystem,
        "系统信息",
        Some(platform_accelerator("Alt+3", "Cmd+3")),
    )?;
    let open_sftp = menu_item(
        manager,
        NativeMenuAction::OpenSftp,
        "SFTP",
        Some(platform_accelerator("Alt+4", "Cmd+4")),
    )?;
    let open_ports = menu_item(
        manager,
        NativeMenuAction::OpenPorts,
        "端口转发",
        Some(platform_accelerator("Alt+5", "Cmd+5")),
    )?;
    let open_snippets = menu_item(
        manager,
        NativeMenuAction::OpenSnippets,
        "脚本片段",
        Some(platform_accelerator("Alt+6", "Cmd+6")),
    )?;
    let edit_undo = menu_item(manager, NativeMenuAction::EditUndo, "撤销", None)?;
    let edit_redo = menu_item(manager, NativeMenuAction::EditRedo, "重做", None)?;
    let edit_cut = menu_item(manager, NativeMenuAction::EditCut, "剪切", None)?;
    let edit_copy = menu_item(manager, NativeMenuAction::EditCopy, "复制", None)?;
    let edit_paste = menu_item(manager, NativeMenuAction::EditPaste, "粘贴", None)?;
    let edit_select_all = menu_item(manager, NativeMenuAction::EditSelectAll, "全选", None)?;

    let app_menu = SubmenuBuilder::new(manager, "Kerminal")
        .about_with_text(
            "关于 Kerminal",
            Some(AboutMetadata {
                name: Some("Kerminal".into()),
                version: Some(env!("CARGO_PKG_VERSION").into()),
                ..Default::default()
            }),
        )
        .separator()
        .quit_with_text("退出 Kerminal")
        .build()?;
    let file_menu = SubmenuBuilder::new(manager, "文件")
        .item(&new_terminal)
        .separator()
        .item(&close_tab)
        .item(&close_pane)
        .item(&open_settings)
        .build()?;
    // Keep edit chords owned by the WebView so terminal Ctrl+C/V and Monaco
    // shortcuts are not stolen by native menu accelerators.
    let edit_menu = SubmenuBuilder::new(manager, "编辑")
        .item(&edit_undo)
        .item(&edit_redo)
        .separator()
        .item(&edit_cut)
        .item(&edit_copy)
        .item(&edit_paste)
        .separator()
        .item(&edit_select_all)
        .build()?;
    let terminal_menu = SubmenuBuilder::new(manager, "终端")
        .item(&split_horizontal)
        .item(&split_vertical)
        .separator()
        .item(&open_logs)
        .item(&open_agent_launcher)
        .build()?;
    let view_menu = SubmenuBuilder::new(manager, "视图")
        .item(&open_system)
        .item(&open_sftp)
        .item(&open_ports)
        .item(&open_snippets)
        .build()?;

    MenuBuilder::new(manager)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&terminal_menu)
        .item(&view_menu)
        .build()
}

fn menu_item<R: Runtime, M: Manager<R>>(
    manager: &M,
    action: NativeMenuAction,
    label: &str,
    accelerator: Option<&str>,
) -> tauri::Result<MenuItem<R>> {
    let mut builder = MenuItemBuilder::with_id(action.menu_id(), label);
    if let Some(accelerator) = accelerator {
        builder = builder.accelerator(accelerator);
    }
    builder.build(manager)
}

fn platform_accelerator(windows: &'static str, macos: &'static str) -> &'static str {
    if cfg!(target_os = "macos") {
        macos
    } else {
        windows
    }
}
