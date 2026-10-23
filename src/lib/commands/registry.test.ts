import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getRegisteredCommands,
  registerCommand,
  runCommand,
  subscribeCommands,
  setCommandBindingOverrides,
  type CommandRegistration,
} from "./registry";

const releases: (() => void)[] = [];
function mountCommand(overrides: Partial<CommandRegistration> = {}) {
  const handler = vi.fn();
  const release = registerCommand({
    id: "testSearch",
    titleKey: "search",
    section: "navigation",
    bindings: ["CommandOrControl+K"],
    handler,
    ...overrides,
  });
  releases.push(release);
  return { handler, release };
}
function key(
  target: EventTarget,
  options: ConstructorParameters<typeof KeyboardEvent>[1] = {},
) {
  const event = new KeyboardEvent("keydown", {
    key: "k",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  target.dispatchEvent(event);
  return event;
}
afterEach(() => {
  for (const release of releases.splice(0).reverse()) release();
  setCommandBindingOverrides({});
  document.body.innerHTML = "";
});

describe("实际 UI command 注册", () => {
  it("重绑立即改变现有handler，清除仍可在列表恢复，取消投影恢复默认值", () => {
    const { handler } = mountCommand();
    setCommandBindingOverrides({ testSearch: ["Control+J"] });
    key(window);
    expect(handler).not.toHaveBeenCalled();
    key(window, { key: "j" });
    expect(handler).toHaveBeenCalledOnce();
    expect(getRegisteredCommands()[0]).toMatchObject({
      bindings: ["Control+J"],
      defaultBindings: ["CommandOrControl+K"],
      customized: true,
    });
    setCommandBindingOverrides({ testSearch: [] });
    key(window, { key: "j" });
    expect(handler).toHaveBeenCalledOnce();
    expect(getRegisteredCommands()[0].bindings).toEqual([]);
    expect(runCommand("testSearch")).toBe(true);
    setCommandBindingOverrides({});
    key(window);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("捕获输入即使允许输入与弹窗也不触发全局命令", () => {
    const input = document.createElement("input");
    input.dataset.shortcutCapture = "";
    document.body.append(input);
    const { handler } = mountCommand({
      allowInInput: true,
      allowInDialog: true,
    });
    expect(key(input).defaultPrevented).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
  it("菜单与键盘执行同一 handler，卸载同时撤销键盘和列表", () => {
    const { handler, release } = mountCommand();
    expect(getRegisteredCommands().map((command) => command.id)).toEqual([
      "testSearch",
    ]);
    expect(runCommand("testSearch")).toBe(true);
    expect(key(window).defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledTimes(2);
    release();
    expect(runCommand("testSearch")).toBe(false);
    key(window);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(getRegisteredCommands()).toEqual([]);
  });

  it("未绑定和不可用命令不进列表，不可用命令不截断按键", () => {
    const disabled = mountCommand({ id: "disabled", enabled: false });
    const unbound = mountCommand({ id: "unbound", bindings: [] });
    expect(getRegisteredCommands()).toEqual([]);
    expect(key(window).defaultPrevented).toBe(false);
    expect(runCommand("disabled")).toBe(false);
    expect(disabled.handler).not.toHaveBeenCalled();
    expect(unbound.handler).not.toHaveBeenCalled();
  });

  it("同一 target 冲突采用最新注册，撤销后恢复上一处理器", () => {
    const earlier = mountCommand({ id: "earlier" });
    const later = mountCommand({ id: "later" });
    key(window);
    expect(earlier.handler).not.toHaveBeenCalled();
    expect(later.handler).toHaveBeenCalledOnce();
    later.release();
    key(window);
    expect(earlier.handler).toHaveBeenCalledOnce();
  });

  it("IME、已处理事件与多余修饰键不会执行命令", () => {
    const { handler } = mountCommand();
    key(window, { isComposing: true });
    key(window, { keyCode: 229 });
    key(window, { shiftKey: true });
    key(window, { altKey: true });
    key(window, { metaKey: true });
    const handled = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      cancelable: true,
    });
    handled.preventDefault();
    window.dispatchEvent(handled);
    expect(handler).not.toHaveBeenCalled();
    key(window);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("CommandOrControl 与显示平台一致：mac 只认 Meta，Windows 只认 Ctrl", () => {
    const platform = vi.spyOn(navigator, "platform", "get");
    const userAgent = vi
      .spyOn(navigator, "userAgent", "get")
      .mockReturnValue("");
    try {
      const { handler } = mountCommand();
      platform.mockReturnValue("MacIntel");
      key(window);
      expect(handler).not.toHaveBeenCalled();
      key(window, { ctrlKey: false, metaKey: true });
      expect(handler).toHaveBeenCalledOnce();
      platform.mockReturnValue("Win32");
      key(window, { ctrlKey: false, metaKey: true });
      expect(handler).toHaveBeenCalledOnce();
      key(window);
      expect(handler).toHaveBeenCalledTimes(2);
    } finally {
      platform.mockRestore();
      userAgent.mockRestore();
    }
  });

  it("背景命令不抢占输入或弹窗，显式允许的命令保留输入能力", () => {
    const input = document.createElement("input");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.append(input);
    document.body.append(dialog);
    const background = mountCommand();
    key(input);
    expect(background.handler).not.toHaveBeenCalled();
    const allowed = mountCommand({
      id: "showHelp",
      allowInInput: true,
      allowInDialog: true,
    });
    key(input);
    expect(allowed.handler).toHaveBeenCalledOnce();
  });

  it("局部捕获保留 DOM 边界，target 不存在时不注册", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    document.body.append(editor);
    const local = mountCommand({
      target: editor,
      capture: true,
      allowInInput: true,
      bindings: ["CommandOrControl+S"],
    });
    mountCommand({ id: "missing", target: null });
    key(window, { key: "s" });
    expect(local.handler).not.toHaveBeenCalled();
    key(editor, { key: "s" });
    expect(local.handler).toHaveBeenCalledOnce();
    expect(getRegisteredCommands().map((command) => command.id)).toEqual([
      "testSearch",
    ]);
  });

  it("订阅只响应注册生命周期并可撤销", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCommands(listener);
    const command = mountCommand();
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    command.release();
    expect(listener).toHaveBeenCalledOnce();
  });
});
