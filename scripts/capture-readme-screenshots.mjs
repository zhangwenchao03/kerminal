#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appUrl = process.argv[2] ?? "http://127.0.0.1:1425/";
const outputDir = path.join(repoRoot, "docs", "assets");
const chromePath = findChromePath();
const chromePort = 10_240 + Math.floor(Math.random() * 300);
const userDataDir = path.join(tmpdir(), `kerminal-readme-capture-${Date.now()}`);

if (!chromePath) {
  console.error("Chrome executable not found. Set CHROME_PATH to run this capture.");
  process.exit(1);
}

const captures = [
  { name: "kerminal-hero.png", setup: captureHero },
  { name: "kerminal-connect.png", setup: captureConnectDialog },
  { name: "kerminal-docker.png", setup: captureDockerDialog },
  { name: "kerminal-gpu.png", setup: captureServerInfo },
  { name: "kerminal-sftp.png", setup: captureSftp },
  { name: "kerminal-settings.png", setup: captureSettings },
];

async function main() {
  await waitForHttpOk(new URL(appUrl), 30_000);
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-gpu",
      "--disable-sync",
      "--hide-scrollbars",
      "--mute-audio",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${chromePort}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
  );

  let stderr = "";
  chrome.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  let client;
  try {
    await waitForChrome(chromePort, chrome);
    const target = await requestJson(chromePort, "/json/new?about:blank", "PUT");
    client = await CdpClient.connect(target.webSocketDebuggerUrl);
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      deviceScaleFactor: 1,
      height: 1040,
      mobile: false,
      width: 1600,
    });
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: browserBootstrapScript(),
    });
    await client.send("Page.navigate", { url: appUrl });
    await waitForAppReady(client);

    mkdirSync(outputDir, { recursive: true });
    const results = [];
    for (const capture of captures) {
      await capture.setup(client);
      await delay(600);
      await assertNoBlockingErrors(client);
      const screenshot = await client.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
      });
      const outputPath = path.join(outputDir, capture.name);
      writeFileSync(outputPath, Buffer.from(screenshot.data, "base64"));
      results.push(outputPath);
    }

    console.log(JSON.stringify({ appUrl, screenshots: results }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    if (client) {
      try {
        console.error(JSON.stringify(await collectDiagnostics(client), null, 2));
      } catch (diagnosticError) {
        console.error(
          diagnosticError instanceof Error
            ? diagnosticError.message
            : String(diagnosticError),
        );
      }
    }
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
    process.exitCode = 1;
  } finally {
    client?.close();
    await terminateChrome(chrome);
    rmSync(userDataDir, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 100,
    });
  }
}

async function captureHero(client) {
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-label="prod-api xterm 终端"]') !== null`,
    120_000,
  );
}

async function captureConnectDialog(client) {
  await clickSelector(client, `[aria-label="添加连接"]`);
  await waitForBrowserExpression(
    client,
    `document.body.innerText.includes("添加连接") || document.body.innerText.includes("连接")`,
    20_000,
  );
}

async function captureDockerDialog(client) {
  await clickTextButtonContaining(client, "Docker");
  await waitForBrowserExpression(
    client,
    `document.body.innerText.includes("kerminal/api") && document.body.innerText.includes("postgres:16")`,
    20_000,
  );
}

async function captureServerInfo(client) {
  await pressKey(client, "Escape");
  await waitForBrowserExpression(
    client,
    `!document.body.innerText.includes("kerminal/api:latest")`,
    10_000,
  );
  await clickSelector(client, `[aria-label="打开 系统"]`);
  await waitForBrowserExpression(
    client,
    `document.body.innerText.includes("GPU") && document.body.innerText.includes("2 张显卡")`,
    30_000,
  );
  await clickSelector(client, `[aria-label="展开GPU详情"]`);
  await waitForBrowserExpression(
    client,
    `document.body.innerText.includes("NVIDIA RTX 4090")`,
    10_000,
  );
}

async function captureSftp(client) {
  const session = sftpWorkspaceSession();
  await evaluate(
    client,
    `(() => {
      localStorage.setItem(
        "kerminal.readme.capture.session.override",
        ${JSON.stringify(JSON.stringify(session))},
      );
    })()`,
  );
  await client.send("Page.reload", { ignoreCache: false });
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-label="SFTP 传输工作台"]') !== null && document.body.innerText.includes("release-2026-06-23.tar.gz")`,
    30_000,
  );
}

async function captureSettings(client) {
  await clickSelector(client, `[aria-label="打开设置"]`);
  await waitForBrowserExpression(
    client,
    `document.body.innerText.includes("主题") && document.body.innerText.includes("终端外观")`,
    30_000,
  );
}

async function waitForAppReady(client) {
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-label="工具栏"]') !== null && document.body.innerText.includes("prod-api")`,
    120_000,
  );
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-label="prod-api xterm 终端"]') !== null`,
    120_000,
  );
  await delay(500);
}

