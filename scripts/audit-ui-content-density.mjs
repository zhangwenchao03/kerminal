#!/usr/bin/env node
/**
 * Kerminal 非内容区文字密度审计。
 *
 * 复用 README 截图的真实浏览器预览数据与场景，只统计应用 chrome、导航、
 * 工具栏、弹框和状态信息；终端、文件正文、代码块与表单输入值不计入。
 *
 * @author kongweiguang
 */

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  delay,
  evaluate,
  waitForAppReady,
} from "./readme-screenshots/helpers.mjs";
import { captures } from "./readme-screenshots/scenarios.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const appUrl = new URL(args.url ?? "http://127.0.0.1:1425/");
const themeMode = normalizeThemeMode(args.theme);
const outputPath = path.resolve(
  repoRoot,
  args.output ?? ".updeng/docs/verification/ui-content-density.json",
);
const screenshotDir = path.resolve(
  repoRoot,
  args.screenshotDir ??
    ".updeng/docs/verification/ui-content-density-screenshots",
);
const baseline = args.baseline
  ? JSON.parse(readFileSync(path.resolve(repoRoot, args.baseline), "utf8"))
  : null;
const chromePath = findChromePath();
const chromePort = 10_700 + Math.floor(Math.random() * 300);
const userDataDir = path.join(
  tmpdir(),
  `kerminal-ui-content-density-${Date.now()}`,
);

if (!chromePath) {
  console.error("Chrome executable not found. Set CHROME_PATH to run this audit.");
  process.exit(1);
}

async function main() {
  await waitForHttpOk(appUrl, 30_000);
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
    { stdio: [ "ignore", "ignore", "pipe" ], windowsHide: true },
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
      height: Number(args.height ?? 1040),
      mobile: false,
      width: Number(args.width ?? 1600),
    });
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: browserBootstrapScript(),
    });
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `localStorage.setItem("kerminal.readme.capture.themeMode", ${JSON.stringify(themeMode)});`,
    });
    await client.send("Page.navigate", { url: appUrl.href });
    await waitForAppReady(client);

    if (args.screenshots) {
      mkdirSync(screenshotDir, { recursive: true });
    }

    const scenes = [];
    for (const capture of captures) {
      await capture.setup(client);
      await delay(500);
      await assertNoBlockingErrors(client);
      const metrics = await collectSceneMetrics(client);
      const scene = {
        name: capture.name.replace(/\.png$/i, ""),
        ...metrics,
      };
      if (args.screenshots) {
        const screenshot = await client.send("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
        });
        const screenshotPath = path.join(screenshotDir, capture.name);
        writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
        scene.screenshot = relativePath(screenshotPath);
      }
      scenes.push(scene);
    }

    const totals = aggregateScenes(scenes);
    const comparison = compareWithBaseline(totals, baseline?.totals);
    const failures = [];
    if (totals.technicalTermMatches.length > 0) {
      failures.push(
        `默认场景仍出现内部术语：${totals.technicalTermMatches
          .map((item) => item.term)
          .join("、")}`,
      );
    }
    if (
      baseline &&
      comparison.permanentTextReductionPercent !== null &&
      comparison.permanentTextReductionPercent < 25
    ) {
      failures.push(
        `非内容区文字仅减少 ${comparison.permanentTextReductionPercent.toFixed(1)}%，未达到 25%`,
      );
    }

    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      appUrl: appUrl.href,
      themeMode,
      viewport: {
        height: Number(args.height ?? 1040),
        width: Number(args.width ?? 1600),
      },
      exclusions: [
        "终端与 xterm 输出",
        "文件与编辑器正文",
        "pre/code/textarea/input/select",
        "aria-hidden、关闭的详情区与不可见节点",
      ],
      scenes,
      totals,
      comparison,
      failures,
      pass: failures.length === 0,
    };
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(
      `UI content density audit: ${report.pass ? "passed" : "needs review"}, ` +
        `${totals.permanentTextCharacters} characters across ${scenes.length} scenes.`,
    );
    console.log(`Report: ${relativePath(outputPath)}`);
    if (args.strict && !report.pass) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
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

