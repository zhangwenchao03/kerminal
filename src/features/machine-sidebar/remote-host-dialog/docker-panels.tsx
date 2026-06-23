import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, RefreshCw, Search, Terminal } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import type { DockerContainerSummary } from "../../../lib/dockerApi";
import type { ContainerRuntime } from "../../../lib/targetModel";
import type { Machine } from "../../workspace/types";
import { dockerStatusClassName, dockerStatusLabel } from "./request-builders";
import { FieldRow, inputClassName } from "./shared-ui";

export function DockerPropertiesPanel({
  containers,
  groupId,
  groupOptions,
  hostId,
  includeStopped,
  loadError,
  loading,
  onRefresh,
  runtime,
  selectedContainerId,
  setGroupId,
  setHostId,
  setIncludeStopped,
  setRuntime,
  setSelectedContainerId,
  sshMachines,
}: {
  containers: DockerContainerSummary[];
  groupId: string;
  groupOptions: Array<{ label: string; value: string }>;
  hostId: string;
  includeStopped: boolean;
  loadError: string | null;
  loading: boolean;
  onRefresh: () => void;
  runtime: ContainerRuntime;
  selectedContainerId: string;
  setGroupId: (value: string) => void;
  setHostId: (value: string) => void;
  setIncludeStopped: (value: boolean) => void;
  setRuntime: (value: ContainerRuntime) => void;
  setSelectedContainerId: (value: string) => void;
  sshMachines: Machine[];
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3">
        <FieldRow label="主机">
          <DockerHostSearchSelect
            machines={sshMachines}
            onValueChange={setHostId}
            value={hostId}
          />
        </FieldRow>
        <FieldRow label="分组">
          <Select
            aria-label="分组"
            buttonClassName="h-10"
            onValueChange={setGroupId}
            options={groupOptions}
            value={groupId}
          />
        </FieldRow>
        <FieldRow label="运行时">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
            <Select
              aria-label="容器运行时"
              buttonClassName="h-10"
              onValueChange={(value) => setRuntime(value as ContainerRuntime)}
              options={[
                {
                  description: "通过远端 docker CLI 读取和进入容器。",
                  label: "Docker",
                  value: "docker",
                },
                {
                  description: "通过远端 podman CLI 读取和进入容器。",
                  label: "Podman",
                  value: "podman",
                },
              ]}
              value={runtime}
            />
            <div className="kerminal-field-surface flex h-10 items-center justify-between gap-3 rounded-xl border px-3 text-sm text-zinc-600 dark:text-zinc-300">
              <span>包含停止容器</span>
              <Switch
                aria-label="包含停止容器"
                checked={includeStopped}
                onCheckedChange={setIncludeStopped}
              />
            </div>
          </div>
        </FieldRow>
      </div>

      <div className="kerminal-solid-surface rounded-2xl border p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              容器列表
            </h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              选择一个容器后，确认会把它添加到侧栏。
            </p>
          </div>
          <Button
            disabled={!hostId || loading}
            onClick={onRefresh}
            type="button"
            variant="secondary"
          >
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            刷新
          </Button>
        </div>

        {sshMachines.length === 0 ? (
          <p className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200">
            先添加 SSH 主机后才能读取远端容器。
          </p>
        ) : !hostId ? (
          <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
            请选择主机后读取远端容器。
          </p>
        ) : loadError ? (
          <p className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
            {loadError}
          </p>
        ) : loading ? (
          <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
            正在读取容器...
          </p>
        ) : containers.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
            当前主机没有可选容器。
          </p>
        ) : (
          <div className="mt-4 grid max-h-64 gap-2 overflow-y-auto pr-1">
            {containers.map((container) => {
              const selected = container.id === selectedContainerId;
              return (
                <button
                  aria-pressed={selected}
                  className={[
                    "kerminal-focus-ring kerminal-pressable grid gap-1 rounded-xl border px-3 py-2 text-left transition",
                    selected
                      ? "border-sky-500/50 bg-[var(--surface-selected)] text-sky-800 dark:border-sky-300/40 dark:text-sky-100"
                      : "border-[var(--border-subtle)] text-zinc-700 hover:bg-[var(--surface-hover)] dark:text-zinc-200",
                  ].join(" ")}
                  key={container.id}
                  onClick={() => setSelectedContainerId(container.id)}
                  type="button"
                >
                  <span className="flex min-w-0 items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium">
                      {container.name}
                    </span>
                    <span
                      className={[
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px]",
                        dockerStatusClassName(container.status),
                      ].join(" ")}
                    >
                      {dockerStatusLabel(container.status)}
                    </span>
                  </span>
                  <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {container.image}
                    {container.statusText ? ` · ${container.statusText}` : ""}
                  </span>
                  {container.ports.length > 0 ? (
                    <span className="truncate text-xs text-zinc-400 dark:text-zinc-500">
                      {container.ports.join(", ")}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function DockerHostSearchSelect({
  machines,
  onValueChange,
  value,
}: {
  machines: Machine[];
  onValueChange: (value: string) => void;
  value: string;
}) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedMachine = machines.find((machine) => machine.id === value);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredMachines = useMemo(() => {
    if (!normalizedQuery) {
      return machines;
    }

    return machines.filter((machine) =>
      [
        machine.name,
        machine.description,
        machine.host,
        machine.username,
        machine.tags.join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [machines, normalizedQuery]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return undefined;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", closeOnPointerDown);
    return () => window.removeEventListener("pointerdown", closeOnPointerDown);
  }, [open]);

  const selectMachine = (machineId: string) => {
    onValueChange(machineId);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="relative min-w-0" ref={rootRef}>
      <button
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="主机"
        className={[
          "kerminal-field-surface kerminal-focus-ring flex h-10 w-full items-center justify-between gap-3 rounded-xl border px-3 text-left text-sm",
          "text-zinc-900 dark:text-zinc-100",
          machines.length === 0 ? "cursor-not-allowed opacity-60" : "",
        ].join(" ")}
        disabled={machines.length === 0}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        role="combobox"
        type="button"
      >
        <span className="min-w-0 truncate">
          {selectedMachine?.name ??
            (machines.length === 0 ? "暂无 SSH 主机" : "请选择主机")}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={[
            "h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-150",
            open ? "rotate-180" : "",
          ].join(" ")}
          strokeWidth={1.8}
        />
      </button>

      {open ? (
        <div
          className="kerminal-floating-enter absolute left-0 top-[calc(100%+0.375rem)] z-[1000] w-full overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-overlay)] p-2 text-sm text-zinc-950 shadow-2xl shadow-black/20 backdrop-blur-xl dark:text-zinc-100 dark:shadow-black/50"
          id={listboxId}
          role="listbox"
        >
          <label className="relative block">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
              strokeWidth={1.8}
            />
            <input
              aria-label="搜索主机"
              autoFocus
              className={`${inputClassName} pl-8 pr-3`}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                  return;
                }
                if (event.key === "Enter" && filteredMachines[0]) {
                  event.preventDefault();
                  selectMachine(filteredMachines[0].id);
                }
              }}
              placeholder="搜索名称、地址或用户"
              value={query}
            />
          </label>

          <div className="mt-2 max-h-56 overflow-y-auto">
            {filteredMachines.length === 0 ? (
              <p className="px-2.5 py-3 text-sm text-zinc-500 dark:text-zinc-400">
                没有匹配的主机。
              </p>
            ) : (
              filteredMachines.map((machine) => {
                const selected = machine.id === value;
                return (
                  <button
                    aria-selected={selected}
                    className={[
                      "flex w-full items-start justify-between gap-3 rounded-xl px-2.5 py-2 text-left transition-colors duration-150",
                      selected
                        ? "bg-[var(--surface-selected)] text-[#0A5FC8] dark:text-sky-100"
                        : "text-zinc-700 hover:bg-[var(--surface-hover)] dark:text-zinc-300",
                    ].join(" ")}
                    key={machine.id}
                    onClick={() => selectMachine(machine.id)}
                    role="option"
                    type="button"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {machine.name}
                      </span>
                      <span className="mt-0.5 block truncate text-xs leading-4 text-zinc-500 dark:text-zinc-400">
                        {machine.description ??
                          `${machine.username}@${machine.host}:${machine.port}`}
                      </span>
                    </span>
                    {selected ? (
                      <Check className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DockerTerminalOptionsPanel({
  shell,
  setShell,
  setUser,
  setWorkdir,
  user,
  workdir,
}: {
  shell: string;
  setShell: (value: string) => void;
  setUser: (value: string) => void;
  setWorkdir: (value: string) => void;
  user: string;
  workdir: string;
}) {
  return (
    <div className="grid gap-3">
      <FieldRow label="Shell">
        <input
          aria-label="容器 Shell"
          className={inputClassName}
          onChange={(event) => setShell(event.currentTarget.value)}
          placeholder="可选；留空时自动使用 bash 或 sh"
          value={shell}
        />
      </FieldRow>
      <FieldRow label="用户">
        <input
          aria-label="容器用户"
          className={inputClassName}
          onChange={(event) => setUser(event.currentTarget.value)}
          placeholder="可选，例如 root 或 app"
          value={user}
        />
      </FieldRow>
      <FieldRow label="工作目录">
        <input
          aria-label="容器工作目录"
          className={inputClassName}
          onChange={(event) => setWorkdir(event.currentTarget.value)}
          placeholder="可选，例如 /workspace"
          value={workdir}
        />
      </FieldRow>
      <div className="kerminal-solid-surface rounded-2xl border p-4">
        <div className="flex items-start gap-3">
          <Terminal className="mt-0.5 h-4 w-4 text-sky-500 dark:text-sky-300" />
          <p className="min-w-0 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            这些选项会在进入容器时传给 docker exec 或 podman exec。
          </p>
        </div>
      </div>
    </div>
  );
}
