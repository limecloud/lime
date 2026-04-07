import { describe, expect, it } from "vitest";
import { resolveDocumentCanvasHotkeyAction } from "./documentCanvasHotkeys";

describe("document canvas hotkeys", () => {
  it("应解析撤销与重做快捷键", () => {
    expect(resolveDocumentCanvasHotkeyAction({ key: "z", ctrlKey: true })).toBe(
      "undo",
    );
    expect(
      resolveDocumentCanvasHotkeyAction({
        key: "z",
        ctrlKey: true,
        shiftKey: true,
      }),
    ).toBe("redo");
  });

  it("不应在缺少主修饰键时触发", () => {
    expect(resolveDocumentCanvasHotkeyAction({ key: "z" })).toBeNull();
    expect(
      resolveDocumentCanvasHotkeyAction({ key: "y", ctrlKey: true }),
    ).toBeNull();
  });
});
