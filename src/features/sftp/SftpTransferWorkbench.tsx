import {
  ArrowLeftRight,
  HardDrive,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Select, type SelectOption } from "../../components/ui/select";
import { cn } from "../../lib/cn";
import type { Machine, MachineGroup } from "../workspace/types";
import { LocalTransferPane } from "./LocalTransferPane";
import { SftpToolContent, type SftpClipboard } from "./SftpToolContent";
import { SftpTransferQueuePanel } from "./SftpTransferQueuePanel";
import { HostTabButton } from "./SftpTransferWorkbench.parts";
import type { SftpTransferTarget } from "./sftp-tool-content/types";
import { sftpWorkbenchTransferViewScope } from "./sftp-tool-content/sftpTransferScopeModel";
import {
  remoteClipboardFromWorkbenchClipboard,
  wrapRemoteWorkbenchClipboard,
  type SftpWorkbenchClipboard,
  type SftpWorkbenchLocalClipboard,
} from "./sftpTransferClipboardModel";
import {
  activeTransferCount,
  canClearFinishedTransfers,
  isFinishedTransfer,
} from "./sftpTransferModel";
import {
  collectSshMachines,
  createHostTab,
  firstValidHostId,
  pruneHostTabPaths,
  reconcileHostTabs,
  resolveActivePaneTabId,
  resolveActiveHostTabId,
  SFTP_TRANSFER_LOCAL_TAB_ID,
  type SftpTransferHostSide,
  type SftpTransferHostTab,
} from "./sftpTransferWorkbenchModel";
import { useSftpManagedTransferQueue } from "./useSftpManagedTransferQueue";
import { useSftpTransferQueueSync } from "./useSftpTransferQueueSync";

const CREATE_SSH_HOST_OPTION_VALUE = "__create_ssh_host__";

export interface SftpTransferWorkbenchProps {
  active?: boolean;
  createdHostTarget?: SftpTransferCreatedHostTarget;
  groups: MachineGroup[];
  initialLeftHostId?: string;
  initialRightHostId?: string;
  lockedLeftHostId?: string;
  onCreateSshHost?: (request: SftpTransferCreateHostRequest) => void;
  workspaceTabId?: string;
}

export interface SftpTransferCreateHostRequest {
  side: SftpTransferHostSide;
  workspaceTabId?: string;
}

export interface SftpTransferCreatedHostTarget {
  hostId: string;
  sequence: number;
  side: SftpTransferHostSide;
  workspaceTabId?: string;
}

