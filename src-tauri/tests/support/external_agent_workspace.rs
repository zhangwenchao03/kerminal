#![allow(dead_code)]

use std::path::Path;
#[cfg(windows)]
use std::process::{Command, Stdio};

use kerminal_lib::services::external_agent_workspace::{
    ExternalAgentLaunchSpec, ExternalAgentOverwritePolicy, ExternalAgentWorkspaceService,
    PrepareExternalAgentWorkspaceRequest,
};

pub fn assert_agent_launch_command(spec: &ExternalAgentLaunchSpec, command: &str) {
    assert_launch_parts(&spec.shell, &spec.args, command);
}

pub fn assert_launch_parts(shell: &str, args: &[String], command: &str) {
    #[cfg(windows)]
    {
        if shell.eq_ignore_ascii_case("cmd.exe") {
            let expected_args = vec![
                "/d".to_owned(),
                "/s".to_owned(),
                "/k".to_owned(),
                command.to_owned(),
            ];
            assert_eq!(args, expected_args.as_slice());
        } else {
            assert!(
                shell.eq_ignore_ascii_case("pwsh.exe")
                    || shell.eq_ignore_ascii_case("powershell.exe")
            );
            assert!(args.iter().any(|arg| arg.eq_ignore_ascii_case("-NoLogo")));
            assert!(args
                .iter()
                .any(|arg| arg.eq_ignore_ascii_case("-NoProfile")));
            assert!(args.iter().any(|arg| arg.eq_ignore_ascii_case("-NoExit")));
            let command_index = args
                .iter()
                .position(|arg| arg.eq_ignore_ascii_case("-Command"))
                .expect("PowerShell wrapper includes -Command");
            assert_eq!(
                args.get(command_index + 1).map(String::as_str),
                Some(command)
            );
        }
    }

    #[cfg(not(windows))]
    {
        let (expected_shell, expected_args) = split_command_line(command);
        assert_eq!(shell, expected_shell);
        assert_eq!(args, expected_args);
    }
}

#[cfg(windows)]
pub fn windows_command_available(command: &str) -> bool {
    Command::new(command)
        .arg("-NoLogo")
        .arg("-NoProfile")
        .arg("-Command")
        .arg("$PSVersionTable.PSVersion.ToString()")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

pub fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

pub fn prepare_custom_command_spec(command: &str) -> ExternalAgentLaunchSpec {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = ExternalAgentWorkspaceService::new(
        temp.path(),
        Some("http://127.0.0.1:3005/mcp".to_owned()),
        true,
    );

    service
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "custom".to_owned(),
            agent_session_id: None,
            custom_command: Some(command.to_owned()),
            resume_provider_session: false,
            dry_run: false,
            overwrite_policy: ExternalAgentOverwritePolicy::BackupAndReplaceInvalid,
        })
        .expect("prepare custom command")
}

#[cfg(not(windows))]
pub fn split_command_line(input: &str) -> (String, Vec<String>) {
    let chars = input.chars().collect::<Vec<_>>();
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut index = 0;

    while index < chars.len() {
        let char = chars[index];
        if char == '\\' {
            if let Some(next) = chars.get(index + 1).copied() {
                if next == '"' || next == '\'' || next == '\\' || next.is_whitespace() {
                    current.push(next);
                    index += 2;
                    continue;
                }
            }
            current.push(char);
            index += 1;
            continue;
        }
        if let Some(active_quote) = quote {
            if char == active_quote {
                quote = None;
            } else {
                current.push(char);
            }
            index += 1;
            continue;
        }
        if char == '"' || char == '\'' {
            quote = Some(char);
            index += 1;
            continue;
        }
        if char.is_whitespace() {
            if !current.is_empty() {
                parts.push(std::mem::take(&mut current));
            }
            index += 1;
            continue;
        }
        current.push(char);
        index += 1;
    }

    if !current.is_empty() {
        parts.push(current);
    }

    let shell = parts.first().cloned().expect("command shell");
    (shell, parts[1..].to_vec())
}

pub fn assert_session_env(
    spec: &ExternalAgentLaunchSpec,
    agent_session_id: &str,
    workspace_root: &Path,
    session_root: &Path,
    mcp_endpoint: &str,
) {
    let env = spec.env.as_ref().expect("session env");
    let expected_workspace_root = path_to_string(workspace_root);
    let expected_session_root = path_to_string(session_root);
    assert_eq!(
        env.get("KERMINAL_AGENT_SESSION_ID").map(String::as_str),
        Some(agent_session_id)
    );
    assert_eq!(
        env.get("KERMINAL_WORKSPACE_ROOT").map(String::as_str),
        Some(expected_workspace_root.as_str())
    );
    assert_eq!(
        env.get("KERMINAL_AGENT_SESSION_ROOT").map(String::as_str),
        Some(expected_session_root.as_str())
    );
    assert_eq!(
        env.get("KERMINAL_MCP_ENDPOINT").map(String::as_str),
        Some(mcp_endpoint)
    );
}
