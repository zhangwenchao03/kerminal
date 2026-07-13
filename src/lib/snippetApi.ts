import { invoke, isTauri } from "@tauri-apps/api/core";

export type SnippetScope = "any" | "local" | "ssh";
export type SnippetCatalogOrigin = "user" | "builtin";
export type SnippetRisk = "inspect" | "change" | "destructive" | "unknown";
export type SnippetDefaultAction = "insert" | "run";

export interface SnippetContextBinding {
  kind: "global" | "workspace" | "host" | "hostGroup";
  targetId?: string;
}

export interface SnippetCatalogVariable {
  name: string;
  label: string;
  description: string;
  kind: "text" | "path" | "port" | "integer" | "host" | "url" | "service" | "container" | "enum" | "secret" | "raw";
  required: boolean;
  defaultValue?: string;
  suggestions: string[];
  validation?: string;
  renderStrategy: "shellArg" | "validatedRaw" | "literal";
  sensitive: boolean;
}

export interface SnippetCatalogItem {
  id: string;
  origin: SnippetCatalogOrigin;
  title: string;
  description: string;
  template: string;
  category: string;
  pack: string;
  tags: string[];
  scope: SnippetScope;
  platforms: string[];
  shells: string[];
  capabilities: string[];
  risk: "inspect" | "change" | "destructive" | "unknown";
  sensitive: boolean;
  duration: "instant" | "streaming" | "high_io";
  defaultAction: "insert" | "run";
  variables: SnippetCatalogVariable[];
  contextBindings: SnippetContextBinding[];
  catalogVersion?: string;
  sourceName?: string;
  sourceUrl?: string;
  deprecated: boolean;
  favorite: boolean;
  useCount: number;
  lastUsedAtUnixMs?: number;
  sortOrder: number;
  updatedAt: string;
}

export interface SnippetCatalogListRequest {
  query?: string;
  origin?: SnippetCatalogOrigin;
  scope?: SnippetScope;
  limit?: number;
}

export type SnippetUsageAction = "insert" | "run" | "copyRendered";

export interface SnippetDocumentSnapshot {
  snippet: CommandSnippet;
  revision: string;
}

export interface SnippetDocumentWarning {
  fileName: string;
  message: string;
}

export interface SnippetDocumentList {
  snippets: CommandSnippet[];
  warnings: SnippetDocumentWarning[];
}

export interface SnippetDocumentPatch {
  expectedRevision: string;
  title: string;
  description?: string;
  command: string;
  tags: string[];
  scope: SnippetScope;
  sortOrder: number;
  updatedAt: string;
  category?: string;
  risk?: SnippetRisk;
  defaultAction?: SnippetDefaultAction;
  variables: SnippetCatalogVariable[];
  contextBindings: SnippetContextBinding[];
  derivedFrom?: string;
}

export interface SnippetImportCandidate {
  title: string;
  command: string;
  description?: string;
  tags: string[];
  scope: SnippetScope;
  category?: string;
  risk?: SnippetRisk;
  defaultAction?: SnippetDefaultAction;
  variables: SnippetCatalogVariable[];
  contextBindings: SnippetContextBinding[];
  derivedFrom?: string;
}

export interface SnippetDeleteReceipt {
  changeSetId: string;
  snippetId: string;
  expiresAtUnixMs: number;
}

export interface CommandSnippet {
  id: string;
  title: string;
  description?: string | null;
  command: string;
  tags: string[];
  scope: SnippetScope;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  category?: string | null;
  risk?: SnippetRisk | null;
  defaultAction?: SnippetDefaultAction | null;
  variables?: SnippetCatalogVariable[];
  contextBindings?: SnippetContextBinding[];
  derivedFrom?: string | null;
}

export interface SnippetListRequest {
  query?: string;
  scope?: SnippetScope;
  tag?: string;
}

export interface SnippetCreateRequest {
  title: string;
  command: string;
  description?: string;
  tags?: string[];
  scope?: SnippetScope;
}

