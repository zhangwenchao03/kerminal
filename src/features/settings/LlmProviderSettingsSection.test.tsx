import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmProvider } from "./llmProviderModel";
import { LlmProviderSettingsSection } from "./LlmProviderSettingsSection";

const apiMock = vi.hoisted(() => ({
  createLlmProvider: vi.fn(),
  deleteLlmProvider: vi.fn(),
  listLlmProviders: vi.fn(),
  testLlmProvider: vi.fn(),
  updateLlmProvider: vi.fn(),
}));

vi.mock("../../lib/llmProviderApi", () => apiMock);

async function chooseSelectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  optionName: string,
) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(screen.getByRole("option", { name: new RegExp(`^${optionName}`) }));
}

const provider: LlmProvider = {
  id: "llm-openai",
  name: "OpenAI Chat",
  kind: "openAiChat",
  baseUrl: "https://api.example.com/v1",
  model: "gpt-test",
  modelList: ["gpt-test", "gpt-next"],
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

describe("LlmProviderSettingsSection", () => {
  beforeEach(() => {
    apiMock.createLlmProvider.mockReset();
    apiMock.deleteLlmProvider.mockReset();
    apiMock.listLlmProviders.mockReset();
    apiMock.testLlmProvider.mockReset();
    apiMock.updateLlmProvider.mockReset();
  });

  it("renders an empty Chinese state and creates a provider with an API key", async () => {
    const user = userEvent.setup();
    apiMock.listLlmProviders.mockResolvedValue([]);
    apiMock.createLlmProvider.mockResolvedValue(provider);

    render(<LlmProviderSettingsSection />);

    expect(await screen.findByText("LLM Provider")).toBeInTheDocument();
    expect(screen.getByText(/还没有 API 环境/)).toBeInTheDocument();
    expect(screen.queryByLabelText("供应商预设")).not.toBeInTheDocument();
    expect(screen.getByLabelText("模型名称")).toHaveValue("gpt-5.5");

    await user.clear(screen.getByLabelText("环境名称"));
    await user.type(screen.getByLabelText("环境名称"), "本地代理");
    await user.clear(screen.getByLabelText("API 地址"));
    await user.type(screen.getByLabelText("API 地址"), "https://llm.local/v1");
    await user.clear(screen.getByLabelText("模型名称"));
    await user.type(screen.getByLabelText("模型名称"), "qwen-test");
    expect(screen.getByLabelText("上下文窗口")).toHaveValue(128);
    await user.clear(screen.getByLabelText("上下文窗口"));
    await user.type(screen.getByLabelText("上下文窗口"), "64");
    await user.type(screen.getByLabelText("API Key"), "sk-secret-value");
    await user.click(screen.getByRole("button", { name: "保存环境" }));

    await waitFor(() => {
      expect(apiMock.createLlmProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "sk-secret-value",
          baseUrl: "https://llm.local/v1",
          contextWindowTokens: 64000,
          kind: "openAiChat",
          model: "qwen-test",
          modelList: ["qwen-test"],
          name: "本地代理",
        }),
      );
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "API key 不会在界面回显",
    );
    expect(screen.queryByDisplayValue("sk-secret-value")).not.toBeInTheDocument();
  });

  it("loads an existing provider and runs dry validation", async () => {
    const user = userEvent.setup();
    apiMock.listLlmProviders.mockResolvedValue([provider]);
    apiMock.testLlmProvider.mockResolvedValue({
      checkedAt: "0",
      message: "Rig provider 配置验证通过；未发送真实 LLM 请求。",
      mode: "dryRun",
      ok: true,
      providerId: "llm-openai",
    });

    render(<LlmProviderSettingsSection />);

    expect(await screen.findByLabelText("环境名称")).toHaveValue("OpenAI Chat");
    const providerButton = screen.getByRole("button", { name: "OpenAI Chat" });
    expect(providerButton).toHaveAttribute("aria-pressed", "true");
    expect(providerButton).not.toHaveTextContent("https://api.example.com/v1");
    expect(providerButton).not.toHaveTextContent("gpt-test");
    expect(providerButton).not.toHaveTextContent("Key 已配置");
    expect(providerButton).not.toHaveTextContent("已启用");
    expect(screen.getByLabelText("API 地址")).toHaveValue(
      "https://api.example.com/v1",
    );
    expect(screen.getByPlaceholderText("已保存，留空则保持不变")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "测试配置" }));

    await waitFor(() => {
      expect(apiMock.testLlmProvider).toHaveBeenCalledWith("llm-openai");
    });
    expect(screen.getByRole("status")).toHaveTextContent("配置验证通过");
  });

  it("updates an existing provider without resending the API key", async () => {
    const user = userEvent.setup();
    apiMock.listLlmProviders.mockResolvedValue([provider]);
    apiMock.updateLlmProvider.mockResolvedValue({
      ...provider,
      model: "gpt-next",
    });

    render(<LlmProviderSettingsSection />);

    expect(await screen.findByLabelText("模型名称")).toHaveValue("gpt-test");
    await user.clear(screen.getByLabelText("模型名称"));
    await user.type(screen.getByLabelText("模型名称"), "gpt-next");
    await user.click(screen.getByRole("button", { name: "保存环境" }));

    await waitFor(() => {
      expect(apiMock.updateLlmProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: undefined,
          clearApiKey: false,
          id: "llm-openai",
          model: "gpt-next",
          modelList: ["gpt-next"],
        }),
      );
    });
  });

  it("selects a provider API type without overwriting the manual URL or model", async () => {
    const user = userEvent.setup();
    apiMock.listLlmProviders.mockResolvedValue([]);
    apiMock.createLlmProvider.mockResolvedValue({
      ...provider,
      baseUrl: "https://gateway.example.com/anthropic",
      kind: "anthropic",
      model: "custom-sonnet",
      modelList: ["custom-sonnet"],
      name: "团队网关",
    });

    render(<LlmProviderSettingsSection />);

    expect(await screen.findByText("LLM Provider")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("环境名称"));
    await user.type(screen.getByLabelText("环境名称"), "团队网关");
    await user.clear(screen.getByLabelText("API 地址"));
    await user.type(
      screen.getByLabelText("API 地址"),
      "https://gateway.example.com/anthropic",
    );
    await user.clear(screen.getByLabelText("模型名称"));
    await user.type(screen.getByLabelText("模型名称"), "custom-sonnet");
    await chooseSelectOption(user, "供应商接口", "Anthropic");
    await user.click(screen.getByRole("button", { name: "保存环境" }));

    await waitFor(() => {
      expect(apiMock.createLlmProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: "https://gateway.example.com/anthropic",
          kind: "anthropic",
          model: "custom-sonnet",
          name: "团队网关",
        }),
      );
    });
  });
});
