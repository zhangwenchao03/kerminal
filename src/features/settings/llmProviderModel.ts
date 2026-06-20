export type LlmProviderKind =
  | "openAiResponses"
  | "openAiChat"
  | "anthropic";

export type LlmContextStrategy =
  | "minimal"
  | "currentTerminal"
  | "currentWorkspace";
export type LlmReasoningEffort =
  | "modelDefault"
  | "minimal"
  | "low"
  | "medium"
  | "high";

export interface LlmProvider {
  id: string;
  name: string;
  kind: LlmProviderKind;
  baseUrl: string;
  model: string;
  modelList: string[];
  temperature: number;
  contextStrategy: LlmContextStrategy;
  contextWindowTokens: number;
  reasoningEffort: LlmReasoningEffort;
  maxRetries: number;
  userAgent?: string | null;
  httpProxy?: string | null;
  enabled: boolean;
  isDefault: boolean;
  apiKeyCredentialRef?: string | null;
  apiKeyConfigured: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LlmProviderCreateRequest {
  name: string;
  kind: LlmProviderKind;
  baseUrl: string;
  model: string;
  modelList: string[];
  temperature: number;
  contextStrategy: LlmContextStrategy;
  contextWindowTokens: number;
  reasoningEffort: LlmReasoningEffort;
  maxRetries: number;
  userAgent?: string;
  httpProxy?: string;
  enabled: boolean;
  isDefault: boolean;
  apiKey?: string;
}

export interface LlmProviderUpdateRequest extends LlmProviderCreateRequest {
  id: string;
  clearApiKey: boolean;
}

export interface LlmProviderTestResult {
  providerId: string;
  ok: boolean;
  message: string;
  mode: "dryRun";
  checkedAt: string;
}

export interface LlmProviderFormDraft {
  id?: string;
  name: string;
  kind: LlmProviderKind;
  baseUrl: string;
  model: string;
  modelList: string[];
  temperature: number;
  contextStrategy: LlmContextStrategy;
  contextWindowTokens: number;
  reasoningEffort: LlmReasoningEffort;
  maxRetries: number;
  userAgent: string;
  httpProxy: string;
  enabled: boolean;
  isDefault: boolean;
  apiKeyConfigured: boolean;
}

export const defaultLlmProviderDraft: LlmProviderFormDraft = {
  name: "OpenAI Chat",
  kind: "openAiChat",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5.5",
  modelList: ["gpt-5.5"],
  temperature: 0.2,
  contextStrategy: "currentTerminal",
  contextWindowTokens: 128000,
  reasoningEffort: "modelDefault",
  maxRetries: 3,
  userAgent: "",
  httpProxy: "",
  enabled: true,
  isDefault: true,
  apiKeyConfigured: false,
};

export function draftFromProvider(
  provider: LlmProvider,
): LlmProviderFormDraft {
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    model: provider.model,
    modelList: normalizeModelList(provider.modelList, provider.model),
    temperature: provider.temperature,
    contextStrategy: provider.contextStrategy,
    contextWindowTokens: provider.contextWindowTokens,
    reasoningEffort: provider.reasoningEffort,
    maxRetries: provider.maxRetries,
    userAgent: provider.userAgent ?? "",
    httpProxy: provider.httpProxy ?? "",
    enabled: provider.enabled,
    isDefault: provider.isDefault,
    apiKeyConfigured: provider.apiKeyConfigured,
  };
}

export function normalizeLlmProvider(
  provider: LlmProvider,
): LlmProvider {
  return {
    ...provider,
    apiKeyCredentialRef: provider.apiKeyCredentialRef ?? null,
    apiKeyConfigured:
      provider.apiKeyConfigured || Boolean(provider.apiKeyCredentialRef),
    baseUrl: provider.baseUrl.trim().replace(/\/+$/, ""),
    model: provider.model.trim(),
    modelList: normalizeModelList(provider.modelList, provider.model),
    name: provider.name.trim(),
    contextWindowTokens: clampNumber(provider.contextWindowTokens, 1024, 2_000_000),
    httpProxy: normalizeOptionalText(provider.httpProxy),
    maxRetries: clampNumber(provider.maxRetries, 0, 10),
    reasoningEffort: normalizeReasoningEffort(provider.reasoningEffort),
    temperature: clampNumber(provider.temperature, 0, 2),
    userAgent: normalizeOptionalText(provider.userAgent),
  };
}

export function normalizeLlmProviderDraft(
  draft: LlmProviderFormDraft,
): LlmProviderFormDraft {
  return {
    ...draft,
    baseUrl: draft.baseUrl.trim().replace(/\/+$/, ""),
    model: draft.model.trim(),
    modelList: normalizeModelList(draft.modelList, draft.model),
    name: draft.name.trim(),
    contextWindowTokens: clampNumber(draft.contextWindowTokens, 1024, 2_000_000),
    httpProxy: draft.httpProxy.trim(),
    maxRetries: clampNumber(draft.maxRetries, 0, 10),
    reasoningEffort: normalizeReasoningEffort(draft.reasoningEffort),
    temperature: clampNumber(draft.temperature, 0, 2),
    userAgent: draft.userAgent.trim(),
  };
}

function clampNumber(value: number, min: number, max: number) {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function normalizeModelList(modelList: string[] | undefined, model: string) {
  const values = [...(modelList ?? []), model]
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(values));
}

function normalizeReasoningEffort(
  value: LlmReasoningEffort | undefined,
): LlmReasoningEffort {
  if (
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high"
  ) {
    return value;
  }
  return "modelDefault";
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
