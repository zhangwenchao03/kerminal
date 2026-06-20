import {
  useEffect,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { Button } from "../components/ui/button";
import { ModalShell } from "../components/ui/modal-shell";
import { cn } from "../lib/cn";
import type { LocalTerminalCreateOptions } from "../features/machine-sidebar/RemoteHostCreateDialog";
import type { AppSettings } from "../features/settings/settingsModel";
import type { Machine, MachineGroup } from "../features/workspace/types";
import type { TerminalProfile } from "../lib/profileApi";
import {
  createDefaultSshOptions,
  UNGROUPED_REMOTE_HOST_GROUP_ID,
  type RemoteHost,
  type RemoteHostCreateRequest,
  type RemoteHostUpdateRequest,
} from "../lib/remoteHostApi";

export type PendingDelete =
  | {
      id: string;
      machineCount: number;
      title: string;
      type: "group";
    }
  | {
      id: string;
      title: string;
      type: "machine";
    };

export function ShellResizeSeparator({
  className,
  hidden,
  label,
  onKeyDown,
  onPointerDown,
}: {
  className: string;
  hidden: boolean;
  label: string;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      aria-hidden={hidden || undefined}
      aria-label={hidden ? undefined : label}
      aria-orientation={hidden ? undefined : "vertical"}
      className={cn(
        "group relative flex h-full w-full cursor-col-resize items-center justify-center outline-none transition focus-visible:ring-4 focus-visible:ring-sky-500/20",
        className,
        hidden && "pointer-events-none opacity-0",
      )}
      onKeyDown={hidden ? undefined : onKeyDown}
      onPointerDown={hidden ? undefined : onPointerDown}
      role={hidden ? undefined : "separator"}
      tabIndex={hidden ? -1 : 0}
    >
      <span className="block h-12 w-px rounded-full bg-white/10 transition group-hover:bg-sky-400/70 group-focus-visible:bg-sky-400" />
    </div>
  );
}

export function DialogLazyFallback() {
  return (
    <div
      aria-label="正在加载弹窗"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/32 p-4 text-zinc-950 backdrop-blur-md dark:bg-black/48 dark:text-zinc-50"
      role="status"
    >
      <div className="rounded-[1.5rem] border border-white/40 bg-white/86 px-5 py-4 text-sm shadow-2xl shadow-black/20 dark:border-white/10 dark:bg-zinc-950/86 dark:shadow-black/50">
        正在加载...
      </div>
    </div>
  );
}

export function clampPanelWidth(
  value: number,
  bounds: {
    max: number;
    min: number;
  },
) {
  const max = Math.max(bounds.min, bounds.max);
  return Math.min(Math.max(value, bounds.min), max);
}

export function initialPanelWidth(
  viewportRatio: number,
  bounds: {
    max: number;
    min: number;
  },
) {
  if (typeof window === "undefined") {
    return bounds.min;
  }
  return clampPanelWidth(Math.round(window.innerWidth * viewportRatio), bounds);
}

export function isRealRemoteGroup(group: MachineGroup) {
  return group.id !== "local" && group.id !== UNGROUPED_REMOTE_HOST_GROUP_ID;
}

export function mergeProfiles(
  profiles: TerminalProfile[],
  profile: TerminalProfile,
): TerminalProfile[] {
  return [
    ...profiles.filter((candidate) => candidate.id !== profile.id),
    profile,
  ].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
  );
}

export function hasLocalProfileOverrides(options: LocalTerminalCreateOptions) {
  return Boolean(
    options.title?.trim() ||
      options.shell?.trim() ||
      options.cwd?.trim() ||
      (options.args && options.args.length > 0) ||
      (options.env && Object.keys(options.env).length > 0),
  );
}

export function duplicateMachineName(name: string) {
  return `${name} 副本`;
}

export function nextPinnedGroupSortOrder(groups: MachineGroup[]) {
  return Math.min(0, ...groups.map((group) => group.sortOrder ?? 0)) - 10;
}

export function nextUnpinnedGroupSortOrder(groups: MachineGroup[], groupId: string) {
  return (
    Math.max(
      0,
      ...groups
        .filter((group) => group.id !== groupId && !isPinnedGroup(group))
        .map((group) => group.sortOrder ?? 0),
    ) + 10
  );
}

function isPinnedGroup(group: MachineGroup) {
  return Boolean(group.pinned ?? ((group.sortOrder ?? 0) < 0));
}

export function remoteHostCreateRequestFromMachine(
  machine: Machine,
  overrides: {
    groupId?: string;
    name?: string;
  } = {},
): RemoteHostCreateRequest | undefined {
  const host = remoteHostFromMachine(machine);
  if (!host) {
    return undefined;
  }

  return {
    authType: host.authType,
    credentialRef: host.credentialRef,
    groupId: overrides.groupId ?? host.groupId,
    host: host.host,
    name: overrides.name ?? host.name,
    port: host.port,
    production: host.production,
    sshOptions: host.sshOptions,
    tags: [...host.tags],
    username: host.username,
  };
}

