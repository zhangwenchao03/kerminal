#!/usr/bin/env node
/**
 * Chrome WebGL 平台矩阵。
 *
 * 分开验证硬件与 SwiftShader 软件 GPU，DPR 只用于浏览器 surface/renderer
 * 恢复协议验证，不能替代真实跨显示器或 Windows scaling 人工认证。
 *
 * @author kongweiguang
 */

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
  args.backend ?? "auto,gpu",
  new Set(["auto", "gpu"]),
  "--backend",
);
const dprs = readPositiveNumberList(args.dpr ?? "1,1.25,1.5,2", "--dpr");
const gpuModes = readList(
  args["gpu-mode"] ?? "hardware,software",
  new Set(["hardware", "software"]),
  "--gpu-mode",
);
const chunks = readPositiveInteger(args.chunks, 60, "--chunks");
const panes = readPositiveInteger(args.panes, 6, "--panes");
const outputPath = path.resolve(
  repoRoot,
  args.output ??
    ".updeng/docs/verification/terminal-renderer-platform-matrix.json",
);
const runs = [];

for (const gpuMode of gpuModes) {
  for (const backend of backends) {
    for (const dpr of dprs) {
      const runOutput = path.join(
        repoRoot,
        ".updeng",
        "tmp",
        `terminal-renderer-platform-${process.pid}-${gpuMode}-${backend}-p${panes}-dpr${String(dpr).replace(".", "_")}.json`,
      );
      const result = await run(process.execPath, [
        "scripts/verify-terminal-gpu-recovery-smoke.mjs",
        "--backend",
        backend,
        "--chunks",
        String(chunks),
        "--dpr",
        String(dpr),
        "--gpu-mode",
        gpuMode,
        "--output",
        runOutput,
        "--panes",
        String(panes),
        "--screenshot",
        "false",
      ]);
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      if (result.exitCode !== 0) {
        runs.push({
          backend,
          dpr,
          exitCode: result.exitCode,
          gpuMode,
          panes,
          pass: false,
        });
        continue;
      }
      const report = JSON.parse(readFileSync(runOutput, "utf8"));
      const frameGapP95Ms = report.performance?.frameGapMs?.p95 ?? null;
      const writeCallbackP95Ms =
        report.performance?.writeCallbackMs?.p95 ?? null;
      const performancePass =
        (frameGapP95Ms ?? Infinity) <= 20 &&
        (writeCallbackP95Ms ?? Infinity) <= 16;
      const performanceRequired =
        gpuMode === "hardware" || backend === "auto";
      runs.push({
        backend,
        dpr,
        exitCode: 0,
        frameGapP95Ms,
        gpuClass: report.webgl?.gpuClass ?? "unknown",
        gpuMode,
        gpuModeMatches: report.gpuModeMatches === true,
        panes,
        pass: report.pass === true,
        performancePass,
        performanceRequired,
        registry: {
          activeControllers: report.registry?.activeControllers ?? 0,
          effectiveGpuPanes: report.registry?.effectiveGpuPanes ?? 0,
          webglCanvasCount: report.registry?.webglCanvasCount ?? 0,
        },
        writeCallbackP95Ms,
      });
      rmSync(runOutput, { force: true });
    }
  }
}

const summary = {
  maxFrameGapP95Ms: maxNumber(runs.map((run) => run.frameGapP95Ms)),
  maxWriteCallbackP95Ms: maxNumber(
    runs.map((run) => run.writeCallbackP95Ms),
  ),
  pass: runs.every(
    (run) =>
      run.pass &&
      run.gpuModeMatches &&
      (!run.performanceRequired || run.performancePass),
  ),
  runCount: runs.length,
};
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  config: { backends, chunks, dprs, gpuModes, panes },
  runs,
  summary,
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(
  `Terminal renderer platform matrix: ${summary.pass ? "passed" : "failed"}, ${summary.runCount} runs.`,
);
console.log(`Report: ${path.relative(repoRoot, outputPath)}`);
process.exitCode = summary.pass ? 0 : 1;

function maxNumber(values) {
  return Math.max(
    0,
    ...values.filter((value) => typeof value === "number"),
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

function readPositiveInteger(value, fallback, label) {
  const parsed = value === undefined ? fallback : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function readPositiveNumberList(value, label) {
  const values = value
    .split(",")
    .map((entry) => Number(entry.trim()));
  if (
    values.length === 0 ||
    values.some((entry) => !Number.isFinite(entry) || entry <= 0)
  ) {
    throw new Error(`${label} must contain positive numbers.`);
  }
  return values;
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
