#!/usr/bin/env node
/**
 * 真实 React/Vite 应用终端 ghost overlay 的 Headless Chrome smoke。
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

import { browserBootstrapScript } from "./support/terminal-ghost-browser-bootstrap.mjs";
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
const warmSampleCount = parsePositiveInteger(
  process.env.KERMINAL_GHOST_APP_WARM_SAMPLES,
  20,
);
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
    const browserVersion = await client.send("Browser.getVersion");
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

    await measureGhostLatencySamples(client, warmSampleCount);

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
          && ghost.getAttribute("data-provider") === "spec"
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
    const performanceReport = summarizeGhostPerformance(
      smokeState?.performanceSamples ?? [],
    );
    const failures = validateSmokeState(
      visibleGhost,
      smokeState,
      performanceReport,
      warmSampleCount,
    );
    const result = {
      schemaVersion: 1,
      benchmark: "terminal-ghost-app",
      appUrl: `http://127.0.0.1:${vitePort}/`,
      artifacts: {
        json: outputJson,
        screenshot: outputPng,
      },
      dataScale: {
        historyRows: [10_000, 100_000],
        remoteCommands: 5_000,
        remotePaths: 1_000,
        gitRefs: 1_000,
      },
      environment: {
        architecture: process.arch,
        chrome: browserVersion.product,
        chromeJavaScriptVersion: browserVersion.jsVersion,
        node: process.version,
        platform: process.platform,
        viewport: {
          deviceScaleFactor: 1,
          height: 900,
          width: 1360,
        },
      },
      ghost: visibleGhost,
      invocations: smokeState?.invocations?.map((item) => item.cmd) ?? [],
      performance: performanceReport,
      pass: failures.length === 0,
      failures,
      sampleCount: {
        cold: performanceReport.cold.sampleCount,
        warm: performanceReport.warm.sampleCount,
      },
      writeSummary: summarizeWrites(smokeState?.writes ?? []),
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
      location: window.location.href,
      readyState: document.readyState,
      resourceEntries: performance.getEntriesByType("resource")
        .slice(-30)
        .map((entry) => ({
          duration: Math.round(entry.duration),
          initiatorType: entry.initiatorType,
          name: entry.name,
        })),
      scripts: Array.from(document.scripts).map((script) => ({
        src: script.src,
        type: script.type,
      })),
      smokeState: window.__kerminalAppSmokeState
        ? {
            auditRequestCount:
              window.__kerminalAppSmokeState.auditRequests.length,
            feedbackRequestCount:
              window.__kerminalAppSmokeState.feedbackRequests.length,
            invocationCommands:
              window.__kerminalAppSmokeState.invocations.map((item) => item.cmd),
            performanceSamples:
              window.__kerminalAppSmokeState.performanceSamples,
            refreshRequestCount:
              window.__kerminalAppSmokeState.refreshRequests.length,
            sessionCount: window.__kerminalAppSmokeState.sessions.length,
            suggestionRequestCount:
              window.__kerminalAppSmokeState.suggestionRequests.length,
            suggestionRequestSummaries:
              window.__kerminalAppSmokeState.suggestionRequests.map(
                (request) => ({
                  cursor: request.cursor,
                  inputLength: String(request.input ?? "").length,
                  providers: request.providers ?? [],
                  remoteHostIdPresent: Boolean(request.remoteHostId),
                  target: request.target,
                }),
              ),
            writeCount: window.__kerminalAppSmokeState.writes.length,
            writeUtf16Units:
              window.__kerminalAppSmokeState.writes.reduce(
                (total, item) => total + String(item).length,
                0,
              ),
          }
        : null,
      smokeErrors: window.__kerminalAppSmokeErrors ?? [],
      title: document.title,
    }))()`,
    { returnByValue: true },
  );
  return result.result?.value;
}

function validateSmokeState(ghost, state, performanceReport, expectedWarmSamples) {
  const failures = [];
  const writes = state?.writes ?? [];
  const accepted = state?.feedbackRequests?.find(
    (request) =>
      request.action === "accepted" &&
      request.provider === "spec" &&
      request.replacementText === "journalctl",
  );
  const suggestionRequest = state?.suggestionRequests?.find(
    (request) =>
      request.target === "ssh" &&
      request.remoteHostId === "prod-api" &&
      request.providers?.includes("spec"),
  );
  if (ghost?.text !== "nalctl") {
    failures.push("wrong-ghost-text");
  }
  if (ghost?.provider !== "spec") {
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
  if (!writes.join("").endsWith("journalctl")) {
    failures.push("accepted-write-mismatch");
  }
  if (performanceReport.cold.sampleCount !== 1) {
    failures.push("missing-cold-performance-sample");
  }
  if (performanceReport.warm.sampleCount !== expectedWarmSamples) {
    failures.push("missing-warm-performance-samples");
  }
  return failures;
}

async function measureGhostLatencySamples(client, targetWarmSamples) {
  const phases = ["cold", ...Array(targetWarmSamples).fill("warm")];
  for (let index = 0; index < phases.length; index += 1) {
    await evaluate(
      client,
      `window.__beginKerminalGhostLatencySample(${JSON.stringify(phases[index])})`,
      { returnByValue: true },
    );
    for (const char of "jour") {
      await client.send("Input.dispatchKeyEvent", {
        text: char,
        type: "char",
        unmodifiedText: char,
      });
      await delay(10);
    }
    await waitForBrowserExpression(
      client,
      `window.__kerminalAppSmokeState.performanceSamples.length > ${index}`,
      10_000,
    );
    for (let deleteIndex = 0; deleteIndex < 4; deleteIndex += 1) {
      await dispatchKey(client, {
        code: "Backspace",
        key: "Backspace",
        nativeVirtualKeyCode: 8,
        windowsVirtualKeyCode: 8,
      });
    }
    await waitForBrowserExpression(
      client,
      "document.querySelector('[aria-label=\"终端命令灰色提示\"]') === null",
      5_000,
    );
  }
}

async function dispatchKey(client, key) {
  await client.send("Input.dispatchKeyEvent", {
    ...key,
    type: "keyDown",
  });
  await client.send("Input.dispatchKeyEvent", {
    ...key,
    type: "keyUp",
  });
}

function summarizeGhostPerformance(samples) {
  const byPhase = (phase) =>
    summarizeDurations(
      samples
        .filter((sample) => sample.phase === phase)
        .map((sample) => Number(sample.durationMs)),
    );
  return {
    cold: byPhase("cold"),
    warm: byPhase("warm"),
  };
}

function summarizeDurations(samples) {
  if (samples.length === 0) {
    return {
      maxMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      sampleCount: 0,
    };
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (ratio) =>
    sorted[
      Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)
    ];
  return {
    maxMs: roundMilliseconds(sorted[sorted.length - 1]),
    p50Ms: roundMilliseconds(percentile(0.5)),
    p95Ms: roundMilliseconds(percentile(0.95)),
    p99Ms: roundMilliseconds(percentile(0.99)),
    sampleCount: sorted.length,
  };
}

function summarizeWrites(writes) {
  return {
    count: writes.length,
    utf16Units: writes.reduce(
      (total, item) => total + String(item).length,
      0,
    ),
  };
}

function roundMilliseconds(value) {
  return Number(Number(value).toFixed(3));
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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