async function collectSceneMetrics(client) {
  const result = await evaluate(
    client,
    `(() => {
      const excludedSelector = [
        ".xterm",
        "[data-terminal-workspace-content]",
        "[data-testid=\\"workspace-file-tab-surface\\"]",
        "[data-monaco-editor]",
        "pre",
        "code",
        "textarea",
        "input",
        "select",
        "[aria-hidden=\\"true\\"]"
      ].join(",");
      const technicalTerms = [
        "cfg:",
        "managed session",
        "SshAuthBroker",
        "legacy fallback",
        "unsupported/unwired",
        "paneId",
        "sessionId",
        "targetRef",
        "schemaVersion"
      ];
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || "1") > 0 &&
          rect.width > 0 &&
          rect.height > 0;
      };
      const hiddenByClosedDisclosure = (element) => {
        const closedDetails = element.closest("details:not([open])");
        if (!closedDetails) {
          return false;
        }
        const summary = element.closest("summary");
        return !summary || summary.parentElement !== closedDetails;
      };
      const textEntries = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const parent = node.parentElement;
        const text = node.textContent?.replace(/\\s+/g, " ").trim() ?? "";
        if (
          !parent ||
          !text ||
          parent.closest(excludedSelector) ||
          hiddenByClosedDisclosure(parent) ||
          !visible(parent)
        ) {
          continue;
        }
        textEntries.push({
          text,
          tag: parent.tagName.toLowerCase(),
          ariaLabel: parent.getAttribute("aria-label")
        });
      }
      const bodyText = textEntries.map((entry) => entry.text).join("\\n");
      const technicalTermMatches = technicalTerms
        .filter((term) => bodyText.toLowerCase().includes(term.toLowerCase()))
        .map((term) => ({
          term,
          samples: textEntries
            .filter((entry) => entry.text.toLowerCase().includes(term.toLowerCase()))
            .slice(0, 4)
            .map((entry) => entry.text)
        }));
      const visibleElements = Array.from(document.body.querySelectorAll("*"))
        .filter(
          (element) =>
            !element.closest(excludedSelector) &&
            !hiddenByClosedDisclosure(element) &&
            visible(element),
        );
      const borderedSurfaceCount = visibleElements.filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return parseFloat(style.borderTopWidth) > 0 && rect.width > 40 && rect.height > 24;
      }).length;
      const badgeCount = visibleElements.filter((element) => {
        const className = String(element.className ?? "");
        const rect = element.getBoundingClientRect();
        return /text-(xs|\\[11px\\])/.test(className) &&
          /rounded/.test(className) &&
          rect.width < 220 &&
          rect.height <= 36;
      }).length;
      return {
        permanentTextCharacters: textEntries.reduce((sum, entry) => sum + entry.text.length, 0),
        permanentTextNodeCount: textEntries.length,
        badgeCount,
        borderedSurfaceCount,
        technicalTermMatches,
        longestTextEntries: [...textEntries]
          .sort((left, right) => right.text.length - left.text.length)
          .slice(0, 12)
      };
    })()`,
    { returnByValue: true },
  );
  return result.result.value;
}

function aggregateScenes(scenes) {
  const matchMap = new Map();
  for (const scene of scenes) {
    for (const match of scene.technicalTermMatches) {
      const current = matchMap.get(match.term) ?? [];
      matchMap.set(match.term, [
        ...current,
        ...match.samples.map((sample) => ({ sample, scene: scene.name })),
      ]);
    }
  }
  return {
    permanentTextCharacters: scenes.reduce(
      (sum, scene) => sum + scene.permanentTextCharacters,
      0,
    ),
    permanentTextNodeCount: scenes.reduce(
      (sum, scene) => sum + scene.permanentTextNodeCount,
      0,
    ),
    badgeCount: scenes.reduce((sum, scene) => sum + scene.badgeCount, 0),
    borderedSurfaceCount: scenes.reduce(
      (sum, scene) => sum + scene.borderedSurfaceCount,
      0,
    ),
    technicalTermMatches: Array.from(matchMap, ([term, occurrences]) => ({
      term,
      occurrences: occurrences.slice(0, 12),
    })),
  };
}

function compareWithBaseline(current, baselineTotals) {
  if (!baselineTotals) {
    return {
      baselineProvided: false,
      permanentTextReductionPercent: null,
    };
  }
  const baselineCharacters = Number(baselineTotals.permanentTextCharacters || 0);
  const reduction =
    baselineCharacters > 0
      ? ((baselineCharacters - current.permanentTextCharacters) /
          baselineCharacters) *
        100
      : null;
  return {
    baselineProvided: true,
    baselinePermanentTextCharacters: baselineCharacters,
    permanentTextReductionPercent: reduction,
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--strict") {
      parsed.strict = true;
      continue;
    }
    if (item === "--screenshots") {
      parsed.screenshots = true;
      continue;
    }
    if (!item.startsWith("--")) {
      continue;
    }
    parsed[item.slice(2)] = argv[index + 1];
    index += 1;
  }
  return parsed;
}

function normalizeThemeMode(value) {
  const normalized = String(value ?? "dark").trim();
  if (normalized === "light" || normalized === "dark" || normalized === "system") {
    return normalized;
  }
  throw new Error("--theme must be light, dark, or system.");
}

function relativePath(filePath) {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/");
}

await main();
