import {
  collectPaneIds,
  findFirstPaneId,
} from "./workspaceLayout";
import type {
  Machine,
  MachineStatus,
  TerminalLayoutNode,
  TerminalPane,
  TerminalTab,
  TerminalTabGroupPreferences,
} from "./types";
import {
  isTerminalTabGroupColor,
  isSftpTransferWorkspaceTab,
  isTerminalSessionTab,
} from "./types";
import {
  dockerContainerTarget,
  localTarget,
  normalizeRemoteTargetRef,
  serialTarget,
  sshTarget,
  telnetTarget,
} from "../../lib/targetModel";

export const WORKSPACE_SESSION_VERSION = 1;
export const TERMINAL_OUTPUT_HISTORY_MAX_CHARS = 128 * 1024;

export interface WorkspaceSessionSnapshot {
  activeTabId: string;
  focusedPaneId: string;
  selectedMachineId: string;
  removedSidebarMachineIds?: string[];
  sidebarMachines: Machine[];
  terminalTabGroupPreferences?: TerminalTabGroupPreferences;
  terminalPanes: TerminalPane[];
  terminalTabs: TerminalTab[];
}

export function normalizeWorkspaceSessionSnapshot(
  value: unknown,
): WorkspaceSessionSnapshot {
  const source = sessionSource(value);
  const rawPanes = Array.isArray(source?.terminalPanes)
    ? source.terminalPanes
    : [];
  const terminalPanes = rawPanes
    .map(normalizeTerminalPane)
    .filter((pane): pane is TerminalPane => Boolean(pane));
  const paneIds = new Set(terminalPanes.map((pane) => pane.id));
  const rawTabs = Array.isArray(source?.terminalTabs) ? source.terminalTabs : [];
  const terminalTabs = rawTabs
    .map((tab) => normalizeTerminalTab(tab, paneIds))
    .filter((tab): tab is TerminalTab => Boolean(tab));
  const rawSidebarMachines = Array.isArray(source?.sidebarMachines)
    ? source.sidebarMachines
    : [];
  const sidebarMachines = rawSidebarMachines
    .map(normalizeSidebarMachine)
    .filter((machine): machine is Machine => Boolean(machine));
  const removedSidebarMachineIds = uniqueStrings(
    normalizeStringArray(source?.removedSidebarMachineIds) ?? [],
  );
  const terminalTabGroupPreferences = normalizeTerminalTabGroupPreferences(
    source?.terminalTabGroupPreferences,
  );
  const referencedPaneIds = new Set(
    terminalTabs.flatMap((tab) =>
      isTerminalSessionTab(tab) ? collectPaneIds(tab.layout) : [],
    ),
  );
  const referencedPanes = terminalPanes.filter((pane) =>
    referencedPaneIds.has(pane.id),
  );
  const selection = resolveWorkspaceSessionSelection({
    activeTabId: readString(source?.activeTabId),
    focusedPaneId: readString(source?.focusedPaneId),
    referencedPanes,
    selectedMachineId: readString(source?.selectedMachineId),
    terminalTabs,
  });

  return {
    activeTabId: selection.activeTabId,
    focusedPaneId: selection.focusedPaneId,
    selectedMachineId: selection.selectedMachineId,
    removedSidebarMachineIds,
    sidebarMachines,
    terminalTabGroupPreferences,
    terminalPanes: selection.activeTabId ? referencedPanes : [],
    terminalTabs,
  };
}

export function maxGeneratedTerminalCounters(session: WorkspaceSessionSnapshot) {
  const paneCount = Math.max(
    0,
    ...session.terminalPanes.map((pane) => numericSuffix(pane.id)),
  );
  const splitCount = Math.max(
    0,
    ...session.terminalTabs.flatMap((tab) =>
      isTerminalSessionTab(tab) ? collectSplitSuffixes(tab.layout) : [],
    ),
  );
  const tabCount = Math.max(
    0,
    ...session.terminalTabs.map((tab) => numericSuffix(tab.id)),
  );

  return { paneCount, splitCount, tabCount };
}

