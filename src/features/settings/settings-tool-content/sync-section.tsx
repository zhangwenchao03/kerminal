import {
  AlertCircle,
  CheckCircle2,
  FileKey2,
  GitBranch,
  RefreshCw,
  Save,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { UserFacingNotice } from "../../../components/ui/user-facing-notice";
import { cn } from "../../../lib/cn";
import {
  buildUserFacingError,
  type UserFacingMessage,
  type UserFacingMessageSeverity,
} from "../../../lib/userFacingMessage";
import {
  getWorkspaceSyncStatus,
  readVaultKeyContent,
  runWorkspaceSync,
  saveVaultKeyContent,
  type WorkspaceSyncRunResult,
  type WorkspaceSyncStatus,
} from "../../../lib/workspaceSyncApi";

type SyncSettingsLoadState = "idle" | "loading" | "syncing" | "saving" | "error";

export function SyncSettingsSection() {
  const [status, setStatus] = useState<WorkspaceSyncStatus | null>(null);
  const [keyToml, setKeyToml] = useState("");
  const [loadState, setLoadState] = useState<SyncSettingsLoadState>("idle");
  const [notice, setNotice] = useState<UserFacingMessage | null>(null);
  const [lastSyncResult, setLastSyncResult] =
    useState<WorkspaceSyncRunResult | null>(null);

  const viewModel = useMemo(() => buildSyncViewModel(status), [status]);
  const busy = loadState === "loading" || loadState === "syncing" || loadState === "saving";

  const loadWorkspaceSync = async () => {
    setLoadState("loading");
    setNotice(null);
    try {
      const [nextStatus, nextKeyToml] = await Promise.all([
        getWorkspaceSyncStatus(),
        readVaultKeyContent(),
      ]);
      setStatus(nextStatus);
      setKeyToml(nextKeyToml);
      setLoadState("idle");
    } catch (nextError) {
      setLoadState("error");
      setNotice(syncFailure(nextError, "读取同步设置失败"));
    }
  };

  const syncWorkspace = async () => {
    setLoadState("syncing");
    setNotice(null);
    try {
      const result = await runWorkspaceSync();
      setLastSyncResult(result);
      setStatus(await getWorkspaceSyncStatus());
      setNotice({
        severity: noticeSeverityFromSyncResult(result),
        title: result.message,
      });
      setLoadState("idle");
    } catch (nextError) {
      setLoadState("error");
      setNotice(syncFailure(nextError, "同步失败"));
    }
  };

  const saveKey = async () => {
    if (!keyToml.trim()) {
      setLoadState("error");
      setNotice({
        recoveryAction: "请输入完整的 vault-key.toml 内容后重试。",
        severity: "error",
        title: "密钥内容不能为空。",
      });
      return;
    }
    setLoadState("saving");
    setNotice(null);
    try {
      const result = await saveVaultKeyContent(keyToml);
      setStatus(await getWorkspaceSyncStatus());
      setNotice({
        severity: "success",
        title: result.backupCreated
          ? "密钥已保存，并已为旧文件创建备份。"
          : "密钥已保存。",
      });
      setLoadState("idle");
    } catch (nextError) {
      setLoadState("error");
      setNotice(syncFailure(nextError, "保存密钥失败"));
    }
  };

  useEffect(() => {
    void loadWorkspaceSync();
  }, []);

  return (
    <div className="space-y-4 text-zinc-950 dark:text-zinc-50" id="settings-sync-panel">
      <section className="kerminal-solid-surface overflow-hidden rounded-2xl border">
        <div className="border-b border-[var(--border-subtle)] px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <StatusIcon state={viewModel.gitState} />
                <h2 className="text-base font-semibold leading-6">同步</h2>
              </div>
              <p className="mt-1 max-w-2xl text-sm leading-5 text-zinc-500 dark:text-zinc-400">
                仅同步 Kerminal 工作区配置。同步会先拉取远程内容，再提交本地变更。
              </p>
            </div>

            {viewModel.canSync ? (
              <button
                className="kerminal-focus-ring kerminal-pressable inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl bg-sky-600 px-3.5 text-sm font-semibold text-white shadow-sm shadow-sky-600/15 transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-sky-500 dark:hover:bg-sky-400"
                disabled={busy}
                onClick={() => void syncWorkspace()}
                type="button"
              >
                <RefreshCw
                  className={cn("h-4 w-4", loadState === "syncing" ? "animate-spin" : "")}
                />
                {loadState === "syncing" ? "同步中..." : "同步"}
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <InfoRow
            icon={GitBranch}
            label="Git 状态"
            tone={viewModel.gitState}
            value={viewModel.gitLabel}
          />
          <InfoRow
            icon={FileKey2}
            label="工作区"
            tone="muted"
            value={viewModel.workspaceRoot}
          />
        </div>

        {lastSyncResult?.commitHash ? (
          <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-muted)]/45 px-5 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
            最近提交：<span className="font-mono">{lastSyncResult.commitHash}</span>
          </div>
        ) : null}
      </section>

      <section className="kerminal-solid-surface overflow-hidden rounded-2xl border">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileKey2 className="h-4 w-4 text-sky-600 dark:text-sky-300" />
              <h3 className="text-sm font-semibold leading-5">密钥文件</h3>
            </div>
            <p
              className="mt-1 select-text truncate font-mono text-xs text-zinc-500 dark:text-zinc-400"
              title={viewModel.keyPath}
            >
              {viewModel.keyPath}
            </p>
          </div>

          <button
            className="kerminal-focus-ring kerminal-pressable inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-field)] px-3.5 text-sm font-semibold text-zinc-700 transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-100"
            disabled={busy}
            onClick={() => void saveKey()}
            type="button"
          >
            <Save className="h-4 w-4" />
            {loadState === "saving" ? "保存中..." : "保存"}
          </button>
        </div>

        <div className="space-y-3 p-4">
          <textarea
            aria-label="密钥文件内容"
            className="kerminal-focus-ring min-h-64 w-full resize-y rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-field)] p-4 font-mono text-xs leading-5 text-zinc-800 outline-none shadow-inner shadow-black/[0.02] placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            disabled={loadState === "loading"}
            onChange={(event) => setKeyToml(event.currentTarget.value)}
            placeholder="schema_version = 1"
            spellCheck={false}
            value={keyToml}
          />
          <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            保存时会校验 TOML 格式、密钥格式，并确认它能解密当前保险箱；校验失败不会写入文件。
          </p>
        </div>
      </section>

      {notice ? <UserFacingNotice message={notice} /> : null}
    </div>
  );
}

function buildSyncViewModel(status: WorkspaceSyncStatus | null) {
  const gitState: StatusTone = !status
    ? "muted"
    : !status.git.available
      ? "error"
      : status.git.repositoryInitialized
        ? "success"
        : "warning";

  return {
    canSync: Boolean(status?.git.available && status.git.repositoryInitialized),
    gitLabel: !status
      ? "检查中"
      : !status.git.available
        ? "Git 不可用"
        : status.git.repositoryInitialized
          ? "已初始化"
          : "未初始化",
    gitState,
    keyPath: status?.vault.vaultKeyPath ?? "secrets/vault-key.toml",
    workspaceRoot: status?.workspaceRoot ?? "~/.kerminal",
  };
}

type StatusTone = "success" | "warning" | "error" | "muted";

function StatusIcon({ state }: { state: StatusTone }) {
  const Icon = state === "success" ? CheckCircle2 : state === "error" ? ShieldAlert : AlertCircle;
  return (
    <span
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-xl",
        toneClassName(state, "background"),
      )}
    >
      <Icon className={cn("h-4 w-4", toneClassName(state, "text"))} />
    </span>
  );
}

