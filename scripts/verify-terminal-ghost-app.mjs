#!/usr/bin/env node
/**
 * Headless Chrome smoke for the real React/Vite app terminal ghost overlay.
 *
 * @author kongweiguang
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { spawn } from "node:child_process";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputDir =
  process.argv[2] ?? path.join(repoRoot, ".updeng", "data", "verification");
const outputJson = path.join(outputDir, "terminal-ghost-app.json");
const outputPng = path.join(outputDir, "terminal-ghost-app.png");
const chromePath = findChromePath();
const chromePort = 9480 + Math.floor(Math.random() * 300);
const vitePort = 9780 + Math.floor(Math.random() * 300);
const forceOptimizeDeps = process.env.KERMINAL_GHOST_FORCE_OPTIMIZE !== "0";
const userDataDir = path.join(
  tmpdir(),
  `kerminal-terminal-ghost-app-${Date.now()}`,
);

if (!chromePath) {
  console.error("Chrome executable not found. Set CHROME_PATH to run this check.");
  process.exit(1);
}

async function main() {
  const vite = await createServer({
    configFile: path.join(repoRoot, "vite.config.ts"),
    optimizeDeps: {
      entries: ["index.html"],
      force: forceOptimizeDeps,
    },
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
    await waitForHttpOk(vitePort, "/", 20_000);
    await waitForChrome(chromePort, chrome);
    const target = await requestJson(chromePort, "/json/new?about:blank", "PUT");
    client = await CdpClient.connect(target.webSocketDebuggerUrl);
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      deviceScaleFactor: 1,
      height: 900,
      mobile: false,
      width: 1360,
    });
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: browserBootstrapScript(),
    });
    await client.send("Page.navigate", {
      url: `http://127.0.0.1:${vitePort}/`,
    });
    await waitForBrowserExpression(
      client,
      "document.querySelector('[aria-label=\"prod-api xterm 终端\"]') !== null",
      180_000,
    );
    await waitForBrowserExpression(
      client,
      "document.querySelector('.xterm-helper-textarea') !== null",
      60_000,
    );
    await evaluate(
      client,
      `(() => {
        const host = document.querySelector('[aria-label="prod-api xterm 终端"]');
        host?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        document.querySelector(".xterm-helper-textarea")?.focus();
        return true;
      })()`,
      { returnByValue: true },
    );

    for (const char of "jour") {
      await client.send("Input.dispatchKeyEvent", {
        text: char,
        type: "char",
        unmodifiedText: char,
      });
      await delay(40);
    }

    await waitForBrowserExpression(
      client,
      `(() => {
        const ghost = document.querySelector('[aria-label="终端命令灰色提示"]');
        if (!ghost) return false;
        const rect = ghost.getBoundingClientRect();
        return ghost.textContent === "nalctl"
          && ghost.getAttribute("data-provider") === "remoteCommand"
          && rect.width > 0
          && rect.height > 0;
      })()`,
      10_000,
    );
    const visibleGhost = await getGhostSnapshot(client);
    const screenshot = await client.send("Page.captureScreenshot", {
      captureBeyondViewport: true,
      format: "png",
      fromSurface: true,
    });

    await client.send("Input.dispatchKeyEvent", {
      code: "ArrowRight",
      key: "ArrowRight",
      nativeVirtualKeyCode: 39,
      type: "keyDown",
      windowsVirtualKeyCode: 39,
    });
    await client.send("Input.dispatchKeyEvent", {
      code: "ArrowRight",
      key: "ArrowRight",
      nativeVirtualKeyCode: 39,
      type: "keyUp",
      windowsVirtualKeyCode: 39,
    });
    await waitForBrowserExpression(
      client,
      "document.querySelector('[aria-label=\"终端命令灰色提示\"]') === null",
      5_000,
    );

    const state = await evaluate(
      client,
      `(() => JSON.parse(JSON.stringify(window.__kerminalAppSmokeState)))()`,
      { returnByValue: true },
    );
    const smokeState = state.result?.value;
    const failures = validateSmokeState(visibleGhost, smokeState);
    const result = {
      appUrl: `http://127.0.0.1:${vitePort}/`,
      artifacts: {
        json: outputJson,
        screenshot: outputPng,
      },
      ghost: visibleGhost,
      invocations: smokeState?.invocations?.map((item) => item.cmd) ?? [],
      pass: failures.length === 0,
      failures,
      writes: smokeState?.writes ?? [],
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
    if (client) {
      try {
        const diagnostics = await collectFailureDiagnostics(client);
        console.error(JSON.stringify(diagnostics, null, 2));
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
    await vite.close();
    rmSync(userDataDir, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 100,
    });
  }
}

async function collectFailureDiagnostics(client) {
  const result = await evaluate(
    client,
    `(() => ({
      ariaLabels: Array.from(document.querySelectorAll("[aria-label]"))
        .slice(0, 40)
        .map((node) => node.getAttribute("aria-label")),
      bodyText: document.body?.innerText?.slice(0, 2000) ?? "",
      location: window.location.href,
      readyState: document.readyState,
      resourceEntries: performance.getEntriesByType("resource")
        .slice(-30)
        .map((entry) => ({
          duration: Math.round(entry.duration),
          initiatorType: entry.initiatorType,
          name: entry.name,
        })),
      rootHtml: document.querySelector("#root")?.innerHTML?.slice(0, 2000) ?? null,
      scripts: Array.from(document.scripts).map((script) => ({
        src: script.src,
        type: script.type,
      })),
      smokeState: window.__kerminalAppSmokeState ?? null,
      smokeErrors: window.__kerminalAppSmokeErrors ?? [],
      storageSession: window.localStorage.getItem("kerminal.workspace.session.v1"),
      title: document.title,
    }))()`,
    { returnByValue: true },
  );
  return result.result?.value;
}

function validateSmokeState(ghost, state) {
  const failures = [];
  const writes = state?.writes ?? [];
  const accepted = state?.feedbackRequests?.find(
    (request) =>
      request.action === "accepted" &&
      request.provider === "remoteCommand" &&
      request.replacementText === "journalctl",
  );
  const suggestionRequest = state?.suggestionRequests?.find(
    (request) =>
      request.target === "ssh" &&
      request.remoteHostId === "prod-api" &&
      request.providers?.includes("remoteCommand"),
  );
  if (ghost?.text !== "nalctl") {
    failures.push("wrong-ghost-text");
  }
  if (ghost?.provider !== "remoteCommand") {
    failures.push("wrong-provider");
  }
  if (ghost?.ariaLabel !== "终端命令灰色提示") {
    failures.push("missing-aria-label");
  }
  if (!ghost?.inputRow) {
    failures.push("missing-input-row");
  } else {
    const verticalDelta = Math.abs(ghost.rect.top - ghost.inputRow.top);
    if (verticalDelta > 2) {
      failures.push("floating-ghost-row");
    }
    if (
      ghost.rect.left < ghost.inputRow.left - 0.25 ||
      ghost.rect.left > ghost.inputRow.right
    ) {
      failures.push("ghost-outside-input-row");
    }
  }
  if (!suggestionRequest) {
    failures.push("missing-ssh-suggestion-request");
  }
  if (!accepted) {
    failures.push("missing-accepted-feedback");
  }
  if (writes.join("") !== "journalctl") {
    failures.push("accepted-write-mismatch");
  }
  return failures;
}

async function getGhostSnapshot(client) {
  const result = await evaluate(
    client,
    `(() => {
      const ghost = document.querySelector('[aria-label="终端命令灰色提示"]');
      if (!ghost) return null;
      const terminal = document.querySelector('[aria-label="prod-api xterm 终端"]');
      const inputRow = Array.from(
        terminal?.querySelectorAll(".xterm-rows > div") ?? [],
      ).find((row) => row.textContent?.includes("jour"));
      const rect = ghost.getBoundingClientRect();
      const inputRowRect = inputRow?.getBoundingClientRect();
      const styles = getComputedStyle(ghost);
      return {
        ariaLabel: ghost.getAttribute("aria-label"),
        color: styles.color,
        fontFamily: styles.fontFamily,
        fontSize: styles.fontSize,
        provider: ghost.getAttribute("data-provider"),
        rect: {
          height: rect.height,
          left: rect.left,
          top: rect.top,
          width: rect.width,
        },
        inputRow: inputRowRect
          ? {
              bottom: inputRowRect.bottom,
              height: inputRowRect.height,
              left: inputRowRect.left,
              right: inputRowRect.right,
              top: inputRowRect.top,
              width: inputRowRect.width,
            }
          : null,
        text: ghost.textContent,
        title: ghost.getAttribute("title"),
      };
    })()`,
    { returnByValue: true },
  );
  return result.result?.value;
}

function browserBootstrapScript() {
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
        refreshRequests: [],
        sessions: [],
        suggestionRequests: [],
        writes: [],
      };
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
                ai: false,
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
        const trimmed = prefix.trim();
        const command = "journalctl";
        if (
          request?.target !== "ssh" ||
          request?.remoteHostId !== "prod-api" ||
          !request?.providers?.includes("remoteCommand") ||
          !trimmed ||
          !command.startsWith(trimmed)
        ) {
          return [];
        }
        return [
          {
            description: "远端 PATH 命令，来自 app smoke fake IPC",
            displayText: command,
            id: "app-smoke-remote-command-journalctl",
            metadata: { source: "appSmoke" },
            provider: "remoteCommand",
            replacementRange: { end: cursor, start: 0 },
            replacementText: command,
            score: 0.98,
            sensitivity: "normal",
            sourceId: "app-smoke-remote-command",
            suffix: command.slice(trimmed.length),
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
