import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  normalizeLlmProvider,
  type LlmProvider,
  type LlmProviderCreateRequest,
  type LlmProviderTestResult,
  type LlmProviderUpdateRequest,
} from "../features/settings/llmProviderModel";

const browserPreviewProviders = new Map<string, LlmProvider>();

export async function listLlmProviders(): Promise<LlmProvider[]> {
  if (!isTauri()) {
    return Array.from(browserPreviewProviders.values()).map(normalizeLlmProvider);
  }

  const providers = await invoke<LlmProvider[]>("llm_provider_list");
  return providers.map(normalizeLlmProvider);
}

export async function createLlmProvider(
  request: LlmProviderCreateRequest,
): Promise<LlmProvider> {
  if (!isTauri()) {
    const id = `browser-llm-${Date.now().toString(36)}`;
    const provider = normalizeLlmProvider({
      ...request,
      id,
      apiKeyConfigured: Boolean(request.apiKey?.trim()),
      apiKeyCredentialRef: request.apiKey?.trim()
        ? `credential:llm/${id}/api-key`
        : null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    });
    browserPreviewProviders.set(id, provider);
    return provider;
  }

  const provider = await invoke<LlmProvider>("llm_provider_create", {
    request,
  });
  return normalizeLlmProvider(provider);
}

export async function updateLlmProvider(
  request: LlmProviderUpdateRequest,
): Promise<LlmProvider> {
  if (!isTauri()) {
    const existing = browserPreviewProviders.get(request.id);
    const provider = normalizeLlmProvider({
      ...request,
      apiKeyConfigured:
        request.clearApiKey ? false : Boolean(request.apiKey?.trim()) || Boolean(existing?.apiKeyConfigured),
      apiKeyCredentialRef:
        request.clearApiKey
          ? null
          : request.apiKey?.trim()
            ? `credential:llm/${request.id}/api-key`
            : existing?.apiKeyCredentialRef ?? null,
      createdAt: existing?.createdAt ?? new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    });
    browserPreviewProviders.set(request.id, provider);
    return provider;
  }

  const provider = await invoke<LlmProvider>("llm_provider_update", {
    request,
  });
  return normalizeLlmProvider(provider);
}

export async function deleteLlmProvider(id: string): Promise<boolean> {
  if (!isTauri()) {
    return browserPreviewProviders.delete(id);
  }

  return invoke<boolean>("llm_provider_delete", { id });
}

export async function testLlmProvider(
  id: string,
): Promise<LlmProviderTestResult> {
  if (!isTauri()) {
    const provider = browserPreviewProviders.get(id);
    if (!provider?.apiKeyConfigured) {
      throw new Error("API key 未配置");
    }
    return {
      checkedAt: new Date(0).toISOString(),
      message: "浏览器预览模式：Rig provider 配置已通过本地校验。",
      mode: "dryRun",
      ok: true,
      providerId: id,
    };
  }

  return invoke<LlmProviderTestResult>("llm_provider_test", { id });
}
