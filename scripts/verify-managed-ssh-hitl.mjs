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
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
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

const requiredIds = [
  "HITL-001 no-save-password",
  "HITL-002 saved-password-vault",
  "HITL-003 private-key-passphrase",
  "HITL-004 agent-auth",
  "HITL-005 jump-host",
  "HITL-006 external-launch-no-save",
  "HITL-007 host-key-and-auth-cancel",
  "HITL-008 disconnect-reconnect-concurrency",
  "HITL-009 codex-claude-agent-prompt",
  "HITL-010 diagnostics-and-redaction",
];

const forbiddenEvidencePatterns = [
  /\bKERMINAL_[A-Z0-9_]*(?:PASSWORD|PASSPHRASE|PRIVATE_KEY|SECRET)[A-Z0-9_]*=/i,
  /\b[A-Z0-9_]*(?:TOKEN|API_KEY|ACCESS_KEY|SECRET_KEY|CLIENT_SECRET)\s*=/i,
  /\bAuthorization:\s*Bearer\s+\S+/i,
  /\b(?:password|passphrase|private[_ -]?key|secret)\s*=\s*["']?[^<\s][^\n]*/i,
  /["'](?:password|passphrase|private[_ -]?key|secret|token|api[_ -]?key)["']\s*:\s*["'][^<][^"']+["']/i,
  /^\s*(?:password|passphrase|private[_ -]?key|secret|token|api[_ -]?key)\s*:\s*["']?[^<\s][^\n]*/im,
  /-----BEGIN (?:OPENSSH|RSA|DSA|EC|ED25519)? ?PRIVATE KEY-----/i,
  /\bexternal-secret:[A-Za-z0-9._:-]+/i,
  /\bvault:[A-Za-z0-9._:-]+/i,
];

const requiredEvidenceAnchors = [
  {
    label: "Target alias",
    pattern: /^\s*Target alias:\s*(.+)\s*$/i,
    minLength: 3,
  },
  {
    label: "Observed",
    pattern: /^\s*Observed:\s*(.+)\s*$/i,
    minLength: 24,
  },
  {
    label: "Diagnostics",
    pattern: /^\s*Diagnostics:\s*(.+)\s*$/i,
    minLength: 24,
    requiredPattern:
      /\b(?:managed|runtime|session|channel|backend|recentLegacyFallbacks|fallback|auth|host[- ]?key|bulk-transfer|diagnostics?)\b/i,
  },
  {
    label: "Tool result",
    pattern: /^\s*Tool result:\s*(.+)\s*$/i,
    minLength: 20,
  },
  {
    label: "Screenshot/log ref",
    pattern: /^\s*Screenshot\/log ref:\s*(.+)\s*$/i,
  },
  {
    label: "Redaction review",
    pattern: /^\s*Redaction review:\s*(.+)\s*$/i,
    minLength: 24,
  },
];

const placeholderValuePattern =
  /^<?(?:todo|tbd|pending|none|n\/a|placeholder|redacted|target alias|observed behavior|diagnostics summary|tool result summary|screenshot or log path)>?$/i;
const weakAnchorValuePattern =
  /^(?:ok|pass(?:ed)?|success(?:ful)?|works?|done|yes|good|verified)(?:[\s.,!_-]+(?:ok|pass(?:ed)?|success(?:ful)?|works?|done|yes|good|verified))*$/i;
const externalArtifactPattern = /^https:\/\/\S+$/i;
const observedActionPattern =
  /\b(?:terminal|xterm|sftp|tmux|system|container|port|mcp|codex|claude|launch|host[- ]?key|auth|prompt|transfer|command|settings|sidebar|tool|window|panel)\b|(?:终端|文件|传输|端口|命令|设置|右栏|提示|认证|跳板|容器|系统|启动|窗口|面板)/i;
const observedResultPattern =
  /\b(?:reused?|without|succeeded|returned|showed|opened|cancel(?:led)?|error|responsive|hidden|visible|completed|failed|no second|again|same|stable)\b|(?:复用|成功|返回|显示|打开|取消|错误|响应|隐藏|可见|完成|失败|没有|无再次|同一|稳定)/i;
const toolResultSubjectPattern =
  /\b(?:terminal|sftp|tmux|system|container|port|mcp|codex|claude|runtime_snapshot|tool_help|operation_guide|command|transfer|panel|settings|docker|podman|compose)\b|(?:终端|文件|传输|端口|命令|设置|右栏|容器|系统|面板)/i;
const toolResultOutcomePattern =
  /\b(?:exit\s*code|status|returned|result|operation|file|count|port|session|channel|field|panel|opened|succeeded|failed|cancel(?:led)?|error)\b|(?:退出码|状态|返回|结果|操作|文件|数量|端口|会话|通道|字段|面板|打开|成功|失败|取消|错误)/i;
const diagnosticDimensionPatterns = [
  /\bmanaged\b/i,
  /\bruntime(?:_snapshot)?\b/i,
  /\bsession\b/i,
  /\bchannel\b/i,
  /\bbackend\b/i,
  /\b(?:recentLegacyFallbacks|fallback)\b/i,
  /\bauth\b/i,
  /\bhost[- ]?key\b/i,
  /\bbulk-transfer\b/i,
  /\bdiagnostics?\b/i,
  /受管|运行时|会话|通道|后端|认证|跳板|诊断|无回退|回退|批量传输/i,
];
const textArtifactExtensions = new Set([
  ".csv",
  ".html",
  ".json",
  ".log",
  ".md",
  ".toml",
  ".txt",
  ".yaml",
  ".yml",
]);
const binaryArtifactExtensions = new Set([
  ".gif",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp4",
  ".png",
  ".webm",
]);
const maxTextArtifactBytes = 2 * 1024 * 1024;
const hitlTemplatePath = path.join(
  defaultEvidenceDir,
  "managed-ssh-hitl-template-20260703.md",
);
const hitlCaptureGuidePath = path.join(
  defaultEvidenceDir,
  "managed-ssh-hitl-capture-guide-20260704.md",
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

function checkEvidence(text, evidencePath) {
  const itemChecks = inspectEvidenceItems(text);
  const missingIds = itemChecks
    .filter((item) => !item.present)
    .map((item) => item.id);
  const unchecked = text
    .split(/\r?\n/)
    .filter((line) => /^\s*-\s\[\s\]/.test(line));
  const invalidEvidence = itemChecks
    .filter((item) => item.issues.length > 0)
    .map((item) => `${item.id} (${item.issues.join("; ")})`);
  const forbidden = forbiddenEvidenceMatches(text);
  const ok =
    missingIds.length === 0 &&
    unchecked.length === 0 &&
    invalidEvidence.length === 0 &&
    forbidden.length === 0;
  if (!ok) {
    return {
      ok: false,
      evidencePath,
      missingIds,
      uncheckedItems: unchecked,
      invalidEvidenceItems: invalidEvidence,
      forbiddenEvidenceMatches: forbidden,
      itemChecks,
      message: buildFailureMessage({
        missingIds,
        unchecked,
        invalidEvidence,
        forbidden,
      }),
    };
  }

  return {
    ok: true,
    evidencePath,
    missingIds: [],
    uncheckedItems: [],
    invalidEvidenceItems: [],
    forbiddenEvidenceMatches: [],
    itemChecks,
    message: "",
  };
}

function buildFailureMessage({
  missingIds,
  unchecked,
  invalidEvidence,
  forbidden,
}) {
  const sections = [];
  if (missingIds.length > 0) {
    sections.push(`Missing HITL checklist ids:\n${missingIds.join("\n")}`);
  }
  if (unchecked.length > 0) {
    sections.push(`HITL evidence has unchecked items:\n${unchecked.join("\n")}`);
  }
  if (invalidEvidence.length > 0) {
    sections.push(
      `HITL evidence items need structured, non-placeholder evidence blocks:\n${invalidEvidence.join("\n")}`,
    );
  }
  if (forbidden.length > 0) {
    sections.push(
      `HITL evidence appears to contain sensitive material matching forbidden rules:\n${forbidden.join("\n")}`,
    );
  }
  return sections.join("\n\n");
}

function inspectEvidenceItems(text) {
  const lines = text.split(/\r?\n/);
  return requiredIds.map((id) => {
    const itemLinePattern = checklistLinePattern(id);
    const itemIndex = lines.findIndex((line) => itemLinePattern.test(line));
    if (itemIndex === -1) {
      return {
        id,
        present: false,
        checked: false,
        hasEvidenceLabel: false,
        missingAnchors: requiredEvidenceAnchors.map((anchor) => anchor.label),
        artifactRefs: [],
        issues: ["missing checklist id"],
      };
    }
    const itemLine = lines[itemIndex] ?? "";
    const checked = /^\s*-\s\[[xX]\]/.test(itemLine);
    const nextItemIndex = lines.findIndex(
      (line, index) =>
        index > itemIndex && /^\s*-\s\[[xX\s]\]\s+HITL-\d{3}\b/.test(line),
    );
    const nextHeadingIndex = lines.findIndex(
      (line, index) => index > itemIndex && /^##\s+/.test(line),
    );
    const blockEnd = Math.min(
      nextItemIndex === -1 ? lines.length : nextItemIndex,
      nextHeadingIndex === -1 ? lines.length : nextHeadingIndex,
    );
    const block = lines.slice(itemIndex + 1, blockEnd);
    const hasEvidenceLabel = block.some((line) => /^\s*Evidence:\s*$/.test(line));
    const evidenceLines = block.filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed.length > 0 &&
        !/^Evidence:\s*$/.test(trimmed) &&
        !/^[-*]\s*(?:todo|tbd|pending|none|n\/a|placeholder)\b/i.test(trimmed) &&
        !placeholderValuePattern.test(trimmed)
      );
    });
    const anchorChecks = inspectEvidenceAnchors(block);
    const missingAnchors = anchorChecks
      .filter((anchor) => !anchor.present)
      .map((anchor) => anchor.label);
    const invalidAnchors = anchorChecks
      .filter((anchor) => anchor.present && !anchor.ok)
      .map((anchor) => `${anchor.label}: ${anchor.issue}`);
    const artifactRefs = inspectArtifactRefs(block);
    const issues = [];
    if (!checked) {
      issues.push("checklist item is not checked");
    }
    if (!hasEvidenceLabel || evidenceLines.length === 0) {
      issues.push("missing Evidence block");
    }
    if (missingAnchors.length > 0) {
      issues.push(`missing anchors: ${missingAnchors.join(", ")}`);
    }
    if (invalidAnchors.length > 0) {
      issues.push(`weak anchors: ${invalidAnchors.join(", ")}`);
    }
    const invalidArtifactRefs = artifactRefs.filter((artifact) => !artifact.ok);
    if (invalidArtifactRefs.length > 0) {
      issues.push(
        `invalid artifact refs: ${invalidArtifactRefs
          .map(
            (artifact) =>
              `${artifact.reportRef} ${artifact.issue ?? "is invalid"}`.trim(),
          )
          .join("; ")}`,
      );
    }
    const validLocalArtifacts = artifactRefs.filter(
      (artifact) => artifact.ok && artifact.metadata?.kind === "local-file",
    );
    if (validLocalArtifacts.length === 0) {
      issues.push("at least one local verification artifact is required");
    }
    const binaryArtifacts = validLocalArtifacts.filter(
      (artifact) => artifact.metadata?.textScanned === false,
    );
    const redactionReview = anchorChecks.find(
      (anchor) => anchor.label === "Redaction review",
    );
    if (binaryArtifacts.length > 0 && !redactionReview?.ok) {
      issues.push("binary artifacts require a redaction review");
    }
    const itemSpecificIssues = itemSpecificEvidenceIssues(id, block);
    issues.push(...itemSpecificIssues);
    return {
      id,
      present: true,
      checked,
      hasEvidenceLabel,
      anchorChecks,
      missingAnchors,
      artifactRefs,
      issues,
    };
  });
}

function itemSpecificEvidenceIssues(id, lines) {
  const observed = anchorValueFor(lines, "Observed");
  const toolResult = anchorValueFor(lines, "Tool result");
  const diagnostics = anchorValueFor(lines, "Diagnostics");
  const combined = `${observed} ${toolResult} ${diagnostics}`;
  if (id === "HITL-003 private-key-passphrase") {
    const missing = [];
    if (!/\b(?:passphrase|key passphrase|private[- ]key prompt)\b|(?:密钥口令|私钥口令|口令提示|私钥提示)/i.test(combined)) {
      missing.push("private-key passphrase prompt evidence");
    }
    if (!/\b(?:sftp|exec|mcp|remote command|command)\b|(?:文件|远程命令|命令|工具复用|复用)/i.test(combined)) {
      missing.push("downstream managed tool reuse evidence");
    }
    if (!/\b(?:reuse|reused|same session|without re-enter|no second|no leak|redacted)\b|(?:复用|同一会话|无需再次|没有再次|未泄露|脱敏)/i.test(combined)) {
      missing.push("session reuse or redaction evidence");
    }
    return missing.length === 0
      ? []
      : [`HITL-003 private-key passphrase evidence must mention ${missing.join(", ")}`];
  }
  if (id === "HITL-005 jump-host") {
    const missing = [];
    if (!/\b(?:jump|jump-host|bastion|proxyjump)\b|(?:跳板|堡垒机|跳板机)/i.test(combined)) {
      missing.push("jump/bastion route evidence");
    }
    if (!/\b(?:target|destination|final host|remote host)\b|(?:目标|最终主机|远端主机)/i.test(combined)) {
      missing.push("target-host evidence");
    }
    if (!/\b(?:auth|password|passphrase|private[- ]?key|agent|vault|prompt|credential)\b|(?:认证|密码|口令|私钥|代理|凭据|提示)/i.test(combined)) {
      missing.push("jump and target auth-source evidence");
    }
    if (!/\b(?:route|chain|session key|managed session|runtime|channel)\b|(?:链路|路由|会话|运行时|通道)/i.test(combined)) {
      missing.push("managed route/session evidence");
    }
    if (!/\b(?:sftp|exec|port|mcp|remote command|command)\b|(?:文件|远程命令|端口|命令|工具)/i.test(combined)) {
      missing.push("downstream tool-through-jump evidence");
    }
    return missing.length === 0
      ? []
      : [`HITL-005 jump-host evidence must mention ${missing.join(", ")}`];
  }
  if (id !== "HITL-008 disconnect-reconnect-concurrency") {
    return [];
  }
  const missing = [];
  if (
    !/\b(?:sftp|transfer|upload|download|bulk-transfer)\b|(?:传输|上传|下载|批量传输)/i.test(
      combined,
    )
  ) {
    missing.push("active SFTP/transfer evidence");
  }
  if (
    !/\b(?:terminal input|shell input|xterm input|typed|keypress|echo|command echo|input)\b|(?:终端输入|输入|键入|回显|命令回显)/i.test(
      combined,
    )
  ) {
    missing.push("terminal input evidence");
  }
  if (
    !/\b(?:responsive|latency|within|under|<=|ms|millisecond|second|1s|not block|not blocked|visible)\b|(?:不卡|响应|延迟|毫秒|秒内|可见|未阻塞)/i.test(
      combined,
    )
  ) {
    missing.push("responsiveness or latency evidence");
  }
  return missing.length === 0
    ? []
    : [`HITL-008 concurrency evidence must mention ${missing.join(", ")}`];
}

function anchorValueFor(lines, label) {
  const anchor = requiredEvidenceAnchors.find((candidate) => candidate.label === label);
  if (!anchor) {
    return "";
  }
  for (const line of lines) {
    const match = line.match(anchor.pattern);
    if (match) {
      return match[1].trim();
    }
  }
  return "";
}

function inspectEvidenceAnchors(lines) {
  return requiredEvidenceAnchors.map((anchor) => {
    for (const [index, line] of lines.entries()) {
      const match = line.match(anchor.pattern);
      if (!match) {
        continue;
      }
      const value = match[1].trim();
      const issue = anchorValueIssue(anchor, value);
      return {
        label: anchor.label,
        lineOffset: index + 1,
        ok: issue === null,
        present: true,
        issue,
        valueLength: value.length,
      };
    }
    return {
      label: anchor.label,
      lineOffset: null,
      ok: false,
      present: false,
      issue: "missing",
      valueLength: 0,
    };
  });
}

function anchorValueIssue(anchor, value) {
  if (value.length === 0 || placeholderValuePattern.test(value)) {
    return "missing or placeholder value";
  }
  if (weakAnchorValuePattern.test(value)) {
    return "value is too weak";
  }
  if (anchor.minLength && value.length < anchor.minLength) {
    return `value must be at least ${anchor.minLength} characters`;
  }
  if (anchor.requiredPattern && !anchor.requiredPattern.test(value)) {
    return "value must mention managed runtime/session/channel/fallback/auth diagnostics";
  }
  if (anchor.label === "Observed") {
    if (!observedActionPattern.test(value) || !observedResultPattern.test(value)) {
      return "value must describe a concrete action and visible result";
    }
  }
  if (anchor.label === "Diagnostics") {
    const dimensionCount = diagnosticDimensionPatterns.filter((pattern) =>
      pattern.test(value),
    ).length;
    if (dimensionCount < 2) {
      return "value must mention at least two managed diagnostics dimensions";
    }
  }
  if (anchor.label === "Tool result") {
    if (!toolResultSubjectPattern.test(value) || !toolResultOutcomePattern.test(value)) {
      return "value must name a concrete tool/command and result shape";
    }
  }
  if (anchor.label === "Redaction review") {
    if (
      !/(?:redact|redacted|review|checked|no secret|no password|no token|ocr|screenshot|artifact|脱敏|检查|无密码|无密钥|无令牌|截图|证据)/i.test(
        value,
      )
    ) {
      return "value must describe secret redaction review for local artifacts";
    }
  }
  return null;
}

function hasNonPlaceholderAnchor(lines, pattern) {
  for (const line of lines) {
    const match = line.match(pattern);
    if (!match) {
      continue;
    }
    const value = match[1].trim();
    if (value.length > 0 && !placeholderValuePattern.test(value)) {
      return true;
    }
  }
  return false;
}

function inspectArtifactRefs(lines) {
  const artifactLine = lines.find((line) =>
    /^\s*Screenshot\/log ref:\s*(.+)\s*$/i.test(line),
  );
  const value = artifactLine?.match(/^\s*Screenshot\/log ref:\s*(.+)\s*$/i)?.[1]?.trim();
  if (!value || placeholderValuePattern.test(value)) {
    return [
      {
        ref: "",
        reportRef: "<missing-artifact-ref>",
        ok: false,
        issue: "missing artifact ref",
      },
    ];
  }

  const refs = value
    .split(/[;,]/)
    .map((ref) => ref.trim())
    .filter(Boolean);
  if (refs.length === 0) {
    return [
      {
        ref: "",
        reportRef: "<missing-artifact-ref>",
        ok: false,
        issue: "missing artifact ref",
      },
    ];
  }

  return refs.map((ref) => {
    const issue = artifactRefIssue(ref);
    return {
      ref: reportSafeArtifactRef(ref),
      reportRef: reportSafeArtifactRef(ref),
      ok: issue === null,
      issue,
      metadata: issue === null ? artifactMetadata(ref) : undefined,
    };
  });
}

function artifactRefIssue(ref) {
  const externalIssue = externalArtifactRefIssue(ref);
  if (externalIssue !== undefined) {
    return externalIssue;
  }
  const normalized = ref.replace(/^["']|["']$/g, "");
  const absolutePath = path.isAbsolute(normalized)
    ? normalized
    : path.resolve(workspaceRoot, normalized);
  if (!isInsideDirectory(absolutePath, defaultEvidenceDir)) {
    return "is outside .updeng/docs/verification";
  }
  if (!existsSync(absolutePath)) {
    return "is missing";
  }
  const stat = statSync(absolutePath);
  if (!stat.isFile()) {
    return "is not a file";
  }
  const ext = path.extname(absolutePath).toLowerCase();
  if (!textArtifactExtensions.has(ext)) {
    if (!binaryArtifactExtensions.has(ext)) {
      return "uses an unsupported artifact extension";
    }
    return null;
  }
  if (stat.size > maxTextArtifactBytes) {
    return `text artifact exceeds ${maxTextArtifactBytes} bytes`;
  }
  const text = readFileSync(absolutePath, "utf8");
  const forbidden = forbiddenEvidencePatterns
    .map((pattern, index) =>
      pattern.test(text) ? `forbidden-pattern-${index + 1}` : undefined,
    )
    .filter(Boolean);
  if (forbidden.length > 0) {
    return `contains sensitive material matching ${forbidden.join(", ")}`;
  }
  return null;
}

function externalArtifactRefIssue(ref) {
  if (/^http:\/\//i.test(ref)) {
    return "external artifact URL must use https";
  }
  if (!externalArtifactPattern.test(ref)) {
    return undefined;
  }
  try {
    const url = new URL(ref);
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".localhost") ||
      ["example.com", "example.org", "example.net"].includes(hostname)
    ) {
      return "external artifact URL must not use localhost or example domains";
    }
    if (!url.pathname || url.pathname === "/") {
      return "external artifact URL must include a specific artifact path";
    }
    return null;
  } catch {
    return "external artifact URL is invalid";
  }
}

function reportSafeArtifactRef(ref) {
  return forbiddenEvidencePatterns.some((pattern) => pattern.test(ref))
    ? "<redacted-artifact-ref>"
    : ref;
}

function evidenceMarkdownPathIssue(filePath) {
  return markdownPathIssue(filePath, { mustExist: true });
}

function markdownPathIssue(filePath, options = {}) {
  if (!isInsideDirectory(filePath, defaultEvidenceDir)) {
    return "must be under .updeng/docs/verification";
  }
  if (path.extname(filePath).toLowerCase() !== ".md") {
    return "must use a .md extension";
  }
  if (options.mustExist && !existsSync(filePath)) {
    return "does not exist";
  }
  if (options.mustExist && !statSync(filePath).isFile()) {
    return "is not a file";
  }
  return null;
}

function jsonReportFilePathIssue(filePath) {
  if (!isInsideDirectory(filePath, defaultEvidenceDir)) {
    return "must be under .updeng/docs/verification";
  }
  if (path.extname(filePath).toLowerCase() !== ".json") {
    return "must use a .json extension";
  }
  return null;
}

function forbiddenEvidenceMatches(text) {
  return forbiddenEvidencePatterns
    .map((pattern, index) =>
      pattern.test(text) ? `forbidden-pattern-${index + 1}` : undefined,
    )
    .filter(Boolean);
}

function writeJsonReport(outputPath, result) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const evidenceText = readFileSync(result.evidencePath);
  const scriptText = readFileSync(fileURLToPath(import.meta.url));
  const report = {
    generatedAt: new Date().toISOString(),
    evidencePath: result.evidencePath,
    evidenceSha256: sha256(evidenceText),
    verifier: {
      script: path.relative(workspaceRoot, fileURLToPath(import.meta.url)),
      scriptSha256: sha256(scriptText),
      requiredIdVersion: sha256(requiredIds.join("\n")),
      forbiddenRuleCount: forbiddenEvidencePatterns.length,
    },
    ok: result.ok,
    message: result.message,
    summary: {
      requiredCount: requiredIds.length,
      checkedCount: result.itemChecks.filter((item) => item.checked).length,
      missingIdCount: result.missingIds.length,
      uncheckedCount: result.uncheckedItems.length,
      invalidEvidenceCount: result.invalidEvidenceItems.length,
      forbiddenEvidenceRuleCount: result.forbiddenEvidenceMatches.length,
    },
    missingIds: result.missingIds,
    uncheckedItems: result.uncheckedItems,
    invalidEvidenceItems: result.invalidEvidenceItems,
    forbiddenEvidenceMatches: result.forbiddenEvidenceMatches,
    items: result.itemChecks,
  };
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
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

function isInsideDirectory(filePath, directoryPath) {
  const relative = path.relative(directoryPath, filePath);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function artifactMetadata(ref) {
  if (externalArtifactPattern.test(ref)) {
    return { kind: "external-url" };
  }
  const normalized = ref.replace(/^["']|["']$/g, "");
  const absolutePath = path.isAbsolute(normalized)
    ? normalized
    : path.resolve(workspaceRoot, normalized);
  const stat = statSync(absolutePath);
  return {
    kind: "local-file",
    extension: path.extname(absolutePath).toLowerCase(),
    path: path.relative(workspaceRoot, absolutePath),
    sha256: sha256(readFileSync(absolutePath)),
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
    textScanned: textArtifactExtensions.has(path.extname(absolutePath).toLowerCase()),
  };
}

function checklistLinePattern(id) {
  return new RegExp(`^\\s*-\\s\\[[xX\\s]\\]\\s+${escapeRegex(id)}\\b`);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function evidenceTemplate(now) {
  const generatedAt = now.toISOString();
  return `# Managed SSH Real-Target HITL Evidence

Generated at: ${generatedAt}

Rules:

- Do not write passwords, passphrases, private keys, vault refs, external secret refs, tokens, or raw environment variables into this file.
- Use host aliases, fingerprints, redacted session ids, command names, and screenshots/log snippets that prove behavior without exposing secrets.
- Keep this evidence file under \`.updeng/docs/verification/\` with a \`.md\` extension.
- Mark an item complete only after the real app behavior was observed in a Tauri window or through an explicit real-target smoke command.
- Every HITL checklist item must stay in exact checkbox form, for example \`- [x] HITL-001 no-save-password: ...\`; mentioning a HITL id in prose is not completion evidence.
- Every completed HITL item must include structured, non-placeholder evidence under its \`Evidence:\` block. Required anchors: \`Target alias:\`, \`Observed:\`, \`Diagnostics:\`, \`Tool result:\`, \`Screenshot/log ref:\`, and \`Redaction review:\`.
- \`Observed:\`, \`Diagnostics:\`, and \`Tool result:\` must be specific evidence summaries, not \`ok\`, \`passed\`, or other one-word status. \`Diagnostics:\` must name managed runtime/session/channel/fallback/auth evidence such as \`recentLegacyFallbacks=[]\`, channel counts, backend, or bulk-transfer lane.
- \`HITL-008\` evidence must explicitly mention an active SFTP/transfer, terminal input typed or echoed while that transfer is active, and visible responsiveness/latency evidence such as \`within 1s\`, \`<=500ms\`, a measured latency, or an equivalent responsive-window observation.
- \`Screenshot/log ref:\` must include at least one existing local evidence file under \`.updeng/docs/verification/\`; optional external \`https://\` review links may be added only as supplemental refs with concrete artifact paths. External links must not use localhost or example domains. Separate multiple refs with commas or semicolons.
- Local text evidence files (\`.md\`, \`.log\`, \`.txt\`, \`.json\`, \`.toml\`, \`.yml\`, \`.yaml\`, \`.csv\`, \`.html\`) are scanned for the same obvious secret patterns as this checklist, including password/passphrase/private key material, vault/external secret refs, Bearer tokens, API keys, token env vars, and JSON/YAML secret fields. Binary screenshot/video artifacts (\`.png\`, \`.jpg\`, \`.jpeg\`, \`.gif\`, \`.mp4\`, \`.mov\`, \`.webm\`) are checked for existence/hash and require \`Redaction review:\` evidence confirming manual/OCR redaction review.
- For final closeout, generate a machine-readable report with \`--json-report .updeng/docs/verification/managed-ssh-hitl-YYYYMMDD.json\`; the report records item status, evidence/script hashes, local artifact hashes, and artifact validation without echoing matched secret text.
- Default managed success paths must keep \`recentLegacyFallbacks=[]\`; legacy fallback is acceptable only for explicit unsupported/unwired/compatibility cases.

## Execution Matrix

| HITL | Real target setup | Required actions | Required local artifacts |
| --- | --- | --- | --- |
| HITL-001 no-save-password | SSH host alias with no saved password or key passphrase in host TOML | Open terminal, enter password/passphrase inside current xterm, then use right SFTP, tmux/system/container/port/remote command/MCP without re-entering the same secret | xterm prompt screenshot, runtime snapshot JSON/log, downstream tool result log |
| HITL-002 saved-password-vault | SSH host alias whose host TOML contains only redacted secret refs and whose secret is in encrypted vault | Open terminal and SFTP through managed runtime, inspect sanitized host TOML and runtime diagnostics | sanitized host TOML snippet, runtime snapshot JSON/log, SFTP result log |
| HITL-003 private-key-passphrase | Private-key target with passphrase and no key material in evidence | Open terminal through managed runtime, enter passphrase through expected prompt path, then use SFTP/exec/MCP | passphrase prompt screenshot, runtime snapshot JSON/log, SFTP/exec result log |
| HITL-004 agent-auth | Target authenticating through ssh-agent | Open terminal, SFTP, and remote command without password prompt or fallback | agent target runtime snapshot JSON/log, SFTP and command result log |
| HITL-005 jump-host | Jump-host route with redacted jump and target aliases | Validate jump route, open terminal, SFTP, exec, port, and MCP without bypassing jump | redacted route diagnostics, runtime snapshot JSON/log, tool result log |
| HITL-006 external-launch-no-save | Real external launch source such as PuTTY/MobaXterm/Xshell/SecureCRT/OpenSSH/Kerminal native with no saved host password | Launch Kerminal externally, open managed tab, use right SFTP/exec/MCP with session-only auth; if it fails, record whether the visible dialog is "外部 SSH 启动未接收" or "外部 SSH 启动失败" | external launch redacted intake log, optional failure dialog screenshot/log, runtime snapshot JSON/log, tool result log |
| HITL-007 host-key-and-auth-cancel | Test target or controlled host-key/auth-cancel scenario | Trigger host-key-required/changed and auth cancel, confirm stable managed errors and no silent legacy connection | error screenshot/log, runtime snapshot JSON/log showing fallback state |
| HITL-008 disconnect-reconnect-concurrency | Real host capable of high terminal output, SFTP transfer, port forward, polling, and MCP command | Run high output, large transfer, polling, port forward, and MCP concurrently; while the transfer is active, type a terminal command and record input echo/result latency or visible responsive-window evidence; interrupt/reconnect and confirm cleanup | concurrency screenshot/video/log, terminal input latency/echo log, transfer log, runtime snapshot JSON/log showing bulk-transfer and cleanup |
| HITL-009 codex-claude-agent-prompt | Real Codex and Claude CLI available in Kerminal terminal | Exercise multiline input, paste/navigation keys, cancel keys, and optional submit smoke after managed SSH changes | Codex prompt screenshot/log, Claude prompt screenshot/log, terminal runtime diagnostics |
| HITL-010 diagnostics-and-redaction | Any real target used above plus settings/MCP diagnostics access | Capture settings diagnostics, runtime snapshot, tool_help/operation_guide/tool results, and right sidebar panels without managed SSH notice boxes | settings screenshot, runtime snapshot JSON/log, MCP/tool output log, sidebar screenshot |

## Required Evidence

- [ ] HITL-001 no-save-password: A real SSH host without saved password opens terminal, asks for password/passphrase inside the current xterm, then SFTP, tmux, system info, container, port forwarding, remote command, and MCP runtime tools reuse the same authenticated target without asking for the same secret again.
  Evidence:
  Target alias:
  Observed:
  Diagnostics:
  Tool result:
  Screenshot/log ref:
  Redaction review:

- [ ] HITL-002 saved-password-vault: A saved-password host uses encrypted vault material, host TOML contains only secret refs, and diagnostics/MCP/runtime output exposes only redacted auth fingerprints.
  Evidence:
  Target alias:
  Observed:
  Diagnostics:
  Tool result:
  Screenshot/log ref:
  Redaction review:

- [ ] HITL-003 private-key-passphrase: A private-key target with passphrase opens terminal through managed runtime; passphrase is entered through the expected prompt path, and SFTP/exec/MCP reuse the managed session without leaking key material.
  Evidence:
  Target alias:
  Observed:
  Diagnostics:
  Tool result:
  Screenshot/log ref:
  Redaction review:

- [ ] HITL-004 agent-auth: An SSH agent target opens terminal and at least SFTP plus remote command through managed runtime without password prompt or fallback.
  Evidence:
  Target alias:
  Observed:
  Diagnostics:
  Tool result:
  Screenshot/log ref:
  Redaction review:

- [ ] HITL-005 jump-host: A jump-host route validates both jump and target auth prompts or auth sources, keeps jump route in the redacted session key, and SFTP/exec/port/MCP do not bypass the jump host.
  Evidence:
  Target alias:
  Observed:
  Diagnostics:
  Tool result:
  Screenshot/log ref:
  Redaction review:

- [ ] HITL-006 external-launch-no-save: A real external SSH launch from PuTTY/MobaXterm/Xshell/SecureCRT/OpenSSH/Kerminal native no-save material opens a Kerminal tab and the right-side SFTP/exec/MCP tools reuse session-only auth.
  Evidence:
  Target alias:
  Observed:
  Diagnostics:
  Tool result:
  Screenshot/log ref:
  Redaction review:

- [ ] HITL-007 host-key-and-auth-cancel: Host-key-changed and auth-cancel paths return stable managed errors, show auth-required or host-key-required in diagnostics/model evidence, and do not silently open a legacy connection.
  Evidence:
  Target alias:
  Observed:
  Diagnostics:
  Tool result:
  Screenshot/log ref:
  Redaction review:

- [ ] HITL-008 disconnect-reconnect-concurrency: Terminal high output, a large SFTP transfer, system polling, a port forward, and an MCP command run together on a real target; while the transfer is active, typed terminal input is echoed or returns within a recorded latency/window, transfer uses bulk-transfer isolation where applicable, and reconnect/cleanup state is visible after interruption.
  Evidence:
  Target alias:
  Observed: <include active SFTP/transfer state, the terminal input typed while transfer was active, echo/result behavior, and recorded latency/window>
  Diagnostics:
  Tool result: <include transfer status plus the terminal command echo/result timing and any port/MCP/polling result>
  Screenshot/log ref:
  Redaction review:

- [ ] HITL-009 codex-claude-agent-prompt: Real Codex and Claude CLI prompts run inside Kerminal terminal after managed SSH changes; multiline input, paste/navigation keys, cancel keys, and optional submit smoke behave correctly.
  Evidence:
  Target alias:
  Observed:
  Diagnostics:
  Tool result:
  Screenshot/log ref:
  Redaction review:

- [ ] HITL-010 diagnostics-and-redaction: Settings diagnostics, \`kerminal.runtime_snapshot.managedSsh\`, tool help/operation guide, and actual tool results show session id/backend/channel/fallback state; right sidebar function panels show no red/orange/green managed SSH notices; no secret text appears in screenshots, logs, MCP output, or this evidence file.
  Evidence:
  Target alias:
  Observed:
  Diagnostics:
  Tool result:
  Screenshot/log ref:
  Redaction review:

## Suggested Commands

\`\`\`powershell
pnpm run smoke:ssh-terminal:password
pnpm run smoke:ssh-terminal:password:wsl
cargo test --manifest-path src-tauri/Cargo.toml --test terminal_agent_cli_hitl_matrix -- --ignored --nocapture
pnpm run build
pnpm run tauri:dev
pnpm run verify:managed-ssh-hitl -- --check .updeng/docs/verification/managed-ssh-hitl-YYYYMMDD.md --json-report .updeng/docs/verification/managed-ssh-hitl-YYYYMMDD.json
pnpm run verify:managed-ssh-hitl -- --preflight --json-report .updeng/docs/verification/managed-ssh-hitl-preflight-YYYYMMDD.json
\`\`\`
`;
}

function captureGuideTemplate(now) {
  const generatedAt = now.toISOString();
  return `# Managed SSH HITL Capture Guide

生成时间：${generatedAt}

这是一份真实主机人工采集清单，不是完成证明。不要把密码、私钥正文、passphrase、vault 引用、token、原始环境变量、需要保密的公网 IP、未脱敏的用户名或本机路径写进任何文件。

## 最终要交的文件

- 证据文档：\`.updeng/docs/verification/managed-ssh-hitl-YYYYMMDD.md\`
- JSON 报告：\`.updeng/docs/verification/managed-ssh-hitl-YYYYMMDD.json\`
- 最终检查命令：

\`\`\`powershell
pnpm run verify:managed-ssh-hitl -- --check .updeng/docs/verification/managed-ssh-hitl-YYYYMMDD.md --json-report .updeng/docs/verification/managed-ssh-hitl-YYYYMMDD.json
\`\`\`

## 操作规则

- 目标只写别名，例如 \`target-no-save\`、\`target-vault\`、\`target-agent\`、\`jump-redacted\`。
- 每个 HITL 项至少放 1 个本地证据文件，位置必须在 \`.updeng/docs/verification/\`。
- 文本证据只保留短日志或总结。截图、录屏要在证据文档里写明已人工或 OCR 脱敏检查。
- 正常 managed 路径应看到 \`recentLegacyFallbacks=[]\` 或等价的空 fallback。若出现 fallback，必须写清是 unsupported、unwired 还是显式兼容路径。
- 右侧所有功能栏不能出现 managed SSH 红色、橙色或绿色提示框；诊断信息只放在设置页、MCP 或 runtime 输出里。
- 填 evidence 时每项都保留这 6 个英文锚点：\`Target alias:\`、\`Observed:\`、\`Diagnostics:\`、\`Tool result:\`、\`Screenshot/log ref:\`、\`Redaction review:\`。

## 建议文件名

| HITL | 建议本地证据文件 |
| --- | --- |
| HITL-001 no-save-password | \`managed-ssh-hitl-001-xterm-prompt.png\`, \`managed-ssh-hitl-001-runtime.json\`, \`managed-ssh-hitl-001-tools.log\` |
| HITL-002 saved-password-vault | \`managed-ssh-hitl-002-host-toml-sanitized.md\`, \`managed-ssh-hitl-002-runtime.json\`, \`managed-ssh-hitl-002-sftp.log\` |
| HITL-003 private-key-passphrase | \`managed-ssh-hitl-003-xterm-prompt.png\`, \`managed-ssh-hitl-003-runtime.json\`, \`managed-ssh-hitl-003-tools.log\` |
| HITL-004 agent-auth | \`managed-ssh-hitl-004-runtime.json\`, \`managed-ssh-hitl-004-sftp-command.log\` |
| HITL-005 jump-host | \`managed-ssh-hitl-005-route-redacted.md\`, \`managed-ssh-hitl-005-runtime.json\`, \`managed-ssh-hitl-005-tools.log\` |
| HITL-006 external-launch-no-save | \`managed-ssh-hitl-006-external-launch-redacted.log\`, \`managed-ssh-hitl-006-dialog.png\`, \`managed-ssh-hitl-006-runtime.json\`, \`managed-ssh-hitl-006-tools.log\` |
| HITL-007 host-key-and-auth-cancel | \`managed-ssh-hitl-007-error.png\`, \`managed-ssh-hitl-007-runtime.json\`, \`managed-ssh-hitl-007-errors.log\` |
| HITL-008 disconnect-reconnect-concurrency | \`managed-ssh-hitl-008-concurrency.mp4\`, \`managed-ssh-hitl-008-latency.log\`, \`managed-ssh-hitl-008-transfer.log\`, \`managed-ssh-hitl-008-runtime.json\` |
| HITL-009 codex-claude-agent-prompt | \`managed-ssh-hitl-009-codex.png\`, \`managed-ssh-hitl-009-claude.png\`, \`managed-ssh-hitl-009-terminal-diagnostics.json\` |
| HITL-010 diagnostics-and-redaction | \`managed-ssh-hitl-010-settings.png\`, \`managed-ssh-hitl-010-runtime.json\`, \`managed-ssh-hitl-010-mcp-tools.log\`, \`managed-ssh-hitl-010-sidebar.png\` |

## 填写方法

### HITL-001 no-save-password

1. 准备一个没有保存凭据的真实 SSH 主机，只记录别名。
2. 在 Kerminal 打开 SSH terminal，在当前 xterm 里输入认证内容。
3. 不要重新输入同一份认证内容，继续打开右侧文件、tmux 或系统面板、端口转发、远程命令和 MCP 工具。
4. 证据写清 managed backend、session、channel 状态和各工具结果。

### HITL-002 saved-password-vault

1. 使用凭据已保存到 encrypted vault 的主机。
2. host TOML 截图或片段只能显示脱敏引用，不能显示真实 secret。
3. 打开 terminal 和 SFTP，记录 runtime 诊断和 SFTP 成功结果。

### HITL-003 private-key-passphrase

1. 使用需要 passphrase 的私钥主机，不记录私钥正文。
2. 确认 passphrase 走当前终端 prompt。
3. 不再次输入 passphrase，复用 SFTP、exec、MCP，并记录诊断和结果。

### HITL-004 agent-auth

1. 使用 ssh-agent 可认证的真实主机。
2. 打开 terminal、SFTP 和一个远程命令。
3. 证据要说明没有认证弹窗、没有 legacy fallback。

### HITL-005 jump-host

1. 使用真实跳板机链路，跳板和目标都只写别名。
2. 验证 terminal、SFTP、exec、端口转发和 MCP 都经过跳板链路。
3. 诊断里要能看到脱敏 route/session key，证明工具没有绕过跳板机。

### HITL-006 external-launch-no-save

1. 从真实外部启动来源打开 Kerminal，例如 PuTTY、MobaXterm、Xshell、SecureCRT、OpenSSH 或 Kerminal native。
2. 不保存凭据，只用 session-only 认证打开 managed tab。
3. 如果能打开 managed tab，继续使用右侧 SFTP、exec、MCP，记录脱敏 intake、runtime 诊断和工具结果。
4. 如果外部工具打开了 Kerminal 但没有进入 tab，保存弹窗或日志：看到“外部 SSH 启动未接收”表示参数未进入 pending 队列或被策略拒绝；看到“外部 SSH 启动失败”表示 pending 已接收但 materialize/open tab 失败。
5. SecureCRT/Xshell 出现 \`Unknown server key\` 时，先按“主机密钥确认”处理，再复测外部启动。

### HITL-007 host-key-and-auth-cancel

1. 这项测的是“主机密钥确认”和“取消登录”，不是常规成功连接。
2. 遇到未知或变化的主机密钥时，Kerminal 要明确提示；如果选择信任，再继续连接。
3. 在密码、passphrase 或主机密钥确认时点取消，Kerminal 要停止连接，不偷偷换旧连接方式。
4. 保存错误界面或日志、runtime fallback 状态。

### HITL-008 disconnect-reconnect-concurrency

1. 同时运行高输出 terminal、一个正在传输的 SFTP、系统轮询、端口转发和一个 MCP 命令。
2. 传输进行中，在 terminal 输入一条命令。
3. 记录输入回显或结果时间，例如 \`within 1s\`、\`<=500ms\` 或实测 latency。
4. 再做一次断开或重连，保存清理状态。

### HITL-009 codex-claude-agent-prompt

1. 在 Kerminal terminal 里启动真实 Codex CLI 和 Claude CLI。
2. 验证多行输入、粘贴、方向键/导航键和取消键。
3. 若要做 submit smoke，必须在证据里明确写允许提交；否则只做 no-submit 检查。
4. 保存脱敏截图、短日志和 terminal runtime 诊断。

### HITL-010 diagnostics-and-redaction

1. 保存设置页诊断、\`kerminal.runtime_snapshot.managedSsh\`、tool help、operation guide 和真实工具结果。
2. 保存右侧功能栏截图，确认没有 managed SSH 红/橙/绿提示框。
3. 运行最终检查前，逐个检查证据文件，确认没有 secret、私钥、token 或未脱敏路径。
`;
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
