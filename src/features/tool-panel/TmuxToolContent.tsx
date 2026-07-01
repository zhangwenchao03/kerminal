import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  CircleDot,
  Copy,
  Link2,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Terminal,
  Trash2,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { PromptDialog } from "../../components/ui/prompt-dialog";
import { cn } from "../../lib/cn";
import { writeDesktopClipboardText } from "../../lib/desktopClipboardApi";
import {
  tmuxCreateSession,
  tmuxDetachCurrent,
  tmuxKillSession,
  tmuxListSessions,
  tmuxProbe,
  tmuxRenameSession,
  type TmuxCapabilityStatus,
  type TmuxSessionSummary,
} from "../../lib/tmuxApi";
import { writePaneCommand } from "../terminal/terminalSessionRegistry";
import type {
  Machine,
  TerminalPane,
  TerminalTab,
} from "../workspace/types";
import {
  buildTmuxAttachCommand,
  writeTmuxDetachShortcut,
  writeTmuxShortcut,
} from "./tmux/tmuxCommandModel";
import {
  COMMON_TMUX_COMMANDS,
  COMMON_TMUX_SHORTCUTS,
  tmuxQuickrefDisplay,
  type TmuxQuickrefItem,
} from "./tmux/tmuxQuickrefModel";
import {
  defaultTmuxSessionName,
  resolveTmuxTarget,
  sortTmuxSessions,
  tmuxActionDisabledReason,
  tmuxSessionMatchesBinding,
  tmuxStatusLabel,
} from "./tmux/tmuxToolModel";

interface TmuxToolContentProps {
  activeMachine?: Machine;
  activeTab?: TerminalTab;
  focusedPane?: TerminalPane;
  selectedMachine?: Machine;
  terminalPanes?: TerminalPane[];
  terminalTabs?: TerminalTab[];
  onClosePane?: (paneId: string) => void;
  onFocusTab?: (tabId: string) => void;
  onOpenTmuxTerminal?: unknown;
}

type DialogState =
  | { kind: "create"; name: string }
  | { kind: "rename"; name: string; session: TmuxSessionSummary }
  | { kind: "kill"; session: TmuxSessionSummary }
  | null;

