import type {
  ManagedSshLegacyFallbackSnapshot,
  ManagedSshRuntimeSnapshot,
  ManagedSshSessionSnapshot,
} from "../../lib/diagnosticsApi";
import type { SshTerminalFailure } from "../terminal/terminalSshFailurePolicy";
import { classifySshTerminalFailure } from "../terminal/terminalSshFailurePolicy";
import type { Machine, TerminalPane } from "../workspace/types";

export type ManagedSshToolCapability = "shell" | "sftp" | "exec" | "forward";

export type ManagedSshToolAvailabilityKind =
  | "managed-reusable"
  | "legacy-terminal-only"
  | "auth-required"
  | "host-key-required"
  | "action-required"
  | "unsupported"
  | "no-target";

export interface ManagedSshToolAvailabilityInput {
  focusedPane?: TerminalPane;
  managedSsh?: ManagedSshRuntimeSnapshot | null;
  requiredCapability?: ManagedSshToolCapability;
  selectedMachine?: Machine;
}

export interface ManagedSshToolAvailability {
  canAttemptConnection: boolean;
  canUseConnectedSession: boolean;
  detail: string;
  kind: ManagedSshToolAvailabilityKind;
  label: string;
  legacyFallback?: ManagedSshLegacyFallbackSnapshot;
  session?: ManagedSshSessionSnapshot;
  targetLabel?: string;
}

const capabilityAliases: Record<ManagedSshToolCapability, string[]> = {
  exec: ["exec", "command", "tmux", "server", "container", "mcp"],
  forward: ["forward", "port", "tunnel"],
  sftp: ["sftp", "file", "transfer"],
  shell: ["shell", "terminal"],
};

export function resolveManagedSshToolAvailability({
  focusedPane,
  managedSsh,
  requiredCapability,
  selectedMachine,
}: ManagedSshToolAvailabilityInput): ManagedSshToolAvailability {
  if (!selectedMachine) {
    return {
      canAttemptConnection: false,
      canUseConnectedSession: false,
      detail: "没有选中的目标主机。",
      kind: "no-target",
      label: "No target",
    };
  }

  if (selectedMachine.kind !== "ssh") {
    return {
      canAttemptConnection: false,
      canUseConnectedSession: false,
      detail: "当前目标不是 SSH 主机，不能复用 managed SSH runtime。",
      kind: "unsupported",
      label: "Unsupported",
      targetLabel: selectedMachine.name,
    };
  }

  const targetLabel = sshMachineTargetLabel(selectedMachine);
  const session = findManagedSessionForMachine(managedSsh, selectedMachine);
  const relevantFallback = findRecentFallbackForMachine(
    managedSsh,
    selectedMachine,
    requiredCapability,
  );
  const diagnosticFailure = classifyAvailabilityFailure(
    session?.lastError,
    relevantFallback?.reason,
  );

  if (
    diagnosticFailure &&
    isHostKeyFailureClass(diagnosticFailure.class)
  ) {
    return {
      canAttemptConnection: false,
      canUseConnectedSession: false,
      detail: diagnosticFailure.userMessage,
      kind: "host-key-required",
      label: "Host key required",
      legacyFallback: relevantFallback,
      session,
      targetLabel,
    };
  }

  if (
    diagnosticFailure &&
    isCredentialFailureClass(diagnosticFailure.class)
  ) {
    return {
      canAttemptConnection: false,
      canUseConnectedSession: false,
      detail: diagnosticFailure.userMessage,
      kind: "auth-required",
      label: "Auth required",
      legacyFallback: relevantFallback,
      session,
      targetLabel,
    };
  }

  if (
    diagnosticFailure?.class === "channelUnsupported" ||
    (requiredCapability &&
      relevantFallback &&
      isUnsupportedFallback(relevantFallback))
  ) {
    return {
      canAttemptConnection: false,
      canUseConnectedSession: false,
      detail:
        diagnosticFailure?.userMessage ??
        "该能力当前只命中 unsupported/unwired legacy fallback。下一步：切换 backend 或显式使用兼容模式。",
      kind: "unsupported",
      label: "Unsupported",
      legacyFallback: relevantFallback,
      session,
      targetLabel,
    };
  }

  if (diagnosticFailure && diagnosticFailure.class !== "unknown") {
    return {
      canAttemptConnection: diagnosticFailure.retryable,
      canUseConnectedSession: false,
      detail: diagnosticFailure.userMessage,
      kind: "action-required",
      label: "Action required",
      legacyFallback: relevantFallback,
      session,
      targetLabel,
    };
  }

  if (session?.state === "ready") {
    return {
      canAttemptConnection: true,
      canUseConnectedSession: true,
      detail: "当前 SSH 目标已有 ready managed session，可按能力打开独立 channel。",
      kind: "managed-reusable",
      label: "Managed reusable",
      session,
      targetLabel,
    };
  }

  if (focusedPaneMatchesSshMachine(focusedPane, selectedMachine)) {
    return {
      canAttemptConnection: true,
      canUseConnectedSession: false,
      detail:
        "当前终端属于该 SSH 主机，但没有可观测 managed session；右侧工具不能把 PTY 连接当作可复用 runtime。",
      kind: "legacy-terminal-only",
      label: "Legacy terminal only",
      legacyFallback: relevantFallback,
      targetLabel,
    };
  }

  return {
    canAttemptConnection: true,
    canUseConnectedSession: false,
    detail: "该 SSH 目标还没有 ready managed session，需要通过 SshAuthBroker 建立或恢复认证。",
    kind: "auth-required",
    label: "Auth required",
    legacyFallback: relevantFallback,
    session,
    targetLabel,
  };
}

