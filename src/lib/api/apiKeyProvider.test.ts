import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  apiKeyProviderApi,
  invalidateApiKeyProviderCache,
} from "./apiKeyProvider";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("apiKeyProvider API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateApiKeyProviderCache();
  });

  it("应代理现役 provider 命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce([{ id: "openai" }])
      .mockResolvedValueOnce({ id: "key-1" })
      .mockResolvedValueOnce({ success: true });

    await expect(apiKeyProviderApi.getProviders()).resolves.toEqual([
      expect.objectContaining({ id: "openai" }),
    ]);
    await expect(
      apiKeyProviderApi.addApiKey({
        provider_id: "openai",
        api_key: "sk-test",
      }),
    ).resolves.toEqual(expect.objectContaining({ id: "key-1" }));
    await expect(
      apiKeyProviderApi.testConnection("openai", "gpt-4.1"),
    ).resolves.toEqual(expect.objectContaining({ success: true }));
  });

  it("不应继续暴露旧 API Key 迁移 API", () => {
    expect("getLegacyApiKeyCredentials" in apiKeyProviderApi).toBe(false);
    expect("migrateLegacyCredentials" in apiKeyProviderApi).toBe(false);
    expect("deleteLegacyCredential" in apiKeyProviderApi).toBe(false);
  });

  it("getProviders 应缓存并复用同一轮读取结果", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce([
      {
        id: "openai",
        name: "OpenAI",
        type: "openai",
        enabled: true,
        api_key_count: 1,
        api_keys: [{ id: "key-1", provider_id: "openai", enabled: true }],
      },
    ]);

    const [first, second] = await Promise.all([
      apiKeyProviderApi.getProviders(),
      apiKeyProviderApi.getProviders(),
    ]);

    expect(vi.mocked(safeInvoke)).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it("forceRefresh 应绕过 Provider 缓存", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce([
        {
          id: "openai",
          name: "OpenAI",
          type: "openai",
          enabled: true,
          api_key_count: 1,
          api_keys: [],
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "deepseek",
          name: "DeepSeek",
          type: "deepseek",
          enabled: true,
          api_key_count: 2,
          api_keys: [],
        },
      ]);

    await expect(apiKeyProviderApi.getProviders()).resolves.toEqual([
      expect.objectContaining({ id: "openai" }),
    ]);
    await expect(
      apiKeyProviderApi.getProviders({ forceRefresh: true }),
    ).resolves.toEqual([expect.objectContaining({ id: "deepseek" })]);

    expect(vi.mocked(safeInvoke)).toHaveBeenCalledTimes(2);
  });

  it("本地开发浏览器模式下 Provider 读取失败时应提供 Lime Hub mock", async () => {
    vi.mocked(safeInvoke).mockRejectedValueOnce(
      new Error("DevBridge unavailable"),
    );

    await expect(
      apiKeyProviderApi.getProviders({ forceRefresh: true }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "lime-hub",
        name: "Lime Hub",
        type: "openai",
        api_key_count: 1,
        custom_models: expect.arrayContaining([
          "gpt-5.5",
          "deepseek-v4-flash",
        ]),
      }),
    ]);
  });

  it("写操作成功后应失效缓存", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce([
        {
          id: "openai",
          name: "OpenAI",
          type: "openai",
          enabled: true,
          api_key_count: 1,
          api_keys: [],
        },
      ])
      .mockResolvedValueOnce({ id: "key-2" })
      .mockResolvedValueOnce([
        {
          id: "openai",
          name: "OpenAI",
          type: "openai",
          enabled: true,
          api_key_count: 2,
          api_keys: [{ id: "key-2", provider_id: "openai", enabled: true }],
        },
      ]);

    await apiKeyProviderApi.getProviders();
    await apiKeyProviderApi.addApiKey({
      provider_id: "openai",
      api_key: "sk-test",
    });
    await expect(apiKeyProviderApi.getProviders()).resolves.toEqual([
      expect.objectContaining({ api_key_count: 2 }),
    ]);

    expect(vi.mocked(safeInvoke)).toHaveBeenCalledTimes(3);
  });
});