export function remoteHostUpdateRequestFromMachine(
  machine: Machine,
  groupId: string,
): RemoteHostUpdateRequest | undefined {
  const request = remoteHostCreateRequestFromMachine(machine, { groupId });
  if (!request) {
    return undefined;
  }

  return {
    ...request,
    id: machine.id,
    sortOrder: machine.sortOrder ?? 0,
  };
}

export function remoteHostFromMachine(machine: Machine | undefined): RemoteHost | undefined {
  if (
    !machine ||
    (machine.kind !== "ssh" &&
      machine.kind !== "rdp" &&
      machine.kind !== "telnet" &&
      machine.kind !== "serial")
  ) {
    return undefined;
  }

  return {
    authType: machine.authType ?? "agent",
    createdAt: machine.createdAt ?? "",
    credentialRef: machine.credentialRef,
    groupId: machine.remoteGroupId,
    host: machine.host ?? machine.description,
    id: machine.id,
    name: machine.name,
    port:
      machine.port ??
      (machine.kind === "rdp" ? 3389 : machine.kind === "telnet" ? 23 : 1),
    production: machine.production ?? false,
    sshOptions: machine.sshOptions ?? createDefaultSshOptions(),
    sortOrder: machine.sortOrder ?? 0,
    tags: machine.tags,
    updatedAt: machine.updatedAt ?? "",
    username: machine.username ?? "",
  };
}

export function DeleteConfirmationDialog({
  deleteError,
  deleting,
  onClose,
  onConfirm,
  pendingDelete,
}: {
  deleteError: string | null;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
  pendingDelete: PendingDelete | null;
}) {
  const isGroup = pendingDelete?.type === "group";
  const title = isGroup ? "删除分组" : "删除连接";
  const description = isGroup
    ? "删除分组后，分组内主机会移动到默认分组，不会删除主机配置。"
    : "删除后该 SSH/RDP/Telnet 连接配置会从本地列表移除。";

  return (
    <ModalShell
      footer={
        <>
          <Button disabled={deleting} onClick={onClose} type="button" variant="ghost">
            取消
          </Button>
          <Button
            disabled={deleting || !pendingDelete}
            onClick={onConfirm}
            type="button"
            variant="danger"
          >
            {deleting ? "删除中..." : "确认删除"}
          </Button>
        </>
      }
      description={description}
      maxWidthClassName="max-w-md"
      onClose={onClose}
      open={Boolean(pendingDelete)}
      title={title}
    >
      {pendingDelete ? (
        <div className="space-y-3 text-sm text-zinc-600 dark:text-zinc-300">
          <p>
            {isGroup ? "分组" : "连接"}：
            <span className="font-medium text-zinc-950 dark:text-zinc-50">
              {pendingDelete.title}
            </span>
          </p>
          {isGroup && pendingDelete.machineCount > 0 ? (
            <p>当前包含 {pendingDelete.machineCount} 台主机，删除后会移到默认分组。</p>
          ) : null}
          {deleteError ? (
            <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-red-600 dark:text-red-300">
              {deleteError}
            </p>
          ) : null}
        </div>
      ) : null}
    </ModalShell>
  );
}

export function useSystemThemePreference() {
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return true;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };

    setSystemPrefersDark(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  return systemPrefersDark;
}

export function htmlLanguage(language: AppSettings["appearance"]["interfaceLanguage"]) {
  if (language === "enUS") {
    return "en-US";
  }
  return "zh-CN";
}

export function workspaceBackgroundImage(
  enabled: boolean,
  imagePath: string,
  opacity: number,
  resolvedTheme: "dark" | "light",
) {
  const trimmedPath = imagePath.trim();
  if (!enabled || !trimmedPath) {
    return undefined;
  }

  const overlayOpacity = 1 - Math.min(Math.max(opacity, 0), 100) / 100;
  const overlayRgb = resolvedTheme === "dark" ? "16, 16, 18" : "245, 245, 247";
  return `linear-gradient(rgba(${overlayRgb}, ${overlayOpacity}), rgba(${overlayRgb}, ${overlayOpacity})), url("${localPathToCssUrl(trimmedPath)}")`;
}

function localPathToCssUrl(path: string) {
  if (/^(https?|asset|data|blob):/i.test(path)) {
    return path.replace(/"/g, "%22");
  }
  if (isTauri()) {
    try {
      return convertFileSrc(path).replace(/"/g, "%22");
    } catch {
      // Fall through to browser-friendly URL handling for tests and dev preview.
    }
  }
  if (/^file:/i.test(path)) {
    return path.replace(/"/g, "%22");
  }
  const normalized = path.replace(/\\/g, "/");
  if (/^[a-z]:\//i.test(normalized)) {
    return `file:///${normalized}`.replace(/"/g, "%22");
  }
  if (normalized.startsWith("/")) {
    return `file://${normalized}`.replace(/"/g, "%22");
  }
  return normalized.replace(/"/g, "%22");
}
