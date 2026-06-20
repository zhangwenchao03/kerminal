import {
  FolderOpen,
  Hash,
  Network,
  RefreshCw,
  Terminal,
  Trash2,
  Wrench,
} from "lucide-react";
import { ModalShell } from "../../../components/ui/modal-shell";
import { Select } from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import { cn } from "../../../lib/cn";
import {
  confirmationLabel,
  riskLabel,
  type ToolConfirmationPolicy,
  type ToolRiskLevel,
} from "../../tool-panel/toolRegistryModel";
import {
  DEFAULT_CUSTOM_SKILLS_DIRECTORY,
  type CustomMcpServerSetting,
  type CustomMcpServerToolSetting,
  type CustomMcpSkillDirectorySetting,
  type CustomMcpTransportKind,
} from "../settingsModel";
import { McpEmptyState } from "./mcp-catalog";
import { TextAreaSetting, TextSetting } from "./shared-controls";

const LEGACY_CODEX_SKILLS_DIRECTORY = "~/.codex/skills";

const customMcpTransportOptions: Array<{
  label: string;
  value: CustomMcpTransportKind;
}> = [
  { label: "stdio", value: "stdio" },
  { label: "HTTP", value: "http" },
];

const customMcpRiskOptions: Array<{ label: string; value: ToolRiskLevel }> = [
  { label: "读取", value: "read" },
  { label: "写入", value: "write" },
  { label: "远程", value: "remote" },
  { label: "批量", value: "batch" },
  { label: "破坏性", value: "destructive" },
];

const customMcpConfirmationOptions: Array<{
  label: string;
  value: ToolConfirmationPolicy;
}> = [
  { label: "自动", value: "auto" },
  { label: "按上下文", value: "contextual" },
  { label: "每次确认", value: "always" },
];

export function CustomMcpServerDialog({
  onClose,
  onSubmit,
  onUpdate,
  server,
}: {
  onClose: () => void;
  onSubmit: () => void;
  onUpdate: (server: CustomMcpServerSetting) => void;
  server: CustomMcpServerSetting | null;
}) {
  if (!server) {
    return null;
  }

  const canSubmit = Boolean(server.id.trim() && server.name.trim());

  return (
    <ModalShell
      bodyClassName="bg-zinc-50/70 dark:bg-black/20"
      description="填写 MCP server 的身份、连接方式、鉴权和说明；保存后在卡片里刷新工具。"
      footer={
        <>
          <button
            className="inline-flex h-9 items-center justify-center rounded-xl border border-black/10 bg-white/80 px-3 text-sm text-zinc-700 transition hover:bg-black/[0.04] dark:border-white/10 dark:bg-white/8 dark:text-zinc-200 dark:hover:bg-white/12"
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          <button
            className="inline-flex h-9 items-center justify-center rounded-xl bg-sky-500 px-3 text-sm font-medium text-white shadow-sm shadow-sky-500/20 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-sky-400 dark:text-zinc-950"
            disabled={!canSubmit}
            onClick={onSubmit}
            type="button"
          >
            保存 Server
          </button>
        </>
      }
      maxWidthClassName="max-w-5xl"
      onClose={onClose}
      open
      title="添加 MCP Server"
    >
      <CustomMcpServerConfigFields onUpdate={onUpdate} server={server} />
    </ModalShell>
  );
}

