// @vitest-environment jsdom
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserPageAnnotations } from "./browserPagePreload";
import {
  BROWSER_ANNOTATION_PAGE_COMMAND,
  BROWSER_ANNOTATION_PAGE_EVENT,
} from "./browserAnnotationModel";

const page = vi.hoisted(() => ({
  ipc: undefined as EventEmitter | undefined,
  send: vi.fn(),
}));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  page.ipc = new EventEmitter();
  return {
    ipcRenderer: {
      on: (...args: Parameters<EventEmitter["on"]>) => page.ipc!.on(...args),
      off: (...args: Parameters<EventEmitter["off"]>) => page.ipc!.off(...args),
      send: page.send,
    },
  };
});

let dispose: () => void;
let button: HTMLButtonElement;
const originalTitle = document.title;
const originalElementFromPoint = Object.getOwnPropertyDescriptor(
  document,
  "elementFromPoint",
);
const begin = {
  type: "begin",
  annotationId: "annotation-1",
  token: "private-token",
  pageRevision: 3,
};
const command = (payload: Record<string, unknown>) =>
  page.ipc!.emit(BROWSER_ANNOTATION_PAGE_COMMAND, {}, payload);
const pointer = (type: string, x: number, y: number) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  button.dispatchEvent(event);
  return event;
};
const messages = (type: string) =>
  page.send.mock.calls
    .filter(
      (call) =>
        call[0] === BROWSER_ANNOTATION_PAGE_EVENT && call[1].type === type,
    )
    .map((call) => call[1]);
