import {
  ChevronDown,
  CircleDot,
  Copy,
  Send,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { IconAction } from "../../../components/ui/icon-action";
import { cn } from "../../../lib/cn";
import type { TerminalPane } from "../../workspace/types";
import {
  COMMON_TMUX_COMMANDS,
  COMMON_TMUX_SHORTCUTS,
  tmuxQuickrefDisplay,
  type TmuxQuickrefItem,
} from "./tmuxQuickrefModel";

/** 带禁用原因提示的 tmux 图标动作。 */
export function TmuxIconButton({
  disabled,
  disabledReason,
  icon,
  iconClassName = "h-3.5 w-3.5",
  label,
  onClick,
  tone = "default",
}: {
  disabled?: boolean;
  disabledReason?: string;
  icon: LucideIcon;
  iconClassName?: string;
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
}) {
  const tooltip = disabledReason ?? label;
  return (
    <span className="group/tmux-action relative inline-flex" title={tooltip}>
      <IconAction
        className={cn(
          "h-8 w-8 rounded-xl p-0 transition duration-150 active:scale-[0.96]",
          tone === "danger" &&
            "text-[#FF453A] hover:bg-[#FF453A]/10 hover:text-[#FF453A]",
        )}
        disabled={disabled}
        disabledReason={disabledReason}
        icon={icon}
        iconClassName={iconClassName}
        label={label}
        onClick={onClick}
        type="button"
        tooltip={tooltip}
        variant="ghost"
      />
      <span className="kerminal-solid-surface pointer-events-none absolute right-0 top-full z-30 mt-1 whitespace-nowrap rounded-lg border px-2 py-1 font-mono text-[11px] font-medium text-zinc-700 opacity-0 shadow-lg shadow-black/10 transition-opacity duration-150 group-hover/tmux-action:opacity-100 group-focus-within/tmux-action:opacity-100 dark:text-zinc-100 dark:shadow-black/30">
        {tooltip}
      </span>
    </span>
  );
}

/** 可折叠的 tmux 命令与快捷键速查表。 */
export function TmuxCommandCheatsheet({
  busyAction,
  focusedPane,
  onCopyItem,
  onSendItem,
}: {
  busyAction: string | null;
  focusedPane?: TerminalPane;
  onCopyItem: (item: TmuxQuickrefItem) => void;
  onSendItem: (item: TmuxQuickrefItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sendDisabledReason = !focusedPane?.id
    ? "先聚焦左侧终端"
    : busyAction
      ? "正在执行操作"
      : undefined;
  return (
    <section className="kerminal-solid-surface overflow-visible rounded-2xl border p-3">
      <button
        aria-expanded={expanded}
        aria-label={expanded ? "收起快捷命令" : "展开快捷命令"}
        className="kerminal-focus-ring kerminal-pressable flex w-full items-center gap-2 rounded-xl text-left focus-visible:outline-none"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <CircleDot className="h-3.5 w-3.5 text-[#0A84FF]" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 text-sm font-medium text-zinc-800 dark:text-zinc-100">
          快捷命令
        </span>
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {COMMON_TMUX_COMMANDS.length + COMMON_TMUX_SHORTCUTS.length} 项
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-zinc-500 transition-transform dark:text-zinc-400",
            expanded && "rotate-180",
          )}
        />
      </button>
      {expanded ? (
        <div className="mt-3 space-y-3">
          <TmuxQuickrefGroup
            ariaLabel="常用 tmux 命令"
            items={COMMON_TMUX_COMMANDS}
            onCopyItem={onCopyItem}
            onSendItem={onSendItem}
            sendDisabledReason={sendDisabledReason}
            title="命令"
          />
          <TmuxQuickrefGroup
            ariaLabel="常用 tmux 快捷键"
            items={COMMON_TMUX_SHORTCUTS}
            onCopyItem={onCopyItem}
            onSendItem={onSendItem}
            sendDisabledReason={sendDisabledReason}
            title="快捷键"
          />
        </div>
      ) : null}
    </section>
  );
}

function TmuxQuickrefGroup({
  ariaLabel,
  items,
  onCopyItem,
  onSendItem,
  sendDisabledReason,
  title,
}: {
  ariaLabel: string;
  items: TmuxQuickrefItem[];
  onCopyItem: (item: TmuxQuickrefItem) => void;
  onSendItem: (item: TmuxQuickrefItem) => void;
  sendDisabledReason?: string;
  title: string;
}) {
  return (
    <div>
      <h5 className="mb-1.5 font-mono text-[10px] font-semibold uppercase text-zinc-400 dark:text-zinc-500">
        {title}
      </h5>
      <div aria-label={ariaLabel} className="space-y-1.5" role="list">
        {items.map((item) => (
          <div
            className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-zinc-950/[0.025] px-2.5 py-2 transition duration-150 hover:bg-zinc-950/[0.045] dark:bg-white/[0.045] dark:hover:bg-white/[0.075]"
            key={tmuxQuickrefDisplay(item)}
            role="listitem"
          >
            <div className="min-w-0">
              <code className="block truncate font-mono text-[11px] font-semibold text-zinc-900 dark:text-zinc-50">
                {tmuxQuickrefDisplay(item)}
              </code>
              <p className="mt-0.5 truncate text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
                {item.label}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1 opacity-80 transition-opacity group-hover:opacity-100">
              <TmuxIconButton
                icon={Copy}
                label={item.kind === "shortcut" ? "复制快捷键" : "复制命令"}
                onClick={() => onCopyItem(item)}
              />
              <TmuxIconButton
                disabled={Boolean(sendDisabledReason)}
                disabledReason={sendDisabledReason}
                icon={Send}
                label="发送到终端"
                onClick={() => onSendItem(item)}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
