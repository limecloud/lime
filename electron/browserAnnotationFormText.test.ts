// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginAnnotationFormText,
  moveAnnotationFormText,
  readAnnotationFormText,
  isAnnotationTextMirrorMutation,
} from "./browserAnnotationFormText";
import type { AnnotationFormTextGesture } from "./browserAnnotationFormText";

const marker = "[data-browser-comment-text-selection-mirror]";
let control: HTMLTextAreaElement;
let caret = 1;
let originalHit: PropertyDescriptor | undefined,
  originalCaret: PropertyDescriptor | undefined,
  originalRange: PropertyDescriptor | undefined;
const rect = (x: number, y: number, width: number, height: number) =>
  new DOMRect(x, y, width, height);
beforeEach(() => {
  document.body.innerHTML =
    '<textarea id="copy">A😀 form\nsecond line</textarea>';
  control = document.querySelector("textarea")!;
  caret = 1;
  vi.spyOn(control, "getBoundingClientRect").mockReturnValue(
    rect(10, 20, 200, 80),
  );
  originalHit = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
  originalCaret = Object.getOwnPropertyDescriptor(
    document,
    "caretPositionFromPoint",
  );
  originalRange = Object.getOwnPropertyDescriptor(
    Range.prototype,
    "getClientRects",
  );
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => control,
  });
  Object.defineProperty(document, "caretPositionFromPoint", {
    configurable: true,
    value: () => ({
      offsetNode: document.querySelector(marker)?.firstChild,
      offset: caret,
    }),
  });
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [rect(10, 20, 190, 20)],
  });
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([
    rect(5, 20, 150, 20),
    rect(10, 40, 90, 20),
  ] as unknown as DOMRectList);
});
afterEach(() => {
  document.body.replaceChildren();
  for (const [target, key, descriptor] of [
    [document, "elementFromPoint", originalHit],
    [document, "caretPositionFromPoint", originalCaret],
    [Range.prototype, "getClientRects", originalRange],
  ] as const) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  }
  vi.restoreAllMocks();
});
const gesture = (): AnnotationFormTextGesture => ({
  kind: "form-control",
  element: control,
  value: control.value,
  anchor: 1,
  focus: 15,
});

