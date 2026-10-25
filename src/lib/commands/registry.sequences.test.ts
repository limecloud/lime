import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerCommand,
  setCommandBindingOverrides,
  type CommandRegistration,
} from "./registry";

const releases: (() => void)[] = [];
function mount(
  id: string,
  binding: string,
  options: Partial<CommandRegistration> = {},
) {
  const handler = vi.fn();
  const release = registerCommand({
    id,
    titleKey: id,
    section: "thread",
    bindings: [binding],
    handler,
    ...options,
  });
  releases.push(release);
  return { handler, release };
}
function key(
  name: string,
  target: EventTarget = window,
  options: ConstructorParameters<typeof KeyboardEvent>[1] = {},
) {
  const event = new KeyboardEvent("keydown", {
    key: name,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  target.dispatchEvent(event);
  return event;
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  releases
    .splice(0)
    .reverse()
    .forEach((release) => release());
  setCommandBindingOverrides({});
  document.body.innerHTML = "";
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

describe("实际命令序列派发", () => {
  it("共享首键只等待，续键执行对应的同一handler", () => {
    const first = mount("first", "G G");
    const second = mount("second", "G S");
    expect(key("g").defaultPrevented).toBe(true);
    expect(first.handler).not.toHaveBeenCalled();
    expect(second.handler).not.toHaveBeenCalled();
    key("s");
    expect(second.handler).toHaveBeenCalledOnce();
    key("g");
    key("g");
    expect(first.handler).toHaveBeenCalledOnce();
    expect(second.handler).toHaveBeenCalledOnce();
  });

  it("配置可包含超过两键的序列，每步重新计时且只在完成时执行", () => {
    const command = mount("long", "A B Control+C");
    key("a");
    vi.advanceTimersByTime(999);
    key("b");
    vi.advanceTimersByTime(999);
    expect(command.handler).not.toHaveBeenCalled();
    key("c", window, { ctrlKey: true });
    expect(command.handler).toHaveBeenCalledOnce();
  });

  it("一秒超时不执行；失配键可作为另一命令的新首键", () => {
    const sequence = mount("sequence", "G G");
    const other = mount("other", "X");
    key("g");
    vi.advanceTimersByTime(1000);
    key("g");
    expect(sequence.handler).not.toHaveBeenCalled();
    expect(key("x").defaultPrevented).toBe(true);
    expect(other.handler).toHaveBeenCalledOnce();
    expect(sequence.handler).not.toHaveBeenCalled();
  });

  it("修饰键中间事件与重复首键不误执行，默认拒绝自动重复", () => {
    const sequence = mount("sequence", "G Control+S");
    key("g");
    key("g", window, { repeat: true });
    key("Control", window, { ctrlKey: true });
    key("s", window, { ctrlKey: true });
    expect(sequence.handler).toHaveBeenCalledOnce();
    const single = mount("single", "X");
    key("x", window, { repeat: true });
    expect(single.handler).not.toHaveBeenCalled();
    const repeatable = mount("repeatable", "Y", { allowRepeat: true });
    key("y", window, { repeat: true });
    expect(repeatable.handler).toHaveBeenCalledOnce();
  });

  it.each(["ime", "handled", "blur", "focusout", "override", "unmount"])(
    "%s会撤销待续状态",
    (reason) => {
      const command = mount("sequence", "G G");
      key("g");
      if (reason === "ime") key("Process", window, { isComposing: true });
      if (reason === "handled") {
        const event = new KeyboardEvent("keydown", {
          key: "x",
          cancelable: true,
        });
        event.preventDefault();
        window.dispatchEvent(event);
      }
      if (reason === "blur" || reason === "focusout")
        window.dispatchEvent(new Event(reason));
      if (reason === "override")
        setCommandBindingOverrides({ sequence: ["G G"] });
      if (reason === "unmount") {
        command.release();
        mount("replacement", "G G");
      }
      key("g");
      expect(command.handler).not.toHaveBeenCalled();
    },
  );

  it("输入/弹窗/捕获控件保持隔离，焦点目标改变不能续键", () => {
    const command = mount("sequence", "G G");
    const input = document.createElement("input");
    document.body.append(input);
    key("g");
    key("g", input);
    expect(command.handler).not.toHaveBeenCalled();
    key("g", document.body);
    expect(command.handler).not.toHaveBeenCalled();
    key("g", document.body);
    expect(command.handler).toHaveBeenCalledOnce();
    const capture = mount("capture", "A A", {
      allowInInput: true,
      allowInDialog: true,
    });
    input.dataset.shortcutCapture = "";
    key("a", input);
    key("a", input);
    expect(capture.handler).not.toHaveBeenCalled();
    delete input.dataset.shortcutCapture;
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.append(input);
    document.body.append(dialog);
    key("g", input);
    key("g", input);
    expect(command.handler).toHaveBeenCalledOnce();
  });

  it("局部capture和全局bubble共享事件时只执行一个处理器", () => {
    const editor = document.createElement("div");
    document.body.append(editor);
    const global = mount("global", "G G");
    const local = mount("local", "G G", { target: editor, capture: true });
    key("g", editor);
    key("g", editor);
    expect(local.handler).toHaveBeenCalledOnce();
    expect(global.handler).not.toHaveBeenCalled();
    local.release();
    key("g", editor);
    key("g", editor);
    expect(global.handler).toHaveBeenCalledOnce();
  });
});
