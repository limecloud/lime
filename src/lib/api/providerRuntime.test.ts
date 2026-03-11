import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  checkAndReloadCredentials,
  checkAndReloadGeminiCredentials,
  checkAndReloadQwenCredentials,
  getClaudeCustomStatus,
  getEnvVariables,
  getGeminiCredentials,
  getKiroCredentials,
  getOpenAICustomStatus,
  getQwenCredentials,
  getTokenFileHash,
  refreshGeminiToken,
  refreshKiroToken,
  refreshQwenToken,
  reloadCredentials,
  reloadGeminiCredentials,
  reloadQwenCredentials,
  setClaudeCustomConfig,
  setOpenAICustomConfig,
} from "./providerRuntime";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("providerRuntime API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理 OAuth 凭证状态与刷新命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ loaded: true })
      .mockResolvedValueOnce([{ key: "A", value: "1", masked: "***" }])
      .mockResolvedValueOnce("hash")
      .mockResolvedValueOnce({ changed: true })
      .mockResolvedValueOnce("ok")
      .mockResolvedValueOnce("ok")
      .mockResolvedValueOnce({ loaded: true })
      .mockResolvedValueOnce("ok")
      .mockResolvedValueOnce("ok")
      .mockResolvedValueOnce({ changed: false })
      .mockResolvedValueOnce({ loaded: true })
      .mockResolvedValueOnce("ok")
      .mockResolvedValueOnce("ok")
      .mockResolvedValueOnce({ changed: false });

    await expect(getKiroCredentials()).resolves.toEqual(
      expect.objectContaining({ loaded: true }),
    );
    await expect(getEnvVariables()).resolves.toEqual([
      expect.objectContaining({ key: "A" }),
    ]);
    await expect(getTokenFileHash()).resolves.toBe("hash");
    await expect(checkAndReloadCredentials("h")).resolves.toEqual(
      expect.objectContaining({ changed: true }),
    );
    await expect(refreshKiroToken()).resolves.toBe("ok");
    await expect(reloadCredentials()).resolves.toBe("ok");
    await expect(getGeminiCredentials()).resolves.toEqual(
      expect.objectContaining({ loaded: true }),
    );
    await expect(refreshGeminiToken()).resolves.toBe("ok");
    await expect(reloadGeminiCredentials()).resolves.toBe("ok");
    await expect(checkAndReloadGeminiCredentials("h")).resolves.toEqual(
      expect.objectContaining({ changed: false }),
    );
    await expect(getQwenCredentials()).resolves.toEqual(
      expect.objectContaining({ loaded: true }),
    );
    await expect(refreshQwenToken()).resolves.toBe("ok");
    await expect(reloadQwenCredentials()).resolves.toBe("ok");
    await expect(checkAndReloadQwenCredentials("h")).resolves.toEqual(
      expect.objectContaining({ changed: false }),
    );
  });

  it("应代理 OpenAI/Claude 自定义状态与保存命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ enabled: true })
      .mockResolvedValueOnce("saved")
      .mockResolvedValueOnce({ enabled: false })
      .mockResolvedValueOnce("saved");

    await expect(getOpenAICustomStatus()).resolves.toEqual(
      expect.objectContaining({ enabled: true }),
    );
    await expect(
      setOpenAICustomConfig("key", "https://example.com", true),
    ).resolves.toBe("saved");
    await expect(getClaudeCustomStatus()).resolves.toEqual(
      expect.objectContaining({ enabled: false }),
    );
    await expect(
      setClaudeCustomConfig("key", "https://example.com", true),
    ).resolves.toBe("saved");
  });
});
