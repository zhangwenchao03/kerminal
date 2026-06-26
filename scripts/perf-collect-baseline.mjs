#!/usr/bin/env node
// @author kongweiguang

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const dateStamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const outputPath = path.resolve(
  repoRoot,
  args.output ?? `.updeng/docs/verification/performance-baseline-${dateStamp}.json`,
);
const verificationDir = path.join(repoRoot, ".updeng", "docs", "verification");

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  git: readGitMetadata(),
  environment: {
    node: process.version,
    platform: platform(),
  },
  reports: {
    directoryList: readReport("perf-directory-list-baseline.json"),
    frontendBundle: readReport("frontend-bundle-baseline.json"),
    terminalOutput: readReport("terminal-output-baseline.json"),
  },
  rustTimings: latestCargoTimingReport(),
};

report.summary = {
  directoryListPass: report.reports.directoryList?.summary?.pass ?? null,
  frontendAssetCount: report.reports.frontendBundle?.assetCount ?? null,
  frontendRawBytes: report.reports.frontendBundle?.totals?.bytes ?? null,
  latestCargoTimingReport: report.rustTimings?.path ?? null,
  pass:
    report.reports.directoryList?.summary?.pass === true &&
    report.reports.terminalOutput?.summary?.pass === true &&
    Boolean(report.reports.frontendBundle),
  terminalOutputPass: report.reports.terminalOutput?.summary?.pass ?? null,
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Performance baseline summary: ${report.summary.pass ? "pass" : "incomplete"}.`);
console.log(`Report: ${path.relative(repoRoot, outputPath).replaceAll("\\", "/")}`);

if (!report.summary.pass) {
  process.exitCode = 1;
}

function readReport(fileName) {
  const filePath = path.join(verificationDir, fileName);
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function latestCargoTimingReport() {
  const timingDir = path.join(repoRoot, "src-tauri", "target", "cargo-timings");
  if (!existsSync(timingDir)) {
    return null;
  }
  const latest = readdirSync(timingDir)
    .filter((fileName) => fileName.endsWith(".html") && fileName !== "cargo-timing.html")
    .map((fileName) => {
      const filePath = path.join(timingDir, fileName);
      return {
        fileName,
        filePath,
        stat: statSync(filePath),
      };
    })
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)[0];
  if (!latest) {
    return null;
  }
  return {
    generatedAt: latest.stat.mtime.toISOString(),
    path: path.relative(repoRoot, latest.filePath).replaceAll("\\", "/"),
    sizeBytes: latest.stat.size,
  };
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
