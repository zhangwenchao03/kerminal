import type { CommandHistoryTarget } from "../../lib/commandHistoryApi";
import type { CommandSnippet, SnippetScope } from "../../lib/snippetApi";
import type { TerminalPane } from "../workspace/types";

export type SnippetCatalogMode = "mine" | "preset";

export const snippetScopeOptions = [
  { label: "全部", value: "" },
  { label: "通用", value: "any" },
  { label: "本地", value: "local" },
  { label: "SSH", value: "ssh" },
];

export const createScopeOptions = snippetScopeOptions.filter(
  (option) => option.value,
);

export const PRESET_TAG = "预设";
export const PRESET_SNIPPET_ID_PREFIX = "snippet-preset-";
const PRESET_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export const presetSnippets: CommandSnippet[] = [
  presetSnippet({
    command: "git status --short\ngit branch --show-current",
    description: "查看工作区状态和当前分支。",
    id: "git-status",
    scope: "local",
    sortOrder: 10,
    tags: ["git", "daily"],
    title: "Git 状态",
  }),
  presetSnippet({
    command: "git diff --stat\ngit diff --cached --stat",
    description: "快速看未暂存和已暂存变更规模。",
    id: "git-diff-stat",
    scope: "local",
    sortOrder: 20,
    tags: ["git"],
    title: "Git 变更摘要",
  }),
  presetSnippet({
    command: "git log --oneline --decorate -n 12",
    description: "查看最近提交记录。",
    id: "git-recent-log",
    scope: "local",
    sortOrder: 30,
    tags: ["git"],
    title: "Git 最近提交",
  }),
  presetSnippet({
    command: "git pull --ff-only",
    description: "只允许快进的安全拉取。",
    id: "git-pull-ff",
    scope: "local",
    sortOrder: 40,
    tags: ["git"],
    title: "Git 拉取更新",
  }),
  presetSnippet({
    command: "npm run dev",
    description: "启动前端开发服务。",
    id: "npm-dev",
    scope: "local",
    sortOrder: 50,
    tags: ["npm", "daily"],
    title: "NPM 开发服务",
  }),
  presetSnippet({
    command: "npm run build",
    description: "执行生产构建。",
    id: "npm-build",
    scope: "local",
    sortOrder: 60,
    tags: ["npm", "quality"],
    title: "NPM 构建",
  }),
  presetSnippet({
    command: "npm test",
    description: "运行项目默认测试脚本。",
    id: "npm-test",
    scope: "local",
    sortOrder: 70,
    tags: ["npm", "quality"],
    title: "NPM 测试",
  }),
  presetSnippet({
    command: "pnpm dev",
    description: "启动 pnpm 项目的开发服务。",
    id: "pnpm-dev",
    scope: "local",
    sortOrder: 80,
    tags: ["pnpm", "daily"],
    title: "PNPM 开发服务",
  }),
  presetSnippet({
    command: "pwd\nls",
    description: "确认当前位置并列出目录内容。",
    id: "shell-list-directory",
    scope: "any",
    sortOrder: 90,
    tags: ["shell", "daily"],
    title: "当前目录",
  }),
  presetSnippet({
    command: "mkdir {{ name }}",
    description: "按名称创建目录。",
    id: "shell-mkdir",
    scope: "any",
    sortOrder: 100,
    tags: ["shell"],
    title: "创建目录",
  }),
  presetSnippet({
    command: "docker ps",
    description: "列出当前运行中的容器。",
    id: "docker-ps",
    scope: "any",
    sortOrder: 110,
    tags: ["docker"],
    title: "Docker 容器",
  }),
  presetSnippet({
    command: "docker compose ps",
    description: "查看 compose 服务状态。",
    id: "docker-compose-ps",
    scope: "any",
    sortOrder: 120,
    tags: ["docker"],
    title: "Docker Compose 状态",
  }),
  presetSnippet({
    command: "df -h",
    description: "查看远程主机磁盘空间。",
    id: "ssh-disk",
    scope: "ssh",
    sortOrder: 130,
    tags: ["ssh", "system"],
    title: "SSH 磁盘空间",
  }),
  presetSnippet({
    command: "systemctl status {{ service }} --no-pager",
    description: "查看 systemd 服务状态。",
    id: "ssh-service-status",
    scope: "ssh",
    sortOrder: 140,
    tags: ["ssh", "system"],
    title: "SSH 服务状态",
  }),
];

function presetSnippet(
  input: Pick<CommandSnippet, "command" | "description" | "scope" | "title"> & {
    id: string;
    sortOrder: number;
    tags: string[];
  },
): CommandSnippet {
  return {
    command: input.command,
    createdAt: PRESET_TIMESTAMP,
    description: input.description,
    id: `${PRESET_SNIPPET_ID_PREFIX}${input.id}`,
    scope: input.scope,
    sortOrder: input.sortOrder,
    tags: [PRESET_TAG, ...input.tags],
    title: input.title,
    updatedAt: PRESET_TIMESTAMP,
  };
}

