import { useState } from "react";
import { Check, Clipboard, RefreshCw, Wrench, type LucideIcon } from "lucide-react";
import { cn } from "../../../lib/cn";
import type { McpHttpServerStatus } from "../../../lib/toolRegistryApi";
import {
  confirmationLabel,
  mcpTransportStatusLabel,
  riskLabel,
  type McpGatewayManifest,
} from "../../tool-panel/toolRegistryModel";
import { writeTextToClipboard } from "./clipboard";
import type {
  McpCopyTarget,
  McpHttpServerLoadState,
  McpTransportDefinition,
} from "./types";

export function McpHttpTransportCard({
  error,
  onRefresh,
  state,
  status,
  transport,
}: {
  error: string | null;
  onRefresh: () => void;
  state: McpHttpServerLoadState;
  status: McpHttpServerStatus | null;
  transport: McpTransportDefinition;
}) {
  const [copiedTarget, setCopiedTarget] = useState<McpCopyTarget | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const endpoint = concreteHttpEndpoint(status?.endpoint);
  const configJson = endpoint ? externalMcpHttpJson(endpoint) : null;
  const isLoading = state === "loading";
  const statusLabel = isLoading
    ? "启动中"
    : endpoint
      ? "已启动"
      : mcpTransportStatusLabel(transport.status);
  const copyText = async (target: McpCopyTarget, value: string) => {
    setCopyError(null);
    try {
      await writeTextToClipboard(value);
      setCopiedTarget(target);
      window.setTimeout(() => setCopiedTarget(null), 1600);
    } catch {
      setCopyError("复制失败");
    }
  };

  return (
    <div className="rounded-xl border border-black/8 bg-white/70 p-3 dark:border-white/8 dark:bg-white/6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {transport.title}
          </div>
          <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            通过本机 Streamable HTTP endpoint 提供给 Claude、Codex 或其它
            MCP Client 连接。
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-black/[0.04] px-2 py-1 text-[11px] text-zinc-500 dark:bg-white/8 dark:text-zinc-400">
          {statusLabel}
        </span>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <McpInlineCode label="kind" value={transport.kind} />
        <McpInlineCode
          label="bind"
          value={status?.bindAddress ?? "127.0.0.1"}
        />
        {status?.port ? (
          <McpInlineCode label="port" value={String(status.port)} />
        ) : null}

        <div className="grid gap-1 sm:grid-cols-[88px_minmax(0,1fr)]">
          <span>endpoint</span>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {endpoint ? (
              <>
                <code className="min-w-0 flex-1 select-all break-all rounded-md bg-black/[0.04] px-2 py-1 font-mono text-[11px] text-zinc-700 dark:bg-white/8 dark:text-zinc-200">
                  {endpoint}
                </code>
                <button
                  aria-label="复制 HTTP MCP endpoint"
                  className="inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md border border-black/10 bg-white/80 px-2 text-[11px] text-zinc-600 transition hover:bg-black/[0.04] dark:border-white/10 dark:bg-white/8 dark:text-zinc-300 dark:hover:bg-white/12"
                  onClick={() => void copyText("endpoint", endpoint)}
                  type="button"
                >
                  {copiedTarget === "endpoint" ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Clipboard className="h-3 w-3" />
                  )}
                  {copiedTarget === "endpoint" ? "已复制" : "复制"}
                </button>
              </>
            ) : (
              <span className="rounded-md bg-black/[0.04] px-2 py-1 text-[11px] text-zinc-500 dark:bg-white/8 dark:text-zinc-400">
                {isLoading
                  ? "正在启动本地 HTTP MCP Server..."
                  : "启动后显示真实端口"}
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-1 sm:grid-cols-[88px_minmax(0,1fr)]">
          <span>config</span>
          <div className="min-w-0">
            <pre className="max-h-36 overflow-auto rounded-lg border border-black/8 bg-black/[0.04] p-3 text-[11px] leading-5 text-zinc-700 dark:border-white/8 dark:bg-black/30 dark:text-zinc-200">
              {configJson ?? "启动后显示可复制 JSON 配置"}
            </pre>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                aria-label="复制 HTTP MCP JSON 配置"
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-black/10 bg-white/80 px-2 text-xs text-zinc-600 transition hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/8 dark:text-zinc-300 dark:hover:bg-white/12"
                disabled={!configJson}
                onClick={() =>
                  configJson ? void copyText("config", configJson) : undefined
                }
                type="button"
              >
                {copiedTarget === "config" ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Clipboard className="h-3.5 w-3.5" />
                )}
                {copiedTarget === "config" ? "已复制" : "复制 JSON"}
              </button>
              <button
                aria-label="刷新 HTTP MCP endpoint"
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-black/10 bg-white/80 px-2 text-xs text-zinc-600 transition hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/8 dark:text-zinc-300 dark:hover:bg-white/12"
                disabled={isLoading}
                onClick={onRefresh}
                type="button"
              >
                <RefreshCw
                  className={cn("h-3.5 w-3.5", isLoading && "animate-spin")}
                />
                刷新
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div
            className="rounded-lg border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-700 dark:text-rose-100"
            role="alert"
          >
            {error}
          </div>
        ) : null}
        {copyError ? (
          <div
            className="rounded-lg border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-700 dark:text-rose-100"
            role="alert"
          >
            {copyError}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function McpInlineCode({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[88px_minmax(0,1fr)]">
      <span>{label}</span>
      <code className="min-w-0 truncate rounded-md bg-black/[0.04] px-2 py-1 font-mono text-[11px] text-zinc-700 dark:bg-white/8 dark:text-zinc-200">
        {value}
      </code>
    </div>
  );
}

export function McpEmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-black/10 px-3 py-5 text-center text-sm text-zinc-500 dark:border-white/10 dark:text-zinc-400">
      {text}
    </div>
  );
}
function concreteHttpEndpoint(endpoint?: string | null) {
  if (!endpoint || endpoint.includes("<dynamic>")) {
    return null;
  }
  return endpoint;
}