async function assertNoBlockingErrors(client) {
  const result = await evaluate(
    client,
    `(() => window.__kerminalReadmeCaptureState?.errors ?? [])()`,
    { returnByValue: true },
  );
  const errors = result.result?.value ?? [];
  const blocking = errors.filter(
    (error) =>
      !String(error.message ?? "").includes("ResizeObserver loop completed") &&
      !String(error.message ?? "").includes("ResizeObserver loop limit"),
  );
  if (blocking.length > 0) {
    throw new Error(`Browser errors during capture: ${JSON.stringify(blocking)}`);
  }
}

async function collectDiagnostics(client) {
  const result = await evaluate(
    client,
    `(() => ({
      ariaLabels: Array.from(document.querySelectorAll("[aria-label]"))
        .map((node) => node.getAttribute("aria-label"))
        .filter(Boolean)
        .slice(0, 120),
      bodyText: document.body?.innerText?.slice(0, 5000) ?? "",
      captureState: window.__kerminalReadmeCaptureState ?? null,
      html: document.querySelector("#root")?.innerHTML?.slice(0, 3000) ?? "",
      location: window.location.href,
      readyState: document.readyState,
    }))()`,
    { returnByValue: true },
  );
  return result.result?.value;
}

function sftpWorkspaceSession() {
  return {
    activeTabId: "tab-sftp-transfer-1",
    focusedPaneId: "pane-prod-api",
    removedSidebarMachineIds: [],
    selectedMachineId: "prod-api",
    sidebarMachines: [],
    terminalPanes: [
      {
        currentCwd: "/srv/kerminal",
        cwd: "/srv/kerminal",
        id: "pane-prod-api",
        lines: [],
        machineId: "prod-api",
        mode: "ssh",
        outputHistory:
          "deploy@prod-api:/srv/kerminal$ docker ps --format 'table {{.Names}}\\t{{.Status}}'\r\nNAMES        STATUS\r\napi          Up 12 minutes\r\nworker       Up 8 minutes\r\n",
        prompt: "deploy@prod-api:/srv/kerminal$",
        remoteHostId: "prod-api",
        remoteHostProduction: false,
        status: "online",
        target: { hostId: "prod-api", kind: "ssh" },
        title: "prod-api",
      },
    ],
    terminalTabs: [
      {
        id: "tab-prod-api",
        layout: { paneId: "pane-prod-api", type: "pane" },
        machineId: "prod-api",
        title: "prod-api",
      },
      {
        id: "tab-sftp-transfer-1",
        kind: "sftpTransfer",
        machineId: "prod-api",
        rightHostId: "prod-api",
        title: "SFTP 传输",
      },
    ],
    version: 1,
  };
}

