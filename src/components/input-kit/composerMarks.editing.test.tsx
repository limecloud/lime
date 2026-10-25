import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerController } from "./ComposerController";
import {
  ComposerEditor,
  type ComposerEditorHandle,
  type ComposerEditorProps,
} from "./ComposerEditor";
import { codeDocument, linkDocument } from "./composerMarks.testFixtures";

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
  for (const [name, descriptor] of rangeDescriptors) {
    if (descriptor) Object.defineProperty(Range.prototype, name, descriptor);
    else Reflect.deleteProperty(Range.prototype, name);
  }
});

function mount(options: Partial<ComposerEditorProps> = {}) {
  const controller = options.controller ?? new ComposerController();
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
  const element = editorRef.current!.getElement()!;
  return { controller, editorRef, element };
}

function paste(element: HTMLElement, data: { text?: string; html?: string }) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (format: string) =>
        format === "text/plain"
          ? (data.text ?? "")
          : format === "text/html"
            ? (data.html ?? "")
            : "",
    },
  });
  act(() => element.dispatchEvent(event));
  return event;
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
  act(() => element.dispatchEvent(event));
  return event;
}

describe("ComposerEditor link and code editing", () => {
  it("HTML anchor/pre paste retains document semantics and submission", () => {
    const { element, controller } = mount();
    paste(element, {
      text: "fallback",
      html: '<p><a href="https://e.test" title="标题">中😀</a></p><pre><code data-language="ts"> x\n  y</code></pre>',
    });
    expect(
      element.querySelector('[text-link-href="https://e.test"]')!.textContent,
    ).toBe("中😀");
    expect(element.querySelector("pre > code")!.textContent).toBe(" x\n  y");
    expect(controller.submit("start").submission.text).toBe(
      '[中😀](https://e.test "标题")\n```ts\n x\n  y\n```',
    );
  });

  it("external resource consumer prevents both HTML and text insertion", () => {
    const onPaste = vi.fn((event: ClipboardEvent) => event.preventDefault());
    const { element, controller } = mount({ onPaste });
    paste(element, {
      text: "fallback",
      html: '<p><a href="https://e.test">label</a></p>',
    });
    expect(onPaste).toHaveBeenCalledTimes(1);
    expect(controller.getDocument().text).toBe("");
  });

  it("invalid HTML href becomes plain label and inert HTML cannot introduce unknown nodes", () => {
    const { element, controller } = mount();
    paste(element, {
      text: "安全正文",
      html: '<p><a href="javascript:alert(1)">安全正文</a><script>throw 1</script></p>',
    });
    expect(controller.getDocument().text).toBe("安全正文");
    expect(
      controller.getEditorState().doc.firstChild!.firstChild!.marks,
    ).toEqual([]);
    expect(element.querySelector("script")).toBeNull();
  });

  it("HTML without supported formatting preserves the actual text/plain paste", () => {
    const { element, controller } = mount();
    paste(element, { text: "a\r\nb", html: "<p>a b</p>" });
    expect(controller.getDocument().text).toBe("a\nb");
    const large = "长😀".repeat(400);
    paste(element, { text: large, html: `<p>${large}</p>` });
    expect(controller.getDocument().pendingPastes[0].text).toBe(large);
    expect(controller.submit("queue").submission.text).toBe(`a\nb${large}`);
  });

  it("safe link paste and editing never execute or automatically navigate", () => {
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    const location = window.location.href;
    const { element, controller } = mount();
    paste(element, { html: '<p><a href="https://e.test">label</a></p>' });
    const link = element.querySelector('[text-link-href="https://e.test"]')!;
    expect(link.tagName).toBe("SPAN");
    act(() =>
      link.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      ),
    );
    expect(opened).not.toHaveBeenCalled();
    expect(window.location.href).toBe(location);
    expect(controller.getDocument().text).toBe("label");
  });

  it("plain Markdown paste parses only known link/code features", () => {
    const { element, controller } = mount();
    paste(element, { text: "[中😀](https://e.test)\n```ts\nx\n```" });
    expect(controller.getDocument().text).toBe("中😀\nx");
    expect(controller.getEditorState().doc.lastChild!.type.name).toBe(
      "code_block",
    );
    expect(controller.submit("start").submission.text).toBe(
      "[中😀](https://e.test)\n```ts\nx\n```",
    );
  });

  it.each([false, true])(
    "multiline mode code Enter shift=%s inserts text newline and never submits",
    (shiftKey) => {
      const controller = new ComposerController({
        editorDocument: codeDocument("x"),
      });
      const onSubmit = vi.fn();
      const { element } = mount({
        controller,
        onSubmit,
        enterBehavior: "cmdIfMultiline",
      });
      expect(key(element, "Enter", { shiftKey }).defaultPrevented).toBe(true);
      expect(controller.getDocument().text).toBe("x\n");
      expect(
        controller.getEditorState().doc.firstChild!.lastChild!.type.name,
      ).toBe("text");
      expect(onSubmit).not.toHaveBeenCalled();
      key(element, "z", { ctrlKey: true });
      expect(controller.getDocument().text).toBe("x");
    },
  );

  it("IME guard still precedes code newline, external key handler and send", () => {
    const controller = new ComposerController({
      editorDocument: codeDocument("中"),
    });
    const onKeyDown = vi.fn();
    const onSubmit = vi.fn();
    const { element } = mount({ controller, onKeyDown, onSubmit });
    const event = key(element, "Enter", { isComposing: true });
    expect(event.defaultPrevented).toBe(false);
    expect(controller.getDocument().text).toBe("中");
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("HTML paste within code remains plain code text", () => {
    const controller = new ComposerController({
      editorDocument: codeDocument("前"),
    });
    const { element } = mount({ controller });
    paste(element, {
      html: '<p><a href="https://e.test">标签😀</a></p><p>后</p>',
    });
    expect(controller.getDocument().text).toBe("前标签😀\n后");
    expect(controller.getEditorState().doc.childCount).toBe(1);
    expect(controller.getEditorState().doc.firstChild!.type.name).toBe(
      "code_block",
    );
    expect(
      controller.getEditorState().doc.firstChild!.firstChild!.marks,
    ).toEqual([]);
  });

  it("link updates use Controller and refresh the existing View without source becoming authority", () => {
    const route = { kind: "plugin", id: "retained" };
    const controller = new ComposerController({
      editorDocument: linkDocument(),
      inputCapabilityRoute: route,
    });
    const { element } = mount({ controller });
    const update = controller as ComposerController & {
      updateLink: (
        range: { start: number; end: number },
        value: { href: string; label: string },
      ) => boolean;
    };
    act(() =>
      expect(
        update.updateLink(
          { start: 0, end: 3 },
          { href: "https://new.test", label: "新😀" },
        ),
      ).toBe(true),
    );
    const link = element.querySelector('[text-link-href="https://new.test"]');
    expect(link!.textContent).toBe("新😀");
    expect(link!.getAttribute("data-source-app-id")).toBe("source-app");
    expect(
      controller.getEditorState().doc.firstChild!.firstChild!.marks[0].attrs,
    ).toMatchObject({
      isAutolink: false,
      isGeneratedAutolink: false,
      literalMarkdownOccurrenceId: null,
      literalMarkdownSource: null,
    });
    expect(controller.getDocument().inputCapabilityRoute).toEqual(route);
  });
});
