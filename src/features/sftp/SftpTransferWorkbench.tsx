import {
  ArrowLeftRight,
  HardDrive,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
} from "react";
import { Button } from "../../components/ui/button";
import { UserFacingNotice } from "../../components/ui/user-facing-notice";
import { cn } from "../../lib/cn";
import { defaultDesktopNotificationSettings } from "../settings/defaults/index";
import type {
  DesktopNotificationSettings,
  InterfaceDensity,
} from "../settings/contracts/index";
import type { Machine, MachineGroup } from "../workspace/contracts/index";
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
  canClearFinishedTransfers,
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
import { useSftpTransferNotifications } from "./useSftpTransferNotifications";
import {
  buildSftpTransferQueueError,
  useSftpTransferQueueSync,
} from "./useSftpTransferQueueSync";

function hostIdentity(machine: Machine) {
  if (machine.kind !== "ssh") {
    return machine.description;
  }
  const username = machine.username ?? "ssh";
  const host = machine.host ?? machine.name;
  return `${username}@${host}:${machine.port ?? 22}`;
}

function hostSearchText(machine: Machine) {
  return [
    machine.name,
    machine.description,
    machine.kind === "ssh" ? machine.host : "",
    machine.kind === "ssh" ? machine.username : "",
    hostIdentity(machine),
    ...machine.tags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export interface SftpTransferWorkbenchProps {
  active?: boolean;
  createdHostTarget?: SftpTransferCreatedHostTarget;
  desktopNotifications?: DesktopNotificationSettings;
  groups: MachineGroup[];
  initialRightHostId?: string;
  interfaceDensity?: InterfaceDensity;
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
  desktopNotifications = defaultDesktopNotificationSettings,
  groups,
  initialRightHostId,
  interfaceDensity = "comfortable",
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
  const hostLabelById = useMemo(
    () => new Map(sshMachines.map((machine) => [machine.id, machine.name])),
    [sshMachines],
  );
  const defaultRightHostId = firstValidHostId(
    sshMachineIds,
    initialRightHostId,
    lockedLeftHostId,
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

  useSftpTransferNotifications({
    active,
    desktopNotifications,
    hostLabelById,
    notificationKeyPrefix: transferViewScope,
    transfers,
  });

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

  const { cancelTransfer, clearFinishedTransfers, retryTransfer } =
    useSftpManagedTransferQueue({
      onCancelSuccess: clearQueueError,
      onClearSuccess: clearQueueError,
      onError: (error) => setQueueError(buildSftpTransferQueueError(error)),
      onRetrySuccess: clearQueueError,
      onRetryUnavailable: (message) =>
        setQueueError(buildSftpTransferQueueError(message)),
      refreshTransfers,
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
  const canClearTransfers = canClearFinishedTransfers(transfers);
  const compactDensity = interfaceDensity === "compact";
  const spaciousDensity = interfaceDensity === "spacious";
  const headerPaddingClass = compactDensity
    ? "px-3 py-2"
    : spaciousDensity
      ? "px-5 py-4"
      : "px-4 py-3";
  const bodyGridClass = compactDensity
    ? "grid min-h-0 flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]"
    : spaciousDensity
      ? "grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]"
      : "grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]";
  const headerIconClass = compactDensity
    ? "h-8 w-8 rounded-[var(--radius-control)]"
    : spaciousDensity
      ? "h-10 w-10 rounded-[var(--radius-control)]"
      : "h-9 w-9 rounded-[var(--radius-control)]";
  const headerActionClass = compactDensity
    ? "h-8 w-8 rounded-[var(--radius-control)]"
    : spaciousDensity
      ? "h-10 w-10 rounded-[var(--radius-control)]"
      : "h-9 w-9 rounded-[var(--radius-control)]";

  return (
    <section
      aria-label="SFTP 传输工作台"
      className="kerminal-solid-surface flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-card)] border"
    >
      <header
        className={cn(
          "flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)]",
          headerPaddingClass,
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "flex shrink-0 items-center justify-center bg-sky-500/10 text-sky-600 dark:bg-sky-400/14 dark:text-sky-200",
              headerIconClass,
            )}
          >
            <ArrowLeftRight className="h-4 w-4" />
          </span>
          <h2 className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            SFTP 传输
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            aria-label="刷新传输队列"
            className={headerActionClass}
            onClick={refreshTransfers}
            size="icon"
            title="刷新传输队列"
            type="button"
            variant="ghost"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            aria-label="清理完成的传输"
            className={headerActionClass}
            disabled={!canClearTransfers}
            onClick={() => void clearFinishedTransfers()}
            size="icon"
            title="清理完成的传输"
            type="button"
            variant="ghost"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className={bodyGridClass}>
        <LeftPane
          active={active}
          activeTab={leftActiveTab}
          activeTabId={activeLeftTabId}
          clipboard={clipboard}
          hostTabs={leftTabs}
          interfaceDensity={interfaceDensity}
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
          interfaceDensity={interfaceDensity}
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

      {queueError ? (
        <div className="shrink-0 border-t border-[var(--border-subtle)] p-3">
          <UserFacingNotice compact message={queueError} />
        </div>
      ) : null}
      <SftpTransferQueuePanel
        error={null}
        onCancel={(transferId) => void cancelTransfer(transferId)}
        onRetry={(transfer) => void retryTransfer(transfer)}
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
  interfaceDensity,
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
  interfaceDensity: InterfaceDensity;
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
  const compactDensity = interfaceDensity === "compact";
  const spaciousDensity = interfaceDensity === "spacious";
  const targetBarPaddingClass = compactDensity
    ? "px-2.5 py-1.5"
    : spaciousDensity
      ? "px-3 py-2"
      : "px-3 py-2";
  const localTabButtonClass = compactDensity
    ? "h-7 rounded-[var(--radius-control)] px-2"
    : spaciousDensity
      ? "h-9 rounded-[var(--radius-control)] px-2.5"
      : "h-8 rounded-[var(--radius-control)] px-2";

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <div
        aria-label="左侧目标"
        className={cn(
          "kerminal-muted-surface flex shrink-0 items-center gap-2 rounded-[var(--radius-control)] border",
          targetBarPaddingClass,
        )}
      >
        <div className="scrollbar-none flex min-w-0 flex-1 gap-1 overflow-x-auto">
          <button
            aria-pressed={localActive}
            className={cn(
              "kerminal-focus-ring kerminal-pressable flex max-w-[180px] items-center gap-1.5 text-xs transition",
              localTabButtonClass,
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
              interfaceDensity={interfaceDensity}
              key={tab.id}
              machine={machinesById.get(tab.hostId)}
              onActivate={() => onActiveTabChange(tab.id)}
              onClose={() => onCloseTab(tab.id)}
              tab={tab}
            />
          ))}
        </div>
        <SearchableSftpHostSelect
          ariaLabel="添加左侧服务器"
          createDescription="创建后加入左侧"
          disabled={!onCreateSshHost && machines.length === 0}
          interfaceDensity={interfaceDensity}
          machines={machines}
          onAddHost={onAddHost}
          onCreateSshHost={onCreateSshHost}
          side="left"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {localActive ? (
          <LocalTransferPane
            active={active}
            interfaceDensity={interfaceDensity}
            onCurrentPathChange={onCurrentPathChange}
            onLocalClipboardChange={onLocalClipboardChange}
            onTransferQueued={onTransferQueued}
            targetMachine={targetMachine}
            targetPath={targetPath}
            transferViewScope={transferViewScope}
          />
        ) : (
          <div className="kerminal-muted-surface flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-card)] border">
            <RemoteHostPaneBody
              active={active}
              activeTab={activeTab}
              availableMachineCount={machines.length}
              clipboard={clipboard}
              emptyLabel="选择左侧服务器。"
              interfaceDensity={interfaceDensity}
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
  interfaceDensity,
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
  interfaceDensity: InterfaceDensity;
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
  const availableMachines = machines;
  const compactDensity = interfaceDensity === "compact";
  const spaciousDensity = interfaceDensity === "spacious";
  const targetBarPaddingClass = compactDensity
    ? "px-2.5 py-1.5"
    : spaciousDensity
      ? "px-3 py-2"
      : "px-3 py-2";

  return (
    <div className="kerminal-muted-surface flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-card)] border">
      <div
        aria-label={title}
        className={cn(
          "flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)]",
          targetBarPaddingClass,
        )}
      >
        <div className="scrollbar-none flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {hostTabs.map((tab) => (
            <HostTabButton
              active={tab.id === activeTabId}
              interfaceDensity={interfaceDensity}
              key={tab.id}
              machine={machinesById.get(tab.hostId)}
              onActivate={() => onActiveTabChange(tab.id)}
              onClose={() => onCloseTab(tab.id)}
              tab={tab}
            />
          ))}
        </div>
        <SearchableSftpHostSelect
          ariaLabel={`添加${title}`}
          createDescription={`创建后加入${side === "right" ? "右侧" : "左侧"}`}
          disabled={!onCreateSshHost && availableMachines.length === 0}
          interfaceDensity={interfaceDensity}
          machines={availableMachines}
          onAddHost={onAddHost}
          onCreateSshHost={onCreateSshHost}
          side={side}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <RemoteHostPaneBody
          active={active}
          activeTab={activeTab}
          availableMachineCount={availableMachines.length}
          clipboard={clipboard}
          emptyLabel={side === "right" ? "选择右侧服务器。" : "未选择主机。"}
          interfaceDensity={interfaceDensity}
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

function SearchableSftpHostSelect({
  ariaLabel,
  createDescription,
  disabled,
  interfaceDensity,
  machines,
  onAddHost,
  onCreateSshHost,
  side,
}: {
  ariaLabel: string;
  createDescription: string;
  disabled: boolean;
  interfaceDensity: InterfaceDensity;
  machines: Machine[];
  onAddHost: (hostId: string) => void;
  onCreateSshHost?: (request: SftpTransferCreateHostRequest) => void;
  side: SftpTransferHostSide;
}) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const compactDensity = interfaceDensity === "compact";
  const spaciousDensity = interfaceDensity === "spacious";
  const normalizedSearch = search.trim().toLowerCase();
  const filteredMachines = useMemo(
    () =>
      normalizedSearch
        ? machines.filter((machine) =>
            hostSearchText(machine).includes(normalizedSearch),
          )
        : machines,
    [machines, normalizedSearch],
  );
  const inputClass = compactDensity
    ? "h-7 rounded-[var(--radius-control)] pl-7 pr-3 text-xs"
    : spaciousDensity
      ? "h-9 rounded-[var(--radius-control)] pl-8 pr-3 text-xs"
      : "h-8 rounded-[var(--radius-control)] pl-7 pr-3 text-xs";

  const closeDropdown = () => {
    setOpen(false);
    setSearch("");
  };
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }
    closeDropdown();
  };
  const selectHost = (hostId: string) => {
    onAddHost(hostId);
    closeDropdown();
  };
  const createSshHost = () => {
    onCreateSshHost?.({ side });
    closeDropdown();
  };

  return (
    <div
      className="relative w-[168px] max-w-[42vw] shrink-0"
      onBlur={handleBlur}
    >
      <label className="relative block min-w-0">
        <span className="sr-only">{ariaLabel}</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500"
          strokeWidth={1.8}
        />
        <input
          aria-controls={open ? listboxId : undefined}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          className={cn(
            "kerminal-field-surface kerminal-focus-ring w-full border text-zinc-700 outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-200 dark:placeholder:text-zinc-600",
            inputClass,
          )}
          disabled={disabled}
          onChange={(event) => {
            setOpen(true);
            setSearch(event.currentTarget.value);
          }}
          onClick={() => {
            setOpen(true);
            setSearch("");
          }}
          onFocus={() => {
            setOpen(true);
            setSearch("");
          }}
          placeholder="搜索主机..."
          role="combobox"
          value={search}
        />
      </label>
      {open ? (
        <div
          className="kerminal-floating-surface kerminal-floating-enter kerminal-layer-popover absolute right-0 top-[calc(100%+0.375rem)] w-56 overflow-hidden rounded-[var(--radius-card)] border p-1 text-sm text-zinc-950 dark:text-zinc-100"
          id={listboxId}
          role="listbox"
        >
          <div className="scrollbar-none grid max-h-64 gap-1 overflow-y-auto">
            {filteredMachines.length > 0 ? (
              filteredMachines.map((machine) => (
                <button
                  aria-selected={false}
                  className="kerminal-focus-ring kerminal-pressable grid min-w-0 gap-0.5 rounded-[var(--radius-control)] px-2.5 py-2 text-left text-zinc-700 transition hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50"
                  key={machine.id}
                  onClick={() => selectHost(machine.id)}
                  role="option"
                  type="button"
                >
                  <span className="truncate text-sm font-medium">
                    {machine.name}
                  </span>
                  <span
                    aria-hidden="true"
                    className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400"
                  >
                    {hostIdentity(machine)}
                  </span>
                </button>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-[var(--border-subtle)] px-3 py-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
                没有匹配的主机。
              </div>
            )}
          </div>
          {onCreateSshHost ? (
            <button
              aria-selected={false}
              className="kerminal-focus-ring kerminal-pressable mt-1 flex w-full items-start gap-2 rounded-[var(--radius-control)] border-t border-[var(--border-subtle)] px-2.5 py-2 text-left text-zinc-700 transition hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50"
              onClick={createSshHost}
              role="option"
              type="button"
            >
              <Plus
                aria-hidden="true"
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500"
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  新建 SSH 主机...
                </span>
                <span
                  aria-hidden="true"
                  className="mt-0.5 block text-xs leading-4 text-zinc-500 dark:text-zinc-400"
                >
                  {createDescription}
                </span>
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RemoteHostPaneBody({
  active,
  activeTab,
  availableMachineCount,
  clipboard,
  emptyLabel,
  interfaceDensity,
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
  interfaceDensity: InterfaceDensity;
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
      interfaceDensity={interfaceDensity}
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
