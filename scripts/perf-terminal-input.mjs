#!/usr/bin/env node
// @author kongweiguang

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const outputPath = path.resolve(
  repoRoot,
  args.output ?? ".updeng/docs/verification/terminal-input-baseline.json",
);

const scenarios = [
  {
    data: "a",
    iterations: readPositiveInteger(args["single-key-iterations"], 20_000, "--single-key-iterations"),
    name: "single-key",
  },
  {
    data: "\n",
    iterations: readPositiveInteger(args["agent-enter-iterations"], 20_000, "--agent-enter-iterations"),
    name: "agent-shift-enter-lf",
  },
  {
    data: "中文输入法组合-かな-한글-🙂",
    iterations: readPositiveInteger(args["ime-iterations"], 10_000, "--ime-iterations"),
    name: "ime-unicode-composition",
  },
  {
    data: buildPastePayload(1024),
    iterations: readPositiveInteger(args["paste-1k-iterations"], 3_000, "--paste-1k-iterations"),
    name: "paste-1k",
  },
  {
    data: buildPastePayload(64 * 1024),
    iterations: readPositiveInteger(args["paste-64k-iterations"], 300, "--paste-64k-iterations"),
    name: "paste-64k",
  },
  {
    data: buildPastePayload(1024 * 1024),
    iterations: readPositiveInteger(args["paste-1m-iterations"], 30, "--paste-1m-iterations"),
    name: "paste-1m",
  },
];

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
  },
  note:
    "Measures the current terminal_write JSON payload cost in Node as a repeatable proxy. Full WebView/Tauri invoke latency still requires runtime smoke; this report decides whether raw IPC needs deeper investigation.",
  results: scenarios.map(runScenario),
};
report.summary = summarizeReport(report.results);

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(
  `Terminal input baseline: ${report.results.length} scenarios, worst stringify p95 ${report.summary.stringifyP95MaxMs.toFixed(
    4,
  )} ms, worst parse p95 ${report.summary.parseP95MaxMs.toFixed(4)} ms.`,
);
console.log(`Report: ${path.relative(repoRoot, outputPath).replaceAll("\\", "/")}`);

if (!report.summary.pass) {
  process.exitCode = 1;
}

function runScenario(scenario) {
  const payload = {
    data: scenario.data,
    sessionId: "terminal-input-baseline",
  };
  const utf8Bytes = Buffer.byteLength(scenario.data, "utf8");
  const stringifySamples = [];
  const parseSamples = [];
  let json = "";

  for (let index = 0; index < scenario.iterations; index += 1) {
    let startedAt = performance.now();
    json = JSON.stringify(payload);
    stringifySamples.push(performance.now() - startedAt);

    startedAt = performance.now();
    JSON.parse(json);
    parseSamples.push(performance.now() - startedAt);
  }

  const jsonBytes = Buffer.byteLength(json, "utf8");
  const stringifyMs = percentileSummary(stringifySamples);
  const parseMs = percentileSummary(parseSamples);
  const pass = stringifyMs.p95 <= thresholdForBytes(utf8Bytes) && parseMs.p95 <= thresholdForBytes(utf8Bytes);

  return {
    name: scenario.name,
    input: {
      chars: scenario.data.length,
      iterations: scenario.iterations,
      utf8Bytes,
    },
    json: {
      bytes: jsonBytes,
      expansionRatio: Number((jsonBytes / Math.max(utf8Bytes, 1)).toFixed(4)),
    },
    pass,
    thresholds: {
      p95Ms: thresholdForBytes(utf8Bytes),
    },
    timing: {
      parseMs,
      stringifyMs,
    },
  };
}

function summarizeReport(results) {
  const stringifyP95MaxMs = Math.max(...results.map((result) => result.timing.stringifyMs.p95));
  const parseP95MaxMs = Math.max(...results.map((result) => result.timing.parseMs.p95));
  const worstScenario =
    results.toSorted((left, right) => right.timing.stringifyMs.p95 - left.timing.stringifyMs.p95)[0]?.name ?? null;
  return {
    parseP95MaxMs,
    pass: results.every((result) => result.pass),
    stringifyP95MaxMs,
    worstScenario,
  };
}

function buildPastePayload(bytes) {
  const line = "kerminal-input-paste-baseline ";
  let output = "";
  while (Buffer.byteLength(output, "utf8") < bytes) {
    output += `${line}${String(output.length).padStart(8, "0")}\r\n`;
  }
  return output.slice(0, bytes);
}

function thresholdForBytes(bytes) {
  if (bytes <= 1024) {
    return 1;
  }
  if (bytes <= 64 * 1024) {
    return 8;
  }
  return 75;
}

function percentileSummary(values) {
  if (values.length === 0) {
    return { max: 0, p50: 0, p95: 0, p99: 0 };
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    max: sorted.at(-1),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

function percentile(sorted, ratio) {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
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

function readPositiveInteger(value, fallback, label) {
  const parsed = value === undefined ? fallback : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}
