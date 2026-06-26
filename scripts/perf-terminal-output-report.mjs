#!/usr/bin/env node
// @author kongweiguang

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const reportDate = args.date ?? formatDateForFile(new Date());
const terminalBaselinePath = resolveRepoPath(
  args.input ?? args["terminal-baseline"] ?? ".updeng/docs/verification/terminal-output-baseline.json",
);
const performanceBaselinePath = resolveRepoPath(
  args["performance-baseline"] ?? ".updeng/docs/verification/performance-baseline-20260623.json",
);
const outputPath = resolveRepoPath(
  args.output ?? `.updeng/docs/reports/terminal-output-profiling-${reportDate}.md`,
);

if (!existsSync(terminalBaselinePath)) {
  console.error(`Terminal output baseline not found: ${relativePath(terminalBaselinePath)}`);
  process.exit(1);
}

const terminalBaseline = readJson(terminalBaselinePath);
const performanceBaseline = existsSync(performanceBaselinePath) ? readJson(performanceBaselinePath) : null;
const terminalReport = selectTerminalReport(terminalBaseline, performanceBaseline);
const markdown = renderReport({
  performanceBaseline,
  reportDate,
  terminalBaselinePath,
  terminalReport,
});

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, markdown, "utf8");

console.log(`Terminal output profiling report: ${relativePath(outputPath)}`);

function selectTerminalReport(terminalBaseline, performanceBaseline) {
  const nestedTerminal = performanceBaseline?.reports?.terminalOutput;
  if (nestedTerminal?.results?.length) {
    return nestedTerminal;
  }
  return terminalBaseline;
}

