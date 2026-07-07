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
  chunks: readPositiveInteger(args.chunks, 180, "--chunks"),
  screenshot: args.screenshot !== "false",
  viewport: readViewport(args.viewport ?? "1440x900"),
};
const chromePath = findChromePath();
const chromePort = 9720 + Math.floor(Math.random() * 300);
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
    await waitForChrome(chromePort, chrome);
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
  }
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
    import { Terminal } from "/xterm.mjs";
    import { WebglAddon } from "/addon-webgl.mjs";

    window.__terminalGpuRecoverySmokeReady = true;
    window.runTerminalGpuRecoverySmoke = async function runTerminalGpuRecoverySmoke(config) {
      const webgl = probeWebgl();
      const panes = [createPane("pane-a"), createPane("pane-b")];
      const registry = {
        atlasEpoch: 0,
        fallbackReason: null,
        recoveryCount: 0,
        webglCanvasCount: 0,
      };
      const failures = [];

      for (const pane of panes) {
        pane.webglAddon.onContextLoss(() => {
          pane.contextLossCount += 1;
          failures.push(pane.id + ":context-lost");
        });
        pane.terminal.loadAddon(pane.webglAddon);
      }
      await nextFrame();

      for (let index = 0; index < config.chunks; index += 1) {
        await writeTerminal(panes[0].terminal, buildChunk("A", index));
        await writeTerminal(panes[1].terminal, buildChunk("B", index));
      }

      await writeTerminal(panes[0].terminal, "\\x1b[?1049h\\x1b[2J\\x1b[HALT BUFFER GPU pane-a 中文 emoji 🚀\\r\\n");
      await nextFrame();
      await writeTerminal(panes[0].terminal, "\\x1b[?1049l\\r\\nBACK FROM ALT pane-a final-token-a\\r\\n");

      clearTextureAtlas(registry, panes);
      refreshAll(panes);
      await nextFrame();

      panes[0].terminal.resize(96, 28);
      panes[1].terminal.resize(96, 28);
      refreshAll(panes);
      await writeTerminal(panes[1].terminal, "\\x1b[35mPOST-RECOVERY pane-b final-token-b 中文 emoji ✅\\x1b[0m\\r\\n");
      await nextFrame();

      registry.webglCanvasCount = document.querySelectorAll("canvas").length;
      const paneReports = panes.map((pane) => summarizePane(pane));
      const noMouseSelectionUsed = document.getSelection()?.toString() === "";
      const pass =
        webgl.available &&
        registry.atlasEpoch >= 1 &&
        registry.recoveryCount >= 1 &&
        registry.webglCanvasCount >= 2 &&
        noMouseSelectionUsed &&
        failures.length === 0 &&
        paneReports.every((pane) => pane.pass);

      return {
        dataSource: "local-generated-xterm-buffer",
        failures,
        noMouseSelectionUsed,
        panes: paneReports,
        pass,
        registry,
        webgl,
      };
    };

    function createPane(id) {
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
      terminal.open(section.querySelector(".terminal"));
      return {
        contextLossCount: 0,
        id,
        section,
        terminal,
        webglAddon: new WebglAddon(),
      };
    }

    function buildChunk(prefix, index) {
      const color = 31 + (index % 6);
      const wide = index % 7 === 0 ? " 中文宽字符" : "";
      const emoji = index % 11 === 0 ? " emoji 🚀✅" : "";
      const long = index % 13 === 0 ? " " + "x".repeat(220) : "";
      return "\\x1b[" + color + "m" + prefix + "-line-" + String(index).padStart(4, "0") + wide + emoji + long + "\\x1b[0m\\r\\n";
    }

    function clearTextureAtlas(registry, panes) {
      for (const pane of panes) {
        pane.webglAddon.clearTextureAtlas();
      }
      registry.atlasEpoch += 1;
      registry.recoveryCount += 1;
    }

    function refreshAll(panes) {
      for (const pane of panes) {
        pane.terminal.refresh(0, Math.max(0, pane.terminal.rows - 1));
      }
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
      const expectedFinalToken = pane.id === "pane-a" ? "final-token-a" : "final-token-b";
      const visibleCanvasCount = canvases.filter(
        (canvas) => canvas.width > 0 && canvas.height > 0,
      ).length;
      const pass =
        pane.contextLossCount === 0 &&
        tail.includes(expectedFinalToken) &&
        tail.includes("中文") &&
        tail.includes("emoji") &&
        visibleCanvasCount >= 1 &&
        sectionRect.width > 100 &&
        sectionRect.height > 100;
      return {
        canvasCount: canvases.length,
        canvases,
        contextLossCount: pane.contextLossCount,
        id: pane.id,
        pass,
        rect: {
          height: Number(sectionRect.height.toFixed(2)),
          width: Number(sectionRect.width.toFixed(2)),
        },
        tail,
        visibleCanvasCount,
      };
    }

    function readTail(terminal) {
      const lines = [];
      const buffer = terminal.buffer.active;
      const start = Math.max(0, buffer.length - 12);
      for (let index = start; index < buffer.length; index += 1) {
        const line = buffer.getLine(index);
        if (line) {
          lines.push(line.translateToString(true));
        }
      }
      return lines.join("\\n");
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
          renderer: null,
          vendor: null,
        };
      }
      const debugInfo = context.getExtension("WEBGL_debug_renderer_info");
      return {
        available: true,
        renderer: debugInfo ? context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER),
        vendor: debugInfo ? context.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : context.getParameter(context.VENDOR),
      };
    }

    function writeTerminal(terminal, value) {
      return new Promise((resolve) => terminal.write(value, resolve));
    }

    function nextFrame() {
      return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
    }
  </script>
</body>
</html>`;
}

await main();
