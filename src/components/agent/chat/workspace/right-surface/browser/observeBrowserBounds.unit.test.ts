import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeBrowserBounds } from "./observeBrowserBounds";

describe("observeBrowserBounds", () => {
  let parent: HTMLDivElement;
  let element: HTMLDivElement;
  let frames: Map<number, (time: number) => void>;
  let resize: () => void;
  let disconnect: ReturnType<typeof vi.fn>;
  let stop: (() => void) | undefined;
  const flush = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(0));
  };

  beforeEach(() => {
    parent = document.createElement("div");
    element = document.createElement("div");
    parent.append(element);
    document.body.append(parent);
    frames = new Map();
    let next = 0;
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: (time: number) => void) => {
        frames.set(++next, callback);
        return next;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    parent.remove();
    vi.unstubAllGlobals();
  });

  it("tracks an ancestor transition already in progress and stops polling when it ends", () => {
    const animation = {
      transitionProperty: "transform",
      playState: "running",
      pending: false,
    };
    Object.assign(parent, { getAnimations: () => [animation] });
    const measure = vi.fn();
    stop = observeBrowserBounds(element, measure);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(1);
    flush();
    expect(measure).toHaveBeenCalledTimes(2);
    animation.playState = "finished";
    flush();
    expect(measure).toHaveBeenCalledTimes(3);
    expect(frames.size).toBe(0);
  });

  it("remeasures ancestor transition completion/cancellation and resize without polling at rest", () => {
    const measure = vi.fn();
    stop = observeBrowserBounds(element, measure);
    for (const type of ["transitionrun", "transitionend", "transitioncancel"]) {
      parent.dispatchEvent(new Event(type, { bubbles: true }));
    }
    resize();
    window.dispatchEvent(new Event("resize"));
    expect(measure).toHaveBeenCalledTimes(6);
    expect(frames.size).toBe(0);
    const child = document.createElement("button");
    element.append(child);
    child.dispatchEvent(new Event("transitionend", { bubbles: true }));
    expect(measure).toHaveBeenCalledTimes(6);
  });

  it("starts tracking a later transition and cancels all observations on disposal", () => {
    const animation = {
      transitionProperty: "width",
      playState: "finished",
      pending: false,
    };
    Object.assign(parent, { getAnimations: () => [animation] });
    const measure = vi.fn();
    stop = observeBrowserBounds(element, measure);
    expect(frames.size).toBe(0);
    animation.playState = "running";
    parent.dispatchEvent(new Event("transitionrun", { bubbles: true }));
    expect(frames.size).toBe(1);
    stop();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    parent.dispatchEvent(new Event("transitionend", { bubbles: true }));
    window.dispatchEvent(new Event("resize"));
    resize();
    expect(measure).toHaveBeenCalledTimes(2);
  });

  it("ignores perpetual CSS animations unrelated to a layout transition", () => {
    Object.assign(parent, {
      getAnimations: () => [{ playState: "running", pending: false }],
    });
    const measure = vi.fn();
    stop = observeBrowserBounds(element, measure);
    expect(measure).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });
});
