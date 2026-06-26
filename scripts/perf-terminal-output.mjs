#!/usr/bin/env node
// @author kongweiguang

import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const outputPath = path.resolve(
  repoRoot,
  args.output ?? ".updeng/docs/verification/terminal-output-baseline.json",
);
const screenshotPath = outputPath.replace(/\.json$/i, ".png");
const config = {
  chunkSize: readPositiveInteger(args["chunk-size"], 4096, "--chunk-size"),
  chunks: readPositiveInteger(args.chunks, 400, "--chunks"),
  maxCharsPerFlush: readPositiveInteger(args["max-chars-per-flush"], 64 * 1024, "--max-chars-per-flush"),
  scenarios: readScenarios(args.scenario ?? args.scenarios ?? "plain,osc,long-line,mixed"),
  screenshot: Boolean(args.screenshot),
  viewport: readViewport(args.viewport ?? "1280x860"),
};
const chromePath = findChromePath();
const chromePort = 9450 + Math.floor(Math.random() * 300);
const userDataDir = path.join(tmpdir(), `kerminal-terminal-output-perf-${Date.now()}`);
const xtermModulePath = path.join(repoRoot, "node_modules", "@xterm", "xterm", "lib", "xterm.mjs");
const xtermCssPath = path.join(repoRoot, "node_modules", "@xterm", "xterm", "css", "xterm.css");

if (!chromePath) {
  console.error("Chrome executable not found. Set CHROME_PATH to run this baseline.");
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
      height: config.viewport.height,
      mobile: false,
      width: config.viewport.width,
    });
    await client.send("Page.navigate", {
      url: `http://127.0.0.1:${assetPort}/`,
    });
    await waitForBrowserExpression(client, "window.__terminalOutputPerfReady === true");
    const evaluated = await evaluate(client, `window.runKerminalTerminalOutputPerf(${JSON.stringify(config)})`);
    const value = evaluated.result?.value;
    if (!value) {
      throw new Error("Terminal output baseline returned no value.");
    }

    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      environment: {
        chromePath,
        node: process.version,
        xterm: readPackageVersion("@xterm/xterm"),
      },
      config,
      results: value.results,
      summary: value.summary,
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
      report.artifacts.screenshot = path.relative(repoRoot, screenshotPath).replaceAll("\\", "/");
    }

    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    console.log(
      `Terminal output baseline: ${report.results.length} scenarios, max frame gap ${report.summary.maxFrameGapMs.toFixed(
        2,
      )} ms, max long task ${report.summary.maxLongTaskMs.toFixed(2)} ms.`,
    );
    console.log(`Report: ${path.relative(repoRoot, outputPath).replaceAll("\\", "/")}`);
    if (!report.summary.pass) {
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
      response.end(terminalOutputHtml());
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
    path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
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

function waitForBrowserExpression(client, expression) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const result = await evaluate(client, expression);
        if (result.result?.value) {
          resolve();
          return;
        }
      } catch {
        // Retry until timeout.
      }
      if (Date.now() - startedAt > 10_000) {
        reject(new Error(`Timed out waiting for browser expression: ${expression}`));
        return;
      }
      setTimeout(tick, 100);
    };
    tick();
  });
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

function readScenarios(value) {
  const allowed = new Set(["plain", "osc", "long-line", "mixed"]);
  const scenarios = value
    .split(",")
    .map((scenario) => scenario.trim())
    .filter((scenario) => allowed.has(scenario));
  if (scenarios.length === 0) {
    throw new Error("--scenario must include one of plain, osc, long-line, mixed.");
  }
  return scenarios;
}

function readViewport(value) {
  const [width, height] = value.split("x").map((part) => Number.parseInt(part, 10));
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("--viewport must use WIDTHxHEIGHT, for example 1280x860.");
  }
  return { height, width };
}

