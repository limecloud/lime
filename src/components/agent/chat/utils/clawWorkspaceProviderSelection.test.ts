import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfiguredProvider } from "@/hooks/useConfiguredProviders";
import type { EnhancedModelMetadata } from "@/lib/types/modelRegistry";
import { resolveClawWorkspaceProviderSelection } from "./clawWorkspaceProviderSelection";

const {
  mockLoadConfiguredProviders,
  mockGetModelRegistry,
  mockGetProviderAliasConfig,
  mockFetchProviderModelsAuto,
  mockFilterModelsByTheme,
} = vi.hoisted(() => ({
  mockLoadConfiguredProviders: vi.fn(),
  mockGetModelRegistry: vi.fn(),
  mockGetProviderAliasConfig: vi.fn(),
  mockFetchProviderModelsAuto: vi.fn(),
  mockFilterModelsByTheme: vi.fn(),
}));

vi.mock("@/hooks/useConfiguredProviders", () => ({
  loadConfiguredProviders: mockLoadConfiguredProviders,
}));

vi.mock("@/lib/api/modelRegistry", () => ({
  modelRegistryApi: {
    getModelRegistry: mockGetModelRegistry,
    getProviderAliasConfig: mockGetProviderAliasConfig,
    fetchProviderModelsAuto: mockFetchProviderModelsAuto,
  },
}));

vi.mock("./modelThemePolicy", () => ({
  filterModelsByTheme: mockFilterModelsByTheme,
}));

function createProvider(
  overrides: Partial<ConfiguredProvider> = {},
): ConfiguredProvider {
  return {
    key: "custom-social-provider",
    label: "Custom Social Provider",
    registryId: "custom-social-provider",
    fallbackRegistryId: "openai",
    type: "openai",
    ...overrides,
  };
}

function createModel(
  id: string,
  overrides: Partial<EnhancedModelMetadata> = {},
): EnhancedModelMetadata {
  return {
    id,
    display_name: id,
    provider_id: "custom-social-provider",
    provider_name: "Custom Social Provider",
    family: null,
    tier: "pro",
    capabilities: {
      vision: false,
      tools: true,
      streaming: true,
      json_mode: true,
      function_calling: true,
      reasoning: false,
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
    is_latest: false,
    description: null,
    source: "local",
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

describe("resolveClawWorkspaceProviderSelection", () => {
  beforeEach(() => {
    mockLoadConfiguredProviders.mockResolvedValue([]);
    mockGetModelRegistry.mockResolvedValue([]);
    mockGetProviderAliasConfig.mockResolvedValue(null);
    mockFetchProviderModelsAuto.mockResolvedValue({
      models: [],
      source: "LocalFallback",
      error: null,
    });
    mockFilterModelsByTheme.mockImplementation(
      (_theme: string | undefined, models: EnhancedModelMetadata[]) => ({
        models,
        usedFallback: false,
        filteredOutCount: 0,
        policyName: "mock",
      }),
    );
  });

  it("本地注册表存在模型时应直接选中，不再触发 provider API fallback", async () => {
    mockLoadConfiguredProviders.mockResolvedValueOnce([
      createProvider(),
      createProvider({
        key: "backup-provider",
        label: "Backup Provider",
        registryId: "backup-provider",
      }),
    ]);
    mockGetModelRegistry.mockResolvedValueOnce([
      createModel("social-model-1", {
        is_latest: true,
      }),
    ]);

    const result = await resolveClawWorkspaceProviderSelection({
      currentProviderType: "custom-social-provider",
      currentModel: "legacy-model",
      theme: "social-media",
    });

    expect(result).toEqual({
      providerType: "custom-social-provider",
      model: "social-model-1",
    });
    expect(mockFetchProviderModelsAuto).not.toHaveBeenCalled();
  });

  it("本地注册表无模型时应回退到后端 provider API 结果", async () => {
    mockLoadConfiguredProviders.mockResolvedValueOnce([
      createProvider(),
    ]);
    mockFetchProviderModelsAuto.mockResolvedValueOnce({
      models: [
        createModel("social-model-api", {
          source: "custom",
          is_latest: true,
        }),
      ],
      source: "Api",
      error: null,
    });

    const result = await resolveClawWorkspaceProviderSelection({
      currentProviderType: "custom-social-provider",
      currentModel: null,
      theme: "social-media",
    });

    expect(result).toEqual({
      providerType: "custom-social-provider",
      model: "social-model-api",
    });
    expect(mockFetchProviderModelsAuto).toHaveBeenCalledWith(
      "custom-social-provider",
    );
  });
});
