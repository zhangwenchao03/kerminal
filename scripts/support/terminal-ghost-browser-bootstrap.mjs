export function browserBootstrapScript() {
  const workspaceSession = {
    activeTabId: "tab-ssh-smoke",
    focusedPaneId: "pane-ssh-smoke",
    selectedMachineId: "prod-api",
    sidebarMachines: [],
    terminalPanes: [
      {
        currentCwd: "/srv/app",
        cwd: "/srv/app",
        id: "pane-ssh-smoke",
        lines: [],
        machineId: "prod-api",
        mode: "ssh",
        prompt: "deploy@prod-api:/srv/app$",
        remoteHostId: "prod-api",
        remoteHostProduction: false,
        status: "online",
        target: { hostId: "prod-api", kind: "ssh" },
        title: "prod-api",
      },
    ],
    terminalTabs: [
      {
        id: "tab-ssh-smoke",
        layout: { paneId: "pane-ssh-smoke", type: "pane" },
        machineId: "prod-api",
        title: "prod-api",
      },
    ],
    version: 1,
  };
  return `
    (() => {
      window.__kerminalAppSmokeErrors = [];
      const recordSmokeError = (kind, value) => {
        const message =
          value?.reason?.stack ??
          value?.reason?.message ??
          value?.error?.stack ??
          value?.error?.message ??
          value?.message ??
          String(value);
        window.__kerminalAppSmokeErrors.push({ kind, message });
      };
      window.addEventListener("error", (event) =>
        recordSmokeError("error", event),
      );
      window.addEventListener("unhandledrejection", (event) =>
        recordSmokeError("unhandledrejection", event),
      );
      localStorage.setItem("kerminal.workspace.session.v1", ${JSON.stringify(
        JSON.stringify(workspaceSession),
      )});
      const callbacks = new Map();
      const channelIndexes = new Map();
      const sessions = new Map();
      let nextCallbackId = 1;
      let nextSessionId = 1;
      window.isTauri = true;
      window.__kerminalAppSmokeState = {
        auditRequests: [],
        feedbackRequests: [],
        invocations: [],
        performanceSamples: [],
        refreshRequests: [],
        sessions: [],
        suggestionRequests: [],
        writes: [],
      };
      let activePerformanceSample = null;
      window.__beginKerminalGhostLatencySample = (phase) => {
        activePerformanceSample = {
          phase,
          startedAt: performance.now(),
        };
        return true;
      };
      const captureGhostLatency = () => {
        if (!activePerformanceSample) {
          return;
        }
        const ghost = document.querySelector(
          '[aria-label="终端命令灰色提示"]',
        );
        if (
          !ghost ||
          ghost.textContent !== "nalctl" ||
          ghost.getAttribute("data-provider") !== "spec"
        ) {
          return;
        }
        const rect = ghost.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          return;
        }
        window.__kerminalAppSmokeState.performanceSamples.push({
          durationMs: performance.now() - activePerformanceSample.startedAt,
          phase: activePerformanceSample.phase,
        });
        activePerformanceSample = null;
      };
      new MutationObserver(captureGhostLatency).observe(document, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener() {},
      };
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
            if (once) {
              callbacks.delete(id);
            }
          });
          return id;
        },
        unregisterCallback(id) {
          callbacks.delete(id);
        },
        async invoke(cmd, args = {}) {
          window.__kerminalAppSmokeState.invocations.push({
            args: sanitizeArgs(args),
            cmd,
          });
          switch (cmd) {
            case "plugin:event|listen":
              return "event-smoke-1";
            case "plugin:event|unlisten":
              return null;
            case "plugin:window|is_fullscreen":
            case "plugin:window|is_maximized":
              return false;
            case "workspace_session_load":
              return ${JSON.stringify(workspaceSession)};
            case "workspace_session_save":
              return null;
            case "snippet_list":
            case "workflow_list":
              return [];
            case "profile_list":
              return [
                {
                  args: [],
                  createdAt: "app-smoke",
                  env: {},
                  id: "profile-app-smoke",
                  isDefault: true,
                  name: "App smoke shell",
                  shell: "ssh",
                  sortOrder: 10,
                  updatedAt: "app-smoke",
                },
              ];
            case "remote_host_tree":
              return [
                {
                  createdAt: "app-smoke",
                  hosts: [
                    {
                      authType: "password",
                      createdAt: "app-smoke",
                      groupId: "smoke-group",
                      host: "127.0.0.1",
                      id: "prod-api",
                      name: "prod-api",
                      port: 22,
                      production: false,
                      sortOrder: 10,
                      tags: ["smoke"],
                      updatedAt: "app-smoke",
                      username: "deploy",
                    },
                  ],
                  id: "smoke-group",
                  name: "Smoke",
                  sortOrder: 10,
                  updatedAt: "app-smoke",
                },
              ];
            case "external_launch_take_pending":
              return [];
            case "settings_get":
              return appSmokeSettings();
            case "settings_update":
              return args.settings;
            case "ssh_create_session": {
              const id = "ssh-app-smoke-" + nextSessionId++;
              const channelId = args.output?.id;
              sessions.set(id, { channelId });
              window.__kerminalAppSmokeState.sessions.push({
                channelId,
                id,
                request: args.request,
              });
              queueMicrotask(() => {
                emitTerminal(channelId, {
                  data: "deploy@prod-api:/srv/app$ ",
                  kind: "data",
                  sessionId: id,
                });
              });
              return {
                cols: args.request?.cols ?? 80,
                cwd: "/srv/app",
                id,
                rows: args.request?.rows ?? 24,
                shell: "ssh",
                status: "running",
              };
            }
            case "terminal_resize":
              return null;
            case "terminal_reap_orphan_sessions":
              return { elapsedMs: 0, reapedCount: 0, sessionIds: [] };
            case "terminal_log_state":
              return { active: false, bytesWritten: 0 };
            case "terminal_close":
              sessions.delete(args.sessionId);
              return null;
            case "terminal_write": {
              window.__kerminalAppSmokeState.writes.push(args.data);
              const session = sessions.get(args.sessionId);
              emitTerminal(session?.channelId, {
                data: args.data,
                kind: "data",
                sessionId: args.sessionId,
              });
              return null;
            }
            case "command_suggestion_list":
              window.__kerminalAppSmokeState.suggestionRequests.push(args.request);
              return appSmokeSuggestions(args.request);
            case "command_suggestion_record_feedback":
              window.__kerminalAppSmokeState.feedbackRequests.push(args.request);
              return { recorded: true, skipReason: undefined };
            case "command_suggestion_record_audit_event":
              window.__kerminalAppSmokeState.auditRequests.push(args.request);
              return { eventId: "audit-app-smoke", recorded: true };
            case "command_suggestion_refresh_remote_commands":
            case "command_suggestion_refresh_remote_history":
            case "command_suggestion_refresh_remote_paths":
            case "command_suggestion_refresh_git_refs":
              window.__kerminalAppSmokeState.refreshRequests.push({ args, cmd });
              return refreshResult(cmd, args.request);
            case "command_history_record":
              return { entry: null, recorded: true, skipReason: null };
            default:
              throw new Error("Unexpected app smoke invoke: " + cmd);
          }
        },
      };

      function emitTerminal(channelId, message) {
        if (!channelId || !callbacks.has(channelId)) {
          return;
        }
        const index = channelIndexes.get(channelId) ?? 0;
        channelIndexes.set(channelId, index + 1);
        callbacks.get(channelId)({ index, message });
      }

      function appSmokeSettings() {
        return {
          interfaceDensity: "comfortable",
          terminal: {
            autoReconnect: false,
            colorScheme: "kerminal",
            confirmCloseTab: false,
            cursorBlink: true,
            cursorStyle: "block",
            darkColorScheme: "kerminal",
            fontFamily:
              '"JetBrains Mono", "SF Mono", "Cascadia Code", Consolas, monospace',
            fontSize: 13,
            fontWeight: "normal",
            inlineSuggestion: {
              acceptKey: "rightArrow",
              auditRetentionDays: 30,
              enabled: true,
              feedbackRetentionDays: 365,
              productionHostPolicy: "restricted",
              providers: {
                git: true,
                history: true,
                remoteCommand: true,
                remotePath: true,
                spec: true,
              },
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

      function appSmokeSuggestions(request) {
        const input = String(request?.input ?? "");
        const cursor = Number(request?.cursor ?? input.length);
        const prefix = Array.from(input).slice(0, cursor).join("");
        const typedToken = "jour";
        const command = "journalctl";
        if (
          request?.target !== "ssh" ||
          request?.remoteHostId !== "prod-api" ||
          !request?.providers?.includes("spec") ||
          !prefix.endsWith(typedToken)
        ) {
          return [];
        }
        return [
          {
            description: "CLI spec 命令，来自 app smoke fake IPC",
            displayText: command,
            id: "app-smoke-spec-journalctl",
            metadata: { source: "appSmoke" },
            provider: "spec",
            replacementRange: {
              end: cursor,
              start: Math.max(0, cursor - typedToken.length),
            },
            replacementText: command,
            score: 0.98,
            sensitivity: "normal",
            sourceId: "app-smoke-spec",
            suffix: command.slice(typedToken.length),
          },
        ];
      }

      function refreshResult(cmd, request) {
        const now = Date.now();
        if (cmd.endsWith("remote_paths")) {
          return {
            cachedAtUnixMs: now,
            entryCount: 0,
            hostId: request.hostId,
            path: request.path,
            ttlSeconds: request.ttlSeconds ?? 30,
          };
        }
        if (cmd.endsWith("git_refs")) {
          return {
            cachedAtUnixMs: now,
            cwd: request.cwd,
            entryCount: 0,
            hostId: request.hostId,
            repoRoot: null,
            ttlSeconds: request.ttlSeconds ?? 60,
          };
        }
        return {
          cachedAtUnixMs: now,
          commandCount: 0,
          hostId: request.hostId,
          ttlSeconds: request.ttlSeconds ?? 300,
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