export interface SnippetUpdateRequest extends SnippetCreateRequest {
  id: string;
  sortOrder: number;
}

interface NormalizedSnippetCreateRequest {
  title: string;
  command: string;
  description?: string;
  tags: string[];
  scope: SnippetScope;
}

interface NormalizedSnippetUpdateRequest extends NormalizedSnippetCreateRequest {
  id: string;
  sortOrder: number;
}

const browserPreviewSnippets = new Map<string, CommandSnippet>(
  [
    previewSnippet({
      command: "git status --short && git branch --show-current",
      description: "快速确认当前仓库状态和分支。",
      id: "snippet-preview-git-status",
      scope: "local",
      tags: ["git", "daily"],
      title: "检查 Git 状态",
    }),
    previewSnippet({
      command: "journalctl -u app.service -n 200 --no-pager",
      description: "读取服务最近日志。",
      id: "snippet-preview-service-log",
      scope: "ssh",
      tags: ["ssh", "logs"],
      title: "查看服务日志",
    }),
  ].map((snippet) => [snippet.id, snippet]),
);

export async function listSnippets(
  request: SnippetListRequest = {},
): Promise<CommandSnippet[]> {
  if (!isTauri()) {
    return browserPreviewList(request);
  }

  return invoke<CommandSnippet[]>("snippet_list", { request });
}

/** 新版入口统一返回用户和构建期内置目录；旧 listSnippets 合同保持不变。 */
export async function listSnippetCatalog(
  request: SnippetCatalogListRequest = {},
): Promise<SnippetCatalogItem[]> {
  if (!isTauri()) {
    const query = request.query?.trim().toLowerCase();
    return browserPreviewCatalog
      .filter((item) => !request.origin || item.origin === request.origin)
      .filter((item) => !request.scope || item.scope === "any" || item.scope === request.scope)
      .filter((item) => !query || [item.title, item.description, item.template, item.category, ...item.tags].some((value) => value.toLowerCase().includes(query)))
      .slice(0, Math.max(1, Math.min(request.limit ?? 200, 2_000)));
  }
  return invoke<SnippetCatalogItem[]>("snippet_catalog_list", { request });
}

export async function setSnippetFavorite(
  origin: SnippetCatalogOrigin,
  snippetId: string,
  favorite: boolean,
): Promise<void> {
  if (!isTauri()) return;
  await invoke("snippet_favorite_set", { favorite, origin, snippetId });
}

export async function recordSnippetUsage(
  origin: SnippetCatalogOrigin,
  snippetId: string,
  action: SnippetUsageAction,
): Promise<boolean> {
  if (!isTauri()) return true;
  return invoke<boolean>("snippet_usage_record", {
    action,
    occurredAtUnixMs: Date.now(),
    origin,
    receiptId: crypto.randomUUID(),
    snippetId,
  });
}

export async function clearSnippetUsage(): Promise<number> {
  if (!isTauri()) return 0;
  return invoke<number>("snippet_usage_clear");
}

export async function getSnippetDocument(
  snippetId: string,
): Promise<SnippetDocumentSnapshot> {
  if (!isTauri()) {
    const snippet = browserPreviewSnippets.get(snippetId);
    if (!snippet) throw new Error("片段不存在");
    return { revision: `preview:${snippet.updatedAt}`, snippet };
  }
  return invoke<SnippetDocumentSnapshot>("snippet_document_get", { snippetId });
}

/** 返回隔离后的配置 warning；消息不包含片段命令或变量值。 */
export async function listSnippetDocumentWarnings(): Promise<SnippetDocumentWarning[]> {
  return (await listSnippetDocuments()).warnings;
}

export async function listSnippetDocuments(): Promise<SnippetDocumentList> {
  if (!isTauri()) {
    return { snippets: Array.from(browserPreviewSnippets.values()), warnings: [] };
  }
  return invoke<SnippetDocumentList>("snippet_document_list");
}

