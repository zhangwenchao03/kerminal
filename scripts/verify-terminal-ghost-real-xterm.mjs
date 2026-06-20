#!/usr/bin/env node
/**
 * Headless Chrome smoke for real xterm.js alternate-screen ghost behavior.
 *
 * @author kongweiguang
 */

import { spawn } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputDir =
  process.argv[2] ??
  path.join(repoRoot, ".updeng", "data", "verification");
const outputJson = path.join(outputDir, "terminal-ghost-real-xterm.json");
const outputPng = path.join(outputDir, "terminal-ghost-real-xterm.png");
const chromePath = findChromePath();
const chromePort = 9390 + Math.floor(Math.random() * 300);
const userDataDir = path.join(
  tmpdir(),
  `kerminal-terminal-ghost-real-xterm-${Date.now()}`,
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

if (!chromePath) {
  console.error("Chrome executable not found. Set CHROME_PATH to run this check.");
  process.exit(1);
}

if (!existsSync(xtermModulePath) || !existsSync(xtermCssPath)) {
  console.error("@xterm/xterm browser assets not found. Run npm install first.");
  process.exit(1);
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
    await client.send("Page.navigate", {
      url: `http://127.0.0.1:${assetPort}/`,
    });
    await waitForBrowserExpression(
      client,
      "typeof window.__terminalGhostReady !== 'undefined'",
    );
    await evaluate(client, "window.__terminalGhostReady", {
      awaitPromise: true,
      returnByValue: true,
    });
    const result = await evaluate(client, "window.verifyTerminalGhostRealXterm()", {
      awaitPromise: true,
      returnByValue: true,
    });
    const screenshot = await client.send("Page.captureScreenshot", {
      captureBeyondViewport: true,
      format: "png",
      fromSurface: true,
    });
    client.close();
    client = undefined;

    const value = result.result?.value;
    if (!value) {
      throw new Error("Real xterm smoke returned no value");
    }
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(outputJson, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    writeFileSync(outputPng, Buffer.from(screenshot.data, "base64"));

    console.log(
      JSON.stringify(
        {
          ...value,
          artifacts: {
            json: outputJson,
            screenshot: outputPng,
          },
        },
        null,
        2,
      ),
    );
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
      response.end(realXtermHtml());
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

async function waitForBrowserExpression(client, expression) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
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

function realXtermHtml() {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/xterm.css">
<style>
  body {
    margin: 0;
    background: #ececf1;
    color: #18181b;
    font-family: Inter, system-ui, sans-serif;
  }
  .stage {
    display: grid;
    gap: 24px;
    padding: 36px 40px;
  }
  .terminal-shell {
    position: relative;
    width: 1080px;
    height: 300px;
    overflow: hidden;
    border: 1px solid rgba(0, 0, 0, .1);
    background: #f7f7fa;
    padding: 8px 12px 8px 24px;
    box-sizing: border-box;
  }
  .terminal-shell.dark {
    border-color: rgba(255, 255, 255, .1);
    background: #1f1f21;
    color: #e7e7ea;
  }
  .terminal-host {
    width: 100%;
    height: 100%;
  }
  .ghost {
    contain: layout paint style;
    color: rgba(113, 113, 122, .76);
    font-family: "Cascadia Mono", "SFMono-Regular", Consolas, monospace;
    font-size: 14px;
    line-height: 1.2;
    max-width: 720px;
    overflow: hidden;
    pointer-events: none;
    position: absolute;
    white-space: pre;
    z-index: 10;
  }
  .dark .ghost {
    color: rgba(161, 161, 170, .78);
  }
  .xterm {
    height: 100%;
  }
  .xterm .xterm-screen,
  .xterm .xterm-viewport {
    background: transparent !important;
  }
</style>
<script>
  window.__terminalGhostReady = new Promise((resolve, reject) => {
    window.__resolveTerminalGhostReady = resolve;
    window.__rejectTerminalGhostReady = reject;
  });
  window.addEventListener("error", (event) => {
    window.__rejectTerminalGhostReady(event.message || "window-error");
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    window.__rejectTerminalGhostReady(reason?.stack ?? reason?.message ?? String(reason));
  });
</script>
</head>
<body>
  <main class="stage" id="stage"></main>
<script type="module">
  import { Terminal } from "/xterm.mjs";

  const scenarios = [
    {
      background: "#f7f7fa",
      foreground: "#27272a",
      name: "light",
    },
    {
      background: "#1f1f21",
      foreground: "#e7e7ea",
      name: "dark",
    },
  ];

  const activeFrames = scenarios.map(createTerminalFrame);
  window.verifyTerminalGhostRealXterm = async () => {
    const frames = [];
    for (const frame of activeFrames) {
      frames.push(await runScenario(frame));
    }
    return {
      frames,
      pass: frames.every((frame) => frame.pass),
    };
  };

  await nextFrame();
  window.__resolveTerminalGhostReady("ready");

  function createTerminalFrame(config) {
    const shell = document.createElement("section");
    shell.className = "terminal-shell" + (config.name === "dark" ? " dark" : "");
    shell.dataset.theme = config.name;
    shell.innerHTML = '<div class="terminal-host"></div><div class="ghost-root"></div>';
    document.getElementById("stage").append(shell);
    const terminal = new Terminal({
      cols: 80,
      cursorBlink: false,
      cursorStyle: "block",
      disableStdin: true,
      fontFamily: '"Cascadia Mono", "SFMono-Regular", Consolas, monospace',
      fontSize: 14,
      lineHeight: 1.2,
      rows: 12,
      scrollback: 100,
      theme: {
        background: config.background,
        cursor: config.foreground,
        foreground: config.foreground,
      },
    });
    terminal.open(shell.querySelector(".terminal-host"));
    const state = {
      bufferEvents: [terminal.buffer.active.type],
      ghostText: "",
    };
    terminal.buffer.onBufferChange((buffer) => {
      state.bufferEvents.push(buffer.type);
      renderGhost(shell, terminal, state);
    });
    return {
      config,
      shell,
      state,
      terminal,
    };
  }

  async function runScenario(frame) {
    const { shell, state, terminal } = frame;
    const checkpoints = [];

    await writeTerminal(terminal, "\\x1b[2J\\x1b[Hdeploy@host:/srv/app$ git");
    state.ghostText = " status --short";
    renderGhost(shell, terminal, state);
    await nextFrame();
    checkpoints.push(
      assertCheckpoint(shell, terminal, "normal-visible", {
        bufferType: "normal",
        ghostText: " status --short",
        visible: true,
      }),
    );

    await writeTerminal(
      terminal,
      "\\x1b[?1049h\\x1b[2J\\x1b[H  NORMAL MODE        file.rs\\r\\n\\r\\nfn main() { println!(\\"editing alternate screen\\"); }\\r\\n-- INSERT --",
    );
    renderGhost(shell, terminal, state);
    await nextFrame();
    checkpoints.push(
      assertCheckpoint(shell, terminal, "alternate-hidden", {
        bufferType: "alternate",
        visible: false,
      }),
    );

    state.ghostText = " --stale-from-before-alternate";
    renderGhost(shell, terminal, state);
    await nextFrame();
    checkpoints.push(
      assertCheckpoint(shell, terminal, "alternate-stale-response-hidden", {
        bufferType: "alternate",
        visible: false,
      }),
    );

    await writeTerminal(terminal, "\\x1b[?1049l\\r\\ndeploy@host:/srv/app$ ls");
    state.ghostText = " -la";
    renderGhost(shell, terminal, state);
    await nextFrame();
    checkpoints.push(
      assertCheckpoint(shell, terminal, "normal-recovered-visible", {
        bufferType: "normal",
        ghostText: " -la",
        visible: true,
      }),
    );

    const pass = checkpoints.every((checkpoint) => checkpoint.pass);
    return {
      bufferEvents: state.bufferEvents,
      checkpoints,
      pass,
      theme: frame.config.name,
    };
  }

  function renderGhost(shell, terminal, state) {
    const root = shell.querySelector(".ghost-root");
    root.replaceChildren();
    if (terminal.buffer.active.type !== "normal" || state.ghostText.length === 0) {
      return;
    }
    const ghost = document.createElement("div");
    ghost.className = "ghost";
    ghost.setAttribute("aria-label", "终端命令灰色提示");
    ghost.textContent = state.ghostText;
    root.append(ghost);
    positionGhost(shell, terminal, ghost);
  }

  function positionGhost(shell, terminal, ghost) {
    const screen = shell.querySelector(".xterm-screen");
    const screenRect = screen.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    const cellWidth = screenRect.width / terminal.cols;
    const rowHeight = screenRect.height / terminal.rows;
    const left = screenRect.left - shellRect.left + terminal.buffer.active.cursorX * cellWidth;
    const top = screenRect.top - shellRect.top + terminal.buffer.active.cursorY * rowHeight;
    ghost.style.left = left.toFixed(2) + "px";
    ghost.style.maxWidth = Math.max(cellWidth, shell.clientWidth - left - 12) + "px";
    ghost.style.top = top.toFixed(2) + "px";
  }

  function assertCheckpoint(shell, terminal, label, expected) {
    const failures = [];
    const ghost = shell.querySelector(".ghost");
    const bufferType = terminal.buffer.active.type;

    if (bufferType !== expected.bufferType) {
      failures.push("wrong-buffer-type");
    }

    if (!expected.visible) {
      if (ghost) {
        failures.push("ghost-present");
      }
      return {
        bufferType,
        failures,
        label,
        pass: failures.length === 0,
      };
    }

    const screen = shell.querySelector(".xterm-screen");
    const shellRect = rect(shell);
    const screenRect = rect(screen);
    if (!ghost) {
      failures.push("ghost-missing");
      return {
        bufferType,
        failures,
        label,
        pass: false,
      };
    }

    const ghostRect = rect(ghost);
    const styles = getComputedStyle(ghost);
    if (ghost.textContent !== expected.ghostText) {
      failures.push("wrong-text");
    }
    if (ghost.textContent.includes("stale")) {
      failures.push("stale-text-visible");
    }
    if (ghost.getAttribute("aria-label") !== "终端命令灰色提示") {
      failures.push("aria-label");
    }
    if (styles.pointerEvents !== "none") {
      failures.push("pointer-events");
    }
    if (styles.whiteSpace !== "pre") {
      failures.push("white-space");
    }
    if (!styles.color.startsWith("rgba(")) {
      failures.push("rgba-color");
    }
    if (ghostRect.width <= 12 || ghostRect.height <= 12) {
      failures.push("not-visible");
    }
    if (ghostRect.left < screenRect.left - 0.25) {
      failures.push("left-of-screen");
    }
    if (ghostRect.right > shellRect.right - 10) {
      failures.push("overflows-frame");
    }

    return {
      bufferType,
      color: styles.color,
      cursorX: terminal.buffer.active.cursorX,
      cursorY: terminal.buffer.active.cursorY,
      failures,
      ghost: ghostRect,
      label,
      pass: failures.length === 0,
    };
  }

  function rect(element) {
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
