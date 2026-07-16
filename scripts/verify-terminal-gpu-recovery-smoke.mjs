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
import { terminalGpuRecoveryHtml } from "./support/terminal-gpu-recovery-html.mjs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readGpuMode, readPositiveNumber } from "./terminal-renderer-platform-args.mjs";
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
  dpr: readPositiveNumber(args.dpr, 1, "--dpr"),
  gpuMode: readGpuMode(args["gpu-mode"] ?? "hardware"),
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
    console.error(`${label} not found. Run pnpm install first.`);
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
      ...(config.gpuMode === "software"
        ? ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"]
        : []),
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
      deviceScaleFactor: config.dpr,
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
    try {
      rmSync(userDataDir, {
        force: true,
        maxRetries: 20,
        recursive: true,
        retryDelay: 250,
      });
    } catch (error) {
      console.warn(
        `Chrome temporary profile cleanup deferred: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
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


await main();