export function filterPresetSnippets(request: {
  query: string;
  scope: SnippetScope | "";
}) {
  const query = request.query.trim().toLowerCase();
  return presetSnippets
    .filter((snippet) => !request.scope || snippet.scope === request.scope)
    .filter((snippet) => (query ? snippetMatchesQuery(snippet, query) : true));
}

function snippetMatchesQuery(snippet: CommandSnippet, query: string) {
  return (
    snippet.title.toLowerCase().includes(query) ||
    snippet.command.toLowerCase().includes(query) ||
    (snippet.description ?? "").toLowerCase().includes(query) ||
    snippet.tags.some((tag) => tag.toLowerCase().includes(query))
  );
}

export function isPresetSnippetId(snippetId: string) {
  return snippetId.startsWith(PRESET_SNIPPET_ID_PREFIX);
}

export function buildSnippetVariableValues(
  variables: string[],
  values: Record<string, string> = {},
) {
  return Object.fromEntries(
    variables.map((name) => [name, values[name] ?? ""]),
  );
}

export function getSnippetSendBlocker(
  snippet: CommandSnippet,
  focusedPane?: TerminalPane,
) {
  const target = getPaneCommandTarget(focusedPane);
  if (!target) {
    return "当前没有可发送的终端分屏。";
  }
  if (snippet.scope !== "any" && snippet.scope !== target) {
    return snippet.scope === "ssh"
      ? "该片段仅适用于 SSH 终端，请先聚焦 SSH 分屏。"
      : "该片段仅适用于本地终端，请先聚焦本地分屏。";
  }
  return null;
}

export function getPaneCommandTarget(
  focusedPane?: TerminalPane,
): CommandHistoryTarget | null {
  if (focusedPane?.mode === "local") {
    return "local";
  }
  if (focusedPane?.mode === "ssh") {
    return "ssh";
  }
  return null;
}

export function scopeLabel(scope: SnippetScope) {
  const labels: Record<SnippetScope, string> = {
    any: "通用片段",
    local: "本地终端",
    ssh: "SSH 远程",
  };
  return labels[scope];
}

export function scopeShortLabel(scope: SnippetScope) {
  const labels: Record<SnippetScope, string> = {
    any: "any",
    local: "local",
    ssh: "ssh",
  };
  return labels[scope];
}

export function scopeBadgeClassName(scope: SnippetScope) {
  const classNames: Record<SnippetScope, string> = {
    any: "border-sky-400/25 bg-sky-500/10 text-sky-700 dark:text-sky-100",
    local:
      "border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-100",
    ssh: "border-violet-400/25 bg-violet-500/10 text-violet-700 dark:text-violet-100",
  };
  return classNames[scope];
}

export function parseTags(value: string) {
  return value
    .split(/[,，\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function snippetHasTag(snippet: CommandSnippet, tag: string) {
  const normalizedTag = tag.toLowerCase();
  return snippet.tags.some((item) => item.toLowerCase() === normalizedTag);
}

export function collectTagGroups(
  snippets: CommandSnippet[],
  excludedTags: string[] = [],
) {
  const excludedKeys = new Set(
    excludedTags.map((tag) => tag.trim().toLowerCase()).filter(Boolean),
  );
  const counts = new Map<string, { count: number; tag: string }>();
  for (const snippet of snippets) {
    const seen = new Set<string>();
    for (const tag of snippet.tags) {
      const trimmedTag = tag.trim();
      const key = trimmedTag.toLowerCase();
      if (!trimmedTag || seen.has(key) || excludedKeys.has(key)) {
        continue;
      }
      seen.add(key);
      counts.set(key, {
        count: (counts.get(key)?.count ?? 0) + 1,
        tag: counts.get(key)?.tag ?? trimmedTag,
      });
    }
  }
  return Array.from(counts.values()).sort(
    (left, right) =>
      right.count - left.count || left.tag.localeCompare(right.tag),
  );
}

export function groupSnippets(snippets: CommandSnippet[], activeTag: string) {
  if (activeTag) {
    return [
      {
        id: `tag:${activeTag.toLowerCase()}`,
        label: snippetGroupLabel(activeTag),
        snippets,
      },
    ];
  }

  const groups = new Map<
    string,
    {
      id: string;
      label: string;
      snippets: CommandSnippet[];
    }
  >();
  for (const snippet of snippets) {
    const primaryTag = snippet.tags[0]?.trim();
    const label = primaryTag
      ? snippetGroupLabel(primaryTag)
      : scopeLabel(snippet.scope);
    const id = primaryTag
      ? `tag:${primaryTag.toLowerCase()}`
      : `scope:${snippet.scope}`;
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        label,
        snippets: [],
      });
    }
    groups.get(id)?.snippets.push(snippet);
  }
  return Array.from(groups.values()).sort(
    (left, right) =>
      snippetGroupSortWeight(left.label) -
        snippetGroupSortWeight(right.label) ||
      left.label.localeCompare(right.label),
  );
}

function snippetGroupLabel(tag: string) {
  return tag === PRESET_TAG ? PRESET_TAG : `#${tag}`;
}

function snippetGroupSortWeight(label: string) {
  return label === PRESET_TAG ? 0 : 1;
}
