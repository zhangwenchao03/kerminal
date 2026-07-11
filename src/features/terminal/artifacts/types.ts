// @author kongweiguang

/** 终端产物类型；首版仅覆盖可稳定识别和安全执行的目标。 */
export type TerminalArtifactKind =
  | "directory"
  | "link"
  | "command"
  | "path"
  | "url"
  | "log";

export type TerminalArtifactSource =
  | "osc7"
  | "osc8"
  | "link-provider"
  | "command-block"
  | "heuristic";

export type TerminalArtifactPathStyle =
  | "posix"
  | "windows"
  | "unc"
  | "uri"
  | "none";

export type TerminalArtifactSensitivity =
  | "normal"
  | "sensitive"
  | "blocked";

/** 标识产物所属运行目标，避免把远端路径误交给本机文件动作。 */
export interface TerminalArtifactTargetIdentity {
  kind: "local" | "ssh" | "container" | "serial" | "telnet" | "unknown";
  id: string;
  host?: string;
}

export interface TerminalArtifactRange {
  endColumn?: number;
  endLine?: number;
  startColumn?: number;
  startLine?: number;
}

export interface TerminalArtifactActionMetadata {
  id:
    | "open"
    | "reveal"
    | "copy"
    | "open-terminal"
    | "rerun-command";
  enabled: boolean;
  requiresConfirmation: boolean;
  disabledReason?: string;
}

/** 供 Inspector、菜单和 Agent 消费的短生命周期只读产物。 */
export interface TerminalArtifact {
  actions: readonly TerminalArtifactActionMetadata[];
  createdAt: number;
  dedupeKey: string;
  id: string;
  kind: TerminalArtifactKind;
  label: string;
  paneId: string;
  pathStyle: TerminalArtifactPathStyle;
  revision: number;
  sensitivity: TerminalArtifactSensitivity;
  source: TerminalArtifactSource;
  target: TerminalArtifactTargetIdentity;
  value: string;
  range?: TerminalArtifactRange;
}

export interface TerminalArtifactCandidate {
  kind: TerminalArtifactKind;
  label?: string;
  pathStyle?: TerminalArtifactPathStyle;
  range?: TerminalArtifactRange;
  source: TerminalArtifactSource;
  value: string;
}

export interface TerminalArtifactIndexSnapshot {
  artifacts: readonly TerminalArtifact[];
  degraded: boolean;
  disposed: boolean;
  evictions: number;
  paneId: string;
  rejected: number;
  revision: number;
}