export function SftpTransferWorkbench({
  active = true,
  createdHostTarget,
  groups,
  initialLeftHostId,
  initialRightHostId,
  lockedLeftHostId,
  onCreateSshHost,
  workspaceTabId,
}: SftpTransferWorkbenchProps) {
  const sshMachines = useMemo(() => collectSshMachines(groups), [groups]);
  const sshMachineIds = useMemo(
    () => new Set(sshMachines.map((machine) => machine.id)),
    [sshMachines],
  );
  const machinesById = useMemo(
    () => new Map(sshMachines.map((machine) => [machine.id, machine])),
    [sshMachines],
  );
  const defaultRightHostId = firstValidHostId(
    sshMachineIds,
    initialRightHostId,
    lockedLeftHostId,
    initialLeftHostId,
  );
  const [leftTabs, setLeftTabs] = useState<SftpTransferHostTab[]>([]);
  const [activeLeftTabId, setActiveLeftTabId] = useState(
    SFTP_TRANSFER_LOCAL_TAB_ID,
  );
  const [rightTabs, setRightTabs] = useState<SftpTransferHostTab[]>([]);
  const [activeRightTabId, setActiveRightTabId] = useState("");
  const [clipboard, setClipboard] = useState<SftpWorkbenchClipboard | null>(null);
  const [leftLocalPath, setLeftLocalPath] = useState<string | undefined>();
  const [leftCurrentPaths, setLeftCurrentPaths] = useState<Record<string, string>>(
    {},
  );
  const [rightCurrentPaths, setRightCurrentPaths] = useState<Record<string, string>>(
    {},
  );
  const transferScopeFallbackId = useId();
  const transferViewScope = useMemo(
    () =>
      sftpWorkbenchTransferViewScope({
        fallbackId: transferScopeFallbackId,
        workspaceTabId,
      }),
    [transferScopeFallbackId, workspaceTabId],
  );
  const handledCreatedHostSequenceRef = useRef<number | undefined>(undefined);
  const {
    clearQueueError,
    queueError,
    refreshTransfers,
    setQueueError,
    setTransfers,
    transfers,
  } = useSftpTransferQueueSync({ active, viewScope: transferViewScope });

  useEffect(() => {
    setLeftTabs((current) =>
      reconcileHostTabs({
        hostIds: sshMachineIds,
        side: "left",
        tabs: current,
      }),
    );
  }, [sshMachineIds]);

  useEffect(() => {
    setActiveLeftTabId((current) =>
      resolveActivePaneTabId({ currentTabId: current, tabs: leftTabs }),
    );
  }, [leftTabs]);

  useEffect(() => {
    setLeftCurrentPaths((current) => pruneHostTabPaths(current, leftTabs));
  }, [leftTabs]);

  useEffect(() => {
    setRightTabs((current) =>
      reconcileHostTabs({
        fallbackHostId: defaultRightHostId,
        hostIds: sshMachineIds,
        lockedHostId: lockedLeftHostId,
        side: "right",
        tabs: current,
      }),
    );
  }, [defaultRightHostId, lockedLeftHostId, sshMachineIds]);

  useEffect(() => {
    setActiveRightTabId((current) =>
      resolveActiveHostTabId({
        currentTabId: current,
        preferredHostId: defaultRightHostId,
        tabs: rightTabs,
      }),
    );
  }, [defaultRightHostId, rightTabs]);

  useEffect(() => {
    setRightCurrentPaths((current) => pruneHostTabPaths(current, rightTabs));
  }, [rightTabs]);

  const addLeftHostTab = (hostId: string) => {
    const machine = machinesById.get(hostId);
    if (!machine) {
      return;
    }
    const nextTab = createHostTab("left", hostId);
    setLeftTabs((current) => [...current, nextTab]);
    setActiveLeftTabId(nextTab.id);
  };

  const closeLeftHostTab = (tabId: string) => {
    setLeftTabs((current) => current.filter((tab) => tab.id !== tabId));
    setActiveLeftTabId((current) =>
      current === tabId ? SFTP_TRANSFER_LOCAL_TAB_ID : current,
    );
  };

  const addRightHostTab = (hostId: string) => {
    const machine = machinesById.get(hostId);
    if (!machine) {
      return;
    }
    const nextTab = createHostTab("right", hostId);
    setRightTabs((current) => [...current, nextTab]);
    setActiveRightTabId(nextTab.id);
  };

  const closeRightHostTab = (tabId: string) => {
    setRightTabs((current) => current.filter((tab) => tab.id !== tabId));
  };

  useEffect(() => {
    if (
      !createdHostTarget ||
      createdHostTarget.workspaceTabId !== workspaceTabId ||
      handledCreatedHostSequenceRef.current === createdHostTarget.sequence ||
      !machinesById.has(createdHostTarget.hostId)
    ) {
      return;
    }

    handledCreatedHostSequenceRef.current = createdHostTarget.sequence;
    if (createdHostTarget.side === "left") {
      addLeftHostTab(createdHostTarget.hostId);
      return;
    }
    addRightHostTab(createdHostTarget.hostId);
  }, [createdHostTarget, machinesById, workspaceTabId]);

  const { cancelTransfer, clearFinishedTransfers } = useSftpManagedTransferQueue({
    onCancelSuccess: clearQueueError,
    onClearSuccess: clearQueueError,
    onError: (error) =>
      setQueueError(error instanceof Error ? error.message : String(error)),
    setTransfers,
    viewScope: transferViewScope,
  });

  const updateRightPath = useCallback((tabId: string, path: string) => {
    setRightCurrentPaths((current) =>
      current[tabId] === path ? current : { ...current, [tabId]: path },
    );
  }, []);

  const updateLeftPath = useCallback((tabId: string, path: string) => {
    setLeftCurrentPaths((current) =>
      current[tabId] === path ? current : { ...current, [tabId]: path },
    );
  }, []);
  const handleRemoteClipboardChange = useCallback(
    (nextClipboard: SftpClipboard | null) => {
      setClipboard(wrapRemoteWorkbenchClipboard(nextClipboard));
    },
    [],
  );
  const handleLocalClipboardChange = useCallback(
    (nextClipboard: SftpWorkbenchLocalClipboard) => {
      setClipboard(nextClipboard);
    },
    [],
  );
  const requestCreateSshHost = useCallback(
    ({ side }: SftpTransferCreateHostRequest) => {
      onCreateSshHost?.({ side, workspaceTabId });
    },
    [onCreateSshHost, workspaceTabId],
  );

  const isLeftLocalActive = activeLeftTabId === SFTP_TRANSFER_LOCAL_TAB_ID;
  const leftActiveTab = isLeftLocalActive
    ? undefined
    : leftTabs.find((tab) => tab.id === activeLeftTabId);
  const leftMachine = leftActiveTab
    ? machinesById.get(leftActiveTab.hostId)
    : undefined;
  const leftCurrentPath = leftActiveTab
    ? (leftCurrentPaths[leftActiveTab.id] ?? "/")
    : undefined;
  const rightActiveTab = rightTabs.find((tab) => tab.id === activeRightTabId);
  const rightMachine = rightActiveTab
    ? machinesById.get(rightActiveTab.hostId)
    : undefined;
  const rightCurrentPath = rightActiveTab
    ? (rightCurrentPaths[rightActiveTab.id] ?? "/")
    : undefined;
  const leftTransferTarget = useMemo<SftpTransferTarget | undefined>(
    () => {
      if (isLeftLocalActive) {
        return leftLocalPath
          ? { kind: "local", localPath: leftLocalPath, side: "left" }
          : undefined;
      }
      if (!leftMachine || !leftCurrentPath) {
        return undefined;
      }
      return {
        hostId: leftMachine.id,
        hostLabel: leftMachine.name,
        kind: "remote",
        remotePath: leftCurrentPath,
        side: "left",
      };
    },
    [isLeftLocalActive, leftCurrentPath, leftLocalPath, leftMachine],
  );
  const rightTransferTarget = useMemo<SftpTransferTarget | undefined>(
    () =>
      rightMachine && rightCurrentPath
        ? {
            hostId: rightMachine.id,
            hostLabel: rightMachine.name,
            kind: "remote",
            remotePath: rightCurrentPath,
            side: "right",
          }
        : undefined,
    [rightCurrentPath, rightMachine],
  );
  const activeCount = activeTransferCount(transfers);
  const finishedCount = transfers.filter(isFinishedTransfer).length;
  const canClearTransfers = canClearFinishedTransfers(transfers);

  return (
    <section
      aria-label="SFTP 传输工作台"
      className="kerminal-solid-surface flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:bg-sky-400/14 dark:text-sky-200">
            <ArrowLeftRight className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              SFTP 传输
            </h2>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {activeCount} 项进行中 / {finishedCount} 项已结束
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button onClick={refreshTransfers} size="sm" type="button" variant="ghost">
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
          <Button
            disabled={!canClearTransfers}
            onClick={() => void clearFinishedTransfers()}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Trash2 className="h-4 w-4" />
            清理
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
        <LeftPane
          active={active}
          activeTab={leftActiveTab}
          activeTabId={activeLeftTabId}
          clipboard={clipboard}
          hostTabs={leftTabs}
          localActive={isLeftLocalActive}
          machines={sshMachines}
          machinesById={machinesById}
          onActivateLocal={() => setActiveLeftTabId(SFTP_TRANSFER_LOCAL_TAB_ID)}
          onActiveTabChange={setActiveLeftTabId}
          onAddHost={addLeftHostTab}
          onCreateSshHost={onCreateSshHost ? requestCreateSshHost : undefined}
          onClipboardChange={handleRemoteClipboardChange}
          onCloseTab={closeLeftHostTab}
          onCurrentPathChange={setLeftLocalPath}
          onLocalClipboardChange={handleLocalClipboardChange}
          onPathChange={updateLeftPath}
          onTransferQueued={refreshTransfers}
          targetMachine={rightMachine}
          targetPath={rightCurrentPath}
          transferTarget={rightTransferTarget}
          transferViewScope={transferViewScope}
        />
        <HostPane
          active={active}
          activeTab={rightActiveTab}
          activeTabId={activeRightTabId}
          clipboard={clipboard}
          hostTabs={rightTabs}
          machines={sshMachines}
          machinesById={machinesById}
          onActiveTabChange={setActiveRightTabId}
          onAddHost={addRightHostTab}
          onCreateSshHost={onCreateSshHost ? requestCreateSshHost : undefined}
          onClipboardChange={handleRemoteClipboardChange}
          onCloseTab={closeRightHostTab}
          onPathChange={updateRightPath}
          side="right"
          title="右侧服务器"
          transferTarget={leftTransferTarget}
          transferViewScope={transferViewScope}
        />
      </div>

      <SftpTransferQueuePanel
        error={queueError}
        onCancel={(transferId) => void cancelTransfer(transferId)}
        transfers={transfers}
      />
    </section>
  );
}

