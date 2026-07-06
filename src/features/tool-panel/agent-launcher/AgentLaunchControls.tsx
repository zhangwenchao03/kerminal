// @author kongweiguang

import type { MouseEvent as ReactMouseEvent } from "react";
import {
  Loader2,
  ShieldOff,
  Sparkles,
  Terminal,
  Unlink,
  Wrench,
} from "lucide-react";
import { cn } from "../../../lib/cn";
import type { ExternalAgentId } from "../../../lib/agentLauncherApi";
import {
  agentPermissionSkipFlag,
  type AgentActionViewModel,
  type AgentLaunchPermissionMode,
} from "./agentLauncherModel";

const agentIcons = {
  claude: Sparkles,
  codex: Terminal,
  custom: Wrench,
};
const agentLaunchContextMenuClassName =
  "kerminal-context-menu kerminal-agent-launch-menu kerminal-floating-enter absolute z-[1000] w-[164px]";

export type AgentLaunchTargetMode = "current" | "unbound";

export function AgentIconButton({
  actionState,
  agent,
  onLaunch,
  onOpenMenu,
}: {
  actionState: ExternalAgentId | null;
  agent: AgentActionViewModel;
  onLaunch: (
    agentId: ExternalAgentId,
    permissionMode?: AgentLaunchPermissionMode,
    targetMode?: AgentLaunchTargetMode,
  ) => void;
  onOpenMenu: (agent: AgentActionViewModel, event: ReactMouseEvent) => void;
}) {
  const Icon = agentIcons[agent.agentId];
  const busy = actionState === agent.agentId;
  const disabled = actionState !== null || agent.disabled;
  const label = agent.agentId === "custom" ? "自定义" : agent.title;

  return (
    <button
      aria-label={
        agent.agentId === "custom" ? "Open Custom Agent" : `Open ${agent.title}`
      }
      className={cn(
        "kerminal-pressable kerminal-focus-ring flex h-16 min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl border border-transparent bg-transparent text-zinc-700 transition hover:border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] active:scale-[0.98] dark:text-zinc-200",
        disabled && "cursor-not-allowed opacity-45",
      )}
      disabled={disabled}
      onClick={() => onLaunch(agent.agentId)}
      onContextMenu={(event) => {
        if (disabled) {
          return;
        }
        onOpenMenu(agent, event);
      }}
      title={agent.disabledReason ?? agent.statusDetail}
      type="button"
    >
      {busy ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      )}
      <span className="max-w-full truncate text-[11px] font-medium">
        {label}
      </span>
    </button>
  );
}

export function AgentLaunchContextMenu({
  agent,
  onLaunch,
  position,
}: {
  agent: AgentActionViewModel;
  onLaunch: (
    permissionMode: AgentLaunchPermissionMode,
    targetMode?: AgentLaunchTargetMode,
  ) => void;
  position: {
    x: number;
    y: number;
  };
}) {
  const skipFlag = agentPermissionSkipFlag(agent.agentId);

  return (
    <div
      aria-label={`${agent.title} launch options`}
      className={agentLaunchContextMenuClassName}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      role="menu"
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      <div className="kerminal-context-menu-group">
        {skipFlag ? (
          <button
            aria-label={`Launch ${agent.title} with skipped permissions`}
            className="kerminal-context-menu-item kerminal-agent-launch-menu-item"
            onClick={() => onLaunch("skipPermissions")}
            role="menuitem"
            title={skipFlag}
            type="button"
          >
            <span className="kerminal-context-menu-icon">
              <ShieldOff />
            </span>
            <span className="kerminal-context-menu-label">跳过权限打开</span>
          </button>
        ) : null}
        <button
          aria-label={`Launch ${agent.title} without binding a host`}
          className="kerminal-context-menu-item kerminal-agent-launch-menu-item"
          onClick={() => onLaunch("default", "unbound")}
          role="menuitem"
          title="不绑定当前主机或终端"
          type="button"
        >
          <span className="kerminal-context-menu-icon">
            <Unlink />
          </span>
          <span className="kerminal-context-menu-label">不绑定主机打开</span>
        </button>
      </div>
    </div>
  );
}