beforeEach(() => {
  page.send.mockClear();
  document.body.innerHTML =
    '<button id="save" aria-label="Save changes">Save</button>';
  document.title = "Test page";
  button = document.querySelector("button")!;
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
    x: 100,
    y: 120,
    width: 200,
    height: 60,
    top: 120,
    left: 100,
    right: 300,
    bottom: 180,
    toJSON: () => ({}),
  });
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => button),
  });
  vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => {
    callback(0);
    return 1;
  });
  dispose = installBrowserPageAnnotations();
});
afterEach(() => {
  dispose();
  page.ipc!.removeAllListeners();
  document.body.replaceChildren();
  document.title = originalTitle;
  if (originalElementFromPoint) {
    Object.defineProperty(
      document,
      "elementFromPoint",
      originalElementFromPoint,
    );
  } else {
    Reflect.deleteProperty(document, "elementFromPoint");
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isolated page annotation input", () => {
  it("selects the actual hovered DOM element, blocks its click action and sends CSS geometry", () => {
    const clicked = vi.fn();
    button.addEventListener("click", clicked);
    command({ ...begin, kind: "element" });
    expect(messages("began")).toHaveLength(1);
    pointer("pointermove", 120, 140);
    expect(pointer("pointerdown", 120, 140).defaultPrevented).toBe(true);
    expect(messages("selection")).toEqual([]);
    pointer("pointerup", 120, 140);
    pointer("click", 120, 140);
    expect(clicked).not.toHaveBeenCalled();
    expect(messages("selection")).toHaveLength(1);
    expect(messages("selection")[0]).toMatchObject({
      annotationId: "annotation-1",
      token: "private-token",
      pageRevision: 3,
      documentToken: expect.any(String),
      selection: {
        kind: "element",
        framePath: "main",
        targetSelector: "#save",
        targetRole: "button",
        targetText: "Save changes",
        targetRect: { x: 100, y: 120, width: 200, height: 60 },
        viewportSize: { width: 1024, height: 768 },
      },
    });
    // Isolated DOM decorations do not cancel their own selection.
    expect(messages("cancel")).toEqual([]);
  });

  it("normalizes a reverse region drag and ignores a click-sized region", () => {
    command({ ...begin, kind: "region" });
    pointer("pointerdown", 150, 200);
    pointer("pointerup", 150, 200);
    expect(messages("selection")).toEqual([]);
    pointer("pointerdown", 400, 300);
    pointer("pointermove", 150, 200);
    pointer("pointerup", 150, 200);
    expect(messages("selection")[0].selection).toMatchObject({
      kind: "region",
      targetRect: { x: 150, y: 200, width: 250, height: 100 },
      targetSelector: null,
      targetText: null,
    });
  });

  it("uses one element tool for both a short click and a region drag without activating the page", () => {
    command({ ...begin, kind: "element" });
    pointer("pointerdown", 400, 300);
    expect(messages("selection")).toEqual([]);
    pointer("pointermove", 150, 200);
    pointer("pointerup", 150, 200);
    expect(messages("selection")[0].selection).toMatchObject({
      kind: "region",
      targetRect: { x: 150, y: 200, width: 250, height: 100 },
      targetSelector: null,
    });
  });

  it("handles Escape and lets a fresh page session select again", () => {
    command({ ...begin, kind: "region" });
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    window.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(messages("cancel")[0]).toMatchObject({ reason: "escape" });
    pointer("pointerdown", 120, 140);
    pointer("pointerup", 120, 140);
    expect(messages("selection")).toEqual([]);
    command({ ...begin, annotationId: "annotation-2", kind: "element" });
    pointer("pointerdown", 120, 140);
    pointer("pointerup", 120, 140);
    expect(messages("selection")[0].annotationId).toBe("annotation-2");
  });

  it("requires session, private token, document and revision for prepare; ready is request-bound", () => {
    command({ ...begin, kind: "element" });
    pointer("pointerdown", 120, 140);
    pointer("pointerup", 120, 140);
    const selected = messages("selection")[0];
    for (const wrong of [
      { token: "forged" },
      { documentToken: "other" },
      { pageRevision: 2 },
      { annotationId: "other" },
    ])
      command({
        ...selected,
        type: "prepare",
        requestId: "capture-1",
        ...wrong,
      });
    expect(messages("ready")).toEqual([]);
    command({ ...selected, type: "prepare", requestId: "capture-1" });
    expect(messages("ready")[0]).toMatchObject({
      status: "ready",
      requestId: "capture-1",
      selection: selected.selection,
    });
    command({ ...selected, type: "clear", requestId: "capture-1" });
    command({ ...selected, type: "cancel" });
    pointer("pointerdown", 120, 140);
    pointer("pointerup", 120, 140);
    expect(messages("selection")).toHaveLength(1);
  });

  it.each(["scroll", "resize", "pagehide"])(
    "cancels stale viewport on %s",
    (event) => {
      command({ ...begin, kind: "element" });
      pointer("pointerdown", 120, 140);
      pointer("pointerup", 120, 140);
      window.dispatchEvent(new Event(event));
      expect(messages("cancel")[0]).toMatchObject({
        reason: "viewport-changed",
      });
    },
  );

  it("does not report a moved target as screenshot-ready", () => {
    command({ ...begin, kind: "element" });
    pointer("pointerdown", 120, 140);
    pointer("pointerup", 120, 140);
    vi.mocked(button.getBoundingClientRect).mockReturnValue({
      x: 200,
      y: 120,
      width: 200,
      height: 60,
    } as DOMRect);
    command({
      ...messages("selection")[0],
      type: "prepare",
      requestId: "capture-1",
    });
    expect(messages("ready")[0]).toMatchObject({
      requestId: "capture-1",
      status: "stale",
    });
  });

  it("cancels selection on page DOM mutation and disconnects all input hooks on teardown", async () => {
    command({ ...begin, kind: "element" });
    pointer("pointerdown", 120, 140);
    pointer("pointerup", 120, 140);
    button.remove();
    await Promise.resolve();
    expect(messages("cancel")[0]).toMatchObject({ reason: "document-changed" });
    dispose();
    expect(page.ipc!.listenerCount(BROWSER_ANNOTATION_PAGE_COMMAND)).toBe(0);
    command({ ...begin, kind: "element" });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(messages("began")).toHaveLength(1);
    expect(messages("cancel")).toHaveLength(1);
  });

  it("keeps a stable selected target when unrelated page content changes", async () => {
    command({ ...begin, kind: "element" });
    pointer("pointerdown", 120, 140);
    pointer("pointerup", 120, 140);
    const unrelated = document.createElement("p");
    unrelated.textContent = "A live clock changed";
    document.body.append(unrelated);
    await Promise.resolve();
    expect(messages("cancel")).toEqual([]);
    command({
      ...messages("selection")[0],
      type: "prepare",
      requestId: "capture-1",
    });
    expect(messages("ready")[0]).toMatchObject({ status: "ready" });
  });
});