function browserBootstrapScript() {
  const workspaceSession = {
    activeTabId: "tab-prod-api",
    focusedPaneId: "pane-prod-api",
    removedSidebarMachineIds: [],
    selectedMachineId: "prod-api",
    sidebarMachines: [],
    terminalPanes: [
      {
        currentCwd: "/srv/kerminal",
        cwd: "/srv/kerminal",
        id: "pane-prod-api",
        lines: [],
        machineId: "prod-api",
        mode: "ssh",
        outputHistory:
          "deploy@prod-api:/srv/kerminal$ git status --short\r\n M src/features/tool-panel/AiToolContent.tsx\r\n M src/features/machine-sidebar/RemoteHostCreateDialog.tsx\r\ndeploy@prod-api:/srv/kerminal$ docker ps --format 'table {{.Names}}\\t{{.Status}}'\r\nNAMES        STATUS\r\napi          Up 12 minutes\r\nworker       Up 8 minutes\r\n",
        prompt: "deploy@prod-api:/srv/kerminal$",
        remoteHostId: "prod-api",
        remoteHostProduction: false,
        status: "online",
        target: { hostId: "prod-api", kind: "ssh" },
        title: "prod-api",
      },
    ],
    terminalTabs: [
      {
        id: "tab-prod-api",
        layout: { paneId: "pane-prod-api", type: "pane" },
        machineId: "prod-api",
        title: "prod-api",
      },
    ],
    version: 1,
  };

  return `
    (() => {
      const workspaceSessionOverride = localStorage.getItem(
        "kerminal.readme.capture.session.override",
      );
      localStorage.setItem(
        "kerminal.workspace.session.v1",
        workspaceSessionOverride ?? ${JSON.stringify(JSON.stringify(workspaceSession))},
      );
      localStorage.setItem(
        "kerminal.remote-host-dialog.last-docker-host-id",
        "prod-api",
      );
      const callbacks = new Map();
      const channelIndexes = new Map();
      const sessions = new Map();
      let nextCallbackId = 1;
      let nextSessionId = 1;
      window.isTauri = true;
      window.matchMedia = (query) => ({
        addEventListener() {},
        addListener() {},
        dispatchEvent() { return false; },
        matches: query.includes("prefers-color-scheme: dark"),
        media: query,
        onchange: null,
        removeEventListener() {},
        removeListener() {},
      });
      window.__kerminalReadmeCaptureState = {
        errors: [],
        invocations: [],
        unknownInvocations: [],
      };
      const recordError = (kind, value) => {
        window.__kerminalReadmeCaptureState.errors.push({
          kind,
          message:
            value?.reason?.stack ??
            value?.reason?.message ??
            value?.error?.stack ??
            value?.error?.message ??
            value?.message ??
            String(value),
        });
      };
      window.addEventListener("error", (event) => recordError("error", event));
      window.addEventListener("unhandledrejection", (event) =>
        recordError("unhandledrejection", event),
      );
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      window.__TAURI_INTERNALS__ = {
        callbacks,
        convertFileSrc(filePath) {
          return String(filePath);
        },
        metadata: {
          currentWebview: { label: "main" },
          currentWindow: { label: "main" },
        },
        runCallback(id, payload) {
          callbacks.get(id)?.(payload);
        },
        transformCallback(callback, once = false) {
          const id = nextCallbackId++;
          callbacks.set(id, (payload) => {
            callback(payload);
            if (once) callbacks.delete(id);
          });
          return id;
        },
        unregisterCallback(id) {
          callbacks.delete(id);
        },
        async invoke(cmd, args = {}) {
          window.__kerminalReadmeCaptureState.invocations.push({
            cmd,
            args: sanitizeArgs(args),
          });
          switch (cmd) {
            case "plugin:event|listen":
              return "readme-capture-listener";
            case "plugin:event|unlisten":
              return null;
            case "settings_get":
              return readmeSettings();
            case "settings_update":
              return args.settings;
            case "profile_list":
              return profiles();
            case "profile_detect_shells":
              return shellCandidates();
            case "remote_host_tree":
              return remoteHostTree();
            case "remote_host_group_list":
              return remoteHostTree().map(({ hosts, ...group }) => group);
            case "remote_host_create":
              return createdRemoteHost(args.request);
            case "remote_host_update":
              return createdRemoteHost(args.request);
            case "remote_host_group_create":
              return {
                createdAt: "readme-capture",
                id: "group-new",
                name: args.request?.name ?? "New Group",
                sortOrder: 40,
                updatedAt: "readme-capture",
              };
            case "remote_host_group_update":
              return {
                createdAt: "readme-capture",
                id: args.request?.id ?? "group-new",
                name: args.request?.name ?? "New Group",
                sortOrder: args.request?.sortOrder ?? 40,
                updatedAt: "readme-capture",
              };
            case "remote_host_delete":
            case "remote_host_group_delete":
            case "profile_delete":
              return true;
            case "profile_create":
            case "profile_update":
              return {
                args: args.request?.args ?? [],
                createdAt: "readme-capture",
                env: args.request?.env ?? {},
                id: args.request?.id ?? "profile-custom",
                isDefault: false,
                name: args.request?.name ?? "Custom shell",
                shell: args.request?.shell ?? "pwsh.exe",
                sortOrder: args.request?.sortOrder ?? 20,
                updatedAt: "readme-capture",
              };
            case "connection_test":
              return { message: "连接参数校验通过。", ok: true };
            case "docker_list_containers":
              return dockerContainers(args.request);
            case "server_info_snapshot":
              return serverInfoSnapshot(args.request);
            case "sftp_list_directory":
              return sftpListing(args.request);
            case "file_dialog_list_local_directory":
              return localListing(args.path);
            case "sftp_list_transfers":
              return sftpTransfers(args.request);
            case "sftp_clear_completed_transfers":
              return sftpTransfers().filter((item) => item.status !== "succeeded");
            case "sftp_cancel_transfer":
              return { ...sftpTransfers()[0], cancelRequested: true };
            case "sftp_preview_file":
              return {
                bytesRead: 128,
                content: "PORT=1425\\nRUST_LOG=info\\n",
                encoding: "utf-8",
                hostId: args.request?.hostId ?? "prod-api",
                maxBytes: args.request?.maxBytes ?? 4096,
                path: args.request?.path ?? "/srv/kerminal/.env",
                truncated: false,
              };
            case "sftp_stat_path":
              return {
                hostId: args.request?.hostId ?? "prod-api",
                kind: "file",
                path: args.request?.path ?? "/srv/kerminal/.env",
                readonly: false,
                size: 128,
              };
            case "sftp_trust_host_key":
              return {
                host: "10.23.42.18",
                hostId: args.request?.hostId ?? "prod-api",
                knownHostsPath: "C:/Users/kong/.ssh/known_hosts",
                port: 22,
              };
            case "sftp_classify_local_paths":
              return (args.request?.paths ?? []).map((path) => ({
                kind: String(path).endsWith("/") ? "directory" : "file",
                path,
              }));
            case "sftp_read_local_file_clipboard":
              return [];
            case "terminal_create_session":
            case "ssh_create_session":
            case "telnet_create_session":
            case "serial_create_session":
            case "docker_create_container_session": {
              const id = "readme-session-" + nextSessionId++;
              const channelId = args.output?.id;
              sessions.set(id, { channelId });
              queueMicrotask(() => {
                emitTerminal(channelId, {
                  data:
                    "deploy@prod-api:/srv/kerminal$ git status --short\\r\\n M src/features/tool-panel/AiToolContent.tsx\\r\\n M src/features/machine-sidebar/RemoteHostCreateDialog.tsx\\r\\ndeploy@prod-api:/srv/kerminal$ ",
                  kind: "data",
                  sessionId: id,
                });
              });
              return {
                cols: args.request?.cols ?? 120,
                cwd: "/srv/kerminal",
                id,
                rows: args.request?.rows ?? 32,
                shell: cmd === "ssh_create_session" ? "ssh" : "pwsh",
                status: "running",
                targetRef: cmd === "ssh_create_session" ? "ssh:prod-api" : "local",
                targetToken: "readme-target-token",
              };
            }
            case "terminal_write": {
              const session = sessions.get(args.sessionId);
              emitTerminal(session?.channelId, {
                data: args.data,
                kind: "data",
                sessionId: args.sessionId,
              });
              return null;
            }
            case "terminal_resize":
            case "terminal_close":
              return null;
            case "terminal_list_sessions":
              return Array.from(sessions.keys()).map((id) => ({
                cols: 120,
                cwd: "/srv/kerminal",
                id,
                rows: 32,
                shell: "ssh",
                status: "running",
                targetRef: "ssh:prod-api",
                targetToken: "readme-target-token",
              }));
            case "terminal_log_state":
            case "terminal_stop_log":
              return { active: false, bytesWritten: 0 };
            case "terminal_start_log":
              return {
                active: true,
                bytesWritten: 0,
                path: "readme-capture://terminal.log",
                startedAt: "1782197600",
              };
            case "terminal_session_binding_register":
            case "terminal_session_binding_ready":
              return {
                generation: 1,
                metadata: args.metadata ?? null,
                paneId: args.paneId,
                readyAtMs: Date.now(),
                registeredAtMs: Date.now(),
                sessionId: args.sessionId,
                status: "ready",
                updatedAtMs: Date.now(),
              };
            case "terminal_session_binding_disconnected":
              return null;
            case "terminal_session_binding_closed":
              return true;
            case "terminal_session_binding_events":
              return [];
            case "command_suggestion_list":
              return [];
            case "command_suggestion_record_feedback":
              return { recorded: true, skipReason: null };
            case "command_suggestion_record_audit_event":
              return { eventId: "readme-audit", recorded: true };
            case "command_suggestion_refresh_remote_commands":
            case "command_suggestion_refresh_remote_history":
            case "command_suggestion_refresh_remote_paths":
            case "command_suggestion_refresh_git_refs":
              return { cachedAtUnixMs: Date.now(), entryCount: 0, hostId: "prod-api" };
            case "command_history_list":
              return commandHistory();
            case "command_history_record":
              return { entry: null, recorded: true, skipReason: null };
            case "command_history_delete":
              return true;
            case "command_history_clear":
              return 0;
            case "snippet_list":
              return snippets();
            case "workflow_list":
              return workflows();
            case "port_forward_list":
              return portForwards();
            case "tool_registry_list":
            case "tool_registry_mcp_list":
              return [];
            case "tool_registry_mcp_manifest":
              return { capabilities: [], name: "Kerminal", tools: [] };
            case "tool_registry_mcp_http_status":
            case "tool_registry_mcp_http_start":
            case "tool_registry_mcp_http_stop":
              return { enabled: false, port: null, running: false };
            case "llm_provider_list":
              return llmProviders();
            case "ai_conversation_list":
            case "ai_tool_pending_list":
            case "ai_tool_audit_list":
              return [];
            case "ai_conversation_slot_get":
              return null;
            case "diagnostics_runtime_health":
              return { checks: [], status: "healthy" };
            case "diagnostics_create_bundle":
              return { createdAt: "readme-capture", files: [], path: "readme-capture.zip" };
            case "file_dialog_select_local_file":
            case "file_dialog_select_local_image":
            case "file_dialog_select_local_directory":
            case "file_dialog_select_save_file":
              return null;
            case "file_dialog_get_app_skills_directory":
              return "C:/Users/kong/.codex/skills";
            case "file_dialog_open_local_directory":
              return null;
            default:
              window.__kerminalReadmeCaptureState.unknownInvocations.push({
                cmd,
                args: sanitizeArgs(args),
              });
              if (cmd.endsWith("_list") || cmd.includes("_list_")) return [];
              if (cmd.endsWith("_delete") || cmd.endsWith("_clear")) return true;
              return null;
          }
        },
      };

      function emitTerminal(channelId, message) {
        if (!channelId || !callbacks.has(channelId)) return;
        const index = channelIndexes.get(channelId) ?? 0;
        channelIndexes.set(channelId, index + 1);
        callbacks.get(channelId)({ index, message });
      }

      function profiles() {
        return [
          {
            args: [],
            createdAt: "readme-capture",
            env: {},
            id: "profile-powershell",
            isDefault: true,
            name: "PowerShell",
            shell: "pwsh.exe",
            sortOrder: 10,
            updatedAt: "readme-capture",
          },
        ];
      }

      function shellCandidates() {
        return [
          {
            args: [],
            id: "pwsh",
            isAvailable: true,
            isDefault: true,
            name: "PowerShell 7",
            shell: "pwsh.exe",
            source: "path",
          },
          {
            args: [],
            id: "cmd",
            isAvailable: true,
            isDefault: false,
            name: "Command Prompt",
            shell: "cmd.exe",
            source: "path",
          },
          {
            args: ["--login"],
            id: "git-bash",
            isAvailable: true,
            isDefault: false,
            name: "Git Bash",
            shell: "C:/Program Files/Git/bin/bash.exe",
            source: "commonPath",
          },
        ];
      }

      function remoteHostTree() {
        return [
          {
            createdAt: "readme-capture",
            hosts: [
              remoteHost({ host: "10.23.42.18", id: "prod-api", name: "prod-api", tags: ["prod", "gpu"], username: "deploy" }),
              remoteHost({ host: "10.23.42.19", id: "jump-box", name: "jump-box", tags: ["jump"], username: "ops" }),
              remoteHost({ host: "10.23.42.21", id: "edge-serial", name: "edge-serial", port: 1, tags: ["serial", "lab"], username: "" }),
            ],
            id: "group-prod",
            name: "Production",
            sortOrder: 10,
            updatedAt: "readme-capture",
          },
          {
            createdAt: "readme-capture",
            hosts: [
              remoteHost({ host: "10.24.8.5", id: "dev-box", name: "dev-box", tags: ["dev"], username: "kong" }),
              remoteHost({ host: "10.24.8.9", id: "rdp-lab", name: "rdp-lab", port: 3389, tags: ["rdp"], username: "Administrator" }),
            ],
            id: "group-dev",
            name: "Development",
            sortOrder: 20,
            updatedAt: "readme-capture",
          },
        ];
      }

      function remoteHost(input) {
        return {
          authType: "password",
          createdAt: "readme-capture",
          credentialSecret: "configured",
          groupId: input.id?.startsWith("dev") || input.id?.startsWith("rdp") ? "group-dev" : "group-prod",
          host: input.host,
          id: input.id,
          name: input.name,
          port: input.port ?? 22,
          production: input.tags?.includes("prod") ?? false,
          sortOrder: 10,
          sshOptions: defaultSshOptions(),
          tags: input.tags ?? [],
          updatedAt: "readme-capture",
          username: input.username,
        };
      }

      function createdRemoteHost(request = {}) {
        return {
          ...remoteHost({
            host: request.host ?? "10.24.8.20",
            id: request.id ?? "created-host",
            name: request.name ?? "created-host",
            port: request.port,
            tags: request.tags ?? [],
            username: request.username ?? "deploy",
          }),
          groupId: request.groupId ?? "group-prod",
          sortOrder: request.sortOrder ?? 30,
        };
      }

      function defaultSshOptions() {
        return {
          jumpHosts: [],
          proxy: { protocol: "none" },
          terminal: {
            altModifier: "8bit",
            backspaceKey: "ascii-delete",
            connectTimeoutSeconds: 30,
            deleteKey: "delete-sequence",
            encoding: "UTF-8",
            environment: "",
            keepaliveSeconds: 60,
            keyboardProfile: "default",
            loginScript: "",
            startupCommand: "",
            terminalType: "xterm-256color",
          },
          transfer: {
            enabled: true,
            followSymlinks: false,
            localStartDirectory: "C:/Users/kong/Downloads",
            maxConcurrentTransfers: 4,
            preserveTimestamps: true,
            remoteStartDirectory: "/srv/kerminal",
          },
          tunnels: [],
        };
      }

      function dockerContainers(request = {}) {
        return [
          dockerContainer(request.hostId ?? "prod-api", {
            id: "c0ffee1234567890",
            image: "kerminal/api:latest",
            name: "api",
            ports: ["0.0.0.0:8080->80/tcp"],
            state: "running",
            status: "running",
            statusText: "Up 12 minutes",
          }),
          dockerContainer(request.hostId ?? "prod-api", {
            id: "badc0de22222222",
            image: "kerminal/worker:latest",
            name: "worker",
            ports: [],
            state: "running",
            status: "running",
            statusText: "Up 8 minutes",
          }),
          dockerContainer(request.hostId ?? "prod-api", {
            id: "deadbeef98765432",
            image: "postgres:16",
            name: "postgres",
            ports: ["5432/tcp"],
            state: "exited",
            status: "exited",
            statusText: "Exited (0) 2 hours ago",
          }),
        ];
      }

      function dockerContainer(hostId, input) {
        const target = {
          containerId: input.id,
          containerName: input.name,
          hostId,
          kind: "dockerContainer",
          runtime: "docker",
        };
        return {
          capabilities: { files: true, serverInfo: true, terminal: true },
          hostId,
          id: input.id,
          image: input.image,
          name: input.name,
          ports: input.ports,
          runtime: "docker",
          shortId: input.id.slice(0, 12),
          state: input.state,
          status: input.status,
          statusText: input.statusText,
          target,
        };
      }

      function serverInfoSnapshot(request = {}) {
        return {
          architecture: "x86_64",
          capturedAt: "1782197600",
          cpuCount: 16,
          cpuCoreUsagePercents: [18, 22, 12, 31, 16, 14, 19, 27, 12, 18, 21, 13, 10, 15, 17, 24],
          cpuModel: "AMD EPYC 7B13",
          cpuUsagePercent: 18.6,
          diskAvailableBytes: 512 * 1024 * 1024 * 1024,
          diskMount: "/",
          diskTotalBytes: 1024 * 1024 * 1024 * 1024,
          diskUsedBytes: 512 * 1024 * 1024 * 1024,
          disks: [
            { availableBytes: 512 * 1024 * 1024 * 1024, filesystem: "/dev/nvme0n1p2", mount: "/", totalBytes: 1024 * 1024 * 1024 * 1024, usedBytes: 512 * 1024 * 1024 * 1024 },
            { availableBytes: 1800 * 1024 * 1024 * 1024, filesystem: "/dev/nvme1n1", mount: "/data", totalBytes: 2048 * 1024 * 1024 * 1024, usedBytes: 248 * 1024 * 1024 * 1024 },
          ],
          gpuProbeStatus: "nvidia_smi",
          gpus: [
            { driverVersion: "555.42", memoryTotalBytes: 24 * 1024 * 1024 * 1024, memoryUsedBytes: 8 * 1024 * 1024 * 1024, name: "NVIDIA RTX 4090", temperatureCelsius: 54, utilizationPercent: 36.5, vendor: "NVIDIA" },
            { driverVersion: "555.42", memoryTotalBytes: 24 * 1024 * 1024 * 1024, memoryUsedBytes: 5 * 1024 * 1024 * 1024, name: "NVIDIA RTX 4090", temperatureCelsius: 49, utilizationPercent: 22.1, vendor: "NVIDIA" },
          ],
          host: "10.23.42.18",
          hostId: request.hostId ?? "prod-api",
          hostName: "prod-api",
          hostname: "prod-api",
          kernel: "6.8.0-63-generic",
          loadAverage: [0.88, 1.12, 1.24],
          memoryAvailableBytes: 46 * 1024 * 1024 * 1024,
          memoryBuffersBytes: 2 * 1024 * 1024 * 1024,
          memoryCachedBytes: 18 * 1024 * 1024 * 1024,
          memoryTotalBytes: 64 * 1024 * 1024 * 1024,
          memoryUsedBytes: 28 * 1024 * 1024 * 1024,
          networkInterfaces: [
            { name: "eth0", rxBytes: 4312345678, txBytes: 2198765432 },
            { name: "tailscale0", rxBytes: 612345678, txBytes: 512345678 },
          ],
          networkRxBytes: 4924691356,
          networkTxBytes: 2711111110,
          os: "Ubuntu 24.04 LTS",
          port: 22,
          processCount: 248,
          runningProcessCount: 6,
          swapTotalBytes: 8 * 1024 * 1024 * 1024,
          swapUsedBytes: 512 * 1024 * 1024,
          topProcesses: [
            { cpuUsagePercent: 16.2, memoryBytes: 1800 * 1024 * 1024, memoryPercent: 2.8, name: "python", pid: 4210 },
            { cpuUsagePercent: 8.4, memoryBytes: 680 * 1024 * 1024, memoryPercent: 1.1, name: "node", pid: 1882 },
            { cpuUsagePercent: 6.1, memoryBytes: 240 * 1024 * 1024, memoryPercent: 0.4, name: "dockerd", pid: 812 },
          ],
          uptimeSeconds: 827_440,
          username: "deploy",
        };
      }

      function sftpListing(request = {}) {
        const path = request.path || "/srv/kerminal";
        return {
          entries: [
            { kind: "directory", modified: "1782193800", name: "config", path: path + "/config", permissions: "drwxr-xr-x", raw: "drwxr-xr-x config", size: 4096 },
            { kind: "directory", modified: "1782194100", name: "logs", path: path + "/logs", permissions: "drwxr-xr-x", raw: "drwxr-xr-x logs", size: 4096 },
            { kind: "directory", modified: "1782194300", name: "releases", path: path + "/releases", permissions: "drwxr-xr-x", raw: "drwxr-xr-x releases", size: 4096 },
            { kind: "file", modified: "1782195200", name: ".env", path: path + "/.env", permissions: "-rw-------", raw: "-rw------- .env", size: 128 },
            { kind: "file", modified: "1782196500", name: "deploy.log", path: path + "/deploy.log", permissions: "-rw-r--r--", raw: "-rw-r--r-- deploy.log", size: 73421 },
            { kind: "file", modified: "1782197000", name: "release-2026-06-23.tar.gz", path: path + "/release-2026-06-23.tar.gz", permissions: "-rw-r--r--", raw: "-rw-r--r-- release", size: 14821376 },
          ],
          hostId: request.hostId ?? "prod-api",
          parentPath: "/srv",
          path,
        };
      }

      function localListing(path) {
        const normalizedPath =
          typeof path === "string" && path.trim()
            ? path.trim()
            : "C:/Users/kong/Downloads";
        return {
          entries: [
            { hidden: false, kind: "directory", modified: "1782193000", name: "deploy-artifacts", path: normalizedPath + "/deploy-artifacts", raw: "directory deploy-artifacts", size: null },
            { hidden: false, kind: "file", modified: "1782193600", name: "kerminal-config.toml", path: normalizedPath + "/kerminal-config.toml", raw: "file kerminal-config.toml", size: 8420 },
            { hidden: false, kind: "file", modified: "1782193700", name: "release-notes.md", path: normalizedPath + "/release-notes.md", raw: "file release-notes.md", size: 19124 },
          ],
          parentPath: "C:/Users/kong",
          path: normalizedPath,
        };
      }

      function sftpTransfers(request = {}) {
        const now = Date.now();
        const viewScope = request?.viewScope ?? "sidebar:prod-api:tab-prod-api";
        return [
          { bytesTransferred: 9581363, cancelRequested: false, createdAt: now - 120000, direction: "download", hostId: "prod-api", id: "transfer-running", kind: "file", localPath: "C:/Users/kong/Downloads/release-2026-06-23.tar.gz", operation: "download", phase: "streaming", remotePath: "/srv/kerminal/release-2026-06-23.tar.gz", status: "running", totalBytes: 14821376, updatedAt: now - 1000, viewScope },
          { bytesTransferred: 73421, cancelRequested: false, createdAt: now - 240000, direction: "download", hostId: "prod-api", id: "transfer-done", kind: "file", localPath: "C:/Users/kong/Downloads/deploy.log", operation: "download", phase: "complete", remotePath: "/srv/kerminal/deploy.log", status: "succeeded", totalBytes: 73421, updatedAt: now - 120000, viewScope },
        ];
      }

      function commandHistory() {
        return [
          { command: "docker ps", createdAt: "1782197000", id: "history-1", source: "user", target: "ssh" },
          { command: "journalctl -u kerminal -n 80", createdAt: "1782196900", id: "history-2", source: "user", target: "ssh" },
        ];
      }

      function snippets() {
        return [
          { command: "journalctl -u kerminal -n 80", createdAt: "readme-capture", description: "读取服务最近日志", id: "snippet-logs", name: "最近日志", tags: ["ops"], updatedAt: "readme-capture" },
        ];
      }

      function workflows() {
        return [
          { createdAt: "readme-capture", description: "发布前检查", id: "workflow-release", name: "发布检查", steps: [], tags: ["release"], updatedAt: "readme-capture" },
        ];
      }

      function portForwards() {
        return [
          { bindHost: "127.0.0.1", bindPort: 18080, hostId: "prod-api", id: "port-api", kind: "local", name: "API tunnel", running: true, targetHost: "127.0.0.1", targetPort: 8080 },
        ];
      }

      function llmProviders() {
        return [
          {
            apiKeyConfigured: true,
            apiKeyCredentialRef: "credential://readme-capture",
            baseUrl: "https://api.openai.com/v1",
            contextStrategy: "currentTerminal",
            contextWindowTokens: 128000,
            createdAt: "readme-capture",
            enabled: true,
            httpProxy: null,
            id: "provider-openai",
            isDefault: true,
            kind: "openAiResponses",
            maxRetries: 2,
            model: "gpt-5",
            timeoutSeconds: 120,
            title: "OpenAI",
            updatedAt: "readme-capture",
          },
        ];
      }

      function readmeSettings() {
        return {
          appearance: {
            backgroundEnabled: false,
            backgroundFit: "cover",
            backgroundImagePath: "",
            backgroundOpacity: 40,
            interfaceLanguage: "zhCN",
            windowOpacity: 96,
          },
          interfaceDensity: "comfortable",
          sftp: {
            globalTransfers: 6,
            hostTransfers: 3,
            packetBytes: 262144,
            pipelineDepth: 16,
            timeoutSeconds: 30,
          },
          terminal: {
            autoReconnect: true,
            colorScheme: "kerminal",
            confirmCloseTab: false,
            cursorBlink: true,
            cursorStyle: "block",
            darkColorScheme: "kerminal",
            fontFamily: '"JetBrains Mono", "SF Mono", "Cascadia Code", Consolas, monospace',
            fontSize: 13,
            fontWeight: "normal",
            inlineSuggestion: {
              acceptKey: "rightArrow",
              auditRetentionDays: 30,
              enabled: true,
              feedbackRetentionDays: 365,
              productionHostPolicy: "restricted",
              providers: { ai: false, git: true, history: true, remoteCommand: true, remotePath: true, spec: true },
              remoteProbeEnabled: true,
            },
            lightColorScheme: "kerminal",
            lineHeight: 1.35,
            macOptionIsMeta: false,
            rightClickBehavior: "menu",
            scrollback: 5000,
            selectionCopy: false,
            showTabNumbers: false,
          },
          themeMode: "dark",
        };
      }

      function sanitizeArgs(value) {
        return JSON.parse(
          JSON.stringify(value, (_key, item) => {
            if (item && typeof item === "object" && "id" in item) {
              return { id: item.id };
            }
            return item;
          }),
        );
      }
    })();
  `;
}

