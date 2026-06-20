import {
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ChevronDown, ChevronRight, Copy, ImageDown } from "lucide-react";
import { cn } from "../../lib/cn";
import type { TerminalCommandBlockView } from "./terminalCommandBlocks";

export type TerminalCommandBlockAction = "copyImage" | "copyText" | "toggle";

interface TerminalCommandBlockRailProps {
  blocks: TerminalCommandBlockView[];
  onAction: (blockId: string, action: TerminalCommandBlockAction) => void;
}

interface CommandBlockMenuState {
  block: TerminalCommandBlockView;
  position: {
    x: number;
    y: number;
  };
}

export function TerminalCommandBlockRail({
  blocks,
  onAction,
}: TerminalCommandBlockRailProps) {
  const [menu, setMenu] = useState<CommandBlockMenuState | null>(null);

  useEffect(() => {
    if (!menu) {
      return undefined;
    }

    const closeMenu = () => setMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menu]);

  if (blocks.length === 0) {
    return null;
  }

  const openMenu = (
    block: TerminalCommandBlockView,
    event: ReactMouseEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({
      block,
      position: clampCommandBlockMenuPosition(event.clientX, event.clientY),
    });
  };

  const executeMenuAction = (action: Exclude<TerminalCommandBlockAction, "toggle">) => {
    if (!menu) {
      return;
    }
    setMenu(null);
    onAction(menu.block.id, action);
  };

  return (
    <>
      <div
        aria-label="命令块色条"
        className="pointer-events-none absolute bottom-2 left-1 top-2 z-20 w-5"
      >
        {blocks.map((block) => (
          <TerminalCommandBlockMarker
            block={block}
            key={block.id}
            onAction={onAction}
            onOpenMenu={openMenu}
          />
        ))}
      </div>
      <TerminalCommandBlockFoldSummaries blocks={blocks} />
      {menu ? (
        <TerminalCommandBlockContextMenu
          block={menu.block}
          onAction={executeMenuAction}
          position={menu.position}
        />
      ) : null}
    </>
  );
}

function TerminalCommandBlockFoldSummaries({
  blocks,
}: {
  blocks: TerminalCommandBlockView[];
}) {
  const collapsedBlocks = blocks.filter(
    (block) => block.collapsed && !block.muted,
  );
  if (collapsedBlocks.length === 0) {
    return null;
  }

  return (
    <div
      aria-label="命令块折叠摘要"
      className="pointer-events-none absolute inset-x-0 top-2 z-10"
    >
      {collapsedBlocks.map((block) => (
        <div
          aria-label={`命令块 ${block.command || "空命令"} 折叠摘要 ${block.lineCount} 行`}
          className="absolute left-6 right-3 flex items-center justify-end"
          key={block.id}
          style={{
            height: block.height,
            top: block.top,
          }}
        >
          <div className="rounded-full border border-black/8 bg-white/88 px-2 py-0.5 text-[11px] font-medium text-zinc-500 shadow-sm dark:border-white/10 dark:bg-zinc-950/88 dark:text-zinc-300">
            已折叠 {block.lineCount} 行
          </div>
        </div>
      ))}
    </div>
  );
}

function TerminalCommandBlockMarker({
  block,
  onAction,
  onOpenMenu,
}: {
  block: TerminalCommandBlockView;
  onAction: (blockId: string, action: TerminalCommandBlockAction) => void;
  onOpenMenu: (
    block: TerminalCommandBlockView,
    event: ReactMouseEvent,
  ) => void;
}) {
  const ToggleIcon = block.collapsed ? ChevronRight : ChevronDown;
  const commandLabel = block.virtual ? "当前命令行" : block.command || "空命令";

  return (
    <div
      className="group absolute left-0"
      style={{
        height: block.height,
        top: block.top,
      }}
    >
      <button
        aria-label={
          block.virtual
            ? `当前命令行色条 ${commandLabel}`
            : `${block.collapsed ? "展开" : "折叠"}命令块 ${commandLabel}`
        }
        className={cn(
          "pointer-events-auto flex h-full w-2 items-start justify-center rounded-full border border-white/35 shadow-sm transition hover:w-3 focus-visible:w-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400",
          block.muted && "border-white/20 grayscale",
          block.virtual && "cursor-default",
        )}
        onClick={() => {
          if (!block.virtual) {
            onAction(block.id, "toggle");
          }
        }}
        style={{
          backgroundColor: block.muted ? "rgb(113 113 122 / 0.42)" : block.color,
          opacity: block.muted ? 0.45 : 0.92,
        }}
        onContextMenu={(event) => {
          if (block.virtual) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onOpenMenu(block, event);
        }}
        title={
          block.virtual
            ? "当前等待输入的命令行"
            : `${block.collapsed ? "展开" : "折叠"}命令块：${commandLabel}；右键复制`
        }
        type="button"
      >
        {block.virtual ? null : (
          <ToggleIcon className="mt-0.5 h-2.5 w-2.5 text-white/90 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100" />
        )}
      </button>
    </div>
  );
}

function TerminalCommandBlockContextMenu({
  block,
  onAction,
  position,
}: {
  block: TerminalCommandBlockView;
  onAction: (action: Exclude<TerminalCommandBlockAction, "toggle">) => void;
  position: {
    x: number;
    y: number;
  };
}) {
  const commandLabel = block.command || "空命令";

  return (
    <div
      aria-label={`命令块 ${commandLabel} 右键菜单`}
      className="fixed z-50 w-40 overflow-hidden rounded-md border border-black/10 bg-white/95 p-1 text-zinc-900 shadow-xl shadow-black/20 backdrop-blur dark:border-white/10 dark:bg-zinc-950/95 dark:text-zinc-100"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      role="menu"
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      <div className="space-y-0.5">
        <button
          aria-label={`复制文本块 ${commandLabel}`}
          className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-sm text-zinc-700 transition hover:bg-black/6 hover:text-zinc-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 dark:text-zinc-200 dark:hover:bg-white/10 dark:hover:text-white"
          onClick={() => onAction("copyText")}
          role="menuitem"
          title="复制命令块文本"
          type="button"
        >
          <Copy className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
          <span className="min-w-0 flex-1 truncate">复制文本块</span>
        </button>
        <button
          aria-label={`复制图片 ${commandLabel}`}
          className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-sm text-zinc-700 transition hover:bg-black/6 hover:text-zinc-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 dark:text-zinc-200 dark:hover:bg-white/10 dark:hover:text-white"
          onClick={() => onAction("copyImage")}
          role="menuitem"
          title="复制命令块图片"
          type="button"
        >
          <ImageDown className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
          <span className="min-w-0 flex-1 truncate">复制图片</span>
        </button>
      </div>
    </div>
  );
}

function clampCommandBlockMenuPosition(x: number, y: number) {
  if (typeof window === "undefined") {
    return { x, y };
  }

  const menuWidth = 160;
  const menuHeight = 76;
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)),
  };
}
