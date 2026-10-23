// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserAnnotationAnchorLayer } from "./browserAnnotationAnchorLayer";
import { clipAnnotationRect } from "./browserAnnotationAnchorGeometry";
import { readAnnotationAnchor } from "./browserAnnotationAnchor";

let layer: BrowserAnnotationAnchorLayer;
let shadow: ShadowRoot;
let frames: Map<number, (time: number) => void>;
let next: number;
beforeEach(() => {
  frames = new Map();
  next = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => {
    frames.set(++next, callback);
    return next;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const attach = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (
    this: Element,
    options,
  ) {
    shadow = attach.call(this, options);
    return shadow;
  });
  layer = new BrowserAnnotationAnchorLayer();
});
afterEach(() => {
  layer.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function source(id = "first") {
  let rect: { x: number; y: number; width: number; height: number } | null = {
    x: 100,
    y: 120,
    width: 80,
    height: 30,
  };
  const update = vi.fn(),
    activate = vi.fn();
  return {
    id,
    documents: [document],
    element: null,
    read: () => rect && { targetRect: rect },
    update,
    activate,
    move: (value: typeof rect) => {
      rect = value;
    },
  };
}
function flush() {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(0));
}

describe("retained annotation presentation", () => {
  it("pauses one marker without reading or publishing layout and refreshes it on restore", () => {
    const a = source(),
      b = source("second");
    layer.add(a);
    layer.add(b);
    layer.setVisible(a.id, false);
    a.move({ x: 30, y: 40, width: 50, height: 20 });
    layer.refresh();
    expect(a.update).toHaveBeenCalledTimes(1);
    expect(shadow.querySelector("button")!.style.display).toBe("none");
    expect(shadow.querySelectorAll("button")[1].style.display).toBe("grid");
    layer.setVisible(a.id, true);
    expect(a.update).toHaveBeenCalledTimes(2);
    expect(a.update.mock.calls.at(-1)![0].targetRect).toEqual({
      x: 30,
      y: 40,
      width: 50,
      height: 20,
    });
    expect(shadow.querySelector("button")!.style.display).toBe("grid");
    expect(b.update).toHaveBeenCalledTimes(1);
  });

  it("coalesces layout events, preserves multiple markers and releases all listeners", async () => {
    const a = source(),
      b = source("second");
    layer.add(a);
    layer.add(b);
    expect(shadow.querySelectorAll("button")).toHaveLength(2);
    expect(
      Array.from(shadow.querySelectorAll("button")).map(
        (button) => button.textContent,
      ),
    ).toEqual(["1", "2"]);
    expect(shadow.host.getAttribute("style")).toContain("pointer-events: none");
    a.move({ x: 100, y: 20, width: 80, height: 30 });
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    expect(frames.size).toBe(1);
    flush();
    expect(a.update).toHaveBeenLastCalledWith({
      viewportSize: { width: 1024, height: 768 },
      targetRect: { x: 100, y: 20, width: 80, height: 30 },
    });
    expect(b.update).toHaveBeenCalledTimes(1);
    layer.remove("first");
    expect(shadow.querySelector("button")!.textContent).toBe("1");
    layer.dispose();
    window.dispatchEvent(new Event("scroll"));
    await Promise.resolve();
    expect(frames.size).toBe(0);
    expect(shadow.host.isConnected).toBe(false);
  });
  it("does not activate existing drafts from script clicks and hides a missing target", () => {
    const a = source();
    layer.add(a);
    shadow.querySelector("button")!.click();
    expect(a.activate).not.toHaveBeenCalled();
    a.move(null);
    layer.refresh();
    expect(a.update).toHaveBeenLastCalledWith({
      viewportSize: { width: 1024, height: 768 },
      targetRect: null,
    });
    expect(shadow.querySelector("button")!.style.display).toBe("none");
  });
  it("observes shadow text/layout mutations without looping on its own decorations", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = host.attachShadow({ mode: "open" });
    const element = document.createElement("p");
    element.textContent = "Original";
    root.append(element);
    const a = source();
    layer.add({ ...a, element });
    await Promise.resolve();
    flush();
    element.firstChild!.textContent = "Changed";
    await Promise.resolve();
    expect(frames.size).toBe(1);
    flush();
    await Promise.resolve();
    expect(frames.size).toBe(0);
  });
  it("clips independently on each overflow axis through shadow hosts", () => {
    const parent = document.createElement("div");
    parent.style.overflowY = "hidden";
    document.body.append(parent);
    const child = document.createElement("div");
    parent.attachShadow({ mode: "open" }).append(child);
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue(
      new DOMRect(50, 100, 100, 100),
    );
    Object.defineProperties(parent, {
      clientHeight: { value: 100 },
      clientWidth: { value: 100 },
      offsetHeight: { value: 100 },
      offsetWidth: { value: 100 },
    });
    expect(
      clipAnnotationRect({ x: 20, y: 80, width: 300, height: 50 }, child),
    ).toEqual({ x: 20, y: 100, width: 300, height: 30 });
  });
  it("accepts only finite visible geometry or explicit top-left fallback", () => {
    expect(
      readAnnotationAnchor({
        viewportSize: { width: 800, height: 600 },
        targetRect: null,
      }).targetRect,
    ).toBeNull();
    for (const targetRect of [
      { x: -1, y: 2, width: 3, height: 4 },
      { x: 799, y: 2, width: 3, height: 4 },
      { x: 1, y: 2, width: Infinity, height: 4 },
    ])
      expect(() =>
        readAnnotationAnchor({
          viewportSize: { width: 800, height: 600 },
          targetRect,
        }),
      ).toThrow();
  });
});
