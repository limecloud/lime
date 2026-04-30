import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  getHotkeyRuntimeStatus,
  getScreenshotShortcutRuntimeStatus,
  getVoiceShortcutRuntimeStatus,
} from "./hotkeys";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("hotkeys API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理截图与语音快捷键运行时状态查询", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({
        shortcut_registered: true,
        registered_shortcut: "CommandOrControl+Alt+Q",
      })
      .mockResolvedValueOnce({
        shortcut_registered: true,
        registered_shortcut: "CommandOrControl+Shift+V",
        translate_shortcut_registered: false,
        registered_translate_shortcut: null,
        fn_supported: false,
        fn_registered: false,
        fn_fallback_shortcut: "CommandOrControl+Shift+V",
        fn_note: "Fn 按住录音当前仅支持 macOS；已使用普通语音快捷键回退。",
      });

    await expect(getScreenshotShortcutRuntimeStatus()).resolves.toEqual(
      expect.objectContaining({ shortcut_registered: true }),
    );
    await expect(getVoiceShortcutRuntimeStatus()).resolves.toEqual(
      expect.objectContaining({ shortcut_registered: true }),
    );
  });

  it("应聚合整体快捷键运行时状态", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({
        shortcut_registered: false,
        registered_shortcut: null,
      })
      .mockResolvedValueOnce({
        shortcut_registered: true,
        registered_shortcut: "CommandOrControl+Shift+V",
        translate_shortcut_registered: true,
        registered_translate_shortcut: "CommandOrControl+Shift+T",
        fn_supported: false,
        fn_registered: false,
        fn_fallback_shortcut: "CommandOrControl+Shift+V",
        fn_note: "Fn 按住录音当前仅支持 macOS；已使用普通语音快捷键回退。",
      });

    await expect(getHotkeyRuntimeStatus()).resolves.toEqual({
      screenshot: expect.objectContaining({ shortcut_registered: false }),
      voice: expect.objectContaining({
        translate_shortcut_registered: true,
        fn_supported: false,
      }),
    });

    expect(safeInvoke).toHaveBeenNthCalledWith(
      1,
      "get_screenshot_shortcut_runtime_status",
    );
    expect(safeInvoke).toHaveBeenNthCalledWith(
      2,
      "get_voice_shortcut_runtime_status",
    );
  });
});
