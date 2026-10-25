import { describe, expect, it } from "vitest";
import {
  bindingIdentity,
  bindingMatchesPrefix,
  bindingsConflict,
  captureBinding,
  normalizeBinding,
} from "./bindings";

describe("键位解析、捕获和派发", () => {
  it("规范大小写与修饰键顺序，保留主键和功能键", () => {
    expect(normalizeBinding(" shift + commandorcontrol + k ")).toBe(
      "CommandOrControl+Shift+K",
    );
    expect(normalizeBinding("alt+f24")).toBe("Alt+F24");
    expect(normalizeBinding("control+plus")).toBe("Control+Plus");
    expect(normalizeBinding("Escape")).toBe("Escape");
  });
  it.each([
    "",
    "Control",
    "Hyper+K",
    "Control+Control+K",
    "CommandOrControl+Command+K",
    "F25",
    "F01",
    "Control+K Hyper+S",
  ])("拒绝无效或不支持的组合 %s", (binding) =>
    expect(normalizeBinding(binding)).toBeNull(),
  );
  it("只捕获完整组合，不能将修饰键或IME文本写成快捷键", () => {
    const key = (name: string, extra = {}) =>
      captureBinding({
        key: name,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        ...extra,
      });
    expect(key("Control")).toBeNull();
    expect(key("Process")).toBeNull();
    expect(key("中")).toBeNull();
    expect(key("k", { ctrlKey: true, shiftKey: true })).toBe("Control+Shift+K");
    expect(key(" ", { altKey: true })).toBe("Alt+Space");
    expect(key("+", { metaKey: true })).toBe("Command+Plus");
  });
  it("每一键独立规范化，平台身份覆盖整个序列，前缀与相邻键不混淆", () => {
    expect(normalizeBinding(" g   commandorcontrol + s ")).toBe(
      "G CommandOrControl+S",
    );
    expect(
      bindingIdentity("CommandOrControl+K CommandOrControl+S", "mac"),
    ).toBe("Command+K Command+S");
    expect(normalizeBinding("A B C")).toBe("A B C");
    expect(bindingMatchesPrefix("G Control+S", "G", "windows")).toBe(true);
    expect(bindingMatchesPrefix("G", "G G", "windows")).toBe(false);
    expect(bindingsConflict("G G", "G", "windows")).toBe(true);
    expect(bindingsConflict("G", "G G", "windows")).toBe(true);
    expect(bindingsConflict("G G", "G H", "windows")).toBe(false);
    expect(bindingsConflict("G", "Control+G", "windows")).toBe(false);
    expect(bindingsConflict("G", "Hyper+G", "windows")).toBe(false);
  });
  it("平台主键身份与显式修饰键一致，不丢弃多余修饰键", () => {
    expect(bindingIdentity("CommandOrControl+K", "mac")).toBe(
      bindingIdentity("Command+K", "mac"),
    );
    expect(bindingIdentity("CommandOrControl+K", "windows")).toBe(
      bindingIdentity("Control+K", "windows"),
    );
    expect(bindingIdentity("Command+Control+K", "mac")).not.toBe(
      bindingIdentity("CommandOrControl+K", "mac"),
    );
  });
});
