// @author kongweiguang

import { useId, useMemo, useState, type FocusEvent } from "react";
import { Search } from "lucide-react";
import { cn } from "../../lib/cn";
import type { Machine, MachineGroup } from "../workspace/types";
import {
  HostContainersToolContent,
  type HostContainersToolContentProps,
} from "./HostContainersToolContent";

interface MachineSidebarContainersViewProps {
  groups: MachineGroup[];
  hostId?: string | null;
  initialContainerId?: string;
  onHostChange?: (hostId: string) => void;
  selectedMachineId: string;
  onEnterContainer?: HostContainersToolContentProps["onEnterContainer"];
  onFetchContainerStats?: HostContainersToolContentProps["onFetchContainerStats"];
  onInspectContainer?: HostContainersToolContentProps["onInspectContainer"];
  onLifecycleContainer?: HostContainersToolContentProps["onLifecycleContainer"];
  onListDockerContainers?: HostContainersToolContentProps["onListDockerContainers"];
  onOpenContainerLogs?: HostContainersToolContentProps["onOpenContainerLogs"];
  onOpenWorkspaceFileTab?: HostContainersToolContentProps["onOpenWorkspaceFileTab"];
  onPinContainer?: HostContainersToolContentProps["onPinContainer"];
  refreshRequestId?: number;
}

function sshHostsFromGroups(groups: MachineGroup[]): Machine[] {
  return groups.flatMap((group) =>
    group.machines.filter((machine) => machine.kind === "ssh"),
  );
}

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

export function MachineSidebarContainersView({
  groups,
  hostId,
  initialContainerId,
  onEnterContainer,
  onFetchContainerStats,
  onHostChange,
  onInspectContainer,
  onLifecycleContainer,
  onListDockerContainers,
  onOpenContainerLogs,
  onOpenWorkspaceFileTab,
  onPinContainer,
  refreshRequestId,
  selectedMachineId,
}: MachineSidebarContainersViewProps) {
  const hostListboxId = useId();
  const [hostSearch, setHostSearch] = useState("");
  const [hostDropdownOpen, setHostDropdownOpen] = useState(false);
  const sshHosts = useMemo(() => sshHostsFromGroups(groups), [groups]);
  const normalizedHostSearch = hostSearch.trim().toLowerCase();
  const filteredHosts = useMemo(
    () =>
      normalizedHostSearch
        ? sshHosts.filter((machine) =>
            hostSearchText(machine).includes(normalizedHostSearch),
          )
        : sshHosts,
    [normalizedHostSearch, sshHosts],
  );
  const selectedHost =
    sshHosts.find((machine) => machine.id === hostId) ??
    sshHosts.find((machine) => machine.id === selectedMachineId) ??
    sshHosts[0];
  const hostInputValue = hostDropdownOpen ? hostSearch : selectedHost?.name ?? "";

  if (!selectedHost) {
    return (
      <div className="kerminal-sidebar-list scrollbar-none flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto p-3">
        <div className="kerminal-muted-surface rounded-2xl border border-dashed px-3 py-6 text-center text-sm text-zinc-500">
          添加 SSH 主机后，可在这里查看 Docker、Podman 和 Compose。
        </div>
      </div>
    );
  }

  const closeHostDropdown = () => {
    setHostDropdownOpen(false);
    setHostSearch("");
  };
  const handleHostSelectorBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }
    closeHostDropdown();
  };
  const selectHost = (machine: Machine) => {
    onHostChange?.(machine.id);
    closeHostDropdown();
  };
  const enterContainer: NonNullable<
    HostContainersToolContentProps["onEnterContainer"]
  > = (container) => {
    // 进入终端会把 selected machine 切成容器；先固化宿主机，避免左栏退回第一台 SSH 主机。
    onHostChange?.(container.hostId);
    onEnterContainer?.(container);
  };

  return (
    <div className="kerminal-sidebar-list scrollbar-none flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto p-2.5">
      <div
        className="relative mb-2 min-w-0"
        onBlur={handleHostSelectorBlur}
      >
        <label className="relative min-w-0">
          <span className="sr-only">搜索容器主机</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
            strokeWidth={1.8}
          />
          <input
            aria-controls={hostListboxId}
            aria-expanded={hostDropdownOpen}
            aria-haspopup="listbox"
            aria-label="搜索容器主机"
            className="kerminal-sidebar-search kerminal-field-surface h-8 w-full rounded-xl border pl-9 pr-3 text-sm text-zinc-950 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-600"
            onClick={() => {
              setHostDropdownOpen(true);
              setHostSearch("");
            }}
            onChange={(event) => {
              setHostDropdownOpen(true);
              setHostSearch(event.currentTarget.value);
            }}
            onFocus={() => {
              setHostDropdownOpen(true);
              setHostSearch("");
            }}
            placeholder="搜索主机..."
            role="combobox"
            value={hostInputValue}
          />
        </label>
        {hostDropdownOpen ? (
          <div
            aria-label="容器主机列表"
            className="kerminal-floating-enter absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-overlay)] p-1 shadow-lg shadow-black/10 backdrop-blur-xl dark:shadow-black/30"
            id={hostListboxId}
            role="listbox"
          >
            <div className="scrollbar-none grid max-h-40 min-w-0 gap-1 overflow-y-auto">
              {filteredHosts.length > 0 ? (
                filteredHosts.map((machine) => {
                  const selected = machine.id === selectedHost.id;
                  return (
                    <button
                      aria-selected={selected}
                      className={cn(
                        "kerminal-focus-ring kerminal-pressable grid min-w-0 gap-0.5 rounded-lg px-2.5 py-1.5 text-left transition",
                        selected
                          ? "bg-[var(--surface-selected)] text-zinc-950 shadow-sm shadow-sky-950/5 ring-1 ring-sky-500/15 dark:text-zinc-50 dark:ring-sky-300/15"
                          : "text-zinc-600 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50",
                      )}
                      key={machine.id}
                      onClick={() => selectHost(machine)}
                      role="option"
                      type="button"
                    >
                      <span className="truncate text-sm font-medium">
                        {machine.name}
                      </span>
                      <span className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                        {hostIdentity(machine)}
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-lg border border-dashed border-[var(--border-subtle)] px-3 py-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
                  没有匹配的主机。
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
      <HostContainersToolContent
        initialContainerId={
          hostId && hostId === selectedHost.id ? initialContainerId : undefined
        }
        onEnterContainer={enterContainer}
        onFetchContainerStats={onFetchContainerStats}
        onInspectContainer={onInspectContainer}
        onLifecycleContainer={onLifecycleContainer}
        onListDockerContainers={onListDockerContainers}
        onOpenContainerLogs={onOpenContainerLogs}
        onOpenWorkspaceFileTab={onOpenWorkspaceFileTab}
        onPinContainer={onPinContainer}
        presentation="sidebar"
        refreshRequestId={refreshRequestId}
        selectedMachine={selectedHost}
      />
    </div>
  );
}
