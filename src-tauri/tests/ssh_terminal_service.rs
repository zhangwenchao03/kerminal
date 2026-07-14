//! SSH 远程终端服务集成测试。
//!
//! @author kongweiguang

#[path = "ssh_terminal_service/launch.rs"]
mod launch;
#[path = "ssh_terminal_service/managed_shell.rs"]
mod managed_shell;
#[path = "ssh_terminal_service/requests.rs"]
mod requests;
#[path = "ssh_terminal_service/support.rs"]
mod support;
