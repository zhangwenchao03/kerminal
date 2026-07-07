import { useId, useMemo, useState, type FocusEvent } from "react";
import { Search } from "lucide-react";
import { cn } from "../../../lib/cn";
import type { Machine } from "../../workspace/types";

export function SearchableHostSelect({
  ariaLabel,
  disabled,
  machines,
  onSelectHost,
  placeholder = "搜索主机...",
}: {
  ariaLabel: string;
  disabled?: boolean;
  machines: Machine[];
  onSelectHost: (hostId: string) => void;
  placeholder?: string;
}) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
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
    onSelectHost(hostId);
    closeDropdown();
  };

  return (
    <div className="relative min-w-0" onBlur={handleBlur}>
      <label className="relative block min-w-0">
        <span className="sr-only">{ariaLabel}</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
          strokeWidth={1.8}
        />
        <input
          aria-controls={open ? listboxId : undefined}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          className="kerminal-field-surface kerminal-focus-ring h-10 w-full rounded-xl border pl-9 pr-3 text-sm text-zinc-950 outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-100 dark:placeholder:text-zinc-600"
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
          placeholder={placeholder}
          role="combobox"
          value={search}
        />
      </label>
      {open ? (
        <div
          className="kerminal-floating-surface kerminal-floating-enter absolute left-0 right-0 top-[calc(100%+0.375rem)] z-50 overflow-hidden rounded-2xl border p-1 text-sm text-zinc-950 dark:text-zinc-100"
          id={listboxId}
          role="listbox"
        >
          <div className="scrollbar-none grid max-h-64 gap-1 overflow-y-auto">
            {filteredMachines.length > 0 ? (
              filteredMachines.map((machine) => (
                <button
                  aria-selected={false}
                  className={cn(
                    "kerminal-focus-ring kerminal-pressable grid min-w-0 gap-0.5 rounded-xl px-2.5 py-2 text-left transition",
                    "text-zinc-700 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50",
                  )}
                  key={machine.id}
                  onClick={() => selectHost(machine.id)}
                  role="option"
                  type="button"
                >
                  <span className="truncate text-sm font-medium">
                    {machine.name}
                  </span>
                  <span className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                    {formatHostIdentity(machine)}
                  </span>
                </button>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-[var(--border-subtle)] px-3 py-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
                没有匹配的主机。
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function formatHostIdentity(machine: Machine) {
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
    formatHostIdentity(machine),
    ...machine.tags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