describe("form text annotation", () => {
  it("keeps exact Unicode UTF-16 offsets and clips per-line geometry to the control", () => {
    const selected = readAnnotationFormText(gesture());
    expect(selected).toMatchObject({
      targetText: control.value.slice(1, 15),
      targetRect: { x: 10, y: 20, width: 145, height: 40 },
      selectionRects: [
        { x: 10, y: 20, width: 145, height: 20 },
        { x: 10, y: 40, width: 90, height: 20 },
      ],
      textLocator: {
        kind: "form-control",
        selector: "#copy",
        shadowHosts: [],
        direction: "forward",
        startOffset: 1,
        endOffset: 15,
      },
    });
    expect(selected?.textLocator).not.toHaveProperty("rangeText");
    expect(document.querySelector(marker)).toBeNull();
  });
  it("hit tests a reverse gesture without focusing or changing the form's value or native selection", () => {
    control.setSelectionRange(2, 3, "backward");
    const focused = document.activeElement;
    caret = 15;
    const state = beginAnnotationFormText({ x: 90, y: 30 })!;
    caret = 1;
    expect(
      moveAnnotationFormText(state, { x: 20, y: 30 })?.textLocator,
    ).toMatchObject({ direction: "backward", startOffset: 1, endOffset: 15 });
    expect(document.activeElement).toBe(focused);
    expect([
      control.selectionStart,
      control.selectionEnd,
      control.selectionDirection,
    ]).toEqual([2, 3, "backward"]);
    expect(control.value).toBe(state.value);
    expect(document.querySelector(marker)).toBeNull();
  });
  it("uses a native caret through line leading and padding, but never commits an empty range", () => {
    const state = beginAnnotationFormText({ x: 20, y: 95 });
    expect(state?.anchor).toBe(1);
    expect(readAnnotationFormText(state!)).toBeNull();
    expect(document.querySelector(marker)).toBeNull();
  });
  it.each(["password", "number", "file", "hidden", "checkbox"])(
    "rejects input type %s before reading its value",
    (type) => {
      const input = document.createElement("input");
      input.type = type;
      document.body.append(input);
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => input,
      });
      const read = vi.spyOn(input, "value", "get");
      expect(beginAnnotationFormText({ x: 20, y: 30 })).toBeNull();
      expect(read).not.toHaveBeenCalled();
    },
  );
  it.each(["email", "search", "tel", "text", "url"])(
    "accepts explicit text input type %s",
    (type) => {
      const input = document.createElement("input");
      input.id = "input-copy";
      input.type = type;
      input.value = "A😀 form input";
      document.body.append(input);
      vi.spyOn(input, "getBoundingClientRect").mockReturnValue(
        rect(10, 20, 200, 40),
      );
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => input,
      });
      const state = beginAnnotationFormText({ x: 20, y: 30 })!;
      caret = 8;
      expect(
        moveAnnotationFormText(state, { x: 100, y: 30 })?.textLocator,
      ).toMatchObject({
        kind: "form-control",
        selector: "#input-copy",
        startOffset: 1,
        endOffset: 8,
      });
    },
  );
  it.each([
    "matrix(0, 1, -1, 0, 0, 0)",
    "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)",
  ])("rejects unsupported transformed text %s", (transform) => {
    control.style.transform = transform;
    expect(readAnnotationFormText(gesture())).toBeNull();
  });
  it("rejects protected text including protection inherited through a shadow host", () => {
    const host = document.createElement("section");
    host.id = "host";
    document.body.append(host);
    host.attachShadow({ mode: "open" }).append(control);
    expect(readAnnotationFormText(gesture())?.textLocator.shadowHosts).toEqual([
      "#host",
    ]);
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = computed(element);
      if (element === host)
        vi.spyOn(style, "getPropertyValue").mockImplementation((name) =>
          name === "-webkit-text-security" ? "disc" : "",
        );
      return style;
    });
    expect(readAnnotationFormText(gesture())).toBeNull();
  });
  it("uses the control's scroll and scale without leaking mirror nodes, even if layout throws", () => {
    control.scrollTop = 40;
    control.scrollLeft = 12;
    Object.defineProperty(control, "offsetWidth", {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(control, "offsetHeight", {
      configurable: true,
      value: 40,
    });
    vi.mocked(Element.prototype.getClientRects).mockImplementation(function (
      this: Element,
    ) {
      const mirror = this.parentElement!;
      expect([mirror.scrollTop, mirror.scrollLeft]).toEqual([40, 12]);
      expect(mirror.style.transform).toBe("scale(2, 2)");
      throw new Error("layout failed");
    });
    expect(() => readAnnotationFormText(gesture())).toThrow("layout failed");
    expect(document.querySelector(marker)).toBeNull();
  });
  it("rejects changed values, detached controls, blank and oversized selections", () => {
    const state = gesture();
    control.value = "changed";
    expect(readAnnotationFormText(state)).toBeNull();
    const detached = gesture();
    control.remove();
    expect(readAnnotationFormText(detached)).toBeNull();
    document.body.append(control);
    control.value = " ";
    expect(
      readAnnotationFormText({ ...gesture(), anchor: 0, focus: 1 }),
    ).toBeNull();
    control.value = "x".repeat(20001);
    expect(
      readAnnotationFormText({ ...gesture(), anchor: 0, focus: 20001 }),
    ).toBeNull();
  });
  it("revokes a text gesture if its input becomes a password field", () => {
    const input = document.createElement("input");
    input.value = "Previously readable text";
    document.body.append(input);
    vi.spyOn(input, "getBoundingClientRect").mockReturnValue(
      rect(10, 20, 200, 40),
    );
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => input,
    });
    const state = beginAnnotationFormText({ x: 20, y: 30 })!;
    input.type = "password";
    caret = 8;
    expect(moveAnnotationFormText(state, { x: 100, y: 30 })).toBeNull();
    expect(readAnnotationFormText(state)).toBeNull();
    expect(document.querySelector(marker)).toBeNull();
  });
  it("ignores only its own mirror mutations; page-spoofed markers remain observable", async () => {
    const observer = new MutationObserver(() => {});
    observer.observe(document.body, { childList: true });
    readAnnotationFormText(gesture());
    expect(observer.takeRecords().every(isAnnotationTextMirrorMutation)).toBe(
      true,
    );
    const spoof = document.createElement("div");
    spoof.setAttribute("data-browser-comment-text-selection-mirror", "");
    document.body.append(spoof);
    expect(observer.takeRecords().some(isAnnotationTextMirrorMutation)).toBe(
      false,
    );
    observer.disconnect();
  });
});
