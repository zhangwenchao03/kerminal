import { Copy, Plus, Send, Trash2 } from "lucide-react";
import type { FormEvent } from "react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import { Select } from "../../components/ui/select";
import { cn } from "../../lib/cn";
import type { CommandSnippet, SnippetScope } from "../../lib/snippetApi";
import type { TerminalPane } from "../workspace/types";
import {
  extractSnippetVariables,
  renderSnippetCommand,
} from "./snippetVariables";
import {
  PRESET_TAG,
  buildSnippetVariableValues,
  createScopeOptions,
  getSnippetSendBlocker,
  isPresetSnippetId,
  scopeBadgeClassName,
  scopeShortLabel,
  type SnippetCatalogMode,
} from "./snippetCatalogModel";

export interface SnippetRunState {
  error: string | null;
  sending: boolean;
  snippetId: string;
  status: string | null;
  values: Record<string, string>;
}

export type AddItemType = "snippet" | "workflow";

export const snippetSearchInputClassName =
  "kerminal-field-surface h-9 w-full rounded-xl border pl-9 pr-3 font-mono text-sm text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500";

const snippetFieldClassName =
  "kerminal-field-surface mt-1 h-9 w-full rounded-xl border px-3 text-sm text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500";

const snippetTextareaClassName =
  "kerminal-field-surface mt-1 min-h-40 w-full resize-y rounded-2xl border px-3 py-2 font-mono text-xs leading-5 text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500";

const snippetLabelClassName =
  "text-xs font-medium text-zinc-500 dark:text-zinc-400";

export function snippetFilterButtonClassName(selected: boolean) {
  return cn(
    "kerminal-focus-ring kerminal-pressable inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border px-2.5 font-mono text-[11px]",
    selected
      ? "border-sky-400/25 bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100"
      : "border-transparent text-zinc-500 hover:border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
  );
}

export function snippetSegmentButtonClassName(selected: boolean) {
  return cn(
    "kerminal-focus-ring kerminal-pressable inline-flex h-8 items-center justify-center gap-1.5 rounded-lg font-mono text-[11px]",
    selected
      ? "bg-[var(--surface-selected)] text-zinc-950 shadow-sm shadow-sky-950/5 dark:text-zinc-50 dark:shadow-black/20"
      : "text-zinc-500 hover:bg-[var(--surface-hover)] hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
  );
}

export function SnippetRow({
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
    <article className="px-3 py-2.5 transition-colors hover:bg-[var(--surface-hover)]">
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
                className="kerminal-muted-surface rounded-md border px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 dark:text-zinc-400"
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
        <div className="kerminal-muted-surface kerminal-floating-enter mt-2 rounded-xl border p-2">
          {hasVariables ? (
            <div className="space-y-2">
              {variables.map((name) => (
                <label className="block" key={name}>
                  <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                    var.{name}
                  </span>
                  <input
                    aria-label={`变量 ${name}`}
                    className="kerminal-field-surface mt-1 h-8 w-full rounded-lg border px-2 font-mono text-xs text-zinc-900 dark:text-zinc-100"
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
          <pre className="kerminal-solid-surface mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-lg border p-2 font-mono text-[11px] leading-4 text-zinc-800 dark:text-zinc-200">
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

export function SnippetCreateDialog({
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
      onClose={onClose}
      open={open}
      size="medium"
      title="添加"
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="kerminal-muted-surface grid grid-cols-2 rounded-xl border p-1">
          {(["snippet", "workflow"] as AddItemType[]).map((type) => (
            <button
              aria-pressed={itemType === type}
              className={snippetSegmentButtonClassName(itemType === type)}
              key={type}
              onClick={() => onItemTypeChange(type)}
              type="button"
            >
              {type === "snippet" ? "command" : "workflow"}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <label className="block">
            <span className={snippetLabelClassName}>标题</span>
            <input
              autoFocus
              className={snippetFieldClassName}
              onChange={(event) => onTitleChange(event.currentTarget.value)}
              placeholder={
                itemType === "workflow" ? "例如：发布前检查" : "例如：查看日志"
              }
              value={title}
            />
          </label>
          <label className="block">
            <span className={snippetLabelClassName}>作用域</span>
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
          <span className={snippetLabelClassName}>脚本内容</span>
          <textarea
            className={snippetTextareaClassName}
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
            <span className={snippetLabelClassName}>分组标签</span>
            <input
              className={snippetFieldClassName}
              onChange={(event) => onTagsChange(event.currentTarget.value)}
              placeholder="git, logs, deploy"
              value={tags}
            />
          </label>
          <label className="block">
            <span className={snippetLabelClassName}>说明</span>
            <input
              className={snippetFieldClassName}
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

export function SnippetEmptyState({
  filtered,
  mode,
  onAdd,
}: {
  filtered: boolean;
  mode: SnippetCatalogMode;
  onAdd?: () => void;
}) {
  return (
    <div className="kerminal-muted-surface m-3 rounded-xl border border-dashed px-3 py-8 text-center">
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
