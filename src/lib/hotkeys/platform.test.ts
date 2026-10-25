import { describe, expect, it } from "vitest";
import {
  formatShortcutTokens,
  formatShortcutStrokes,
  hasPrimaryModifier,
  isInputLikeTarget,
  normalizeHotkeyKey,
  resolveHotkeyPlatform,
  UNSET_SHORTCUT_TOKEN,
} from "./platform";

describe("hotkey platform helpers", () => {
  it("应识别常见平台", () => {
    expect(
      resolveHotkeyPlatform({
        platform: "MacIntel",
        userAgent: "Mozilla/5.0 (Macintosh)",
      }),
    ).toBe("mac");
    expect(
      resolveHotkeyPlatform({
        platform: "Win32",
        userAgent: "Mozilla/5.0 (Windows NT 10.0)",
      }),
    ).toBe("windows");
    expect(
      resolveHotkeyPlatform({
        platform: "Linux x86_64",
        userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
      }),
    ).toBe("other");
  });

  it("应按平台格式化快捷键显示", () => {
    expect(formatShortcutTokens("CommandOrControl+Shift+S", "mac")).toEqual([
      "⌘",
      "⇧",
      "S",
    ]);
    expect(
      formatShortcutTokens("CommandOrControl+Alt+Escape", "windows"),
    ).toEqual(["Ctrl", "Alt", "Esc"]);
    expect(formatShortcutTokens("", "other")).toEqual([UNSET_SHORTCUT_TOKEN]);
    expect(formatShortcutTokens("+", "other")).toEqual([UNSET_SHORTCUT_TOKEN]);
  });

  it("逐stroke保留序列分组，并对每个stroke使用相同平台显示", () => {
    expect(
      formatShortcutStrokes("Control + K CommandOrControl + S", "mac"),
    ).toEqual([
      ["Ctrl", "K"],
      ["⌘", "S"],
    ]);
    expect(formatShortcutStrokes("G G", "windows")).toEqual([["G"], ["G"]]);
    expect(formatShortcutTokens("Control+K Control+S", "windows")).toEqual([
      "Ctrl",
      "K",
      "Ctrl",
      "S",
    ]);
  });

  it("应识别输入类目标", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", {
      configurable: true,
      value: true,
    });

    expect(isInputLikeTarget(input)).toBe(true);
    expect(isInputLikeTarget(textarea)).toBe(true);
    expect(isInputLikeTarget(editable)).toBe(true);
    expect(isInputLikeTarget(document.createElement("div"))).toBe(false);
    expect(isInputLikeTarget(null)).toBe(false);
  });

  it("应识别主修饰键并标准化字符键", () => {
    expect(hasPrimaryModifier({ key: "a", ctrlKey: true })).toBe(true);
    expect(hasPrimaryModifier({ key: "a", metaKey: true })).toBe(true);
    expect(hasPrimaryModifier({ key: "a", altKey: true })).toBe(false);

    expect(normalizeHotkeyKey("A")).toBe("a");
    expect(normalizeHotkeyKey("Escape")).toBe("Escape");
  });
});
