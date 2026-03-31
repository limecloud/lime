import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  getConfig,
  getDefaultProvider,
  invalidateAppConfigCache,
  getEnvironmentPreview,
  saveConfig,
  setDefaultProvider,
  updateProviderEnvVars,
} from "./appConfig";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("appConfig API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    invalidateAppConfigCache();
  });

  it("应代理读取配置命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ default_provider: "claude" })
      .mockResolvedValueOnce({ entries: [] })
      .mockResolvedValueOnce("claude");

    await expect(getConfig()).resolves.toEqual(
      expect.objectContaining({ default_provider: "claude" }),
    );
    await expect(getEnvironmentPreview()).resolves.toEqual(
      expect.objectContaining({ entries: [] }),
    );
    await expect(getDefaultProvider()).resolves.toBe("claude");
  });

  it("应代理写配置命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce("gemini")
      .mockResolvedValueOnce(undefined);

    await expect(
      saveConfig({ default_provider: "claude" } as never),
    ).resolves.toBeUndefined();
    await expect(setDefaultProvider("gemini")).resolves.toBe("gemini");
    await expect(
      updateProviderEnvVars("openai", "https://example.com", "key"),
    ).resolves.toBeUndefined();
  });

  it("应返回 workspace_preferences 配置", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      default_provider: "claude",
      workspace_preferences: {
        schema_version: 1,
        media_defaults: {
          image: {
            preferredProviderId: "fal",
          },
        },
      },
    });

    await expect(getConfig()).resolves.toEqual(
      expect.objectContaining({
        default_provider: "claude",
        workspace_preferences: expect.objectContaining({
          media_defaults: expect.objectContaining({
            image: expect.objectContaining({
              preferredProviderId: "fal",
            }),
          }),
        }),
      }),
    );
    const config = await getConfig();
    expect(config.workspace_preferences).toEqual(
      expect.objectContaining({
        media_defaults: expect.objectContaining({
          image: expect.objectContaining({
            preferredProviderId: "fal",
          }),
        }),
      }),
    );
  });

  it("saveConfig 应写入 workspace_preferences", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce(undefined);

    const config = {
      default_provider: "claude",
      workspace_preferences: {
        media_defaults: {
          voice: { preferredProviderId: "openai" },
        },
      },
    } as never;

    await expect(saveConfig(config)).resolves.toBeUndefined();

    expect(vi.mocked(safeInvoke)).toHaveBeenCalledWith("save_config", {
      config,
    });
  });

  it("getConfig 应缓存并复用同一轮读取结果", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      default_provider: "claude",
      navigation: { enabled_items: ["agent"] },
    });

    const [first, second] = await Promise.all([getConfig(), getConfig()]);

    expect(vi.mocked(safeInvoke)).toHaveBeenCalledTimes(1);
    expect(first).toEqual(
      expect.objectContaining({ default_provider: "claude" }),
    );
    expect(second).toEqual(
      expect.objectContaining({ default_provider: "claude" }),
    );
    expect(first).not.toBe(second);
  });

  it("saveConfig 后后续 getConfig 应直接命中新缓存", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce(undefined);

    const nextConfig = {
      default_provider: "kiro",
      navigation: { enabled_items: ["agent", "tools"] },
    } as never;

    await expect(saveConfig(nextConfig)).resolves.toBeUndefined();
    await expect(getConfig()).resolves.toEqual(
      expect.objectContaining({
        default_provider: "kiro",
        navigation: { enabled_items: ["agent", "tools"] },
      }),
    );

    expect(vi.mocked(safeInvoke)).toHaveBeenCalledTimes(1);
  });

  it("setDefaultProvider 应更新已缓存配置中的 default_provider", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({
        default_provider: "claude",
        navigation: { enabled_items: ["agent"] },
      })
      .mockResolvedValueOnce("gemini");

    await getConfig();
    await expect(setDefaultProvider("gemini")).resolves.toBe("gemini");
    await expect(getConfig()).resolves.toEqual(
      expect.objectContaining({ default_provider: "gemini" }),
    );

    expect(vi.mocked(safeInvoke)).toHaveBeenCalledTimes(2);
  });

  it("updateProviderEnvVars 后应失效缓存并触发下一次重新读取", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({
        default_provider: "claude",
        navigation: { enabled_items: ["agent"] },
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        default_provider: "openai",
        navigation: { enabled_items: ["agent", "tools"] },
      });

    await getConfig();
    await updateProviderEnvVars("openai", "https://example.com", "key");
    await expect(getConfig()).resolves.toEqual(
      expect.objectContaining({
        default_provider: "openai",
        navigation: { enabled_items: ["agent", "tools"] },
      }),
    );

    expect(vi.mocked(safeInvoke)).toHaveBeenCalledTimes(3);
  });
});
