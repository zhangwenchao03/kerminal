#!/usr/bin/env node
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { browserBootstrapScript } from "./readme-screenshots/bootstrap.mjs";
import {
  CdpClient,
  findChromePath,
  requestJson,
  terminateChrome,
  waitForChrome,
  waitForHttpOk,
} from "./readme-screenshots/cdp-client.mjs";
import {
  assertNoBlockingErrors,
  collectDiagnostics,
  delay,
  waitForAppReady,
} from "./readme-screenshots/helpers.mjs";
import { captures } from "./readme-screenshots/scenarios.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appUrl = process.argv[2] ?? "http://127.0.0.1:1425/";
const outputDir = path.join(repoRoot, "docs", "assets");
const chromePath = findChromePath();
const chromePort = 10_240 + Math.floor(Math.random() * 300);
const userDataDir = path.join(tmpdir(), `kerminal-readme-capture-${Date.now()}`);

if (!chromePath) {
  console.error("Chrome executable not found. Set CHROME_PATH to run this capture.");
  process.exit(1);
}

async function main() {
  await waitForHttpOk(new URL(appUrl), 30_000);
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
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
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
      height: 1040,
      mobile: false,
      width: 1600,
    });
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: browserBootstrapScript(),
    });
    await client.send("Page.navigate", { url: appUrl });
    await waitForAppReady(client);

    mkdirSync(outputDir, { recursive: true });
    const results = [];
    for (const capture of captures) {
      await capture.setup(client);
      await delay(600);
      await assertNoBlockingErrors(client);
      const screenshot = await client.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
      });
      const outputPath = path.join(outputDir, capture.name);
      writeFileSync(outputPath, Buffer.from(screenshot.data, "base64"));
      results.push(outputPath);
    }

    console.log(JSON.stringify({ appUrl, screenshots: results }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    if (client) {
      try {
        console.error(JSON.stringify(await collectDiagnostics(client), null, 2));
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
    rmSync(userDataDir, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 100,
    });
  }
}

await main();