export function CustomMcpServerCard({
  onDelete,
  onRefreshTools,
  onUpdate,
  refreshing,
  server,
}: {
  onDelete: () => void;
  onRefreshTools: () => void;
  onUpdate: (server: CustomMcpServerSetting) => void;
  refreshing: boolean;
  server: CustomMcpServerSetting;
}) {
  const update = (patch: Partial<CustomMcpServerSetting>) =>
    onUpdate({ ...server, ...patch });
  const updateTools = (tools: CustomMcpServerToolSetting[]) =>
    update({ tools });

  return (
    <div className="min-w-0 rounded-xl border border-black/8 bg-white/75 p-4 shadow-sm shadow-black/5 dark:border-white/8 dark:bg-white/6 dark:shadow-black/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="min-w-0 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {server.name}
            </div>
            <span className="rounded-full bg-black/[0.04] px-2 py-1 font-mono text-[11px] text-zinc-500 dark:bg-white/8 dark:text-zinc-400">
              {server.id}
            </span>
            <span className="rounded-full bg-sky-500/10 px-2 py-1 text-[11px] font-medium text-sky-700 dark:text-sky-200">
              {server.transport === "stdio" ? "stdio" : "Streamable HTTP"}
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            {server.transport === "stdio"
              ? "通过本机命令启动 MCP server，环境变量和启动参数会随配置传入。"
              : "连接已有 Streamable HTTP MCP endpoint，可使用 Bearer token 环境变量和 headers。"}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <button
            aria-label={`刷新 MCP Server ${server.id} 工具`}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-black/10 bg-white/80 px-2 text-xs text-zinc-600 transition hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/8 dark:text-zinc-300 dark:hover:bg-white/12"
            disabled={refreshing}
            onClick={onRefreshTools}
            type="button"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
            />
            刷新工具
          </button>
          <Switch
            aria-label={`启用 MCP Server ${server.id}`}
            checked={server.enabled}
            onCheckedChange={(enabled) => update({ enabled })}
          />
          <button
            aria-label={`删除 MCP Server ${server.id}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 bg-white/80 text-zinc-500 transition hover:bg-rose-500/10 hover:text-rose-600 dark:border-white/10 dark:bg-white/8 dark:text-zinc-300"
            onClick={onDelete}
            type="button"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <CustomMcpServerConfigFields onUpdate={onUpdate} server={server} />

      {server.lastDiscoveryError ? (
        <div className="mt-3 rounded-xl border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-700 dark:text-rose-100">
          {server.lastDiscoveryError}
        </div>
      ) : null}

      <div className="mt-3 rounded-xl border border-black/8 bg-black/[0.025] p-3 dark:border-white/8 dark:bg-black/20">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
            <Wrench className="h-4 w-4 text-zinc-400" />
            Server tools
          </div>
          <span className="rounded-full bg-black/[0.04] px-2 py-1 text-[11px] text-zinc-500 dark:bg-white/8 dark:text-zinc-400">
            {server.tools.length} discovered
          </span>
        </div>
        <div className="mt-3 grid gap-2">
          {server.tools.length === 0 ? (
            <McpEmptyState text="保存 server 后点击“刷新工具”，Kerminal 会通过 MCP tools/list 拉取工具。" />
          ) : (
            server.tools.map((tool) => (
              <CustomMcpServerToolRow
                key={tool.name}
                onUpdate={(nextTool) =>
                  updateTools(
                    server.tools.map((item) =>
                      item.name === tool.name ? nextTool : item,
                    ),
                  )
                }
                tool={tool}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function CustomMcpServerConfigFields({
  onUpdate,
  server,
}: {
  onUpdate: (server: CustomMcpServerSetting) => void;
  server: CustomMcpServerSetting;
}) {
  const update = (patch: Partial<CustomMcpServerSetting>) =>
    onUpdate({ ...server, ...patch });
  const endpointLabel = server.transport === "stdio" ? "启动命令" : "服务 URL";

  return (
    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
      <section className="min-w-0 rounded-xl border border-black/8 bg-black/[0.025] p-3 dark:border-white/8 dark:bg-black/20">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
          <Hash className="h-3.5 w-3.5" />
          Server identity
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <TextSetting
            label="Server ID"
            onChange={(id) => update({ id })}
            value={server.id}
          />
          <TextSetting
            label="名称"
            onChange={(name) => update({ name })}
            value={server.name}
          />
        </div>
        <TextAreaSetting
          label="说明"
          onChange={(description) => update({ description })}
          value={server.description}
        />
      </section>

      <section className="min-w-0 rounded-xl border border-black/8 bg-black/[0.025] p-3 dark:border-white/8 dark:bg-black/20">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
          <Network className="h-3.5 w-3.5" />
          Connection
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)]">
          <label className="block min-w-0">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Transport
            </span>
            <div className="mt-1 grid grid-cols-2 overflow-hidden rounded-xl border border-black/10 bg-black/[0.03] p-0.5 dark:border-white/10 dark:bg-black/20">
              {customMcpTransportOptions.map((option) => (
                <button
                  aria-pressed={server.transport === option.value}
                  className={cn(
                    "h-9 truncate rounded-lg px-2 text-xs font-medium transition",
                    server.transport === option.value
                      ? "bg-white text-zinc-950 shadow-sm dark:bg-white/12 dark:text-zinc-50"
                      : "text-zinc-500 hover:bg-white/50 dark:text-zinc-400 dark:hover:bg-white/8",
                  )}
                  key={option.value}
                  onClick={() => update({ transport: option.value })}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </label>
          <TextSetting
            label={endpointLabel}
            onChange={(value) =>
              server.transport === "stdio"
                ? update({ command: value })
                : update({ url: value })
            }
            value={server.transport === "stdio" ? server.command : server.url}
          />
        </div>

        {server.transport === "stdio" ? (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <TextSetting
              label="启动参数"
              onChange={(args) => update({ args: parseTextList(args) })}
              value={server.args.join(" ")}
            />
            <TextSetting
              label="环境变量"
              onChange={(env) => update({ env: parseNameValueList(env) })}
              value={formatNameValueList(server.env)}
            />
          </div>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <TextSetting
              label="Bearer token 环境变量"
              onChange={(bearerTokenEnvVar) => update({ bearerTokenEnvVar })}
              value={server.bearerTokenEnvVar}
            />
            <TextSetting
              label="Headers"
              onChange={(headers) =>
                update({ headers: parseNameValueList(headers) })
              }
              value={formatNameValueList(server.headers)}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function CustomMcpServerToolRow({
  onUpdate,
  tool,
}: {
  onUpdate: (tool: CustomMcpServerToolSetting) => void;
  tool: CustomMcpServerToolSetting;
}) {
  const update = (patch: Partial<CustomMcpServerToolSetting>) =>
    onUpdate({ ...tool, ...patch });

  return (
    <div className="rounded-xl border border-black/8 bg-white/70 p-3 dark:border-white/8 dark:bg-white/6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {tool.title || tool.name}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
            {tool.name}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            aria-label={`启用 MCP Tool ${tool.name}`}
            checked={tool.enabled}
            onCheckedChange={(enabled) => update({ enabled })}
          />
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            风险
          </span>
          <Select
            aria-label={`MCP Tool risk ${tool.name}`}
            className="mt-1"
            onValueChange={(risk) => update({ risk: risk as ToolRiskLevel })}
            options={customMcpRiskOptions}
            value={tool.risk}
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            确认
          </span>
          <Select
            aria-label={`MCP Tool confirmation ${tool.name}`}
            className="mt-1"
            onValueChange={(confirmation) =>
              update({ confirmation: confirmation as ToolConfirmationPolicy })
            }
            options={customMcpConfirmationOptions}
            value={tool.confirmation}
          />
        </label>
      </div>

      {tool.description ? (
        <p className="mt-3 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          {tool.description}
        </p>
      ) : null}
      <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        {riskLabel(tool.risk)} / {confirmationLabel(tool.confirmation)}
      </div>
    </div>
  );
}

export function CustomMcpSkillDirectoryCard({
  directory,
  onChoose,
  onOpen,
  onUpdate,
}: {
  directory: CustomMcpSkillDirectorySetting;
  onChoose: () => void;
  onOpen: () => void;
  onUpdate: (directory: CustomMcpSkillDirectorySetting) => void;
}) {
  const update = (patch: Partial<CustomMcpSkillDirectorySetting>) =>
    onUpdate({ ...directory, ...patch });

  return (
    <div className="rounded-xl border border-black/8 bg-white/75 p-4 shadow-sm shadow-black/5 dark:border-white/8 dark:bg-white/6 dark:shadow-black/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Skill root
            </div>
            <span className="rounded-full bg-black/[0.04] px-2 py-1 font-mono text-[11px] text-zinc-500 dark:bg-white/8 dark:text-zinc-400">
              {directory.id}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            一个目录就是一个 skills 仓库；把自己的 skill 文件夹拷进去即可。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Switch
            aria-label="启用 Skills 文件夹扫描"
            checked={directory.enabled}
            onCheckedChange={(enabled) => update({ enabled })}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          <TextSetting
            label="Skills 根目录"
            onChange={(path) => update({ path })}
            value={directory.path}
          />
          <p className="mt-3 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            支持该目录本身包含 `SKILL.md`，也支持任意子目录各自包含
            `SKILL.md`；扫描会递归处理这个根目录。
          </p>
        </div>

        <div className="min-w-0 rounded-xl border border-cyan-500/15 bg-zinc-950 px-3 py-3 text-cyan-50 shadow-inner shadow-black/40 dark:border-cyan-300/15">
          <div className="flex items-center gap-2 text-xs font-medium text-cyan-300">
            <Terminal className="h-3.5 w-3.5" />
            skills root
          </div>
          <code className="mt-2 block break-all rounded-lg bg-white/8 px-2 py-2 font-mono text-xs leading-5 text-cyan-100">
            {directory.path || DEFAULT_CUSTOM_SKILLS_DIRECTORY}
          </code>
          <div className="mt-3 grid gap-2">
            <button
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-2 text-xs font-medium text-cyan-50 transition hover:bg-cyan-300/16"
              onClick={onChoose}
              type="button"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              选择文件夹
            </button>
            <button
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-cyan-300/20 bg-white/8 px-2 text-xs font-medium text-cyan-50 transition hover:bg-white/12"
              onClick={onOpen}
              type="button"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              打开所在文件夹
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function resolveAppDefaultSkillDirectory(
  directory: CustomMcpSkillDirectorySetting,
  appSkillsDirectory: string | null,
): CustomMcpSkillDirectorySetting {
  if (!appSkillsDirectory) {
    return directory;
  }
  if (!isAppDefaultSkillDirectoryPath(directory.path, appSkillsDirectory)) {
    return directory;
  }
  if (sameSkillDirectoryPath(directory.path, appSkillsDirectory)) {
    return directory;
  }
  return {
    ...directory,
    path: appSkillsDirectory,
  };
}

function isAppDefaultSkillDirectoryPath(
  path: string,
  appSkillsDirectory: string,
) {
  const normalizedPath = comparableSkillDirectoryPath(path);
  if (!normalizedPath) {
    return true;
  }
  return [
    DEFAULT_CUSTOM_SKILLS_DIRECTORY,
    LEGACY_CODEX_SKILLS_DIRECTORY,
    appSkillsDirectory,
  ].some((candidate) => comparableSkillDirectoryPath(candidate) === normalizedPath);
}

function sameSkillDirectoryPath(left: string, right: string) {
  return comparableSkillDirectoryPath(left) === comparableSkillDirectoryPath(right);
}

function comparableSkillDirectoryPath(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
export function createCustomMcpServer(index: number): CustomMcpServerSetting {
  const suffix = index + 1;
  return {
    args: [],
    bearerTokenEnvVar: "",
    command: "npx",
    description: "",
    enabled: true,
    env: [],
    headers: [],
    id: `custom-server-${suffix}`,
    lastDiscoveredAt: null,
    lastDiscoveryError: null,
    name: `Custom MCP ${suffix}`,
    transport: "stdio",
    tools: [],
    url: "",
  };
}

export function createCustomMcpSkillDirectory(
  index: number,
): CustomMcpSkillDirectorySetting {
  const suffix = index + 1;
  return {
    enabled: true,
    id: suffix === 1 ? "user-skills" : `user-skills-${suffix}`,
    path: suffix === 1 ? DEFAULT_CUSTOM_SKILLS_DIRECTORY : "",
  };
}

export function mergeDiscoveredTools(
  currentTools: CustomMcpServerToolSetting[],
  discoveredTools: CustomMcpServerToolSetting[],
) {
  const currentByName = new Map(currentTools.map((tool) => [tool.name, tool]));
  return discoveredTools.map((tool) => ({
    ...tool,
    confirmation:
      currentByName.get(tool.name)?.confirmation ?? tool.confirmation,
    enabled: currentByName.get(tool.name)?.enabled ?? true,
    risk: currentByName.get(tool.name)?.risk ?? tool.risk,
  }));
}

function parseTextList(value: string) {
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCommaList(value: string) {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNameValueList(value: string) {
  return parseCommaList(value).map((item) => {
    const separatorIndex = item.indexOf("=");
    if (separatorIndex < 0) {
      return { name: item, value: "" };
    }
    return {
      name: item.slice(0, separatorIndex).trim(),
      value: item.slice(separatorIndex + 1).trim(),
    };
  });
}

function formatNameValueList(values: CustomMcpServerSetting["env"]) {
  return values
    .map((item) => (item.value ? `${item.name}=${item.value}` : item.name))
    .join(", ");
}
