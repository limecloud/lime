// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  annotationSpacePressed,
  watchAnnotationKeyboard,
} from "./browserAnnotationKeyboard";

const event = (overrides: Partial<KeyboardEvent> = {}) =>
  ({
    isTrusted: true,
    code: "Space",
    type: "keydown",
    composedPath: () => [document.body, document, window],
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...overrides,
  }) as unknown as KeyboardEvent;

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("annotation Space input", () => {
  it("holds through repeats and releases even if focus or modifiers change", () => {
    const down = event();
    expect(annotationSpacePressed(down, false)).toBe(true);
    expect(down.preventDefault).toHaveBeenCalledOnce();
    expect(down.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(
      annotationSpacePressed(event({ repeat: true, ctrlKey: true }), true),
    ).toBe(true);
    const input = document.createElement("textarea");
    const up = event({
      type: "keyup",
      shiftKey: true,
      composedPath: () => [input],
    });
    expect(annotationSpacePressed(up, true)).toBe(false);
    expect(up.preventDefault).toHaveBeenCalledOnce();
  });

  it.each([
    { isTrusted: false },
    { code: "Enter" },
    { type: "keyup" },
    { repeat: true },
    { isComposing: true },
    { altKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
  ])(
    "leaves unrelated, synthetic or modified input untouched: %j",
    (overrides) => {
      const input = event(overrides);
      expect(annotationSpacePressed(input, false)).toBeUndefined();
      expect(input.preventDefault).not.toHaveBeenCalled();
      expect(input.stopImmediatePropagation).not.toHaveBeenCalled();
    },
  );

  it.each([
    '<input type="text">',
    "<textarea></textarea>",
    "<select></select>",
    '<div contenteditable="true"><span></span></div>',
    '<div role="textbox"><span></span></div>',
    "<div data-lime-composer><span></span></div>",
    "<div data-lime-terminal><span></span></div>",
  ])("preserves typing in %s, including composed shadow paths", (markup) => {
    document.body.innerHTML = markup;
    const target =
      document.querySelector("span") ?? document.body.firstElementChild!;
    const input = event({
      composedPath: () => [target, document.body, window],
    });
    expect(annotationSpacePressed(input, false)).toBeUndefined();
    expect(input.preventDefault).not.toHaveBeenCalled();
  });
});

describe("annotation keyboard documents", () => {
  it("follows same-origin frames and open shadows, retires detached documents and disposes", async () => {
    const key = vi.fn(),
      blur = vi.fn();
    const dispose = watchAnnotationKeyboard(key, blur);
    const dispatch = (win: Window) =>
      win.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    try {
      dispatch(window);
      expect(key).toHaveBeenCalledTimes(1);
      const host = document.createElement("div");
      const shadow = host.attachShadow({ mode: "open" });
      const frame = document.createElement("iframe");
      // jsdom does not create browsing contexts for shadow-contained frames.
      const carrier = document.createElement("iframe");
      document.body.append(carrier);
      const child = carrier.contentDocument!,
        childWindow = child.defaultView!;
      Object.defineProperty(frame, "contentDocument", { value: child });
      shadow.append(frame);
      document.body.append(host);
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      key.mockClear();
      dispatch(childWindow);
      expect(key).toHaveBeenCalledTimes(1);
      childWindow.dispatchEvent(new Event("blur"));
      expect(blur).toHaveBeenCalledOnce();
      host.remove();
      carrier.remove();
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      key.mockClear();
      dispatch(childWindow);
      expect(key).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
    dispatch(window);
    window.dispatchEvent(new Event("blur"));
    expect(key).not.toHaveBeenCalled();
    expect(blur).toHaveBeenCalledTimes(1);
  });

  it("rebinds a navigated frame on load and tolerates an inaccessible frame", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const first = frame.contentDocument!,
      key = vi.fn();
    const carrier = document.createElement("iframe");
    document.body.append(carrier);
    const next = carrier.contentDocument!;
    carrier.remove();
    const dispose = watchAnnotationKeyboard(key, vi.fn());
    try {
      Object.defineProperty(frame, "contentDocument", {
        configurable: true,
        value: next,
      });
      frame.dispatchEvent(new Event("load"));
      first.defaultView!.dispatchEvent(
        new KeyboardEvent("keyup", { code: "Space" }),
      );
      expect(key).not.toHaveBeenCalled();
      next.defaultView!.dispatchEvent(
        new KeyboardEvent("keyup", { code: "Space" }),
      );
      expect(key).toHaveBeenCalledOnce();
      Object.defineProperty(frame, "contentDocument", {
        get: () => {
          throw new DOMException("Blocked", "SecurityError");
        },
      });
      frame.dispatchEvent(new Event("load"));
      next.defaultView!.dispatchEvent(
        new KeyboardEvent("keyup", { code: "Space" }),
      );
      expect(key).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });
});
