import { Eye, Sparkles } from "lucide-react";
import { Button } from "../../components/ui/button";
import type {
  McpPromptDefinition,
  McpPromptRenderResult,
} from "./toolRegistryModel";

type LoadState = "idle" | "loading" | "error";

interface McpPromptPreviewPanelProps {
  error: string | null;
  onPromptRender: (name: string) => void;
  prompts: McpPromptDefinition[];
  result: McpPromptRenderResult | null;
  selectedPromptName: string | null;
  state: LoadState;
}

export function McpPromptPreviewPanel({
  error,
  onPromptRender,
  prompts,
  result,
  selectedPromptName,
  state,
}: McpPromptPreviewPanelProps) {
  if (prompts.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 rounded-xl border border-zinc-400/15 bg-white/45 p-3 dark:bg-black/15">
      <div className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-200">
        <Sparkles className="h-3.5 w-3.5 text-violet-500 dark:text-violet-300" />
        可预览 Prompts
      </div>
      <div className="mt-2 space-y-2">
        {prompts.map((prompt) => {
          const loading = state === "loading" && selectedPromptName === prompt.name;
          return (
            <div
              className="flex min-w-0 items-start justify-between gap-3 rounded-lg bg-black/[0.03] px-3 py-2 dark:bg-white/5"
              key={prompt.name}
            >
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-100">
                  {prompt.title}
                </div>
                <div className="mt-1 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-500">
                  {prompt.name}
                </div>
                {prompt.arguments.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {prompt.arguments.map((argument) => (
                      <span
                        className="rounded-full border border-zinc-400/20 px-2 py-0.5 text-[11px] text-zinc-500 dark:text-zinc-400"
                        key={argument.name}
                      >
                        {argument.name}
                        {argument.required ? " 必填" : " 可选"}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <Button
                aria-label={`预览 MCP prompt ${prompt.title}`}
                className="shrink-0 gap-1.5"
                disabled={state === "loading"}
                onClick={() => onPromptRender(prompt.name)}
                size="sm"
                variant="secondary"
              >
                <Eye className="h-3.5 w-3.5" />
                {loading ? "渲染中" : "预览"}
              </Button>
            </div>
          );
        })}
      </div>

      {error ? (
        <div
          className="mt-3 rounded-xl border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-100"
          role="alert"
        >
          MCP prompt 渲染失败：{error}
        </div>
      ) : null}

      {result ? (
        <div className="mt-3 rounded-xl border border-violet-400/20 bg-violet-500/10 p-3">
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-violet-800 dark:text-violet-100">
              {result.title}
            </div>
            <div className="mt-1 truncate font-mono text-[11px] text-violet-700/80 dark:text-violet-100/70">
              {result.name} · {result.protocol}
            </div>
          </div>
          <div className="mt-2 text-xs leading-5 text-violet-800/80 dark:text-violet-100/80">
            {result.description}
          </div>
          <div className="mt-3 space-y-2">
            {result.messages.map((message, index) => (
              <div
                className="rounded-lg bg-white/70 p-3 dark:bg-black/25"
                key={`${message.role}-${message.contentType}-${index}`}
              >
                <div className="text-[11px] font-medium uppercase tracking-normal text-violet-700 dark:text-violet-100">
                  {promptRoleLabel(message.role)} · {message.contentType}
                </div>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-zinc-700 dark:text-zinc-200">
                  {message.text}
                </pre>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function promptRoleLabel(role: string) {
  if (role === "assistant") {
    return "assistant";
  }
  return "user";
}
