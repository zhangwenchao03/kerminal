#!/usr/bin/env node
// @author kongweiguang

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TARGET_HARD_LIMIT = 800;
const WARNING_LIMIT = 500;
const BASELINE_SCHEMA_VERSION = 1;
const DEFAULT_BASELINE_PATH = "scripts/source-size-baseline.json";
const DEFAULT_SCAN_ROOTS = Object.freeze([
  "src",
  "src-tauri/src",
  "tests/frontend",
  "tests/scripts",
  "src-tauri/tests",
  "scripts",
]);
const SOURCE_EXTENSIONS = Object.freeze([".css", ".mjs", ".rs", ".ts", ".tsx"]);
const SOURCE_EXTENSION_SET = new Set(SOURCE_EXTENSIONS);
const IGNORED_DIRECTORY_NAMES = new Set([
  ".codex",
  ".codegraph",
  ".git",
  ".updeng",
  "dist",
  "node_modules",
  "target",
  "tmp",
]);

try {
  main();
} catch (error) {
  console.error(`Source size gate configuration error: ${errorMessage(error)}`);
  process.exitCode = 2;
}

function main() {
  const options = parseOptions(process.argv.slice(2));
  const defaultRepoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const repoRoot = options.repoRoot
    ? path.resolve(process.cwd(), options.repoRoot)
    : defaultRepoRoot;
  const baselinePath = resolveFromRepo(
    repoRoot,
    options.baseline ?? DEFAULT_BASELINE_PATH,
  );
  const records = scanSourceRecords(repoRoot);
  const previousBaseline = existsSync(baselinePath)
    ? readBaseline(baselinePath, "current")
    : null;

  if (options.writeBaseline) {
    const nextBaseline = buildBaseline(records, previousBaseline);
    writeJson(baselinePath, nextBaseline);
    console.log(
      `Updated source-size baseline: ${relativeDisplayPath(repoRoot, baselinePath)} (${nextBaseline.entries.length} debt files).`,
    );
  }

  if (!existsSync(baselinePath)) {
    throw new Error(
      `baseline does not exist: ${relativeDisplayPath(repoRoot, baselinePath)}; bootstrap it with --write-baseline`,
    );
  }

  const baseline = readBaseline(baselinePath, "current");
  const referenceBaseline = options.referenceBaseline
    ? readBaseline(
        resolveFromRepo(repoRoot, options.referenceBaseline),
        "reference",
      )
    : null;
  const report = evaluateRecords(records, baseline, referenceBaseline);

  if (options.output) {
    writeJson(resolveFromRepo(repoRoot, options.output), report);
  }

  printSummary(report);
  if (!report.pass) {
    process.exitCode = 1;
  }
}

