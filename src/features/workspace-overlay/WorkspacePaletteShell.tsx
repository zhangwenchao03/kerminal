import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AlertCircle, LoaderCircle, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { useWorkspacePaletteFocus } from "./workspacePaletteFocusModel";
import { resolveWorkspacePaletteKeyboardCommand } from "./workspacePaletteKeyboardModel";

export type WorkspacePaletteStatus = "error" | "loading" | "partial" | "ready";

/** Palette 外壳消费的最小展示项，不包含 Quick Open 或 Action 业务语义。 */
export interface WorkspacePaletteItem {
  description?: ReactNode;
  disabled?: boolean;
  id: string;
  label: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
}

/** WorkspacePaletteShell 的公共集成契约。 */
export interface WorkspacePaletteShellProps {
  description?: string;
  emptyMessage?: string;
  footer?: ReactNode;
  items: readonly WorkspacePaletteItem[];
  loadingMessage?: string;
  onActiveItemChange?: (item: WorkspacePaletteItem | undefined) => void;
  onClose: () => void;
  onQueryChange: (query: string) => void;
  onSelect: (item: WorkspacePaletteItem) => void;
  open: boolean;
  placeholder?: string;
  query: string;
  status?: WorkspacePaletteStatus;
  statusMessage?: string;
  title: string;
}

function findEnabledIndex(
  items: readonly WorkspacePaletteItem[],
  startIndex: number,
  direction: 1 | -1,
) {
  if (items.length === 0) {
    return -1;
  }
  for (let offset = 0; offset < items.length; offset += 1) {
    const index =
      (startIndex + offset * direction + items.length) % items.length;
    if (!items[index]?.disabled) {
      return index;
    }
  }
  return -1;
}

function resolveNavigatedIndex(
  items: readonly WorkspacePaletteItem[],
  requestedIndex: number,
  direction: 1 | -1,
) {
  if (!items[requestedIndex]?.disabled) {
    return requestedIndex;
  }
  return findEnabledIndex(items, requestedIndex, direction);
}

/**
 * Workspace Palette 的通用可访问外壳。
 *
 * 组件只管理 overlay、查询输入、列表语义、状态展示和交互生命周期；
 * 结果来源、过滤、排序和执行动作均由调用方负责。
 */
