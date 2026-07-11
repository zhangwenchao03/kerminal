#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const args = parseArgs(process.argv.slice(2));
const backends = readList(
  args.backend ?? "cpu,gpu,auto",
  new Set(["cpu", "gpu", "auto"]),
  "--backend",
);
const panes = readIntegerList(args.panes ?? "1,4,6,8", "--panes");
const chunks = readPositiveInteger(args.chunks, 180, "--chunks");
const outputPath = path.resolve(
  repoRoot,
  args.output ??
    ".updeng/docs/verification/terminal-renderer-performance.json",
);
const runs = [];

for (const backend of backends) {
  for (const paneCount of panes) {
    const runOutput = path.join(
      repoRoot,
      ".updeng",
      "tmp",
      `terminal-renderer-perf-${backend}-${paneCount}.json`,
    );
    const result = await run(process.execPath, [
      "scripts/verify-terminal-gpu-recovery-smoke.mjs",
      "--backend",
      backend,
      "--chunks",
      String(chunks),
      "--output",
      runOutput,
      "--panes",
      String(paneCount),
      "--screenshot",
      "false",
    ]);
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (result.exitCode !== 0) {
      runs.push({
        backend,
        exitCode: result.exitCode,
        panes: paneCount,
        pass: false,
      });
      continue;
    }
    const report = JSON.parse(readFileSync(runOutput, "utf8"));
    runs.push({
      backend,
      exitCode: 0,
      gpuClass: report.webgl?.gpuClass ?? "unknown",
      implementationCoverage: report.implementationCoverage ?? [],
      panes: paneCount,
      pass: Boolean(report.pass),
      performance: report.performance,
      registry: {
        atlasEpoch: report.registry?.atlasEpoch ?? 0,
        recoveryCount: report.registry?.recoveryCount ?? 0,
        webglCanvasCount: report.registry?.webglCanvasCount ?? 0,
      },
    });
    rmSync(runOutput, { force: true });
  }
}

const summary = {
  maxFrameGapP95Ms: maxMetric(runs, "frameGapMs", "p95"),
  maxLongTaskMs: Math.max(
    0,
    ...runs.map((run) => run.performance?.longTasks?.maxMs ?? 0),
  ),
  maxWriteCallbackP95Ms: maxMetric(runs, "writeCallbackMs", "p95"),
  pass: runs.every(
    (run) =>
      run.pass &&
      (run.performance?.frameGapMs?.p95 ?? Infinity) <= 20 &&
      (run.performance?.writeCallbackMs?.p95 ?? Infinity) <= 16 &&
      (run.performance?.longTasks?.maxMs ?? Infinity) <= 200,
  ),
};
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  config: { backends, chunks, panes },
  runs,
  summary,
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(
  `Terminal renderer performance: ${summary.pass ? "passed" : "failed"}, ${runs.length} runs, max frame p95 ${summary.maxFrameGapP95Ms.toFixed(2)} ms.`,
);
console.log(`Report: ${path.relative(repoRoot, outputPath)}`);
process.exitCode = summary.pass ? 0 : 1;

function maxMetric(values, group, metric) {
  return Math.max(
    0,
    ...values.map((value) => value.performance?.[group]?.[metric] ?? 0),
  );
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const key = rawArgs[index];
    if (!key?.startsWith("--")) {
      continue;
    }
    const value = rawArgs[index + 1];
    if (!value || value.startsWith("--")) {
      parsed[key.slice(2)] = true;
      continue;
    }
    parsed[key.slice(2)] = value;
    index += 1;
  }
  return parsed;
}

function readList(value, allowed, label) {
  const values = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (values.length === 0 || values.some((entry) => !allowed.has(entry))) {
    throw new Error(`${label} contains an unsupported value.`);
  }
  return values;
}

function readIntegerList(value, label) {
  const values = value
    .split(",")
    .map((entry) => Number.parseInt(entry.trim(), 10));
  if (
    values.length === 0 ||
    values.some((entry) => !Number.isInteger(entry) || entry <= 0)
  ) {
    throw new Error(`${label} must contain positive integers.`);
  }
  return values;
}

function readPositiveInteger(value, fallback, label) {
  const parsed = value === undefined ? fallback : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function run(command, commandArgs) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stderr, stdout });
    });
  });
}
