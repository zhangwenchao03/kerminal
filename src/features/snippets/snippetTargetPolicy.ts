import type { CommandHistoryTarget } from "../../lib/commandHistoryApi";
import type { SnippetContextBinding } from "../../lib/snippetApi";
import type { PaneSessionRecord } from "../terminal/terminalSessionRegistry";

export type SnippetPlatform = "linux" | "macos" | "windows" | "unknown";
export type SnippetShell = "posix" | "powershell" | "cmd" | "unknown";
export type SnippetRisk = "inspect" | "change" | "destructive" | "unknown";
export type SnippetDuration = "instant" | "streaming" | "highIo";
export type SnippetCompatibility = "compatible" | "unknown" | "incompatible";

export interface SnippetTargetSnapshot {
  paneId: string;
  sessionId: string;
  targetId: string;
  targetKind: CommandHistoryTarget | "container" | "serial" | "telnet";
  displayName: string;
  hostId?: string;
  platform: SnippetPlatform;
  shell: SnippetShell;
  production: boolean;
  capabilities: readonly string[];
  connectionGeneration: number;
  capturedAt: number;
}

export interface SnippetCompatibilityRequirements {
  scopes: readonly (CommandHistoryTarget | "container" | "serial" | "telnet")[];
  platforms: readonly SnippetPlatform[];
  shells: readonly SnippetShell[];
  capabilities: readonly string[];
  contextBindings: readonly SnippetContextBinding[];
}

export interface SnippetPolicyDecision {
  compatibility: SnippetCompatibility;
  reasons: readonly string[];
  effectiveRisk: SnippetRisk;
  canInsert: boolean;
  canRun: boolean;
  requiresConfirmation: boolean;
  requiresStrongConfirmation: boolean;
}

interface CreateSnippetTargetSnapshotInput {
  paneId: string;
  record: PaneSessionRecord;
  connectionGeneration: number;
  displayName?: string;
  platform?: SnippetPlatform;
  shell?: SnippetShell;
  production?: boolean;
  capabilities?: readonly string[];
  capturedAt?: number;
}

/**
 * 从现有运行态上下文生成不可变目标快照；该函数不发起本地或远程探测。
 */
export function createSnippetTargetSnapshot({
  paneId,
  record,
  connectionGeneration,
  displayName,
  platform = "unknown",
  shell,
  production = false,
  capabilities = [],
  capturedAt = Date.now(),
}: CreateSnippetTargetSnapshotInput): SnippetTargetSnapshot {
  const targetKind = targetKindFromRecord(record);
  return Object.freeze({
    paneId,
    sessionId: record.sessionId,
    targetId: record.targetRef ?? record.remoteHostId ?? record.sessionId,
    targetKind,
    displayName: displayName?.trim() || record.targetRef || record.remoteHostId || "本地终端",
    ...(record.remoteHostId ? { hostId: record.remoteHostId } : {}),
    platform,
    shell: shell ?? normalizeSnippetShell(record.shell),
    production,
    capabilities: Object.freeze([...new Set(capabilities.map((item) => item.trim()).filter(Boolean))].sort()),
    connectionGeneration,
    capturedAt,
  });
}

/** 快照必须仍绑定相同 pane/session/target/generation，禁止确认期间静默改投。 */
export function isSnippetTargetSnapshotCurrent(
  snapshot: SnippetTargetSnapshot,
  current: SnippetTargetSnapshot | null,
): boolean {
  return Boolean(
    current &&
      snapshot.paneId === current.paneId &&
      snapshot.sessionId === current.sessionId &&
      snapshot.targetId === current.targetId &&
      snapshot.connectionGeneration === current.connectionGeneration,
  );
}

/**
 * 统一计算兼容性和执行门禁。环境元数据未知的只读命令允许人工确认后运行，
 * 但明确不兼容、目标绑定未知或风险未知时仍禁止提交。
 */
