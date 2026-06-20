#!/usr/bin/env node
/**
 * Headless Chrome visual smoke for terminal ghost suggestions.
 *
 * @author kongweiguang
 */

import { spawn } from "node:child_process";
import {
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
const outputJson = path.join(outputDir, "terminal-ghost-visual.json");
const outputPng = path.join(outputDir, "terminal-ghost-visual.png");
const chromePath = findChromePath();
const port = 9360 + Math.floor(Math.random() * 300);
const userDataDir = path.join(
  tmpdir(),
  `kerminal-terminal-ghost-visual-${Date.now()}`,
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
      height: 980,
      mobile: false,
      width: 1280,
    });
    await client.send("Runtime.evaluate", {
      expression: `document.open();document.write(${JSON.stringify(
        visualHtml(),
      )});document.close();`,
    });
    const result = await client.send("Runtime.evaluate", {
      awaitPromise: true,
      expression: "window.verifyTerminalGhostVisual()",
      returnByValue: true,
    });
    const screenshot = await client.send("Page.captureScreenshot", {
      captureBeyondViewport: true,
      format: "png",
      fromSurface: true,
    });
    client.close();

    const value = result.result?.value;
    if (!value) {
      throw new Error("Visual smoke returned no value");
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
  return candidates.find(
    (candidate) => Boolean(candidate) && existsSync(candidate),
  );
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
    return new Promise((resolve, reject) => {
      this.pending.set(id, { reject, resolve });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws.close();
  }
}

function visualHtml() {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    margin: 0;
    background: #ececf1;
    color: #18181b;
    font-family: Inter, system-ui, sans-serif;
  }
  .stage {
    display: grid;
    gap: 28px;
    padding: 40px;
  }
  .terminal-shell {
    position: relative;
    width: 1080px;
    height: 360px;
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
  .xterm-screen {
    position: relative;
    width: 960px;
    height: 320px;
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
  .input {
    color: inherit;
  }
  .ghost {
    pointer-events: none;
    position: absolute;
    z-index: 10;
    overflow: hidden;
    white-space: pre;
    color: rgba(113, 113, 122, .76);
    font-family: "Cascadia Mono", "SFMono-Regular", Consolas, monospace;
    font-size: 14px;
    line-height: 1.2;
    max-width: 720px;
    contain: layout paint style;
  }
  .dark .ghost {
    color: rgba(161, 161, 170, .78);
  }
</style>
</head>
<body>
  <main class="stage">
    ${terminalFrame("light", "ascii")}
    ${terminalFrame("dark", "ascii")}
    ${terminalFrame("light", "wide")}
    ${terminalFrame("dark", "wide")}
    ${terminalHiddenFrame("light", "alternate-buffer")}
    ${terminalHiddenFrame("dark", "alternate-buffer")}
  </main>
<script>
  function positionGhost(frame) {
    const ghost = frame.querySelector(".ghost");
    if (!ghost) {
      return;
    }
    const screen = frame.querySelector(".xterm-screen");
    const rows = frame.querySelector(".xterm-rows");
    const activeRow = frame.querySelector(".active-row");
    const input = frame.querySelector(".input");
    const frameRect = frame.getBoundingClientRect();
    const screenRect = screen.getBoundingClientRect();
    const activeRect = activeRow.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const cellWidth = screenRect.width / 80;
    const cursorLeft = inputRect.right;
    const top = activeRect.top - frameRect.top;
    ghost.style.left = (cursorLeft - frameRect.left) + "px";
    ghost.style.top = top + "px";
    ghost.style.maxWidth = Math.max(
      cellWidth,
      frame.clientWidth - (cursorLeft - frameRect.left) - 12,
    ) + "px";
  }

  for (const frame of document.querySelectorAll(".terminal-shell")) {
    positionGhost(frame);
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

  function assertFrame(frame) {
    const name = frame.dataset.theme;
    const scenario = frame.dataset.scenario;
    const ghostState = frame.dataset.ghostState;
    const expectedGhost = frame.dataset.expectedGhost;
    const ghost = frame.querySelector(".ghost");
    const failures = [];
    if (ghostState === "hidden") {
      if (ghost) {
        failures.push("ghost-present");
      }
      return {
        failures,
        frame: rect(frame),
        ghost: null,
        input: null,
        name,
        scenario,
        pass: failures.length === 0,
      };
    }
    const input = frame.querySelector(".input");
    const frameRect = rect(frame);
    const inputRect = rect(input);
    const ghostRect = rect(ghost);
    const styles = getComputedStyle(ghost);

    if (ghost.textContent !== expectedGhost) {
      failures.push("wrong-text");
    }
    if (styles.pointerEvents !== "none") {
      failures.push("pointer-events");
    }
    if (styles.whiteSpace !== "pre") {
      failures.push("white-space");
    }
    if (styles.overflow !== "hidden") {
      failures.push("overflow");
    }
    if (!styles.color.startsWith("rgba(")) {
      failures.push("rgba-color");
    }
    if (ghostRect.width <= 40 || ghostRect.height <= 12) {
      failures.push("not-visible");
    }
    if (Math.abs(ghostRect.left - inputRect.right) > 1.25) {
      failures.push("cursor-alignment");
    }
    if (Math.abs(ghostRect.top - inputRect.top) > 1.25) {
      failures.push("baseline-alignment");
    }
    if (ghostRect.left < inputRect.right - 0.25) {
      failures.push("overlaps-input");
    }
    if (ghostRect.right > frameRect.right - 10) {
      failures.push("overflows-frame");
    }

    return {
      color: styles.color,
      failures,
      frame: frameRect,
      ghost: ghostRect,
      input: inputRect,
      name,
      scenario,
      pass: failures.length === 0,
    };
  }

  window.verifyTerminalGhostVisual = async () => {
    await document.fonts?.ready;
    const frames = Array.from(document.querySelectorAll(".terminal-shell")).map(assertFrame);
    return {
      frames,
      pass: frames.every((frame) => frame.pass),
    };
  };
</script>
</body>
</html>`;
}

function terminalFrame(theme, scenario) {
  const dark = theme === "dark";
  const lineColor = dark ? "#d4d4d8" : "#27272a";
  const input = scenario === "wide" ? "部署" : "git";
  const ghost = scenario === "wide" ? " --dry-run" : " status --short";
  return `<section class="terminal-shell ${dark ? "dark" : ""}" data-theme="${theme}" data-scenario="${scenario}" data-expected-ghost="${escapeHtml(ghost)}">
  <div class="xterm-screen">
    <div class="xterm-rows">
      ${Array.from({ length: 18 }, (_, index) => {
        if (index === 10) {
          return `<div class="active-row"><span style="color:${lineColor}">deploy@host:/srv/app$ </span><span class="input">${escapeHtml(input)}</span></div>`;
        }
        return `<div>${index === 2 ? "remote probe cache ready" : " "}</div>`;
      }).join("")}
    </div>
  </div>
  <div class="ghost">${escapeHtml(ghost)}</div>
</section>`;
}

function terminalHiddenFrame(theme, scenario) {
  const dark = theme === "dark";
  const lineColor = dark ? "#d4d4d8" : "#27272a";
  return `<section class="terminal-shell ${dark ? "dark" : ""}" data-theme="${theme}" data-scenario="${scenario}" data-ghost-state="hidden">
  <div class="xterm-screen">
    <div class="xterm-rows">
      ${Array.from({ length: 18 }, (_, index) => {
        if (index === 1) {
          return `<div style="color:${lineColor}">  NORMAL MODE        file.rs                                       </div>`;
        }
        if (index === 8) {
          return `<div class="active-row" style="color:${lineColor}">fn main() { println!("editing alternate screen"); }</div>`;
        }
        if (index === 16) {
          return `<div style="color:${lineColor}">-- INSERT --                                                    10,4</div>`;
        }
        return `<div>${index === 4 ? "alternate buffer active" : " "}</div>`;
      }).join("")}
    </div>
  </div>
</section>`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

await main();
