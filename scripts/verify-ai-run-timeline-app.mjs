#!/usr/bin/env node
/**
 * Headless Chrome smoke for the real AI agent run timeline UI.
 *
 * @author kongweiguang
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "vite";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArgs(process.argv.slice(2));
const themeLabel =
  options.theme === "system"
    ? `system-${options.systemPrefers}`
    : options.theme;
const outputDir = options.outputDir;
const outputJson = path.join(outputDir, `ai-run-timeline-${themeLabel}.json`);
const outputPng = path.join(outputDir, `ai-run-timeline-${themeLabel}.png`);
const chromePath = findChromePath();
const chromePort = 9_940 + Math.floor(Math.random() * 300);
const vitePort = 10_640 + Math.floor(Math.random() * 300);
const userDataDir = path.join(
  tmpdir(),
  `kerminal-ai-run-timeline-${Date.now()}`,
);

if (!chromePath) {
  console.error("Chrome executable not found. Set CHROME_PATH to run this check.");
  process.exit(1);
}

async function main() {
  const vite = await createServer({
    configFile: path.join(repoRoot, "vite.config.ts"),
    root: repoRoot,
    server: {
      host: "127.0.0.1",
      port: vitePort,
      strictPort: true,
    },
  });
  await vite.listen();

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
    {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    },
  );

  let stderr = "";
  chrome.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  let client;
  try {
    await waitForHttpOk(vitePort, "/", 30_000);
    await waitForChrome(chromePort, chrome);
    const target = await requestJson(chromePort, "/json/new?about:blank", "PUT");
    client = await CdpClient.connect(target.webSocketDebuggerUrl);
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      deviceScaleFactor: 1,
      height: 860,
      mobile: false,
      width: 1280,
    });
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: browserBootstrapScript(options),
    });
    await client.send("Page.navigate", {
      url: `http://127.0.0.1:${vitePort}/`,
    });

    await waitForBrowserExpression(
      client,
      `document.querySelector('[aria-label="打开 Kerminal Agent"]') !== null`,
      180_000,
    );
    await clickSelector(client, `[aria-label="打开 Kerminal Agent"]`);
    await waitForBrowserExpression(
      client,
      `document.querySelector('[aria-label="AI 对话输入"]') !== null`,
      20_000,
    );
    await setInputValue(
      client,
      `[aria-label="AI 对话输入"]`,
      "把 172.16.40.104 加到 bwy 分组并连接",
    );
    await clickSelector(client, `[aria-label="发送 AI 消息"]`);
    await waitForBrowserExpression(
      client,
      `document.querySelector('[aria-label="Agent run 状态"]') !== null`,
      30_000,
    );
    await waitForBrowserExpression(
      client,
      `Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.trim() === "批准")`,
      20_000,
    );
    await clickTextButton(client, "批准");
    await waitForBrowserExpression(
      client,
      `document.body.innerText.includes("已经完成 run timeline 验证。")`,
      30_000,
    );
    await delay(250);

    const snapshot = await aiRunTimelineSnapshot(client);
    const screenshot = await client.send("Page.captureScreenshot", {
      captureBeyondViewport: true,
      format: "png",
      fromSurface: true,
    });
    const failures = validateSnapshot(snapshot);
    const result = {
      appUrl: `http://127.0.0.1:${vitePort}/`,
      artifacts: {
        json: outputJson,
        screenshot: outputPng,
      },
      failures,
      pass: failures.length === 0,
      snapshot,
      theme: {
        requested: options.theme,
        systemPrefers: options.systemPrefers,
      },
    };

    mkdirSync(outputDir, { recursive: true });
    writeFileSync(outputJson, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    writeFileSync(outputPng, Buffer.from(screenshot.data, "base64"));
    console.log(JSON.stringify(result, null, 2));
    if (!result.pass) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
    process.exitCode = 1;
  } finally {
    client?.close();
    await terminateChrome(chrome);
    await vite.close();
    rmSync(userDataDir, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 100,
    });
  }
}

async function aiRunTimelineSnapshot(client) {
  const result = await evaluate(
    client,
    `(() => {
      const timeline = document.querySelector('[aria-label="Agent run 状态"]');
      const bodyText = document.body?.innerText ?? "";
      const buttons = Array.from(document.querySelectorAll("button"))
        .map((button) => button.textContent?.trim() ?? "")
        .filter(Boolean);
      return {
        bodyText: bodyText.slice(0, 6000),
        errors: window.__kerminalAiRunSmokeState?.errors ?? [],
        finalVisible: bodyText.includes("已经完成 run timeline 验证。"),
        invocations: window.__kerminalAiRunSmokeState?.invocations ?? [],
        pendingApproved: window.__kerminalAiRunSmokeState?.pendingApproved ?? false,
        resumeCalled: window.__kerminalAiRunSmokeState?.resumeCalled ?? false,
        themeClass: document.documentElement.className,
        themeData: document.documentElement.getAttribute("data-theme"),
        timelineRect: rect(timeline),
        timelineText: timeline?.textContent ?? "",
        visibleButtons: buttons,
      };

      function rect(element) {
        if (!element) return null;
        const value = element.getBoundingClientRect();
        return {
          bottom: Number(value.bottom.toFixed(2)),
          height: Number(value.height.toFixed(2)),
          left: Number(value.left.toFixed(2)),
          right: Number(value.right.toFixed(2)),
          top: Number(value.top.toFixed(2)),
          width: Number(value.width.toFixed(2)),
        };
      }
    })()`,
    { returnByValue: true },
  );
  return result.result?.value;
}

function validateSnapshot(snapshot) {
  const failures = [];
  if (snapshot?.errors?.length) {
    failures.push("browser-errors");
  }
  if (!snapshot?.timelineRect || snapshot.timelineRect.width < 240) {
    failures.push("missing-agent-run-timeline");
  }
  if (
    !snapshot?.timelineText?.includes("completed") &&
    !snapshot?.timelineText?.includes("已完成")
  ) {
    failures.push("timeline-did-not-reach-completed");
  }
  if (!snapshot?.timelineText?.includes("ssh.ensure_connected")) {
    failures.push("timeline-missing-tool-step");
  }
  if (!snapshot?.finalVisible) {
    failures.push("missing-final-message");
  }
  if (!snapshot?.pendingApproved || !snapshot?.resumeCalled) {
    failures.push("approval-resume-flow-not-exercised");
  }
  return failures;
}

async function setInputValue(client, selector, value) {
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) {
        throw new Error("Missing input: " + ${JSON.stringify(selector)});
      }
      const prototype = Object.getPrototypeOf(input);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      descriptor?.set?.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: ${JSON.stringify(value)},
        inputType: "insertText",
      }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    })()`,
  );
}

async function clickSelector(client, selector) {
  await clickExpression(
    client,
    `document.querySelector(${JSON.stringify(selector)})`,
  );
}

async function clickTextButton(client, text) {
  await clickExpression(
    client,
    `Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === ${JSON.stringify(text)})`,
  );
}

async function clickExpression(client, expression) {
  const rectResult = await evaluate(
    client,
    `(() => {
      const element = ${expression};
      if (!element) {
        throw new Error("Missing clickable element");
      }
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

function browserBootstrapScript({ systemPrefers, theme }) {
  const workspaceSession = {
    activeTabId: "tab-ai-run-smoke",
    focusedPaneId: "pane-ai-run-smoke",
    removedSidebarMachineIds: [],
    selectedMachineId: "prod-api",
    sidebarMachines: [],
    terminalPanes: [
      {
        currentCwd: "/home/root",
        cwd: "/home/root",
        id: "pane-ai-run-smoke",
        lines: [],
        machineId: "prod-api",
        mode: "ssh",
        outputHistory: "",
        prompt: "root@prod-api:~#",
        remoteHostId: "prod-api",
        remoteHostProduction: false,
        status: "online",
        target: { hostId: "prod-api", kind: "ssh" },
        title: "prod-api",
      },
    ],
    terminalTabs: [
      {
        id: "tab-ai-run-smoke",
        layout: { paneId: "pane-ai-run-smoke", type: "pane" },
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
      let nextMessageId = 1;
      let nextSessionId = 1;
      const pending = aiRunPendingInvocation();
      window.isTauri = true;
      window.matchMedia = (query) => ({
        addEventListener() {},
        addListener() {},
        dispatchEvent() { return false; },
        matches: query.includes("prefers-color-scheme: dark")
          ? ${JSON.stringify(systemPrefers === "dark")}
          : false,
        media: query,
        onchange: null,
        removeEventListener() {},
        removeListener() {},
      });
      window.__kerminalAiRunSmokeState = {
        consoleMessages: [],
        errors: [],
        invocations: [],
        pendingApproved: false,
        resumeCalled: false,
        writes: [],
      };
      const captureConsole = (level) => {
        const original = console[level]?.bind(console);
        console[level] = (...items) => {
          window.__kerminalAiRunSmokeState.consoleMessages.push({
            level,
            message: items.map((item) => String(item)).join(" "),
          });
          original?.(...items);
        };
      };
      captureConsole("error");
      captureConsole("warn");
      window.addEventListener("error", (event) => {
        window.__kerminalAiRunSmokeState.errors.push(
          event.error?.stack ?? event.message ?? "window-error",
        );
      });
      window.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason;
        window.__kerminalAiRunSmokeState.errors.push(
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
          window.__kerminalAiRunSmokeState.invocations.push({
            cmd,
            args: sanitizeArgs(args),
          });
          switch (cmd) {
            case "plugin:event|listen":
              return "ai-run-smoke-event-listener";
            case "plugin:event|unlisten":
              return null;
            case "profile_list":
              return [{
                args: [],
                createdAt: "ai-run-smoke",
                env: {},
                id: "profile-ai-run-smoke",
                isDefault: true,
                name: "AI smoke shell",
                shell: "ssh",
                sortOrder: 10,
                updatedAt: "ai-run-smoke",
              }];
            case "remote_host_tree":
              return [{
                createdAt: "ai-run-smoke",
                hosts: [{
                  authType: "password",
                  createdAt: "ai-run-smoke",
                  groupId: "group-bwy",
                  host: "172.16.40.104",
                  id: "prod-api",
                  name: "prod-api",
                  port: 22,
                  production: false,
                  sortOrder: 10,
                  tags: ["bwy"],
                  updatedAt: "ai-run-smoke",
                  username: "root",
                }],
                id: "group-bwy",
                name: "bwy",
                sortOrder: 10,
                updatedAt: "ai-run-smoke",
              }];
            case "settings_get":
              return aiRunSmokeSettings();
            case "settings_update":
              return args.settings;
            case "llm_provider_list":
              return [{
                apiKeyConfigured: true,
                apiKeyCredentialRef: "credential://openai-smoke",
                baseUrl: "https://api.openai.com/v1",
                contextStrategy: "currentTerminal",
                contextWindowTokens: 128000,
                createdAt: "ai-run-smoke",
                enabled: true,
                httpProxy: null,
                id: "provider-openai-smoke",
                isDefault: true,
                kind: "openAiResponses",
                maxRetries: 2,
                model: "gpt-5.5",
                modelList: ["gpt-5.5"],
                name: "OpenAI Smoke",
                reasoningEffort: "modelDefault",
                temperature: 0.2,
                updatedAt: "ai-run-smoke",
                userAgent: null,
              }];
            case "ai_tool_audit_list":
            case "ai_tool_pending_list":
              return [];
            case "ai_context_snapshot_create":
              return {
                applicationContextJson: args.request?.applicationContextJson ?? null,
                attachmentRefsJson: args.request?.attachmentRefsJson ?? "[]",
                conversationId: args.request?.conversationId ?? "conversation-ai-run-smoke",
                createdAt: Date.now(),
                generatedAt: Date.now(),
                id: "ctx-ai-run-smoke",
                messageId: null,
                policyJson: args.request?.policyJson ?? "{}",
                routeMode: args.request?.routeMode ?? null,
                scopeKind: args.request?.scopeKind ?? "lockedHost",
                scopeRefJson: args.request?.scopeRefJson ?? "{}",
                targetRefJson: args.request?.targetRefJson ?? null,
                terminalContextJson: args.request?.terminalContextJson ?? null,
              };
            case "ai_conversation_slot_get":
              return null;
            case "ai_conversation_create":
              return storedConversation(args.request?.title ?? "AI run smoke");
            case "ai_conversation_get":
              return storedConversation("AI run smoke");
            case "ai_conversation_slot_set_active":
              return {
                activeConversationId: args.request?.activeConversationId ?? "conversation-ai-run-smoke",
                routeMode: args.request?.routeMode ?? "followWorkspaceTarget",
                slotKey: args.request?.slotKey ?? "ai-run-smoke",
                targetRefJson: args.request?.targetRefJson ?? "{}",
                updatedAt: Date.now(),
              };
            case "ai_conversation_message_append":
              return {
                attachmentIds: [],
                content: args.request?.content ?? "",
                contextSnapshotId: args.request?.contextSnapshotId ?? null,
                conversationId: args.request?.conversationId ?? "conversation-ai-run-smoke",
                createdAt: Date.now(),
                id: "message-ai-run-smoke-" + nextMessageId++,
                metadataJson: args.request?.metadataJson ?? null,
                model: args.request?.model ?? null,
                providerId: args.request?.providerId ?? null,
                role: args.request?.role ?? "assistant",
                status: args.request?.status ?? "complete",
                updatedAt: Date.now(),
              };
            case "ai_terminal_context_snapshot":
              return {
                generatedAt: String(Math.floor(Date.now() / 1000)),
                output: {
                  capturedBytes: 24,
                  data: "root@prod-api:~# uptime",
                  maxBytes: args.request?.maxOutputBytes ?? 12288,
                  truncated: false,
                },
                policy: {
                  includesFullHistory: false,
                  includesRecentOutput: true,
                  maxOutputBytes: args.request?.maxOutputBytes ?? 12288,
                  mode: "currentTerminal",
                  secretRedaction: true,
                },
                redacted: false,
                session: {
                  cols: 80,
                  cwd: "/home/root",
                  id: args.request?.sessionId ?? "ssh-ai-run-smoke",
                  rows: 24,
                  shell: "ssh",
                  status: "running",
                },
                source: args.request ?? {},
              };
            case "ai_chat":
              return {
                commandExecutionVisibility: "background",
                message: "我会用 agent run 添加主机并在审批后继续。",
                model: "gpt-5.5",
                pendingInvocations: [pending],
                providerId: "provider-openai-smoke",
                visionUsage: null,
              };
            case "ai_agent_run_get":
              return waitingApprovalSnapshot();
            case "ai_tool_confirm":
              window.__kerminalAiRunSmokeState.pendingApproved =
                args.request?.approved === true;
              return {
                argumentsSummary: pending.argumentsSummary,
                auditContext: args.request?.auditContext ?? null,
                completedAt: String(Math.floor(Date.now() / 1000)),
                confirmation: pending.confirmation,
                createdAt: pending.createdAt,
                error: null,
                id: "audit-ai-run-smoke",
                invocationId: args.request?.invocationId ?? pending.id,
                observationJson: {
                  hostId: "prod-api",
                  status: "connected",
                },
                resultSummary: "SSH 连接已建立。",
                risk: pending.risk,
                riskSummary: pending.riskSummary,
                status: args.request?.approved ? "succeeded" : "rejected",
                toolId: pending.toolId,
                toolTitle: pending.toolTitle,
              };
            case "ai_agent_run_resume":
              window.__kerminalAiRunSmokeState.resumeCalled = true;
              return {
                finalMessage: "已经完成 run timeline 验证。",
                lastObservation: {
                  hostId: "prod-api",
                  status: "connected",
                },
                pendingInvocation: null,
                snapshot: completedSnapshot(),
              };
            case "ssh_create_session": {
              const id = "ssh-ai-run-smoke-" + nextSessionId++;
              const channelId = args.output?.id;
              sessions.set(id, { channelId });
              queueMicrotask(() => {
                emitTerminal(channelId, {
                  data: "root@prod-api:~# ",
                  kind: "data",
                  sessionId: id,
                });
              });
              return {
                cols: args.request?.cols ?? 80,
                cwd: "/home/root",
                id,
                rows: args.request?.rows ?? 24,
                shell: "ssh",
                status: "running",
              };
            }
            case "terminal_resize":
            case "terminal_log_state":
            case "terminal_close":
            case "command_suggestion_record_feedback":
            case "command_suggestion_record_audit_event":
            case "command_suggestion_refresh_remote_commands":
            case "command_suggestion_refresh_remote_history":
            case "command_suggestion_refresh_remote_paths":
            case "command_suggestion_refresh_git_refs":
              return {};
            case "terminal_write":
              window.__kerminalAiRunSmokeState.writes.push(args.data);
              return null;
            case "command_history_record":
              return { entry: null, recorded: true, skipReason: null };
            case "command_suggestion_list":
              return [];
            default:
              throw new Error("Unexpected AI run smoke invoke: " + cmd);
          }
        },
      };

      function storedConversation(title) {
        return {
          attachments: [],
          createdAt: Date.now(),
          hostId: "prod-api",
          id: "conversation-ai-run-smoke",
          messages: [],
          paneId: "pane-ai-run-smoke",
          scopeKind: "lockedHost",
          scopeRefJson: JSON.stringify({ hostId: "prod-api" }),
          tabId: "tab-ai-run-smoke",
          targetKey: "ssh:prod-api",
          title,
          updatedAt: Date.now(),
        };
      }

      function aiRunPendingInvocation() {
        return {
          argumentsSummary: "host=172.16.40.104, username=root, group=bwy",
          audit: "summary",
          clientAction: null,
          confirmation: "always",
          conversationId: "conversation-ai-run-smoke",
          conversationSlotJson: JSON.stringify({ scopeKind: "lockedHost", targetKey: "ssh:prod-api" }),
          createdAt: String(Math.floor(Date.now() / 1000)),
          id: "pending-ai-run-smoke",
          reason: "需要确认 SSH 连接写入配置。",
          requestedBy: "agent-run",
          requiresConfirmation: true,
          risk: "remote",
          riskSummary: null,
          runId: "run-ai-smoke",
          status: "pending",
          stepId: "step-tool-1",
          toolId: "ssh.ensure_connected",
          toolTitle: "确保 SSH 已连接",
        };
      }

      function waitingApprovalSnapshot() {
        return {
          run: runRecord("waitingApproval", 2),
          steps: [
            modelStep("step-model-1", "已解析 bwy 分组和 172.16.40.104。"),
            {
              createdAt: Date.now() - 1000,
              id: "step-tool-1",
              inputJson: { groupName: "bwy", host: "172.16.40.104", username: "root" },
              kind: "toolCall",
              observationJson: null,
              runId: "run-ai-smoke",
              status: "waitingApproval",
              summary: "ssh.ensure_connected 等待批准",
              toolId: "ssh.ensure_connected",
              updatedAt: Date.now() - 1000,
            },
          ],
        };
      }

      function completedSnapshot() {
        return {
          run: runRecord("completed", 4),
          steps: [
            modelStep("step-model-1", "已解析 bwy 分组和 172.16.40.104。"),
            {
              createdAt: Date.now() - 3000,
              id: "step-tool-1",
              inputJson: { groupName: "bwy", host: "172.16.40.104", username: "root" },
              kind: "toolCall",
              observationJson: null,
              runId: "run-ai-smoke",
              status: "succeeded",
              summary: "ssh.ensure_connected 已批准执行",
              toolId: "ssh.ensure_connected",
              updatedAt: Date.now() - 2000,
            },
            {
              createdAt: Date.now() - 2000,
              id: "step-observation-1",
              inputJson: null,
              kind: "observation",
              observationJson: { hostId: "prod-api", status: "connected" },
              runId: "run-ai-smoke",
              status: "succeeded",
              summary: "SSH 连接已建立。",
              toolId: "ssh.ensure_connected",
              updatedAt: Date.now() - 2000,
            },
            {
              createdAt: Date.now() - 1000,
              id: "step-final-1",
              inputJson: null,
              kind: "final",
              observationJson: null,
              runId: "run-ai-smoke",
              status: "succeeded",
              summary: "已经完成 run timeline 验证。",
              toolId: null,
              updatedAt: Date.now() - 1000,
            },
          ],
        };
      }

      function modelStep(id, summary) {
        return {
          createdAt: Date.now() - 4000,
          id,
          inputJson: null,
          kind: "model",
          observationJson: null,
          runId: "run-ai-smoke",
          status: "succeeded",
          summary,
          toolId: null,
          updatedAt: Date.now() - 4000,
        };
      }

      function runRecord(status, iteration) {
        return {
          conversationId: "conversation-ai-run-smoke",
          conversationSlotJson: JSON.stringify({ scopeKind: "lockedHost", targetKey: "ssh:prod-api" }),
          createdAt: Date.now() - 5000,
          goal: "把 172.16.40.104 加到 bwy 分组并连接",
          id: "run-ai-smoke",
          iteration,
          maxIterations: 8,
          maxToolCalls: 12,
          status,
          updatedAt: Date.now(),
        };
      }

      function emitTerminal(channelId, message) {
        if (!channelId || !callbacks.has(channelId)) {
          return;
        }
        const index = channelIndexes.get(channelId) ?? 0;
        channelIndexes.set(channelId, index + 1);
        callbacks.get(channelId)({ index, message });
      }

      function aiRunSmokeSettings() {
        return {
          ai: {
            autoApproveLowRiskReads: true,
            autoApproveWorkspaceOpenTool: true,
            blockDestructiveCommands: true,
            commandExecutionVisibility: "background",
            contextMaxOutputBytes: 12288,
            terminalContextMode: "currentTerminal",
          },
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
            fontFamily: '"JetBrains Mono", "SF Mono", "Cascadia Code", Consolas, monospace',
            fontSize: 13,
            fontWeight: "normal",
            inlineSuggestion: {
              acceptKey: "rightArrow",
              auditRetentionDays: 30,
              enabled: false,
              feedbackRetentionDays: 365,
              productionHostPolicy: "restricted",
              providers: {
                ai: false,
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
          themeMode: ${JSON.stringify(theme)},
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

function parseArgs(args) {
  const parsed = {
    outputDir: path.join(repoRoot, ".updeng", "docs", "verification"),
    systemPrefers: "light",
    theme: "dark",
  };
  for (const arg of args) {
    if (arg.startsWith("--output-dir=")) {
      parsed.outputDir = path.resolve(repoRoot, arg.slice("--output-dir=".length));
      continue;
    }
    if (arg.startsWith("--theme=")) {
      parsed.theme = arg.slice("--theme=".length);
      continue;
    }
    if (arg.startsWith("--system-prefers=")) {
      parsed.systemPrefers = arg.slice("--system-prefers=".length);
    }
  }
  if (!["dark", "light", "system"].includes(parsed.theme)) {
    throw new Error("--theme must be dark, light, or system");
  }
  if (!["dark", "light"].includes(parsed.systemPrefers)) {
    throw new Error("--system-prefers must be dark or light");
  }
  return parsed;
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
    path.join(
      process.env.PROGRAMFILES ?? "C:\\Program Files",
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe",
    ),
    path.join(
      process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe",
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

function waitForHttpOk(portNumber, pathname, timeoutMs) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.request(
        {
          hostname: "127.0.0.1",
          method: "GET",
          path: pathname,
          port: portNumber,
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
        reject(new Error("Timed out waiting for Vite dev server"));
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
  const snapshot = await evaluate(
    client,
    `(() => ({
      bodyHtml: document.body?.innerHTML?.slice(0, 4000) ?? "",
      bodyText: document.body?.innerText?.slice(0, 2000) ?? "",
      errors: window.__kerminalAiRunSmokeState?.errors ?? [],
      invocations: window.__kerminalAiRunSmokeState?.invocations ?? [],
      readyState: document.readyState,
      smokeStateInstalled: Boolean(window.__kerminalAiRunSmokeState),
      tauriInstalled: Boolean(window.__TAURI_INTERNALS__),
      title: document.title,
    }))()`,
    { returnByValue: true },
  ).catch(() => undefined);
  throw new Error(
    `Timed out waiting for browser expression: ${expression}\n${JSON.stringify(
      snapshot?.result?.value ?? null,
      null,
      2,
    )}`,
  );
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
