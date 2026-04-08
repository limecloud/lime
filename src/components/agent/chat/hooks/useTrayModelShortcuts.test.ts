import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  loadConfiguredProviders,
  getModelRegistry,
  getAllAliasConfigs,
  syncTrayModelShortcuts,
} = vi.hoisted(() => ({
  loadConfiguredProviders: vi.fn(),
  getModelRegistry: vi.fn(),
  getAllAliasConfigs: vi.fn(),
  syncTrayModelShortcuts: vi.fn(),
}));

vi.mock("@/hooks/useConfiguredProviders", () => ({
  loadConfiguredProviders,
  findConfiguredProviderBySelection: (
    providers: Array<{ key: string; providerId?: string }>,
    selection?: string | null,
  ) => {
    const normalizedSelection = (selection || "").trim().toLowerCase();
    const keyMatch =
      providers.find(
        (provider) => provider.key.trim().toLowerCase() === normalizedSelection,
      ) ?? null;
    const providerIdMatch =
      providers.find(
        (provider) =>
          (provider.providerId || "").trim().toLowerCase() ===
          normalizedSelection,
      ) ?? null;

    if (keyMatch && providerIdMatch && keyMatch !== providerIdMatch) {
      if (!keyMatch.providerId && providerIdMatch.providerId) {
        return providerIdMatch;
      }
    }

    return keyMatch ?? providerIdMatch ?? null;
  },
}));

vi.mock("@/lib/api/modelRegistry", () => ({
  modelRegistryApi: {
    getModelRegistry,
    getAllAliasConfigs,
  },
}));

vi.mock("@/lib/api/tray", () => ({
  TRAY_MODEL_SELECTED_EVENT: "tray-model-selected",
  trayApi: {
    syncTrayModelShortcuts,
  },
}));

vi.mock("@/lib/constants/providerMappings", () => ({
  getAliasConfigKey: (provider: string) => provider,
  getProviderLabel: (provider: string) => `label:${provider}`,
  getRegistryIdFromType: (provider: string) => provider,
  isAliasProvider: () => false,
}));

vi.mock("../utils/modelThemePolicy", () => ({
  filterModelsByTheme: (_theme: string | undefined, models: unknown[]) => ({
    models,
  }),
}));

vi.mock("../utils/providerModelCompatibility", () => ({
  getProviderModelCompatibilityIssue: () => null,
}));

import {
  buildTrayPayload,
  invalidateTrayPayloadCache,
  syncTrayModelShortcutsState,
} from "./useTrayModelShortcuts";

describe("buildTrayPayload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateTrayPayloadCache();

    loadConfiguredProviders.mockResolvedValue([
      {
        key: "deepseek",
        label: "DeepSeek",
        registryId: "deepseek",
        type: "deepseek",
      },
    ]);
    getModelRegistry.mockResolvedValue([
      {
        id: "deepseek-chat",
        display_name: "DeepSeek Chat",
        provider_id: "deepseek",
        provider_name: "DeepSeek",
        is_latest: true,
        release_date: "2026-01-01",
      },
    ]);
    getAllAliasConfigs.mockResolvedValue({});
    syncTrayModelShortcuts.mockResolvedValue(undefined);
  });

  it("相同签名的 payload 会复用缓存，避免重复拉取数据", async () => {
    const first = await buildTrayPayload(
      "deepseek",
      "deepseek-chat",
      "general",
    );
    const second = await buildTrayPayload(
      "deepseek",
      "deepseek-chat",
      "general",
    );

    expect(second).toEqual(first);
    expect(loadConfiguredProviders).toHaveBeenCalledTimes(1);
    expect(getModelRegistry).toHaveBeenCalledTimes(1);
    expect(getAllAliasConfigs).toHaveBeenCalledTimes(1);
  });

  it("强制刷新会绕过缓存重新拉取数据", async () => {
    await buildTrayPayload("deepseek", "deepseek-chat", "general");
    await buildTrayPayload("deepseek", "deepseek-chat", "general", {
      forceRefresh: true,
    });

    expect(loadConfiguredProviders).toHaveBeenCalledTimes(2);
    expect(getModelRegistry).toHaveBeenCalledTimes(2);
    expect(getAllAliasConfigs).toHaveBeenCalledTimes(2);
  });

  it("相同 payload 重复同步时应跳过重复托盘写入", async () => {
    await syncTrayModelShortcutsState("deepseek", "deepseek-chat", "general");
    await syncTrayModelShortcutsState("deepseek", "deepseek-chat", "general");

    expect(syncTrayModelShortcuts).toHaveBeenCalledTimes(1);
  });

  it("当 provider 仅命中 fallbackRegistryId 时仍应保留托盘候选模型", async () => {
    loadConfiguredProviders.mockResolvedValueOnce([
      {
        key: "custom-openai",
        label: "Custom OpenAI",
        registryId: "custom-openai",
        fallbackRegistryId: "openai",
        type: "openai",
      },
    ]);
    getModelRegistry.mockResolvedValueOnce([
      {
        id: "gpt-4.1",
        display_name: "GPT-4.1",
        provider_id: "openai",
        provider_name: "OpenAI",
        is_latest: true,
        release_date: "2026-02-01",
      },
    ]);

    const payload = await buildTrayPayload(
      "custom-openai",
      "gpt-4.1",
      "general",
      { forceRefresh: true },
    );

    expect(payload.quick_model_groups).toEqual([
      {
        provider_type: "custom-openai",
        provider_label: "Custom OpenAI",
        models: [
          {
            provider_type: "custom-openai",
            provider_label: "Custom OpenAI",
            model: "gpt-4.1",
          },
        ],
      },
    ]);
  });

  it("首次同步失败时不应缓存成功指纹，后续重试仍应继续同步", async () => {
    syncTrayModelShortcuts
      .mockRejectedValueOnce(new Error("tray unavailable"))
      .mockResolvedValueOnce(undefined);

    await expect(
      syncTrayModelShortcutsState("deepseek", "deepseek-chat", "general"),
    ).rejects.toThrow("tray unavailable");
    await expect(
      syncTrayModelShortcutsState("deepseek", "deepseek-chat", "general"),
    ).resolves.toBeUndefined();

    expect(syncTrayModelShortcuts).toHaveBeenCalledTimes(2);
  });
});