function parseOptions(args) {
  const options = {
    baseline: null,
    output: null,
    referenceBaseline:
      process.env.KERMINAL_SOURCE_SIZE_REFERENCE_BASELINE?.trim() || null,
    repoRoot: null,
    writeBaseline: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--write-baseline") {
      options.writeBaseline = true;
      continue;
    }
    const key = {
      "--baseline": "baseline",
      "--output": "output",
      "--reference-baseline": "referenceBaseline",
      "--repo-root": "repoRoot",
    }[argument];
    if (!key) {
      throw new Error(`unknown argument: ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${argument}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function scanSourceRecords(repoRoot) {
  return DEFAULT_SCAN_ROOTS.flatMap((root) =>
    collectSourceFiles(path.join(repoRoot, root)),
  )
    .map((filePath) => ({
      file: path.relative(repoRoot, filePath).replaceAll("\\", "/"),
      lines: countPhysicalLines(filePath),
    }))
    .sort((left, right) =>
      right.lines - left.lines || left.file.localeCompare(right.file),
    );
}

function collectSourceFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }
  const collected = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORY_NAMES.has(entry.name)) {
        collected.push(...collectSourceFiles(absolutePath));
      }
      continue;
    }
    if (
      entry.isFile() &&
      SOURCE_EXTENSION_SET.has(path.extname(entry.name).toLowerCase())
    ) {
      collected.push(absolutePath);
    }
  }
  return collected;
}

function countPhysicalLines(filePath) {
  const content = readFileSync(filePath, "utf8");
  return content.length === 0 ? 0 : content.split(/\r\n|\r|\n/).length;
}

function buildBaseline(records, previousBaseline) {
  const previousEntries = new Map(
    (previousBaseline?.entries ?? []).map((entry) => [entry.file, entry]),
  );
  const entries = records
    .filter((record) => record.lines >= TARGET_HARD_LIMIT)
    .map((record) => {
      const previous = previousEntries.get(record.file);
      return {
        file: record.file,
        lines: record.lines,
        ...(previous
          ? {
              deadline: previous.deadline,
              owner: previous.owner,
              targetTask: previous.targetTask,
            }
          : baselineOwnership(record.file)),
      };
    })
    .sort((left, right) => left.file.localeCompare(right.file));
  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    targetHardLimit: TARGET_HARD_LIMIT,
    warningLimit: WARNING_LIMIT,
    scanRoots: [...DEFAULT_SCAN_ROOTS],
    sourceExtensions: [...SOURCE_EXTENSIONS],
    entries,
  };
}

/**
 * 初次建立债务台账时按领域给出 owner 和计划任务；后续更新行数时保留人工修订值。
 * 新增债务仍会被 reference baseline 拒绝，不能用自动生成绕过 ratchet。
 */
function baselineOwnership(file) {
  const common = { deadline: "before TASK-080" };
  if (file === "src/App.css") {
    return { ...common, owner: "ui-unification", targetTask: "TASK-073" };
  }
  if (file.startsWith("tests/") || file.startsWith("src-tauri/tests/")) {
    return { ...common, owner: "test-architecture", targetTask: "TASK-071" };
  }
  if (file.startsWith("scripts/")) {
    return { ...common, owner: "quality-governance", targetTask: "TASK-071" };
  }
  if (file.startsWith("src/features/sftp/")) {
    return { ...common, owner: "sftp-frontend", targetTask: "TASK-040/TASK-041" };
  }
  if (file.startsWith("src-tauri/src/services/sftp_service")) {
    return { ...common, owner: "sftp-rust", targetTask: "TASK-042" };
  }
  if (
    file.startsWith("src/features/terminal/") ||
    file.includes("terminal_manager.rs") ||
    file.includes("ssh_runtime/")
  ) {
    return { ...common, owner: "terminal-runtime", targetTask: "TASK-050/TASK-052" };
  }
  if (file.startsWith("src/features/workspace/") || file.startsWith("src/app/")) {
    return { ...common, owner: "workspace-composition", targetTask: "TASK-030/TASK-031" };
  }
  if (file.includes("config_file_store")) {
    return { ...common, owner: "configuration-storage", targetTask: "TASK-060" };
  }
  if (
    file.startsWith("src/features/machine-sidebar/") ||
    file.startsWith("src/features/tool-panel/") ||
    file.startsWith("src/features/settings/") ||
    file.startsWith("src/features/workflows/")
  ) {
    return { ...common, owner: "frontend-architecture", targetTask: "TASK-070" };
  }
  return { ...common, owner: "architecture-governance", targetTask: "TASK-072" };
}

function readBaseline(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`${label} baseline does not exist: ${filePath}`);
  }
  let value;
  try {
    value = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} baseline is not valid JSON: ${errorMessage(error)}`);
  }
  validateBaseline(value, label);
  return value;
}

function validateBaseline(value, label) {
  if (!value || typeof value !== "object") {
    throw new Error(`${label} baseline must be an object`);
  }
  if (value.schemaVersion !== BASELINE_SCHEMA_VERSION) {
    throw new Error(
      `${label} baseline schemaVersion must be ${BASELINE_SCHEMA_VERSION}`,
    );
  }
  if (value.targetHardLimit !== TARGET_HARD_LIMIT) {
    throw new Error(
      `${label} baseline targetHardLimit must stay ${TARGET_HARD_LIMIT}`,
    );
  }
  if (value.warningLimit !== WARNING_LIMIT) {
    throw new Error(`${label} baseline warningLimit must stay ${WARNING_LIMIT}`);
  }
  assertExactStringArray(value.scanRoots, DEFAULT_SCAN_ROOTS, `${label} scanRoots`);
  assertExactStringArray(
    value.sourceExtensions,
    SOURCE_EXTENSIONS,
    `${label} sourceExtensions`,
  );
  if (!Array.isArray(value.entries)) {
    throw new Error(`${label} baseline entries must be an array`);
  }
  const seen = new Set();
  let previousFile = "";
  for (const entry of value.entries) {
    if (!entry || typeof entry !== "object" || typeof entry.file !== "string") {
      throw new Error(`${label} baseline contains an invalid entry`);
    }
    if (seen.has(entry.file)) {
      throw new Error(`${label} baseline contains duplicate file: ${entry.file}`);
    }
    if (entry.file.localeCompare(previousFile) < 0) {
      throw new Error(`${label} baseline entries must be sorted by file`);
    }
    if (!Number.isInteger(entry.lines) || entry.lines < TARGET_HARD_LIMIT) {
      throw new Error(
        `${label} baseline lines must be an integer >= ${TARGET_HARD_LIMIT}: ${entry.file}`,
      );
    }
    for (const field of ["deadline", "owner", "targetTask"]) {
      if (typeof entry[field] !== "string" || !entry[field].trim()) {
        throw new Error(`${label} baseline ${entry.file} is missing ${field}`);
      }
    }
    seen.add(entry.file);
    previousFile = entry.file;
  }
}

function assertExactStringArray(actual, expected, label) {
  if (
    !Array.isArray(actual) ||
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(`${label} must equal ${JSON.stringify(expected)}`);
  }
}

