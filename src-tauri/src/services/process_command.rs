//! 子进程启动辅助工具。
//!
//! @author kongweiguang

use std::process::Command;

/// 创建适合 Tauri GUI 进程使用的子进程命令。
///
/// Windows 打包后应用没有控制台，直接启动命令行程序可能弹出黑窗口；
/// 这里统一设置 `CREATE_NO_WINDOW`，其他平台保持标准行为。
pub fn silent_command(program: &str) -> Command {
    let mut command = Command::new(program);
    apply_no_window(&mut command);
    command
}

#[cfg(target_os = "windows")]
fn apply_no_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn apply_no_window(_command: &mut Command) {}
