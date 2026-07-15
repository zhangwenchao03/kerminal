import type { CommandHistoryTarget } from "../../lib/commandHistoryApi";
import type { CommandSnippet, SnippetScope } from "../../lib/snippetApi";

/** 片段发送策略识别终端目标所需的最小分屏契约。 */
export interface SnippetTerminalTarget {
  mode: string;
}

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
  presetSnippet({
    command: "uname -a\ncat /etc/os-release",
    description: "查看内核、发行版和系统版本。",
    id: "ssh-os-release",
    scope: "ssh",
    sortOrder: 150,
    tags: ["ssh", "system"],
    title: "系统版本",
  }),
  presetSnippet({
    command: "uptime\nwho",
    description: "查看在线时长、负载和当前登录用户。",
    id: "ssh-uptime-users",
    scope: "ssh",
    sortOrder: 160,
    tags: ["ssh", "system", "daily"],
    title: "负载与登录用户",
  }),
  presetSnippet({
    command: "free -h\nvmstat 1 5",
    description: "查看内存、swap 和短时虚拟内存状态。",
    id: "ssh-memory-snapshot",
    scope: "ssh",
    sortOrder: 170,
    tags: ["ssh", "memory", "system"],
    title: "内存快照",
  }),
  presetSnippet({
    command:
      "ps -eo pid,ppid,stat,pcpu,pmem,comm --sort=-pcpu | head -n 15",
    description: "按 CPU 占用列出高负载进程。",
    id: "ssh-top-cpu-processes",
    scope: "ssh",
    sortOrder: 180,
    tags: ["ssh", "process", "system"],
    title: "CPU 高占用进程",
  }),
  presetSnippet({
    command:
      "ps -eo pid,ppid,stat,pcpu,pmem,comm --sort=-pmem | head -n 15",
    description: "按内存占用列出进程。",
    id: "ssh-top-memory-processes",
    scope: "ssh",
    sortOrder: 190,
    tags: ["ssh", "process", "memory"],
    title: "内存高占用进程",
  }),
  presetSnippet({
    command: "df -hT\ndf -ih",
    description: "查看磁盘容量、文件系统类型和 inode 使用率。",
    id: "ssh-disk-inodes",
    scope: "ssh",
    sortOrder: 200,
    tags: ["ssh", "disk", "system"],
    title: "磁盘与 inode",
  }),
  presetSnippet({
    command: "du -sh {{ path }}",
    description: "统计指定路径总体积。",
    id: "ssh-directory-size",
    scope: "ssh",
    sortOrder: 210,
    tags: ["ssh", "disk", "files"],
    title: "目录体积",
  }),
  presetSnippet({
    command:
      "find {{ path }} -xdev -type f -size +100M -printf '%s %p\\n' | sort -nr | head -n 20",
    description: "在指定挂载内查找大文件。",
    id: "ssh-large-files",
    scope: "ssh",
    sortOrder: 220,
    tags: ["ssh", "disk", "files"],
    title: "查找大文件",
  }),
  presetSnippet({
    command: "ss -tulpen",
    description: "查看 TCP/UDP 监听端口和进程。",
    id: "ssh-listening-ports",
    scope: "ssh",
    sortOrder: 230,
    tags: ["ssh", "network", "port"],
    title: "监听端口",
  }),
  presetSnippet({
    command: "ss -ltnp | grep ':{{ port }} '",
    description: "按端口号查找监听进程。",
    id: "ssh-port-process",
    scope: "ssh",
    sortOrder: 240,
    tags: ["ssh", "network", "port"],
    title: "端口占用",
  }),
  presetSnippet({
    command: "ip addr show\nip route show",
    description: "查看网卡地址和路由表。",
    id: "ssh-network-summary",
    scope: "ssh",
    sortOrder: 250,
    tags: ["ssh", "network"],
    title: "网络概览",
  }),
  presetSnippet({
    command: "ping -c 4 {{ host }}\ngetent hosts {{ host }}",
    description: "检查主机连通性和 DNS 解析。",
    id: "ssh-ping-dns",
    scope: "ssh",
    sortOrder: 260,
    tags: ["ssh", "network"],
    title: "Ping 与解析",
  }),
  presetSnippet({
    command: "curl -I --max-time 10 {{ url }}",
    description: "快速检查 HTTP 响应头和连通性。",
    id: "ssh-http-head",
    scope: "ssh",
    sortOrder: 270,
    tags: ["ssh", "network", "http"],
    title: "HTTP 头检查",
  }),
  presetSnippet({
    command: "systemctl --failed --no-pager",
    description: "列出失败的 systemd unit。",
    id: "ssh-failed-services",
    scope: "ssh",
    sortOrder: 280,
    tags: ["ssh", "service", "system"],
    title: "失败服务",
  }),
  presetSnippet({
    command: "journalctl -u {{ service }} -n 200 --no-pager",
    description: "查看指定服务最近日志。",
    id: "ssh-service-journal",
    scope: "ssh",
    sortOrder: 290,
    tags: ["ssh", "service", "logs"],
    title: "服务日志",
  }),
  presetSnippet({
    command: "tail -n 200 {{ log_file }}",
    description: "查看日志文件末尾内容。",
    id: "ssh-tail-log",
    scope: "ssh",
    sortOrder: 300,
    tags: ["ssh", "logs", "files"],
    title: "查看日志尾部",
  }),
  presetSnippet({
    command: "tail -f {{ log_file }}",
    description: "持续跟踪日志输出。",
    id: "ssh-follow-log",
    scope: "ssh",
    sortOrder: 310,
    tags: ["ssh", "logs", "files"],
    title: "跟踪日志",
  }),
  presetSnippet({
    command: 'grep -R "{{ keyword }}" {{ path }} | head -n 50',
    description: "在指定路径搜索日志或文本关键字。",
    id: "ssh-grep-log",
    scope: "ssh",
    sortOrder: 320,
    tags: ["ssh", "logs", "files"],
    title: "日志关键字搜索",
  }),
  presetSnippet({
    command:
      "grep -Ei 'failed|failure|invalid' /var/log/auth.log /var/log/secure 2>/dev/null | tail -n 50",
    description: "查看常见 SSH/登录失败记录。",
    id: "ssh-auth-failures",
    scope: "ssh",
    sortOrder: 330,
    tags: ["ssh", "security", "logs"],
    title: "登录失败记录",
  }),
  presetSnippet({
    command:
      "crontab -l\nls -la /etc/cron.d /etc/cron.daily /etc/cron.hourly 2>/dev/null",
    description: "查看当前用户和系统 cron 入口。",
    id: "ssh-cron-jobs",
    scope: "ssh",
    sortOrder: 340,
    tags: ["ssh", "schedule", "system"],
    title: "定时任务",
  }),
  presetSnippet({
    command: "nginx -t",
    description: "检查 Nginx 配置语法。",
    id: "ssh-nginx-test",
    scope: "ssh",
    sortOrder: 350,
    tags: ["ssh", "nginx", "service"],
    title: "Nginx 配置检查",
  }),
  presetSnippet({
    command: "docker stats --no-stream",
    description: "查看容器即时资源占用。",
    id: "docker-stats",
    scope: "any",
    sortOrder: 360,
    tags: ["docker", "monitor", "server"],
    title: "Docker 资源占用",
  }),
  presetSnippet({
    command: "docker logs --tail 200 {{ container }}",
    description: "查看容器最近日志。",
    id: "docker-logs",
    scope: "any",
    sortOrder: 370,
    tags: ["docker", "logs", "server"],
    title: "Docker 日志",
  }),
  presetSnippet({
    command: "docker compose logs --tail 200 {{ service }}",
    description: "查看 compose 服务最近日志。",
    id: "docker-compose-logs",
    scope: "any",
    sortOrder: 380,
    tags: ["docker", "logs", "server"],
    title: "Compose 服务日志",
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
  focusedPane?: SnippetTerminalTarget,
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
  focusedPane?: SnippetTerminalTarget,
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