export function appendTerminalOutputHistory(
  currentHistory: string | undefined,
  data: string,
) {
  if (!data) {
    return currentHistory;
  }
  return trimTerminalOutputHistory(`${currentHistory ?? ""}${data}`);
}

function sessionSource(value: unknown): Partial<WorkspaceSessionSnapshot> | null {
  if (!isRecord(value)) {
    return null;
  }
  if (isRecord(value.session)) {
    return value.session as Partial<WorkspaceSessionSnapshot>;
  }
  return value as Partial<WorkspaceSessionSnapshot>;
}

function normalizeTerminalPane(value: unknown): TerminalPane | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = readString(value.id);
  const title = readString(value.title);
  const machineId = readString(value.machineId);
  const mode = normalizePaneMode(value.mode);
  const remoteHostId = readOptionalString(value.remoteHostId);
  const profileId = readOptionalString(value.profileId);
  const prompt = readString(value.prompt) || "PS>";
  const status = normalizeMachineStatus(value.status);

  if (!id || !title || !machineId || !mode) {
    return undefined;
  }

  return {
    args: normalizeStringArray(value.args),
    containerId: readOptionalString(value.containerId),
    currentCwd: readOptionalString(value.currentCwd),
    cwd: readOptionalString(value.cwd),
    env: normalizeStringRecord(value.env),
    id,
    latencyMs: readOptionalNumber(value.latencyMs),
    lines: [],
    machineId,
    mode,
    outputHistory: normalizeTerminalOutputHistory(value.outputHistory),
    profileId,
    prompt,
    remoteHostId,
    remoteHostProduction: readOptionalBoolean(value.remoteHostProduction),
    shell: readOptionalString(value.shell),
    status,
    target:
      normalizeRemoteTargetRef(value.target) ??
      legacyTargetFromPane(
        mode,
        machineId,
        remoteHostId,
        profileId,
        readOptionalString(value.containerId),
      ),
    title,
  };
}

function normalizeSidebarMachine(value: unknown): Machine | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const kind = value.kind;
  if (kind !== "local" && kind !== "dockerContainer") {
    return undefined;
  }

  const id = readString(value.id);
  const name = readString(value.name);
  if (!id || !name) {
    return undefined;
  }

  const status = normalizeMachineStatus(value.status);
  const base = {
    args: normalizeStringArray(value.args),
    createdAt: readOptionalString(value.createdAt),
    cwd: readOptionalString(value.cwd),
    description: readString(value.description) || (kind === "local" ? "本地会话" : name),
    env: normalizeStringRecord(value.env),
    id,
    name,
    profileId: readOptionalString(value.profileId),
    remoteGroupId: readOptionalString(value.remoteGroupId),
    shell: readOptionalString(value.shell),
    sortOrder: readOptionalNumber(value.sortOrder),
    status,
    tags: normalizeStringArray(value.tags) ?? [],
    updatedAt: readOptionalString(value.updatedAt),
  };

  if (kind === "local") {
    return {
      ...base,
      kind,
      target: localTarget(base.profileId),
    };
  }

  const normalizedTarget = normalizeRemoteTargetRef(value.target);
  const parentMachineId =
    readOptionalString(value.parentMachineId) ??
    (normalizedTarget?.kind === "dockerContainer" ? normalizedTarget.hostId : undefined);
  const containerId =
    readOptionalString(value.containerId) ??
    (normalizedTarget?.kind === "dockerContainer" ? normalizedTarget.containerId : undefined);
  if (!parentMachineId || !containerId) {
    return undefined;
  }
  const runtime =
    value.runtime === "podman" || value.runtime === "docker"
      ? value.runtime
      : normalizedTarget?.kind === "dockerContainer"
        ? normalizedTarget.runtime
        : "docker";
  const containerName =
    readOptionalString(value.containerName) ??
    (normalizedTarget?.kind === "dockerContainer" ? normalizedTarget.containerName : undefined);
  const user =
    readOptionalString(value.user) ??
    (normalizedTarget?.kind === "dockerContainer" ? normalizedTarget.user : undefined);
  const workdir =
    readOptionalString(value.workdir) ??
    (normalizedTarget?.kind === "dockerContainer" ? normalizedTarget.workdir : undefined);

  return {
    ...base,
    containerId,
    containerName,
    host: readOptionalString(value.host),
    kind,
    parentMachineId,
    production: readOptionalBoolean(value.production),
    remoteGroupId: readOptionalString(value.remoteGroupId),
    runtime,
    target: dockerContainerTarget({
      containerId,
      containerName,
      hostId: parentMachineId,
      runtime,
      user,
      workdir,
    }),
    user,
    username: readOptionalString(value.username),
    workdir,
  };
}

