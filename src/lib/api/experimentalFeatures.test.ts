import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  getExperimentalConfig,
  saveExperimentalConfig,
  updateScreenshotShortcut,
  validateShortcut,
} from "./experimentalFeatures";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("experimentalFeatures API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理实验配置读取与保存", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({
        screenshot_chat: { enabled: true, shortcut: "Cmd+Shift+4" },
      })
      .mockResolvedValueOnce(undefined);

    await expect(getExperimentalConfig()).resolves.toEqual(
      expect.objectContaining({ screenshot_chat: expect.any(Object) }),
    );
    await expect(
      saveExperimentalConfig({
        screenshot_chat: { enabled: true, shortcut: "Cmd+Shift+4" },
      } as never),
    ).resolves.toBeUndefined();
  });

  it("应代理快捷键验证与更新", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(undefined);

    await expect(validateShortcut("Cmd+Shift+4")).resolves.toBe(true);
    await expect(
      updateScreenshotShortcut("Cmd+Shift+4"),
    ).resolves.toBeUndefined();
  });
});
