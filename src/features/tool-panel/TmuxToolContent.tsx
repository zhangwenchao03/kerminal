import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ChevronDown,
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
  type LucideIcon,
} from "lucide-react";
import { IconAction } from "../../components/ui/icon-action";
import { PromptDialog } from "../../components/ui/prompt-dialog";
import { UserFacingNotice } from "../../components/ui/user-facing-notice";
import { cn } from "../../lib/cn";
import { writeDesktopClipboardText } from "../../lib/desktopClipboardApi";
import type { UserFacingMessage } from "../../lib/userFacingMessage";
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
import {
  formatTmuxActionFailure,
  formatTmuxCapabilityReason,
  formatTmuxLoadFailure,
  formatTmuxTargetReason,
  tmuxFailure,
  tmuxNotice,
} from "./tmux/tmuxUserMessage";

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
  const [error, setError] = useState<UserFacingMessage | null>(null);

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
      setError(
        tmuxFailure(loadError, formatTmuxLoadFailure(loadError), "请检查连接后重试。"),
      );
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
      setError(
        tmuxFailure(loadError, formatTmuxLoadFailure(loadError), "请检查连接后重试。"),
      );
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
      setError(tmuxNotice("请输入会话名称。"));
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
      setError(
        tmuxFailure(createError, formatTmuxActionFailure("创建会话", createError)),
      );
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
      setError(tmuxNotice("请输入会话名称。"));
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
      setError(
        tmuxFailure(
          renameError,
          formatTmuxActionFailure("重命名会话", renameError),
        ),
      );
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
      setError(
        tmuxFailure(killError, formatTmuxActionFailure("结束会话", killError)),
      );
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
      setError(tmuxNotice("请先聚焦左侧终端，再连接 tmux 会话。"));
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
          tmuxNotice(
            result.reason === "missing-session"
              ? "连接失败：当前终端还没准备好。"
              : "连接失败：没有可发送的命令。",
          ),
        );
        return;
      }
      setError(null);
    } catch (attachError: unknown) {
      setError(
        tmuxFailure(
          attachError,
          formatTmuxActionFailure("连接会话", attachError),
        ),
      );
    } finally {
      setBusyAction(null);
    }
  };

  const detachCurrent = async () => {
    if (!focusedPane?.id) {
      setError(tmuxNotice("请先聚焦左侧终端。"));
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
            tmuxNotice(
              result.reason === "missing-session"
                ? "退出失败：当前终端还没准备好。"
                : "退出失败：退出命令为空。",
            ),
          );
          return;
        }
        setError(null);
        return;
      }
      setError(null);
      await loadSessions();
    } catch (detachError: unknown) {
      setError(
        tmuxFailure(
          detachError,
          formatTmuxActionFailure("退出 tmux", detachError),
        ),
      );
    } finally {
      setBusyAction(null);
    }
  };

  const copyQuickrefItem = async (item: TmuxQuickrefItem) => {
    try {
      const result = await writeDesktopClipboardText(tmuxQuickrefDisplay(item));
      if (!result.ok) {
        setError(tmuxNotice("复制失败：当前环境没有剪贴板权限。"));
        return;
      }
      setError(null);
    } catch (copyError: unknown) {
      setError(
        tmuxFailure(copyError, formatTmuxActionFailure("复制", copyError)),
      );
    }
  };

  const sendQuickrefItem = async (item: TmuxQuickrefItem) => {
    if (!focusedPane?.id) {
      setError(tmuxNotice("请先聚焦左侧终端。"));
      return;
    }
    setBusyAction(`send:${tmuxQuickrefDisplay(item)}`);
    try {
      if (item.kind === "shortcut") {
        const shortcutSent = await writeTmuxShortcut(focusedPane.id, item.data);
        if (!shortcutSent) {
          setError(tmuxNotice("发送失败：当前终端还没准备好。"));
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
          tmuxNotice(
            result.reason === "missing-session"
              ? "发送失败：当前终端还没准备好。"
              : "发送失败：命令为空。",
          ),
        );
        return;
      }
      setError(null);
    } catch (sendError: unknown) {
      setError(
        tmuxFailure(
          sendError,
          formatTmuxActionFailure("发送命令", sendError),
        ),
      );
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
        <UserFacingNotice compact message={error} />
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
    ? formatTmuxTargetReason(targetResolution.reason)
    : loading
      ? "正在检测 tmux..."
      : capability?.available
        ? (capability.version ?? "tmux 可用")
        : formatTmuxCapabilityReason(capability?.reason);

  return (
    <div className="kerminal-solid-surface rounded-2xl border p-3">
      <div className="flex items-center gap-2">
        <div className="kerminal-muted-surface grid h-8 w-8 shrink-0 place-items-center rounded-xl border text-zinc-700 dark:text-zinc-100">
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
            {ready ? targetResolution.targetLabel : "未选择目标"}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <TmuxIconButton
            disabled={!ready || loading}
            disabledReason={!ready ? "没有可用目标" : loading ? "正在刷新" : undefined}
            icon={RefreshCw}
            iconClassName={cn("h-4 w-4", loading && "animate-spin")}
            label="刷新"
            onClick={onRefresh}
          />
          <TmuxIconButton
            disabled={!available || loading}
            disabledReason={
              !available ? "目标没有安装 tmux" : loading ? "正在刷新" : undefined
            }
            icon={Plus}
            iconClassName="h-4 w-4"
            label="新建会话"
            onClick={onCreate}
          />
          <TmuxIconButton
            disabled={Boolean(detachDisabledReason)}
            disabledReason={detachDisabledReason}
            icon={LogOut}
            iconClassName="h-4 w-4"
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
  const [expandedSessionIds, setExpandedSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleSessionDetails = (sessionId: string) => {
    setExpandedSessionIds((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  };

  if (targetResolution.status !== "ready") {
    return (
      <TmuxEmptyState
        title="目标不可用"
        body={formatTmuxTargetReason(targetResolution.reason)}
      />
    );
  }
  if (loading) {
    return <TmuxEmptyState title="正在读取会话" body="正在检测 tmux 能力与会话。" />;
  }
  if (capability && !capability.available) {
    return (
      <TmuxEmptyState
        title="tmux 不可用"
        body={formatTmuxCapabilityReason(capability.reason)}
      />
    );
  }
  if (sessions.length === 0) {
    return <TmuxEmptyState title="暂无会话" body="新建一个会话即可开始。" />;
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
        const detailsOpen = expandedSessionIds.has(session.id);
        return (
          <article
            className="group border-b border-[var(--border-subtle)] px-2.5 py-2 first:rounded-t-2xl last:rounded-b-2xl last:border-b-0 hover:bg-[var(--surface-hover)]"
            key={session.id}
          >
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
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
                </div>
                <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                  <span className="shrink-0">
                    {tmuxStatusLabel(session, current)}
                  </span>
                  <span className="truncate">
                    {session.windows} 个窗口 · {session.clients} 个客户端
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <TmuxIconButton
                  icon={ChevronDown}
                  iconClassName={cn(
                    "h-3.5 w-3.5 transition-transform",
                    detailsOpen && "rotate-180",
                  )}
                  label={`${detailsOpen ? "收起" : "展开"} ${session.name || session.id} 详情`}
                  onClick={() => toggleSessionDetails(session.id)}
                />
                <TmuxIconButton
                  disabled={Boolean(attachDisabled)}
                  disabledReason={attachDisabled}
                  icon={Link2}
                  label="连接"
                  onClick={() => onAttach(session)}
                />
                <TmuxIconButton
                  disabled={Boolean(disabledReason)}
                  disabledReason={disabledReason}
                  icon={Pencil}
                  label="重命名"
                  onClick={() => onRename(session)}
                />
                <TmuxIconButton
                  disabled={Boolean(disabledReason)}
                  disabledReason={disabledReason}
                  icon={Trash2}
                  label="删除"
                  onClick={() => onKill(session)}
                  tone="danger"
                />
              </div>
            </div>
            {detailsOpen ? (
              <div className="kerminal-muted-surface mt-2 grid gap-2 rounded-xl border px-3 py-2 text-[11px] min-[520px]:grid-cols-2">
                <TmuxSessionDetail label="会话 ID" value={session.id} />
                <TmuxSessionDetail
                  label="当前目录"
                  value={session.currentPath ?? "~"}
                />
                <TmuxSessionDetail label="目标" value={session.targetRef} />
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function TmuxSessionDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-0.5 break-all font-mono text-zinc-800 dark:text-zinc-200">
        {value}
      </div>
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
        cancelLabel="取消"
        confirmLabel="结束会话"
        confirmVariant="danger"
        description={`将结束会话“${dialog.session.name || dialog.session.id}”。`}
        onClose={onClose}
        onConfirm={onKill}
        open
        title="结束 tmux 会话"
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          会话中的运行任务会一并停止，且无法从 Kerminal 恢复。
        </p>
      </PromptDialog>
    );
  }

  const title = dialog.kind === "create" ? "新建 tmux 会话" : "重命名 tmux 会话";
  const action = dialog.kind === "create" ? onCreate : onRename;
  return (
    <PromptDialog
      busy={busy}
      cancelLabel="取消"
      confirmDisabled={!dialog.name.trim()}
      confirmLabel={dialog.kind === "create" ? "创建" : "保存"}
      inputLabel="会话名称"
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
