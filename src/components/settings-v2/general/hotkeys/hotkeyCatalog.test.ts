import { describe, expect, it } from "vitest";
import { buildAuditedHotkeyCatalog } from "./hotkeyCatalog";

describe("hotkey catalog", () => {
  it("应构建 macOS 的完整已审计目录", () => {
    const catalog = buildAuditedHotkeyCatalog({
      platform: "mac",
      experimentalConfig: {
        screenshot_chat: {
          enabled: true,
          shortcut: "CommandOrControl+Shift+4",
        },
      },
      voiceConfig: {
        enabled: true,
        shortcut: "CommandOrControl+Shift+V",
        translate_shortcut: "CommandOrControl+Shift+T",
        translate_instruction_id: "translate-1",
      },
      runtimeStatus: {
        screenshot: {
          shortcut_registered: true,
          registered_shortcut: "CommandOrControl+Shift+4",
        },
        voice: {
          shortcut_registered: true,
          registered_shortcut: "CommandOrControl+Shift+V",
          translate_shortcut_registered: true,
          registered_translate_shortcut: "CommandOrControl+Shift+T",
        },
      },
    });

    expect(catalog.summary).toEqual({
      total: 24,
      ready: 24,
      attention: 0,
      globalReady: 3,
    });
    expect(catalog.sections.find((section) => section.scene === "terminal")?.hotkeys).toHaveLength(10);
    expect(
      catalog.sections
        .find((section) => section.scene === "terminal")
        ?.hotkeys.some((item) => item.id === "terminal-scroll-bottom-mac"),
    ).toBe(true);
  });

  it("应正确标记未启用、未配置与运行时异常状态", () => {
    const catalog = buildAuditedHotkeyCatalog({
      platform: "windows",
      experimentalConfig: {
        screenshot_chat: {
          enabled: false,
          shortcut: "",
        },
      },
      voiceConfig: {
        enabled: true,
        shortcut: "CommandOrControl+Shift+V",
        translate_shortcut: "CommandOrControl+Shift+T",
        translate_instruction_id: "",
      },
      runtimeStatus: {
        screenshot: {
          shortcut_registered: false,
          registered_shortcut: null,
        },
        voice: {
          shortcut_registered: false,
          registered_shortcut: null,
          translate_shortcut_registered: false,
          registered_translate_shortcut: null,
        },
      },
    });

    const globalSection = catalog.sections.find(
      (section) => section.scene === "global",
    );

    expect(globalSection?.hotkeys[0]).toEqual(
      expect.objectContaining({
        status: "inactive",
        statusLabel: "功能未启用",
      }),
    );
    expect(globalSection?.hotkeys[1]).toEqual(
      expect.objectContaining({
        status: "runtime-error",
        statusLabel: "未注册到系统",
      }),
    );
    expect(globalSection?.hotkeys[2]).toEqual(
      expect.objectContaining({
        status: "needs-config",
        statusLabel: "未绑定翻译指令",
      }),
    );
    expect(catalog.summary.globalReady).toBe(0);
    expect(catalog.summary.total).toBe(22);
  });
});
