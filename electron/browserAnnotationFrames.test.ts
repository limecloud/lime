// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  annotationFrameAt,
  annotationFrameCurrent,
  annotationFramePath,
  annotationFramePoint,
  annotationFrameRect,
} from "./browserAnnotationFrames";
import {
  beginAnnotationText,
  moveAnnotationText,
} from "./browserAnnotationText";
import { beginAnnotationFormText } from "./browserAnnotationFormText";
import {
  annotationParent,
  annotationShadowHosts,
} from "./browserAnnotationTextLocator";

function hit(doc: Document, element: Element) {
  Object.defineProperty(doc, "elementFromPoint", {
    configurable: true,
    value: () => element,
  });
}
function frame(
  doc: Document,
  id: string,
  bounds: [number, number, number, number],
  size: [number, number],
  border: number,
  scale = 1,
) {
  const element = doc.createElement("iframe");
  element.id = id;
  doc.body.append(element);
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
    new DOMRect(...bounds),
  );
  for (const [key, value] of Object.entries({
    offsetWidth: bounds[2] / scale,
    offsetHeight: bounds[3] / scale,
    clientWidth: size[0],
    clientHeight: size[1],
    clientLeft: border,
    clientTop: border,
  }))
    Object.defineProperty(element, key, { configurable: true, value });
  const child = element.contentDocument!;
  Object.defineProperty(child.defaultView, "innerWidth", {
    configurable: true,
    value: size[0],
  });
  Object.defineProperty(child.defaultView, "innerHeight", {
    configurable: true,
    value: size[1],
  });
  hit(doc, element);
  hit(child, child.body);
  return { element, child };
}
const fixture = () => {
  const outer = frame(document, "outer", [100, 60, 420, 220], [200, 100], 5, 2);
  const inner = frame(outer.child, "inner", [20, 10, 104, 64], [100, 60], 2);
  return { outer, inner };
};
afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(document, "elementFromPoint");
  vi.restoreAllMocks();
});

describe("same-origin annotation frames", () => {
  it("maps nested borders and scale in both directions and clips to each viewport", () => {
    fixture();
    const found = annotationFrameAt({ x: 174, y: 114 });
    expect(found.point).toEqual({ x: 10, y: 10 });
    expect(annotationFramePath(found.context)).toEqual([
      { selector: "#outer", shadowHosts: [] },
      { selector: "#inner", shadowHosts: [] },
    ]);
    expect(annotationFramePoint(found.context, { x: 174, y: 114 })).toEqual({
      x: 10,
      y: 10,
    });
    expect(
      annotationFrameRect(found.context, {
        x: 10,
        y: 10,
        width: 120,
        height: 40,
      }),
    ).toEqual({ x: 174, y: 114, width: 180, height: 80 });
    expect(
      annotationFrameRect(found.context, {
        x: 110,
        y: 10,
        width: 10,
        height: 10,
      }),
    ).toBeNull();
  });
  it("retires removed frames and same-URL document replacements", () => {
    const { inner } = fixture();
    const { context } = annotationFrameAt({ x: 174, y: 114 });
    expect(annotationFrameCurrent(context)).toBe(true);
    Object.defineProperty(inner.element, "contentDocument", {
      configurable: true,
      value: document.implementation.createHTMLDocument(),
    });
    expect(annotationFrameCurrent(context)).toBe(false);
    expect(annotationFramePoint(context, { x: 174, y: 114 })).toBeNull();
    inner.element.remove();
    expect(
      annotationFrameRect(context, { x: 1, y: 1, width: 10, height: 10 }),
    ).toBeNull();
  });
  it("keeps inaccessible and rotated frames as containers", () => {
    const outer = frame(
      document,
      "cross-origin",
      [100, 60, 210, 110],
      [200, 100],
      5,
    );
    Object.defineProperty(outer.element, "contentDocument", {
      configurable: true,
      value: null,
    });
    expect(annotationFrameAt({ x: 120, y: 90 })).toMatchObject({
      context: { frames: [] },
      element: outer.element,
    });
    Reflect.deleteProperty(outer.element, "contentDocument");
    outer.element.style.transform = "matrix(1, 0.1, 0, 1, 0, 0)";
    expect(annotationFrameAt({ x: 120, y: 90 }).context.frames).toEqual([]);
  });
  it("builds shadow locators and selects DOM text belonging to the child realm", () => {
    const { inner } = fixture();
    inner.child.body.innerHTML = '<section id="shadow"></section>';
    const host = inner.child.querySelector("section")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = '<p id="copy">A😀 child browser text</p>';
    const copy = shadow.querySelector("p")!;
    expect(annotationParent(copy)).toBe(host);
    expect(annotationShadowHosts(copy)).toEqual(["#shadow"]);
    hit(inner.child, host);
    Object.defineProperty(shadow, "elementFromPoint", {
      configurable: true,
      value: () => copy,
    });
    let offset = 1;
    Object.defineProperty(inner.child, "caretPositionFromPoint", {
      configurable: true,
      value: () => ({ offsetNode: copy.firstChild, offset }),
    });
    const range = inner.child.createRange();
    const prototype = Object.getPrototypeOf(range);
    Object.defineProperty(prototype, "getClientRects", {
      configurable: true,
      value: () => [new DOMRect(0, 0, 90, 20)],
    });
    const gesture = beginAnnotationText({ x: 5, y: 5 }, inner.child);
    expect(gesture).not.toBeNull();
    offset = 10;
    expect(moveAnnotationText(gesture!, { x: 80, y: 5 })).toMatchObject({
      targetText: "😀 child ",
      textLocator: { shadowHosts: ["#shadow"], startOffset: 1, endOffset: 10 },
    });
  });
  it("creates form mirrors in the child's document without changing its native selection", () => {
    const { inner } = fixture();
    inner.child.body.innerHTML =
      '<textarea id="form">A😀 frame form</textarea>';
    const control = inner.child.querySelector("textarea")!;
    hit(inner.child, control);
    vi.spyOn(control, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 50),
    );
    Object.defineProperty(inner.child, "caretPositionFromPoint", {
      configurable: true,
      value: () => ({
        offsetNode: inner.child.querySelector(
          "[data-browser-comment-text-selection-mirror]",
        )?.firstChild,
        offset: 1,
      }),
    });
    control.setSelectionRange(2, 4, "backward");
    const active = inner.child.activeElement;
    expect(
      beginAnnotationFormText({ x: 10, y: 10 }, inner.child),
    ).toMatchObject({ kind: "form-control", anchor: 1, value: control.value });
    expect([
      control.selectionStart,
      control.selectionEnd,
      control.selectionDirection,
    ]).toEqual([2, 4, "backward"]);
    expect(inner.child.activeElement).toBe(active);
    expect(
      inner.child.querySelector("[data-browser-comment-text-selection-mirror]"),
    ).toBeNull();
    expect(
      document.querySelector("[data-browser-comment-text-selection-mirror]"),
    ).toBeNull();
  });
});
