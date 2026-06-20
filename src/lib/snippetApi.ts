import { invoke, isTauri } from "@tauri-apps/api/core";

export type SnippetScope = "any" | "local" | "ssh";

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
      description: "读取 systemd 服务最近日志。",
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
  };
}
