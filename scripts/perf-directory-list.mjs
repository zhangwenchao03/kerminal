#!/usr/bin/env node
// @author kongweiguang

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const outputPath = path.resolve(
  repoRoot,
  args.output ?? ".updeng/docs/verification/perf-directory-list-baseline.json",
);
const config = {
  counts: readIntegerList(args.counts ?? "200,1000,5000", "--counts"),
  overscan: readInteger(args.overscan ?? "8", "--overscan"),
  rowHeight: readInteger(args.rowHeight ?? "44", "--row-height"),
  targets: readTargetList(args.targets ?? "sftp,local"),
  threshold: readInteger(args.threshold ?? "120", "--threshold"),
  viewportRows: readInteger(args.viewportRows ?? "14", "--viewport-rows"),
};

const { JSDOM } = await import("jsdom");
const results = [];
for (const target of config.targets) {
  for (const entryCount of config.counts) {
    results.push(measureDirectoryRender({ entryCount, target }));
  }
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  git: readGitMetadata(),
  environment: {
    jsdom: readPackageVersion("jsdom"),
    node: process.version,
    platform: platform(),
  },
  config,
  directoryList: results,
  summary: {
    maxDomNodeCount: Math.max(...results.map((result) => result.domNodeCount)),
    maxElapsedMs: Math.max(...results.map((result) => result.elapsedMs)),
    pass: results.every((result) => result.virtualizationSmoke && result.selectedRowSmoke),
    resultCount: results.length,
  },
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(
  `Directory list baseline: ${results.length} runs, max ${report.summary.maxElapsedMs.toFixed(
    2,
  )} ms, max ${report.summary.maxDomNodeCount} DOM nodes.`,
);
console.log(`Report: ${path.relative(repoRoot, outputPath).replaceAll("\\", "/")}`);

if (!report.summary.pass) {
  process.exitCode = 1;
}

function measureDirectoryRender({ entryCount, target }) {
  const entries = target === "sftp" ? buildSftpEntries(entryCount) : buildLocalEntries(entryCount);
  const dom = new JSDOM("<!doctype html><main id=\"root\"></main>");
  const document = dom.window.document;
  const root = document.getElementById("root");
  const heapStartBytes = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  const fragment = document.createDocumentFragment();
  const virtualized = entryCount > config.threshold;
  const midpoint = Math.floor(entryCount / 2);
  const viewportHeight = config.viewportRows * config.rowHeight;
  const virtualWindow = virtualized
    ? resolveVirtualFixedListWindow({
        itemCount: entryCount,
        overscan: config.overscan,
        rowHeight: config.rowHeight,
        scrollTop: midpoint * config.rowHeight,
        viewportHeight,
      })
    : {
        bottomSpacerHeight: 0,
        endIndexExclusive: entryCount,
        startIndex: 0,
        topSpacerHeight: 0,
      };
  const renderedEntries = entries.slice(
    virtualWindow.startIndex,
    virtualWindow.endIndexExclusive,
  );

  if (virtualized && virtualWindow.topSpacerHeight > 0) {
    fragment.appendChild(createSpacer(document, virtualWindow.topSpacerHeight));
  }

  for (const entry of renderedEntries) {
    const row = document.createElement("button");
    row.dataset.entryRow = "true";
    row.dataset.kind = entry.kind;
    row.dataset.path = entry.path;
    row.type = "button";
    row.className = "directory-row";
    row.textContent = `${entry.kind} ${entry.name} ${entry.size} ${entry.modifiedAt}`;
    fragment.appendChild(row);
  }

  if (virtualized && virtualWindow.bottomSpacerHeight > 0) {
    fragment.appendChild(createSpacer(document, virtualWindow.bottomSpacerHeight));
  }

  root.appendChild(fragment);
  const selected = Array.from(root.querySelectorAll("[data-entry-row]")).find(
    (row) => row.dataset.path === entries[midpoint]?.path,
  );
  if (selected) {
    selected.setAttribute("aria-selected", "true");
  }

  const elapsedMs = performance.now() - startedAt;
  const rows = root.querySelectorAll("[data-entry-row]");
  const heapEndBytes = process.memoryUsage().heapUsed;
  const selectedRowSmoke = selected?.getAttribute("aria-selected") === "true";
  const result = {
    domNodeCount: root.querySelectorAll("*").length,
    elapsedMs,
    entryCount,
    heap: {
      deltaBytes: heapEndBytes - heapStartBytes,
      endBytes: heapEndBytes,
      startBytes: heapStartBytes,
    },
    maxExpectedRenderedRows: virtualized
      ? config.viewportRows + config.overscan * 2
      : entryCount,
    renderedRows: rows.length,
    selectedRowSmoke,
    target,
    virtualized,
    virtualizationSmoke: virtualized
      ? rows.length <= config.viewportRows + config.overscan * 2
      : rows.length === entryCount,
  };

  dom.window.close();
  return result;
}

function resolveVirtualFixedListWindow({
  itemCount,
  overscan,
  rowHeight,
  scrollTop,
  viewportHeight,
}) {
  const totalHeight = itemCount * rowHeight;
  const maxScrollTop = Math.max(0, totalHeight - Math.max(0, viewportHeight));
  const clampedScrollTop = Math.min(maxScrollTop, Math.max(0, scrollTop));
  const firstVisibleIndex = Math.min(
    Math.max(0, itemCount - 1),
    Math.floor(clampedScrollTop / rowHeight),
  );
  const visibleCount = Math.max(1, Math.ceil(Math.max(0, viewportHeight) / rowHeight));
  const startIndex = Math.max(0, firstVisibleIndex - overscan);
  const endIndexExclusive = Math.min(
    itemCount,
    firstVisibleIndex + visibleCount + overscan,
  );

  return {
    bottomSpacerHeight: Math.max(0, (itemCount - endIndexExclusive) * rowHeight),
    endIndexExclusive,
    startIndex,
    topSpacerHeight: startIndex * rowHeight,
  };
}

function createSpacer(document, height) {
  const spacer = document.createElement("div");
  spacer.dataset.virtualSpacer = "true";
  spacer.style.height = `${height}px`;
  return spacer;
}

function buildSftpEntries(count) {
  return Array.from({ length: count }, (_, index) => {
    const isDirectory = index % 9 === 0;
    return {
      kind: isDirectory ? "directory" : "file",
      modifiedAt: `2026-06-${((index % 28) + 1).toString().padStart(2, "0")}T12:00:00Z`,
      name: `${isDirectory ? "dir" : "file"}-${index.toString().padStart(5, "0")}`,
      path: `/srv/data/${index.toString().padStart(5, "0")}`,
      size: isDirectory ? 0 : 1024 + index,
    };
  });
}

function buildLocalEntries(count) {
  return Array.from({ length: count }, (_, index) => {
    const isDirectory = index % 7 === 0;
    return {
      kind: isDirectory ? "directory" : "file",
      modifiedAt: `2026-06-${((index % 28) + 1).toString().padStart(2, "0")}T08:00:00Z`,
      name: `${isDirectory ? "folder" : "artifact"}-${index.toString().padStart(5, "0")}`,
      path: `C:/work/data/${index.toString().padStart(5, "0")}`,
      size: isDirectory ? 0 : 2048 + index,
    };
  });
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

function readIntegerList(value, label) {
  const parsed = value
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isInteger(item) && item > 0);
  if (parsed.length === 0) {
    throw new Error(`${label} must contain at least one positive integer.`);
  }
  return parsed;
}

function readInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function readTargetList(value) {
  const allowed = new Set(["sftp", "local"]);
  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => allowed.has(item));
  if (parsed.length === 0) {
    throw new Error("--targets must include sftp, local, or both.");
  }
  return parsed;
}

function readPackageVersion(packageName) {
  try {
    const packageJsonPath = path.join(repoRoot, "node_modules", packageName, "package.json");
    return JSON.parse(readFileSync(packageJsonPath, "utf8")).version ?? null;
  } catch {
    return null;
  }
}

function readGitMetadata() {
  return {
    branch: runGit(["rev-parse", "--abbrev-ref", "HEAD"]),
    commit: runGit(["rev-parse", "--short", "HEAD"]),
    dirty: runGit(["status", "--short"]) !== "",
  };
}

function runGit(argsForGit) {
  try {
    return execFileSync("git", argsForGit, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}
