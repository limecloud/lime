import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TextSelection } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerController } from "./ComposerController";
import { composerSchema } from "./composerSchema";
import {
  ComposerEditor,
  type ComposerEditorHandle,
  type ComposerEditorProps,
} from "./ComposerEditor";

const mounted: { root: Root; container: HTMLElement }[] = [];
const rangeDescriptors = new Map(
  ["getClientRects", "getBoundingClientRect"].map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(Range.prototype, name)] as const,
  ),
);

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(0, 0, 1, 1),
  });
});

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const [name, descriptor] of rangeDescriptors) {
    if (descriptor) Object.defineProperty(Range.prototype, name, descriptor);
    else Reflect.deleteProperty(Range.prototype, name);
  }
});

function mount(options: Partial<ComposerEditorProps> = {}) {
  const controller =
    options.controller ?? new ComposerController({ text: "中😀" });
  const editorRef = createRef<ComposerEditorHandle>();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() =>
    root.render(
      <ComposerEditor
        {...options}
        controller={controller}
        editorRef={editorRef}
      />,
    ),
  );
  const element = editorRef.current?.getElement();
  if (!element || !editorRef.current) throw new Error("missing editor");
  return { controller, editorRef, element, root, container };
}

function key(
  element: HTMLElement,
  keyValue: string,
  options: NonNullable<ConstructorParameters<typeof KeyboardEvent>[1]> = {},
) {
  const event = new KeyboardEvent("keydown", {
    key: keyValue,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  act(() => {
    element.dispatchEvent(event);
  });
  return event;
}

function paste(element: HTMLElement, text: string) {
  const event = new Event("paste", {
    bubbles: true,
    cancelable: true,
  }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (format: string) => (format === "text/plain" ? text : ""),
    },
  });
  act(() => {
    element.dispatchEvent(event);
  });
  return event;
}

