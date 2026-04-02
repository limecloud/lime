import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  getAllAliasConfigs,
  getModelRegistry,
  getModelRegistryProviderIds,
  getProviderAliasConfig,
  invalidateModelRegistryCache,
  refreshModelRegistry,
} from "./modelRegistry";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("modelRegistry API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateModelRegistryCache();
  });

  it("getModelRegistry 应缓存并复用同一轮读取结果", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce([
      {
        id: "gpt-4.1",
        display_name: "GPT-4.1",
        provider_id: "openai",
        provider_name: "OpenAI",
      },
    ]);

    const [first, second] = await Promise.all([
      getModelRegistry(),
      getModelRegistry(),
    ]);

    expect(vi.mocked(safeInvoke)).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it("getProviderAliasConfig 应复用已加载的全量别名配置", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      kiro: {
        models: ["kimi-k2"],
        aliases: {
          "kimi-k2": {
            actual: "kimi-k2",
          },
        },
      },
    });

    await expect(getAllAliasConfigs()).resolves.toEqual(
      expect.objectContaining({
        kiro: expect.objectContaining({
          models: ["kimi-k2"],
        }),
      }),
    );
    await expect(getProviderAliasConfig("kiro")).resolves.toEqual(
      expect.objectContaining({ models: ["kimi-k2"] }),
    );

    expect(vi.mocked(safeInvoke)).toHaveBeenCalledTimes(1);
  });

  it("refreshModelRegistry 后应失效缓存并触发下一次重新读取", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce([
        {
          id: "gpt-4.1",
          display_name: "GPT-4.1",
          provider_id: "openai",
          provider_name: "OpenAI",
        },
      ])
      .mockResolvedValueOnce(285)
      .mockResolvedValueOnce([
        {
          id: "gpt-5",
          display_name: "GPT-5",
          provider_id: "openai",
          provider_name: "OpenAI",
        },
      ]);

    await getModelRegistry();
    await expect(refreshModelRegistry()).resolves.toBe(285);
    await expect(getModelRegistry()).resolves.toEqual([
      expect.objectContaining({ id: "gpt-5" }),
    ]);

    expect(vi.mocked(safeInvoke)).toHaveBeenCalledTimes(3);
  });

  it("getModelRegistryProviderIds 应直接透传命令结果", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce(["openai", "codex"]);

    await expect(getModelRegistryProviderIds()).resolves.toEqual([
      "openai",
      "codex",
    ]);
    expect(vi.mocked(safeInvoke)).toHaveBeenCalledWith(
      "get_model_registry_provider_ids",
    );
  });
});