function renderReport({ performanceBaseline, reportDate, terminalBaselinePath, terminalReport }) {
  const config = terminalReport.config ?? {};
  const results = Array.isArray(terminalReport.results) ? terminalReport.results : [];
  const summary = terminalReport.summary ?? {};
  const worstByWriteP95 = maxBy(results, (result) => metric(result, "timing.writeCallbackMs.p95"));
  const worstByWriteMax = maxBy(results, (result) => metric(result, "timing.writeCallbackMs.max"));
  const worstByFrame = maxBy(results, (result) => metric(result, "frames.gapMs.max"));
  const worstByLongTask = maxBy(results, (result) => metric(result, "longTasks.maxMs"));
  const totalRemoteSchedules = sum(results, (result) => metric(result, "sideEffects.remotePrewarmSchedules"));
  const totalCwdPaths = sum(results, (result) => metric(result, "sideEffects.cwdPathCount"));
  const totalHistoryFlushes = sum(results, (result) => metric(result, "sideEffects.historyFlushCount"));
  const maxCommandTail = max(results, (result) => metric(result, "sideEffects.commandBlockTailLength"));
  const generatedAt = new Date().toISOString();
  const inputBytes = sum(results, (result) => metric(result, "input.bytes"));
  const lines = [];

  lines.push(`# Terminal Output Profiling Report ${reportDate}`);
  lines.push("");
  lines.push("## Scope");
  lines.push("");
  lines.push("- TASK: TASK-002 terminal large output profiling report.");
  lines.push("- Non-goal: no runtime behavior change, no terminal/workspace/machine-sidebar code edits, no output ordering or side effect semantics changes.");
  lines.push(`- Generated at: ${generatedAt}.`);
  lines.push(`- Input baseline: \`${relativePath(terminalBaselinePath)}\`.`);
  if (performanceBaseline) {
    lines.push(`- Performance baseline: \`${relativePath(performanceBaselinePath)}\`.`);
  } else {
    lines.push(`- Performance baseline: not found at \`${relativePath(performanceBaselinePath)}\`; report uses terminal baseline only.`);
  }
  lines.push("");
  lines.push("## Scenario Input");
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("| --- | --- |");
  lines.push(`| scenarios | ${formatInlineList(config.scenarios)} |`);
  lines.push(`| chunks | ${formatNumber(config.chunks)} |`);
  lines.push(`| chunkSize | ${formatNumber(config.chunkSize)} chars |`);
  lines.push(`| maxCharsPerFlush | ${formatNumber(config.maxCharsPerFlush)} chars |`);
  lines.push(`| viewport | ${formatViewport(config.viewport)} |`);
  lines.push(`| total input | ${formatNumber(inputBytes)} chars across ${results.length} scenarios |`);
  lines.push("");
  lines.push("## Scenario Metrics");
  lines.push("");
  lines.push("| Scenario | Input chars | writeCallback p95 / max | frame gap p95 / max | long tasks | sideEffects counts |");
  lines.push("| --- | ---: | ---: | ---: | ---: | --- |");
  for (const result of results) {
    lines.push(
      `| ${result.scenario ?? "unknown"} | ${formatNumber(metric(result, "input.chars"))} | ${formatMs(
        metric(result, "timing.writeCallbackMs.p95"),
      )} / ${formatMs(metric(result, "timing.writeCallbackMs.max"))} | ${formatMs(
        metric(result, "frames.gapMs.p95"),
      )} / ${formatMs(metric(result, "frames.gapMs.max"))} | ${formatNumber(
        metric(result, "longTasks.count"),
      )} count, max ${formatMs(metric(result, "longTasks.maxMs"))} | ${formatSideEffects(result.sideEffects)} |`,
    );
  }
  lines.push("");
  lines.push("## Initial Judgment");
  lines.push("");
  lines.push(`- Current baseline pass: ${summary.pass === false ? "no" : "yes"}.`);
  lines.push(
    `- Worst write callback p95: ${describeScenario(worstByWriteP95, "timing.writeCallbackMs.p95")}; worst max: ${describeScenario(
      worstByWriteMax,
      "timing.writeCallbackMs.max",
    )}.`,
  );
  lines.push(
    `- Worst frame gap: ${describeScenario(worstByFrame, "frames.gapMs.max")}; long task ceiling: ${describeScenario(
      worstByLongTask,
      "longTasks.maxMs",
    )}.`,
  );
  lines.push(
    `- Side effect pressure is visible in counts before runtime instrumentation: cwd OSC paths ${formatNumber(
      totalCwdPaths,
    )}, remote prewarm schedules ${formatNumber(totalRemoteSchedules)}, history flushes ${formatNumber(
      totalHistoryFlushes,
    )}, command block tail cap ${formatNumber(maxCommandTail)} chars.`,
  );
  lines.push(
    "- The current harness measures real xterm write callback and simulated side effect costs. It does not yet prove the cost distribution inside `XtermPane.runtime.ts` `handleOutput`, so optimization should wait for TASK-006 targeted instrumentation or a behavior-preserving model test.",
  );
  lines.push("");
  lines.push("## TASK-006 Candidates");
  lines.push("");
  lines.push("- Add temporary, feature-flagged measurement around `handleOutput` substeps before changing behavior.");
  lines.push("- Fast-path cwd OSC parsing so ordinary output skips regex work unless an OSC marker is present.");
  lines.push("- Coalesce remote suggestion prewarm scheduling on cwd changes; OSC scenario currently produces one schedule per cwd sequence.");
  lines.push("- Evaluate command block append batching, but only with marker range tests that prove command block color bars remain correct.");
  lines.push("- Evaluate pending-chunk history buffering only if synchronous `outputHistoryRef.current` visibility can be preserved.");
  lines.push("");
  lines.push("## Explicit No-Behavior-Change Contract");
  lines.push("");
  lines.push("- This report generator only reads JSON baselines and writes a Markdown report.");
  lines.push("- It does not import app runtime modules, start Vite/Tauri, modify xterm handling, change store updates, or alter terminal output ordering.");
  lines.push("- Any future TASK-006 optimization must keep terminal output order, cwd sync, command block markers, ghost suggestion prewarm semantics, close/reconnect messages, and history visibility stable.");
  lines.push("");
  lines.push("## Source Summary");
  lines.push("");
  lines.push(`- Terminal baseline generated at: ${terminalReport.generatedAt ?? "unknown"}.`);
  lines.push(`- Environment: Node ${terminalReport.environment?.node ?? "unknown"}, xterm ${terminalReport.environment?.xterm ?? "unknown"}.`);
  if (performanceBaseline?.git) {
    lines.push(
      `- Git baseline: branch ${performanceBaseline.git.branch ?? "unknown"}, commit ${
        performanceBaseline.git.commit ?? "unknown"
      }, dirty ${String(performanceBaseline.git.dirty ?? "unknown")}.`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function formatSideEffects(sideEffects = {}) {
  return [
    `cwd ${formatNumber(sideEffects.cwdPathCount)}`,
    `prewarm ${formatNumber(sideEffects.remotePrewarmSchedules)}`,
    `history flush ${formatNumber(sideEffects.historyFlushCount)}`,
    `tail ${formatNumber(sideEffects.commandBlockTailLength)}`,
  ].join(", ");
}

function describeScenario(result, metricPath) {
  if (!result) {
    return "n/a";
  }
  return `${result.scenario ?? "unknown"} ${formatMs(metric(result, metricPath))}`;
}

function metric(value, dottedPath) {
  return dottedPath.split(".").reduce((current, key) => current?.[key], value) ?? 0;
}

function sum(values, selector) {
  return values.reduce((total, value) => total + Number(selector(value) ?? 0), 0);
}

function max(values, selector) {
  if (values.length === 0) {
    return 0;
  }
  return Math.max(...values.map((value) => Number(selector(value) ?? 0)));
}

function maxBy(values, selector) {
  return values.reduce((best, value) => {
    if (!best) {
      return value;
    }
    return Number(selector(value) ?? 0) > Number(selector(best) ?? 0) ? value : best;
  }, null);
}

function formatMs(value) {
  const numeric = Number(value ?? 0);
  return `${numeric.toFixed(2)} ms`;
}

function formatNumber(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric.toLocaleString("en-US") : "n/a";
}

function formatInlineList(values) {
  return Array.isArray(values) ? values.map((value) => `\`${value}\``).join(", ") : "n/a";
}

function formatViewport(viewport) {
  if (!viewport?.width || !viewport?.height) {
    return "n/a";
  }
  return `${viewport.width}x${viewport.height}`;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function resolveRepoPath(value) {
  return path.resolve(repoRoot, value);
}

function relativePath(filePath) {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/");
}

function formatDateForFile(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  })
    .formatToParts(date)
    .reduce((accumulator, part) => {
      accumulator[part.type] = part.value;
      return accumulator;
    }, {});
  return `${parts.year}${parts.month}${parts.day}`;
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
