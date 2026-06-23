import { useEffect, useMemo, useState } from "react";
import {
  MessageSquare,
  Plus,
  Puzzle,
  RefreshCw,
  Route,
  Server,
} from "lucide-react";
import { cn } from "../../../lib/cn";
import {
  getAppSkillsDirectory,
  openLocalDirectory,
  selectLocalDirectory,
} from "../../../lib/fileDialogApi";
import {
  discoverMcpServerTools,
  getMcpHttpServerStatus,
  startMcpHttpServer,
  type McpHttpServerStatus,
} from "../../../lib/toolRegistryApi";
import type { McpGatewayManifest } from "../../tool-panel/toolRegistryModel";
import {
  normalizeAiMcpSettings,
  type AiMcpSettings,
  type CustomMcpServerSetting,
  type CustomMcpSkillDirectorySetting,
} from "../settingsModel";
import {
  McpCapabilityMetric,
  McpDefinitionList,
  McpEmptyState,
  McpHttpTransportCard,
  McpToolCatalog,
} from "./mcp-catalog";
import {
  CustomMcpServerCard,
  CustomMcpServerDialog,
  CustomMcpSkillDirectoryCard,
  createCustomMcpServer,
  createCustomMcpSkillDirectory,
  mergeDiscoveredTools,
  resolveAppDefaultSkillDirectory,
} from "./mcp-custom";
import type {
  McpHttpServerLoadState,
  McpManifestLoadState,
  McpTransportDefinition,
} from "./types";

const mcpSectionButtonClass =
  "kerminal-focus-ring kerminal-pressable kerminal-muted-surface inline-flex h-9 items-center justify-center gap-2 rounded-xl border px-3 text-sm text-zinc-700 transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-200";