function readPackageVersion(packageName) {
  try {
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "node_modules", packageName, "package.json"), "utf8"));
    return packageJson.version ?? null;
  } catch {
    return null;
  }
}

function terminalOutputHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="/xterm.css" />
  <style>
    body { margin: 0; background: #111827; color: #e5e7eb; font-family: sans-serif; }
    #terminal { width: 100vw; height: 100vh; padding: 16px; box-sizing: border-box; }
  </style>
</head>
<body>
  <div id="terminal"></div>
  <script type="module">
    import { Terminal } from "/xterm.mjs";

    window.__terminalOutputPerfReady = true;
    window.runKerminalTerminalOutputPerf = async function runKerminalTerminalOutputPerf(config) {
      const results = [];
      for (const scenario of config.scenarios) {
        results.push(await runScenario(scenario, config));
      }
      const maxFrameGapMs = Math.max(...results.map((result) => result.frames.gapMs.max));
      const maxLongTaskMs = Math.max(...results.map((result) => result.longTasks.maxMs));
      return {
        results,
        summary: {
          maxFrameGapMs,
          maxLongTaskMs,
          pass: results.every((result) => result.pass),
          worstScenario: results.toSorted((left, right) => right.timing.totalMs - left.timing.totalMs)[0]?.scenario ?? null,
        },
      };
    };

    async function runScenario(scenario, config) {
      const container = document.getElementById("terminal");
      container.textContent = "";
      const terminal = new Terminal({
        cols: 120,
        convertEol: true,
        disableStdin: true,
        rows: 32,
        scrollback: 1000,
      });
      terminal.open(container);

      const longTasks = collectLongTasks();
      const frames = collectFrameGaps();
      const writeCallbackMs = [];
      const sideEffects = createSideEffectMetrics();
      const heapStartBytes = performance.memory?.usedJSHeapSize ?? null;
      let pendingWrite = "";
      let inputChars = 0;
      let writeFlushCount = 0;
      const startedAt = performance.now();

      for (let index = 0; index < config.chunks; index += 1) {
        const chunk = buildChunk(scenario, index, config.chunkSize);
        inputChars += chunk.length;
        sideEffects.measure(chunk);
        pendingWrite += chunk;
        if (pendingWrite.length >= config.maxCharsPerFlush) {
          writeCallbackMs.push(await writeTerminal(terminal, pendingWrite));
          writeFlushCount += 1;
          pendingWrite = "";
        }
      }

      if (pendingWrite.length > 0) {
        writeCallbackMs.push(await writeTerminal(terminal, pendingWrite));
        writeFlushCount += 1;
      }
      sideEffects.flushHistory();
      await nextFrame();
      const totalMs = performance.now() - startedAt;
      frames.stop();
      longTasks.stop();
      const heapEndBytes = performance.memory?.usedJSHeapSize ?? null;
      const tailSample = container.innerText.slice(-240);
      const xtermRows = container.querySelectorAll(".xterm-rows div").length;
      terminal.dispose();

      return {
        dom: {
          tailSample,
          xtermRows,
        },
        frames: summarizeFrames(frames.values),
        heap: {
          deltaBytes: heapStartBytes === null || heapEndBytes === null ? null : heapEndBytes - heapStartBytes,
          endBytes: heapEndBytes,
          startBytes: heapStartBytes,
        },
        input: {
          bytes: inputChars,
          chars: inputChars,
          chunkSize: config.chunkSize,
          chunks: config.chunks,
        },
        longTasks: summarizeLongTasks(longTasks.values),
        pass: tailSample.length > 0 && writeFlushCount > 0,
        scenario,
        sideEffects: sideEffects.summary(),
        timing: {
          charsPerSecond: inputChars / Math.max(totalMs / 1000, 0.001),
          totalMs,
          writeCallbackMs: percentileSummary(writeCallbackMs),
          writeFlushCount,
        },
        warnings: [],
      };
    }

    function writeTerminal(terminal, content) {
      const startedAt = performance.now();
      return new Promise((resolve) => {
        terminal.write(content, () => {
          resolve(performance.now() - startedAt);
        });
      });
    }

    function buildChunk(scenario, index, chunkSize) {
      const line = "line-" + String(index).padStart(5, "0") + " ";
      const payload = (line + "x".repeat(Math.max(1, chunkSize - line.length - 2))).slice(0, chunkSize - 2) + "\\r\\n";
      if (scenario === "plain") {
        return payload;
      }
      if (scenario === "osc") {
        return "\\u001b]7;file://localhost/home/kerminal/" + index + "\\u0007" + payload;
      }
      if (scenario === "long-line") {
        return "long-" + String(index).padStart(5, "0") + "-" + "y".repeat(chunkSize * 2) + "\\r\\n";
      }
      if (index % 10 === 0) {
        return "\\u001b]7;file://localhost/work/mixed/" + index + "\\u0007" + payload;
      }
      if (index % 3 === 0) {
        return "$ command-" + index + "\\r\\n" + payload;
      }
      return payload;
    }

    function createSideEffectMetrics() {
      let commandBlockAppendMs = 0;
      let commandBlockTail = "";
      let cwdPathCount = 0;
      let historyAppendMs = 0;
      let historyFlushCount = 0;
      let historyLength = 0;
      let oscParseMs = 0;
      let pendingHistory = [];
      let remotePrewarmSchedules = 0;

      return {
        flushHistory() {
          if (pendingHistory.length === 0) {
            return;
          }
          const startedAt = performance.now();
          historyLength += pendingHistory.join("").length;
          pendingHistory = [];
          historyAppendMs += performance.now() - startedAt;
          historyFlushCount += 1;
        },
        measure(chunk) {
          let startedAt = performance.now();
          if (chunk.includes("\\u001b]7;")) {
            const matches = chunk.matchAll(/\\u001b\\]7;file:\\/\\/[^\\u0007]+\\u0007/g);
            for (const match of matches) {
              cwdPathCount += 1;
              remotePrewarmSchedules += 1;
              void match;
            }
          }
          oscParseMs += performance.now() - startedAt;

          startedAt = performance.now();
          commandBlockTail = (commandBlockTail + chunk).slice(-20000);
          commandBlockAppendMs += performance.now() - startedAt;

          startedAt = performance.now();
          pendingHistory.push(chunk);
          if (pendingHistory.length >= 50) {
            historyLength += pendingHistory.join("").length;
            pendingHistory = [];
            historyFlushCount += 1;
          }
          historyAppendMs += performance.now() - startedAt;
        },
        summary() {
          return {
            commandBlockAppendMs,
            commandBlockTailLength: commandBlockTail.length,
            cwdPathCount,
            historyAppendMs,
            historyFlushCount,
            historyLength,
            oscParseMs,
            remotePrewarmSchedules,
          };
        },
      };
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
      if (!("PerformanceObserver" in window) || !PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
        return {
          stop() {},
          values,
        };
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

    function summarizeFrames(values) {
      return {
        count: values.length,
        gapMs: percentileSummary(values),
        over16ms: values.filter((value) => value > 16.7).length,
        over50ms: values.filter((value) => value > 50).length,
      };
    }

    function summarizeLongTasks(values) {
      return {
        count: values.length,
        maxMs: values.length === 0 ? 0 : Math.max(...values),
        totalMs: values.reduce((sum, value) => sum + value, 0),
      };
    }

    function percentileSummary(values) {
      if (values.length === 0) {
        return { max: 0, p50: 0, p95: 0, p99: 0 };
      }
      const sorted = [...values].sort((left, right) => left - right);
      return {
        max: sorted.at(-1),
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
      };
    }

    function percentile(sorted, ratio) {
      return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
    }

    function nextFrame() {
      return new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }
  </script>
</body>
</html>`;
}

await main();