function normalizeTerminalTab(
  value: unknown,
  paneIds: Set<string>,
): TerminalTab | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = readString(value.id);
  const title = readString(value.title);
  const machineId = readString(value.machineId);

  if (value.kind === "sftpTransfer") {
    if (!id || !title) {
      return undefined;
    }
    return {
      id,
      kind: "sftpTransfer",
      leftHostId: readOptionalString(value.leftHostId),
      lockedLeftHostId: readOptionalString(value.lockedLeftHostId),
      machineId: machineId || "sftp-transfer",
      rightHostId: readOptionalString(value.rightHostId),
      title,
    };
  }

  const layout = normalizeLayoutNode(value.layout, paneIds);

  if (!id || !title || !machineId || !layout) {
    return undefined;
  }

  return value.kind === "terminal"
    ? { id, kind: "terminal", layout, machineId, title }
    : { id, layout, machineId, title };
}

function normalizeTerminalTabGroupPreferences(
  value: unknown,
): TerminalTabGroupPreferences | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const preferences: TerminalTabGroupPreferences = {};
  for (const [groupId, rawPreference] of Object.entries(value)) {
    if (!groupId || !isRecord(rawPreference)) {
      continue;
    }

    const title = readOptionalString(rawPreference.title)?.trim();
    const color = isTerminalTabGroupColor(rawPreference.color)
      ? rawPreference.color
      : undefined;
    if (!title && !color) {
      continue;
    }

    preferences[groupId] = {
      ...(color ? { color } : {}),
      ...(title ? { title } : {}),
    };
  }

  return Object.keys(preferences).length > 0 ? preferences : undefined;
}

function normalizeLayoutNode(
  value: unknown,
  paneIds: Set<string>,
): TerminalLayoutNode | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.type === "pane") {
    const paneId = readString(value.paneId);
    return paneId && paneIds.has(paneId) ? { type: "pane", paneId } : undefined;
  }

  if (value.type !== "split") {
    return undefined;
  }

  const id = readString(value.id);
  const direction =
    value.direction === "horizontal" || value.direction === "vertical"
      ? value.direction
      : undefined;
  const children = Array.isArray(value.children)
    ? value.children
        .map((child) => normalizeLayoutNode(child, paneIds))
        .filter((child): child is TerminalLayoutNode => Boolean(child))
    : [];

  if (!id || !direction || children.length === 0) {
    return undefined;
  }

  if (children.length === 1) {
    return children[0];
  }

  return { children, direction, id, type: "split" };
}

function collectSplitSuffixes(layout: TerminalLayoutNode): number[] {
  if (layout.type === "pane") {
    return [];
  }

  return [
    numericSuffix(layout.id),
    ...layout.children.flatMap(collectSplitSuffixes),
  ];
}

interface WorkspaceSessionSelectionInput {
  activeTabId: string;
  focusedPaneId: string;
  referencedPanes: TerminalPane[];
  selectedMachineId: string;
  terminalTabs: TerminalTab[];
}

