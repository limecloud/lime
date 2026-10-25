import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { getRegisteredCommands } from "@/lib/commands/registry";
import { NotionEditor } from "./NotionEditor";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
const originalRects = Object.getOwnPropertyDescriptor(
  Range.prototype,
  "getClientRects",
);
const originalBoundingRect = Object.getOwnPropertyDescriptor(
  Range.prototype,
  "getBoundingClientRect",
);
beforeAll(() => {
  // jsdom 不提供布局；本测试只验证真实编辑器命令，不验证坐标。
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(),
  });
});
afterAll(() => {
  if (originalRects)
    Object.defineProperty(Range.prototype, "getClientRects", originalRects);
  else Reflect.deleteProperty(Range.prototype, "getClientRects");
  if (originalBoundingRect)
    Object.defineProperty(
      Range.prototype,
      "getBoundingClientRect",
      originalBoundingRect,
    );
  else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
});
beforeEach(async () => {
  await changeLimeLocale("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

describe("NotionEditor actual command registration", () => {
  it("实际编辑器保存/退出走注册 handler，IME 不触发，卸载撤销", async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    await act(async () =>
      root.render(
        <NotionEditor
          content="Hello"
          onCommit={vi.fn()}
          onSave={onSave}
          onCancel={onCancel}
        />,
      ),
    );
    const editor = await vi.waitFor(() => {
      const element = container.querySelector<HTMLElement>(
        '[contenteditable="true"]',
      );
      expect(element).not.toBeNull();
      return element!;
    });
    expect(
      getRegisteredCommands()
        .map((command) => command.id)
        .sort(),
    ).toEqual(["cancelDocumentEditing", "saveDocument"]);
    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "s",
          ctrlKey: true,
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "s",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onSave).toHaveBeenCalledWith("Hello");
    expect(onCancel).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    expect(getRegisteredCommands()).toEqual([]);
  });

  it("只读编辑器没有可执行/可列出的保存与退出命令", async () => {
    const onSave = vi.fn();
    await act(async () =>
      root.render(
        <NotionEditor
          readOnly
          content="Hello"
          onCommit={vi.fn()}
          onSave={onSave}
          onCancel={vi.fn()}
        />,
      ),
    );
    await vi.waitFor(() =>
      expect(container.querySelector(".tiptap")).not.toBeNull(),
    );
    expect(getRegisteredCommands()).toEqual([]);
    const editor = container.querySelector(".tiptap")!;
    await act(async () =>
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "s",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onSave).not.toHaveBeenCalled();
  });
});