async function clickSelector(client, selector) {
  await clickExpression(client, `document.querySelector(${JSON.stringify(selector)})`);
}

async function clickTextButtonContaining(client, text) {
  await clickExpression(
    client,
    `Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes(${JSON.stringify(text)}))`,
  );
}

async function clickExpression(client, expression) {
  const rectResult = await evaluate(
    client,
    `(() => {
      const element = ${expression};
      if (!element) throw new Error("Missing clickable element");
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      };
    })()`,
    { returnByValue: true },
  );
  const { x, y } = rectResult.result.value;
  await client.send("Input.dispatchMouseEvent", {
    button: "left",
    buttons: 1,
    clickCount: 1,
    type: "mousePressed",
    x,
    y,
  });
  await client.send("Input.dispatchMouseEvent", {
    button: "left",
    buttons: 0,
    clickCount: 1,
    type: "mouseReleased",
    x,
    y,
  });
}

async function pressKey(client, key) {
  await client.send("Input.dispatchKeyEvent", { key, type: "keyDown" });
  await client.send("Input.dispatchKeyEvent", { key, type: "keyUp" });
}

function findChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    path.join(
      process.env.PROGRAMFILES ?? "C:\\Program Files",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe",
    ),
    path.join(
      process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe",
    ),
  ].filter(Boolean);
  return candidates.find((candidate) => Boolean(candidate) && existsSync(candidate));
}

