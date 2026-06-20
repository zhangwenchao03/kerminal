import {
  ArrowLeftRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Select, type SelectOption } from "../../components/ui/select";
import { cn } from "../../lib/cn";
import {
  cancelSftpTransfer,
  clearCompletedSftpTransfers,
  listSftpTransfers,
  type SftpTransferSummary,
} from "../../lib/sftpApi";
import type { Machine, MachineGroup } from "../workspace/types";
import { SftpToolContent, type SftpClipboard } from "./SftpToolContent";
import {
  activeTransferCount,
  formatTransferBytes,
  isFinishedTransfer,
  sortTransfers,
  transferPathSummary,
  transferPercentLabel,
  transferProgressPercent,
  transferStatusClassName,
  transferStatusLabel,
  transferTitle,
  upsertTransfer,
} from "./sftpTransferModel";

const SFTP_TRANSFER_UPDATED_EVENT = "sftp-transfer-updated";

type HostTab = {
  hostId: string;
  id: string;
  locked?: boolean;
};

type HostSide = "left" | "right";

export interface SftpTransferWorkbenchProps {
  active?: boolean;
  groups: MachineGroup[];
  initialLeftHostId?: string;
  initialRightHostId?: string;
  lockedLeftHostId?: string;
}

export function SftpTransferWorkbench({
  active = true,
  groups,
  initialLeftHostId,
  initialRightHostId,
  lockedLeftHostId,
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
  const [rightTabs, setRightTabs] = useState<HostTab[]>([]);
  const [activeRightTabId, setActiveRightTabId] = useState("");
  const [clipboard, setClipboard] = useState<SftpClipboard | null>(null);
  const [transfers, setTransfers] = useState<SftpTransferSummary[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [rightCurrentPaths, setRightCurrentPaths] = useState<Record<string, string>>(
    {},
  );

  useEffect(() => {
    setRightTabs((current) =>
      reconcileHostTabs({
        fallbackHostId: defaultRightHostId,
        hostIds: sshMachineIds,
        side: "right",
        tabs: current,
      }),
    );
  }, [defaultRightHostId, sshMachineIds]);

  useEffect(() => {
    setActiveRightTabId((current) =>
      rightTabs.some((tab) => tab.id === current)
        ? current
        : rightTabs[0]?.id ?? "",
    );
  }, [rightTabs]);

  const refreshTransfers = useCallback(async () => {
    if (!active) {
      return;
    }
    try {
      setTransfers(sortTransfers(await listSftpTransfers()));
      setQueueError(null);
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : String(error));
    }
  }, [active]);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    let disposed = false;
    const loadTransfers = async () => {
      try {
        const nextTransfers = await listSftpTransfers();
        if (!disposed) {
          setTransfers(sortTransfers(nextTransfers));
          setQueueError(null);
        }
      } catch (error) {
        if (!disposed) {
          setQueueError(error instanceof Error ? error.message : String(error));
        }
      }
    };

    void loadTransfers();
    const intervalId = window.setInterval(loadTransfers, 900);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [active]);

  useEffect(() => {
    if (!active || !isTauri()) {
      return undefined;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<SftpTransferSummary>(SFTP_TRANSFER_UPDATED_EVENT, (event) => {
          if (disposed) {
            return;
          }
          setTransfers((current) =>
            sortTransfers(upsertTransfer(current, event.payload)),
          );
        }),
      )
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => {
        // Polling remains the fallback outside the Tauri event channel.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [active]);

  const addRightHostTab = (hostId: string) => {
    const machine = machinesById.get(hostId);
    if (!machine) {
      return;
    }
    const nextTab = hostTab("right", hostId);
    setRightTabs((current) => [...current, nextTab]);
    setActiveRightTabId(nextTab.id);
  };

  const closeRightHostTab = (tabId: string) => {
    setRightTabs((current) => current.filter((tab) => tab.id !== tabId));
  };

  const cancelTransfer = async (transferId: string) => {
    try {
      const summary = await cancelSftpTransfer({ transferId });
      setTransfers((current) => sortTransfers(upsertTransfer(current, summary)));
      setQueueError(null);
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : String(error));
    }
  };

  const clearFinishedTransfers = async () => {
    try {
      const nextTransfers = await clearCompletedSftpTransfers();
      setTransfers(sortTransfers(nextTransfers));
      setQueueError(null);
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : String(error));
    }
  };

  const updateRightPath = useCallback((tabId: string, path: string) => {
    setRightCurrentPaths((current) =>
      current[tabId] === path ? current : { ...current, [tabId]: path },
    );
  }, []);

  const rightActiveTab = rightTabs.find((tab) => tab.id === activeRightTabId);
  const rightMachine = rightActiveTab
    ? machinesById.get(rightActiveTab.hostId)
    : undefined;
  const rightCurrentPath = rightActiveTab
    ? (rightCurrentPaths[rightActiveTab.id] ?? "/")
    : undefined;
  const activeCount = activeTransferCount(transfers);
  const finishedCount = transfers.filter(isFinishedTransfer).length;

  return (
    <section
      aria-label="SFTP 传输工作台"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-black/8 bg-white/70 shadow-sm shadow-black/[0.03] dark:border-white/8 dark:bg-zinc-950/62 dark:shadow-black/20"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-black/8 px-4 py-3 dark:border-white/8">
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
            disabled={finishedCount === 0}
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
        <LocalPane targetMachine={rightMachine} targetPath={rightCurrentPath} />
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
          onClipboardChange={setClipboard}
          onCloseTab={closeRightHostTab}
          onPathChange={updateRightPath}
          side="right"
          title="右侧服务器"
        />
      </div>

      <TransferQueue
        error={queueError}
        onCancel={(transferId) => void cancelTransfer(transferId)}
        transfers={transfers}
      />
    </section>
  );
}

function LocalPane({
  targetMachine,
  targetPath,
}: {
  targetMachine: Machine | undefined;
  targetPath: string | undefined;
}) {
  return (
    <div
      aria-label="本地目录面板"
      className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-black/8 bg-white/78 dark:border-white/8 dark:bg-white/[0.045]"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-black/8 px-3 py-2 dark:border-white/8">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
            左侧本地目录
          </div>
          <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            本机文件系统
          </div>
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/12 dark:text-emerald-300">
          <FolderOpen className="h-4 w-4" />
        </span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-5">
        <div className="w-full max-w-sm rounded-xl border border-dashed border-black/10 bg-black/[0.02] px-4 py-5 text-center dark:border-white/10 dark:bg-white/[0.035]">
          <div className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
            本地目录
          </div>
          <div className="mt-2 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {targetMachine
              ? `目标：${targetMachine.name}:${targetPath ?? "/"}`
              : "右侧未选择服务器"}
          </div>
        </div>
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
  onClipboardChange,
  onCloseTab,
  onPathChange,
  side,
  title,
}: {
  active: boolean;
  activeTab: HostTab | undefined;
  activeTabId: string;
  clipboard: SftpClipboard | null;
  hostTabs: HostTab[];
  machines: Machine[];
  machinesById: Map<string, Machine>;
  onActiveTabChange: (tabId: string) => void;
  onAddHost: (hostId: string) => void;
  onClipboardChange: (clipboard: SftpClipboard | null) => void;
  onCloseTab: (tabId: string) => void;
  onPathChange: (tabId: string, path: string) => void;
  side: HostSide;
  title: string;
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
    ],
    [availableMachines],
  );
  const reportCurrentPath = useCallback(
    (path: string) => {
      if (activeTab) {
        onPathChange(activeTab.id, path);
      }
    },
    [activeTab, onPathChange],
  );

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-black/8 bg-white/78 dark:border-white/8 dark:bg-white/[0.045]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-black/8 px-3 py-2 dark:border-white/8">
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
            buttonClassName="h-8 rounded-lg border-black/10 bg-white/82 pl-7 text-xs text-zinc-700 focus-visible:border-sky-400/60 focus-visible:ring-sky-500/10 dark:border-white/10 dark:bg-zinc-950/70 dark:text-zinc-200"
            className="w-[168px] max-w-[42vw]"
            disabled={availableMachines.length === 0}
            menuClassName="w-56"
            onValueChange={(hostId) => {
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

      <div className="scrollbar-none flex shrink-0 gap-1 overflow-x-auto border-b border-black/8 px-2 py-1.5 dark:border-white/8">
        {hostTabs.map((tab) => {
          const machine = machinesById.get(tab.hostId);
          return (
            <button
              aria-pressed={tab.id === activeTabId}
              className={cn(
                "flex h-8 max-w-[180px] items-center gap-1.5 rounded-lg px-2 text-xs transition",
                tab.id === activeTabId
                  ? "bg-sky-500/12 text-sky-700 dark:bg-sky-400/16 dark:text-sky-100"
                  : "text-zinc-500 hover:bg-black/5 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/8 dark:hover:text-zinc-100",
              )}
              key={tab.id}
              onClick={() => onActiveTabChange(tab.id)}
              title={machine?.name ?? tab.hostId}
              type="button"
            >
              <span className="truncate">{machine?.name ?? tab.hostId}</span>
              {tab.locked ? (
                <span className="rounded bg-black/5 px-1 py-0.5 text-[10px] text-zinc-500 dark:bg-white/10 dark:text-zinc-300">
                  固定
                </span>
              ) : (
                <X
                  className="h-3 w-3 shrink-0"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {selectedMachine ? (
          <SftpToolContent
            active={active}
            compactHeader
            onCurrentPathChange={reportCurrentPath}
            onSftpClipboardChange={onClipboardChange}
            selectedMachine={selectedMachine}
            showLocalTransferActions
            showTransferStatusBar={false}
            sftpClipboard={clipboard}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-5 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {availableMachines.length === 0
              ? "没有可用于 SFTP 的 SSH 服务器。"
              : side === "right"
                ? "选择右侧服务器。"
                : "未选择主机。"}
          </div>
        )}
      </div>
    </div>
  );
}

function TransferQueue({
  error,
  onCancel,
  transfers,
}: {
  error: string | null;
  onCancel: (transferId: string) => void;
  transfers: SftpTransferSummary[];
}) {
  const activeCount = activeTransferCount(transfers);
  const visibleTransfers = transfers.slice(0, 8);

  return (
    <div className="shrink-0 border-t border-black/8 bg-white/78 dark:border-white/8 dark:bg-zinc-950/72">
      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-100">
          <QueueIcon activeCount={activeCount} error={error} transfers={transfers} />
          <span className="truncate">传输队列</span>
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs text-zinc-500 dark:bg-white/8 dark:text-zinc-400">
            {transfers.length}
          </span>
        </div>
        {error ? (
          <div className="truncate text-xs text-rose-600 dark:text-rose-300" role="alert">
            {error}
          </div>
        ) : null}
      </div>

      {visibleTransfers.length > 0 ? (
        <div className="scrollbar-thin max-h-44 overflow-y-auto px-3 pb-3">
          <div className="space-y-2">
            {visibleTransfers.map((transfer) => (
              <TransferQueueRow
                key={transfer.id}
                onCancel={onCancel}
                transfer={transfer}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="px-4 pb-3 text-xs text-zinc-500 dark:text-zinc-400">
          暂无后台传输任务。
        </div>
      )}
    </div>
  );
}

function TransferQueueRow({
  onCancel,
  transfer,
}: {
  onCancel: (transferId: string) => void;
  transfer: SftpTransferSummary;
}) {
  const progress = transferProgressPercent(transfer);
  const canCancel =
    transfer.status === "queued" || transfer.status === "running";

  return (
    <div className="rounded-xl border border-black/8 bg-black/[0.025] px-3 py-2 dark:border-white/8 dark:bg-white/[0.045]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-[11px]",
                transferStatusClassName(transfer.status),
              )}
            >
              {transferStatusLabel(transfer.status)}
            </span>
            <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
              {transferTitle(transfer)}
            </span>
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
            {transferPathSummary(transfer)}
          </div>
          {transfer.error ? (
            <div className="mt-1 truncate text-xs text-rose-600 dark:text-rose-300">
              {transfer.error}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {transferPercentLabel(transfer)}
          </span>
          {canCancel ? (
            <Button
              aria-label="取消传输"
              className="h-7 w-7 rounded-lg"
              onClick={() => onCancel(transfer.id)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/8 dark:bg-white/10">
        <div
          aria-label="传输进度"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(progress)}
          className={cn(
            "h-full rounded-full transition-all",
            transfer.status === "failed"
              ? "bg-rose-500"
              : transfer.status === "canceled"
                ? "bg-zinc-400"
                : "bg-sky-500",
          )}
          role="progressbar"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
        {formatTransferBytes(transfer)}
      </div>
    </div>
  );
}

function QueueIcon({
  activeCount,
  error,
  transfers,
}: {
  activeCount: number;
  error: string | null;
  transfers: SftpTransferSummary[];
}) {
  if (error || transfers.some((transfer) => transfer.status === "failed")) {
    return <CircleAlert className="h-4 w-4 text-rose-500" />;
  }
  if (activeCount > 0) {
    return <Loader2 className="h-4 w-4 animate-spin text-sky-500" />;
  }
  if (transfers.some((transfer) => transfer.status === "succeeded")) {
    return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  }
  return <Clock3 className="h-4 w-4 text-zinc-400" />;
}

function collectSshMachines(groups: MachineGroup[]) {
  return groups.flatMap((group) =>
    group.machines.filter((machine) => machine.kind === "ssh"),
  );
}

function firstValidHostId(
  hostIds: Set<string>,
  ...candidates: Array<string | undefined>
) {
  return candidates.find((candidate) => candidate && hostIds.has(candidate));
}

function reconcileHostTabs({
  fallbackHostId,
  hostIds,
  lockedHostId,
  side,
  tabs,
}: {
  fallbackHostId?: string;
  hostIds: Set<string>;
  lockedHostId?: string;
  side: HostSide;
  tabs: HostTab[];
}) {
  const lockedTab =
    lockedHostId && hostIds.has(lockedHostId)
      ? hostTab(side, lockedHostId, true)
      : undefined;
  const validTabs = tabs.filter(
    (tab) => hostIds.has(tab.hostId) && tab.hostId !== lockedHostId,
  );
  const nextTabs = lockedTab ? [lockedTab, ...validTabs] : validTabs;
  if (nextTabs.length > 0) {
    return nextTabs;
  }
  return fallbackHostId && hostIds.has(fallbackHostId)
    ? [hostTab(side, fallbackHostId)]
    : [];
}

function hostTab(side: HostSide, hostId: string, locked = false): HostTab {
  return {
    hostId,
    id: locked
      ? `${side}-locked-${hostId}`
      : `${side}-host-${hostId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    locked,
  };
}
