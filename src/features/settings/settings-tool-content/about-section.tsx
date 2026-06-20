import { useState } from "react";
import {
  Download,
  ExternalLink,
  GitBranch,
  Hash,
  Info,
  RefreshCw,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import packageJson from "../../../../package.json";
import {
  checkForAppUpdate,
  installPendingAppUpdate,
  type AppUpdateCheckResult,
  type AppUpdateProgress,
} from "../../../lib/updaterApi";

const githubRepositoryUrl = "https://github.com/kongweiguang/kerminal";
const githubReleasesUrl = `${githubRepositoryUrl}/releases`;
const appVersion = `v${packageJson.version}`;
type UpdateCheckState =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "unavailable"
  | "installing"
  | "error";

export function AboutSettingsSection() {
  const [checkState, setCheckState] = useState<UpdateCheckState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<AppUpdateProgress | null>(null);
  const [updateResult, setUpdateResult] = useState<AppUpdateCheckResult | null>(
    null,
  );
  const checking = checkState === "checking";
  const installing = checkState === "installing";
  const canInstall =
    checkState === "available" && updateResult?.kind === "available";

  const handleCheck = async () => {
    setCheckState("checking");
    setError(null);
    setProgress(null);
    try {
      const result = await checkForAppUpdate();
      setUpdateResult(result);
      setCheckState(result.kind);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      setCheckState("error");
    }
  };

  const handleInstall = async () => {
    setCheckState("installing");
    setError(null);
    try {
      await installPendingAppUpdate(setProgress);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      setCheckState("error");
    }
  };

  return (
          <section
            className="rounded-2xl border border-black/8 bg-white/80 p-5 shadow-sm shadow-black/5 dark:border-white/8 dark:bg-white/6 dark:shadow-black/20"
            id="settings-about-panel"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                  <Info className="h-4 w-4 text-sky-500 dark:text-sky-300" />
                  关于 Kerminal
                </div>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                  Kerminal
                  是面向开发者的多平台终端工作台，整合本地终端、SSH/SFTP、服务器信息和
                  AI Agent。
                </p>
              </div>
              <span className="rounded-full border border-sky-400/25 bg-sky-400/10 px-3 py-1 text-xs font-medium text-sky-700 dark:text-sky-100">
                版本 {appVersion}
              </span>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <section className="rounded-xl border border-black/8 bg-black/[0.025] p-4 dark:border-white/8 dark:bg-black/20">
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  <Info className="h-4 w-4 text-zinc-400" />
                  产品信息
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  <AboutInfoItem
                    description="与 package.json 和 Tauri 配置保持一致。"
                    icon={Hash}
                    label="当前版本"
                    value={appVersion}
                  />
                  <AboutInfoItem
                    description="发布包和更新说明会集中在 GitHub Releases。"
                    icon={RotateCcw}
                    label="更新渠道"
                    value="GitHub Releases"
                  />
                </div>
              </section>

              <div className="space-y-4">
                <section className="rounded-xl border border-black/8 bg-black/[0.025] p-4 dark:border-white/8 dark:bg-black/20">
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    <RotateCcw className="h-4 w-4 text-zinc-400" />
                    更新
                  </div>
                  <div className="mt-3 rounded-xl border border-black/8 bg-white/70 p-3 text-sm leading-6 text-zinc-600 dark:border-white/8 dark:bg-white/6 dark:text-zinc-300">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span>自动更新</span>
                      <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-100">
                        {updateStateLabel(checkState)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                      {updateStatusText(checkState, updateResult, progress)}
                    </p>
                    {error ? (
                      <p className="mt-2 rounded-lg border border-rose-300/25 bg-rose-500/10 px-2 py-1 text-xs leading-5 text-rose-700 dark:text-rose-100">
                        {error}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-black/10 bg-white/80 px-3 text-xs font-medium text-zinc-700 transition hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/8 dark:text-zinc-200 dark:hover:bg-white/12"
                        disabled={checking || installing}
                        onClick={() => void handleCheck()}
                        type="button"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        {checking ? "检查中" : "检查更新"}
                      </button>
                      {canInstall ? (
                        <button
                          className="inline-flex h-9 items-center gap-2 rounded-lg border border-sky-400/25 bg-sky-500/12 px-3 text-xs font-medium text-sky-700 transition hover:bg-sky-500/18 disabled:cursor-not-allowed disabled:opacity-60 dark:text-sky-100"
                          disabled={installing}
                          onClick={() => void handleInstall()}
                          type="button"
                        >
                          <Download className="h-3.5 w-3.5" />
                          下载并安装
                        </button>
                      ) : null}
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border border-black/8 bg-black/[0.025] p-4 dark:border-white/8 dark:bg-black/20">
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    <GitBranch className="h-4 w-4 text-zinc-400" />
                    项目链接
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <AboutLinkCard href={githubRepositoryUrl} icon={GitBranch}>
                      github.com/kongweiguang/kerminal
                    </AboutLinkCard>
                    <AboutLinkCard href={githubReleasesUrl} icon={RotateCcw}>
                      查看更新发布
                    </AboutLinkCard>
                  </div>
                </section>
              </div>
            </div>
          </section>
  );
}

function updateStateLabel(state: UpdateCheckState) {
  if (state === "checking") {
    return "检查中";
  }
  if (state === "available") {
    return "可更新";
  }
  if (state === "up-to-date") {
    return "已是最新";
  }
  if (state === "unavailable") {
    return "不可用";
  }
  if (state === "installing") {
    return "安装中";
  }
  if (state === "error") {
    return "检查失败";
  }
  return "已启用";
}

function updateStatusText(
  state: UpdateCheckState,
  result: AppUpdateCheckResult | null,
  progress: AppUpdateProgress | null,
) {
  if (state === "available" && result?.kind === "available") {
    return `发现 ${versionLabel(result.version)}，当前版本 ${versionLabel(
      result.currentVersion,
    )}。`;
  }

  if (state === "up-to-date") {
    return "已是最新版本。";
  }

  if (state === "unavailable" && result?.kind === "unavailable") {
    return result.message;
  }

  if (state === "installing") {
    if (progress?.percent !== undefined) {
      return `正在安装更新：${progress.percent}%`;
    }
    return "正在下载并安装更新。";
  }

  if (state === "error") {
    return "更新检查失败。";
  }

  return "通过 GitHub Releases 获取签名安装包和自动更新元数据。";
}

function versionLabel(version: string) {
  return version.startsWith("v") ? version : `v${version}`;
}

function AboutInfoItem({
  description,
  icon: Icon,
  label,
  value,
}: {
  description: string;
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-black/8 bg-white/70 p-3 dark:border-white/8 dark:bg-white/6">
      <div className="flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {value}
      </div>
      <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
        {description}
      </p>
    </div>
  );
}

function AboutLinkCard({
  children,
  href,
  icon: Icon,
}: {
  children: string;
  href: string;
  icon: LucideIcon;
}) {
  return (
    <a
      className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-black/8 bg-white/70 px-3 py-3 text-sm text-zinc-700 transition hover:bg-black/[0.04] dark:border-white/8 dark:bg-white/6 dark:text-zinc-200 dark:hover:bg-white/10"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-zinc-400" />
        <span className="truncate">{children}</span>
      </span>
      <ExternalLink className="h-4 w-4 shrink-0 text-zinc-400" />
    </a>
  );
}
