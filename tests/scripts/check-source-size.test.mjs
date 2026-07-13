// @author kongweiguang

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const verifier = path.join(repoRoot, "scripts", "check-source-size.mjs");
const baselineRelativePath = "scripts/source-size-baseline.json";
const scanRoots = [
  "src",
  "src-tauri/src",
  "tests/frontend",
  "tests/scripts",
  "src-tauri/tests",
  "scripts",
];
const sourceExtensions = [".css", ".mjs", ".rs", ".ts", ".tsx"];

test("扫描前端测试和人工 CSS，并拒绝未登记的 800 行债务", (context) => {
  const fixture = createFixture(context);
  writeLines(fixture, "tests/frontend/oversized.test.ts", 800);
  writeLines(fixture, "src/oversized.css", 800);
  writeBaseline(fixture, []);

  const result = runVerifier(fixture);

  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /tests\/frontend\/oversized\.test\.ts/);
  assert.match(result.output, /src\/oversized\.css/);
  assert.match(result.output, /New debt not present in the baseline/);
});

test("当前债务与受控 baseline 完全一致时门禁可用", (context) => {
  const fixture = createFixture(context);
  const outputPath = path.join(fixture, "report.json");
  writeLines(fixture, "src/legacy.ts", 800);
  writeBaseline(fixture, [debt("src/legacy.ts", 800)]);

  const result = runVerifier(fixture, ["--output", outputPath]);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8"));

  assert.equal(result.status, 0, result.output);
  assert.equal(report.pass, true);
  assert.equal(report.targetHardLimit, 800);
  assert.deepEqual(report.scanRoots, scanRoots);
  assert.deepEqual(report.sourceExtensions, sourceExtensions);
  assert.deepEqual(report.baselineDebt, [
    { file: "src/legacy.ts", lines: 800 },
  ]);
});

test("已登记文件增长时同时触发快照和增长失败", (context) => {
  const fixture = createFixture(context);
  writeLines(fixture, "src/legacy.ts", 801);
  writeBaseline(fixture, [debt("src/legacy.ts", 800)]);

  const result = runVerifier(fixture);

  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Debt that grew beyond its baseline/);
  assert.match(result.output, /800 -> 801\s+src\/legacy\.ts/);
  assert.match(result.output, /Baseline snapshot is stale/);
});

test("债务下降或清零后必须在同一变更收紧 baseline", (context) => {
  const fixture = createFixture(context);
  const baselinePath = path.join(fixture, baselineRelativePath);
  writeLines(fixture, "src/legacy.ts", 799);
  writeBaseline(fixture, [debt("src/legacy.ts", 800)]);

  const staleResult = runVerifier(fixture);
  assert.equal(staleResult.status, 1, staleResult.output);
  assert.match(staleResult.output, /800 -> 799\s+src\/legacy\.ts/);

  const updateResult = runVerifier(fixture, ["--write-baseline"]);
  const updated = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  assert.equal(updateResult.status, 0, updateResult.output);
  assert.deepEqual(updated.entries, []);
  assert.match(updateResult.output, /completion requires zero baseline debt/);
});

test("目标分支 reference baseline 阻止提高既有额度", (context) => {
  const fixture = createFixture(context);
  const referencePath = path.join(fixture, "reference.json");
  writeLines(fixture, "src/legacy.ts", 810);
  writeBaseline(fixture, [debt("src/legacy.ts", 810)]);
  fs.writeFileSync(
    referencePath,
    `${JSON.stringify(baseline([debt("src/legacy.ts", 800)]), null, 2)}\n`,
  );

  const result = runVerifier(fixture, [
    "--reference-baseline",
    referencePath,
  ]);

  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Baseline ratchet regressed/);
  assert.match(result.output, /800 -> 810\s+src\/legacy\.ts/);
});

test("目标分支 reference baseline 阻止登记新债务", (context) => {
  const fixture = createFixture(context);
  const referencePath = path.join(fixture, "reference.json");
  writeLines(fixture, "src/new-debt.ts", 800);
  writeBaseline(fixture, [debt("src/new-debt.ts", 800)]);
  fs.writeFileSync(referencePath, `${JSON.stringify(baseline([]), null, 2)}\n`);

  const result = runVerifier(fixture, [
    "--reference-baseline",
    referencePath,
  ]);

  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /new -> 800\s+src\/new-debt\.ts/);
  assert.match(result.output, /new-baseline-debt/);
});

test("baseline 不能把最终硬门槛放宽到 1000 行", (context) => {
  const fixture = createFixture(context);
  const invalid = baseline([]);
  invalid.targetHardLimit = 1000;
  writeBaselineValue(fixture, invalid);

  const result = runVerifier(fixture);

  assert.equal(result.status, 2, result.output);
  assert.match(result.output, /targetHardLimit must stay 800/);
});

function createFixture(context) {
  const fixture = fs.mkdtempSync(
    path.join(os.tmpdir(), "kerminal-source-size-fixture-"),
  );
  context.after(() => fs.rmSync(fixture, { force: true, recursive: true }));
  fs.mkdirSync(path.join(fixture, "scripts"), { recursive: true });
  return fixture;
}

function writeLines(root, relativePath, lines) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    Array.from({ length: lines }, (_, index) => `line-${index + 1}`).join("\n"),
  );
}

function debt(file, lines) {
  return {
    deadline: "before TASK-080",
    file,
    lines,
    owner: "test-owner",
    targetTask: "TASK-071",
  };
}

function baseline(entries) {
  return {
    schemaVersion: 1,
    targetHardLimit: 800,
    warningLimit: 500,
    scanRoots,
    sourceExtensions,
    entries: [...entries].sort((left, right) =>
      left.file.localeCompare(right.file),
    ),
  };
}

function writeBaseline(root, entries) {
  writeBaselineValue(root, baseline(entries));
}

function writeBaselineValue(root, value) {
  const filePath = path.join(root, baselineRelativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runVerifier(root, args = []) {
  const result = spawnSync(
    process.execPath,
    [
      verifier,
      "--repo-root",
      root,
      "--baseline",
      baselineRelativePath,
      ...args,
    ],
    { encoding: "utf8" },
  );
  return {
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    status: result.status,
  };
}
