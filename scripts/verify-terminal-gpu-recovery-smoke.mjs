#!/usr/bin/env node
/**
 * 本地 xterm.js WebGL 恢复冒烟验证。
 *
 * 该脚本只生成本地浏览器内的 xterm buffer，不连接 SSH/PTY，避免把高输出压测写入真实远程会话。
 *
 * @author kongweiguang
 */

import { spawn } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const outputPath = path.resolve(
  repoRoot,
  args.output ?? ".updeng/docs/verification/terminal-gpu-recovery-smoke.json",
);
const screenshotPath = outputPath.replace(/\.json$/i, ".png");
const config = {
  backend: readBackend(args.backend ?? "gpu"),
  chunks: readPositiveInteger(args.chunks, 180, "--chunks"),
  panes: readPositiveInteger(args.panes, 2, "--panes"),
  screenshot: args.screenshot !== "false",
  viewport: readViewport(args.viewport ?? "1440x900"),
};
const chromePath = findChromePath();
const userDataDir = path.join(
  tmpdir(),
  `kerminal-terminal-gpu-recovery-smoke-${Date.now()}`,
);
const xtermModulePath = path.join(
  repoRoot,
  "node_modules",
  "@xterm",
  "xterm",
  "lib",
  "xterm.mjs",
);
const xtermCssPath = path.join(
  repoRoot,
  "node_modules",
  "@xterm",
  "xterm",
  "css",
  "xterm.css",
);
const webglAddonModulePath = path.join(
  repoRoot,
  "node_modules",
  "@xterm",
  "addon-webgl",
  "lib",
  "addon-webgl.mjs",
);
const smokeBridgeEntryPath = path.join(
  repoRoot,
  "tests",
  "frontend",
  "support",
  "terminal",
  "terminalRendererBrowserSmokeBridge.ts",
);
const smokeBundlePath = path.join(
  tmpdir(),
  `kerminal-terminal-renderer-smoke-${Date.now()}.mjs`,
);

if (!chromePath) {
  console.error("Chrome executable not found. Set CHROME_PATH to run this smoke.");
  process.exit(1);
}

for (const [label, filePath] of [
  ["@xterm/xterm module", xtermModulePath],
  ["@xterm/xterm css", xtermCssPath],
  ["@xterm/addon-webgl module", webglAddonModulePath],
]) {
  if (!existsSync(filePath)) {
    console.error(`${label} not found. Run npm install first.`);
    process.exit(1);
  }
}

async function main() {
  await buildSmokeBundle();
  const assetServer = await startAssetServer();
  const assetPort = assetServer.address().port;
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--enable-gpu-rasterization",
      "--hide-scrollbars",
      "--ignore-gpu-blocklist",
      "--mute-audio",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
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
    const chromePort = await waitForChrome(userDataDir, chrome);
    const target = await requestJson(chromePort, "/json/new?about:blank", "PUT");
    client = await CdpClient.connect(target.webSocketDebuggerUrl);
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      deviceScaleFactor: 1,
      height: config.viewport.height,
      mobile: false,
      width: config.viewport.width,
    });
    await client.send("Page.navigate", {
      url: `http://127.0.0.1:${assetPort}/`,
    });
    await waitForBrowserExpression(
      client,
      "window.__terminalGpuRecoverySmokeReady === true",
    );
    const evaluated = await evaluate(
      client,
      `window.runTerminalGpuRecoverySmoke(${JSON.stringify(config)})`,
    );
    const value = evaluated.result?.value;
    if (!value) {
      throw new Error("Terminal GPU recovery smoke returned no value.");
    }

    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      environment: {
        chromePath,
        node: process.version,
        webglAddon: readPackageVersion("@xterm/addon-webgl"),
        xterm: readPackageVersion("@xterm/xterm"),
      },
      config,
      ...value,
      artifacts: {
        json: path.relative(repoRoot, outputPath).replaceAll("\\", "/"),
      },
    };

    if (config.screenshot) {
      const screenshot = await client.send("Page.captureScreenshot", {
        captureBeyondViewport: true,
        format: "png",
        fromSurface: true,
      });
      mkdirSync(path.dirname(screenshotPath), { recursive: true });
      writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
      report.artifacts.screenshot = path
        .relative(repoRoot, screenshotPath)
        .replaceAll("\\", "/");
    }

    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    console.log(
      `Terminal GPU recovery smoke: ${report.pass ? "passed" : "failed"}, atlas epoch ${report.registry.atlasEpoch}, canvases ${report.registry.webglCanvasCount}.`,
    );
    console.log(`Report: ${report.artifacts.json}`);
    if (report.artifacts.screenshot) {
      console.log(`Screenshot: ${report.artifacts.screenshot}`);
    }
    if (!report.pass) {
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
    await closeServer(assetServer);
    await terminateChrome(chrome);
    rmSync(userDataDir, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 100,
    });
    rmSync(smokeBundlePath, { force: true });
  }
}