export async function patchSnippetDocument(
  snippetId: string,
  patch: SnippetDocumentPatch,
): Promise<SnippetDocumentSnapshot> {
  if (!isTauri()) {
    const snippet = await updateSnippet({
      command: patch.command,
      description: patch.description,
      id: snippetId,
      scope: patch.scope,
      sortOrder: patch.sortOrder,
      tags: patch.tags,
      title: patch.title,
    });
    return { revision: `preview:${snippet.updatedAt}`, snippet };
  }
  return invoke<SnippetDocumentSnapshot>("snippet_document_patch", {
    patch,
    snippetId,
  });
}

export async function deleteSnippetWithReceipt(
  snippetId: string,
): Promise<SnippetDeleteReceipt> {
  if (!isTauri()) {
    if (!browserPreviewSnippets.delete(snippetId)) throw new Error("片段不存在");
    return {
      changeSetId: `preview:${snippetId}`,
      expiresAtUnixMs: Date.now() + 15_000,
      snippetId,
    };
  }
  return invoke<SnippetDeleteReceipt>("snippet_delete_with_receipt", { snippetId });
}

export async function restoreDeletedSnippet(
  receipt: SnippetDeleteReceipt,
): Promise<CommandSnippet> {
  if (!isTauri()) throw new Error("预览模式不支持恢复已删除片段");
  return invoke<CommandSnippet>("snippet_delete_restore", { receipt });
}

export async function createSnippet(
  request: SnippetCreateRequest,
): Promise<CommandSnippet> {
  const normalized = normalizeCreateRequest(request);

  if (!isTauri()) {
    const snippet = previewSnippet({
      ...normalized,
      id: `snippet-preview-${Date.now().toString(36)}`,
      sortOrder: browserPreviewSnippets.size * 10 + 10,
    });
    browserPreviewSnippets.set(snippet.id, snippet);
    return snippet;
  }

  return invoke<CommandSnippet>("snippet_create", { request: normalized });
}

/** 桌面端由单个 recoverable change set 原子写入；浏览器预览在内存中一次提交。 */
export async function importSnippets(
  candidates: readonly SnippetImportCandidate[],
): Promise<CommandSnippet[]> {
  if (!isTauri()) {
    const now = new Date().toISOString();
    const baseOrder = Math.max(
      0,
      ...Array.from(browserPreviewSnippets.values(), (snippet) => snippet.sortOrder),
    );
    const imported = candidates.map((candidate, index): CommandSnippet => ({
      id: `snippet-preview-${crypto.randomUUID()}`,
      title: candidate.title,
      command: candidate.command,
      description: candidate.description ?? null,
      tags: candidate.tags,
      scope: candidate.scope,
      sortOrder: baseOrder + (index + 1) * 10,
      createdAt: now,
      updatedAt: now,
      category: candidate.category ?? null,
      risk: candidate.risk ?? null,
      defaultAction: candidate.defaultAction ?? null,
      variables: candidate.variables,
      contextBindings: candidate.contextBindings,
      derivedFrom: candidate.derivedFrom ?? null,
    }));
    for (const snippet of imported) browserPreviewSnippets.set(snippet.id, snippet);
    return imported;
  }
  return invoke<CommandSnippet[]>("snippet_import", { candidates });
}

export async function updateSnippet(
  request: SnippetUpdateRequest,
): Promise<CommandSnippet> {
  const normalized = normalizeUpdateRequest(request);

  if (!isTauri()) {
    const existing = browserPreviewSnippets.get(normalized.id);
    const snippet: CommandSnippet = {
      ...(existing ?? previewSnippet({ ...normalized, id: normalized.id })),
      ...normalized,
      updatedAt: new Date().toISOString(),
    };
    browserPreviewSnippets.set(snippet.id, snippet);
    return snippet;
  }

  return invoke<CommandSnippet>("snippet_update", { request: normalized });
}

