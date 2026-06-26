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
  Play,
  RotateCw,
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
  container: HostContainerMetadata;
  onAction: (
    action: HostContainerLifecycleAction,
    container: HostContainerMetadata,
  ) => void;
  onInspectAction: (
    tab: HostContainerInspectorTab,
    container: HostContainerMetadata,
  ) => void;
  onSelectContainer: (containerId: string) => void;
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
  container,
  onAction,
  onInspectAction,
  onSelectContainer,
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
  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`更多容器操作 ${container.name}`}
        className="kerminal-pressable kerminal-focus-ring inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
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
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {position
        ? createPortal(
            <div
              className="kerminal-context-menu kerminal-floating-enter fixed z-[1001] w-44"
              onClick={(event) => event.stopPropagation()}
              ref={menuRef}
              role="menu"
              style={{
                left: position.left,
                top: position.top,
              }}
            >
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