async function buildSmokeBundle() {
  const { build } = await import("esbuild");
  await build({
    bundle: true,
    entryPoints: [smokeBridgeEntryPath],
    format: "esm",
    logLevel: "silent",
    outfile: smokeBundlePath,
    platform: "browser",
    sourcemap: false,
    target: "chrome120",
  });
}

function startAssetServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
      });
      response.end(terminalGpuRecoveryHtml());
      return;
    }
    if (url.pathname === "/xterm.mjs") {
      streamFile(response, xtermModulePath, "text/javascript; charset=utf-8");
      return;
    }
    if (url.pathname === "/xterm.css") {
      streamFile(response, xtermCssPath, "text/css; charset=utf-8");
      return;
    }
    if (url.pathname === "/addon-webgl.mjs") {
      streamFile(response, webglAddonModulePath, "text/javascript; charset=utf-8");
      return;
    }
    if (url.pathname === "/terminal-renderer-smoke.mjs") {
      streamFile(response, smokeBundlePath, "text/javascript; charset=utf-8");
      return;
    }
    response.writeHead(404, {
      "content-type": "text/plain; charset=utf-8",
    });
    response.end("Not found");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function streamFile(response, filePath, contentType) {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": contentType,
  });
  createReadStream(filePath).pipe(response);
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
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
            reject(new Error(`Chrome DevTools HTTP ${response.statusCode}: ${body}`));
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