function InfoRow({
  icon: Icon,
  label,
  tone,
  value,
}: {
  icon: LucideIcon;
  label: string;
  tone: StatusTone;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-t border-[var(--border-subtle)] px-5 py-3.5 md:border-r md:last:border-r-0">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-muted)] text-zinc-500 dark:text-zinc-400">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
        <div className={cn("mt-0.5 truncate text-sm font-semibold", toneClassName(tone, "text"))}>
          {value}
        </div>
      </div>
    </div>
  );
}

function noticeSeverityFromSyncResult(
  result: WorkspaceSyncRunResult,
): UserFacingMessageSeverity {
  if (result.status === "success") {
    return "success";
  }
  if (result.status === "warning") {
    return "warning";
  }
  return "error";
}

function syncFailure(error: unknown, fallback: string): UserFacingMessage {
  return buildUserFacingError(error, {
    recoveryAction: "请检查同步配置后重试。",
    title: syncErrorTitle(error, fallback),
  });
}

function syncErrorTitle(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("vault key TOML parse failed") || message.includes("vault TOML parse failed")) {
    return "密钥 TOML 格式不正确，请检查后再保存。";
  }
  if (message.includes("vault decryption failed")) {
    return "密钥无法解密当前保险箱，请确认粘贴的是同一工作区的密钥。";
  }
  if (message.includes("vault key base64 invalid")) {
    return "密钥 master_key 不是有效的 Base64。";
  }
  if (message.includes("vault key must be")) {
    return "密钥 master_key 长度不正确。";
  }
  return fallback;
}

function toneClassName(tone: StatusTone, part: "background" | "text") {
  if (part === "background") {
    return tone === "success"
      ? "bg-emerald-500/10"
      : tone === "warning"
        ? "bg-amber-500/10"
        : tone === "error"
          ? "bg-rose-500/10"
          : "bg-[var(--surface-muted)]";
  }
  return tone === "success"
    ? "text-emerald-600 dark:text-emerald-300"
    : tone === "warning"
      ? "text-amber-600 dark:text-amber-300"
      : tone === "error"
        ? "text-rose-600 dark:text-rose-300"
        : "text-zinc-600 dark:text-zinc-300";
}
