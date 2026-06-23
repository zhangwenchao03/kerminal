import {
  Bot,
  CheckCircle2,
  FlaskConical,
  Globe2,
  KeyRound,
  Plus,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Select, type SelectOption } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { cn } from "../../lib/cn";
import {
  createLlmProvider,
  deleteLlmProvider,
  listLlmProviders,
  testLlmProvider,
  updateLlmProvider,
} from "../../lib/llmProviderApi";
import {
  defaultLlmProviderDraft,
  draftFromProvider,
  normalizeLlmProviderDraft,
  type LlmContextStrategy,
  type LlmProvider,
  type LlmProviderCreateRequest,
  type LlmProviderFormDraft,
  type LlmProviderKind,
  type LlmReasoningEffort,
} from "./llmProviderModel";

type OperationState =
  | "idle"
  | "loading"
  | "saving"
  | "testing"
  | "error"
  | "ok";

const CONTEXT_WINDOW_TOKENS_PER_K = 1000;
const CONTEXT_WINDOW_MIN_K = 1;
const CONTEXT_WINDOW_MAX_K = 2000;
const llmSecondaryButtonClass =
  "kerminal-focus-ring kerminal-pressable kerminal-muted-surface inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-sm text-zinc-700 transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-200";

const contextOptions: Array<{
  label: string;
  value: LlmContextStrategy;
}> = [
  { label: "最小上下文", value: "minimal" },
  { label: "当前终端", value: "currentTerminal" },
  { label: "当前工作区", value: "currentWorkspace" },
];

const reasoningOptions: Array<{
  label: string;
  value: LlmReasoningEffort;
}> = [
  { label: "使用模型默认", value: "modelDefault" },
  { label: "Minimal", value: "minimal" },
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
];

const providerKindOptions: Array<{
  help: string;
  label: string;
  value: LlmProviderKind;
}> = [
  {
    help: "按 OpenAI Responses API 发送请求；Base URL 在下方填写，可使用官方地址或兼容代理。",
    label: "OpenAI Responses",
    value: "openAiResponses",
  },
  {
    help: "按 OpenAI Chat Completions API 发送请求；Base URL 在下方填写。",
    label: "OpenAI Chat",
    value: "openAiChat",
  },
  {
    help: "按 Anthropic Messages API 发送请求；Base URL 在下方填写。",
    label: "Anthropic",
    value: "anthropic",
  },
];

