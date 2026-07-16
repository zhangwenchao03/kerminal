#!/usr/bin/env node
/**
 * 终端 ghost overlay 帧预算基线。
 *
 * @author kongweiguang
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputPath =
  process.argv[2] ??
  path.join(
    repoRoot,
    ".updeng",
    "data",
    "verification",
    "terminal-ghost-frame-budget.json",
  );
const chromePath = findChromePath();
const port = 9330 + Math.floor(Math.random() * 300);
const userDataDir = path.join(
  tmpdir(),
  `kerminal-terminal-ghost-frame-${Date.now()}`,
);

if (!chromePath) {
  console.error("Chrome executable not found. Set CHROME_PATH to run this check.");
  process.exit(1);
}

async function main() {
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
      `--remote-debugging-port=${port}`,
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

  try {
    await waitForChrome(port, chrome);
    const target = await requestJson(port, "/json/new?about:blank", "PUT");
    const client = await CdpClient.connect(target.webSocketDebuggerUrl);
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    const browserVersion = await client.send("Browser.getVersion");
    await client.send("Emulation.setDeviceMetricsOverride", {
      deviceScaleFactor: 1,
      height: 720,
      mobile: false,
      width: 1280,
    });
    await client.send("Runtime.evaluate", {
      expression: `document.open();document.write(${JSON.stringify(
        benchmarkHtml(),
      )});document.close();`,
    });
    const result = await client.send("Runtime.evaluate", {
      awaitPromise: true,
      expression: "window.runTerminalGhostFrameBudget()",
      returnByValue: true,
    });
    client.close();

    const value = result.result?.value;
    if (!value) {
      throw new Error("Benchmark returned no value");
    }
    const report = {
      schemaVersion: 1,
      benchmark: "terminal-ghost-frame-budget",
      environment: {
        architecture: process.arch,
        chrome: browserVersion.product,
        chromeJavaScriptVersion: browserVersion.jsVersion,
        node: process.version,
        platform: process.platform,
        viewport: {
          deviceScaleFactor: 1,
          height: 720,
          width: 1280,
        },
      },
      ...value,
    };
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    console.log(JSON.stringify(report, null, 2));
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
    await terminateChrome(chrome);
    rmSync(userDataDir, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 100,
    });
  }
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
            reject(
              new Error(
                `Chrome DevTools HTTP ${response.statusCode}: ${body}`,
              ),
            );
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
  throw new Error("Timed out waiting for Chrome DevTools");
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
    const message = { id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { reject, resolve });
      this.ws.send(JSON.stringify(message));
    });
  }

  close() {
    this.ws.close();
  }
}

function benchmarkHtml() {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0;
    background: #1f1f21;
    color: #e7e7ea;
    font-family: Inter, system-ui, sans-serif;
  }
  .terminal-frame {
    position: relative;
    width: 1080px;
    height: 520px;
    margin: 48px auto;
    overflow: hidden;
    border: 1px solid rgba(255,255,255,.1);
    background: #202124;
    padding: 8px 12px 8px 24px;
    box-sizing: border-box;
  }
  .xterm-rows {
    position: relative;
    font-family: "Cascadia Mono", "SFMono-Regular", Consolas, monospace;
    font-size: 14px;
    line-height: 1.2;
  }
  .xterm-rows > div {
    height: 16.8px;
    white-space: pre;
  }
  .ghost {
    pointer-events: none;
    position: absolute;
    z-index: 10;
    overflow: hidden;
    white-space: pre;
    color: rgba(113,113,122,.88);
    font-family: "Cascadia Mono", "SFMono-Regular", Consolas, monospace;
    font-size: 14px;
    line-height: 1.2;
    contain: layout paint style;
  }
</style>
</head>
<body>
  <div class="terminal-frame" id="terminal">
    <div class="xterm-rows" id="rows"></div>
    <div class="ghost" id="ghost"> status --short</div>
  </div>
<script>
  const frame = document.getElementById("terminal");
  const rows = document.getElementById("rows");
  const ghost = document.getElementById("ghost");
  for (let index = 0; index < 32; index += 1) {
    const row = document.createElement("div");
    row.textContent = index === 14 ? "PS C:/dev/rust/kerminal> git" : " ";
    rows.append(row);
  }

  const state = {
    left: -1,
    maxWidth: -1,
    suffix: "",
    top: -1,
    writes: 0,
  };

  function nearlyEqual(left, right) {
    return Math.abs(left - right) <= 0.25;
  }

  function commitGhost(next) {
    if (
      state.suffix === next.suffix &&
      nearlyEqual(state.left, next.left) &&
      nearlyEqual(state.maxWidth, next.maxWidth) &&
      nearlyEqual(state.top, next.top)
    ) {
      return;
    }
    state.left = next.left;
    state.maxWidth = next.maxWidth;
    state.suffix = next.suffix;
    state.top = next.top;
    state.writes += 1;
    ghost.style.left = next.left + "px";
    ghost.style.maxWidth = next.maxWidth + "px";
    ghost.style.top = next.top + "px";
    ghost.textContent = next.suffix;
  }

  function resolveLayout() {
    const cellWidth = rows.getBoundingClientRect().width / 80 || 8.68;
    const rowHeight = rows.firstElementChild.getBoundingClientRect().height || 16.8;
    const cursorX = 27;
    const cursorY = 14;
    const rowsLeft = rows.offsetLeft;
    const rowsTop = rows.offsetTop;
    return {
      left: frame.offsetLeft + rowsLeft + cursorX * cellWidth,
      maxWidth: Math.max(cellWidth, frame.clientWidth - rowsLeft - cursorX * cellWidth),
      suffix: " status --short",
      top: frame.offsetTop + rowsTop + cursorY * rowHeight,
    };
  }

  window.runTerminalGhostFrameBudget = () =>
    new Promise((resolve) => {
      const coldFrameCount = 20;
      const warmFrameCount = 220;
      const coldDeltas = [];
      const warmDeltas = [];
      let lastTime = performance.now();
      let frameIndex = 0;
      commitGhost(resolveLayout());

      function percentile(sorted, ratio) {
        if (sorted.length === 0) {
          return 0;
        }
        const index = Math.min(
          sorted.length - 1,
          Math.ceil(sorted.length * ratio) - 1,
        );
        return sorted[index];
      }

      function summarize(samples) {
        const sorted = [...samples].sort((left, right) => left - right);
        const total = sorted.reduce((sum, value) => sum + value, 0);
        return {
          avgMs: Number((total / sorted.length).toFixed(3)),
          maxMs: Number(sorted[sorted.length - 1].toFixed(3)),
          p50Ms: Number(percentile(sorted, 0.5).toFixed(3)),
          p95Ms: Number(percentile(sorted, 0.95).toFixed(3)),
          p99Ms: Number(percentile(sorted, 0.99).toFixed(3)),
          sampleCount: sorted.length,
        };
      }

      function tick(now) {
        const delta = now - lastTime;
        lastTime = now;
        for (let index = 0; index < 8; index += 1) {
          commitGhost(resolveLayout());
        }
        if (frameIndex < coldFrameCount) {
          coldDeltas.push(delta);
        } else {
          warmDeltas.push(delta);
        }
        frameIndex += 1;
        if (warmDeltas.length >= warmFrameCount) {
          const cold = summarize(coldDeltas);
          const warm = summarize(warmDeltas);
          const overBudgetFrames = warmDeltas.filter(
            (value) => value > 16.7,
          ).length;
          const result = {
            avgFrameMs: warm.avgMs,
            domWrites: state.writes,
            frames: warm.sampleCount,
            maxFrameMs: warm.maxMs,
            metrics: {
              cold,
              warm,
            },
            overBudgetFrames,
            p50FrameMs: warm.p50Ms,
            p95FrameMs: warm.p95Ms,
            p99FrameMs: warm.p99Ms,
            pass:
              warm.p95Ms <= 20 &&
              warm.maxMs <= 50 &&
              state.writes <= 1,
            sampleCount: {
              cold: cold.sampleCount,
              warm: warm.sampleCount,
            },
            threshold: {
              maxFrameMs: 50,
              maxStableDomWrites: 1,
              p95FrameMs: 20,
            },
          };
          resolve(result);
          return;
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
</script>
</body>
</html>`;
}

await main();
