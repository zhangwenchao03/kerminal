#!/usr/bin/env node
/**
 * Managed SSH real-target HITL evidence gate.
 *
 * This script intentionally does not accept passwords, passphrases, private
 * keys, or vault secrets. It creates and checks a redacted evidence checklist
 * for the real-host validation that cannot be proven by loopback tests alone.
 *
 * @author kongweiguang
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import {
  checkEvidence,
  evidenceMarkdownPathIssue,
  forbiddenEvidenceMatches,
  isInsideDirectory,
  jsonReportFilePathIssue,
  markdownPathIssue,
  sha256,
  writeJsonReport,
} from "./support/managed-ssh-hitl-evidence.mjs";
import { captureGuideTemplate, evidenceTemplate } from "./support/managed-ssh-hitl-templates.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "..");
const defaultEvidenceDir = path.join(
  workspaceRoot,
  ".updeng",
  "docs",
  "verification",
);

const requiredPreflightArtifacts = [
  {
    id: "hitl-capture-guide",
    file: "managed-ssh-hitl-capture-guide-20260704.md",
    purpose: "Human real-target HITL capture guide and artifact checklist",
    requiredPatterns: [
      { label: "guide title", pattern: /^# Managed SSH HITL Capture Guide\b/im },
      { label: "no-save item included", pattern: /\bHITL-001 no-save-password\b/i },
      {
        label: "concurrency item included",
        pattern: /\bHITL-008 disconnect-reconnect-concurrency\b/i,
      },
      {
        label: "final closeout command included",
        pattern:
          /--check \.updeng\/docs\/verification\/managed-ssh-hitl-YYYYMMDD\.md --json-report \.updeng\/docs\/verification\/managed-ssh-hitl-YYYYMMDD\.json/i,
      },
    ],
  },
  {
    id: "auto-full-report",
    file: "managed-ssh-auto-full-20260704.md",
    purpose: "Full non-HITL managed SSH automation matrix",
    requiredPatterns: [
      { label: "report status passed", pattern: /^status:\s*passed\b/im },
      { label: "terminal loopback check recorded", pattern: /\|\s*loopback-password-terminal\s*\|\s*0\s*\|/i },
      { label: "frontend build recorded", pattern: /\|\s*frontend-build\s*\|\s*0\s*\|/i },
    ],
    forbiddenPatterns: [
      { label: "cargo zero-test false positive", pattern: /running 0 tests/i },
    ],
  },
  {
    id: "auto-readiness-report",
    file: "managed-ssh-auto-readiness-20260704.md",
    purpose: "Explicit readiness matrix for HITL preflight and no-submit CLI checks",
    requiredPatterns: [
      { label: "report status passed", pattern: /^status:\s*passed\b/im },
      { label: "HITL preflight check recorded", pattern: /\|\s*readiness-hitl-preflight\s*\|\s*0\s*\|/i },
      { label: "agent CLI no-submit check recorded", pattern: /\|\s*readiness-agent-cli-no-submit\s*\|\s*0\s*\|/i },
    ],
  },
  {
    id: "auto-bulk-transfer-report",
    file: "managed-ssh-auto-bulk-transfer-isolation-20260704.md",
    purpose: "Focused bulk-transfer and terminal input isolation automation",
    requiredPatterns: [
      { label: "report status passed", pattern: /^status:\s*passed\b/im },
      { label: "output assertions section recorded", pattern: /^## Output Assertions\b/im },
      {
        label: "shell input isolation check recorded",
        pattern: /focused-bulk-transfer-shell-input-isolation/i,
      },
      {
        label: "target shell-input test success recorded",
        pattern: /bulk_transfer_lane_does_not_block_interactive_shell_input_contract \.\.\. ok/i,
      },
    ],
    forbiddenPatterns: [
      { label: "cargo zero-test false positive", pattern: /running 0 tests/i },
    ],
  },
  {
    id: "agent-cli-no-submit-report",
    file: "managed-ssh-agent-cli-no-submit-20260704.md",
    purpose: "Real Codex/Claude CLI no-submit prompt readiness artifact",
    requiredPatterns: [
      { label: "Codex CLI passed", pattern: /Codex CLI:\s*passed/i },
      { label: "Claude CLI passed", pattern: /Claude CLI:\s*passed/i },
      { label: "submit disabled", pattern: /submit_allowed=false/i },
    ],
  },
  {
    id: "hitl-preflight-json-report",
    file: "managed-ssh-hitl-preflight-20260704.json",
    purpose: "Machine-readable local HITL toolchain preflight",
    requiredPatterns: [
      { label: "JSON ok true", pattern: /"ok"\s*:\s*true/i },
      { label: "no missing required checks", pattern: /"missingRequiredCount"\s*:\s*0/i },
      { label: "artifact checks recorded", pattern: /"auto-bulk-transfer-report"/i },
    ],
  },
  {
    id: "auto-mcp-container-report",
    file: "managed-ssh-auto-mcp-container-20260704.md",
    purpose: "Focused MCP/container managed streaming exec automation",
    requiredPatterns: [
      { label: "report status passed", pattern: /^status:\s*passed\b/im },
      { label: "docker host service recorded", pattern: /\|\s*rust-docker_host_service\s*\|\s*0\s*\|/i },
      { label: "MCP executor service recorded", pattern: /\|\s*rust-mcp_tool_executor_service\s*\|\s*0\s*\|/i },
    ],
  },
];

const preflightCommands = [
  {
    id: "ssh-client",
    command: "ssh",
    args: ["-V"],
    required: true,
    purpose: "Real SSH target access and external launch comparison",
  },
  {
    id: "pnpm",
    command: "pnpm",
    args: ["--version"],
    required: true,
    purpose: "Run build, Tauri, and managed SSH verification scripts",
  },
  {
    id: "cargo",
    command: "cargo",
    args: ["--version"],
    required: true,
    purpose: "Run focused Rust managed SSH tests and smoke commands",
  },
  {
    id: "tauri-cli",
    command: "pnpm",
    args: ["exec", "tauri", "--version"],
    required: true,
    purpose: "Launch a real Tauri window for HITL observation",
  },
  {
    id: "codex-cli",
    command: "codex",
    args: ["--version"],
    required: true,
    purpose: "HITL-009 Codex prompt behavior inside managed SSH terminal",
  },
  {
    id: "claude-cli",
    command: "claude",
    args: ["--version"],
    required: true,
    purpose: "HITL-009 Claude prompt behavior inside managed SSH terminal",
  },
];

const args = process.argv.slice(2);
if (args.includes("--help") || args.length === 0) {
  printUsage();
  process.exit(args.includes("--help") ? 0 : 2);
}

if (args.includes("--write-template")) {
  const outputPath =
    valueAfter("--write-template") ?? defaultEvidencePath(new Date());
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, evidenceTemplate(new Date()), "utf8");
  console.log(`Wrote managed SSH HITL evidence template: ${outputPath}`);
  process.exit(0);
}

if (args.includes("--write-capture-guide")) {
  const outputPath =
    valueAfter("--write-capture-guide") ?? hitlCaptureGuidePath;
  const pathIssue = markdownPathIssue(outputPath, { mustExist: false });
  if (pathIssue) {
    console.error(`--write-capture-guide path ${pathIssue}`);
    process.exit(2);
  }
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, captureGuideTemplate(new Date()), "utf8");
  console.log(`Wrote managed SSH HITL capture guide: ${outputPath}`);
  process.exit(0);
}

if (args.includes("--preflight")) {
  const jsonReportPath = valueAfter("--json-report");
  if (args.includes("--json-report") && !jsonReportPath) {
    console.error("--json-report requires an output JSON path.");
    process.exit(2);
  }
  if (jsonReportPath) {
    const jsonReportPathIssue = jsonReportFilePathIssue(jsonReportPath);
    if (jsonReportPathIssue) {
      console.error(`--json-report path ${jsonReportPathIssue}`);
      process.exit(2);
    }
  }
  const result = preflightHitlEnvironment();
  if (jsonReportPath) {
    writePreflightJsonReport(jsonReportPath, result);
  }
  printPreflightResult(result);
  process.exit(result.ok ? 0 : 1);
}

if (args.includes("--check")) {
  const evidencePath = valueAfter("--check");
  if (!evidencePath) {
    console.error("--check requires an evidence markdown path.");
    process.exit(2);
  }
  const evidencePathIssue = evidenceMarkdownPathIssue(evidencePath);
  if (evidencePathIssue) {
    console.error(`--check evidence path ${evidencePathIssue}`);
    process.exit(2);
  }
  const jsonReportPath = valueAfter("--json-report");
  if (args.includes("--json-report") && !jsonReportPath) {
    console.error("--json-report requires an output JSON path.");
    process.exit(2);
  }
  if (jsonReportPath) {
    const jsonReportPathIssue = jsonReportFilePathIssue(jsonReportPath);
    if (jsonReportPathIssue) {
      console.error(`--json-report path ${jsonReportPathIssue}`);
      process.exit(2);
    }
  }
  const text = readFileSync(evidencePath, "utf8");
  const result = checkEvidence(text, evidencePath);
  if (jsonReportPath) {
    writeJsonReport(jsonReportPath, result);
  }
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(`Managed SSH HITL evidence complete: ${evidencePath}`);
  process.exit(0);
}

console.error(`Unknown arguments: ${args.join(" ")}`);
printUsage();
process.exit(2);

function valueAfter(flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    return undefined;
  }
  return path.resolve(workspaceRoot, value);
}

function defaultEvidencePath(now) {
  const stamp = now.toISOString().slice(0, 10).replaceAll("-", "");
  return path.join(defaultEvidenceDir, `managed-ssh-hitl-${stamp}.md`);
}

function preflightHitlEnvironment() {
  const checks = [
    preflightDirectoryCheck("verification-dir", defaultEvidenceDir),
    preflightFileCheck("hitl-template", hitlTemplatePath),
    preflightFileCheck(
      "auto-verifier",
      path.join(workspaceRoot, "scripts", "verify-managed-ssh-auto.mjs"),
    ),
    preflightFileCheck(
      "hitl-verifier",
      path.join(workspaceRoot, "scripts", "verify-managed-ssh-hitl.mjs"),
    ),
    ...requiredPreflightArtifacts.map(preflightArtifactCheck),
    ...preflightCommands.map(preflightCommandCheck),
  ];
  const missingRequired = checks.filter(
    (check) => check.required && check.status !== "ok",
  );
  return {
    generatedAt: new Date().toISOString(),
    ok: missingRequired.length === 0,
    workspace: path.basename(workspaceRoot),
    evidenceDir: path.relative(workspaceRoot, defaultEvidenceDir),
    checks,
    summary: {
      checkCount: checks.length,
      okCount: checks.filter((check) => check.status === "ok").length,
      missingRequiredCount: missingRequired.length,
    },
  };
}

function preflightDirectoryCheck(id, directoryPath) {
  const exists = existsSync(directoryPath);
  const isDirectory = exists && statSync(directoryPath).isDirectory();
  return {
    id,
    kind: "directory",
    path: path.relative(workspaceRoot, directoryPath),
    required: true,
    status: isDirectory ? "ok" : "missing",
    detail: isDirectory
      ? "verification evidence directory is available"
      : "verification evidence directory is missing",
  };
}

function preflightFileCheck(id, filePath) {
  const exists = existsSync(filePath);
  const isFile = exists && statSync(filePath).isFile();
  return {
    id,
    kind: "file",
    path: path.relative(workspaceRoot, filePath),
    required: true,
    status: isFile ? "ok" : "missing",
    detail: isFile ? "required file is available" : "required file is missing",
  };
}

function preflightArtifactCheck(definition) {
  const filePath = path.join(defaultEvidenceDir, definition.file);
  const base = {
    id: definition.id,
    kind: "artifact",
    path: path.relative(workspaceRoot, filePath),
    purpose: definition.purpose,
    required: true,
  };
  if (!isInsideDirectory(filePath, defaultEvidenceDir)) {
    return {
      ...base,
      status: "missing",
      detail: "required artifact path is outside .updeng/docs/verification",
    };
  }
  if (!existsSync(filePath)) {
    return {
      ...base,
      status: "missing",
      detail: "required verification artifact is missing",
    };
  }
  const stat = statSync(filePath);
  if (!stat.isFile()) {
    return {
      ...base,
      status: "missing",
      detail: "required verification artifact is not a file",
    };
  }
  const ext = path.extname(filePath).toLowerCase();
  if (!textArtifactExtensions.has(ext)) {
    return {
      ...base,
      status: "missing",
      detail: "required verification artifact must be a text artifact",
    };
  }
  if (stat.size > maxTextArtifactBytes) {
    return {
      ...base,
      status: "missing",
      detail: `required verification artifact exceeds ${maxTextArtifactBytes} bytes`,
    };
  }
  const text = readFileSync(filePath, "utf8");
  const forbidden = forbiddenEvidencePatterns
    .map((pattern, index) =>
      pattern.test(text) ? `forbidden-pattern-${index + 1}` : undefined,
    )
    .filter(Boolean);
  if (forbidden.length > 0) {
    return {
      ...base,
      status: "missing",
      detail: `required verification artifact contains sensitive material matching ${forbidden.join(", ")}`,
    };
  }
  const missingPatterns = (definition.requiredPatterns ?? [])
    .filter((requirement) => !requirement.pattern.test(text))
    .map((requirement) => requirement.label);
  const forbiddenPatterns = (definition.forbiddenPatterns ?? [])
    .filter((requirement) => requirement.pattern.test(text))
    .map((requirement) => requirement.label);
  if (missingPatterns.length > 0 || forbiddenPatterns.length > 0) {
    return {
      ...base,
      status: "missing",
      detail: [
        missingPatterns.length > 0
          ? `missing markers: ${missingPatterns.join(", ")}`
          : "",
        forbiddenPatterns.length > 0
          ? `forbidden markers: ${forbiddenPatterns.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("; "),
      sha256: sha256(text),
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  }
  return {
    ...base,
    status: "ok",
    detail: "required verification artifact is available and has expected pass markers",
    sha256: sha256(text),
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

function preflightCommandCheck(definition) {
  const result = spawnSync(definition.command, definition.args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 10_000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const status = result.status === 0 ? "ok" : "missing";
  return {
    id: definition.id,
    kind: "command",
    command: [definition.command, ...definition.args].join(" "),
    purpose: definition.purpose,
    required: definition.required,
    status,
    detail:
      status === "ok"
        ? firstLine(output) || "command completed"
        : commandFailureDetail(result),
  };
}

function commandFailureDetail(result) {
  if (result.error?.code === "ETIMEDOUT") {
    return "command timed out";
  }
  if (result.error?.message) {
    return result.error.message;
  }
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return firstLine(output) || `exit code ${result.status ?? "unknown"}`;
}

function firstLine(value) {
  return value.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim();
}

function printPreflightResult(result) {
  console.log(
    `Managed SSH HITL preflight ${result.ok ? "ready" : "not ready"}: ${result.summary.okCount}/${result.summary.checkCount} checks passed`,
  );
  for (const check of result.checks) {
    const marker = check.status === "ok" ? "ok" : "missing";
    console.log(`- [${marker}] ${check.id}: ${check.detail}`);
  }
  if (!result.ok) {
    console.log(
      "Preflight does not prove real HITL completion; fix missing required tools/artifacts or record why the real target covers them before final closeout.",
    );
  }
}

function writePreflightJsonReport(outputPath, result) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function printUsage() {
  console.error(
    [
      "Managed SSH HITL evidence gate.",
      "",
      "Create a redacted evidence template:",
      "  pnpm run verify:managed-ssh-hitl -- --write-template",
      "  pnpm run verify:managed-ssh-hitl -- --write-template .updeng/docs/verification/managed-ssh-hitl-YYYYMMDD.md",
      "",
      "Create a real-target capture guide:",
      "  pnpm run verify:managed-ssh-hitl -- --write-capture-guide",
      "  pnpm run verify:managed-ssh-hitl -- --write-capture-guide .updeng/docs/verification/managed-ssh-hitl-capture-guide-YYYYMMDD.md",
      "",
      "Check completed evidence:",
      "  pnpm run verify:managed-ssh-hitl -- --check .updeng/docs/verification/managed-ssh-hitl-YYYYMMDD.md",
      "  pnpm run verify:managed-ssh-hitl -- --check .updeng/docs/verification/managed-ssh-hitl-YYYYMMDD.md --json-report .updeng/docs/verification/managed-ssh-hitl-YYYYMMDD.json",
      "",
      "Check local HITL prerequisites without connecting to a host:",
      "  pnpm run verify:managed-ssh-hitl -- --preflight",
      "  pnpm run verify:managed-ssh-hitl -- --preflight --json-report .updeng/docs/verification/managed-ssh-hitl-preflight-YYYYMMDD.json",
      "  Preflight also checks the local automated verification artifacts required before real target HITL starts.",
      "",
      "The evidence markdown and JSON report paths must both stay under .updeng/docs/verification/.",
      "",
      "This script fails if checklist items are unchecked, required HITL ids are missing,",
      "required evidence anchors are missing/placeholder, referenced local artifacts",
      "are missing, local text artifacts contain sensitive material, or obvious",
      "password/passphrase/private-key/secret material appears in the file.",
    ].join("\n"),
  );
}
