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
  "terminal-renderer-lifecycle-stress.json",
);
const startedAt = Date.now();
const result = await run(process.execPath, [
  "node_modules/vitest/vitest.mjs",
  "run",
  "--run",
  "tests/frontend/features/terminal/terminalRendererLifecycleStress.test.ts",
]);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  cycles: 500,
  durationMs: Date.now() - startedAt,
  exitCode: result.exitCode,
  pass: result.exitCode === 0,
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
console.log(
  `Terminal renderer lifecycle stress: ${report.pass ? "passed" : "failed"}, ${report.cycles} cycles.`,
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
