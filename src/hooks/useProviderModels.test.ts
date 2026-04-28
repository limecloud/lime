import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfiguredProvider } from "./useConfiguredProviders";
import { loadProviderModels } from "./useProviderModels";

const {
  mockGetModelRegistry,
  mockGetProviderAliasConfig,
  mockFetchProviderModelsAuto,
  mockNormalizeFetchProviderModelsSource,
} = vi.hoisted(() => ({
  mockGetModelRegistry: vi.fn(),
  mockGetProviderAliasConfig: vi.fn(),
  mockFetchProviderModelsAuto: vi.fn(),
  mockNormalizeFetchProviderModelsSource: vi.fn((result) => {
    if (
      result?.source === "LocalFallback" &&
      Array.isArray(result?.models) &&
      result.models.length > 0 &&
      typeof result?.error === "string" &&
      result.error.includes("已保留当前 Provider 的自定义模型")
    ) {
      return "CustomModels";
    }
    return result?.source ?? "LocalFallback";
  }),
}));

vi.mock("@/lib/api/modelRegistry", () => ({
  normalizeFetchProviderModelsSource: mockNormalizeFetchProviderModelsSource,
  modelRegistryApi: {
    getModelRegistry: mockGetModelRegistry,
    getProviderAliasConfig: mockGetProviderAliasConfig,
    fetchProviderModelsAuto: mockFetchProviderModelsAuto,
  },
}));

function createProvider(
  overrides: Partial<ConfiguredProvider> = {},
): ConfiguredProvider {
  return {
    key: "openai_api_key",
    label: "OpenAI API Key",
    registryId: "openai",
    fallbackRegistryId: "openai",
    type: "openai",
    providerId: "openai",
    apiHost: "https://api.openai.com/v1",
    ...overrides,
  };
}

describe("loadProviderModels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetModelRegistry.mockResolvedValue([]);
    mockGetProviderAliasConfig.mockResolvedValue(null);
    mockFetchProviderModelsAuto.mockResolvedValue({
      models: [],
      source: "Api",
      error: null,
    });
  });

  it("实时拉取时应优先使用真实 providerId，而不是前端去重后的 key", async () => {
    mockFetchProviderModelsAuto.mockResolvedValueOnce({
      models: [
        {
          id: "gpt-5.1",
          display_name: "GPT-5.1",
          provider_id: "openai",
          provider_name: "OpenAI",
          family: null,
          tier: "pro",
          capabilities: {
            vision: true,
            tools: true,
            streaming: true,
            json_mode: true,
            function_calling: true,
            reasoning: true,
          },
          pricing: null,
          limits: {
            context_length: null,
            max_output_tokens: null,
            requests_per_minute: null,
            tokens_per_minute: null,
          },
          status: "active",
          release_date: null,
          is_latest: true,
          description: null,
          source: "custom",
          created_at: 0,
          updated_at: 0,
        },
      ],
      source: "Api",
      error: null,
    });

    const models = await loadProviderModels(createProvider(), {
      liveFetchOnly: true,
      hasApiKey: true,
    });

    expect(models.map((model) => model.id)).toEqual(["gpt-5.1"]);
    expect(mockFetchProviderModelsAuto).toHaveBeenCalledWith("openai");
  });

  it("实时目录读取失败并回退到 LocalFallback 时，不应继续把旧模型当成最新模型展示", async () => {
    mockFetchProviderModelsAuto.mockResolvedValueOnce({
      models: [
        {
          id: "gpt-4.1",
          display_name: "GPT-4.1",
          provider_id: "openai",
          provider_name: "OpenAI",
          family: null,
          tier: "pro",
          capabilities: {
            vision: true,
            tools: true,
            streaming: true,
            json_mode: true,
            function_calling: true,
            reasoning: true,
          },
          pricing: null,
          limits: {
            context_length: null,
            max_output_tokens: null,
            requests_per_minute: null,
            tokens_per_minute: null,
          },
          status: "active",
          release_date: null,
          is_latest: true,
          description: null,
          source: "local",
          created_at: 0,
          updated_at: 0,
        },
      ],
      source: "LocalFallback",
      error: "401 Unauthorized",
    });

    const models = await loadProviderModels(createProvider(), {
      liveFetchOnly: true,
      hasApiKey: true,
    });

    expect(models).toEqual([]);
  });

  it("厂商目录来源应视为有效的实时模型真相", async () => {
    mockFetchProviderModelsAuto.mockResolvedValueOnce({
      models: [
        {
          id: "MiniMax-M2.7",
          display_name: "MiniMax-M2.7",
          provider_id: "minimax",
          provider_name: "MiniMax",
          family: null,
          tier: "pro",
          capabilities: {
            vision: false,
            tools: true,
            streaming: true,
            json_mode: true,
            function_calling: true,
            reasoning: true,
          },
          pricing: null,
          limits: {
            context_length: null,
            max_output_tokens: null,
            requests_per_minute: null,
            tokens_per_minute: null,
          },
          status: "active",
          release_date: null,
          is_latest: true,
          description: null,
          source: "local",
          created_at: 0,
          updated_at: 0,
        },
      ],
      source: "Catalog",
      error: null,
    });

    const models = await loadProviderModels(
      createProvider({
        key: "minimax-test",
        providerId: "custom-minimax",
        type: "anthropic-compatible" as ConfiguredProvider["type"],
        apiHost: "https://api.minimaxi.com/anthropic",
      }),
      {
        liveFetchOnly: true,
        hasApiKey: true,
      },
    );

    expect(models.map((model) => model.id)).toEqual(["MiniMax-M2.7"]);
  });

  it("当前 Provider 的自定义模型来源也应视为有效的实时模型真相", async () => {
    mockFetchProviderModelsAuto.mockResolvedValueOnce({
      models: [
        {
          id: "MiniMax-M2.7",
          display_name: "MiniMax-M2.7",
          provider_id: "minimax",
          provider_name: "MiniMax",
          family: null,
          tier: "pro",
          capabilities: {
            vision: false,
            tools: true,
            streaming: true,
            json_mode: true,
            function_calling: true,
            reasoning: true,
          },
          pricing: null,
          limits: {
            context_length: null,
            max_output_tokens: null,
            requests_per_minute: null,
            tokens_per_minute: null,
          },
          status: "active",
          release_date: null,
          is_latest: true,
          description: null,
          source: "custom",
          created_at: 0,
          updated_at: 0,
        },
      ],
      source: "LocalFallback",
      error: "当前 Anthropic 兼容入口未提供标准 /models 接口，已保留当前 Provider 的自定义模型。",
    });

    const models = await loadProviderModels(
      createProvider({
        key: "minimax-test",
        providerId: "custom-minimax",
        type: "anthropic-compatible" as ConfiguredProvider["type"],
        apiHost: "https://api.minimaxi.com/anthropic",
      }),
      {
        liveFetchOnly: true,
        hasApiKey: true,
      },
    );

    expect(models.map((model) => model.id)).toEqual(["MiniMax-M2.7"]);
  });

});
