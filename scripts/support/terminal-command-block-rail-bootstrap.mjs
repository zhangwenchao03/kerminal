export function browserBootstrapScript() {
  const workspaceSession = {
    activeTabId: "tab-ssh-rail-smoke",
    focusedPaneId: "pane-ssh-rail-smoke",
    removedSidebarMachineIds: [],
    selectedMachineId: "prod-api",
    sidebarMachines: [],
    terminalPanes: [
      {
        currentCwd: "/home/ubuntu",
        cwd: "/home/ubuntu",
        id: "pane-ssh-rail-smoke",
        lines: [],
        machineId: "prod-api",
        mode: "ssh",
        outputHistory: "",
        prompt: "ubuntu@ubuntu:~$",
        remoteHostId: "prod-api",
        remoteHostProduction: false,
        status: "online",
        target: { hostId: "prod-api", kind: "ssh" },
        title: "prod-api",
      },
    ],
    terminalTabs: [
      {
        id: "tab-ssh-rail-smoke",
        layout: { paneId: "pane-ssh-rail-smoke", type: "pane" },
        machineId: "prod-api",
        title: "prod-api",
      },
    ],
    version: 1,
  };
  return `
    (() => {
      localStorage.setItem(
        "kerminal.workspace.session.v1",
        ${JSON.stringify(JSON.stringify({ ...workspaceSession, version: 1 }))},
      );
      const callbacks = new Map();
      const channelIndexes = new Map();
      const sessions = new Map();
      let nextCallbackId = 1;
      let nextSessionId = 1;
      window.isTauri = true;
      window.__kerminalRailSmokeState = {
        consoleMessages: [],
        errors: [],
        invocations: [],
        sessions: [],
        writes: [],
      };
      const captureConsole = (level) => {
        const original = console[level]?.bind(console);
        console[level] = (...items) => {
          window.__kerminalRailSmokeState.consoleMessages.push({
            level,
            message: items.map((item) => String(item)).join(" "),
          });
          original?.(...items);
        };
      };
      captureConsole("error");
      captureConsole("warn");
      window.addEventListener("error", (event) => {
        window.__kerminalRailSmokeState.errors.push(
          event.error?.stack ?? event.message ?? "window-error",
        );
      });
      window.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason;
        window.__kerminalRailSmokeState.errors.push(
          reason?.stack ?? reason?.message ?? String(reason),
        );
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
          window.__kerminalRailSmokeState.invocations.push({
            cmd,
            args: sanitizeArgs(args),
          });
          switch (cmd) {
            case "plugin:event|listen":
              return "rail-smoke-event-listener";
            case "plugin:event|unlisten":
              return null;
            case "profile_list":
              return [
                {
                  args: [],
                  createdAt: "rail-smoke",
                  env: {},
                  id: "profile-rail-smoke",
                  isDefault: true,
                  name: "Rail smoke shell",
                  shell: "ssh",
                  sortOrder: 10,
                  updatedAt: "rail-smoke",
                },
              ];
            case "remote_host_tree":
              return [
                {
                  createdAt: "rail-smoke",
                  hosts: [
                    {
                      authType: "password",
                      createdAt: "rail-smoke",
                      groupId: "rail-smoke-group",
                      host: "127.0.0.1",
                      id: "prod-api",
                      name: "prod-api",
                      port: 22,
                      production: false,
                      sortOrder: 10,
                      tags: ["smoke"],
                      updatedAt: "rail-smoke",
                      username: "ubuntu",
                    },
                  ],
                  id: "rail-smoke-group",
                  name: "Smoke",
                  sortOrder: 10,
                  updatedAt: "rail-smoke",
                },
              ];
            case "settings_get":
              return railSmokeSettings();
            case "settings_update":
              return args.settings;
            case "ssh_create_session": {
              const id = "ssh-rail-smoke-" + nextSessionId++;
              const channelId = args.output?.id;
              sessions.set(id, { channelId });
              window.__kerminalRailSmokeState.sessions.push({
                channelId,
                id,
                request: args.request,
              });
              queueMicrotask(() => {
                emitTerminal(channelId, {
                  data:
                    "*** System restart required ***\\r\\n" +
                    "Last login: Sun Jun 21 07:02:58 2026 from 172.16.10.123\\r\\n" +
                    "ubuntu@ubuntu:~$ ",
                  kind: "data",
                  sessionId: id,
                });
              });
              return {
                cols: args.request?.cols ?? 80,
                cwd: "/home/ubuntu",
                id,
                rows: args.request?.rows ?? 24,
                shell: "ssh",
                status: "running",
              };
            }
            case "terminal_resize":
              return null;
            case "terminal_log_state":
              return { active: false, bytesWritten: 0 };
            case "terminal_close":
              sessions.delete(args.sessionId);
              return null;
            case "terminal_write": {
              window.__kerminalRailSmokeState.writes.push(args.data);
              const session = sessions.get(args.sessionId);
              const data = args.data === "\\r" ? "\\r\\nubuntu@ubuntu:~$ " : args.data;
              emitTerminal(session?.channelId, {
                data,
                kind: "data",
                sessionId: args.sessionId,
              });
              return null;
            }
            case "command_history_record":
              return { entry: null, recorded: true, skipReason: null };
            case "command_suggestion_list":
              return [];
            case "command_suggestion_record_feedback":
              return { recorded: true, skipReason: undefined };
            case "command_suggestion_record_audit_event":
              return { eventId: "rail-smoke-audit", recorded: true };
            case "command_suggestion_refresh_remote_commands":
            case "command_suggestion_refresh_remote_history":
            case "command_suggestion_refresh_remote_paths":
            case "command_suggestion_refresh_git_refs":
              return {};
            default:
              throw new Error("Unexpected rail smoke invoke: " + cmd);
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

      function railSmokeSettings() {
        return {
          appearance: {
            backgroundEnabled: false,
            backgroundFit: "cover",
            backgroundImagePath: "",
            backgroundOpacity: 0.16,
            interfaceLanguage: "zh-CN",
          },
          interfaceDensity: "comfortable",
          keybindings: [],
          sftp: {
            confirmBeforeOverwrite: true,
            defaultLocalDirectory: "",
            doubleClickAction: "open",
            transferConcurrency: 2,
          },
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
              enabled: false,
              feedbackRetentionDays: 365,
              productionHostPolicy: "restricted",
              providers: {
                git: false,
                history: false,
                remoteCommand: false,
                remotePath: false,
                spec: false,
              },
              remoteProbeEnabled: false,
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
