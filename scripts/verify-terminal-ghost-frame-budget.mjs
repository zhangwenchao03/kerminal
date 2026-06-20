#!/usr/bin/env node
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
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");

    console.log(JSON.stringify(value, null, 2));
    if (!value.pass) {
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
      const warmupFrames = 20;
      const targetFrames = 220;
      const deltas = [];
      let lastTime = performance.now();
      let frameIndex = 0;
      commitGhost(resolveLayout());

      function tick(now) {
        const delta = now - lastTime;
        lastTime = now;
        for (let index = 0; index < 8; index += 1) {
          commitGhost(resolveLayout());
        }
        if (frameIndex >= warmupFrames) {
          deltas.push(delta);
        }
        frameIndex += 1;
        if (deltas.length >= targetFrames) {
          deltas.sort((left, right) => left - right);
          const sum = deltas.reduce((total, value) => total + value, 0);
          const avg = sum / deltas.length;
          const p95 = deltas[Math.floor(deltas.length * 0.95)];
          const max = deltas[deltas.length - 1];
          const overBudgetFrames = deltas.filter((value) => value > 16.7).length;
          const result = {
            avgFrameMs: Number(avg.toFixed(3)),
            domWrites: state.writes,
            frames: deltas.length,
            maxFrameMs: Number(max.toFixed(3)),
            overBudgetFrames,
            p95FrameMs: Number(p95.toFixed(3)),
            pass: p95 <= 20 && max <= 50 && state.writes <= 1,
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
