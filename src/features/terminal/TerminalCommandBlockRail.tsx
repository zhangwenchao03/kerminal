import {
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Bot, ChevronDown, ChevronRight, Copy, ImageDown } from "lucide-react";
import { cn } from "../../lib/cn";
import type { TerminalCommandBlockView } from "./terminalCommandBlocks";
import {
  clampCommandBlockMenuPosition,
  resolveTerminalCommandBlockFoldSummaries,
  resolveTerminalCommandBlockMarkerModel,
} from "./terminalCommandBlockRailModel";

const commandBlockFoldSummaryClassName =
  "rounded-full border border-[var(--border-subtle)] bg-[var(--surface-overlay)] px-2 py-0.5 text-[11px] font-medium text-zinc-500 shadow-sm backdrop-blur-xl dark:text-zinc-300";
const commandBlockMenuSurfaceClassName =
  "kerminal-context-menu kerminal-floating-enter fixed z-[1000] w-44";
const commandBlockMenuItemClassName =
  "kerminal-context-menu-item";

export type TerminalCommandBlockAction =
  | "copyImage"
  | "copyText"
  | "sendToAgent"
  | "toggle";

interface TerminalCommandBlockRailProps {
  blocks: TerminalCommandBlockView[];
  canSendToAgent?: boolean;
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
  canSendToAgent = true,
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
      position: clampCommandBlockMenuPosition(event.clientX, event.clientY, {
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      }),
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
          canSendToAgent={canSendToAgent}
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
  const summaries = resolveTerminalCommandBlockFoldSummaries(blocks);
  if (summaries.length === 0) {
    return null;
  }

  return (
    <div
      aria-label="命令块折叠摘要"
      className="pointer-events-none absolute inset-x-0 top-2 z-10"
    >
      {summaries.map((summary) => (
        <div
          aria-label={summary.ariaLabel}
          className="absolute left-6 right-3 flex items-center justify-end"
          key={summary.id}
          style={{
            height: summary.height,
            top: summary.top,
          }}
        >
          <div className={commandBlockFoldSummaryClassName}>
            已折叠 {summary.lineCount} 行
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
  const marker = resolveTerminalCommandBlockMarkerModel(block);
  const ToggleIcon = marker.icon === "collapsed" ? ChevronRight : ChevronDown;

  return (
    <div
      className="group absolute left-0"
      style={{
        height: block.height,
        top: block.top,
      }}
    >
      <button
        aria-label={marker.ariaLabel}
        className={cn(
          "pointer-events-auto flex h-full w-2 items-start justify-center rounded-full border border-white/35 shadow-sm transition hover:w-3 focus-visible:w-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400",
          block.muted && "border-white/20 grayscale",
          marker.isCurrent && "cursor-default",
        )}
        onClick={() => {
          if (marker.canToggle) {
            onAction(block.id, "toggle");
          }
        }}
        style={{
          backgroundColor: block.muted ? "rgb(113 113 122 / 0.42)" : block.color,
          opacity: block.muted ? 0.45 : 0.92,
        }}
        onContextMenu={(event) => {
          if (!marker.canOpenMenu) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onOpenMenu(block, event);
        }}
        title={marker.title}
        type="button"
      >
        {marker.icon ? (
          <ToggleIcon className="mt-0.5 h-2.5 w-2.5 text-white/90 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100" />
        ) : null}
      </button>
    </div>
  );
}

function TerminalCommandBlockContextMenu({
  block,
  canSendToAgent,
  onAction,
  position,
}: {
  block: TerminalCommandBlockView;
  canSendToAgent: boolean;
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
      className={commandBlockMenuSurfaceClassName}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      role="menu"
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      <div className="kerminal-context-menu-group">
        <button
          aria-label={`复制文本块 ${commandLabel}`}
          className={commandBlockMenuItemClassName}
          onClick={() => onAction("copyText")}
          role="menuitem"
          title="复制命令块文本"
          type="button"
        >
          <span className="kerminal-context-menu-icon">
            <Copy />
          </span>
          <span className="kerminal-context-menu-label">复制文本块</span>
        </button>
        <button
          aria-label={`复制图片 ${commandLabel}`}
          className={commandBlockMenuItemClassName}
          onClick={() => onAction("copyImage")}
          role="menuitem"
          title="复制命令块图片"
          type="button"
        >
          <span className="kerminal-context-menu-icon">
            <ImageDown />
          </span>
          <span className="kerminal-context-menu-label">复制图片</span>
        </button>
      </div>
      <div className="kerminal-context-menu-group">
        <button
          aria-label={`发送命令块 ${commandLabel} 到 Agent`}
          className={commandBlockMenuItemClassName}
          disabled={!canSendToAgent}
          onClick={() => onAction("sendToAgent")}
          role="menuitem"
          title="发送该命令块到 Agent"
          type="button"
        >
          <span className="kerminal-context-menu-icon">
            <Bot />
          </span>
          <span className="kerminal-context-menu-label">发送到 Agent</span>
        </button>
      </div>
    </div>
  );
}
