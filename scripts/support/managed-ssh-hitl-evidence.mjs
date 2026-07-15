import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "..", "..");
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


export function checkEvidence(text, evidencePath) {
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

export function evidenceMarkdownPathIssue(filePath) {
  return markdownPathIssue(filePath, { mustExist: true });
}

export function markdownPathIssue(filePath, options = {}) {
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

export function jsonReportFilePathIssue(filePath) {
  if (!isInsideDirectory(filePath, defaultEvidenceDir)) {
    return "must be under .updeng/docs/verification";
  }
  if (path.extname(filePath).toLowerCase() !== ".json") {
    return "must use a .json extension";
  }
  return null;
}

export function forbiddenEvidenceMatches(text) {
  return forbiddenEvidencePatterns
    .map((pattern, index) =>
      pattern.test(text) ? `forbidden-pattern-${index + 1}` : undefined,
    )
    .filter(Boolean);
}

export function writeJsonReport(outputPath, result) {
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


export function isInsideDirectory(filePath, directoryPath) {
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

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
