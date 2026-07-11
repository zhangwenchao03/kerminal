import {
  Ban,
  FolderOpen,
  Power,
  Route,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import { cn } from "../../../lib/cn";
import {
  externalLaunchSourceTools,
  type ExternalLaunchSettings,
  type ExternalLaunchSourceTool,
} from "../settingsModel";
import {
  PolicyToggle,
  SettingsDisclosure,
} from "./shared-controls";

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

export function ExternalLaunchSettingsSection({
  externalLaunch,
  revealCompatibility = false,
  updateExternalLaunch,
}: {
  externalLaunch: ExternalLaunchSettings;
  revealCompatibility?: boolean;
  updateExternalLaunch: (settings: Partial<ExternalLaunchSettings>) => void;
}) {
  const disabledToolSet = new Set(externalLaunch.disabledTools);
  const disabledToolCount = externalLaunch.disabledTools.length;
  const setToolEnabled = (tool: ExternalLaunchSourceTool, enabled: boolean) => {
    updateExternalLaunch({
      disabledTools: enabled
        ? externalLaunch.disabledTools.filter((item) => item !== tool)
        : [...externalLaunch.disabledTools, tool],
    });
  };

  return (
    <section
      className="kerminal-solid-surface rounded-2xl border p-5"
      id="settings-external-launch-panel"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
        <Route className="h-4 w-4 text-sky-500 dark:text-sky-300" />
        外部 SSH 启动
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-100">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        外部传入的密码和私钥口令仅用于当前会话，不写入连接配置。
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
          checked={externalLaunch.autoOpenSftp}
          icon={FolderOpen}
          label="连接后自动打开 SFTP"
          onChange={(autoOpenSftp) => updateExternalLaunch({ autoOpenSftp })}
        />
      </section>

      <div className="mt-4">
        <SettingsDisclosure
          reveal={revealCompatibility}
          summary={`${externalLaunchSourceTools.length - disabledToolCount} 个来源`}
          targetId="settings-external-launch-compatibility"
          title="兼容性详情"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
            <Ban className="h-4 w-4 text-zinc-400" />
            允许来源
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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

          <div className="mt-5 flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
            <Terminal className="h-4 w-4 text-zinc-400" />
            命令模板
          </div>
          <div className="mt-3 grid gap-3">
            {launchExamples.map((example) => (
              <LaunchExample key={example.label} {...example} />
            ))}
          </div>
        </SettingsDisclosure>
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
