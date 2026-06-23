#!/usr/bin/env node
// @author kongweiguang

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hardLimit = 1000;
const warningLimit = 800;
const scanRoots = ["src", "src-tauri/src", "src-tauri/tests", "scripts"];
const sourceExtensions = new Set([".mjs", ".rs", ".ts", ".tsx"]);
const ignoredDirectoryNames = new Set([
  ".codex",
  ".codegraph",
  ".git",
  ".updeng",
  "dist",
  "node_modules",
  "target",
  "tmp",
]);

const outputPath = readOutputPath(process.argv.slice(2));
const files = scanRoots.flatMap((root) => collectSourceFiles(path.join(repoRoot, root)));
const records = files
  .map((filePath) => ({
    file: path.relative(repoRoot, filePath).replaceAll("\\", "/"),
    lines: countPhysicalLines(filePath),
  }))
  .sort((left, right) => right.lines - left.lines || left.file.localeCompare(right.file));

const overLimit = records.filter((record) => record.lines > hardLimit);
const warnings = records.filter(
  (record) => record.lines >= warningLimit && record.lines <= hardLimit,
);
const report = {
  generatedAt: new Date().toISOString(),
  hardLimit,
  scannedFiles: records.length,
  scanRoots,
  topFiles: records.slice(0, 30),
  warningLimit,
  warnings,
  overLimit,
  pass: overLimit.length === 0,
};

if (outputPath) {
  const absoluteOutputPath = path.resolve(repoRoot, outputPath);
  mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
  writeFileSync(absoluteOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

printSummary(report);

if (!report.pass) {
  process.exitCode = 1;
}

function readOutputPath(args) {
  const index = args.indexOf("--output");
  if (index === -1) {
    return null;
  }
  const value = args[index + 1];
  if (!value) {
    console.error("Missing value for --output");
    process.exit(1);
  }
  return value;
}

function collectSourceFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  const entries = readdirSync(directory, { withFileTypes: true });
  const collected = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!ignoredDirectoryNames.has(entry.name)) {
        collected.push(...collectSourceFiles(absolutePath));
      }
      continue;
    }

    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      collected.push(absolutePath);
    }
  }

  return collected;
}

function countPhysicalLines(filePath) {
  const content = readFileSync(filePath, "utf8");
  if (content.length === 0) {
    return 0;
  }
  return content.split(/\r\n|\r|\n/).length;
}

function printSummary(result) {
  console.log(
    `Source size gate: ${result.scannedFiles} files, hard limit ${result.hardLimit} lines, warning ${result.warningLimit} lines.`,
  );
  console.log(`Over limit: ${result.overLimit.length}`);
  console.log(`Warnings: ${result.warnings.length}`);

  if (result.topFiles.length > 0) {
    console.log("\nLargest files:");
    for (const record of result.topFiles.slice(0, 10)) {
      console.log(`${record.lines.toString().padStart(4, " ")}  ${record.file}`);
    }
  }

  if (result.overLimit.length > 0) {
    console.error("\nFiles above the hard limit:");
    for (const record of result.overLimit) {
      console.error(`${record.lines}  ${record.file}`);
    }
  }
}
