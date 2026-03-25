import { describe, expect, it } from "vitest";
import { resolvePosterCanvasHotkeyAction } from "./posterCanvasHotkeys";

describe("poster canvas hotkeys", () => {
  it("应解析撤销、重做与全选快捷键", () => {
    expect(
      resolvePosterCanvasHotkeyAction({ key: "z", ctrlKey: true }),
    ).toBe("undo");
    expect(
      resolvePosterCanvasHotkeyAction({
        key: "z",
        ctrlKey: true,
        shiftKey: true,
      }),
    ).toBe("redo");
    expect(
      resolvePosterCanvasHotkeyAction({ key: "y", ctrlKey: true }),
    ).toBe("redo");
    expect(
      resolvePosterCanvasHotkeyAction({ key: "a", ctrlKey: true }),
    ).toBe("select-all");
  });

  it("输入框聚焦时应忽略海报快捷键", () => {
    const input = document.createElement("input");

    expect(
      resolvePosterCanvasHotkeyAction({
        key: "z",
        ctrlKey: true,
        target: input,
      }),
    ).toBeNull();
    expect(
      resolvePosterCanvasHotkeyAction({
        key: "g",
        ctrlKey: true,
        target: input,
      }),
    ).toBeNull();
    expect(
      resolvePosterCanvasHotkeyAction({
        key: "g",
        ctrlKey: true,
        shiftKey: true,
        target: input,
      }),
    ).toBeNull();
  });

  it("应解析组合与取消组合快捷键", () => {
    expect(
      resolvePosterCanvasHotkeyAction({ key: "g", ctrlKey: true }),
    ).toBe("group");
    expect(
      resolvePosterCanvasHotkeyAction({
        key: "g",
        ctrlKey: true,
        shiftKey: true,
      }),
    ).toBe("ungroup");
  });
});
