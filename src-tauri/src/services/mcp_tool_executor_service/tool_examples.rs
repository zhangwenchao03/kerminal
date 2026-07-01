//! MCP tool schema examples shared by discovery and operation guide tools.
//!
//! @author kongweiguang

use super::*;

pub(super) fn example_arguments_for(tool_id: &str) -> Option<Value> {
    match tool_id {
        "kerminal.capabilities" | "kerminal.runtime_snapshot" | "terminal.list" => Some(json!({})),
        "kerminal.operation_guide" => Some(json!({
            "intent": "session-terminal",
            "goal": "Inspect and operate the currently bound Kerminal target safely."
        })),
        "kerminal.tool_help" => Some(json!({
            "toolId": "terminal.write",
            "includeSchemas": true
        })),
        "kerminal.agent.current_session" => Some(json!({
            "agentSessionId": "<agent-session-id-from-context/mcp-endpoint.json>"
        })),
        "kerminal.agent.target_context" => Some(json!({
            "agentSessionId": "<agent-session-id-from-context/mcp-endpoint.json>",
            "maxBytes": 24576
        })),
        "terminal.resolve_agent_target" => Some(json!({
            "agentSessionId": "<agent-session-id-from-context/mcp-endpoint.json>"
        })),
        "terminal.snapshot" => Some(json!({
            "agentSessionId": "<agent-session-id>",
            "maxBytes": 24576
        })),
        "terminal.write" => Some(json!({
            "agentSessionId": "<agent-session-id>",
            "bindingGeneration": 7,
            "data": "pwd\n"
        })),
        "terminal.resize" => Some(json!({
            "sessionId": "<terminal-session-id>",
            "cols": 120,
            "rows": 32
        })),
        "terminal.close" | "terminal.log.start" | "terminal.log.stop" | "terminal.log.state" => {
            Some(json!({
                "sessionId": "<terminal-session-id>"
            }))
        }
        "ssh.command_on_resolved_host" => Some(json!({
            "hostId": "<host-id-from-hosts-toml-or-bound-target>",
            "command": "uname -a"
        })),
        "ssh.command" => Some(json!({
            "hostId": "<host-id>",
            "command": "uptime"
        })),
        "sftp.list" | "sftp.preview" => Some(json!({
            "hostId": "<host-id>",
            "path": "/srv/app"
        })),
        "sftp.create_directory" => Some(json!({
            "hostId": "<host-id>",
            "path": "/srv/app/new-directory"
        })),
        "sftp.rename" => Some(json!({
            "hostId": "<host-id>",
            "fromPath": "/srv/app/old-name.txt",
            "toPath": "/srv/app/new-name.txt"
        })),
        "sftp.move" => Some(json!({
            "hostId": "<host-id>",
            "fromPath": "/srv/app/source.txt",
            "toPath": "/srv/app/archive/source.txt"
        })),
        "sftp.chmod" => Some(json!({
            "hostId": "<host-id>",
            "path": "/srv/app/script.sh",
            "mode": "0755"
        })),
        "sftp.delete" => Some(json!({
            "hostId": "<host-id>",
            "path": "/srv/app/obsolete.txt",
            "directory": false
        })),
        "sftp.upload" | "sftp.upload_directory" => Some(json!({
            "hostId": "<host-id>",
            "localPath": "C:/path/to/local/file-or-directory",
            "remotePath": "/srv/app/file-or-directory"
        })),
        "sftp.download" | "sftp.download_directory" => Some(json!({
            "hostId": "<host-id>",
            "remotePath": "/srv/app/file-or-directory",
            "localPath": "C:/path/to/local/file-or-directory"
        })),
        "sftp.transfer.enqueue" => Some(json!({
            "hostId": "<host-id>",
            "remotePath": "/srv/app/archive.tar.gz",
            "localPath": "C:/path/to/archive.tar.gz",
            "direction": "download",
            "kind": "file"
        })),
        "sftp.transfer.cancel" => Some(json!({
            "transferId": "<transfer-id-from-sftp.transfer.list>"
        })),
        "sftp.transfer.list" | "sftp.transfer.clear_completed" => Some(json!({})),
        "tmux.probe" | "tmux.list_sessions" => Some(json!({
            "targetKind": "ssh",
            "hostId": "<host-id>"
        })),
        "tmux.create_session" => Some(json!({
            "targetKind": "ssh",
            "hostId": "<host-id>",
            "name": "work"
        })),
        "tmux.rename_session" => Some(json!({
            "targetKind": "ssh",
            "hostId": "<host-id>",
            "sessionId": "old-name",
            "name": "new-name"
        })),
        "tmux.kill_session" | "tmux.list_windows" | "tmux.attach_plan" => Some(json!({
            "targetKind": "ssh",
            "hostId": "<host-id>",
            "sessionId": "work"
        })),
        "tmux.list_panes" => Some(json!({
            "targetKind": "ssh",
            "hostId": "<host-id>",
            "targetId": "work:0"
        })),
        "tmux.capture_pane" => Some(json!({
            "targetKind": "ssh",
            "hostId": "<host-id>",
            "paneId": "%1",
            "lines": 200
        })),
        "container.list" => Some(json!({
            "hostId": "<host-id>",
            "runtime": "docker",
            "includeStopped": false
        })),
        "container.inspect" | "container.stats" => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker"
        })),
        "container.logs.tail" => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "tail": 120
        })),
        "container.start" | "container.stop" | "container.restart" => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker"
        })),
        "container.remove" => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "force": false
        })),
        "container.files.list" | "container.files.preview" => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "path": "/app"
        })),
        "container.files.write_text" => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "path": "/app/config.local",
            "content": "KEY=value\n",
            "encoding": "utf-8",
            "create": true,
            "overwriteOnConflict": false
        })),
        "container.files.create_directory" => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "path": "/app/new-directory"
        })),
        "container.files.rename" => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "fromPath": "/app/old-name.txt",
            "toPath": "/app/new-name.txt"
        })),
        "container.files.chmod" => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "path": "/app/script.sh",
            "mode": "0755"
        })),
        "container.files.upload" | "container.files.download" => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "localPath": "C:/path/to/local/file-or-directory",
            "remotePath": "/app/file-or-directory",
            "kind": "file"
        })),
        "container.files.delete" => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "path": "/app/obsolete.txt",
            "directory": false
        })),
        "port_forward.list" => Some(json!({})),
        "port_forward.create" => Some(json!({
            "hostId": "<host-id>",
            "kind": "local",
            "bindHost": "127.0.0.1",
            "sourcePort": 15432,
            "targetHost": "127.0.0.1",
            "targetPort": 5432
        })),
        "port_forward.close" => Some(json!({
            "forwardId": "<port-forward-id-from-port_forward.list>"
        })),
        "server_info.snapshot" => Some(json!({
            "hostId": "<host-id>"
        })),
        "history.search" => Some(json!({
            "query": "docker compose",
            "limit": 20
        })),
        "kerminal.app_guide"
        | "kerminal.config_guide"
        | "diagnostics.runtime_health"
        | "diagnostics.create_bundle" => Some(json!({})),
        "kerminal.config.validate" => Some(json!({
            "scope": "all"
        })),
        "kerminal.host.upsert_with_credential" => Some(json!({
            "id": "<optional-host-id>",
            "name": "staging-web",
            "host": "staging.example.internal",
            "port": 22,
            "username": "deploy",
            "production": false,
            "password": "<credential-provided-by-user-for-this-save-only>"
        })),
        "kerminal.vault.encrypt_secret" => Some(json!({
            "kind": "ssh-host",
            "hostId": "<host-id>",
            "scope": "target",
            "material": "password",
            "plaintext": "<credential-provided-by-user-for-this-save-only>"
        })),
        _ => None,
    }
}
