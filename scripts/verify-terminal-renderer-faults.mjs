#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputPath = path.join(
  repoRoot,
  ".updeng",
  "docs",
  "verification",
  "terminal-renderer-faults.json",
);
const testFiles = [
  "tests/frontend/features/terminal/terminalRenderer.test.ts",
  "tests/frontend/features/terminal/terminalRendererLifecycle.test.ts",
  "tests/frontend/features/terminal/terminalRendererHealth.test.ts",
  "tests/frontend/features/terminal/terminalRendererHealthWatchdog.test.ts",
  "tests/frontend/features/terminal/terminalRendererCompatibility.test.ts",
  "tests/frontend/features/terminal/terminalRendererFeatureGates.test.ts",
  "tests/frontend/features/terminal/terminalRendererPolicy.test.ts",
  "tests/frontend/features/terminal/terminalRendererRegistry.test.ts",
  "tests/frontend/features/terminal/terminalGpuRenderRecovery.test.ts",
  "tests/frontend/features/terminal/terminalGpuRenderRecoveryPolicy.test.ts",
  "tests/frontend/features/terminal/terminalGpuRenderRecoveryRuntime.test.ts",
  "tests/frontend/features/terminal/terminalRendererSurfaceCoordinator.test.ts",
];

const startedAt = Date.now();
const result = await run(process.execPath, [
  "node_modules/vitest/vitest.mjs",
  "run",
  "--run",
  ...testFiles,
]);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt,
  exitCode: result.exitCode,
  pass: result.exitCode === 0,
  scenarios: [
    "import-reject",
    "load-throw",
    "attach-timeout",
    "context-loss",
    "context-loss-storm",
    "stale-attach",
    "dispose-during-retry",
    "mode-cpu-during-attach",
    "canvas-detached",
    "canvas-zero-size",
    "atlas-throw",
    "resize-dpr-coalescing",
    "manual-retry",
    "circuit-breaker",
  ],
  testFiles,
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
console.log(
  `Terminal renderer fault matrix: ${report.pass ? "passed" : "failed"}.`,
);
console.log(`Report: ${path.relative(repoRoot, outputPath)}`);
process.exitCode = result.exitCode;

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
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
