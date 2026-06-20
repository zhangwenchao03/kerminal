import type { TerminalPane } from "../workspace/types";

export type BroadcastRisk = "batch" | "remote" | "destructive";

export interface BroadcastCommandTarget {
  mode: TerminalPane["mode"];
  paneId: string;
  title: string;
}

export interface BroadcastCommandAnalysis {
  command: string;
  data: string;
  reasons: string[];
  requiresConfirmation: boolean;
  risks: BroadcastRisk[];
  targetCount: number;
  targets: BroadcastCommandTarget[];
}

const destructivePatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[^\s]*r[^\s]*f|-rf|-fr)\b/i, reason: "包含 rm 递归删除" },
  { pattern: /\bremove-item\b[\s\S]*\b-recurse\b/i, reason: "包含 PowerShell 递归删除" },
  { pattern: /\bdel\s+\/s\b/i, reason: "包含 Windows 批量删除" },
  { pattern: /\bformat\b/i, reason: "包含格式化命令" },
  { pattern: /\bmkfs(\.[\w-]+)?\b/i, reason: "包含文件系统格式化" },
  { pattern: /\bdd\s+.*\bof=/i, reason: "包含磁盘写入命令" },
  { pattern: /\bshutdown\b|\breboot\b|\bpoweroff\b|\bhalt\b/i, reason: "包含关机或重启命令" },
  { pattern: /\bdrop\s+database\b|\btruncate\s+table\b/i, reason: "包含数据库破坏性操作" },
  { pattern: /\bkubectl\s+delete\b/i, reason: "包含 Kubernetes 删除操作" },
  { pattern: /\bdocker\s+(rm|rmi|volume\s+rm)\b/i, reason: "包含 Docker 删除操作" },
  { pattern: /\bgit\s+reset\s+--hard\b/i, reason: "包含 Git 强制重置" },
  { pattern: /\bchmod\s+-R\s+777\b/i, reason: "包含递归放宽权限" },
];

export function analyzeBroadcastCommand(
  command: string,
  targets: BroadcastCommandTarget[],
): BroadcastCommandAnalysis {
  const normalizedCommand = command.trim();
  const risks = new Set<BroadcastRisk>();
  const reasons: string[] = [];

  if (targets.length > 1) {
    risks.add("batch");
    reasons.push(`将发送到 ${targets.length} 个分屏`);
  }

  if (targets.some((target) => target.mode === "ssh" || target.mode === "container")) {
    risks.add("remote");
    reasons.push("包含远程分屏");
  }

  const destructiveReasons = destructivePatterns
    .filter((item) => item.pattern.test(normalizedCommand))
    .map((item) => item.reason);
  if (destructiveReasons.length > 0) {
    risks.add("destructive");
    reasons.push(...destructiveReasons);
  }

  return {
    command: normalizedCommand,
    data: `${normalizedCommand}\r`,
    reasons,
    requiresConfirmation: risks.size > 0,
    risks: Array.from(risks),
    targetCount: targets.length,
    targets,
  };
}

export function canBroadcastCommand(analysis: BroadcastCommandAnalysis) {
  return analysis.command.length > 0 && analysis.targetCount > 0;
}