export function evaluateSnippetPolicy({
  snapshot,
  requirements,
  risk,
  hasLegacyRaw = false,
  sensitive = false,
}: {
  snapshot: SnippetTargetSnapshot;
  requirements: SnippetCompatibilityRequirements;
  risk: SnippetRisk;
  hasLegacyRaw?: boolean;
  sensitive?: boolean;
}): SnippetPolicyDecision {
  const reasons: string[] = [];
  let compatibility: SnippetCompatibility = "compatible";
  if (requirements.scopes.length > 0 && !requirements.scopes.includes(snapshot.targetKind)) {
    compatibility = "incompatible";
    reasons.push("当前连接类型不适用");
  }
  compatibility = combineCompatibility(
    compatibility,
    classifyKnownValue(snapshot.platform, requirements.platforms, "尚未读取目标平台", "目标平台不兼容", reasons),
  );
  compatibility = combineCompatibility(
    compatibility,
    classifyKnownValue(snapshot.shell, requirements.shells, "尚未识别当前 shell", "目标 shell 不兼容", reasons),
  );
  const contextCompatibility = classifyContextBindings(
    snapshot,
    requirements.contextBindings,
    reasons,
  );
  compatibility = combineCompatibility(compatibility, contextCompatibility);
  const missingCapabilities = requirements.capabilities.filter(
    (capability) => !snapshot.capabilities.includes(capability),
  );
  if (missingCapabilities.length > 0 && compatibility !== "incompatible") {
    compatibility = "unknown";
    reasons.push(`尚未验证命令可用性：${missingCapabilities.join("、")}`);
  }

  const effectiveRisk = hasLegacyRaw && risk === "inspect" ? "change" : risk;
  const unknownEnvironmentInspect =
    compatibility === "unknown" &&
    contextCompatibility === "compatible" &&
    effectiveRisk === "inspect";
  const requiresConfirmation =
    snapshot.production ||
    sensitive ||
    effectiveRisk !== "inspect" ||
    unknownEnvironmentInspect;
  const canInsert = compatibility !== "incompatible";
  const canRun =
    (compatibility === "compatible" || unknownEnvironmentInspect) &&
    effectiveRisk !== "unknown";
  return {
    compatibility,
    reasons,
    effectiveRisk,
    canInsert,
    canRun,
    requiresConfirmation,
    requiresStrongConfirmation: effectiveRisk === "destructive",
  };
}

function classifyContextBindings(
  snapshot: SnippetTargetSnapshot,
  bindings: readonly SnippetContextBinding[],
  reasons: string[],
): SnippetCompatibility {
  if (bindings.length === 0 || bindings.some((binding) => binding.kind === "global")) {
    return "compatible";
  }
  if (
    bindings.some(
      (binding) =>
        binding.kind === "host" &&
        Boolean(binding.targetId) &&
        (binding.targetId === snapshot.hostId || binding.targetId === snapshot.targetId),
    )
  ) {
    return "compatible";
  }
  if (bindings.every((binding) => binding.kind === "host") && snapshot.hostId) {
    reasons.push("当前主机不符合片段绑定");
    return "incompatible";
  }
  reasons.push("当前无法确认工作区或主机组绑定");
  return "unknown";
}

export function normalizeSnippetShell(shell?: string): SnippetShell {
  const value = shell?.trim().toLowerCase() ?? "";
  const segments = value.split(/[\\/]/);
  const executable = (segments[segments.length - 1] ?? "").replace(/\.exe$/, "");
  if (executable === "powershell" || executable === "pwsh") return "powershell";
  if (executable === "cmd") return "cmd";
  if (["bash", "zsh", "sh", "fish", "dash", "ksh"].includes(executable)) {
    return "posix";
  }
  return "unknown";
}

function targetKindFromRecord(
  record: PaneSessionRecord,
): SnippetTargetSnapshot["targetKind"] {
  if (record.containerId) return "container";
  return record.target;
}

function classifyKnownValue<T extends string>(
  value: T,
  allowed: readonly T[],
  unknownReason: string,
  incompatibleReason: string,
  reasons: string[],
): SnippetCompatibility {
  if (allowed.length === 0) return "compatible";
  if (value === "unknown") {
    reasons.push(unknownReason);
    return "unknown";
  }
  if (!allowed.includes(value)) {
    reasons.push(incompatibleReason);
    return "incompatible";
  }
  return "compatible";
}

function combineCompatibility(
  left: SnippetCompatibility,
  right: SnippetCompatibility,
): SnippetCompatibility {
  if (left === "incompatible" || right === "incompatible") return "incompatible";
  if (left === "unknown" || right === "unknown") return "unknown";
  return "compatible";
}
