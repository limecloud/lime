import { describe, expect, it } from "vitest";
import { resolveDocumentEditorHotkeyAction } from "./documentEditorHotkeys";

describe("document editor hotkeys", () => {
  it("应解析保存与退出快捷键", () => {
    expect(resolveDocumentEditorHotkeyAction({ key: "s", ctrlKey: true })).toBe(
      "save",
    );
    expect(resolveDocumentEditorHotkeyAction({ key: "Escape" })).toBe("cancel");
  });

  it("不应错误匹配其他按键", () => {
    expect(resolveDocumentEditorHotkeyAction({ key: "s" })).toBeNull();
    expect(
      resolveDocumentEditorHotkeyAction({ key: "Enter", ctrlKey: true }),
    ).toBeNull();
  });
});
