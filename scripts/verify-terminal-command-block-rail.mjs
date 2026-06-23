#!/usr/bin/env node
/**
 * Headless Chrome smoke for the real React/Vite app command-block rail.
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
const outputDir =
  process.argv[2] ?? path.join(repoRoot, ".updeng", "docs", "verification");
const outputJson = path.join(outputDir, "terminal-command-block-rail.json");
const outputPng = path.join(outputDir, "terminal-command-block-rail.png");
const chromePath = findChromePath();
const chromePort = 9_780 + Math.floor(Math.random() * 300);
const vitePort = 10_180 + Math.floor(Math.random() * 300);
const userDataDir = path.join(
  tmpdir(),
  `kerminal-command-block-rail-${Date.now()}`,
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
      height: 760,
      mobile: false,
      width: 1180,
    });
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: browserBootstrapScript(),
    });
    await client.send("Page.navigate", {
      url: `http://127.0.0.1:${vitePort}/`,
    });

    await waitForBrowserExpression(
      client,
      `document.querySelector('[aria-label="prod-api xterm 终端"]') !== null`,
      180_000,
    );
    await waitForBrowserExpression(
      client,
      `document.querySelector('[aria-label="当前命令行色条 当前命令行"]') !== null`,
      20_000,
    );
    await waitForBrowserExpression(
      client,
      `Array.from(document.querySelectorAll('.xterm-rows > div')).some((row) => row.textContent.includes('ubuntu@ubuntu:~$'))`,
      10_000,
    );

    const before = await commandRailSnapshot(client);
    await clickTerminal(client);
    await pressEnter(client);
    await waitForBrowserExpression(
      client,
      `(() => {
        const state = window.__kerminalRailSmokeState;
        const rails = Array.from(
          document.querySelectorAll('[aria-label="命令块色条"] button'),
        ).map((button) => button.getAttribute("aria-label"));
        return state?.writes?.includes("\\r")
          && rails.includes("折叠命令块 空命令")
          && rails.includes("当前命令行色条 当前命令行");
      })()`,
      10_000,
    );
    await pressEnter(client);
    await waitForBrowserExpression(
      client,
      `(() => {
        const state = window.__kerminalRailSmokeState;
        const rails = Array.from(
          document.querySelectorAll('[aria-label="命令块色条"] button'),
        ).map((button) => button.getAttribute("aria-label"));
        const emptyRailCount = rails.filter((label) => label === "折叠命令块 空命令").length;
        const promptRowCount = Array.from(
          document.querySelectorAll('[aria-label="prod-api xterm 终端"] .xterm-rows > div'),
        ).filter((row) => row.textContent.includes("ubuntu@ubuntu:~$")).length;
        return state?.writes?.filter((item) => item === "\\r").length >= 2
          && emptyRailCount >= 2
          && rails.includes("当前命令行色条 当前命令行")
          && promptRowCount >= 3;
      })()`,
      10_000,
    );
    await delay(250);
    const after = await commandRailSnapshot(client);
    const screenshot = await client.send("Page.captureScreenshot", {
      captureBeyondViewport: true,
      format: "png",
      fromSurface: true,
    });

    const failures = validateRailSmoke(before, after);
    const result = {
      appUrl: `http://127.0.0.1:${vitePort}/`,
      artifacts: {
        json: outputJson,
        screenshot: outputPng,
      },
      before,
      after,
      pass: failures.length === 0,
      failures,
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

async function clickTerminal(client) {
  const snapshot = await commandRailSnapshot(client);
  const rect = snapshot.terminalRect;
  const x = Math.round(rect.left + rect.width / 2);
  const y = Math.round(rect.top + rect.height / 2);
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
  await evaluate(
    client,
    `document.querySelector('.xterm-helper-textarea')?.focus()`,
    { returnByValue: true },
  );
}

async function pressEnter(client) {
  await client.send("Input.dispatchKeyEvent", {
    code: "Enter",
    key: "Enter",
    nativeVirtualKeyCode: 13,
    text: "\r",
    type: "keyDown",
    unmodifiedText: "\r",
    windowsVirtualKeyCode: 13,
  });
  await client.send("Input.dispatchKeyEvent", {
    code: "Enter",
    key: "Enter",
    nativeVirtualKeyCode: 13,
    type: "keyUp",
    windowsVirtualKeyCode: 13,
  });
}

async function commandRailSnapshot(client) {
  const result = await evaluate(
    client,
    `(() => {
      const terminal = document.querySelector('[aria-label="prod-api xterm 终端"]');
      const rows = Array.from(terminal?.querySelectorAll('.xterm-rows > div') ?? []);
      const promptRows = rows
        .map((row, index) => ({ index, rect: rect(row), text: row.textContent ?? "" }))
        .filter((row) => row.text.includes("ubuntu@ubuntu:~$"));
      const railButtons = Array.from(
        document.querySelectorAll('[aria-label="命令块色条"] button'),
      ).map((button) => ({
        label: button.getAttribute("aria-label"),
        rect: rect(button),
        parentRect: rect(button.parentElement),
        topStyle: button.parentElement?.style.top ?? "",
        heightStyle: button.parentElement?.style.height ?? "",
      }));
      return {
        activeElementClass: document.activeElement?.className ?? "",
        consoleMessages: window.__kerminalRailSmokeState?.consoleMessages ?? [],
        errors: window.__kerminalRailSmokeState?.errors ?? [],
        invocations: window.__kerminalRailSmokeState?.invocations ?? [],
        promptRows,
        railButtons,
        rowTexts: rows.slice(0, 8).map((row) => row.textContent ?? ""),
        terminalRect: rect(terminal),
        writes: window.__kerminalRailSmokeState?.writes ?? [],
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

function validateRailSmoke(before, after) {
  const failures = [];
  const beforeRail = before?.railButtons?.find((rail) =>
    rail.label?.includes("当前命令行色条"),
  );
  const emptyRails =
    after?.railButtons?.filter((rail) =>
    rail.label === "折叠命令块 空命令",
    ) ?? [];
  const currentRail = after?.railButtons?.find((rail) =>
    rail.label?.includes("当前命令行色条"),
  );
  const firstPrompt = after?.promptRows?.[0];
  const secondPrompt = after?.promptRows?.[1];
  const thirdPrompt = after?.promptRows?.[2];

  if (!beforeRail) {
    failures.push("missing-initial-current-prompt-rail");
  }
  if (emptyRails.length < 2) {
    failures.push("missing-two-empty-enter-rails");
  }
  if (!currentRail) {
    failures.push("missing-current-prompt-rail-after-enters");
  }
  if ((after?.writes?.filter((item) => item === "\r").length ?? 0) < 2) {
    failures.push("enters-were-not-written");
  }
  if (!firstPrompt || !secondPrompt || !thirdPrompt) {
    failures.push("missing-three-prompt-rows-after-enters");
  }
  if (before?.errors?.length || after?.errors?.length) {
    failures.push("browser-errors");
  }
  if (
    !beforeRail ||
    emptyRails.length < 2 ||
    !currentRail ||
    !firstPrompt ||
    !secondPrompt ||
    !thirdPrompt
  ) {
    return failures;
  }

  const firstRailTop = emptyRails[0].parentRect.top;
  const secondRailTop = emptyRails[1].parentRect.top;
  const currentRailTop = currentRail.parentRect.top;
  const firstDelta = Math.abs(firstRailTop - firstPrompt.rect.top);
  const secondDelta = Math.abs(secondRailTop - secondPrompt.rect.top);
  const currentDelta = Math.abs(currentRailTop - thirdPrompt.rect.top);
  const beforeDelta = Math.abs(firstRailTop - beforeRail.parentRect.top);
  if (firstDelta > 4) {
    failures.push("first-empty-enter-rail-not-anchored-to-first-prompt");
  }
  if (secondDelta > 4) {
    failures.push("second-empty-enter-rail-not-anchored-to-second-prompt");
  }
  if (currentDelta > 4) {
    failures.push("current-prompt-rail-not-anchored-to-third-prompt");
  }
  if (beforeDelta > 4) {
    failures.push("first-empty-enter-rail-shifted-from-initial-rail");
  }
  return failures;
}

function browserBootstrapScript() {
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
      errors: window.__kerminalRailSmokeState?.errors ?? [],
      invocations: window.__kerminalRailSmokeState?.invocations ?? [],
      readyState: document.readyState,
      resources: performance.getEntriesByType("resource")
        .map((entry) => entry.name)
        .slice(0, 20),
      smokeStateInstalled: Boolean(window.__kerminalRailSmokeState),
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