export function TmuxToolContent({
  activeMachine,
  activeTab,
  focusedPane,
  selectedMachine,
}: TmuxToolContentProps) {
  const [capability, setCapability] = useState<TmuxCapabilityStatus | null>(
    null,
  );
  const [sessions, setSessions] = useState<TmuxSessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const targetResolution = useMemo(
    () =>
      resolveTmuxTarget({
        activeMachine,
        activeTab,
        focusedPane,
        selectedMachine,
      }),
    [activeMachine, activeTab, focusedPane, selectedMachine],
  );
  const targetKey =
    targetResolution.status === "ready"
      ? JSON.stringify(targetResolution.target)
      : targetResolution.status;
  const currentBinding = focusedPane?.tmuxBinding;
  const orderedSessions = useMemo(
    () => sortTmuxSessions(sessions, currentBinding),
    [currentBinding, sessions],
  );

  const loadSessions = useCallback(async () => {
    if (targetResolution.status !== "ready") {
      setCapability(null);
      setSessions([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    let nextCapability: TmuxCapabilityStatus;
    try {
      nextCapability = await tmuxProbe({ target: targetResolution.target });
    } catch (loadError: unknown) {
      setCapability(null);
      setSessions([]);
      setError(formatTmuxLoadFailure(loadError));
      setLoading(false);
      return;
    }

    setCapability(nextCapability);
    if (!nextCapability.available) {
      setSessions([]);
      setLoading(false);
      return;
    }

    try {
      const nextSessions = await tmuxListSessions({
        target: targetResolution.target,
      });
      setSessions(nextSessions);
    } catch (loadError: unknown) {
      setSessions([]);
      setError(formatTmuxLoadFailure(loadError));
    } finally {
      setLoading(false);
    }
  }, [targetResolution]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions, targetKey]);

  const openCreateDialog = () => {
    setDialog({
      kind: "create",
      name: defaultTmuxSessionName({
        cwd: focusedPane?.currentCwd ?? focusedPane?.cwd,
        targetLabel:
          targetResolution.status === "ready"
            ? targetResolution.targetLabel
            : selectedMachine?.name,
      }),
    });
  };

  const createSession = async () => {
    if (targetResolution.status !== "ready" || dialog?.kind !== "create") {
      return;
    }
    const name = dialog.name.trim();
    if (!name) {
      setError("session name is required");
      return;
    }
    setBusyAction("create");
    try {
      const created = await tmuxCreateSession({
        cwd: focusedPane?.currentCwd ?? focusedPane?.cwd,
        name,
        target: targetResolution.target,
      });
      setDialog(null);
      setSessions((current) => [...current, created]);
      setError(null);
    } catch (createError: unknown) {
      setError(`create failed: ${errorMessage(createError)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const renameSession = async () => {
    if (targetResolution.status !== "ready" || dialog?.kind !== "rename") {
      return;
    }
    const name = dialog.name.trim();
    if (!name) {
      setError("session name is required");
      return;
    }
    setBusyAction(`rename:${dialog.session.id}`);
    try {
      const renamed = await tmuxRenameSession({
        name,
        sessionId: dialog.session.id,
        target: targetResolution.target,
      });
      setSessions((current) =>
        current.map((session) =>
          session.id === renamed.id ? renamed : session,
        ),
      );
      setDialog(null);
      setError(null);
    } catch (renameError: unknown) {
      setError(`rename failed: ${errorMessage(renameError)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const killSession = async () => {
    if (targetResolution.status !== "ready" || dialog?.kind !== "kill") {
      return;
    }
    const session = dialog.session;
    setBusyAction(`kill:${session.id}`);
    try {
      await tmuxKillSession({
        sessionId: session.id,
        target: targetResolution.target,
      });
      setSessions((current) =>
        current.filter((candidate) => candidate.id !== session.id),
      );
      setDialog(null);
      setError(null);
    } catch (killError: unknown) {
      setError(`kill failed: ${errorMessage(killError)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const attachSession = async (session: TmuxSessionSummary) => {
    if (
      targetResolution.status !== "ready" ||
      targetResolution.source !== "focusedPane" ||
      !focusedPane?.id
    ) {
      setError("focus the active terminal before attaching");
      return;
    }
    setBusyAction(`attach:${session.id}`);
    try {
      const result = await writePaneCommand({
        command: buildTmuxAttachCommand(targetResolution.target, session),
        paneId: focusedPane.id,
        source: "tool",
        tabId: activeTab?.id,
      });
      if (!result.sent) {
        setError(
          result.reason === "missing-session"
            ? "attach failed: terminal session is not ready"
            : "attach failed: empty command",
        );
        return;
      }
      setError(null);
    } catch (attachError: unknown) {
      setError(`attach failed: ${errorMessage(attachError)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const detachCurrent = async () => {
    if (!focusedPane?.id) {
      setError("请先聚焦左侧终端");
      return;
    }
    setBusyAction("detach");
    try {
      const shortcutSent = await writeTmuxDetachShortcut(focusedPane.id);
      if (shortcutSent) {
        await tmuxDetachCurrent(focusedPane.id).catch(() => false);
        setError(null);
        await loadSessions();
        return;
      }

      const detached = await tmuxDetachCurrent(focusedPane.id);
      if (!detached) {
        const result = await writePaneCommand({
          command: "tmux detach-client",
          paneId: focusedPane.id,
          source: "tool",
          tabId: activeTab?.id,
        });
        if (!result.sent) {
          setError(
            result.reason === "missing-session"
              ? "退出失败：当前终端还没准备好"
              : "退出失败：退出命令为空",
          );
          return;
        }
        setError(null);
        return;
      }
      setError(null);
      await loadSessions();
    } catch (detachError: unknown) {
      setError(`退出失败：${errorMessage(detachError)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const copyQuickrefItem = async (item: TmuxQuickrefItem) => {
    try {
      const result = await writeDesktopClipboardText(tmuxQuickrefDisplay(item));
      if (!result.ok) {
        setError("复制失败：当前环境没有剪贴板权限");
        return;
      }
      setError(null);
    } catch (copyError: unknown) {
      setError(`复制失败：${errorMessage(copyError)}`);
    }
  };

  const sendQuickrefItem = async (item: TmuxQuickrefItem) => {
    if (!focusedPane?.id) {
      setError("请先聚焦左侧终端");
      return;
    }
    setBusyAction(`send:${tmuxQuickrefDisplay(item)}`);
    try {
      if (item.kind === "shortcut") {
        const shortcutSent = await writeTmuxShortcut(focusedPane.id, item.data);
        if (!shortcutSent) {
          setError("发送失败：当前终端还没准备好");
          return;
        }
        setError(null);
        return;
      }

      const result = await writePaneCommand({
        command: item.command,
        paneId: focusedPane.id,
        source: "tool",
        tabId: activeTab?.id,
      });
      if (!result.sent) {
        setError(
          result.reason === "missing-session"
            ? "发送失败：当前终端还没准备好"
            : "发送失败：命令为空",
        );
        return;
      }
      setError(null);
    } catch (sendError: unknown) {
      setError(`发送失败：${errorMessage(sendError)}`);
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section className="space-y-4">
      <TmuxHeader
        busyAction={busyAction}
        capability={capability}
        focusedPane={focusedPane}
        loading={loading}
        onCreate={openCreateDialog}
        onDetach={detachCurrent}
        onRefresh={loadSessions}
        targetResolution={targetResolution}
      />
      {error ? (
        <div className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-100">
          {error}
        </div>
      ) : null}
      <TmuxSessionList
        busyAction={busyAction}
        capability={capability}
        currentBinding={currentBinding}
        focusedPane={focusedPane}
        loading={loading}
        onAttach={attachSession}
        onKill={(session) => setDialog({ kind: "kill", session })}
        onRename={(session) =>
          setDialog({ kind: "rename", name: session.name, session })
        }
        sessions={orderedSessions}
        targetResolution={targetResolution}
      />
      <TmuxCommandCheatsheet
        busyAction={busyAction}
        focusedPane={focusedPane}
        onCopyItem={(item) => void copyQuickrefItem(item)}
        onSendItem={(item) => void sendQuickrefItem(item)}
      />
      <TmuxDialog
        busy={Boolean(busyAction)}
        dialog={dialog}
        onClose={() => setDialog(null)}
        onCreate={createSession}
        onKill={killSession}
        onRename={renameSession}
        onUpdateName={(name) =>
          setDialog((current) =>
            current?.kind === "create"
              ? { ...current, name }
              : current?.kind === "rename"
                ? { ...current, name }
                : current,
          )
        }
      />
    </section>
  );
}

function TmuxHeader({
  busyAction,
  capability,
  focusedPane,
  loading,
  onCreate,
  onDetach,
  onRefresh,
  targetResolution,
}: {
  busyAction: string | null;
  capability: TmuxCapabilityStatus | null;
  focusedPane?: TerminalPane;
  loading: boolean;
  onCreate: () => void;
  onDetach: () => void;
  onRefresh: () => void;
  targetResolution: ReturnType<typeof resolveTmuxTarget>;
}) {
  const ready = targetResolution.status === "ready";
  const available = ready && capability?.available;
  const busy = Boolean(busyAction);
  const detachDisabledReason = !focusedPane?.id
    ? "先聚焦左侧终端"
    : busy
      ? "正在执行操作"
      : undefined;
  const subtitle = !ready
    ? targetResolution.reason
    : loading
      ? "probing tmux"
      : capability?.available
        ? (capability.version ?? "tmux ready")
        : (capability?.reason ?? "tmux unavailable");

  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-floating-glass)] p-3 shadow-sm shadow-black/5 backdrop-blur-xl dark:shadow-black/30">
      <div className="flex items-center gap-2">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-[var(--border-subtle)] bg-zinc-950/[0.035] text-zinc-700 dark:bg-white/10 dark:text-zinc-100">
          <Terminal className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="font-mono text-[11px] font-semibold uppercase text-zinc-500 dark:text-zinc-400">
              TMUX
            </p>
            {available ? (
              <span className="h-1.5 w-1.5 rounded-full bg-[#32D74B] shadow-[0_0_0_3px_rgb(50_215_75_/_0.12)]" />
            ) : null}
          </div>
          <h3 className="truncate font-mono text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            {ready ? targetResolution.targetLabel : "No target"}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <TmuxIconButton
            disabled={!ready || loading}
            disabledReason={!ready ? "没有可用目标" : loading ? "正在刷新" : undefined}
            icon={<RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />}
            label="刷新"
            onClick={onRefresh}
          />
          <TmuxIconButton
            disabled={!available || loading}
            disabledReason={
              !available ? "目标没有安装 tmux" : loading ? "正在刷新" : undefined
            }
            icon={<Plus className="h-4 w-4" />}
            label="新建会话"
            onClick={onCreate}
          />
          <TmuxIconButton
            disabled={Boolean(detachDisabledReason)}
            disabledReason={detachDisabledReason}
            icon={<LogOut className="h-4 w-4" />}
            label="退出 tmux"
            onClick={onDetach}
          />
        </div>
      </div>
      <p className="mt-2 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
        {subtitle}
      </p>
    </div>
  );
}

function TmuxSessionList({
  busyAction,
  capability,
  currentBinding,
  focusedPane,
  loading,
  onAttach,
  onKill,
  onRename,
  sessions,
  targetResolution,
}: {
  busyAction: string | null;
  capability: TmuxCapabilityStatus | null;
  currentBinding?: TerminalPane["tmuxBinding"];
  focusedPane?: TerminalPane;
  loading: boolean;
  onAttach: (session: TmuxSessionSummary) => void;
  onKill: (session: TmuxSessionSummary) => void;
  onRename: (session: TmuxSessionSummary) => void;
  sessions: TmuxSessionSummary[];
  targetResolution: ReturnType<typeof resolveTmuxTarget>;
}) {
  if (targetResolution.status !== "ready") {
    return <TmuxEmptyState title="target unavailable" body={targetResolution.reason} />;
  }
  if (loading) {
    return <TmuxEmptyState title="loading" body="probing tmux sessions" />;
  }
  if (capability && !capability.available) {
    return (
      <TmuxEmptyState
        title="tmux unavailable"
        body={capability.reason ?? "install tmux on target or confirm it is in PATH"}
      />
    );
  }
  if (sessions.length === 0) {
    return <TmuxEmptyState title="no sessions" body="create one detached session" />;
  }

  return (
    <div className="kerminal-solid-surface overflow-visible rounded-2xl border">
      {sessions.map((session) => {
        const current = tmuxSessionMatchesBinding(session, currentBinding);
        const disabledReason = tmuxActionDisabledReason({
          busy: Boolean(busyAction),
          session,
        });
        const attachDisabled =
          disabledReason ||
          (targetResolution.source !== "focusedPane" || !focusedPane?.id
            ? "先聚焦左侧终端"
            : undefined);
        return (
          <article
            className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-[var(--border-subtle)] px-2.5 py-2 first:rounded-t-2xl last:rounded-b-2xl last:border-b-0 hover:bg-[var(--surface-hover)]"
            key={session.id}
          >
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    current
                      ? "bg-[#0A84FF] shadow-[0_0_0_3px_rgb(10_132_255_/_0.12)]"
                      : session.attached
                        ? "bg-[#32D74B]"
                        : "bg-zinc-400/70 dark:bg-zinc-500",
                  )}
                  title={tmuxStatusLabel(session, current)}
                />
                <h4 className="min-w-0 truncate font-mono text-[13px] font-semibold text-zinc-950 dark:text-zinc-50">
                  {session.name || session.id}
                </h4>
                <code className="shrink-0 rounded-md border border-[var(--border-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                  {session.id}
                </code>
              </div>
              <div className="mt-1 flex min-w-0 items-center gap-2 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                <span className="truncate">{session.currentPath ?? "~"}</span>
                <span className="shrink-0 text-zinc-400 dark:text-zinc-500">
                  {session.windows}w/{session.clients}c
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <TmuxIconButton
                disabled={Boolean(attachDisabled)}
                disabledReason={attachDisabled}
                icon={<Link2 className="h-3.5 w-3.5" />}
                label="连接"
                onClick={() => onAttach(session)}
              />
              <TmuxIconButton
                disabled={Boolean(disabledReason)}
                disabledReason={disabledReason}
                icon={<Pencil className="h-3.5 w-3.5" />}
                label="重命名"
                onClick={() => onRename(session)}
              />
              <TmuxIconButton
                disabled={Boolean(disabledReason)}
                disabledReason={disabledReason}
                icon={<Trash2 className="h-3.5 w-3.5" />}
                label="删除"
                onClick={() => onKill(session)}
                tone="danger"
              />
            </div>
          </article>
        );
      })}
    </div>
  );
}

function TmuxDialog({
  busy,
  dialog,
  onClose,
  onCreate,
  onKill,
  onRename,
  onUpdateName,
}: {
  busy: boolean;
  dialog: DialogState;
  onClose: () => void;
  onCreate: () => void;
  onKill: () => void;
  onRename: () => void;
  onUpdateName: (name: string) => void;
}) {
  if (!dialog) {
    return null;
  }
  if (dialog.kind === "kill") {
    return (
      <PromptDialog
        busy={busy}
        cancelLabel="Cancel"
        confirmLabel="Kill"
        confirmVariant="danger"
        description={`kill-session ${dialog.session.name} (${dialog.session.id})`}
        onClose={onClose}
        onConfirm={onKill}
        open
        title="Kill tmux session"
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          This sends kill-session to the target tmux server.
        </p>
      </PromptDialog>
    );
  }

  const title = dialog.kind === "create" ? "New tmux session" : "Rename tmux session";
  const action = dialog.kind === "create" ? onCreate : onRename;
  return (
    <PromptDialog
      busy={busy}
      cancelLabel="Cancel"
      confirmDisabled={!dialog.name.trim()}
      confirmLabel={dialog.kind === "create" ? "Create" : "Save"}
      inputLabel="Session name"
      inputMono={false}
      onClose={onClose}
      onConfirm={action}
      onValueChange={onUpdateName}
      open
      title={title}
      value={dialog.name}
    />
  );
}

function TmuxIconButton({
  disabled,
  disabledReason,
  icon,
  label,
  onClick,
  tone = "default",
}: {
  disabled?: boolean;
  disabledReason?: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
}) {
  const tooltip = disabledReason ?? label;
  return (
    <span className="group/tmux-action relative inline-flex" title={tooltip}>
      <Button
        aria-label={label}
        className={cn(
          "h-8 w-8 rounded-xl p-0 transition duration-150 active:scale-[0.96]",
          tone === "danger" &&
            "text-[#FF453A] hover:bg-[#FF453A]/10 hover:text-[#FF453A]",
        )}
        disabled={disabled}
        onClick={onClick}
        size="icon"
        type="button"
        variant="ghost"
      >
        {icon}
      </Button>
      <span className="pointer-events-none absolute right-0 top-full z-30 mt-1 whitespace-nowrap rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-overlay)] px-2 py-1 font-mono text-[11px] font-medium text-zinc-700 opacity-0 shadow-lg shadow-black/10 backdrop-blur-xl transition-opacity duration-150 group-hover/tmux-action:opacity-100 group-focus-within/tmux-action:opacity-100 dark:text-zinc-100 dark:shadow-black/30">
        {tooltip}
      </span>
    </span>
  );
}

function TmuxEmptyState({ body, title }: { body: string; title: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] px-3 py-5 text-center font-mono">
      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
        {title}
      </p>
      <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
        {body}
      </p>
    </div>
  );
}

function TmuxCommandCheatsheet({
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
  const sendDisabledReason = !focusedPane?.id
    ? "先聚焦左侧终端"
    : busyAction
      ? "正在执行操作"
      : undefined;
  return (
    <section className="kerminal-solid-surface overflow-visible rounded-2xl border p-3">
      <div className="mb-3 flex items-center gap-1.5">
        <CircleDot className="h-3.5 w-3.5 text-[#0A84FF]" strokeWidth={1.75} />
        <h4 className="font-mono text-[11px] font-semibold uppercase text-zinc-500 dark:text-zinc-400">
          常用
        </h4>
      </div>
      <div className="space-y-3">
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
                icon={<Copy className="h-3.5 w-3.5" />}
                label={item.kind === "shortcut" ? "复制快捷键" : "复制命令"}
                onClick={() => onCopyItem(item)}
              />
              <TmuxIconButton
                disabled={Boolean(sendDisabledReason)}
                disabledReason={sendDisabledReason}
                icon={<Send className="h-3.5 w-3.5" />}
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

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function formatTmuxLoadFailure(error: unknown) {
  const message = errorMessage(error);
  if (
    message.includes("session name 为空") ||
    message.includes("字段数量不匹配") ||
    message.includes("quoted 字段")
  ) {
    return `tmux 会话列表读取失败：目标 tmux 输出格式不兼容。请刷新重试；如果仍失败，请升级 tmux 或手动执行 tmux ls 检查。原始信息：${message}`;
  }
  return `tmux 会话列表读取失败：${message}`;
}
