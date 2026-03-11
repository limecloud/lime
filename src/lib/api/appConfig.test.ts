import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  getConfig,
  getDefaultProvider,
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
});
