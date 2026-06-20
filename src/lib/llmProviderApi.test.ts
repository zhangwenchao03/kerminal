import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmProvider } from "../features/settings/llmProviderModel";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

const provider: LlmProvider = {
  id: "llm-openai",
  name: "OpenAI Chat",
  kind: "openAiChat",
  baseUrl: "https://api.example.com/v1/",
  model: "gpt-test",
  modelList: ["gpt-test"],
  temperature: 0.2,
  contextStrategy: "currentTerminal",
  contextWindowTokens: 128000,
  reasoningEffort: "modelDefault",
  maxRetries: 3,
  userAgent: null,
  httpProxy: null,
  enabled: true,
  isDefault: true,
  apiKeyCredentialRef: "credential:llm/llm-openai/api-key",
  apiKeyConfigured: true,
  createdAt: "0",
  updatedAt: "0",
};

describe("llmProviderApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("lists providers through Tauri and normalizes returned metadata", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue([provider]);
    const { listLlmProviders } = await import("./llmProviderApi");

    const providers = await listLlmProviders();

    expect(invokeMock).toHaveBeenCalledWith("llm_provider_list");
    expect(providers[0]).toMatchObject({
      apiKeyConfigured: true,
      baseUrl: "https://api.example.com/v1",
    });
  });

  it("creates and updates providers through dedicated commands", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue(provider);
    const { createLlmProvider, updateLlmProvider } = await import(
      "./llmProviderApi"
    );

    await createLlmProvider({
      name: "OpenAI",
      kind: "openAiChat",
      baseUrl: "https://api.example.com/v1",
      model: "gpt-test",
      modelList: ["gpt-test"],
      temperature: 0.2,
      contextStrategy: "currentTerminal",
      contextWindowTokens: 128000,
      reasoningEffort: "modelDefault",
      maxRetries: 3,
      enabled: true,
      isDefault: true,
      apiKey: "sk-secret",
    });
    await updateLlmProvider({
      id: "llm-openai",
      name: "OpenAI",
      kind: "openAiChat",
      baseUrl: "https://api.example.com/v1",
      model: "gpt-test",
      modelList: ["gpt-test"],
      temperature: 0.2,
      contextStrategy: "currentTerminal",
      contextWindowTokens: 128000,
      reasoningEffort: "modelDefault",
      maxRetries: 3,
      enabled: true,
      isDefault: true,
      apiKey: undefined,
      clearApiKey: false,
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "llm_provider_create", {
      request: expect.objectContaining({ apiKey: "sk-secret" }),
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "llm_provider_update", {
      request: expect.objectContaining({
        clearApiKey: false,
        id: "llm-openai",
      }),
    });
  });

  it("deletes and dry-tests providers through Tauri commands", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({
        checkedAt: "0",
        message: "ok",
        mode: "dryRun",
        ok: true,
        providerId: "llm-openai",
      });
    const { deleteLlmProvider, testLlmProvider } = await import(
      "./llmProviderApi"
    );

    await expect(deleteLlmProvider("llm-openai")).resolves.toBe(true);
    await expect(testLlmProvider("llm-openai")).resolves.toMatchObject({
      mode: "dryRun",
      ok: true,
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "llm_provider_delete", {
      id: "llm-openai",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "llm_provider_test", {
      id: "llm-openai",
    });
  });
});
