import { describe, expect, it } from "vitest";
import {
  bindingIdentity,
  captureBinding,
  matchesBinding,
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
    "Control+K Control+S",
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
  it("平台主键冲突与实际按键使用同一身份，额外修饰键不匹配", () => {
    expect(bindingIdentity("CommandOrControl+K", "mac")).toBe(
      bindingIdentity("Command+K", "mac"),
    );
    expect(bindingIdentity("CommandOrControl+K", "windows")).toBe(
      bindingIdentity("Control+K", "windows"),
    );
    const event = {
      key: "k",
      ctrlKey: false,
      metaKey: true,
      shiftKey: false,
      altKey: false,
    };
    expect(matchesBinding(event, "CommandOrControl+K", "mac")).toBe(true);
    expect(matchesBinding(event, "CommandOrControl+K", "windows")).toBe(false);
    expect(
      matchesBinding({ ...event, ctrlKey: true }, "CommandOrControl+K", "mac"),
    ).toBe(false);
  });
});
