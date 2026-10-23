import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/components/input-kit/composerEditor.testUtils";
import type {
  BrowserAnnotationEditorBridge,
  BrowserAnnotationEditorLabels,
  BrowserAnnotationEditorUpdate,
} from "@/lib/api/browserAnnotationEditorTypes";
import { BrowserAnnotationEditor } from "./BrowserAnnotationEditor";
import { labels, initial } from "./browserAnnotationEditor.testFixture";

let root: Root;
let container: HTMLDivElement;
let subscriber: ((update: BrowserAnnotationEditorUpdate) => void) | undefined;
let bridge: BrowserAnnotationEditorBridge;
let unsubscribe: ReturnType<typeof vi.fn>;

function update(
  overrides: Partial<BrowserAnnotationEditorUpdate> = {},
  presentation: Partial<BrowserAnnotationEditorUpdate["presentation"]> = {},
) {
  act(() =>
    subscriber?.({
      ...initial,
      ...overrides,
      presentation: { ...initial.presentation, ...presentation },
    }),
  );
}
function editor() {
  const element = container.querySelector<HTMLElement>(
    '[data-testid="browser-annotation-composer"][role="textbox"]',
  );
  if (!element) throw new Error("Expected real annotation Composer");
  return element;
}
function button(text: string) {
  const element = Array.from(container.querySelectorAll("button")).find(
    (item) =>
      item.textContent === text || item.getAttribute("aria-label") === text,
  );
  if (!element) throw new Error(`Missing action ${text}`);
  return element;
}
function click(text: string) {
  act(() => button(text).click());
}
function key(
  element: HTMLElement,
  value: string,
  options: NonNullable<ConstructorParameters<typeof KeyboardEvent>[1]> = {},
) {
  const event = new KeyboardEvent("keydown", {
    key: value,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  act(() => element.dispatchEvent(event));
  return event;
}
function paste(text: string, target = editor()) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      items: [],
      files: [],
      getData: (format: string) =>
        format === "text/plain" || format === "text" ? text : "",
    },
  });
  act(() => target.dispatchEvent(event));
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  subscriber = undefined;
  unsubscribe = vi.fn();
  bridge = {
    onUpdate: vi.fn((next) => {
      subscriber = next;
      return unsubscribe;
    }),
    ready: vi.fn(),
    resize: vi.fn(),
    act: vi.fn(),
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<BrowserAnnotationEditor bridge={bridge} />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.removeProperty("color-scheme");
  vi.restoreAllMocks();
});