export async function deleteSnippet(snippetId: string): Promise<boolean> {
  if (!isTauri()) {
    return browserPreviewSnippets.delete(snippetId);
  }

  return invoke<boolean>("snippet_delete", { snippetId });
}

function normalizeCreateRequest(
  request: SnippetCreateRequest,
): NormalizedSnippetCreateRequest {
  return {
    command: request.command,
    description: request.description?.trim() || undefined,
    scope: request.scope ?? "any",
    tags: normalizeTags(request.tags ?? []),
    title: request.title,
  };
}

function normalizeUpdateRequest(
  request: SnippetUpdateRequest,
): NormalizedSnippetUpdateRequest {
  return {
    ...normalizeCreateRequest(request),
    id: request.id,
    sortOrder: request.sortOrder,
  };
}

function normalizeTags(tags: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of tags) {
    const value = tag.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
}

function browserPreviewList(request: SnippetListRequest) {
  const query = request.query?.trim().toLowerCase();
  const tag = request.tag?.trim().toLowerCase();

  return Array.from(browserPreviewSnippets.values())
    .filter((snippet) => !request.scope || snippet.scope === request.scope)
    .filter((snippet) =>
      tag ? snippet.tags.some((item) => item.toLowerCase() === tag) : true,
    )
    .filter((snippet) => (query ? snippetMatchesQuery(snippet, query) : true))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title));
}

function snippetMatchesQuery(snippet: CommandSnippet, query: string) {
  return (
    snippet.title.toLowerCase().includes(query) ||
    snippet.command.toLowerCase().includes(query) ||
    (snippet.description ?? "").toLowerCase().includes(query) ||
    snippet.tags.some((tag) => tag.toLowerCase().includes(query))
  );
}

function previewSnippet(
  input: Pick<CommandSnippet, "command" | "id" | "scope" | "tags" | "title"> &
    Partial<Pick<CommandSnippet, "description" | "sortOrder">>,
): CommandSnippet {
  const now = new Date().toISOString();
  return {
    command: input.command,
    createdAt: now,
    description: input.description ?? null,
    id: input.id,
    scope: input.scope,
    sortOrder: input.sortOrder ?? 10,
    tags: input.tags,
    title: input.title,
    updatedAt: now,
    variables: [],
    contextBindings: [],
  };
}

const browserPreviewCatalog: SnippetCatalogItem[] = [
  {
    capabilities: ["ps"],
    category: "system",
    defaultAction: "insert",
    deprecated: false,
    description: "查看当前进程快照。",
    duration: "instant",
    favorite: false,
    id: "snippet.builtin.preview.processes",
    origin: "builtin",
    pack: "core",
    platforms: ["linux", "macos"],
    risk: "inspect",
    scope: "any",
    sensitive: false,
    shells: ["bash", "zsh"],
    sortOrder: 10,
    tags: ["system", "process"],
    template: "ps -ef",
    title: "进程快照",
    updatedAt: "2026-07-13",
    useCount: 0,
    contextBindings: [],
    variables: [],
  },
  {
    capabilities: ["curl"],
    category: "network",
    defaultAction: "insert",
    deprecated: false,
    description: "检查 HTTP 响应头。",
    duration: "instant",
    favorite: false,
    id: "snippet.builtin.preview.http-head",
    origin: "builtin",
    pack: "core",
    platforms: ["linux", "macos", "windows"],
    risk: "inspect",
    scope: "any",
    sensitive: false,
    shells: ["bash", "zsh", "powerShell"],
    sortOrder: 20,
    tags: ["network", "http"],
    template: "curl -I --max-time 10 {{ url }}",
    title: "HTTP 响应头",
    updatedAt: "2026-07-13",
    useCount: 0,
    contextBindings: [],
    variables: [
      {
        description: "完整 HTTP 或 HTTPS URL",
        kind: "url",
        label: "URL",
        name: "url",
        renderStrategy: "shellArg",
        required: true,
        sensitive: false,
        suggestions: [],
      },
    ],
  },
];
