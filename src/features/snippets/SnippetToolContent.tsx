import {
  Copy,
  Plus,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import { Select } from "../../components/ui/select";
import { cn } from "../../lib/cn";
import {
  createSnippet,
  deleteSnippet,
  listSnippets,
  type CommandSnippet,
  type SnippetScope,
} from "../../lib/snippetApi";
import {
  createWorkflow,
  type WorkflowScope,
} from "../../lib/workflowApi";
import { writeSnippetCommand } from "../terminal/terminalSessionRegistry";
import type { TerminalPane } from "../workspace/types";
import {
  extractSnippetVariables,
  renderSnippetCommand,
} from "./snippetVariables";
import {
  PRESET_TAG,
  buildSnippetVariableValues,
  collectTagGroups,
  createScopeOptions,
  filterPresetSnippets,
  getSnippetSendBlocker,
  groupSnippets,
  isPresetSnippetId,
  parseTags,
  scopeBadgeClassName,
  scopeShortLabel,
  snippetHasTag,
  snippetScopeOptions,
  type SnippetCatalogMode,
} from "./snippetCatalogModel";

interface SnippetToolContentProps {
  activeTabId?: string;
  focusedPane?: TerminalPane;
}

interface SnippetRunState {
  error: string | null;
  sending: boolean;
  snippetId: string;
  status: string | null;
  values: Record<string, string>;
}

type AddItemType = "snippet" | "workflow";

export function SnippetToolContent({
  activeTabId,
  focusedPane,
}: SnippetToolContentProps) {
  const [activeTag, setActiveTag] = useState("");
  const [catalogMode, setCatalogMode] = useState<SnippetCatalogMode>("mine");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [command, setCommand] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createType, setCreateType] = useState<AddItemType>("snippet");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [runState, setRunState] = useState<SnippetRunState | null>(null);
  const [saving, setSaving] = useState(false);
  const [scope, setScope] = useState<SnippetScope | "">("");
  const [snippets, setSnippets] = useState<CommandSnippet[]>([]);
  const [snippetScope, setSnippetScope] = useState<SnippetScope>("any");
  const [tags, setTags] = useState("");
  const [title, setTitle] = useState("");

  const presetSnippetsView = useMemo(
    () => filterPresetSnippets({ query, scope }),
    [query, scope],
  );
  const currentSnippets =
    catalogMode === "preset" ? presetSnippetsView : snippets;
  const tagGroups = useMemo(
    () =>
      collectTagGroups(
        currentSnippets,
        catalogMode === "preset" ? [PRESET_TAG] : [],
      ),
    [catalogMode, currentSnippets],
  );
  const visibleSnippets = useMemo(
    () =>
      activeTag
        ? currentSnippets.filter((snippet) => snippetHasTag(snippet, activeTag))
        : currentSnippets,
    [activeTag, currentSnippets],
  );
  const groupedSnippets = useMemo(
    () => groupSnippets(visibleSnippets, activeTag),
    [activeTag, visibleSnippets],
  );
  const hasActiveFilters = Boolean(query.trim() || scope || activeTag);
  const listModeLabel = catalogMode === "preset" ? "preset" : "mine";

  const loadSnippets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextSnippets = await listSnippets({
        query: query || undefined,
        scope: scope || undefined,
      });
      setSnippets(nextSnippets);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setLoading(false);
    }
  }, [query, scope]);

  useEffect(() => {
    void loadSnippets();
  }, [loadSnippets]);

  useEffect(() => {
    if (!activeTag) {
      return;
    }
    if (!tagGroups.some((group) => group.tag === activeTag)) {
      setActiveTag("");
    }
  }, [activeTag, tagGroups]);

  const resetCreateForm = () => {
    setCreateType("snippet");
    setTitle("");
    setCommand("");
    setDescription("");
    setTags("");
    setSnippetScope("any");
    setFormError(null);
  };

  const openCreateDialog = () => {
    setFormError(null);
    setCreateOpen(true);
  };

  const closeCreateDialog = () => {
    if (saving) {
      return;
    }
    setCreateOpen(false);
    resetCreateForm();
  };

  const createCurrentItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedCommand = command.trim();
    if (!trimmedTitle || !trimmedCommand) {
      setFormError("请输入标题和脚本内容。");
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      if (createType === "workflow") {
        await createWorkflow({
          description: description.trim(),
          scope: snippetScope as WorkflowScope,
          steps: [
            {
              command: trimmedCommand,
              description: description.trim() || undefined,
              requiresConfirmation: false,
              title: trimmedTitle,
            },
          ],
          tags: parseTags(tags),
          title: trimmedTitle,
        });
      } else {
        await createSnippet({
          command: trimmedCommand,
          description: description.trim(),
          scope: snippetScope,
          tags: parseTags(tags),
          title: trimmedTitle,
        });
        await loadSnippets();
      }
      setCreateOpen(false);
      resetCreateForm();
    } catch (nextError) {
      setFormError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteCurrentSnippet = async (snippetId: string) => {
    if (isPresetSnippetId(snippetId)) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await deleteSnippet(snippetId);
      await loadSnippets();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setLoading(false);
    }
  };

  const copySnippetCommand = async (snippet: CommandSnippet) => {
    try {
      await navigator.clipboard?.writeText(snippet.command);
      setCopiedId(snippet.id);
      window.setTimeout(() => setCopiedId(null), 1200);
    } catch {
      setCopiedId(null);
    }
  };

  const updateSnippetVariable = (
    snippetId: string,
    name: string,
    value: string,
  ) => {
    setRunState((current) => {
      if (!current || current.snippetId !== snippetId) {
        return current;
      }
      return {
        ...current,
        error: null,
        status: null,
        values: {
          ...current.values,
          [name]: value,
        },
      };
    });
  };

  const openSnippetRunPanel = (snippet: CommandSnippet) => {
    const variables = extractSnippetVariables(snippet.command);
    setRunState((current) => {
      if (current?.snippetId === snippet.id) {
        return null;
      }
      return {
        error: null,
        sending: false,
        snippetId: snippet.id,
        status: null,
        values: buildSnippetVariableValues(variables),
      };
    });
  };

  const executeSnippet = async (
    snippet: CommandSnippet,
    values: Record<string, string>,
  ) => {
    const variables = extractSnippetVariables(snippet.command);
    const normalizedValues = buildSnippetVariableValues(variables, values);
    const blocker = getSnippetSendBlocker(snippet, focusedPane);
    if (blocker) {
      setRunState({
        error: blocker,
        sending: false,
        snippetId: snippet.id,
        status: null,
        values: normalizedValues,
      });
      return;
    }

    const renderedCommand = renderSnippetCommand(
      snippet.command,
      normalizedValues,
    ).trim();
    if (!renderedCommand) {
      setRunState({
        error: "片段渲染后为空，无法发送。",
        sending: false,
        snippetId: snippet.id,
        status: null,
        values: normalizedValues,
      });
      return;
    }

    setRunState({
      error: null,
      sending: true,
      snippetId: snippet.id,
      status: null,
      values: normalizedValues,
    });
    try {
      const result = await writeSnippetCommand({
        command: renderedCommand,
        paneId: focusedPane?.id ?? "",
        tabId: activeTabId,
      });
      if (!result.sent) {
        throw new Error(
          result.reason === "missing-session"
            ? "当前分屏尚未连接，无法发送片段。"
            : "片段渲染后为空，无法发送。",
        );
      }
      setRunState({
        error: null,
        sending: false,
        snippetId: snippet.id,
        status: `已发送到 ${focusedPane?.title ?? "当前分屏"}。`,
        values: normalizedValues,
      });
    } catch (nextError) {
      setRunState({
        error:
          nextError instanceof Error ? nextError.message : String(nextError),
        sending: false,
        snippetId: snippet.id,
        status: null,
        values: normalizedValues,
      });
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">搜索片段</span>
          <Search
            className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400"
            strokeWidth={1.8}
          />
          <input
            className="h-9 w-full rounded-xl border border-black/8 bg-white/70 pl-9 pr-3 font-mono text-sm text-zinc-900 outline-none transition focus:border-sky-500/50 focus:ring-4 focus:ring-sky-500/15 dark:border-white/10 dark:bg-white/8 dark:text-zinc-100"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="grep title tag command"
            value={query}
          />
        </label>
        <Button
          aria-label="添加脚本片段"
          className="h-9 w-9 rounded-xl"
          onClick={openCreateDialog}
          size="icon"
          title="添加"
          type="button"
          variant="primary"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {snippetScopeOptions.map((option) => {
          const selected = scope === option.value;
          return (
            <button
              aria-pressed={selected}
              className={cn(
                "h-7 rounded-lg border border-transparent px-2.5 font-mono text-[11px] text-zinc-500 transition hover:border-black/8 hover:bg-black/[0.035] hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0A84FF]/15 dark:text-zinc-400 dark:hover:border-white/8 dark:hover:bg-white/8 dark:hover:text-zinc-100",
                selected &&
                  "border-sky-400/25 bg-sky-500/10 text-sky-700 dark:bg-sky-400/15 dark:text-sky-100",
              )}
              key={option.value}
              onClick={() => setScope(option.value as SnippetScope | "")}
              type="button"
            >
              {option.value || "*"}:{option.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 rounded-xl border border-black/8 bg-black/[0.025] p-1 dark:border-white/8 dark:bg-black/20">
        {(
          [
            { count: snippets.length, label: "我的片段", value: "mine" },
            {
              count: presetSnippetsView.length,
              label: "预设命令",
              value: "preset",
            },
          ] as const
        ).map((option) => {
          const selected = catalogMode === option.value;
          return (
            <button
              aria-label={`${option.label} ${option.count}`}
              aria-pressed={selected}
              className={cn(
                "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg font-mono text-[11px] text-zinc-500 transition hover:bg-white/70 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0A84FF]/15 dark:text-zinc-400 dark:hover:bg-white/8 dark:hover:text-zinc-100",
                selected &&
                  "bg-white text-zinc-950 shadow-sm shadow-black/[0.04] dark:bg-white/12 dark:text-zinc-50 dark:shadow-black/20",
              )}
              key={option.value}
              onClick={() => {
                setCatalogMode(option.value);
                setActiveTag("");
              }}
              type="button"
            >
              {option.label}
              <span className="text-[10px] opacity-60">{option.count}</span>
            </button>
          );
        })}
      </div>

      {tagGroups.length > 0 ? (
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto pb-1">
          <button
            aria-pressed={!activeTag}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-black/8 px-2.5 font-mono text-[11px] text-zinc-500 transition hover:bg-black/[0.035] hover:text-zinc-900 dark:border-white/8 dark:text-zinc-400 dark:hover:bg-white/8 dark:hover:text-zinc-100",
              !activeTag &&
                "border-sky-400/25 bg-sky-500/10 text-sky-700 dark:bg-sky-400/15 dark:text-sky-100",
            )}
            onClick={() => setActiveTag("")}
            type="button"
          >
            tag:* <span className="opacity-60">{currentSnippets.length}</span>
          </button>
          {tagGroups.map((group) => {
            const selected = activeTag === group.tag;
            return (
              <button
                aria-pressed={selected}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-black/8 px-2.5 font-mono text-[11px] text-zinc-500 transition hover:bg-black/[0.035] hover:text-zinc-900 dark:border-white/8 dark:text-zinc-400 dark:hover:bg-white/8 dark:hover:text-zinc-100",
                  selected &&
                    "border-sky-400/25 bg-sky-500/10 text-sky-700 dark:bg-sky-400/15 dark:text-sky-100",
                )}
                key={group.tag}
                onClick={() => setActiveTag(group.tag)}
                type="button"
              >
                #{group.tag} <span className="opacity-60">{group.count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {error ? (
        <div
          className="rounded-xl border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-100"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-black/8 bg-white/60 dark:border-white/8 dark:bg-white/[0.045]">
        <div className="flex items-center justify-between border-b border-black/6 px-3 py-2 dark:border-white/6">
          <span className="font-mono text-[11px] text-zinc-400">
            {listModeLabel}[{visibleSnippets.length}/{currentSnippets.length}]
          </span>
          <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
            {activeTag ? `#${activeTag}` : scope || "all"}
          </span>
        </div>

        {catalogMode === "mine" && loading && snippets.length === 0 ? (
          <div className="px-3 py-8 text-center font-mono text-xs text-zinc-500 dark:text-zinc-400">
            loading snippets...
          </div>
        ) : null}
        {!loading && visibleSnippets.length === 0 ? (
          <SnippetEmptyState
            filtered={hasActiveFilters}
            mode={catalogMode}
            onAdd={catalogMode === "mine" ? openCreateDialog : undefined}
          />
        ) : null}
        {groupedSnippets.map((group) => (
          <div key={group.id}>
            <div className="border-b border-black/6 bg-black/[0.025] px-3 py-1.5 font-mono text-[11px] text-zinc-500 dark:border-white/6 dark:bg-black/20 dark:text-zinc-400">
              {group.label} / {group.snippets.length}
            </div>
            <div className="divide-y divide-black/6 dark:divide-white/6">
              {group.snippets.map((snippet) => (
                <SnippetRow
                  copied={copiedId === snippet.id}
                  focusedPane={focusedPane}
                  key={snippet.id}
                  loading={loading}
                  onCopy={copySnippetCommand}
                  onDelete={deleteCurrentSnippet}
                  onExecute={executeSnippet}
                  onOpenRunPanel={openSnippetRunPanel}
                  onVariableChange={updateSnippetVariable}
                  runState={runState?.snippetId === snippet.id ? runState : null}
                  snippet={snippet}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <SnippetCreateDialog
        command={command}
        description={description}
        error={formError}
        itemType={createType}
        onClose={closeCreateDialog}
        onCommandChange={setCommand}
        onDescriptionChange={setDescription}
        onItemTypeChange={setCreateType}
        onScopeChange={setSnippetScope}
        onSubmit={createCurrentItem}
        onTagsChange={setTags}
        onTitleChange={setTitle}
        open={createOpen}
        saving={saving}
        scope={snippetScope}
        tags={tags}
        title={title}
      />
    </section>
  );
}

function SnippetRow({
  copied,
  focusedPane,
  loading,
  onCopy,
  onDelete,
  onExecute,
  onOpenRunPanel,
  onVariableChange,
  runState,
  snippet,
}: {
  copied: boolean;
  focusedPane?: TerminalPane;
  loading: boolean;
  onCopy: (snippet: CommandSnippet) => Promise<void>;
  onDelete: (snippetId: string) => Promise<void>;
  onExecute: (
    snippet: CommandSnippet,
    values: Record<string, string>,
  ) => Promise<void>;
  onOpenRunPanel: (snippet: CommandSnippet) => void;
  onVariableChange: (snippetId: string, name: string, value: string) => void;
  runState: SnippetRunState | null;
  snippet: CommandSnippet;
}) {
  const variables = extractSnippetVariables(snippet.command);
  const values = buildSnippetVariableValues(variables, runState?.values);
  const renderedCommand = renderSnippetCommand(snippet.command, values).trim();
  const missingVariables = variables.filter((name) => !values[name]?.trim());
  const sendBlocker = getSnippetSendBlocker(snippet, focusedPane);
  const preset = isPresetSnippetId(snippet.id);
  const displayedTags = snippet.tags
    .filter((tag) => !(preset && tag === PRESET_TAG))
    .slice(0, 2);
  const firstLine = snippet.command.split(/\r?\n/)[0] ?? "";
  const hasVariables = variables.length > 0;
  const canSend =
    !sendBlocker &&
    !runState?.sending &&
    renderedCommand.length > 0 &&
    missingVariables.length === 0;

  return (
    <article className="px-3 py-2 transition hover:bg-black/[0.025] dark:hover:bg-white/[0.045]">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-mono text-xs text-sky-600 dark:text-sky-300">
              $
            </span>
            <h3 className="min-w-0 truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              {snippet.title}
            </h3>
            <span
              className={cn(
                "shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[10px]",
                scopeBadgeClassName(snippet.scope),
              )}
            >
              {scopeShortLabel(snippet.scope)}
            </span>
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <code className="min-w-0 truncate font-mono text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
              {firstLine || "empty command"}
            </code>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {displayedTags.map((tag) => (
              <span
                className="rounded-md border border-black/8 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 dark:border-white/8 dark:text-zinc-400"
                key={tag}
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button
            aria-label={`运行片段 ${snippet.title}`}
            className="h-8 w-8"
            disabled={hasVariables ? false : !canSend}
            onClick={() =>
              hasVariables
                ? onOpenRunPanel(snippet)
                : void onExecute(snippet, {})
            }
            size="icon"
            title={hasVariables ? "填参运行" : "运行"}
            variant="ghost"
          >
            <Send className="h-4 w-4" />
          </Button>
          <Button
            aria-label={`复制片段 ${snippet.title}`}
            className="h-8 w-8"
            onClick={() => void onCopy(snippet)}
            size="icon"
            title={copied ? "已复制" : "复制"}
            variant="ghost"
          >
            <Copy className="h-4 w-4" />
          </Button>
          {preset ? null : (
            <Button
              aria-label={`删除片段 ${snippet.title}`}
              className="h-8 w-8"
              disabled={loading}
              onClick={() => void onDelete(snippet.id)}
              size="icon"
              title="删除"
              variant="danger"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {runState ? (
        <div className="mt-2 rounded-xl border border-black/8 bg-black/[0.025] p-2 dark:border-white/8 dark:bg-black/20">
          {hasVariables ? (
            <div className="space-y-2">
              {variables.map((name) => (
                <label className="block" key={name}>
                  <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                    var.{name}
                  </span>
                  <input
                    aria-label={`变量 ${name}`}
                    className="mt-1 h-8 w-full rounded-lg border border-black/8 bg-white/80 px-2 font-mono text-xs text-zinc-900 outline-none transition focus:border-sky-500/50 focus:ring-4 focus:ring-sky-500/15 dark:border-white/10 dark:bg-white/8 dark:text-zinc-100"
                    onChange={(event) =>
                      onVariableChange(
                        snippet.id,
                        name,
                        event.currentTarget.value,
                      )
                    }
                    value={values[name] ?? ""}
                  />
                </label>
              ))}
            </div>
          ) : null}
          <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white/70 p-2 font-mono text-[11px] leading-4 text-zinc-800 dark:bg-black/30 dark:text-zinc-200">
            {renderedCommand || "waiting for vars"}
          </pre>
          {runState.error ? (
            <div
              className="mt-2 rounded-lg border border-rose-300/25 bg-rose-500/10 px-2 py-1 text-xs text-rose-700 dark:text-rose-100"
              role="alert"
            >
              {runState.error}
            </div>
          ) : null}
          {runState.status ? (
            <div
              className="mt-2 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-700 dark:text-emerald-100"
              role="status"
            >
              {runState.status}
            </div>
          ) : null}
          <Button
            className="mt-2 w-full"
            disabled={!canSend}
            onClick={() => void onExecute(snippet, values)}
            size="sm"
            variant="primary"
          >
            <Send className="h-4 w-4" />
            {runState.sending ? "发送中" : "发送到当前分屏"}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

interface SnippetCreateDialogProps {
  command: string;
  description: string;
  error: string | null;
  itemType: AddItemType;
  open: boolean;
  saving: boolean;
  scope: SnippetScope;
  tags: string;
  title: string;
  onClose: () => void;
  onCommandChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onItemTypeChange: (value: AddItemType) => void;
  onScopeChange: (value: SnippetScope) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTagsChange: (value: string) => void;
  onTitleChange: (value: string) => void;
}

function SnippetCreateDialog({
  command,
  description,
  error,
  itemType,
  onClose,
  onCommandChange,
  onDescriptionChange,
  onItemTypeChange,
  onScopeChange,
  onSubmit,
  onTagsChange,
  onTitleChange,
  open,
  saving,
  scope,
  tags,
  title,
}: SnippetCreateDialogProps) {
  return (
    <ModalShell
      description="选择类型后保存脚本内容。"
      maxWidthClassName="max-w-2xl"
      onClose={onClose}
      open={open}
      title="添加"
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="grid grid-cols-2 rounded-2xl border border-black/8 bg-black/[0.025] p-1 dark:border-white/8 dark:bg-black/20">
          {(["snippet", "workflow"] as AddItemType[]).map((type) => {
            const selected = itemType === type;
            return (
              <button
                aria-pressed={selected}
                className={cn(
                  "h-9 rounded-xl font-mono text-xs text-zinc-500 transition hover:bg-white/70 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0A84FF]/15 dark:text-zinc-400 dark:hover:bg-white/8 dark:hover:text-zinc-100",
                  selected &&
                    "bg-white text-zinc-950 shadow-sm shadow-black/[0.04] dark:bg-white/12 dark:text-zinc-50 dark:shadow-black/20",
                )}
                key={type}
                onClick={() => onItemTypeChange(type)}
                type="button"
              >
                {type === "snippet" ? "command" : "workflow"}
              </button>
            );
          })}
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <label className="block">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              标题
            </span>
            <input
              autoFocus
              className="mt-1 h-9 w-full rounded-xl border border-black/8 bg-white/80 px-3 text-sm text-zinc-900 outline-none transition focus:border-sky-500/50 focus:ring-4 focus:ring-sky-500/15 dark:border-white/10 dark:bg-white/8 dark:text-zinc-100"
              onChange={(event) => onTitleChange(event.currentTarget.value)}
              placeholder={
                itemType === "workflow" ? "例如：发布前检查" : "例如：查看日志"
              }
              value={title}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              作用域
            </span>
            <Select
              aria-label="脚本片段作用域"
              className="mt-1"
              onValueChange={(value) => onScopeChange(value as SnippetScope)}
              options={createScopeOptions}
              value={scope}
            />
          </label>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            脚本内容
          </span>
          <textarea
            className="mt-1 min-h-40 w-full resize-y rounded-2xl border border-black/8 bg-white/80 px-3 py-2 font-mono text-xs leading-5 text-zinc-900 outline-none transition focus:border-sky-500/50 focus:ring-4 focus:ring-sky-500/15 dark:border-white/10 dark:bg-white/8 dark:text-zinc-100"
            onChange={(event) => onCommandChange(event.currentTarget.value)}
            placeholder={
              itemType === "workflow"
                ? "输入 workflow 的首个步骤命令"
                : "输入命令或多行脚本"
            }
            value={command}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              分组标签
            </span>
            <input
              className="mt-1 h-9 w-full rounded-xl border border-black/8 bg-white/80 px-3 text-sm text-zinc-900 outline-none transition focus:border-sky-500/50 focus:ring-4 focus:ring-sky-500/15 dark:border-white/10 dark:bg-white/8 dark:text-zinc-100"
              onChange={(event) => onTagsChange(event.currentTarget.value)}
              placeholder="git, logs, deploy"
              value={tags}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              说明
            </span>
            <input
              className="mt-1 h-9 w-full rounded-xl border border-black/8 bg-white/80 px-3 text-sm text-zinc-900 outline-none transition focus:border-sky-500/50 focus:ring-4 focus:ring-sky-500/15 dark:border-white/10 dark:bg-white/8 dark:text-zinc-100"
              onChange={(event) =>
                onDescriptionChange(event.currentTarget.value)
              }
              placeholder="可选"
              value={description}
            />
          </label>
        </div>

        {error ? (
          <div
            className="rounded-xl border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-100"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="ghost">
            取消
          </Button>
          <Button
            disabled={saving || !title.trim() || !command.trim()}
            type="submit"
            variant="primary"
          >
            <Plus className="h-4 w-4" />
            {saving
              ? "保存中..."
              : itemType === "workflow"
                ? "保存工作流"
                : "保存片段"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function SnippetEmptyState({
  filtered,
  mode,
  onAdd,
}: {
  filtered: boolean;
  mode: SnippetCatalogMode;
  onAdd?: () => void;
}) {
  return (
    <div className="px-3 py-8 text-center">
      <div className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
        {filtered
          ? "no matches"
          : mode === "preset"
            ? "empty presets"
            : "empty snippets"}
      </div>
      {onAdd ? (
        <Button className="mt-3" onClick={onAdd} size="sm" type="button">
          <Plus className="h-4 w-4" />
          添加片段
        </Button>
      ) : null}
    </div>
  );
}