function requestJson(portNumber, pathname, method = "GET") {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        method,
        path: pathname,
        port: portNumber,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(`HTTP ${response.statusCode}: ${body}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

function waitForHttpOk(url, timeoutMs) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.request(
        {
          hostname: url.hostname,
          method: "GET",
          path: url.pathname,
          port: url.port,
        },
        (response) => {
          response.resume();
          if ((response.statusCode ?? 500) < 500) {
            resolve();
            return;
          }
          retry();
        },
      );
      request.on("error", retry);
      request.end();
    };
    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Timed out waiting for ${url.href}`));
        return;
      }
      setTimeout(attempt, 100);
    };
    attempt();
  });
}

async function waitForChrome(portNumber, processHandle) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Chrome exited with code ${processHandle.exitCode}`);
    }
    try {
      await requestJson(portNumber, "/json/version");
      return;
    } catch {
      await delay(100);
    }
  }
  throw new Error("Timed out waiting for Chrome DevTools");
}

async function waitForBrowserExpression(client, expression, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await evaluate(client, expression, { returnByValue: true });
    if (result.result?.value === true) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for browser expression: ${expression}`);
}

async function evaluate(client, expression, options = {}) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    ...options,
  });
  if (result.exceptionDetails) {
    const details = result.exceptionDetails;
    const message =
      details.exception?.description ??
      details.exception?.value ??
      details.text ??
      "Browser evaluation failed";
    throw new Error(String(message));
  }
  return result;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function terminateChrome(processHandle) {
  return new Promise((resolve) => {
    if (processHandle.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      processHandle.kill("SIGKILL");
      resolve();
    }, 2000);
    processHandle.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    processHandle.kill();
  });
}

class CdpClient {
  static connect(webSocketUrl) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(webSocketUrl);
      const client = new CdpClient(ws);
      ws.addEventListener("open", () => resolve(client), { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { reject, resolve });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws.close();
  }
}

await main();
