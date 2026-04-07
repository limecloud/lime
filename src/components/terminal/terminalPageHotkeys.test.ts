import { describe, expect, it } from "vitest";
import {
  getTerminalPageHotkeys,
  resolveTerminalPageHotkeyAction,
} from "./terminalPageHotkeys";

describe("terminal page hotkeys", () => {
  it("应按平台返回已审计的终端快捷键目录", () => {
    expect(getTerminalPageHotkeys("windows")).toHaveLength(8);
    expect(getTerminalPageHotkeys("mac")).toHaveLength(10);
    expect(
      getTerminalPageHotkeys("mac").some(
        (item) => item.id === "terminal-scroll-bottom-mac",
      ),
    ).toBe(true);
  });

  it("应解析搜索与字体快捷键", () => {
    expect(
      resolveTerminalPageHotkeyAction({ key: "f", ctrlKey: true }, "windows"),
    ).toBe("open-search");
    expect(
      resolveTerminalPageHotkeyAction({ key: "=", metaKey: true }, "mac"),
    ).toBe("increase-font-size");
    expect(
      resolveTerminalPageHotkeyAction({ key: "-", ctrlKey: true }, "windows"),
    ).toBe("decrease-font-size");
    expect(
      resolveTerminalPageHotkeyAction({ key: "0", ctrlKey: true }, "windows"),
    ).toBe("reset-font-size");
  });

  it("应解析终端滚动快捷键", () => {
    expect(
      resolveTerminalPageHotkeyAction(
        { key: "End", shiftKey: true },
        "windows",
      ),
    ).toBe("scroll-to-bottom");
    expect(
      resolveTerminalPageHotkeyAction(
        { key: "PageUp", shiftKey: true },
        "windows",
      ),
    ).toBe("scroll-page-up");
    expect(
      resolveTerminalPageHotkeyAction({ key: "Home", metaKey: true }, "mac"),
    ).toBe("scroll-to-top");
    expect(
      resolveTerminalPageHotkeyAction(
        { key: "Home", metaKey: true },
        "windows",
      ),
    ).toBeNull();
  });
});
