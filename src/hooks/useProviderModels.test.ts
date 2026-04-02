import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfiguredProvider } from "./useConfiguredProviders";
import { loadProviderModels } from "./useProviderModels";

const {
  mockGetModelRegistry,
  mockGetProviderAliasConfig,
  mockFetchProviderModelsAuto,
} = vi.hoisted(() => ({
  mockGetModelRegistry: vi.fn(),
  mockGetProviderAliasConfig: vi.fn(),
  mockFetchProviderModelsAuto: vi.fn(),
}));

vi.mock("@/lib/api/modelRegistry", () => ({
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
});
