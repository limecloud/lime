// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginAnnotationText,
  moveAnnotationText,
  readAnnotationText,
  type AnnotationTextGesture,
} from "./browserAnnotationText";

import { annotationSelector } from "./browserAnnotationTextLocator";

const lines = [
  {
    x: 10,
    y: 20,
    width: 180,
    height: 20,
    left: 10,
    right: 190,
    top: 20,
    bottom: 40,
  },
  {
    x: 10,
    y: 40,
    width: 80,
    height: 20,
    left: 10,
    right: 90,
    top: 40,
    bottom: 60,
  },
];
const read = (range: Range, direction: "forward" | "backward" = "forward") =>
  readAnnotationText({
    kind: "dom",
    anchor: { node: range.startContainer as Text, offset: range.startOffset },
    range,
    direction,
  });
let caret: { offsetNode: Node; offset: number } | null;
const originals = new Map<string, PropertyDescriptor | undefined>();
beforeEach(() => {
  document.body.innerHTML = '<p id="copy">A😀 <b>browser</b> text</p>';
  caret = null;
  for (const key of ["elementFromPoint", "caretPositionFromPoint"])
    originals.set(key, Object.getOwnPropertyDescriptor(document, key));
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => document.querySelector("p"),
  });
  Object.defineProperty(document, "caretPositionFromPoint", {
    configurable: true,
    value: () => caret,
  });
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: vi.fn(() => lines),
  });
});
afterEach(() => {
  document.body.replaceChildren();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(document, key, descriptor);
    else Reflect.deleteProperty(document, key);
  }
  Reflect.deleteProperty(Range.prototype, "getClientRects");
  vi.restoreAllMocks();
});
const rangeAcrossInline = () => {
  const p = document.querySelector("p")!;
  const range = document.createRange();
  range.setStart(p.firstChild!, 1);
  range.setEnd(p.lastChild!, 3);
  return range;
};

describe("DOM annotation text selection", () => {
  it("preserves Unicode, inline boundaries, exact UTF-16 offsets and individual line rectangles", () => {
    expect(read(rangeAcrossInline())).toEqual({
      targetText: "😀 browser te",
      targetRect: { x: 10, y: 20, width: 180, height: 40 },
      selectionRects: lines.map(({ x, y, width, height }) => ({
        x,
        y,
        width,
        height,
      })),
      textLocator: {
        kind: "dom",
        selector: "#copy",
        shadowHosts: [],
        direction: "forward",
        rangeText: "😀 browser te",
        startOffset: 1,
        endOffset: 14,
      },
    });
  });
  it("uses the same ordered range for a backwards pointer gesture", () => {
    const p = document.querySelector("p")!;
    caret = { offsetNode: p.lastChild!, offset: 3 };
    const gesture = beginAnnotationText({ x: 80, y: 50 })!;
    expect(gesture).not.toBeNull();
    caret = { offsetNode: p.firstChild!, offset: 1 };
    expect(
      moveAnnotationText(gesture, { x: 10, y: 20 })?.textLocator,
    ).toMatchObject({
      direction: "backward",
      startOffset: 1,
      endOffset: 14,
      rangeText: "😀 browser te",
    });
  });
  it("does not start a text gesture when caret snapping lands outside actual glyphs", () => {
    caret = { offsetNode: document.querySelector("p")!.firstChild!, offset: 1 };
    expect(beginAnnotationText({ x: 500, y: 400 })).toBeNull();
  });
  it.each(["user-select:none", "-webkit-text-security:disc"])(
    "rejects protected text inside a larger selection: %s",
    (style) => {
      document.querySelector("b")!.setAttribute("style", style);
      // jsdom does not implement the vendor property; expose its actual declared value.
      if (style.startsWith("-webkit")) {
        const computed = window.getComputedStyle.bind(window);
        vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
          const result = computed(element);
          if (element.localName === "b")
            vi.spyOn(result, "getPropertyValue").mockImplementation((name) =>
              name === "-webkit-text-security" ? "disc" : "",
            );
          return result;
        });
      }
      expect(read(rangeAcrossInline())).toBeNull();
    },
  );
  it("rejects detached nodes, collapsed selections and oversized page text", () => {
    const range = rangeAcrossInline();
    document.querySelector("p")!.remove();
    expect(read(range)).toBeNull();
    document.body.textContent = "x".repeat(20001);
    const large = document.createRange();
    large.selectNodeContents(document.body.firstChild!);
    expect(read(large)).toBeNull();
    large.collapse(true);
    expect(read(large)).toBeNull();
  });
  it("retains a shadow-host path so identical selectors in different roots stay distinct", () => {
    const host = document.createElement("section");
    host.id = "host";
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = '<p id="copy">shadow text</p>';
    const range = document.createRange();
    range.setStart(shadow.querySelector("p")!.firstChild!, 0);
    range.setEnd(shadow.querySelector("p")!.firstChild!, 6);
    expect(read(range)?.textLocator).toMatchObject({
      selector: "#copy",
      shadowHosts: ["#host"],
      rangeText: "shadow",
    });
  });
  it("keeps DOM ranges out of controls and preserves the page's native selection", () => {
    const existing = window.getSelection()!;
    existing.removeAllRanges();
    existing.addRange(rangeAcrossInline());
    const before = existing.toString();
    document.body.insertAdjacentHTML(
      "beforeend",
      "<button>Confirm</button><textarea>private value</textarea>",
    );
    for (const element of Array.from(
      document.querySelectorAll("button, textarea"),
    )) {
      caret = { offsetNode: element.firstChild!, offset: 1 };
      expect(beginAnnotationText({ x: 30, y: 30 })).toBeNull();
    }
    read(rangeAcrossInline());
    expect(existing.toString()).toBe(before);
  });
  it("observes changed selected text and refuses a detached gesture endpoint", () => {
    const range = rangeAcrossInline();
    const gesture: AnnotationTextGesture = {
      kind: "dom",
      anchor: { node: range.startContainer as Text, offset: 1 },
      range,
      direction: "forward",
    };
    document.querySelector("b")!.firstChild!.textContent = "changed";
    expect(readAnnotationText(gesture)?.targetText).toBe("😀 changed te");
    gesture.anchor.node.remove();
    caret = { offsetNode: document.querySelector("b")!.firstChild!, offset: 2 };
    expect(moveAnnotationText(gesture, { x: 30, y: 30 })).toBeNull();
  });
  it("builds an unambiguous path beyond eight levels and escapes an ID", () => {
    document.body.innerHTML = '<div id="a:b"><i></i><i></i></div>';
    const element = document.querySelector("i:last-child")!;
    expect(annotationSelector(element)).toBe("#a\\:b > i:nth-of-type(2)");
    expect(document.querySelector(annotationSelector(element))).toBe(element);
  });
});