function LeftPane({
  active,
  activeTab,
  activeTabId,
  clipboard,
  hostTabs,
  localActive,
  machines,
  machinesById,
  onActivateLocal,
  onActiveTabChange,
  onAddHost,
  onCreateSshHost,
  onClipboardChange,
  onLocalClipboardChange,
  onCloseTab,
  onCurrentPathChange,
  onPathChange,
  onTransferQueued,
  targetMachine,
  targetPath,
  transferTarget,
  transferViewScope,
}: {
  active: boolean;
  activeTab: SftpTransferHostTab | undefined;
  activeTabId: string;
  clipboard: SftpWorkbenchClipboard | null;
  hostTabs: SftpTransferHostTab[];
  localActive: boolean;
  machines: Machine[];
  machinesById: Map<string, Machine>;
  onActivateLocal: () => void;
  onActiveTabChange: (tabId: string) => void;
  onAddHost: (hostId: string) => void;
  onCreateSshHost?: (request: SftpTransferCreateHostRequest) => void;
  onClipboardChange: (clipboard: SftpClipboard | null) => void;
  onCloseTab: (tabId: string) => void;
  onCurrentPathChange?: (path: string | undefined) => void;
  onLocalClipboardChange: (clipboard: SftpWorkbenchLocalClipboard) => void;
  onPathChange: (tabId: string, path: string) => void;
  onTransferQueued?: () => void;
  targetMachine: Machine | undefined;
  targetPath: string | undefined;
  transferTarget?: SftpTransferTarget;
  transferViewScope: string;
}) {
  const addHostOptions = useMemo<SelectOption[]>(
    () => [
      { disabled: true, label: "添加主机", value: "" },
      ...machines.map((machine) => ({
        label: machine.name,
        value: machine.id,
      })),
      ...(onCreateSshHost
        ? [
            {
              description: "创建后加入左侧",
              label: "新建 SSH 主机...",
              value: CREATE_SSH_HOST_OPTION_VALUE,
            },
          ]
        : []),
    ],
    [machines, onCreateSshHost],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <div className="kerminal-muted-surface flex shrink-0 items-center justify-between gap-2 rounded-xl border px-3 py-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
            左侧目标
          </div>
          <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            本机或 SSH 服务器
          </div>
        </div>
        <div className="relative shrink-0">
          <span className="sr-only">添加左侧服务器</span>
          <Plus className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <Select
            aria-label="添加左侧服务器"
            align="right"
            buttonClassName="kerminal-field-surface h-8 rounded-lg pl-7 text-xs text-zinc-700 dark:text-zinc-200"
            className="w-[168px] max-w-[42vw]"
            disabled={!onCreateSshHost && machines.length === 0}
            menuClassName="w-56"
            onValueChange={(hostId) => {
              if (hostId === CREATE_SSH_HOST_OPTION_VALUE) {
                onCreateSshHost?.({ side: "left" });
                return;
              }
              if (hostId) {
                onAddHost(hostId);
              }
            }}
            options={addHostOptions}
            size="sm"
            value=""
          />
        </div>
      </div>

      <div className="kerminal-muted-surface scrollbar-none flex shrink-0 gap-1 overflow-x-auto rounded-xl border px-2 py-1.5">
        <button
          aria-pressed={localActive}
          className={cn(
            "kerminal-focus-ring kerminal-pressable flex h-8 max-w-[180px] items-center gap-1.5 rounded-lg px-2 text-xs transition",
            localActive
              ? "bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100"
              : "text-zinc-500 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100",
          )}
          onClick={onActivateLocal}
          title="本机"
          type="button"
        >
          <HardDrive className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">本机</span>
        </button>
        {hostTabs.map((tab) => (
          <HostTabButton
            active={tab.id === activeTabId}
            key={tab.id}
            machine={machinesById.get(tab.hostId)}
            onActivate={() => onActiveTabChange(tab.id)}
            onClose={() => onCloseTab(tab.id)}
            tab={tab}
          />
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {localActive ? (
          <LocalTransferPane
            active={active}
            onCurrentPathChange={onCurrentPathChange}
            onLocalClipboardChange={onLocalClipboardChange}
            onTransferQueued={onTransferQueued}
            targetMachine={targetMachine}
            targetPath={targetPath}
            transferViewScope={transferViewScope}
          />
        ) : (
          <div className="kerminal-muted-surface flex h-full min-h-0 flex-col overflow-hidden rounded-xl border">
            <RemoteHostPaneBody
              active={active}
              activeTab={activeTab}
              availableMachineCount={machines.length}
              clipboard={clipboard}
              emptyLabel="选择左侧服务器。"
              machinesById={machinesById}
              onClipboardChange={onClipboardChange}
              onPathChange={onPathChange}
              transferTarget={transferTarget}
              transferViewScope={transferViewScope}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function HostPane({
  active,
  activeTab,
  activeTabId,
  clipboard,
  hostTabs,
  machines,
  machinesById,
  onActiveTabChange,
  onAddHost,
  onCreateSshHost,
  onClipboardChange,
  onCloseTab,
  onPathChange,
  side,
  title,
  transferTarget,
  transferViewScope,
}: {
  active: boolean;
  activeTab: SftpTransferHostTab | undefined;
  activeTabId: string;
  clipboard: SftpWorkbenchClipboard | null;
  hostTabs: SftpTransferHostTab[];
  machines: Machine[];
  machinesById: Map<string, Machine>;
  onActiveTabChange: (tabId: string) => void;
  onAddHost: (hostId: string) => void;
  onCreateSshHost?: (request: SftpTransferCreateHostRequest) => void;
  onClipboardChange: (clipboard: SftpClipboard | null) => void;
  onCloseTab: (tabId: string) => void;
  onPathChange: (tabId: string, path: string) => void;
  side: SftpTransferHostSide;
  title: string;
  transferTarget?: SftpTransferTarget;
  transferViewScope: string;
}) {
  const selectedMachine = activeTab ? machinesById.get(activeTab.hostId) : undefined;
  const availableMachines = machines;
  const addHostOptions = useMemo<SelectOption[]>(
    () => [
      { disabled: true, label: "添加主机", value: "" },
      ...availableMachines.map((machine) => ({
        label: machine.name,
        value: machine.id,
      })),
      ...(onCreateSshHost
        ? [
            {
              description: "创建后加入右侧",
              label: "新建 SSH 主机...",
              value: CREATE_SSH_HOST_OPTION_VALUE,
            },
          ]
        : []),
    ],
    [availableMachines, onCreateSshHost],
  );

  return (
    <div className="kerminal-muted-surface flex min-h-0 flex-col overflow-hidden rounded-xl border">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
            {title}
          </div>
          <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            {selectedMachine?.description ?? "未选择主机"}
          </div>
        </div>
        <div className="relative shrink-0">
          <span className="sr-only">添加{title}</span>
          <Plus className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <Select
            aria-label={`添加${title}`}
            align="right"
            buttonClassName="kerminal-field-surface h-8 rounded-lg pl-7 text-xs text-zinc-700 dark:text-zinc-200"
            className="w-[168px] max-w-[42vw]"
            disabled={!onCreateSshHost && availableMachines.length === 0}
            menuClassName="w-56"
            onValueChange={(hostId) => {
              if (hostId === CREATE_SSH_HOST_OPTION_VALUE) {
                onCreateSshHost?.({ side });
                return;
              }
              if (hostId) {
                onAddHost(hostId);
              }
            }}
            options={addHostOptions}
            size="sm"
            value=""
          />
        </div>
      </div>

      <div className="scrollbar-none flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--border-subtle)] px-2 py-1.5">
        {hostTabs.map((tab) => (
          <HostTabButton
            active={tab.id === activeTabId}
            key={tab.id}
            machine={machinesById.get(tab.hostId)}
            onActivate={() => onActiveTabChange(tab.id)}
            onClose={() => onCloseTab(tab.id)}
            tab={tab}
          />
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <RemoteHostPaneBody
          active={active}
          activeTab={activeTab}
          availableMachineCount={availableMachines.length}
          clipboard={clipboard}
          emptyLabel={side === "right" ? "选择右侧服务器。" : "未选择主机。"}
          machinesById={machinesById}
          onClipboardChange={onClipboardChange}
          onPathChange={onPathChange}
          transferTarget={transferTarget}
          transferViewScope={transferViewScope}
        />
      </div>
    </div>
  );
}

function RemoteHostPaneBody({
  active,
  activeTab,
  availableMachineCount,
  clipboard,
  emptyLabel,
  machinesById,
  onClipboardChange,
  onPathChange,
  transferTarget,
  transferViewScope,
}: {
  active: boolean;
  activeTab: SftpTransferHostTab | undefined;
  availableMachineCount: number;
  clipboard: SftpWorkbenchClipboard | null;
  emptyLabel: string;
  machinesById: Map<string, Machine>;
  onClipboardChange: (clipboard: SftpClipboard | null) => void;
  onPathChange: (tabId: string, path: string) => void;
  transferTarget?: SftpTransferTarget;
  transferViewScope: string;
}) {
  const selectedMachine = activeTab ? machinesById.get(activeTab.hostId) : undefined;
  const reportCurrentPath = useCallback(
    (path: string) => {
      if (activeTab) {
        onPathChange(activeTab.id, path);
      }
    },
    [activeTab, onPathChange],
  );

  if (!selectedMachine) {
    return (
      <div className="flex h-full items-center justify-center p-5 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {availableMachineCount === 0
          ? "没有可用于 SFTP 的 SSH 服务器。"
          : emptyLabel}
      </div>
    );
  }

  return (
    <SftpToolContent
      active={active}
      compactHeader
      onCurrentPathChange={reportCurrentPath}
      onSftpClipboardChange={onClipboardChange}
      selectedMachine={selectedMachine}
      showLocalTransferActions={!transferTarget}
      showTransferStatusBar={false}
      sftpClipboard={remoteClipboardFromWorkbenchClipboard(clipboard)}
      transferTarget={transferTarget}
      transferViewScope={transferViewScope}
      workbenchClipboard={clipboard}
    />
  );
}
