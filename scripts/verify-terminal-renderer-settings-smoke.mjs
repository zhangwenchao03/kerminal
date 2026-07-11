#!/usr/bin/env node
/**
 * 终端渲染设置三主题与 CPU/GPU/Auto 切换冒烟验证。
 *
 * 该脚本通过 Vite 挂载真实 SettingsToolContent，不连接真实终端或远程主机。
 *
 * @author kongweiguang
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const args = parseArgs(process.argv.slice(2));
const outputPath = path.resolve(
  repoRoot,
  args.output ??
    ".updeng/docs/verification/terminal-renderer-settings-smoke.json",
);
const screenshotBase = outputPath.replace(/\.json$/i, "");
const chromePath = findChromePath();
const chromePort = 9880 + Math.floor(Math.random() * 300);
const vitePort = 10_080 + Math.floor(Math.random() * 300);
const userDataDir = path.join(
  tmpdir(),
  `kerminal-terminal-renderer-settings-smoke-${Date.now()}`,
);

if (!chromePath) {
  console.error(
    "Chrome executable not found. Set CHROME_PATH to run this smoke.",
  );
  process.exit(1);
}

async function main() {
  const vite = await createServer({
    configFile: path.join(repoRoot, "vite.config.ts"),
    plugins: [settingsSmokePlugin()],
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
    await waitForHttpOk(
      vitePort,
      "/__terminal_renderer_settings_smoke",
      20_000,
    );
    await waitForChrome(chromePort, chrome);
    const target = await requestJson(
      chromePort,
      "/json/new?about:blank",
      "PUT",
    );
    client = await CdpClient.connect(target.webSocketDebuggerUrl);
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      deviceScaleFactor: 1,
      height: 980,
      mobile: false,
      width: 1380,
    });
    await client.send("Page.navigate", {
      url: `http://127.0.0.1:${vitePort}/__terminal_renderer_settings_smoke`,
    });
    await waitForBrowserExpression(
      client,
      "window.__terminalRendererSettingsSmokeReady === true",
      30_000,
    );
    const rendererPanelResult = await evaluate(
      client,
      "window.__terminalRendererSettingsSmoke.openRendererPanel()",
    );
    if (rendererPanelResult.result?.value !== true) {
      throw new Error("Terminal renderer settings disclosure did not open.");
    }

    const screenshots = {};
    const themeReports = [];
    for (const themeMode of ["light", "dark", "system"]) {
      const themeResult = await evaluate(
        client,
        `window.__terminalRendererSettingsSmoke.setTheme(${JSON.stringify(themeMode)})`,
      );
      themeReports.push(themeResult.result.value);
      await waitForBrowserExpression(
        client,
        `document.documentElement.dataset.theme === ${JSON.stringify(
          themeMode === "light" ? "light" : "dark",
        )}`,
        10_000,
      );
      const screenshot = await client.send("Page.captureScreenshot", {
        captureBeyondViewport: true,
        format: "png",
        fromSurface: true,
      });
      const screenshotPath = `${screenshotBase}-${themeMode}.png`;
      mkdirSync(path.dirname(screenshotPath), { recursive: true });
      writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
      screenshots[themeMode] = path
        .relative(repoRoot, screenshotPath)
        .replaceAll("\\", "/");
    }

    const transitionResult = await evaluate(
      client,
      `window.__terminalRendererSettingsSmoke.runRendererTransitions()`,
    );
    const validationResult = await evaluate(
      client,
      `window.__terminalRendererSettingsSmoke.validate()`,
    );
    const value = validationResult.result.value;
    const transitions = transitionResult.result.value;
    const failures = [...value.failures, ...transitions.failures];
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      appUrl: `http://127.0.0.1:${vitePort}/__terminal_renderer_settings_smoke`,
      artifacts: {
        json: path.relative(repoRoot, outputPath).replaceAll("\\", "/"),
        screenshots,
      },
      environment: {
        chromePath,
        node: process.version,
      },
      failures,
      pass: failures.length === 0,
      rendererSnapshot: value.rendererSnapshot,
      themes: themeReports,
      transitions,
      validation: value,
    };

    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    console.log(
      `Terminal renderer settings smoke: ${report.pass ? "passed" : "failed"}, themes ${themeReports.length}, transitions ${transitions.sequence.join(" -> ")}.`,
    );
    console.log(`Report: ${report.artifacts.json}`);
    if (!report.pass) {
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

function settingsSmokePlugin() {
  const htmlPath = "/__terminal_renderer_settings_smoke";
  const entryPath = "/__terminal_renderer_settings_smoke_entry.jsx";
  return {
    name: "kerminal-terminal-renderer-settings-smoke",
    configureServer(server) {
      server.middlewares.use(htmlPath, async (request, response) => {
        const html = await server.transformIndexHtml(
          request.originalUrl ?? htmlPath,
          settingsSmokeHtml(entryPath),
        );
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
        });
        response.end(html);
      });
    },
    load(id) {
      if (id.endsWith(entryPath)) {
        return settingsSmokeEntry();
      }
      return undefined;
    },
    resolveId(id) {
      if (id === entryPath) {
        return entryPath;
      }
      return undefined;
    },
  };
}

function settingsSmokeHtml(entryPath) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Kerminal terminal renderer settings smoke</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${entryPath}"></script>
</body>
</html>`;
}

function settingsSmokeEntry() {
  return `
import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "/src/App.css";
import { useDocumentTheme } from "/src/lib/useDocumentTheme";
import { SettingsToolContent } from "/src/features/settings/SettingsToolContent";
import {
  defaultAppSettings,
  terminalRendererTypeOptions,
} from "/src/features/settings/settingsModel";
import { terminalRendererRegistry } from "/src/features/terminal/terminalRendererRegistry";

const rendererControllers = [
  createRendererController("gpu", 2),
  createRendererController("gpu", 2),
];
const unregisterRendererPanes = [
  terminalRendererRegistry.registerPane({
    controller: rendererControllers[0],
    focused: true,
    paneId: "settings-smoke-a",
    visible: true,
  }),
  terminalRendererRegistry.registerPane({
    controller: rendererControllers[1],
    focused: false,
    paneId: "settings-smoke-b",
    visible: true,
  }),
];
terminalRendererRegistry.clearTextureAtlas();

function SmokeApp() {
  const [themeMode, setThemeMode] = useState("dark");
  const [settings, setSettings] = useState(() => ({
    ...defaultAppSettings,
    themeMode: "dark",
    terminal: {
      ...defaultAppSettings.terminal,
      rendererType: "auto",
    },
  }));
  const resolvedTheme = themeMode === "light" ? "light" : "dark";
  const effectiveSettings = useMemo(
    () => ({
      ...settings,
      themeMode,
    }),
    [settings, themeMode],
  );

  useDocumentTheme({
    density: effectiveSettings.interfaceDensity,
    language: effectiveSettings.appearance.interfaceLanguage,
    lang: "zh-CN",
    theme: resolvedTheme,
  });

  useEffect(() => {
    window.__terminalRendererSettingsCurrent = effectiveSettings;
    window.__terminalRendererSettingsSmoke = {
      setTheme(nextThemeMode) {
        setThemeMode(nextThemeMode);
        setSettings((current) => ({
          ...current,
          themeMode: nextThemeMode,
        }));
        return nextFrame().then(() => snapshot());
      },
      openRendererPanel: async () => {
        const disclosure = rendererDisclosure();
        if (!disclosure) {
          return false;
        }
        if (!disclosure.open) {
          rendererSummary()?.click();
          await waitForDomState(() => rendererDisclosure()?.open === true);
        }
        await nextFrame();
        return rendererDisclosure()?.open === true;
      },
      runRendererTransitions: async () => {
        const sequence = [];
        const failures = [];
        for (const rendererType of ["cpu", "gpu", "auto"]) {
          const label = rendererButtonLabels[rendererType];
          const button = buttonByRendererType(rendererType);
          if (!button) {
            failures.push("missing-" + label);
            continue;
          }
          button.click();
          const selected = await waitForDomState(() => {
            const currentButton = buttonByRendererType(rendererType);
            return (
              window.__terminalRendererSettingsCurrent?.terminal?.rendererType === rendererType &&
              currentButton?.getAttribute("aria-pressed") === "true"
            );
          });
          const current = snapshot();
          sequence.push(current.rendererType);
          if (!selected) {
            failures.push("not-selected-" + label);
          }
        }
        return { failures, sequence };
      },
      validate: () => {
        const text = document.body.innerText;
        const disclosure = rendererDisclosure();
        const rendererText = disclosure?.innerText ?? "";
        const rendererSnapshot = terminalRendererRegistry.getSnapshot();
        const pressed = rendererButtons()
          .map((button) => ({
            label: rendererButtonLabel(button),
            pressed: button.getAttribute("aria-pressed"),
            text: button.textContent,
          }));
        const failures = [];
        if (!disclosure) failures.push("missing-renderer-panel");
        if (!disclosure?.open) failures.push("renderer-panel-not-open");
        if (!rendererText.includes("终端渲染")) failures.push("missing-title");
        if (!rendererText.includes("运行正常")) failures.push("missing-normal-badge");
        if (!rendererText.includes("2 个 GPU pane")) failures.push("missing-gpu-pane-count");
        if (!rendererText.includes("已恢复 1 次")) failures.push("missing-recovery-count");
        if (!rendererText.includes("atlas 1")) failures.push("missing-atlas-epoch");
        if (text.includes("clearTextureAtlas") || text.includes("atlas-clear-failed")) failures.push("internal-debug-leaked");
        if (rendererSnapshot.atlasEpoch !== 1) failures.push("wrong-atlas-epoch");
        if (rendererSnapshot.recoveryCount !== 1) failures.push("wrong-recovery-count");
        if (rendererSnapshot.effectiveGpuPanes !== 2) failures.push("wrong-gpu-pane-count");
        if (
          effectiveSettings.terminal.rendererType !== "auto" ||
          buttonByRendererType("auto")?.getAttribute("aria-pressed") !== "true"
        ) {
          failures.push("auto-not-selected-after-transition");
        }
        return {
          dataTheme: document.documentElement.dataset.theme,
          failures,
          pressed,
          rendererPanelOpen: disclosure?.open ?? false,
          rendererSnapshot,
          rendererText,
          rendererType: effectiveSettings.terminal.rendererType,
          textSample: text.slice(0, 1200),
          themeMode: effectiveSettings.themeMode,
        };
      },
    };
    window.__terminalRendererSettingsSmokeReady = true;
  }, [effectiveSettings, resolvedTheme]);

  return React.createElement(
    "main",
    {
      className: "min-h-screen bg-[var(--app-bg)] p-6 text-zinc-950 dark:text-zinc-50",
    },
    React.createElement(SettingsToolContent, {
      initialSectionId: "settings-terminal",
      onSettingsChange: setSettings,
      resolvedTheme,
      settings: effectiveSettings,
    }),
  );
}

function createRendererController(backend, canvasCount) {
  let mode = "auto";
  return {
    attach() {},
    clearTextureAtlas() {},
    dispose() {},
    getState() {
      return {
        backend,
        canvasCount,
        mode,
      };
    },
    updateMode(nextMode) {
      mode = nextMode;
    },
  };
}

const rendererButtonLabels = Object.fromEntries(
  terminalRendererTypeOptions.map((option) => [option.value, option.label]),
);

function rendererSummary() {
  return document.querySelector("summary#settings-terminal-renderer-panel");
}

function rendererDisclosure() {
  return rendererSummary()?.closest("details") ?? null;
}

function rendererButtons() {
  return Array.from(
    rendererDisclosure()?.querySelectorAll("button[aria-pressed]") ?? [],
  );
}

function buttonByRendererType(rendererType) {
  const label = rendererButtonLabels[rendererType];
  return rendererButtons().find((button) => rendererButtonLabel(button) === label);
}

function rendererButtonLabel(button) {
  const text = button.textContent?.replace(/\\s+/g, " ").trim() ?? "";
  return Object.values(rendererButtonLabels).find((label) => text.startsWith(label)) ?? "";
}

function snapshot() {
  const current = window.__terminalRendererSettingsCurrent;
  return {
    dataTheme: document.documentElement.dataset.theme,
    rendererType: current?.terminal?.rendererType ?? "unknown",
    themeMode: current?.themeMode ?? "unknown",
  };
}

function nextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

async function waitForDomState(predicate, maxAttempts = 30) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (predicate()) {
      return true;
    }
    await nextFrame();
  }
  return predicate();
}

createRoot(document.getElementById("root")).render(React.createElement(SmokeApp));

window.addEventListener("beforeunload", () => {
  for (const unregister of unregisterRendererPanes) {
    unregister();
  }
});
`;
}

async function collectFailureDiagnostics(client) {
  const result = await evaluate(
    client,
    `(() => ({
      bodyText: document.body?.innerText?.slice(0, 2000) ?? "",
      dataTheme: document.documentElement.dataset.theme,
      html: document.querySelector("#root")?.innerHTML?.slice(0, 2000) ?? "",
      ready: window.__terminalRendererSettingsSmokeReady ?? false,
      title: document.title,
    }))()`,
  );
  return result.result?.value;
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
    const result = await evaluate(client, expression);
    if (result.result?.value === true) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for browser expression: ${expression}`);
}

function evaluate(client, expression) {
  return client.send("Runtime.evaluate", {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
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
  return candidates.find(
    (candidate) => Boolean(candidate) && existsSync(candidate),
  );
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const value = rawArgs[index + 1];
    if (!value || value.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
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
