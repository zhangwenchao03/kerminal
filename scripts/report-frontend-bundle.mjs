#!/usr/bin/env node
// @author kongweiguang

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(repoRoot, "dist");
const defaultOutputPath = path.join(
  repoRoot,
  ".updeng",
  "data",
  "verification",
  "frontend-bundle-baseline.json",
);
const outputPath = path.resolve(repoRoot, readOutputPath(process.argv.slice(2)) ?? defaultOutputPath);
const assetExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".svg",
  ".wasm",
]);

if (!existsSync(distRoot)) {
  console.error("dist directory not found. Run npm run build before collecting bundle baseline.");
  process.exit(1);
}

const assets = collectFiles(distRoot)
  .filter((filePath) => assetExtensions.has(path.extname(filePath)))
  .map((filePath) => {
    const content = readFileSync(filePath);
    return {
      bytes: content.byteLength,
      file: path.relative(distRoot, filePath).replaceAll("\\", "/"),
      gzipBytes: gzipSync(content).byteLength,
    };
  })
  .sort((left, right) => right.bytes - left.bytes || left.file.localeCompare(right.file));

const totals = assets.reduce(
  (summary, asset) => ({
    bytes: summary.bytes + asset.bytes,
    gzipBytes: summary.gzipBytes + asset.gzipBytes,
  }),
  { bytes: 0, gzipBytes: 0 },
);

const report = {
  assetCount: assets.length,
  assets,
  generatedAt: new Date().toISOString(),
  largestAssets: assets.slice(0, 20),
  totals,
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(
  `Frontend bundle baseline: ${assets.length} assets, ${formatBytes(totals.bytes)} raw, ${formatBytes(
    totals.gzipBytes,
  )} gzip.`,
);
console.log(`Report: ${path.relative(repoRoot, outputPath).replaceAll("\\", "/")}`);
console.log("\nLargest assets:");
for (const asset of report.largestAssets.slice(0, 10)) {
  console.log(
    `${formatBytes(asset.bytes).padStart(10, " ")} raw  ${formatBytes(asset.gzipBytes).padStart(
      10,
      " ",
    )} gzip  ${asset.file}`,
  );
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

function collectFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const collected = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collected.push(...collectFiles(absolutePath));
    } else if (entry.isFile()) {
      collected.push(absolutePath);
    }
  }

  return collected;
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}