export function LlmProviderSettingsSection() {
  const [apiKey, setApiKey] = useState("");
  const [draft, setDraft] = useState<LlmProviderFormDraft>(
    defaultLlmProviderDraft,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [state, setState] = useState<OperationState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let ignored = false;
    setState("loading");
    setLoadError(null);
    listLlmProviders()
      .then((nextProviders) => {
        if (ignored) {
          return;
        }
        setProviders(nextProviders);
        const selected =
          nextProviders.find((provider) => provider.isDefault) ??
          nextProviders[0];
        if (selected) {
          setSelectedId(selected.id);
          setDraft(draftFromProvider(selected));
        }
        setLoadError(null);
        setState("idle");
      })
      .catch((error: unknown) => {
        if (ignored) {
          return;
        }
        const message = errorMessage(error);
        setLoadError(message);
        setState("error");
      });

    return () => {
      ignored = true;
    };
  }, []);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedId) ?? null,
    [providers, selectedId],
  );

  const updateDraft = (patch: Partial<LlmProviderFormDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setMessage(null);
    if (state === "ok" || state === "error") {
      setState("idle");
    }
  };

  const selectProvider = (provider: LlmProvider) => {
    setSelectedId(provider.id);
    setDraft(draftFromProvider(provider));
    setApiKey("");
    setMessage(null);
    setLoadError(null);
    setState("idle");
  };

  const createNewDraft = () => {
    setSelectedId(null);
    setDraft(defaultLlmProviderDraft);
    setApiKey("");
    setMessage(null);
    setState("idle");
  };

  const updateModelName = (model: string) => {
    updateDraft({
      model,
      modelList: model.trim() ? [model] : [],
    });
  };

  const saveProvider = async () => {
    const normalizedDraft = normalizeLlmProviderDraft(draft);
    const request = providerRequestFromDraft(normalizedDraft);
    setState("saving");
    setMessage(null);

    try {
      const saved = normalizedDraft.id
        ? await updateLlmProvider({
            ...request,
            apiKey: apiKey.trim() || undefined,
            clearApiKey: false,
            id: normalizedDraft.id,
          })
        : await createLlmProvider({
            ...request,
            apiKey: apiKey.trim() || undefined,
          });

      setProviders((current) => {
        const withoutSaved = current.filter(
          (provider) => provider.id !== saved.id,
        );
        const nextProviders = saved.isDefault
          ? withoutSaved.map((provider) => ({ ...provider, isDefault: false }))
          : withoutSaved;
        return [saved, ...nextProviders];
      });
      setSelectedId(saved.id);
      setDraft(draftFromProvider(saved));
      setApiKey("");
      setMessage("API 环境已保存，API key 不会在界面回显。");
      setState("ok");
    } catch (error) {
      setMessage(errorMessage(error));
      setState("error");
    }
  };

  const runDryTest = async () => {
    if (!draft.id) {
      setMessage("请先保存 API 环境后再测试。");
      setState("error");
      return;
    }

    setState("testing");
    setMessage(null);
    try {
      const result = await testLlmProvider(draft.id);
      setMessage(result.message);
      setState(result.ok ? "ok" : "error");
    } catch (error) {
      setMessage(errorMessage(error));
      setState("error");
    }
  };

  const removeProvider = async () => {
    if (!draft.id) {
      createNewDraft();
      return;
    }

    setState("saving");
    setMessage(null);
    try {
      await deleteLlmProvider(draft.id);
      const nextProviders = providers.filter(
        (provider) => provider.id !== draft.id,
      );
      setProviders(nextProviders);
      const selected =
        nextProviders.find((provider) => provider.isDefault) ??
        nextProviders[0];
      if (selected) {
        setSelectedId(selected.id);
        setDraft(draftFromProvider(selected));
      } else {
        createNewDraft();
      }
      setMessage("API 环境已删除。");
      setState("ok");
    } catch (error) {
      setMessage(errorMessage(error));
      setState("error");
    }
  };

  return (
    <section className="kerminal-solid-surface rounded-2xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            <Bot className="h-4 w-4 text-sky-500 dark:text-sky-300" />
            LLM Provider
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            把 API 环境、模型参数和网络覆盖项分开配置；API key
            存入系统凭据管理，SQLite 只保存引用。
          </p>
        </div>
        <button
          aria-label="新增 API 环境"
          className="kerminal-focus-ring kerminal-pressable kerminal-muted-surface inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium text-zinc-700 transition hover:bg-[var(--surface-hover)] dark:text-zinc-200"
          onClick={createNewDraft}
          title="新增 API 环境"
          type="button"
        >
          <Plus className="h-4 w-4" />
          新增环境
        </button>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(180px,0.28fr)_minmax(0,1fr)]">
        <aside className="kerminal-muted-surface rounded-xl border p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              API 环境
            </div>
            <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-field)] px-2 py-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              {providers.length} 个
            </span>
          </div>

          {providers.length > 0 ? (
            <div className="mt-3 grid gap-1.5">
              {providers.map((provider) => (
                <button
                  aria-pressed={provider.id === selectedId}
                  className={cn(
                    "kerminal-focus-ring kerminal-pressable flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition",
                    provider.id === selectedId
                      ? "border-sky-500/45 bg-[var(--surface-selected)] text-zinc-950 shadow-sm shadow-sky-950/10 dark:border-sky-300/35 dark:text-zinc-50"
                      : "border-transparent bg-transparent text-zinc-700 hover:border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] dark:text-zinc-300",
                  )}
                  key={provider.id}
                  onClick={() => selectProvider(provider)}
                  title={`编辑 ${provider.name}`}
                  type="button"
                >
                  <span className="min-w-0 truncate text-sm font-medium">
                    {provider.name}
                  </span>
                  {provider.id === selectedId ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-sky-500 dark:text-sky-200" />
                  ) : null}
                </button>
              ))}
            </div>
          ) : state === "loading" ? (
            <div
              className="kerminal-muted-surface mt-3 rounded-xl border px-3 py-4 text-sm leading-6 text-zinc-500 dark:text-zinc-400"
              role="status"
            >
              正在读取 API 环境...
            </div>
          ) : loadError ? (
            <div
              className="mt-3 rounded-xl border border-rose-300/25 bg-rose-500/10 px-3 py-4 text-sm leading-6 text-rose-700 dark:text-rose-100"
              role="alert"
            >
              {loadError}
            </div>
          ) : (
            <div className="kerminal-muted-surface mt-3 rounded-xl border border-dashed px-3 py-4 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
              还没有 API 环境。填写右侧配置后保存。
            </div>
          )}
        </aside>

        <div className="min-w-0 space-y-4">
          <section className="kerminal-muted-surface rounded-xl border p-4">
            <SettingsGroupHeading
              description="决定请求发往哪里，以及凭据如何引用。"
              icon={Globe2}
              title="连接配置"
            />
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <TextField
                label="环境名称"
                onChange={(name) => updateDraft({ name })}
                value={draft.name}
              />
              <SelectField
                help={providerKindHelp(draft.kind)}
                label="供应商接口"
                onChange={(kind) =>
                  updateDraft({ kind: kind as LlmProviderKind })
                }
                options={providerKindOptions.map((option) => ({
                  description: option.help,
                  label: option.label,
                  value: option.value,
                }))}
                value={draft.kind}
              />
              <div className="md:col-span-2">
                <TextField
                  help="按实际服务商或代理地址填写，例如 OpenAI 官方地址、Anthropic 官方地址或兼容网关。"
                  label="API 地址"
                  onChange={(baseUrl) => updateDraft({ baseUrl })}
                  placeholder="https://api.openai.com/v1"
                  value={draft.baseUrl}
                />
              </div>
              <label className="block">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  API Key
                </span>
                <div className="kerminal-field-surface mt-1 flex h-9 items-center rounded-xl border px-2">
                  <KeyRound className="h-4 w-4 text-zinc-400" />
                  <input
                    aria-label="API Key"
                    className="min-w-0 flex-1 bg-transparent px-2 text-sm text-zinc-950 outline-none dark:text-zinc-100"
                    onChange={(event) => setApiKey(event.currentTarget.value)}
                    placeholder={
                      draft.apiKeyConfigured
                        ? "已保存，留空则保持不变"
                        : "sk-..."
                    }
                    type="password"
                    value={apiKey}
                  />
                </div>
              </label>
              <TextField
                help="输入要调用的模型名称；保存时会作为当前 API 环境的唯一模型。"
                label="模型名称"
                onChange={updateModelName}
                placeholder="gpt-5.5"
                value={draft.model}
              />
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="kerminal-muted-surface rounded-xl border p-4">
              <SettingsGroupHeading
                description="控制上下文体量、推理强度和失败重试。"
                icon={SlidersHorizontal}
                title="模型参数"
              />
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <ContextWindowField
                  onChange={(contextWindowTokens) =>
                    updateDraft({ contextWindowTokens })
                  }
                  value={draft.contextWindowTokens}
                />
                <SelectField
                  help="不支持该字段的模型会保持默认，不强行附加推理参数。"
                  label="思考强度"
                  onChange={(reasoningEffort) =>
                    updateDraft({
                      reasoningEffort: reasoningEffort as LlmReasoningEffort,
                    })
                  }
                  options={reasoningOptions}
                  value={draft.reasoningEffort}
                />
                <NumberField
                  label="Temperature"
                  max={2}
                  min={0}
                  onChange={(temperature) => updateDraft({ temperature })}
                  step={0.1}
                  value={draft.temperature}
                />
                <NumberField
                  help="遇到 429、超时或 5xx 临时错误时自动重试；0 表示关闭重试。"
                  label="最大重试次数"
                  max={10}
                  min={0}
                  onChange={(maxRetries) => updateDraft({ maxRetries })}
                  value={draft.maxRetries}
                />
                <div className="sm:col-span-2">
                  <SelectField
                    label="上下文策略"
                    onChange={(contextStrategy) =>
                      updateDraft({
                        contextStrategy: contextStrategy as LlmContextStrategy,
                      })
                    }
                    options={contextOptions}
                    value={draft.contextStrategy}
                  />
                </div>
              </div>
            </section>

            <section className="kerminal-muted-surface rounded-xl border p-4">
              <SettingsGroupHeading
                description="只在这个环境生效，适合代理和网关调试。"
                icon={ShieldCheck}
                title="环境状态"
              />
              <div className="mt-4 grid gap-3">
                <TextField
                  label="自定义 User-Agent"
                  onChange={(userAgent) => updateDraft({ userAgent })}
                  placeholder="留空使用默认浏览器 UA"
                  value={draft.userAgent}
                />
                <TextField
                  label="HTTP 代理"
                  onChange={(httpProxy) => updateDraft({ httpProxy })}
                  placeholder="http://127.0.0.1:7890"
                  value={draft.httpProxy}
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <BooleanSetting
                    checked={draft.enabled}
                    label="启用环境"
                    onChange={(enabled) => updateDraft({ enabled })}
                  />
                  <BooleanSetting
                    checked={draft.isDefault}
                    label="设为默认"
                    onChange={(isDefault) => updateDraft({ isDefault })}
                  />
                </div>
              </div>
            </section>
          </div>

          <div className="kerminal-muted-surface rounded-xl border p-3">
            <div className="flex flex-wrap justify-end gap-2">
              {selectedProvider ? (
                <button
                  className="kerminal-focus-ring kerminal-pressable inline-flex h-9 items-center gap-2 rounded-xl border border-rose-300/30 bg-rose-500/10 px-3 text-sm text-rose-700 transition hover:bg-rose-500/15 dark:text-rose-100"
                  onClick={removeProvider}
                  type="button"
                >
                  <Trash2 className="h-4 w-4" />
                  删除
                </button>
              ) : null}
              <button
                className={llmSecondaryButtonClass}
                disabled={state === "saving" || state === "testing"}
                onClick={runDryTest}
                type="button"
              >
                <FlaskConical className="h-4 w-4" />
                {state === "testing" ? "测试中" : "测试配置"}
              </button>
              <button
                className="kerminal-focus-ring kerminal-pressable inline-flex h-9 items-center gap-2 rounded-xl bg-sky-500 px-3 text-sm font-medium text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={state === "saving" || state === "testing"}
                onClick={saveProvider}
                type="button"
              >
                <Save className="h-4 w-4" />
                {state === "saving" ? "保存中" : "保存环境"}
              </button>
            </div>

            {message ? (
              <div
                className={cn(
                  "mt-3 rounded-xl border px-3 py-2 text-sm",
                  state === "error"
                    ? "border-rose-300/25 bg-rose-500/10 text-rose-700 dark:text-rose-100"
                    : "border-emerald-400/20 bg-emerald-400/10 text-emerald-700 dark:text-emerald-100",
                )}
                role={state === "error" ? "alert" : "status"}
              >
                {message}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function SettingsGroupHeading({
  description,
  icon: Icon,
  title,
}: {
  description: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
        <Icon className="h-4 w-4 text-zinc-400" />
        {title}
      </div>
      <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
        {description}
      </p>
    </div>
  );
}

function providerKindHelp(kind: LlmProviderKind) {
  return providerKindOptions.find((option) => option.value === kind)?.help;
}

function TextField({
  help,
  label,
  onChange,
  placeholder,
  value,
}: {
  help?: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <input
        aria-label={label}
        className="kerminal-field-surface mt-1 h-9 w-full rounded-xl border px-3 text-sm text-zinc-950 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        type="text"
        value={value}
      />
      {help ? <FormHelp>{help}</FormHelp> : null}
    </label>
  );
}

function ContextWindowField({
  onChange,
  value,
}: {
  onChange: (tokens: number) => void;
  value: number;
}) {
  const [inputValue, setInputValue] = useState(() =>
    String(contextWindowTokensToK(value)),
  );

  useEffect(() => {
    setInputValue(String(contextWindowTokensToK(value)));
  }, [value]);

  const handleChange = (nextValue: string) => {
    setInputValue(nextValue);
    if (!nextValue.trim()) {
      return;
    }

    const windowK = Number(nextValue);
    if (!Number.isNaN(windowK)) {
      onChange(contextWindowKToTokens(windowK));
    }
  };

  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        上下文窗口
      </span>
      <div className="kerminal-field-surface mt-1 flex h-9 items-center rounded-xl border px-2">
        <input
          aria-label="上下文窗口"
          className="min-w-0 flex-1 bg-transparent px-1 text-sm text-zinc-950 outline-none dark:text-zinc-100"
          max={CONTEXT_WINDOW_MAX_K}
          min={CONTEXT_WINDOW_MIN_K}
          onChange={(event) => handleChange(event.currentTarget.value)}
          step={1}
          type="number"
          value={inputValue}
        />
        <span className="shrink-0 text-xs text-zinc-500">k</span>
      </div>
      <FormHelp>
        所选模型的最大上下文长度，单位为 k；例如 128 表示 128k。
      </FormHelp>
    </label>
  );
}

function NumberField({
  help,
  label,
  max,
  min,
  onChange,
  step = 1,
  suffix,
  value,
}: {
  help?: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  suffix?: string;
  value: number;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <div className="kerminal-field-surface mt-1 flex h-9 items-center rounded-xl border px-2">
        <input
          aria-label={label}
          className="min-w-0 flex-1 bg-transparent px-1 text-sm text-zinc-950 outline-none dark:text-zinc-100"
          max={max}
          min={min}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          step={step}
          type="number"
          value={value}
        />
        {suffix ? (
          <span className="shrink-0 text-xs text-zinc-500">{suffix}</span>
        ) : null}
      </div>
      {help ? <FormHelp>{help}</FormHelp> : null}
    </label>
  );
}

function SelectField({
  help,
  label,
  onChange,
  options,
  value,
}: {
  help?: string;
  label: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  value: string;
}) {
  return (
    <div className="block">
      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <Select
        aria-label={label}
        className="mt-1"
        onValueChange={onChange}
        options={options}
        value={value}
      />
      {help ? <FormHelp>{help}</FormHelp> : null}
    </div>
  );
}

function BooleanSetting({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="kerminal-muted-surface flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300">
      <span>{label}</span>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function FormHelp({ children }: { children: string }) {
  return (
    <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
      {children}
    </p>
  );
}

function providerRequestFromDraft(
  draft: LlmProviderFormDraft,
): LlmProviderCreateRequest {
  return {
    baseUrl: draft.baseUrl,
    contextStrategy: draft.contextStrategy,
    contextWindowTokens: draft.contextWindowTokens,
    enabled: draft.enabled,
    httpProxy: draft.httpProxy || undefined,
    isDefault: draft.isDefault,
    kind: draft.kind,
    maxRetries: draft.maxRetries,
    model: draft.model,
    modelList: draft.model.trim() ? [draft.model] : [],
    name: draft.name,
    reasoningEffort: draft.reasoningEffort,
    temperature: draft.temperature,
    userAgent: draft.userAgent || undefined,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function contextWindowTokensToK(tokens: number) {
  return Math.max(
    CONTEXT_WINDOW_MIN_K,
    Math.round(tokens / CONTEXT_WINDOW_TOKENS_PER_K),
  );
}

function contextWindowKToTokens(value: number) {
  if (Number.isNaN(value)) {
    return CONTEXT_WINDOW_TOKENS_PER_K;
  }
  const windowK = Math.min(
    CONTEXT_WINDOW_MAX_K,
    Math.max(CONTEXT_WINDOW_MIN_K, value),
  );
  return Math.round(windowK * CONTEXT_WINDOW_TOKENS_PER_K);
}