async function waitForChrome(chromeUserDataDir, processHandle) {
  const activePortPath = path.join(chromeUserDataDir, "DevToolsActivePort");
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Chrome exited with code ${processHandle.exitCode}`);
    }
    try {
      const [portLine] = readFileSync(activePortPath, "utf8").split(/\r?\n/);
      const portNumber = Number.parseInt(portLine, 10);
      if (!Number.isInteger(portNumber) || portNumber <= 0) {
        throw new Error("Chrome DevToolsActivePort is not ready.");
      }
      await requestJson(portNumber, "/json/version");
      return portNumber;
    } catch {
      await delay(100);
    }
  }
  throw new Error("Timed out waiting for Chrome DevTools.");
}

async function waitForBrowserExpression(client, expression) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    const result = await evaluate(client, expression);
    if (result.result?.value) {
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

function readPositiveInteger(value, fallback, label) {
  const parsed = value === undefined ? fallback : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function readBackend(value) {
  if (!["auto", "cpu", "gpu"].includes(value)) {
    throw new Error("--backend must be auto, cpu, or gpu.");
  }
  return value;
}

function readViewport(value) {
  const [width, height] = value.split("x").map((part) => Number.parseInt(part, 10));
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("--viewport must use WIDTHxHEIGHT, for example 1440x900.");
  }
  return { height, width };
}

function readPackageVersion(packageName) {
  try {
    const packageJson = JSON.parse(
      readFileSync(path.join(repoRoot, "node_modules", packageName, "package.json"), "utf8"),
    );
    return packageJson.version ?? null;
  } catch {
    return null;
  }
}

function terminalGpuRecoveryHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="/xterm.css" />
  <style>
    body {
      margin: 0;
      background: #111827;
      color: #e5e7eb;
      font-family: Inter, system-ui, sans-serif;
    }
    #stage {
      box-sizing: border-box;
      display: grid;
      gap: 16px;
      grid-template-columns: 1fr 1fr;
      min-height: 100vh;
      padding: 20px;
    }
    .pane {
      border: 1px solid rgba(255, 255, 255, .15);
      box-sizing: border-box;
      min-width: 0;
      padding: 12px;
    }
    .title {
      color: #f9fafb;
      font-size: 13px;
      margin: 0 0 8px;
    }
    .terminal {
      height: 780px;
      width: 100%;
    }
    .xterm {
      height: 100%;
    }
  </style>
</head>
<body>
  <main id="stage"></main>
  <script type="module">
    import {
      FitAddon,
      Terminal,
      WebglAddon,
      createTerminalOutputWriter,
      createTerminalRendererController,
      createTerminalRendererRegistry,
      createTerminalRendererSurfaceCoordinator,
    } from "/terminal-renderer-smoke.mjs";

    window.__terminalGpuRecoverySmokeReady = true;
    window.runTerminalGpuRecoverySmoke = async function runTerminalGpuRecoverySmoke(config) {
      const webgl = probeWebgl();
      const rendererRegistry = createTerminalRendererRegistry({
        rendererType: config.backend,
      });
      const panes = Array.from(
        { length: config.panes },
        (_, index) =>
          createPane(
            "pane-" + index,
            config.backend,
            rendererRegistry,
          ),
      );
      const failures = [];
      await waitForCondition(() => {
        const snapshot = rendererRegistry.getSnapshot();
        return (
          snapshot.panes.every((pane) => !pane.gpuAttachPending) &&
          (config.backend === "cpu" ||
            snapshot.effectiveGpuPanes >= Math.min(config.panes, 6))
        );
      });
      await nextFrame();
      const frames = collectFrameGaps();
      const longTasks = collectLongTasks();
      const writeCallbackMs = [];
      const startedAt = performance.now();

      for (let index = 0; index < config.chunks; index += 1) {
        for (const pane of panes) {
          writeCallbackMs.push(
            await writeTerminal(pane, buildChunk(pane.id, index)),
          );
        }
      }

      await writeTerminal(panes[0], "\\x1b[?1049h\\x1b[2J\\x1b[HALT BUFFER GPU pane-a 中文 emoji 🚀\\r\\n");
      await nextFrame();
      await writeTerminal(panes[0], "\\x1b[?1049l\\r\\nBACK FROM ALT pane-0 final-token-pane-0\\r\\n");

      if (config.backend !== "cpu") {
        rendererRegistry.clearTextureAtlas();
      }
      await nextFrame();

      for (const pane of panes) {
        pane.terminal.resize(96, 28);
        pane.surface.invalidate();
        pane.surface.flush();
      }
      for (const pane of panes) {
        await writeTerminal(
          pane,
          "\\x1b[35mPOST-RECOVERY " +
            pane.id +
            " final-token-" +
            pane.id +
            " 中文 emoji ✅\\x1b[0m\\r\\n",
        );
      }
      await nextFrame();

      const registry = rendererRegistry.getSnapshot();
      for (const pane of registry.panes) {
        if (pane.fallbackReason) {
          failures.push(pane.paneId + ":" + pane.fallbackReason);
        }
      }
      const paneReports = panes.map((pane) => summarizePane(pane));
      const noMouseSelectionUsed = document.getSelection()?.toString() === "";
      frames.stop();
      longTasks.stop();
      const totalMs = performance.now() - startedAt;
      const gpuExpected = config.backend !== "cpu";
      const pass =
        (!gpuExpected || webgl.available) &&
        (!gpuExpected || registry.atlasEpoch >= 1) &&
        (!gpuExpected || registry.recoveryCount >= 1) &&
        (!gpuExpected ||
          registry.webglCanvasCount >= Math.min(config.panes, 6)) &&
        noMouseSelectionUsed &&
        failures.length === 0 &&
        paneReports.every((pane) => pane.pass);

      const result = {
        dataSource: "local-generated-xterm-buffer",
        implementationCoverage: [
          "terminalOutputWriter",
          "terminalRendererController",
          "terminalRendererRegistry",
          "terminalRendererSurfaceCoordinator",
        ],
        failures,
        noMouseSelectionUsed,
        panes: paneReports,
        pass,
        performance: {
          writesPerSecond:
            (config.chunks * config.panes) /
            Math.max(totalMs / 1000, 0.001),
          frameGapMs: percentileSummary(frames.values),
          longTasks: {
            count: longTasks.values.length,
            maxMs:
              longTasks.values.length === 0
                ? 0
                : Math.max(...longTasks.values),
          },
          totalMs,
          writeCallbackMs: percentileSummary(writeCallbackMs),
        },
        registry,
        webgl,
      };
      for (const pane of panes) {
        pane.dispose();
      }
      rendererRegistry.dispose();
      return result;
    };

    function createPane(id, backend, rendererRegistry) {
      const section = document.createElement("section");
      section.className = "pane";
      section.innerHTML = '<p class="title"></p><div class="terminal"></div>';
      section.querySelector(".title").textContent = id + " local GPU smoke";
      document.getElementById("stage").append(section);
      const terminal = new Terminal({
        allowProposedApi: true,
        cols: 100,
        convertEol: true,
        cursorBlink: false,
        disableStdin: true,
        fontFamily: '"Cascadia Mono", Consolas, monospace',
        fontSize: 13,
        lineHeight: 1.15,
        rows: 30,
        scrollback: 2000,
        theme: {
          background: "#0f172a",
          black: "#111827",
          blue: "#60a5fa",
          brightGreen: "#86efac",
          brightMagenta: "#f0abfc",
          cyan: "#67e8f9",
          foreground: "#e5e7eb",
          green: "#22c55e",
          magenta: "#d946ef",
          red: "#ef4444",
          white: "#f8fafc",
          yellow: "#eab308",
        },
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      const terminalContainer = section.querySelector(".terminal");
      terminal.open(terminalContainer);
      fitAddon.fit();
      const renderer = createTerminalRendererController({
        loadWebglAddon: async () => ({ WebglAddon }),
        onStateChange: (state) =>
          rendererRegistry.updatePaneState(id, state),
        paneId: id,
        rendererType: backend,
        terminal,
      });
      const unregisterRenderer = rendererRegistry.registerPane({
        controller: renderer,
        focused: id === "pane-0",
        paneId: id,
        visible: true,
      });
      const writer = createTerminalOutputWriter(terminal, {
        callbackMode: "required",
        cadence: id === "pane-0" ? "focused" : "visible",
      });
      const surface = createTerminalRendererSurfaceCoordinator({
        fit: () => {
          fitAddon.fit();
          return { cols: terminal.cols, rows: terminal.rows };
        },
        measure: () => {
          const rect = terminalContainer.getBoundingClientRect();
          return {
            dpr: window.devicePixelRatio,
            height: rect.height,
            minimized: rect.width <= 0 || rect.height <= 0,
            visible: true,
            width: rect.width,
          };
        },
        onStableSurface: () => {
          renderer.resume();
          renderer.attach();
        },
      });
      surface.flush();
      return {
        dispose() {
          surface.dispose();
          writer.dispose();
          unregisterRenderer();
          terminal.dispose();
        },
        id,
        renderer,
        section,
        surface,
        terminal,
        writer,
      };
    }

    function buildChunk(prefix, index) {
      const color = 31 + (index % 6);
      const wide = index % 7 === 0 ? " 中文宽字符" : "";
      const emoji = index % 11 === 0 ? " emoji 🚀✅" : "";
      const long = index % 13 === 0 ? " " + "x".repeat(220) : "";
      return "\\x1b[" + color + "m" + prefix + "-line-" + String(index).padStart(4, "0") + wide + emoji + long + "\\x1b[0m\\r\\n";
    }

    function summarizePane(pane) {
      const tail = readTail(pane.terminal);
      const canvases = [...pane.section.querySelectorAll("canvas")].map((canvas) => {
        const rect = canvas.getBoundingClientRect();
        return {
          dataUrlLength: safeCanvasDataUrlLength(canvas),
          height: Number(rect.height.toFixed(2)),
          width: Number(rect.width.toFixed(2)),
        };
      });
      const sectionRect = pane.section.getBoundingClientRect();
      const expectedFinalToken = "final-token-" + pane.id;
      const visibleCanvasCount = canvases.filter(
        (canvas) => canvas.width > 0 && canvas.height > 0,
      ).length;
      const rendererState = pane.renderer.getState();
      const pass =
        tail.includes(expectedFinalToken) &&
        tail.includes("中文") &&
        tail.includes("emoji") &&
        (rendererState.backend === "cpu" || visibleCanvasCount >= 1) &&
        sectionRect.width > 100 &&
        sectionRect.height > 100;
      return {
        canvasCount: canvases.length,
        canvases,
        backend: rendererState.backend,
        bufferLength: pane.terminal.buffer.active.length,
        contextLossCount:
          pane.renderer.getDiagnostics().contextLossCount,
        id: pane.id,
        pass,
        rect: {
          height: Number(sectionRect.height.toFixed(2)),
          width: Number(sectionRect.width.toFixed(2)),
        },
        tail,
        visibleCanvasCount,
        writer: pane.writer.stats(),
      };
    }

    function readTail(terminal) {
      const lines = [];
      const buffer = terminal.buffer.active;
      for (let index = 0; index < buffer.length; index += 1) {
        const line = buffer.getLine(index);
        if (line) {
          const text = line.translateToString(true);
          if (text.trim().length > 0) {
            lines.push(text);
          }
        }
      }
      return lines.slice(-16).join("\\n");
    }

    function safeCanvasDataUrlLength(canvas) {
      try {
        return canvas.toDataURL("image/png").length;
      } catch {
        return null;
      }
    }

    function probeWebgl() {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (!context) {
        return {
          available: false,
          gpuClass: "unavailable",
        };
      }
      const debugInfo = context.getExtension("WEBGL_debug_renderer_info");
      const renderer = String(
        debugInfo
          ? context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
          : context.getParameter(context.RENDERER),
      ).toLowerCase();
      return {
        available: true,
        gpuClass:
          renderer.includes("swiftshader") ||
          renderer.includes("llvmpipe") ||
          renderer.includes("software")
            ? "software"
            : "hardware-or-unknown",
      };
    }

    async function writeTerminal(pane, value) {
      const startedAt = performance.now();
      pane.writer.write(value);
      pane.writer.flush();
      await waitForCondition(
        () => {
          const stats = pane.writer.stats();
          return stats.pendingChars === 0 && !stats.inFlight;
        },
        5_000,
      );
      return performance.now() - startedAt;
    }

    async function waitForCondition(
      predicate,
      timeoutMs = 10_000,
    ) {
      const deadline = performance.now() + timeoutMs;
      while (!predicate()) {
        if (performance.now() >= deadline) {
          throw new Error("Timed out waiting for renderer smoke condition.");
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }

    function nextFrame() {
      return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
    }

    function collectFrameGaps() {
      const values = [];
      let last = performance.now();
      let running = true;
      function tick(now) {
        values.push(now - last);
        last = now;
        if (running) {
          requestAnimationFrame(tick);
        }
      }
      requestAnimationFrame(tick);
      return {
        stop() {
          running = false;
        },
        values,
      };
    }

    function collectLongTasks() {
      const values = [];
      if (
        !("PerformanceObserver" in window) ||
        !PerformanceObserver.supportedEntryTypes?.includes("longtask")
      ) {
        return { stop() {}, values };
      }
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          values.push(entry.duration);
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
      return {
        stop() {
          observer.disconnect();
        },
        values,
      };
    }

    function percentileSummary(values) {
      if (values.length === 0) {
        return { max: 0, p50: 0, p95: 0, p99: 0 };
      }
      const sorted = [...values].sort((left, right) => left - right);
      const percentile = (ratio) =>
        sorted[
          Math.min(
            sorted.length - 1,
            Math.ceil(sorted.length * ratio) - 1,
          )
        ];
      return {
        max: sorted.at(-1),
        p50: percentile(0.5),
        p95: percentile(0.95),
        p99: percentile(0.99),
      };
    }
  </script>
</body>
</html>`;
}

await main();