function externalMcpHttpJson(endpoint: string) {
  return JSON.stringify(
    {
      mcpServers: {
        kerminal: {
          url: endpoint,
        },
      },
    },
    null,
    2,
  );
}
export function McpCapabilityMetric({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-black/8 bg-black/[0.025] p-3 text-center dark:border-white/8 dark:bg-black/20">
      <div className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
        {value}
      </div>
      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
    </div>
  );
}

export function McpToolCatalog({
  tools,
}: {
  tools: McpGatewayManifest["tools"]["tools"];
}) {
  return (
    <section className="rounded-xl border border-black/8 bg-black/[0.025] p-4 dark:border-white/8 dark:bg-black/20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
          <Wrench className="h-4 w-4 text-zinc-400" />
          MCP 工具目录
        </h3>
        <span className="rounded-full bg-black/[0.04] px-3 py-1 text-xs text-zinc-500 dark:bg-white/8 dark:text-zinc-400">
          {tools.length} tools exposed
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
        这里展示当前 gateway manifest 暴露给 AI Agent 的系统工具。
      </p>
      <div className="mt-3 grid gap-3">
        <McpToolGroup empty="暂无系统工具" title="系统工具" tools={tools} />
      </div>
    </section>
  );
}

function McpToolGroup({
  empty,
  title,
  tools,
}: {
  empty: string;
  title: string;
  tools: McpGatewayManifest["tools"]["tools"];
}) {
  return (
    <div className="rounded-xl border border-black/8 bg-white/70 p-3 dark:border-white/8 dark:bg-white/6">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
          {title}
        </h4>
        <span className="rounded-full bg-black/[0.04] px-2 py-1 text-[11px] text-zinc-500 dark:bg-white/8 dark:text-zinc-400">
          {tools.length}
        </span>
      </div>
      <div className="mt-2 max-h-80 space-y-2 overflow-auto pr-1">
        {tools.length === 0 ? (
          <p className="rounded-lg border border-dashed border-black/10 px-3 py-4 text-sm text-zinc-500 dark:border-white/10 dark:text-zinc-400">
            {empty}
          </p>
        ) : (
          tools.map((tool) => (
            <div
              className="rounded-lg border border-black/8 bg-black/[0.02] p-3 dark:border-white/8 dark:bg-black/20"
              key={tool.name}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {tool.title || tool.name}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                    {tool.name}
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-200">
                  已暴露
                </span>
              </div>
              {tool.description ? (
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                  {tool.description}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <McpToolBadge>{riskLabel(tool.risk)}</McpToolBadge>
                <McpToolBadge>
                  {confirmationLabel(tool.confirmation)}
                </McpToolBadge>
                <McpToolBadge>{mcpAuditLabel(tool.audit)}</McpToolBadge>
                <McpToolBadge>
                  {tool.serverId ? `server: ${tool.serverId}` : "system"}
                </McpToolBadge>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function McpToolBadge({ children }: { children: string }) {
  return (
    <span className="rounded-full bg-black/[0.04] px-2 py-1 text-[11px] text-zinc-500 dark:bg-white/8 dark:text-zinc-400">
      {children}
    </span>
  );
}

function mcpAuditLabel(
  audit: McpGatewayManifest["tools"]["tools"][number]["audit"],
) {
  return audit === "full" ? "完整审计" : "摘要审计";
}

export function McpDefinitionList({
  empty,
  icon: Icon,
  items,
  title,
}: {
  empty: string;
  icon: LucideIcon;
  items: Array<{ detail: string; meta: string; title: string }>;
  title: string;
}) {
  return (
    <section className="rounded-xl border border-black/8 bg-black/[0.025] p-4 dark:border-white/8 dark:bg-black/20">
      <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
        <Icon className="h-4 w-4 text-zinc-400" />
        {title}
      </h3>
      <div className="mt-3 space-y-2">
        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-black/10 px-3 py-4 text-sm text-zinc-500 dark:border-white/10 dark:text-zinc-400">
            {empty}
          </p>
        ) : (
          items.map((item) => (
            <div
              className="flex items-start justify-between gap-3 rounded-xl border border-black/8 bg-white/70 px-3 py-2 dark:border-white/8 dark:bg-white/6"
              key={item.detail}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                  {item.title}
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                  {item.detail}
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-black/[0.04] px-2 py-1 text-[11px] text-zinc-500 dark:bg-white/8 dark:text-zinc-400">
                {item.meta}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
