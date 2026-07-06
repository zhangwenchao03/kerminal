import {
  AlertTriangle,
  Ban,
  FolderOpen,
  KeyRound,
  Network,
  Power,
  RefreshCcw,
  Route,
  ShieldAlert,
  Terminal,
  Trash2,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "../../../lib/cn";
import {
  deleteExternalLaunchAliases,
  externalLaunchAliasTools,
  generateExternalLaunchAliases,
  getExternalLaunchAliasStatus,
  openExternalLaunchAliasDirectory,
  type ExternalLaunchAliasInspection,
  type ExternalLaunchAliasState,
  type ExternalLaunchAliasStatus,
  type ExternalLaunchAliasTool,
} from "../../../lib/externalLaunchApi";
import {
  externalLaunchSourceTools,
  type ExternalLaunchSettings,
  type ExternalLaunchSourceTool,
} from "../settingsModel";
import { PolicyToggle, SettingsMetricItem } from "./shared-controls";

const launchExamples = [
  {
    command:
      'putty.exe -ssh ${USER}@${HOST} -P ${PORT} -pw "<PASSWORD_FROM_PLATFORM>"',
    label: "PuTTY",
  },
  {
    command: 'MobaXterm.exe -newtab "ssh -p ${PORT} ${USER}@${HOST}"',
    label: "MobaXterm",
  },
  {
    command:
      'Xshell.exe -url "ssh://${USER}:<PASSWORD_FROM_PLATFORM>@${HOST}:${PORT}"',
    label: "Xshell",
  },
  {
    command:
      'SecureCRT.exe /SSH2 /L ${USER} /P ${PORT} /PASSWORD "<PASSWORD_FROM_PLATFORM>" ${HOST}',
    label: "SecureCRT",
  },
  {
    command: "ssh -p ${PORT} -l ${USER} ${HOST}",
    label: "OpenSSH",
  },
  {
    command:
      "kerminal.exe --external-ssh --host ${HOST} --port ${PORT} --user ${USER}",
    label: "Kerminal flags",
  },
  {
    command:
      'kerminal.exe --external-ssh-json {"host":"${HOST}","port":${PORT},"username":"${USER}"}',
    label: "Kerminal JSON",
  },
  {
    command:
      "kerminal://ssh?host=${HOST}&port=${PORT}&user=${USER}&openSftp=true",
    label: "Kerminal URL",
  },
];

const launchToolLabels: Record<
  ExternalLaunchSourceTool,
  { description: string; label: string }
> = {
  putty: {
    description: "PuTTY / Plink 参数 persona。",
    label: "PuTTY",
  },
  mobaxterm: {
    description: "MobaXterm newtab / exec 参数。",
    label: "MobaXterm",
  },
  xshell: {
    description: "Xshell ssh:// URL 或 b64 参数。",
    label: "Xshell",
  },
  securecrt: {
    description: "SecureCRT /SSH2 参数。",
    label: "SecureCRT",
  },
  openssh: {
    description: "OpenSSH ssh 命令参数。",
    label: "OpenSSH",
  },
  "kerminal-native": {
    description: "Kerminal flags / JSON / URL。",
    label: "Kerminal native",
  },
};

const aliasStateLabels: Record<ExternalLaunchAliasState, string> = {
  blockedNonKerminal: "被占用",
  managed: "已生成",
  missing: "未生成",
  staleMarker: "需处理",
};

const aliasStateDescriptions: Record<ExternalLaunchAliasState, string> = {
  blockedNonKerminal: "目标文件不是 Kerminal 管理的兼容启动器。",
  managed: "由 Kerminal 管理，可直接配置到跳板平台。",
  missing: "当前目录还没有这个兼容启动器。",
  staleMarker: "标记文件存在，但目标文件已被替换。",
};

type AliasAction = "delete" | "generate" | "open" | "refresh";

export function ExternalLaunchSettingsSection({
  externalLaunch,
  updateExternalLaunch,
}: {
	  externalLaunch: ExternalLaunchSettings;
	  updateExternalLaunch: (settings: Partial<ExternalLaunchSettings>) => void;
	}) {
  const [aliasStatus, setAliasStatus] =
    useState<ExternalLaunchAliasStatus | null>(null);
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [aliasMessage, setAliasMessage] = useState<string | null>(null);
  const [aliasAction, setAliasAction] = useState<AliasAction | null>(null);
  const disabledToolSet = new Set(externalLaunch.disabledTools);
  const disabledToolCount = externalLaunch.disabledTools.length;
  const managedAliasCount = useMemo(
    () =>
      aliasStatus?.aliases.filter((alias) => alias.state === "managed").length ??
      0,
    [aliasStatus],
  );
  const setToolEnabled = (tool: ExternalLaunchSourceTool, enabled: boolean) => {
    updateExternalLaunch({
      disabledTools: enabled
        ? externalLaunch.disabledTools.filter((item) => item !== tool)
        : [...externalLaunch.disabledTools, tool],
    });
  };
  const loadAliasStatus = useCallback(async () => {
    setAliasAction("refresh");
    setAliasError(null);
    try {
      setAliasStatus(await getExternalLaunchAliasStatus());
    } catch (nextError) {
      setAliasError(formatAliasError(nextError));
    } finally {
      setAliasAction(null);
    }
  }, []);

  useEffect(() => {
    void loadAliasStatus();
  }, [loadAliasStatus]);

  const runAliasAction = async (
    action: AliasAction,
    operation: () => Promise<string>,
  ) => {
    setAliasAction(action);
    setAliasError(null);
    setAliasMessage(null);
    try {
      const message = await operation();
      setAliasMessage(message);
    } catch (nextError) {
      setAliasError(formatAliasError(nextError));
    } finally {
      setAliasAction(null);
    }
  };
  const generateAliases = (tools: ExternalLaunchAliasTool[]) => {
    void runAliasAction("generate", async () => {
      const generated = await generateExternalLaunchAliases({ tools });
      await loadAliasStatus();
      return `${generated.length} 个兼容启动器已生成`;
    });
  };
  const deleteManagedAliases = (tools?: ExternalLaunchAliasTool[]) => {
    const selectedTools =
      tools ??
      aliasStatus?.aliases
        .filter((alias) => alias.state === "managed")
        .map((alias) => alias.tool) ??
      [];
    void runAliasAction("delete", async () => {
      const removed = await deleteExternalLaunchAliases({ tools: selectedTools });
      await loadAliasStatus();
      return `${removed.filter((item) => item.removedAlias).length} 个兼容启动器已删除`;
    });
  };
  const openAliasDirectory = () => {
    void runAliasAction("open", async () => {
      const openedPath = await openExternalLaunchAliasDirectory(
        aliasStatus?.aliasDirectory,
      );
      return `已打开 ${openedPath}`;
    });
  };

  return (
    <section
      className="kerminal-solid-surface rounded-2xl border p-5"
      id="settings-external-launch-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            <Route className="h-4 w-4 text-sky-500 dark:text-sky-300" />
            外部 SSH 启动
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            跳板机传入的主机和认证材料会进入临时会话；密码只保留为本次会话 secret。
          </p>
        </div>
        <span className="kerminal-muted-surface rounded-full border px-3 py-1 text-xs text-zinc-500 dark:text-zinc-400">
          PuTTY / MobaXterm / Xshell / SecureCRT
        </span>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <SettingsMetricItem
          description="主程序、single-instance 和 shim IPC 使用同一 intake。"
          icon={Terminal}
          label="入口"
          value={externalLaunch.enabled ? "已启用" : "已关闭"}
        />
        <SettingsMetricItem
          description="Windows named pipe，macOS/Linux 预留 Unix socket。"
          icon={Network}
          label="Shim bridge"
          value={externalLaunch.shimBridge.enabled ? "可用" : "已关闭"}
        />
        <SettingsMetricItem
          description="password、URL password 和 key passphrase 不落盘。"
          icon={ShieldAlert}
          label="凭据"
          value={
            disabledToolCount > 0 ? `${disabledToolCount} 个工具已禁用` : "会话级"
          }
        />
      </div>

      <section className="mt-4 grid gap-3 lg:grid-cols-2">
        <PolicyToggle
          checked={externalLaunch.enabled}
          icon={Power}
          label="启用外部 SSH 启动"
          onChange={(enabled) => updateExternalLaunch({ enabled })}
        />
        <PolicyToggle
          checked={externalLaunch.acceptVendorArgs}
          icon={Terminal}
          label="接受常见终端参数"
          onChange={(acceptVendorArgs) =>
            updateExternalLaunch({ acceptVendorArgs })
          }
        />
        <PolicyToggle
          checked={externalLaunch.shimBridge.enabled}
          icon={Network}
          label="启用本地 shim bridge"
          onChange={(enabled) =>
            updateExternalLaunch({ shimBridge: { enabled } })
          }
        />
        <PolicyToggle
          checked={externalLaunch.autoOpenSftp}
          icon={FolderOpen}
          label="连接后自动打开 SFTP"
          onChange={(autoOpenSftp) => updateExternalLaunch({ autoOpenSftp })}
        />
      </section>

      <section className="kerminal-muted-surface mt-4 rounded-xl border p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
          <Ban className="h-4 w-4 text-zinc-400" />
          Parser / persona 启用
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {externalLaunchSourceTools.map((tool) => {
            const metadata = launchToolLabels[tool];
            const enabled = !disabledToolSet.has(tool);
            return (
              <button
                aria-checked={enabled}
                aria-label={`允许 ${metadata.label}`}
                className={cn(
                  "kerminal-focus-ring kerminal-pressable flex min-h-20 flex-col items-start rounded-xl border px-3 py-3 text-left transition-[background-color,border-color,box-shadow,transform,filter]",
                  enabled
                    ? "border-sky-400/35 bg-[var(--surface-selected)] text-zinc-950 shadow-sm shadow-sky-950/5 ring-1 ring-sky-500/15 hover:brightness-105 dark:border-sky-300/25 dark:text-zinc-100 dark:ring-sky-300/15"
                    : "kerminal-solid-surface text-zinc-700 hover:bg-[var(--surface-hover)] dark:text-zinc-300",
                )}
                data-state={enabled ? "checked" : "unchecked"}
                key={tool}
                onClick={() => setToolEnabled(tool, !enabled)}
                role="switch"
                type="button"
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {metadata.label}
                  </span>
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none transition-colors",
                      enabled
                        ? "border-sky-400/35 bg-[rgb(var(--app-accent)/0.15)] text-sky-700 dark:text-sky-100"
                        : "border-[var(--border-subtle)] bg-[var(--surface-muted)] text-zinc-500 dark:text-zinc-400",
                    )}
                  >
                    {enabled ? "允许" : "禁用"}
                  </span>
                </span>
                <span className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                  {metadata.description}
                </span>
              </button>
            );
          })}
        </div>
	      </section>

      <section className="kerminal-muted-surface mt-4 rounded-xl border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
              <Wand2 className="h-4 w-4 text-zinc-400" />
              兼容启动器
            </div>
            <div className="mt-2 grid gap-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              <PathLine label="主程序" value={aliasStatus?.kerminalExecutable} />
              <PathLine label="Shim" value={aliasStatus?.shimExecutable} />
              <PathLine label="目录" value={aliasStatus?.aliasDirectory} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              className="kerminal-focus-ring kerminal-pressable inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-2.5 text-xs font-medium text-zinc-700 hover:bg-[var(--surface-hover)] dark:text-zinc-200"
              disabled={aliasAction !== null}
              onClick={() => void loadAliasStatus()}
              type="button"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              刷新
            </button>
            <button
              className="kerminal-focus-ring kerminal-pressable inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-2.5 text-xs font-medium text-zinc-700 hover:bg-[var(--surface-hover)] dark:text-zinc-200"
              disabled={!aliasStatus || aliasAction !== null}
              onClick={openAliasDirectory}
              type="button"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              打开目录
            </button>
            <button
              className="kerminal-focus-ring kerminal-pressable inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-600 px-2.5 text-xs font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-sky-500 dark:hover:bg-sky-400"
              disabled={!aliasStatus?.shimAvailable || aliasAction !== null}
              onClick={() => generateAliases(externalLaunchAliasTools)}
              type="button"
            >
              <Wand2 className="h-3.5 w-3.5" />
              生成全部
            </button>
            <button
              className="kerminal-focus-ring kerminal-pressable inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-300/40 px-2.5 text-xs font-medium text-rose-700 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-200"
              disabled={managedAliasCount === 0 || aliasAction !== null}
              onClick={() => deleteManagedAliases()}
              type="button"
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除已管理
            </button>
          </div>
        </div>

        {!aliasStatus?.shimAvailable ? (
          <div className="mt-3 flex gap-2 rounded-lg border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>安装目录中暂未检测到 kerminal-launch-shim。</span>
          </div>
        ) : null}

        {aliasError ? (
          <p className="mt-3 text-xs leading-5 text-rose-600 dark:text-rose-300" role="alert">
            {aliasError}
          </p>
        ) : null}
        {aliasMessage ? (
          <p className="mt-3 text-xs leading-5 text-emerald-700 dark:text-emerald-300" role="status">
            {aliasMessage}
          </p>
        ) : null}

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(aliasStatus?.aliases ?? previewAliasInspections()).map((alias) => (
            <AliasCard
              alias={alias}
              disabled={aliasAction !== null || !aliasStatus?.shimAvailable}
              key={alias.tool}
              onDelete={() => deleteManagedAliases([alias.tool])}
              onGenerate={() => generateAliases([alias.tool])}
            />
          ))}
        </div>
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="kerminal-muted-surface min-w-0 rounded-xl border p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
            <KeyRound className="h-4 w-4 text-zinc-400" />
            原生入口
          </div>
          <div className="mt-4 space-y-3">
            {launchExamples.slice(5).map((example) => (
              <LaunchExample key={example.label} {...example} />
            ))}
          </div>
        </section>

        <section className="kerminal-muted-surface min-w-0 rounded-xl border p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
            <Terminal className="h-4 w-4 text-zinc-400" />
            兼容模板
          </div>
          <div className="mt-4 grid gap-3">
            {launchExamples.slice(0, 5).map((example) => (
              <LaunchExample key={example.label} {...example} />
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

function LaunchExample({
  command,
  label,
}: {
  command: string;
  label: string;
}) {
  return (
    <div className="grid min-w-0 gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-start">
      <div className="text-xs font-medium leading-5 text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <code className="block min-w-0 whitespace-pre-wrap break-all rounded-lg bg-[var(--surface-muted)] px-2 py-2 font-mono text-xs leading-5 text-zinc-800 dark:text-zinc-100">
        {command}
      </code>
    </div>
  );
}

function PathLine({ label, value }: { label: string; value?: string }) {
  return (
    <div className="grid min-w-0 gap-1 sm:grid-cols-[4rem_minmax(0,1fr)]">
      <span className="font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      <code className="min-w-0 break-all rounded-md bg-[var(--surface-muted)] px-2 py-1 font-mono text-[11px] text-zinc-700 dark:text-zinc-100">
        {value ?? "检测中"}
      </code>
    </div>
  );
}

function AliasCard({
  alias,
  disabled,
  onDelete,
  onGenerate,
}: {
  alias: ExternalLaunchAliasInspection;
  disabled: boolean;
  onDelete: () => void;
  onGenerate: () => void;
}) {
  const metadata = launchToolLabels[alias.tool];
  const canDelete = alias.state === "managed" && !disabled;
  const canGenerate =
    (alias.state === "missing" || alias.state === "managed") && !disabled;

  return (
    <div className="kerminal-solid-surface grid min-h-36 min-w-0 gap-3 rounded-xl border p-3">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {metadata.label}
          </div>
          <div className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            {aliasStateDescriptions[alias.state]}
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-1 text-[11px] font-medium leading-none",
            alias.state === "managed"
              ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
              : alias.state === "missing"
                ? "border-[var(--border-subtle)] bg-[var(--surface-muted)] text-zinc-500 dark:text-zinc-400"
                : "border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-200",
          )}
        >
          {aliasStateLabels[alias.state]}
        </span>
      </div>

      <code className="block min-w-0 break-all rounded-lg bg-[var(--surface-muted)] px-2 py-2 font-mono text-[11px] leading-5 text-zinc-700 dark:text-zinc-100">
        {alias.aliasPath}
      </code>

      <div className="flex flex-wrap items-center gap-2">
        <button
          aria-label={`生成 ${metadata.label} 兼容启动器`}
          className="kerminal-focus-ring kerminal-pressable inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-2.5 text-xs font-medium text-zinc-700 hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-200"
          disabled={!canGenerate}
          onClick={onGenerate}
          type="button"
        >
          <Wand2 className="h-3.5 w-3.5" />
          生成
        </button>
        <button
          aria-label={`删除 ${metadata.label} 兼容启动器`}
          className="kerminal-focus-ring kerminal-pressable inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-300/40 px-2.5 text-xs font-medium text-rose-700 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-200"
          disabled={!canDelete}
          onClick={onDelete}
          type="button"
        >
          <Trash2 className="h-3.5 w-3.5" />
          删除
        </button>
      </div>
    </div>
  );
}

function previewAliasInspections(): ExternalLaunchAliasInspection[] {
  return externalLaunchAliasTools.map((tool) => ({
    aliasPath: "",
    markerPath: "",
    markerPresent: false,
    state: "missing",
    tool,
  }));
}

function formatAliasError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
