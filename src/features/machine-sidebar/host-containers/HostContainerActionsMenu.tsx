/**
 * Host container row lifecycle actions menu.
 *
 * @author kongweiguang
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  Info,
  MoreHorizontal,
  Pin,
  Play,
  RotateCw,
  ScrollText,
  Square,
  Trash2,
} from "lucide-react";
import { cn } from "../../../lib/cn";
import {
  canRunHostContainerLifecycleAction,
  hostContainerLifecycleDisabledReason,
  type HostContainerInspectorTab,
  type HostContainerLifecycleAction,
  type HostContainerMetadata,
} from "./hostContainerDialogModel";

interface HostContainerActionsMenuProps {
  compact?: boolean;
  container: HostContainerMetadata;
  onAction: (
    action: HostContainerLifecycleAction,
    container: HostContainerMetadata,
  ) => void;
  onInspectAction: (
    tab: HostContainerInspectorTab,
    container: HostContainerMetadata,
  ) => void;
  onOpenLogs?: (container: HostContainerMetadata) => void;
  onPinContainer?: (container: HostContainerMetadata) => void;
  onSelectContainer: (containerId: string) => void;
  pinning?: boolean;
  showInspectorItems?: boolean;
}

type MenuPosition = {
  left: number;
  top: number;
};

const lifecycleItems: Array<{
  action: HostContainerLifecycleAction;
  danger?: boolean;
  icon: typeof Play;
  label: string;
}> = [
  { action: "start", icon: Play, label: "启动" },
  { action: "stop", danger: true, icon: Square, label: "停止" },
  { action: "restart", icon: RotateCw, label: "重启" },
  { action: "remove", danger: true, icon: Trash2, label: "删除" },
];

const inspectorItems: Array<{
  icon: typeof Info;
  label: string;
  tab: HostContainerInspectorTab;
}> = [
  { icon: Info, label: "详情", tab: "details" },
  { icon: Activity, label: "监控", tab: "stats" },
];

export function HostContainerActionsMenu({
  compact = false,
  container,
  onAction,
  onInspectAction,
  onOpenLogs,
  onPinContainer,
  onSelectContainer,
  pinning = false,
  showInspectorItems = true,
}: HostContainerActionsMenuProps) {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = Boolean(position);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const close = () => setPosition(null);
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (
        menuRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return;
      }
      close();
    };
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    window.addEventListener("pointerdown", closeOnPointerDown, true);
    window.addEventListener("keydown", closeOnKeyDown, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown, true);
      window.removeEventListener("keydown", closeOnKeyDown, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const openMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const menuWidth = 176;
    setPosition({
      left: Math.max(
        12,
        Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12),
      ),
      top: Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 280)),
    });
  };

  const selectAction = (action: HostContainerLifecycleAction) => {
    onSelectContainer(container.id);
    setPosition(null);
    onAction(action, container);
  };
  const selectInspectAction = (tab: HostContainerInspectorTab) => {
    onSelectContainer(container.id);
    setPosition(null);
    onInspectAction(tab, container);
  };
  const selectOpenLogs = () => {
    onSelectContainer(container.id);
    setPosition(null);
    onOpenLogs?.(container);
  };
  const selectPinContainer = () => {
    onSelectContainer(container.id);
    setPosition(null);
    onPinContainer?.(container);
  };
  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`更多容器操作 ${container.name}`}
        className={cn(
          "kerminal-pressable kerminal-focus-ring inline-flex items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50",
          compact ? "h-7 w-7" : "h-8 w-8",
        )}
        onClick={(event) => {
          event.stopPropagation();
          if (open) {
            setPosition(null);
            return;
          }
          openMenu();
        }}
        ref={buttonRef}
        title="更多容器操作"
        type="button"
      >
        <MoreHorizontal className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      </button>
      {position
        ? createPortal(
            <div
              className="kerminal-context-menu kerminal-floating-enter kerminal-layer-popover fixed w-44"
              onClick={(event) => event.stopPropagation()}
              ref={menuRef}
              role="menu"
              style={{
                left: position.left,
                top: position.top,
              }}
            >
              {showInspectorItems ? (
                <div className="kerminal-context-menu-group">
                  {inspectorItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        className="kerminal-context-menu-item"
                        key={item.tab}
                        onClick={() => selectInspectAction(item.tab)}
                        role="menuitem"
                        type="button"
                      >
                        <span className="kerminal-context-menu-icon">
                          <Icon />
                        </span>
                        <span className="kerminal-context-menu-label">
                          {item.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {onOpenLogs || onPinContainer ? (
                <div className="kerminal-context-menu-group">
                  {onOpenLogs ? (
                    <button
                      className="kerminal-context-menu-item"
                      onClick={selectOpenLogs}
                      role="menuitem"
                      type="button"
                    >
                      <span className="kerminal-context-menu-icon">
                        <ScrollText />
                      </span>
                      <span className="kerminal-context-menu-label">日志</span>
                    </button>
                  ) : null}
                  {onPinContainer ? (
                    <button
                      className="kerminal-context-menu-item"
                      disabled={pinning}
                      onClick={selectPinContainer}
                      role="menuitem"
                      type="button"
                    >
                      <span className="kerminal-context-menu-icon">
                        <Pin />
                      </span>
                      <span className="kerminal-context-menu-label">固定</span>
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="kerminal-context-menu-group">
                {lifecycleItems.map((item) => {
                  const Icon = item.icon;
                  const disabled = !canRunHostContainerLifecycleAction(
                    container,
                    item.action,
                  );
                  const disabledReason = hostContainerLifecycleDisabledReason(
                    container,
                    item.action,
                  );
                  return (
                    <button
                      className={cn(
                        "kerminal-context-menu-item",
                        item.danger && "kerminal-context-menu-item--danger",
                      )}
                      disabled={disabled}
                      key={item.action}
                      onClick={() => selectAction(item.action)}
                      role="menuitem"
                      title={disabledReason}
                      type="button"
                    >
                      <span className="kerminal-context-menu-icon">
                        <Icon />
                      </span>
                      <span className="kerminal-context-menu-label">
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