function resolveWorkspaceSessionSelection({
  activeTabId,
  focusedPaneId,
  referencedPanes,
  selectedMachineId,
  terminalTabs,
}: WorkspaceSessionSelectionInput) {
  const activeTab =
    terminalTabs.find((tab) => tab.id === activeTabId) ?? terminalTabs[0];
  if (!activeTab) {
    return {
      activeTabId: "",
      focusedPaneId: "",
      selectedMachineId,
    };
  }

  const activePaneIds = isTerminalSessionTab(activeTab)
    ? collectPaneIds(activeTab.layout)
    : [];
  const focusedPane = referencedPanes.find(
    (pane) => pane.id === focusedPaneId && activePaneIds.includes(pane.id),
  );
  const fallbackFocusedPane =
    isTerminalSessionTab(activeTab)
      ? paneById(
          referencedPanes,
          focusedPane?.id ?? findFirstPaneId(activeTab.layout),
        )
      : undefined;
  const resolvedFocusedPane = focusedPane ?? fallbackFocusedPane;

  return {
    activeTabId: activeTab.id,
    focusedPaneId: resolvedFocusedPane?.id ?? "",
    selectedMachineId:
      selectedMachineId ||
      selectedMachineIdFromPane(resolvedFocusedPane) ||
      selectedMachineIdFromTab(activeTab),
  };
}

function paneById(panes: TerminalPane[], paneId: string | undefined) {
  return panes.find((pane) => pane.id === paneId);
}

function selectedMachineIdFromPane(pane: TerminalPane | undefined) {
  return pane?.remoteHostId || pane?.machineId || "";
}

function selectedMachineIdFromTab(tab: TerminalTab | undefined) {
  if (!tab) {
    return "";
  }
  if (isSftpTransferWorkspaceTab(tab)) {
    return (
      tab.rightHostId ||
      tab.lockedLeftHostId ||
      tab.leftHostId ||
      (tab.machineId !== "sftp-transfer" ? tab.machineId : "")
    );
  }
  return tab.machineId;
}

function numericSuffix(value: string) {
  const match = /-(\d+)$/.exec(value);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function normalizePaneMode(value: unknown): TerminalPane["mode"] | undefined {
  return value === "local" ||
    value === "ssh" ||
    value === "telnet" ||
    value === "serial" ||
    value === "container" ||
    value === "preview"
    ? value
    : undefined;
}

function legacyTargetFromPane(
  mode: TerminalPane["mode"],
  machineId: string,
  remoteHostId: string | undefined,
  profileId: string | undefined,
  containerId: string | undefined,
) {
  if (mode === "local") {
    return localTarget(profileId);
  }
  if (mode === "ssh") {
    return sshTarget(remoteHostId ?? machineId);
  }
  if (mode === "telnet") {
    return telnetTarget(remoteHostId ?? machineId);
  }
  if (mode === "serial") {
    return serialTarget(remoteHostId ?? machineId);
  }
  if (mode === "container" && remoteHostId && containerId) {
    return dockerContainerTarget({ containerId, hostId: remoteHostId });
  }
  return undefined;
}

function normalizeMachineStatus(value: unknown): MachineStatus {
  return value === "online" || value === "offline" || value === "warning"
    ? value
    : "offline";
}

function normalizeTerminalOutputHistory(value: unknown) {
  return typeof value === "string" && value.length > 0
    ? trimTerminalOutputHistory(value)
    : undefined;
}

function trimTerminalOutputHistory(value: string) {
  if (value.length <= TERMINAL_OUTPUT_HISTORY_MAX_CHARS) {
    return value;
  }

  const trimmed = value.slice(-TERMINAL_OUTPUT_HISTORY_MAX_CHARS);
  const firstCodeUnit = trimmed.charCodeAt(0);
  const startsWithLowSurrogate =
    firstCodeUnit >= 0xdc00 && firstCodeUnit <= 0xdfff;
  return startsWithLowSurrogate ? trimmed.slice(1) : trimmed;
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeStringRecord(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readOptionalString(value: unknown) {
  const text = readString(value);
  return text || undefined;
}

function readOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readOptionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