export function WorkspacePaletteShell({
  description,
  emptyMessage = "没有匹配结果",
  footer,
  items,
  loadingMessage = "正在加载结果",
  onActiveItemChange,
  onClose,
  onQueryChange,
  onSelect,
  open,
  placeholder = "输入关键词",
  query,
  status = "ready",
  statusMessage,
  title,
}: WorkspacePaletteShellProps) {
  const titleId = useId();
  const descriptionId = useId();
  const listboxId = useId();
  const statusId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const enabledItems = useMemo(
    () => items.filter((item) => !item.disabled),
    [items],
  );
  const [activeItemId, setActiveItemId] = useState<string | undefined>(() => {
    const initialIndex = findEnabledIndex(items, 0, 1);
    return initialIndex >= 0 ? items[initialIndex]?.id : undefined;
  });
  const retainedActiveIndex = activeItemId
    ? items.findIndex((item) => item.id === activeItemId && !item.disabled)
    : -1;
  const activeIndex =
    retainedActiveIndex >= 0
      ? retainedActiveIndex
      : findEnabledIndex(items, 0, 1);
  const resolvedActiveItemId =
    activeIndex >= 0 ? items[activeIndex]?.id : undefined;

  useWorkspacePaletteFocus({ inputRef, onClose, open, panelRef });

  useEffect(() => {
    if (!open) {
      return;
    }
    setActiveItemId(resolvedActiveItemId);
  }, [open, resolvedActiveItemId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    onActiveItemChange?.(activeIndex >= 0 ? items[activeIndex] : undefined);
  }, [activeIndex, items, onActiveItemChange, open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  const activeItem = activeIndex >= 0 ? items[activeIndex] : undefined;
  const activeDescendant = activeItem
    ? `${listboxId}-option-${activeIndex}`
    : undefined;

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    const command = resolveWorkspacePaletteKeyboardCommand({
      activeIndex,
      itemCount: items.length,
      key: event.key,
    });
    if (command.type === "none" || command.type === "close") {
      return;
    }

    event.preventDefault();
    if (command.type === "select") {
      const item = items[command.index];
      if (item && !item.disabled) {
        onSelect(item);
      }
      return;
    }

    const direction = event.key === "ArrowUp" || event.key === "End" ? -1 : 1;
    const nextIndex = resolveNavigatedIndex(items, command.index, direction);
    setActiveItemId(nextIndex >= 0 ? items[nextIndex]?.id : undefined);
  };

  const stateContent =
    status === "loading" && items.length === 0 ? (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <LoaderCircle
          aria-hidden="true"
          className="h-4 w-4 animate-spin motion-reduce:animate-none"
        />
        {loadingMessage}
      </div>
    ) : status === "error" && items.length === 0 ? (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        <AlertCircle
          aria-hidden="true"
          className="h-5 w-5 text-rose-600 dark:text-rose-300"
        />
        <span>{statusMessage ?? "无法加载结果"}</span>
      </div>
    ) : items.length === 0 ? (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {emptyMessage}
      </div>
    ) : (
      <>
        {items.map((item, index) => {
          const active = index === activeIndex;
          return (
            <div
              aria-disabled={item.disabled || undefined}
              aria-selected={active}
              className={cn(
                "flex min-h-12 cursor-default items-center gap-3 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100",
                active && "bg-[var(--surface-hover)]",
                item.disabled && "opacity-45",
              )}
              id={`${listboxId}-option-${index}`}
              key={item.id}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => {
                if (!item.disabled) {
                  setActiveItemId(item.id);
                }
              }}
              onClick={() => {
                if (!item.disabled) {
                  onSelect(item);
                }
              }}
              role="option"
            >
              {item.leading ? (
                <span aria-hidden="true" className="shrink-0">
                  {item.leading}
                </span>
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{item.label}</span>
                {item.description ? (
                  <span className="mt-0.5 block truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {item.description}
                  </span>
                ) : null}
              </span>
              {item.trailing ? (
                <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                  {item.trailing}
                </span>
              ) : null}
            </div>
          );
        })}
      </>
    );

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/30 px-4 pt-[min(14vh,8rem)] backdrop-blur-sm dark:bg-black/55"
      data-workspace-palette-overlay=""
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="flex h-[min(31rem,calc(100vh-5rem))] w-[min(42rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-overlay)] text-zinc-950 shadow-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-reduce:transition-none dark:text-zinc-50"
        onMouseDown={(event) => event.stopPropagation()}
        ref={panelRef}
        role="dialog"
      >
        <header className="sr-only">
          <h2 id={titleId}>{title}</h2>
          {description ? <p id={descriptionId}>{description}</p> : null}
        </header>
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
          <input
            aria-activedescendant={activeDescendant}
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-describedby={statusId}
            aria-expanded="true"
            aria-label={title}
            className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-zinc-950 outline-none placeholder:text-zinc-400 dark:text-zinc-50 dark:placeholder:text-zinc-500"
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={placeholder}
            ref={inputRef}
            role="combobox"
            spellCheck={false}
            type="text"
            value={query}
          />
          <button
            aria-label="关闭"
            className="kerminal-focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        <div
          aria-busy={status === "loading" || status === "partial"}
          aria-label={`${title}结果`}
          className="min-h-0 flex-1 overflow-y-auto py-1"
          id={listboxId}
          role="listbox"
        >
          {stateContent}
        </div>
        <div
          aria-live="polite"
          className="flex h-9 shrink-0 items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-3 text-xs text-zinc-500 dark:text-zinc-400"
          id={statusId}
          role="status"
        >
          <span className="truncate">
            {status === "partial"
              ? (statusMessage ?? "结果仍在加载")
              : status === "error" && items.length > 0
                ? (statusMessage ?? "部分结果加载失败")
                : `${enabledItems.length} 个可用结果`}
          </span>
          {footer ? <span className="shrink-0">{footer}</span> : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}
