import { X } from "lucide-react";
import { cn } from "../../lib/cn";
import type { InterfaceDensity } from "../settings/settingsModel";
import type { Machine } from "../workspace/types";
import type { SftpTransferHostTab } from "./sftpTransferWorkbenchModel";

export function HostTabButton({
  active,
  interfaceDensity = "comfortable",
  machine,
  onActivate,
  onClose,
  tab,
}: {
  active: boolean;
  interfaceDensity?: InterfaceDensity;
  machine: Machine | undefined;
  onActivate: () => void;
  onClose: () => void;
  tab: SftpTransferHostTab;
}) {
  const label = machine?.name ?? tab.hostId;
  const tabChromeClass =
    interfaceDensity === "compact"
      ? "h-7 rounded-lg px-2"
      : interfaceDensity === "spacious"
        ? "h-9 rounded-xl px-2.5"
        : "h-8 rounded-lg px-2";
  return (
    <span
      className={cn(
        "kerminal-focus-ring kerminal-pressable flex max-w-[180px] items-center gap-1.5 text-xs transition",
        tabChromeClass,
        active
          ? "bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100"
          : "text-zinc-500 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100",
      )}
      title={label}
    >
      <button
        aria-pressed={active}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        onClick={onActivate}
        type="button"
      >
        <span className="truncate">{label}</span>
        {tab.locked ? (
          <span className="shrink-0 rounded bg-[var(--surface-hover)] px-1 py-0.5 text-[10px] text-zinc-500 dark:text-zinc-300">
            固定
          </span>
        ) : null}
      </button>
      {!tab.locked ? (
        <button
          aria-label={`关闭 ${label}`}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-[var(--surface-hover)] hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" className="h-3 w-3 shrink-0" />
        </button>
      ) : null}
    </span>
  );
}
