// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginAnnotationRegion,
  readAnnotationRegion,
} from "./browserAnnotationRegion";
import {
  annotationFrameAt,
  annotationRootFrame,
} from "./browserAnnotationFrames";

function hit(doc: Document | ShadowRoot, element: Element) {
  Object.defineProperty(doc, "elementFromPoint", {
    configurable: true,
    value: () => element,
  });
}
function box(
  element: HTMLElement,
  x: number,
  y: number,
  width: number,
  height: number,
  scale = 1,
) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
    new DOMRect(x, y, width, height),
  );
  for (const [key, value] of Object.entries({
    offsetWidth: width / scale,
    offsetHeight: height / scale,
    clientWidth: width / scale,
    clientHeight: height / scale,
  }))
    Object.defineProperty(element, key, { configurable: true, value });
}
function scroller(
  parent: Element | ShadowRoot,
  bounds: [number, number, number, number],
  scale = 1,
) {
  const element = document.createElement("div");
  element.style.overflow = "auto";
  parent.append(element);
  box(element, ...bounds, scale);
  return element;
}
const captured = Object.freeze({ x: 150, y: 180, width: 100, height: 50 });
const end = { x: 250, y: 230 };
afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(document, "elementFromPoint");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("private region presentation anchors", () => {
  it("accumulates nested two-axis scroll in scaled viewport pixels without rewriting capture", () => {
    const outer = scroller(document.body, [50, 50, 600, 600], 2);
    const inner = scroller(outer, [100, 100, 400, 400], 2);
    inner.scrollTop = 10;
    hit(document, inner);
    const region = beginAnnotationRegion(annotationRootFrame(), captured, end)!;
    inner.scrollTop = 20;
    inner.scrollLeft = 5;
    outer.scrollTop = 5;
    vi.stubGlobal("scrollX", 7);
    vi.stubGlobal("scrollY", 11);
    expect(readAnnotationRegion(region)).toEqual({
      x: 133,
      y: 139,
      width: 100,
      height: 50,
    });
    expect(region.rect).toEqual(captured);
    expect(captured).toEqual({ x: 150, y: 180, width: 100, height: 50 });
  });

  it("clips each overflow axis and returns after scrolling offscreen and back", () => {
    const outer = scroller(document.body, [50, 100, 300, 200]);
    outer.style.overflowX = "visible";
    outer.style.overflowY = "hidden";
    hit(document, outer);
    const region = beginAnnotationRegion(annotationRootFrame(), captured, end)!;
    outer.scrollTop = 100;
    expect(readAnnotationRegion(region)).toEqual({
      x: 150,
      y: 100,
      width: 100,
      height: 30,
    });
    outer.scrollTop = 300;
    expect(readAnnotationRegion(region)).toBeNull();
    outer.scrollTop = 0;
    expect(readAnnotationRegion(region)).toEqual(captured);
  });

  it("finds scroll containers across an open shadow host and retires removed or rotated containers", () => {
    const outer = scroller(document.body, [50, 50, 500, 500]);
    const shadow = outer.attachShadow({ mode: "open" });
    const inner = scroller(shadow, [100, 100, 300, 300]);
    hit(document, outer);
    hit(shadow, inner);
    const region = beginAnnotationRegion(annotationRootFrame(), captured, end)!;
    expect(region.containers.map((value) => value.element)).toEqual([
      inner,
      outer,
    ]);
    inner.scrollTop = 20;
    expect(readAnnotationRegion(region)?.y).toBe(160);
    outer.style.transform = "matrix(1, 0.2, 0, 1, 0, 0)";
    expect(readAnnotationRegion(region)).toBeNull();
    outer.style.transform = "none";
    outer.remove();
    expect(readAnnotationRegion(region)).toBeNull();
  });

  it("keeps a region over fixed pixels in document coordinates", () => {
    const fixed = document.createElement("div");
    fixed.style.position = "fixed";
    document.body.append(fixed);
    hit(document, fixed);
    const region = beginAnnotationRegion(annotationRootFrame(), captured, end)!;
    vi.stubGlobal("scrollY", 40);
    expect(readAnnotationRegion(region)).toEqual({ ...captured, y: 140 });
    expect(region.containers).toEqual([]);
  });

  it("maps child document scroll and moving scaled iframe bounds to the same root viewport", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    box(frame, 100, 60, 400, 300, 2);
    const doc = frame.contentDocument!;
    for (const [key, value] of Object.entries({
      innerWidth: 200,
      innerHeight: 150,
    }))
      Object.defineProperty(doc.defaultView, key, {
        configurable: true,
        value,
      });
    hit(document, frame);
    hit(doc, doc.body);
    const { context } = annotationFrameAt(end);
    const region = beginAnnotationRegion(context, captured, end)!;
    Object.defineProperty(doc.defaultView, "scrollY", {
      configurable: true,
      value: 20,
    });
    expect(readAnnotationRegion(region)).toEqual({ ...captured, y: 140 });
    vi.mocked(frame.getBoundingClientRect).mockReturnValue(
      new DOMRect(120, 80, 400, 300),
    );
    expect(readAnnotationRegion(region)).toEqual({
      ...captured,
      x: 170,
      y: 160,
    });
    Object.defineProperty(frame, "contentDocument", {
      configurable: true,
      value: document.implementation.createHTMLDocument(),
    });
    expect(readAnnotationRegion(region)).toBeNull();
  });
});