function evaluateRecords(records, baseline, referenceBaseline) {
  const recordsByFile = new Map(records.map((record) => [record.file, record]));
  const baselineByFile = new Map(
    baseline.entries.map((entry) => [entry.file, entry]),
  );
  const debt = records.filter((record) => record.lines >= TARGET_HARD_LIMIT);
  const newDebt = debt.filter((record) => !baselineByFile.has(record.file));
  const grownDebt = debt
    .filter((record) => {
      const entry = baselineByFile.get(record.file);
      return entry && record.lines > entry.lines;
    })
    .map((record) => ({
      ...record,
      baselineLines: baselineByFile.get(record.file).lines,
    }));
  const staleBaseline = baseline.entries
    .filter((entry) => recordsByFile.get(entry.file)?.lines !== entry.lines)
    .map((entry) => ({
      baselineLines: entry.lines,
      currentLines: recordsByFile.get(entry.file)?.lines ?? null,
      file: entry.file,
    }));
  const referenceRegressions = compareReferenceBaseline(
    baseline,
    referenceBaseline,
  );
  const warnings = records.filter(
    (record) =>
      record.lines >= WARNING_LIMIT && record.lines < TARGET_HARD_LIMIT,
  );
  const pass =
    newDebt.length === 0 &&
    grownDebt.length === 0 &&
    staleBaseline.length === 0 &&
    referenceRegressions.length === 0;

  return {
    baselineDebt: debt,
    generatedAt: new Date().toISOString(),
    newDebt,
    grownDebt,
    pass,
    referenceRegressions,
    scanRoots: [...DEFAULT_SCAN_ROOTS],
    scannedFiles: records.length,
    sourceExtensions: [...SOURCE_EXTENSIONS],
    staleBaseline,
    targetHardLimit: TARGET_HARD_LIMIT,
    topFiles: records.slice(0, 30),
    warningLimit: WARNING_LIMIT,
    warnings,
  };
}

function compareReferenceBaseline(baseline, referenceBaseline) {
  if (!referenceBaseline) {
    return [];
  }
  const referenceByFile = new Map(
    referenceBaseline.entries.map((entry) => [entry.file, entry]),
  );
  return baseline.entries.flatMap((entry) => {
    const reference = referenceByFile.get(entry.file);
    if (!reference) {
      return [
        {
          baselineLines: null,
          currentLines: entry.lines,
          file: entry.file,
          reason: "new-baseline-debt",
        },
      ];
    }
    if (entry.lines > reference.lines) {
      return [
        {
          baselineLines: reference.lines,
          currentLines: entry.lines,
          file: entry.file,
          reason: "baseline-increased",
        },
      ];
    }
    return [];
  });
}

function printSummary(report) {
  console.log(
    `Source size gate: ${report.scannedFiles} files; target is < ${report.targetHardLimit} lines; warning starts at ${report.warningLimit}.`,
  );
  console.log(`Baseline debt: ${report.baselineDebt.length}`);
  console.log(`Warnings: ${report.warnings.length}`);

  if (report.topFiles.length > 0) {
    console.log("\nLargest files:");
    for (const record of report.topFiles.slice(0, 10)) {
      console.log(`${record.lines.toString().padStart(4, " ")}  ${record.file}`);
    }
  }
  printRecords("New debt not present in the baseline", report.newDebt);
  printGrowth("Debt that grew beyond its baseline", report.grownDebt);
  printBaselineDrift(report.staleBaseline);
  printReferenceRegressions(report.referenceRegressions);

  if (report.pass) {
    console.log(
      "\nSource size ratchet passed. Remove each baseline entry when its file drops below 800 lines; completion requires zero baseline debt.",
    );
  }
}

function printRecords(title, records) {
  if (records.length === 0) return;
  console.error(`\n${title}:`);
  for (const record of records) {
    console.error(`${record.lines}  ${record.file}`);
  }
}

function printGrowth(title, records) {
  if (records.length === 0) return;
  console.error(`\n${title}:`);
  for (const record of records) {
    console.error(
      `${record.baselineLines} -> ${record.lines}  ${record.file}`,
    );
  }
}

function printBaselineDrift(records) {
  if (records.length === 0) return;
  console.error(
    "\nBaseline snapshot is stale; reductions/deletions must update the baseline in the same change:",
  );
  for (const record of records) {
    console.error(
      `${record.baselineLines} -> ${record.currentLines ?? "deleted"}  ${record.file}`,
    );
  }
}

function printReferenceRegressions(records) {
  if (records.length === 0) return;
  console.error("\nBaseline ratchet regressed compared with the target branch:");
  for (const record of records) {
    console.error(
      `${record.baselineLines ?? "new"} -> ${record.currentLines}  ${record.file} (${record.reason})`,
    );
  }
}

function resolveFromRepo(repoRoot, value) {
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

function relativeDisplayPath(repoRoot, filePath) {
  const relative = path.relative(repoRoot, filePath).replaceAll("\\", "/");
  return relative.startsWith("../") ? filePath : relative;
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
