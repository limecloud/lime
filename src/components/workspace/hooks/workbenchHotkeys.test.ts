import { describe, expect, it } from "vitest";
import {
  WORKBENCH_SIDEBAR_TOGGLE_HOTKEY,
  resolveWorkbenchHotkeyAction,
} from "./workbenchHotkeys";

describe("workbench hotkeys", () => {
  it("应暴露侧栏切换定义", () => {
    expect(WORKBENCH_SIDEBAR_TOGGLE_HOTKEY.shortcut).toBe(
      "CommandOrControl+B",
    );
    expect(WORKBENCH_SIDEBAR_TOGGLE_HOTKEY.scene).toBe("workspace");
  });

  it("应解析侧栏切换快捷键", () => {
    expect(
      resolveWorkbenchHotkeyAction({ key: "b", ctrlKey: true }),
    ).toBe("toggle-sidebar");
    expect(
      resolveWorkbenchHotkeyAction({ key: "B", metaKey: true }),
    ).toBe("toggle-sidebar");
    expect(resolveWorkbenchHotkeyAction({ key: "b" })).toBeNull();
    expect(
      resolveWorkbenchHotkeyAction({ key: "k", ctrlKey: true }),
    ).toBeNull();
  });
});