describe("trusted Browser annotation Composer", () => {
  it("keeps the current DOM selection and draft revision when only native layout constraints change", () => {
    update();
    const textbox = editor();
    textbox.focus();
    const text = textbox.querySelector("p")!.firstChild!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(text, 3);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    update({ layout: { width: 320, maxHeight: 300 } });
    expect(editor()).toBe(textbox);
    expect(selection.anchorNode).toBe(text);
    expect(selection.anchorOffset).toBe(3);
    expect(bridge.act).not.toHaveBeenCalled();
  });

  it("subscribes before ready and waits for the trusted presentation", () => {
    expect(bridge.onUpdate).toHaveBeenCalledOnce();
    expect(bridge.ready).toHaveBeenCalledOnce();
    expect(vi.mocked(bridge.onUpdate).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(bridge.ready).mock.invocationCallOrder[0],
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(bridge.act).not.toHaveBeenCalled();
    update();
    expect(editor().textContent).toBe("Initial body");
    expect(editor().getAttribute("contenteditable")).toBe("true");
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain("Page element · Checkout");
    expect(document.activeElement).toBe(editor());
    expect(bridge.act).not.toHaveBeenCalled();
  });

  it("publishes synchronous Composer edits with increasing wire revisions and does not publish caret movement", () => {
    update();
    paste(" first");
    expect(bridge.act).toHaveBeenLastCalledWith(
      "change",
      "Initial body first",
      5,
      [],
      null,
    );
    paste(" second");
    expect(bridge.act).toHaveBeenLastCalledWith(
      "change",
      "Initial body first second",
      6,
      [],
      null,
    );
    key(editor(), "ArrowLeft");
    expect(bridge.act).toHaveBeenCalledTimes(2);
  });

  it("ignores old ACK bodies while preserving newer local input and applies an authoritative newer revision without echo", () => {
    update();
    paste(" local");
    update({}, { body: "old ACK", revision: 4 });
    expect(editor().textContent).toBe("Initial body local");
    update({}, { body: "authoritative", revision: 8 });
    expect(editor().textContent).toBe("authoritative");
    expect(bridge.act).toHaveBeenCalledOnce();
    paste(" next");
    expect(bridge.act).toHaveBeenLastCalledWith(
      "change",
      "authoritative next",
      9,
      [],
      null,
    );
  });

  it.each(["save", "send"] as const)(
    "%s sends the latest body/revision and blocks synchronous duplicate actions",
    (action) => {
      update();
      paste(" latest");
      act(() => {
        button(labels[action]).click();
        button(labels[action]).click();
      });
      expect(
        vi
          .mocked(bridge.act)
          .mock.calls.filter(([value]) => value !== "change"),
      ).toEqual([[action, "Initial body latest", 5, [], null]]);
      expect(editor().getAttribute("contenteditable")).toBe("false");
    },
  );

  it.each([{}, { metaKey: true }, { ctrlKey: true }])(
    "maps Enter to save and platform-modified Enter to direct send: %j",
    (options) => {
      update();
      const event = key(editor(), "Enter", options);
      expect(event.defaultPrevented).toBe(true);
      expect(bridge.act).toHaveBeenCalledExactlyOnceWith(
        "metaKey" in options || "ctrlKey" in options ? "send" : "save",
        "Initial body",
        4,
        [],
        null,
      );
    },
  );

  it("Shift+Enter inserts a real Composer hard break and keeps action buttons independent", () => {
    update();
    key(editor(), "Enter", { shiftKey: true });
    paste("next line");
    expect(editor().querySelector("br")).not.toBeNull();
    expect(bridge.act).toHaveBeenLastCalledWith(
      "change",
      "Initial body\nnext line",
      6,
      [],
      null,
    );
    expect(
      vi.mocked(bridge.act).mock.calls.every(([action]) => action === "change"),
    ).toBe(true);
  });

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    "does not submit IME keyboard input: %j",
    (options) => {
      update();
      key(editor(), "Enter", { ...options, metaKey: true });
      expect(bridge.act).not.toHaveBeenCalled();
    },
  );

  it("composition lifecycle keeps Enter and Escape as editing until composition ends", () => {
    update();
    act(() =>
      editor().dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      ),
    );
    key(editor(), "Enter");
    key(editor(), "Escape");
    act(() =>
      editor().dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      ),
    );
    expect(bridge.act).not.toHaveBeenCalled();
  });

  it.each(["escape", "outside", "close"])(
    "%s closes with the unsaved body retained",
    (source) => {
      update();
      paste(" unsaved");
      if (source === "escape") key(editor(), "Escape");
      else if (source === "close") click(labels.close);
      else
        act(() =>
          container
            .querySelector('[data-testid="browser-annotation-backdrop"]')!
            .dispatchEvent(new Event("pointerdown", { bubbles: true })),
        );
      expect(bridge.act).toHaveBeenLastCalledWith(
        "close",
        "Initial body unsaved",
        5,
        [],
        null,
      );
      expect(editor().textContent).toBe("Initial body unsaved");
    },
  );

  it("typing inside the panel does not trigger light dismissal", () => {
    update();
    act(() =>
      editor().dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    expect(bridge.act).not.toHaveBeenCalled();
  });

  it("disables pending edits and actions and preserves the body on a send failure before retry", () => {
    update();
    paste(" retained");
    click(labels.send);
    update({ pending: true }, { body: "stale", revision: 4 });
    expect(editor().getAttribute("contenteditable")).toBe("false");
    expect(button(labels.send).disabled).toBe(true);
    expect(button(labels.save).disabled).toBe(true);
    paste(" rejected");
    key(editor(), "Escape");
    expect(editor().textContent).toBe("Initial body retained");
    update({ error: true }, { body: "error must not reset", revision: 20 });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      labels.sendFailed,
    );
    expect(editor().textContent).toBe("Initial body retained");
    expect(editor().getAttribute("contenteditable")).toBe("true");
    click(labels.send);
    expect(
      vi.mocked(bridge.act).mock.calls.filter(([action]) => action === "send"),
    ).toEqual([
      ["send", "Initial body retained", 5, [], null],
      ["send", "Initial body retained", 5, [], null],
    ]);
  });

  it("an old non-pending edit ACK cannot unlock a newly dispatched send", () => {
    update();
    click(labels.send);
    update({}, { body: "Initial body", revision: 4 });
    expect(button(labels.send).disabled).toBe(true);
    key(editor(), "Enter", { ctrlKey: true });
    expect(bridge.act).toHaveBeenCalledOnce();
  });

  it.each(["generation", "editorId"])(
    "replaces the Composer on %s and rejects old DOM callbacks",
    (field) => {
      update();
      const old = editor();
      paste(" old");
      update(field === "generation" ? { generation: 4 } : {}, {
        editorId:
          field === "editorId" ? "editor-two" : initial.presentation.editorId,
        body: "Fresh draft",
        revision: 2,
      });
      expect(editor()).not.toBe(old);
      expect(editor().textContent).toBe("Fresh draft");
      expect(old.isConnected).toBe(false);
      key(old, "Enter", { metaKey: true });
      paste("ignored", old);
      expect(bridge.act).toHaveBeenCalledOnce();
      paste(" new");
      expect(bridge.act).toHaveBeenLastCalledWith(
        "change",
        "Fresh draft new",
        3,
        [],
        null,
      );
    },
  );

  it("revokes old actions immediately when a new generation is received before React commits", () => {
    update();
    const old = editor();
    act(() => {
      subscriber!({
        ...initial,
        generation: 4,
        presentation: { ...initial.presentation, body: "New owner" },
      });
      old.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(bridge.act).not.toHaveBeenCalled();
  });

  it("discards a late old generation update", () => {
    update({ generation: 5 }, { body: "Current" });
    update({ generation: 4 }, { body: "Old" });
    expect(editor().textContent).toBe("Current");
  });

  it("synchronously flushes canonical Composer text and revision without incrementing unchanged input", () => {
    update();
    paste(" kept");
    act(() =>
      window.dispatchEvent(new Event("browser-annotation-editor-flush")),
    );
    expect(bridge.act).toHaveBeenLastCalledWith(
      "change",
      "Initial body kept",
      5,
      [],
      null,
    );
    act(() =>
      window.dispatchEvent(new Event("browser-annotation-editor-flush")),
    );
    expect(bridge.act).toHaveBeenLastCalledWith(
      "change",
      "Initial body kept",
      5,
      [],
      null,
    );
    expect(bridge.act).toHaveBeenCalledTimes(3);
  });

  it("flushes pending text for native teardown and rejects old ownership before React commits", () => {
    update();
    click(labels.send);
    update({ pending: true });
    act(() =>
      window.dispatchEvent(new Event("browser-annotation-editor-flush")),
    );
    expect(bridge.act).toHaveBeenLastCalledWith(
      "change",
      "Initial body",
      4,
      [],
      null,
    );
    vi.mocked(bridge.act).mockClear();
    act(() => {
      subscriber!({ ...initial, generation: 4 });
      window.dispatchEvent(new Event("browser-annotation-editor-flush"));
    });
    expect(bridge.act).not.toHaveBeenCalled();
  });

  it("uses trusted labels, region summary, capture warning, and appearance", () => {
    const translated = Object.fromEntries(
      Object.keys(labels).map((key) => [key, `翻译 ${key}`]),
    ) as unknown as BrowserAnnotationEditorLabels;
    update(
      {},
      {
        labels: translated,
        appearance: "dark",
        screenshotStatus: "timeout",
        selection: { ...initial.presentation.selection, kind: "region" },
      },
    );
    expect(
      container.querySelector('[role="dialog"]')?.getAttribute("aria-label"),
    ).toBe(translated.title);
    expect(container.textContent).toContain("翻译 region · 120 × 31 · 21, 33");
    expect(container.textContent).toContain(translated.captureFailed);
    expect(editor().getAttribute("aria-label")).toBe(translated.placeholder);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "shows the localized text target in the existing editor without replacing its body: %s",
    (locale) => {
      const resources = import.meta.glob<Record<string, string>>(
        "../../../../../../i18n/resources/*/browserAnnotation.json",
        { eager: true, import: "default" },
      );
      const resource =
        resources[
          `../../../../../../i18n/resources/${locale}/browserAnnotation.json`
        ];
      const localized = Object.fromEntries(
        Object.keys(labels).map((key) => [
          key,
          resource[`browserAnnotation.${key}`],
        ]),
      ) as unknown as BrowserAnnotationEditorLabels;
      update(
        {},
        {
          labels: localized,
          selection: {
            ...initial.presentation.selection,
            kind: "text",
            targetText: "Selected 😀 text",
          },
        },
      );
      expect(
        container.querySelector('[data-testid="browser-annotation-selection"]')
          ?.textContent,
      ).toBe(`${localized.text} · Selected 😀 text`);
      expect(editor().textContent).toBe("Initial body");
      click(localized.save);
      expect(bridge.act).toHaveBeenCalledWith(
        "save",
        "Initial body",
        4,
        [],
        null,
      );
    },
  );

  it("disables empty save/send while close still retains an empty draft", () => {
    update({}, { body: "" });
    expect(button(labels.save).disabled).toBe(true);
    expect(button(labels.send).disabled).toBe(true);
    key(editor(), "Enter");
    expect(bridge.act).not.toHaveBeenCalled();
    click(labels.close);
    expect(bridge.act).toHaveBeenCalledExactlyOnceWith(
      "close",
      "",
      4,
      [],
      null,
    );
  });

  it("retains the draft and unlocks retry if the narrow bridge fails synchronously", () => {
    update();
    vi.mocked(bridge.act).mockImplementationOnce(() => {
      throw new Error("bridge unavailable");
    });
    click(labels.send);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(editor().textContent).toBe("Initial body");
    click(labels.send);
    expect(bridge.act).toHaveBeenCalledTimes(2);
  });

  it("unsubscribes and ignores late updates after unmount, including StrictMode re-subscription", () => {
    act(() =>
      root.render(
        <StrictMode>
          <BrowserAnnotationEditor bridge={bridge} />
        </StrictMode>,
      ),
    );
    update();
    const late = subscriber!;
    act(() => root.render(null));
    act(() => late(initial));
    expect(unsubscribe).toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
    expect(bridge.act).not.toHaveBeenCalled();
  });
});
