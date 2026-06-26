import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  Check,
  Clipboard,
  Power,
  PowerOff,
  Server,
} from "lucide-react";
import { cn } from "../../../lib/cn";
import {
  currentDesktopNotificationVisibility,
  sendDesktopNotification,
} from "../../../lib/desktopNotificationApi";
import {
  getMcpHttpServerStatus,
  startMcpHttpServer,
  stopMcpHttpServer,
  type McpHttpServerStatus,
} from "../../../lib/mcpServerApi";
import type { DesktopNotificationSettings } from "../settingsModel";
import { writeTextToClipboard } from "./clipboard";
import type { McpHttpServerLoadState } from "./types";

const mcpSectionButtonClass =
  "kerminal-focus-ring kerminal-pressable kerminal-muted-surface inline-flex h-9 items-center justify-center gap-2 rounded-xl border px-3 text-sm text-zinc-700 transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-200";

interface McpSkillsSettingsSectionProps {
  desktopNotifications: DesktopNotificationSettings;
}

export function McpSkillsSettingsSection({
  desktopNotifications,
}: McpSkillsSettingsSectionProps) {
  const [httpServerStatus, setHttpServerStatus] =
    useState<McpHttpServerStatus | null>(null);
  const [httpServerError, setHttpServerError] = useState<string | null>(null);
  const [httpServerState, setHttpServerState] =
    useState<McpHttpServerLoadState>("idle");
  const [copiedJson, setCopiedJson] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const notificationLastSentAtByKeyRef = useRef<
    Record<string, number | undefined>
  >({});

  const refreshHttpServerStatus = async () => {
    setHttpServerState("loading");
    setHttpServerError(null);
    try {
      setHttpServerStatus(await getMcpHttpServerStatus());
      setHttpServerState("idle");
    } catch (nextError) {
      setHttpServerStatus(null);
      setHttpServerError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
      setHttpServerState("error");
    }
  };

  const startHttpServer = async () => {
    setHttpServerState("loading");
    setHttpServerError(null);
    try {
      setHttpServerStatus(await startMcpHttpServer());
      setHttpServerState("idle");
    } catch (nextError) {
      const errorMessage =
        nextError instanceof Error ? nextError.message : String(nextError);
      setHttpServerError(errorMessage);
      setHttpServerState("error");
      void sendDesktopNotification({
        event: {
          kind: "mcp.server.failed",
          notificationKey: "mcp.server.failed:start",
          port: httpServerStatus?.port ?? undefined,
          reason: errorMessage,
        },
        lastSentAtByKey: notificationLastSentAtByKeyRef.current,
        settings: desktopNotifications,
        visibility: currentDesktopNotificationVisibility(),
      });
    }
  };

  const stopHttpServer = async () => {
    setHttpServerState("loading");
    setHttpServerError(null);
    try {
      setHttpServerStatus(await stopMcpHttpServer());
      setHttpServerState("idle");
    } catch (nextError) {
      setHttpServerError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
      setHttpServerState("error");
    }
  };

  const endpoint = httpServerStatus?.endpoint ?? null;
  const configJson = endpoint ? externalMcpHttpJson(endpoint) : null;
  const displayedConfigJson = configJson ?? externalMcpHttpJson("启动后显示");
  const running = Boolean(httpServerStatus?.running);
  const isLoading = httpServerState === "loading";

  const copyJson = async () => {
    if (!configJson) {
      return;
    }
    setCopyError(null);
    try {
      await writeTextToClipboard(configJson);
      setCopiedJson(true);
      window.setTimeout(() => setCopiedJson(false), 1600);
    } catch {
      setCopyError("复制失败");
    }
  };

  useEffect(() => {
    void refreshHttpServerStatus();
  }, []);

  return (
    <section className="kerminal-solid-surface rounded-2xl border p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
        <Server className="h-4 w-4 text-sky-500 dark:text-sky-300" />
        MCP
      </h2>

      <div className="mt-4 grid gap-3 text-sm text-zinc-600 dark:text-zinc-300">
        <InfoRow label="状态">
          <span className={statusBadgeClass(httpServerStatus, httpServerState)}>
            {serverStatusLabel(httpServerStatus, httpServerState)}
          </span>
        </InfoRow>
        <InfoRow label="endpoint">
          <code className="kerminal-field-surface min-w-0 break-all rounded-lg border px-2 py-1 font-mono text-[11px] text-zinc-700 dark:text-zinc-200">
            {endpoint ?? "启动后显示"}
          </code>
        </InfoRow>
        <InfoRow label="JSON">
          <pre
            aria-label="MCP JSON 配置"
            className="kerminal-field-surface max-h-44 min-w-0 overflow-auto whitespace-pre-wrap break-all rounded-lg border px-3 py-2 font-mono text-[11px] leading-5 text-zinc-700 dark:text-zinc-200"
          >
            {displayedConfigJson}
          </pre>
        </InfoRow>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          className={mcpSectionButtonClass}
          disabled={isLoading}
          onClick={() =>
            void (running ? stopHttpServer() : startHttpServer())
          }
          type="button"
        >
          {running ? (
            <PowerOff className="h-4 w-4" />
          ) : (
            <Power className="h-4 w-4" />
          )}
          {running ? "停止" : "启动"}
        </button>
        <button
          className={mcpSectionButtonClass}
          disabled={!configJson}
          onClick={() => void copyJson()}
          type="button"
        >
          {copiedJson ? (
            <Check className="h-4 w-4" />
          ) : (
            <Clipboard className="h-4 w-4" />
          )}
          {copiedJson ? "已复制" : "复制 JSON"}
        </button>
      </div>

      {httpServerError ? (
        <div
          className="mt-3 rounded-lg border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-700 dark:text-rose-100"
          role="alert"
        >
          {httpServerError}
        </div>
      ) : null}
      {copyError ? (
        <div
          className="mt-3 rounded-lg border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-700 dark:text-rose-100"
          role="alert"
        >
          {copyError}
        </div>
      ) : null}
    </section>
  );
}

function InfoRow({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[88px_minmax(0,1fr)]">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function serverStatusLabel(
  status: McpHttpServerStatus | null,
  state: McpHttpServerLoadState,
) {
  if (state === "loading") {
    return "读取中";
  }
  if (status?.running) {
    return "运行中";
  }
  if (state === "error") {
    return "读取失败";
  }
  return "已停止";
}

function statusBadgeClass(
  status: McpHttpServerStatus | null,
  state: McpHttpServerLoadState,
) {
  return cn(
    "inline-flex w-fit rounded-full border px-3 py-1 text-xs font-medium",
    state === "loading"
      ? "border-sky-400/25 bg-sky-400/10 text-sky-700 dark:text-sky-100"
      : status?.running
        ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-700 dark:text-emerald-100"
        : state === "error"
          ? "border-rose-400/25 bg-rose-400/10 text-rose-700 dark:text-rose-100"
          : "border-[var(--border-subtle)] bg-[var(--surface-field)] text-zinc-500 dark:text-zinc-400",
  );
}

function externalMcpHttpJson(endpoint: string) {
  return JSON.stringify(
    {
      mcpServers: {
        kerminal: {
          type: "http",
          url: endpoint,
        },
      },
    },
    null,
    2,
  );
}