describe("ComposerEditor", () => {
  const enterModes = ["enter", "cmdIfMultiline", "cmdAlways"] as const;
  const drafts = ["single", "paragraphs", "hard_break", "code"] as const;
  const createEnterDraft = (kind: (typeof drafts)[number]) => {
    const { nodes } = composerSchema;
    const text = (value: string) => composerSchema.text(value);
    const paragraph = () => nodes.paragraph.create(null, text("prompt"));
    return nodes.doc.create(
      null,
      kind === "code"
        ? [nodes.code_block.create(null, text("code"))]
        : kind === "paragraphs"
          ? [paragraph(), paragraph()]
          : kind === "hard_break"
            ? [
                nodes.paragraph.create(null, [
                  text("a"),
                  nodes.hard_break.create(),
                  text("b"),
                ]),
              ]
            : [paragraph()],
    );
  };

  it.each(
    enterModes.flatMap((mode) => drafts.map((draft) => ({ mode, draft }))),
  )("$mode / $draft 的普通 Enter 使用已配置的发送规则", ({ mode, draft }) => {
    const onSubmit = vi.fn();
    const { controller, element } = mount({ enterBehavior: mode, onSubmit });
    act(() =>
      controller.applyTransaction(
        controller
          .getEditorState()
          .tr.replaceWith(
            0,
            controller.getEditorState().doc.content.size,
            createEnterDraft(draft).content,
          ),
      ),
    );
    const before = controller.getDocument().text;
    const submits =
      mode === "enter" || (mode === "cmdIfMultiline" && draft === "single");
    key(element, "Enter");
    expect(onSubmit).toHaveBeenCalledTimes(submits ? 1 : 0);
    expect(controller.getDocument().text === before).toBe(submits);
  });

  it.each(
    ["MacIntel", "Win32"].flatMap((platform) =>
      enterModes.map((mode) => ({ platform, mode })),
    ),
  )(
    "$platform / $mode 使用平台主修饰键；代码块仅默认模式移到下一段",
    ({ platform, mode }) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue(platform);
      const onSubmit = vi.fn();
      const { controller, element } = mount({ enterBehavior: mode, onSubmit });
      const options =
        platform === "MacIntel" ? { metaKey: true } : { ctrlKey: true };
      key(
        element,
        "Enter",
        platform === "MacIntel" ? { ctrlKey: true } : { metaKey: true },
      );
      expect(onSubmit).not.toHaveBeenCalled();
      key(element, "Enter", options);
      expect(onSubmit).toHaveBeenCalledTimes(1);
      act(() =>
        controller.applyTransaction(
          controller
            .getEditorState()
            .tr.replaceWith(
              0,
              controller.getEditorState().doc.content.size,
              createEnterDraft("code").content,
            ),
        ),
      );
      onSubmit.mockClear();
      key(element, "Enter", options);
      expect(onSubmit).toHaveBeenCalledTimes(mode === "enter" ? 0 : 1);
      if (mode === "enter") {
        expect(controller.getEditorState().doc.childCount).toBe(2);
        expect(
          controller.getEditorState().selection.$from.parent.type.name,
        ).toBe("paragraph");
      }
    },
  );

  it.each(enterModes)(
    "%s 不在 IME 确认或禁用键盘提交时发送",
    (enterBehavior) => {
      const onSubmit = vi.fn();
      const { element, controller, root } = mount({ enterBehavior, onSubmit });
      key(element, "Enter", { isComposing: true });
      expect(controller.getDocument().text).toBe("中😀");
      act(() =>
        root.render(
          <ComposerEditor
            controller={controller}
            enterBehavior={enterBehavior}
            onSubmit={onSubmit}
            sendOnEnter={false}
          />,
        ),
      );
      key(element, "Enter");
      key(element, "Enter", { ctrlKey: true });
      expect(onSubmit).not.toHaveBeenCalled();
    },
  );

  it.each(["MacIntel", "Win32"])(
    "%s 的粗指针普通 Enter 按平台规则处理",
    (platform) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue(platform);
      vi.stubGlobal(
        "matchMedia",
        vi.fn().mockReturnValue({ matches: true } as MediaQueryList),
      );
      const onSubmit = vi.fn();
      const { element } = mount({ onSubmit });
      key(element, "Enter");
      expect(onSubmit).toHaveBeenCalledTimes(platform === "Win32" ? 1 : 0);
    },
  );

  it("真实 EditorView 显示 canonical 文档，并跟随 Controller 原子更新", () => {
    const { controller, element, container, editorRef } = mount({
      sessionId: "thread-1",
    });
    expect(container.querySelector("textarea")).toBeNull();
    expect(
      element.matches('[data-testid="composer-editor"][role="textbox"]'),
    ).toBe(true);
    expect(element.dataset.sessionId).toBe("thread-1");
    expect(element.textContent).toBe("中😀");
    act(() =>
      controller.insertMention({
        id: "s",
        kind: "skill",
        name: "审阅",
        path: "/review",
        label: "$审阅",
        displayName: "审阅变更",
      }),
    );
    const atom = element.querySelector('[data-composer-token="skill"]');
    expect(atom?.textContent).toBe("审阅变更");
    expect(atom?.querySelector("[data-mention-label]")?.textContent).toBe(
      "审阅变更",
    );
    const icon = atom?.querySelector("svg");
    expect(icon?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(icon?.getAttribute("viewBox")).toBe("0 0 20 20");
    expect(icon?.closest("[aria-hidden]")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(atom?.getAttribute("data-layout")).toBe("inline-flow");
    expect(atom?.getAttribute("data-composer-label")).toBe("$审阅");
    expect(atom?.getAttribute("data-composer-display-name")).toBe("审阅变更");
    expect(atom?.getAttribute("data-composer-path")).toBe("/review");
    expect(atom?.getAttribute("contenteditable")).toBe("false");
    const doc = controller.getEditorState().doc;
    expect(doc.textBetween(0, doc.content.size, "\n")).toBe("中😀审阅变更");
    expect(editorRef.current?.getSelection()).toEqual({ start: 6, end: 6 });
    const draft = controller.captureDraft();
    act(() => controller.clear());
    act(() => controller.restoreDraft(draft));
    expect(
      element.querySelector('[data-composer-token="skill"]')?.textContent,
    ).toBe("审阅变更");
    expect(controller.getDocument().text).toBe("中😀$审阅");
    expect(editorRef.current?.getSelection()).toEqual({ start: 6, end: 6 });
    const receipt = controller.submit("start");
    expect(receipt.kind).toBe("accepted");
    expect(receipt.submission).toMatchObject({
      text: "中😀[$审阅](/review)",
      inputMentions: [{ type: "skill", name: "审阅", path: "/review" }],
      textElements: [],
    });
    act(() => controller.restoreDraft({ text: "恢复\n新段" }));
    expect(
      Array.from(element.children).map((node) => node.textContent),
    ).toEqual(["恢复", "新段"]);
  });

  it("native paste 一次进入 Controller，CRLF 和选择替换均保留", () => {
    const onPaste = vi.fn();
    const { controller, element, editorRef } = mount({ onPaste });
    act(() => editorRef.current?.setSelection({ start: 1, end: 3 }));
    const event = paste(element, "a\r\nb");
    expect(onPaste).toHaveBeenCalledTimes(1);
    expect(onPaste.mock.calls[0][0]).toBe(event);
    expect(event.defaultPrevented).toBe(true);
    expect(controller.getDocument().text).toBe("中a\nb");
  });

  it("外部图片/路径 owner 消费 paste 后不再插入文本或解析 HTML", () => {
    const onPaste = vi.fn((event: ClipboardEvent) => event.preventDefault());
    const { controller, element } = mount({ onPaste });
    paste(element, "should not be inserted");
    expect(controller.getDocument().text).toBe("中😀");
    const handled = mount({ onPaste: () => true });
    paste(handled.element, "ignored");
    expect(handled.controller.getDocument().text).toBe("中😀");
  });

  it("large paste 创建可观察 atom，发送快照展开而显示保持折叠", () => {
    const { controller, element } = mount();
    const text = "😀中".repeat(400);
    paste(element, text);
    expect(
      element.querySelector('[data-composer-token="paste"]')?.textContent,
    ).toMatch(/Pasted text/);
    const receipt = controller.submit("queue");
    expect(receipt.draft.text).toContain("Pasted text");
    expect(receipt.submission.text).toBe(`中😀${text}`);
  });

  it.each([
    { signal: "isComposing", options: { isComposing: true } },
    { signal: "Process", options: { key: "Process" } },
    { signal: "229", options: { keyCode: 229 } },
  ])("$signal 在 root 回调前退出并保留 OS 默认行为", ({ options }) => {
    const onKeyDown = vi.fn();
    const onSubmit = vi.fn();
    const { element, controller } = mount({ onKeyDown, onSubmit });
    const event = key(element, "Enter", options);
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(controller.getDocument().text).toBe("中😀");
  });

  it("compositionEnd 只结束状态，按钮流程外不会自动发送", () => {
    const onSubmit = vi.fn();
    const onCompositionStateChange = vi.fn();
    const { element, editorRef } = mount({
      onSubmit,
      onCompositionStateChange,
    });
    act(() => {
      element.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
    });
    expect(editorRef.current?.isComposing()).toBe(true);
    key(element, "Enter");
    act(() => {
      element.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      );
    });
    expect(onCompositionStateChange.mock.calls.map(([value]) => value)).toEqual(
      [true, false],
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("capture 与 root callback 消费键盘后不发送；普通 Enter 发送一次", () => {
    const onSubmit = vi.fn();
    const onKeyDown = vi.fn((event: KeyboardEvent) => {
      if (event.key === "ArrowDown") event.preventDefault();
    });
    const { element } = mount({ onSubmit, onKeyDown });
    const capture = (event: Event) => event.preventDefault();
    element.addEventListener("keydown", capture, true);
    key(element, "Enter");
    expect(onSubmit).not.toHaveBeenCalled();
    element.removeEventListener("keydown", capture, true);
    key(element, "ArrowDown");
    expect(onSubmit).not.toHaveBeenCalled();
    const enter = key(element, "Enter");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ triggerSource: "enter" });
    expect(enter.defaultPrevented).toBe(true);
  });

  it("Shift+Enter 使用真实 PM hard break，PM undo 恢复前文档", () => {
    const onSubmit = vi.fn();
    const { controller, element } = mount({ onSubmit });
    key(element, "Enter", { shiftKey: true });
    expect(controller.getDocument().text).toBe("中😀\n");
    expect(
      controller.getDocument().editorDocument.content[0].content?.at(-1)?.type,
    ).toBe("hard_break");
    key(element, "z", { ctrlKey: true });
    expect(controller.getDocument().text).toBe("中😀");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("上下键历史恢复整个 draft 并返回当前草稿", () => {
    const controller = new ComposerController({ text: "first" });
    controller.setAttachments([{ data: "x", mediaType: "image/png" }]);
    const receipt = controller.submit("start");
    if (receipt.kind !== "accepted") throw new Error("missing receipt");
    controller.commit(receipt);
    controller.setText("current", { start: 0, end: 0 });
    const { element, editorRef } = mount({ controller });
    key(element, "ArrowUp");
    expect(controller.getDocument().text).toBe("first");
    expect(controller.getDocument().attachments).toHaveLength(1);
    act(() => editorRef.current?.setSelection({ start: 5, end: 5 }));
    key(element, "ArrowDown");
    expect(controller.getDocument().text).toBe("current");
    expect(controller.getDocument().attachments).toEqual([]);
  });

  it("rich 历史回放后的焦点与 selection 同步不取消 ArrowDown 返回空草稿", async () => {
    const controller = new ComposerController({
      text: "历史😀 ",
      attachments: [{ data: "image", mediaType: "image/png" }],
      pathReferences: [
        { id: "brief", path: "/tmp/brief.md", name: "brief.md", isDir: false },
      ],
      inputCapabilityRoute: { kind: "skill", name: "review" },
    });
    controller.insertMention({
      id: "review",
      kind: "skill",
      name: "review",
      path: "/skills/review/SKILL.md",
      label: "/review",
    });
    controller.ingestPaste("历史粘贴😀".repeat(200));
    controller.setSelection(0);
    const receipt = controller.submit("start");
    if (receipt.kind !== "accepted")
      throw new Error("expected accepted receipt");
    controller.commit(receipt);
    const currentDraft = controller.captureDraft();
    const transactionSpy = vi.spyOn(controller, "applyTransaction");
    const { element, editorRef } = mount({ controller, autoFocus: true });

    expect(key(element, "ArrowUp").defaultPrevented).toBe(true);
    expect(controller.captureDraft()).toEqual(receipt.draft);
    expect(
      element.querySelector('[data-composer-token="skill"]'),
    ).not.toBeNull();
    expect(
      element.querySelector('[data-composer-token="paste"]'),
    ).not.toBeNull();
    await act(async () => {
      element.blur();
      editorRef.current?.setSelection(
        { start: receipt.draft.text.length, end: receipt.draft.text.length },
        { focus: true },
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(document.activeElement).toBe(element);
    expect(
      transactionSpy.mock.calls.some(
        ([transaction]) => transaction.selectionSet && !transaction.docChanged,
      ),
    ).toBe(true);
    expect(controller.getDocument().editorDocument).toEqual(
      receipt.draft.editorDocument,
    );
    expect(controller.getDocument().attachments).toEqual(
      receipt.draft.attachments,
    );

    expect(key(element, "ArrowDown").defaultPrevented).toBe(true);
    expect(controller.captureDraft()).toEqual(currentDraft);
    expect(element.querySelector("[data-composer-token]")).toBeNull();
  });

  it("提交禁用后拒绝 View 的迟到选区事务，保留接受回执的草稿版本", () => {
    const setProps = vi.spyOn(EditorView.prototype, "setProps");
    const controller = new ComposerController({ text: "submitted draft" });
    controller.setSelection(2, 6);
    const { root, editorRef } = mount({ controller });
    const view = setProps.mock.contexts.find(
      (item) => item.dom === editorRef.current?.getElement(),
    );
    if (!view) throw new Error("missing real EditorView");
    const receipt = controller.submit("start");
    const snapshot = controller.getSnapshot();
    act(() =>
      root.render(
        <ComposerEditor
          controller={controller}
          editorRef={editorRef}
          disabled
        />,
      ),
    );
    act(() =>
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)),
      ),
    );
    expect(controller.getSnapshot()).toBe(snapshot);
    expect(controller.captureDraft()).toEqual(receipt.draft);
    act(() => controller.setText("explicit owner update"));
    expect(view.state.doc.textContent).toBe("explicit owner update");
  });

  it("disabled 有明确 DOM 合同并拒绝 native paste，销毁解除文档订阅", () => {
    const { element, controller, root, container, editorRef } = mount({
      disabled: true,
    });
    expect(element.getAttribute("contenteditable")).toBe("false");
    expect(element.getAttribute("aria-disabled")).toBe("true");
    paste(element, "ignored");
    expect(controller.getDocument().text).toBe("中😀");
    const handle = editorRef.current!;
    act(() => root.unmount());
    mounted.splice(
      mounted.findIndex((entry) => entry.root === root),
      1,
    );
    expect(handle.getElement()).toBeNull();
    expect(container.querySelector('[role="textbox"]')).toBeNull();
    expect(() => controller.setText("late")).not.toThrow();
    container.remove();
  });

  it("DOMObserver 的真实输入更新 Controller，View 不保留第二文档", async () => {
    const { element, controller } = mount();
    await act(async () => {
      element.querySelector("p")!.firstChild!.textContent = "真实输入😀";
      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: "真实输入😀",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(controller.getDocument().text).toBe("真实输入😀");
    expect(controller.getEditorState().doc.textContent).toBe("真实输入😀");
  });

  it("DOMObserver 在 atom 前后的原生文本编辑保留 token 身份与 range", async () => {
    const { element, controller } = mount();
    act(() =>
      controller.insertMention({
        id: "f",
        kind: "file",
        name: "文件",
        path: "/file",
        label: "@文件",
      }),
    );
    await act(async () => {
      element.querySelector("p")!.firstChild!.textContent = "新😀 ";
      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: "新😀 ",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(controller.getDocument().text).toBe("新😀 @文件");
    expect(controller.getDocument().mentionBindings[0]).toMatchObject({
      id: "f",
      from: 4,
      to: 7,
    });
    expect(controller.getDocument().textElements[0].byteRange).toEqual({
      start: 8,
      end: 15,
    });
  });
});