function findManagedSessionForMachine(
  managedSsh: ManagedSshRuntimeSnapshot | null | undefined,
  machine: Machine,
): ManagedSshSessionSnapshot | undefined {
  const sessions =
    managedSsh?.sessions.filter((session) =>
      targetMatchesMachine(session.key.target, machine),
    ) ?? [];
  return (
    sessions.find((session) => session.state === "ready") ?? sessions[0]
  );
}

function findRecentFallbackForMachine(
  managedSsh: ManagedSshRuntimeSnapshot | null | undefined,
  machine: Machine,
  requiredCapability?: ManagedSshToolCapability,
): ManagedSshLegacyFallbackSnapshot | undefined {
  return managedSsh?.recentLegacyFallbacks.find((fallback) => {
    if (!fallbackMatchesCapability(fallback, requiredCapability)) {
      return false;
    }
    if (!fallback.target) {
      return true;
    }
    return targetMatchesMachine(fallback.target, machine);
  });
}

function fallbackMatchesCapability(
  fallback: ManagedSshLegacyFallbackSnapshot,
  requiredCapability?: ManagedSshToolCapability,
): boolean {
  if (!requiredCapability) {
    return true;
  }
  const capability = fallback.capability.toLowerCase();
  return capabilityAliases[requiredCapability].some((alias) =>
    capability.includes(alias),
  );
}

function focusedPaneMatchesSshMachine(
  focusedPane: TerminalPane | undefined,
  machine: Machine,
): boolean {
  return Boolean(
    focusedPane?.mode === "ssh" &&
      (focusedPane.remoteHostId === machine.id ||
        focusedPane.machineId === machine.id),
  );
}

function isUnsupportedFallback(
  fallback: ManagedSshLegacyFallbackSnapshot,
): boolean {
  const reason = fallback.reason.toLowerCase();
  return reason.includes("unsupported") || reason.includes("unwired");
}

function targetMatchesMachine(target: string, machine: Machine): boolean {
  const normalizedTarget = target.toLowerCase();
  return machineTargetCandidates(machine).some((candidate) =>
    normalizedTarget.includes(candidate.toLowerCase()),
  );
}

function classifyAvailabilityFailure(
  ...values: Array<string | null | undefined>
): SshTerminalFailure | undefined {
  for (const value of values) {
    if (!value) {
      continue;
    }
    const failure = classifySshTerminalFailure(value);
    if (failure) {
      return failure;
    }
  }
  return undefined;
}

function isHostKeyFailureClass(failureClass: SshTerminalFailure["class"]) {
  return failureClass === "unknownHostKey" || failureClass === "hostKeyChanged";
}

function isCredentialFailureClass(failureClass: SshTerminalFailure["class"]) {
  return (
    failureClass === "authCanceled" ||
    failureClass === "badCredential" ||
    failureClass === "keyPassphraseMissing"
  );
}

function sshMachineTargetLabel(machine: Machine): string {
  const host = machine.host ?? machine.name ?? machine.id;
  const port = machine.port ?? 22;
  const username = machine.username ?? "ssh";
  return `${username}@${host}:${port}`;
}

function machineTargetCandidates(machine: Machine): string[] {
  const candidates = new Set<string>([machine.id]);
  if (machine.host) {
    candidates.add(machine.host);
    candidates.add(`${machine.host}:${machine.port ?? 22}`);
  }
  if (machine.host && machine.username) {
    candidates.add(`${machine.username}@${machine.host}`);
    candidates.add(sshMachineTargetLabel(machine));
  }
  return Array.from(candidates).filter(Boolean);
}