export function McpSkillsSettingsSection({
  error,
  manifest,
  mcp,
  onChange,
  onRefresh,
  state,
}: {
  error: string | null;
  manifest: McpGatewayManifest | null;
  mcp: AiMcpSettings;
  onChange: (mcp: AiMcpSettings) => void;
  onRefresh: () => void;
  state: McpManifestLoadState;
}) {
  const normalizedMcp = normalizeAiMcpSettings(mcp);
  const [discoveringServerId, setDiscoveringServerId] = useState<string | null>(
    null,
  );
  const [httpServerStatus, setHttpServerStatus] =
    useState<McpHttpServerStatus | null>(null);
  const [httpServerError, setHttpServerError] = useState<string | null>(null);
  const [httpServerState, setHttpServerState] =
    useState<McpHttpServerLoadState>("idle");
  const [serverDraft, setServerDraft] = useState<CustomMcpServerSetting | null>(
    null,
  );
  const [skillDirectoryError, setSkillDirectoryError] = useState<string | null>(
    null,
  );
  const [appSkillsDirectory, setAppSkillsDirectory] = useState<string | null>(
    null,
  );
  useEffect(() => {
    let active = true;
    void getAppSkillsDirectory()
      .then((path) => {
        if (active && path) {
          setAppSkillsDirectory(path);
        }
      })
      .catch((nextError) => {
        if (active) {
          setSkillDirectoryError(
            nextError instanceof Error ? nextError.message : String(nextError),
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);
  const systemManifestTools = useMemo(
    () =>
      [...(manifest?.tools.tools ?? [])]
        .filter((tool) => tool.origin === "system")
        .sort((left, right) => left.name.localeCompare(right.name)),
    [manifest],
  );
  const systemSkills = useMemo(
    () => (manifest?.skills ?? []).filter((skill) => skill.origin === "system"),
    [manifest],
  );
  const systemResources = useMemo(
    () =>
      (manifest?.resources ?? []).filter(
        (resource) => resource.uri !== "kerminal://settings/custom-mcp",
      ),
    [manifest],
  );
  const coverage = useMemo(() => {
    const exposedToolIds = new Set(
      systemManifestTools.map((tool) => tool.name),
    );
    const referencedToolIds = new Set(
      systemSkills.flatMap((skill) => skill.toolIds),
    );
    return {
      missingToolIds: [...referencedToolIds].filter(
        (toolId) => !exposedToolIds.has(toolId),
      ),
      referencedToolCount: referencedToolIds.size,
    };
  }, [systemManifestTools, systemSkills]);
  const systemToolCount = systemManifestTools.length;
  const externalMcpTransports = useMemo(
    () => (manifest?.transports ?? []).filter(isExternalMcpTransport),
    [manifest],
  );
  const systemSkillCount = systemSkills.length;
  const primarySkillDirectory =
    normalizedMcp.skillDirectories[0] ?? createCustomMcpSkillDirectory(0);
  const effectivePrimarySkillDirectory = useMemo(
    () =>
      resolveAppDefaultSkillDirectory(
        primarySkillDirectory,
        appSkillsDirectory,
      ),
    [appSkillsDirectory, primarySkillDirectory],
  );
  const updateServers = (servers: CustomMcpServerSetting[]) =>
    onChange({ ...normalizedMcp, servers });
  const updateSkillDirectories = (
    skillDirectories: CustomMcpSkillDirectorySetting[],
  ) => onChange({ ...normalizedMcp, skillDirectories });
  const updatePrimarySkillDirectory = (
    directory: CustomMcpSkillDirectorySetting,
  ) => {
    setSkillDirectoryError(null);
    updateSkillDirectories([
      {
        ...directory,
        id: directory.id || "user-skills",
      },
    ]);
  };
  const chooseSkillDirectory = async () => {
    setSkillDirectoryError(null);
    try {
      const path = await selectLocalDirectory();
      if (!path) {
        return;
      }
      updatePrimarySkillDirectory({
        ...primarySkillDirectory,
        path,
      });
    } catch (nextError) {
      setSkillDirectoryError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    }
  };
  const openSkillDirectory = async () => {
    setSkillDirectoryError(null);
    try {
      await openLocalDirectory(effectivePrimarySkillDirectory.path);
    } catch (nextError) {
      setSkillDirectoryError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    }
  };
  const saveServerDraft = () => {
    if (!serverDraft) {
      return;
    }
    updateServers([...normalizedMcp.servers, serverDraft]);
    setServerDraft(null);
  };
  const refreshServerTools = async (server: CustomMcpServerSetting) => {
    setDiscoveringServerId(server.id);
    try {
      const tools = await discoverMcpServerTools(server);
      updateServers(
        normalizedMcp.servers.map((item) =>
          item.id === server.id
            ? {
                ...item,
                lastDiscoveredAt: Math.floor(Date.now() / 1000),
                lastDiscoveryError: null,
                tools: mergeDiscoveredTools(item.tools, tools),
              }
            : item,
        ),
      );
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : String(nextError);
      updateServers(
        normalizedMcp.servers.map((item) =>
          item.id === server.id
            ? {
                ...item,
                lastDiscoveryError: message,
              }
            : item,
        ),
      );
    } finally {
      setDiscoveringServerId(null);
    }
  };
  const refreshHttpServerStatus = async () => {
    setHttpServerState("loading");
    setHttpServerError(null);
    try {
      const currentStatus = await getMcpHttpServerStatus();
      const nextStatus =
        currentStatus.running && currentStatus.endpoint
          ? currentStatus
          : await startMcpHttpServer();
      setHttpServerStatus(nextStatus);
      setHttpServerState("idle");
    } catch (nextError) {
      setHttpServerStatus(null);
      setHttpServerError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
      setHttpServerState("error");
    }
  };

  useEffect(() => {
    if (
      externalMcpTransports.length === 0 ||
      httpServerStatus ||
      httpServerState !== "idle"
    ) {
      return;
    }
    void refreshHttpServerStatus();
  }, [externalMcpTransports.length, httpServerState, httpServerStatus]);

  return (
    <section className="kerminal-solid-surface rounded-2xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            <Puzzle className="h-4 w-4 text-sky-500 dark:text-sky-300" />
            MCP / Skills
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            查看系统 MCP 服务、应用内工具、skills 路由；自定义 MCP 只配置
            server，工具从 server discovery 拉取；skills 使用本地文件夹里的
            SKILL.md。
          </p>
        </div>
        <button
          aria-label="刷新 MCP / Skills"
          className={mcpSectionButtonClass}
          disabled={state === "loading"}
          onClick={onRefresh}
          type="button"
        >
          <RefreshCw
            className={cn("h-4 w-4", state === "loading" ? "animate-spin" : "")}
          />
          刷新
        </button>
      </div>

      {error ? (
        <div
          className="mt-4 rounded-xl border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-100"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {manifest ? (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <McpCapabilityMetric label="系统工具" value={systemToolCount} />
            <McpCapabilityMetric label="系统 Skills" value={systemSkillCount} />
          </div>

          <section className="kerminal-muted-surface rounded-xl border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {manifest.agent.name}
                </div>
                <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                  {manifest.agent.role}
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-100">
                {manifest.security.requiresKerminalConfirmation
                  ? "受控确认"
                  : "直接执行"}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {manifest.agent.capabilities.map((capability) => (
                <span
                  className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-field)] px-2 py-1 text-xs text-zinc-600 shadow-sm shadow-black/5 dark:text-zinc-300"
                  key={capability.id}
                >
                  {capability.title}
                </span>
              ))}
            </div>
          </section>

          <section className="kerminal-muted-surface rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                <Server className="h-4 w-4 text-zinc-400" />
                系统 MCP 服务 / 外部集成
              </h3>
              <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-field)] px-3 py-1 text-xs text-zinc-500 dark:text-zinc-400">
                Claude / Codex / MCP Client
              </span>
            </div>
            <div className="mt-3 grid gap-3">
              {externalMcpTransports.length > 0 ? (
                externalMcpTransports.map((transport) => (
                  <McpHttpTransportCard
                    error={httpServerError}
                    key={transport.id ?? transport.kind}
                    onRefresh={() => void refreshHttpServerStatus()}
                    state={httpServerState}
                    status={httpServerStatus}
                    transport={transport}
                  />
                ))
              ) : (
                <McpEmptyState text="暂无可供外部 MCP Client 连接的本地 HTTP 服务" />
              )}
            </div>
          </section>

          <McpToolCatalog tools={systemManifestTools} />

          <div className="grid gap-4 xl:grid-cols-2">
            <McpDefinitionList
              empty="暂无 MCP resource"
              icon={Puzzle}
              items={systemResources.map((resource) => ({
                detail: resource.uri,
                meta: resource.dynamic ? "dynamic" : "static",
                title: resource.title,
              }))}
              title="MCP Resources"
            />
            <McpDefinitionList
              empty="暂无 MCP prompt"
              icon={MessageSquare}
              items={manifest.prompts.map((prompt) => ({
                detail: prompt.name,
                meta: `${prompt.arguments.length} args`,
                title: prompt.title,
              }))}
              title="MCP Prompts"
            />
          </div>

          <section className="kerminal-muted-surface rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                <Route className="h-4 w-4 text-zinc-400" />
                Skills 路由
              </h3>
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium",
                  coverage.missingToolIds.length === 0
                    ? "border border-emerald-400/20 bg-emerald-400/10 text-emerald-700 dark:text-emerald-100"
                    : "border border-amber-400/20 bg-amber-400/10 text-amber-700 dark:text-amber-100",
                )}
              >
                {coverage.missingToolIds.length === 0
                  ? `${coverage.referencedToolCount} tools 已覆盖`
                  : `${coverage.missingToolIds.length} 个缺失`}
              </span>
            </div>
            <div className="mt-3 grid gap-3 xl:grid-cols-2">
              {systemSkills.length === 0 ? (
                <McpEmptyState text="暂无系统 Skills 路由" />
              ) : (
                systemSkills.map((skill) => (
                  <div
                    className="kerminal-solid-surface rounded-xl border p-3"
                    key={skill.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {skill.title}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                          {skill.whenToUse}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-field)] px-2 py-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                        {skill.toolIds.length} tools
                      </span>
                    </div>
                    <p className="mt-2 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                      {skill.toolIds.slice(0, 8).join(", ")}
                      {skill.toolIds.length > 8 ? " ..." : ""}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      ) : (
        <div
          className="kerminal-muted-surface mt-5 rounded-xl border px-4 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400"
          role="status"
        >
          {state === "loading"
            ? "正在读取 MCP manifest..."
            : "暂未读取 MCP manifest"}
        </div>
      )}

      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <Server className="h-4 w-4 text-zinc-400" />
            用户自定义 MCP / Skills
          </h3>
          <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-field)] px-3 py-1 text-xs text-zinc-500 dark:text-zinc-400">
            仅影响本机扩展
          </span>
        </div>

        <div className="mt-3 grid gap-4">
          <section className="kerminal-muted-surface rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                <Server className="h-4 w-4 text-zinc-400" />
                用户自定义 MCP Servers
              </h3>
              <button
                className={mcpSectionButtonClass}
                onClick={() =>
                  setServerDraft(
                    createCustomMcpServer(normalizedMcp.servers.length),
                  )
                }
                type="button"
              >
                <Plus className="h-4 w-4" />
                添加 Server
              </button>
            </div>
            <div className="mt-3 grid gap-3">
              {normalizedMcp.servers.length === 0 ? (
                <McpEmptyState text="暂无自定义 MCP Server" />
              ) : (
                normalizedMcp.servers.map((server) => (
                  <CustomMcpServerCard
                    key={server.id}
                    onDelete={() =>
                      updateServers(
                        normalizedMcp.servers.filter(
                          (item) => item.id !== server.id,
                        ),
                      )
                    }
                    onUpdate={(nextServer) =>
                      updateServers(
                        normalizedMcp.servers.map((item) =>
                          item.id === server.id ? nextServer : item,
                        ),
                      )
                    }
                    onRefreshTools={() => void refreshServerTools(server)}
                    refreshing={discoveringServerId === server.id}
                    server={server}
                  />
                ))
              )}
            </div>
          </section>

          <section className="kerminal-muted-surface rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                <Route className="h-4 w-4 text-zinc-400" />
                用户自定义 Skills 文件夹
              </h3>
              <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-field)] px-3 py-1 text-xs text-zinc-500 dark:text-zinc-400">
                自动扫描
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              配置一个本地根目录；把每个 skill 文件夹拷贝进去，并在目录内放
              `SKILL.md`。AI 助手会扫描这个文件夹下可读到的 skills。
            </p>
            <div className="mt-3 grid gap-3">
              <CustomMcpSkillDirectoryCard
                directory={effectivePrimarySkillDirectory}
                onChoose={() => void chooseSkillDirectory()}
                onOpen={() => void openSkillDirectory()}
                onUpdate={updatePrimarySkillDirectory}
              />
              {skillDirectoryError ? (
                <div
                  className="rounded-xl border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-700 dark:text-rose-100"
                  role="alert"
                >
                  {skillDirectoryError}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
      <CustomMcpServerDialog
        onClose={() => setServerDraft(null)}
        onSubmit={saveServerDraft}
        onUpdate={setServerDraft}
        server={serverDraft}
      />
    </section>
  );
}

function isExternalMcpTransport(transport: McpTransportDefinition) {
  return transport.origin === "system" && transport.kind === "streamable-http";
}
