// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { BROWSER_ANNOTATION_PAGE_COMMAND } from "./browserAnnotationModel";
import { installConstructedSheets } from "./browserDesignPreview.testFixture";
import {
  page,
  button,
  begin,
  command,
  pointer,
  messages,
  dispose,
} from "./browserPagePreload.testFixture";

describe("isolated page annotation input", () => {
  it("keeps retained markers hidden until an exact private visibility command, including a paused restore", () => {
    const shadows: ShadowRoot[] = [];
    const attach = Element.prototype.attachShadow;
    vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (
      this: Element,
      options,
    ) {
      const shadow = attach.call(this, options);
      shadows.push(shadow);
      return shadow;
    });
    command({ ...begin, kind: "element" });
    pointer("pointerdown", 120, 140);
    pointer("pointerup", 120, 140);
    const selected = messages("selection")[0];
    const snapshot = structuredClone(selected.selection);
    command({ ...selected, type: "prepare", requestId: "capture" });
    command({
      ...selected,
      type: "retain",
      requestId: "capture",
      markersVisible: false,
    });
    const shadow = shadows.at(-1)!;
    const marker = shadow.querySelector("button")!;
    expect(shadow.mode).toBe("closed");
    expect(marker.style.display).toBe("none");
    for (const invalid of [
      { token: "wrong" },
      { documentToken: "wrong" },
      { pageRevision: 4 },
      { visible: "true" },
    ])
      command({
        ...selected,
        type: "set-marker-visibility",
        visible: true,
        ...invalid,
      });
    expect(marker.style.display).toBe("none");
    command({ ...selected, type: "set-marker-visibility", visible: true });
    expect(marker.style.display).toBe("grid");
    command({ ...selected, type: "hide-marker", nextToken: "new-token" });
    expect(marker.style.display).toBe("none");
    command({
      ...selected,
      token: "new-token",
      type: "restore-marker",
      nextPageRevision: 5,
      markersVisible: false,
    });
    expect(messages("marker-restored")).toHaveLength(1);
    expect(marker.style.display).toBe("none");
    command({
      ...selected,
      token: "new-token",
      pageRevision: 5,
      type: "set-marker-visibility",
      visible: true,
    });
    expect(marker.style.display).toBe("grid");
    command({
      ...selected,
      token: "new-token",
      pageRevision: 5,
      type: "prepare",
      requestId: "recapture",
    });
    expect(messages("ready")).toHaveLength(1);
    expect(messages("selection")).toHaveLength(1);
    expect(selected.selection).toEqual(snapshot);
  });

  it("rebinds only a retained marker to a newer Host presentation revision without another selection or capture", () => {
    command({ ...begin, kind: "element" });
    pointer("pointerdown", 120, 140);
    pointer("pointerup", 120, 140);
    const selected = messages("selection")[0];
    command({ ...selected, type: "prepare", requestId: "capture" });
    command({ ...selected, type: "retain", requestId: "capture" });
    command({ ...selected, type: "hide-marker", nextToken: "new-token" });
    for (const invalid of [
      { nextPageRevision: 2 },
      { nextPageRevision: 4.5 },
      { nextPageRevision: 5, documentToken: "wrong" },
      { nextPageRevision: 5, token: selected.token },
    ])
      command({
        ...selected,
        token: "new-token",
        type: "restore-marker",
        ...invalid,
      });
    expect(messages("marker-restored")).toHaveLength(0);
    command({
      ...selected,
      token: "new-token",
      type: "restore-marker",
      nextPageRevision: 5,
    });
    expect(messages("marker-restored")).toEqual([
      expect.objectContaining({ pageRevision: 5, token: "new-token" }),
    ]);
    const anchors = messages("anchor").length;
    command({ ...selected, token: "new-token", type: "refresh" });
    expect(messages("anchor")).toHaveLength(anchors);
    command({
      ...selected,
      token: "new-token",
      pageRevision: 5,
      type: "refresh",
    });
    expect(messages("anchor").at(-1).pageRevision).toBe(5);
    command({
      ...selected,
      token: "new-token",
      pageRevision: 5,
      type: "prepare",
      requestId: "recapture",
    });
    expect(messages("ready")).toHaveLength(1);
    expect(messages("selection")).toHaveLength(1);
  });

  it("hides a saved marker, rotates its token and restores only the same document without a picker", () => {
    command({ ...begin, kind: "element" });
    pointer("pointerdown", 120, 140);
    pointer("pointerup", 120, 140);
    const selected = messages("selection")[0];
    const snapshot = structuredClone(selected.selection);
    command({ ...selected, type: "prepare", requestId: "capture" });
    command({ ...selected, type: "retain", requestId: "capture" });
    const anchorsBefore = messages("anchor").length;
    command({ ...selected, type: "hide-marker", nextToken: "fresh-token" });
    command({ ...selected, type: "refresh" });
    command({
      ...selected,
      type: "restore-marker",
      nextPageRevision: begin.pageRevision,
    });
    expect(messages("anchor")).toHaveLength(anchorsBefore);
    expect(messages("marker-restored")).toHaveLength(0);
    command({
      ...selected,
      type: "restore-marker",
      nextPageRevision: begin.pageRevision,
      token: "fresh-token",
      documentToken: "different-document",
    });
    expect(messages("marker-restored")).toHaveLength(0);
    command({
      ...selected,
      type: "restore-marker",
      nextPageRevision: begin.pageRevision,
      token: "fresh-token",
    });
    expect(messages("marker-restored")).toHaveLength(1);
    expect(messages("marker-restored")[0]).toMatchObject({
      annotationId: begin.annotationId,
      token: "fresh-token",
      documentToken: selected.documentToken,
    });
    expect(messages("anchor")).toHaveLength(anchorsBefore + 1);
    expect(messages("anchor").at(-1).token).toBe("fresh-token");
    expect(messages("selection")).toHaveLength(1);
    expect(selected.selection).toEqual(snapshot);
    expect(pointer("pointerdown", 120, 140).defaultPrevented).toBe(false);
    command({
      ...selected,
      type: "prepare",
      requestId: "recapture",
      token: "fresh-token",
    });
    expect(messages("ready")).toHaveLength(1);
    command({
      ...selected,
      type: "hide-marker",
      nextToken: "third-token",
      token: "fresh-token",
    });
    command({ ...selected, type: "cancel", token: "third-token" });
    command({
      ...selected,
      type: "restore-marker",
      nextPageRevision: begin.pageRevision,
      token: "third-token",
    });
    expect(messages("marker-restored")).toHaveLength(1);
  });

  it("leaves saved marker events outside a fresh picker while synthetic activation remains powerless", () => {
    command({ ...begin, kind: "element" });
    pointer("pointerdown", 120, 140);
    pointer("pointerup", 120, 140);
    const selected = messages("selection")[0];
    command({ ...selected, type: "prepare", requestId: "capture" });
    command({ ...selected, type: "retain", requestId: "capture" });
    command({ ...begin, kind: "element", annotationId: "second" });
    const anchor = Array.from(document.documentElement.children).find(
      (element) => (element as HTMLElement).style.zIndex === "2147483646",
    )!;
    for (const type of ["pointerdown", "pointerup", "click"]) {
      const event = new MouseEvent(type, {
        bubbles: true,
        composed: true,
        cancelable: true,
        button: 0,
        clientX: 120,
        clientY: 140,
      });
      anchor.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(messages("selection")).toHaveLength(1);
    expect(messages("activate")).toHaveLength(0);
    pointer("pointerdown", 120, 140);
    pointer("pointerup", 120, 140);
    expect(messages("selection").at(-1).annotationId).toBe("second");
  });

  it("retains region scroll geometry separately from capture and rejects recapture after retention", () => {
    button.style.overflow = "auto";
    for (const [key, value] of Object.entries({
      offsetWidth: 200,
      offsetHeight: 60,
      clientWidth: 200,
      clientHeight: 60,
    }))
      Object.defineProperty(button, key, { configurable: true, value });
    command({ ...begin, kind: "region" });
    pointer("pointerdown", 120, 140);
    pointer("pointerup", 220, 170);
    const selected = messages("selection")[0];
    const snapshot = structuredClone(selected.selection);
    command({ ...selected, type: "prepare", requestId: "region-capture" });
    command({ ...selected, type: "retain", requestId: "region-capture" });
    button.scrollTop = 10;
    command({ ...selected, type: "refresh" });
    expect(messages("anchor").at(-1).anchor.targetRect).toEqual({
      x: 120,
      y: 130,
      width: 100,
      height: 30,
    });
    expect(selected.selection).toEqual(snapshot);
    command({ ...selected, type: "prepare", requestId: "recapture" });
    expect(messages("ready")).toHaveLength(1);
  });

  it("retains independent captured targets, releases page input and removes only the requested marker", () => {
    const callbacks: ((time: number) => void)[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: (time: number) => void) => {
        callbacks.push(callback);
        return callbacks.length;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const flushFrames = () => {
      while (callbacks.length) callbacks.shift()!(0);
    };
    const select = (id: string) => {
      command({ ...begin, annotationId: id, kind: "element" });
      pointer("pointerdown", 120, 140);
      pointer("pointerup", 120, 140);
      const selected = messages("selection").at(-1);
      command({ ...selected, type: "prepare", requestId: `capture-${id}` });
      flushFrames();
      command({ ...selected, type: "retain", requestId: `capture-${id}` });
      return selected;
    };
    const first = select("first");
    expect(pointer("click", 120, 140).defaultPrevented).toBe(false);
    select("second");
    expect(messages("anchor").map((message) => message.annotationId)).toEqual([
      "first",
      "second",
    ]);
    vi.mocked(button.getBoundingClientRect).mockReturnValue(
      new DOMRect(100, 20, 200, 60),
    );
    window.dispatchEvent(new Event("scroll"));
    flushFrames();
    expect(messages("anchor").slice(-2)).toEqual([
      expect.objectContaining({
        annotationId: "first",
        anchor: expect.objectContaining({
          targetRect: { x: 100, y: 20, width: 200, height: 60 },
        }),
      }),
      expect.objectContaining({
        annotationId: "second",
        anchor: expect.objectContaining({
          targetRect: { x: 100, y: 20, width: 200, height: 60 },
        }),
      }),
    ]);
    command({ ...first, type: "cancel" });
    button.remove();
    window.dispatchEvent(new Event("scroll"));
    flushFrames();
    expect(messages("anchor").at(-1)).toMatchObject({
      annotationId: "second",
      anchor: { targetRect: null },
    });
    expect(messages("selection")[0].selection.targetRect.y).toBe(120);
    expect(messages("cancel")).toEqual([]);
  });
  it("selects a child-realm element through the main-frame shield and revokes on child scroll", () => {
    const frame = document.createElement("iframe");
    frame.id = "child";
    document.body.append(frame);
    const doc = frame.contentDocument!;
    const restoreChildSheets = installConstructedSheets(doc.defaultView!);
    doc.body.innerHTML = '<button id="child-button">Child action</button>';
    const child = doc.querySelector("button")!;
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(
      new DOMRect(20, 10, 100, 80),
    );
    for (const [key, value] of Object.entries({
      offsetWidth: 100,
      offsetHeight: 80,
      clientWidth: 100,
      clientHeight: 80,
      clientLeft: 0,
      clientTop: 0,
    }))
      Object.defineProperty(frame, key, { configurable: true, value });
    Object.defineProperty(doc.defaultView, "innerWidth", {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(doc.defaultView, "innerHeight", {
      configurable: true,
      value: 80,
    });
    Object.defineProperty(doc, "elementFromPoint", {
      configurable: true,
      value: () => child,
    });
    vi.spyOn(child, "getBoundingClientRect").mockReturnValue(
      new DOMRect(10, 10, 40, 20),
    );
    vi.mocked(document.elementFromPoint).mockReturnValue(frame);
    command({ ...begin, kind: "element" });
    pointer("pointerdown", 40, 30);
    pointer("pointerup", 40, 30);
    expect(messages("selection")[0].selection).toMatchObject({
      targetSelector: "#child-button",
      framePath: [{ selector: "#child", shadowHosts: [] }],
      frameUrl: "about:blank",
      targetRect: { x: 30, y: 20, width: 40, height: 20 },
    });
    doc.defaultView!.dispatchEvent(new Event("scroll"));
    expect(messages("cancel")).toEqual([
      expect.objectContaining({ reason: "frame-changed" }),
    ]);
    expect(
      doc.querySelector("[data-browser-comment-text-selection-mirror]"),
    ).toBeNull();
    restoreChildSheets();
  });
  it("keeps form mirrors out of mutation validation and revokes a programmatically changed value", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const input = document.createElement("textarea");
    input.id = "form-copy";
    input.value = "Form 😀 selected text";
    document.body.append(input);
    vi.spyOn(input, "getBoundingClientRect").mockReturnValue(
      new DOMRect(100, 120, 300, 60),
    );
    vi.mocked(document.elementFromPoint).mockReturnValue(input);
    const originalCaret = Object.getOwnPropertyDescriptor(
      document,
      "caretPositionFromPoint",
    );
    const originalRects = Object.getOwnPropertyDescriptor(
      Range.prototype,
      "getClientRects",
    );
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: (x: number) => ({
        offsetNode: document.querySelector(
          "[data-browser-comment-text-selection-mirror]",
        )?.firstChild,
        offset: x < 200 ? 1 : 16,
      }),
    });
    const lines = [new DOMRect(100, 120, 200, 20)];
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => lines,
    });
    vi.spyOn(Element.prototype, "getClientRects").mockReturnValue(
      lines as unknown as DOMRectList,
    );
    try {
      const activated = vi.fn();
      input.addEventListener("pointerdown", activated);
      command({ ...begin, kind: "element" });
      pointer("pointerdown", 120, 130);
      pointer("pointermove", 280, 130);
      pointer("pointerup", 280, 130);
      const selected = messages("selection")[0];
      expect(selected.selection).toMatchObject({
        kind: "text",
        targetText: input.value.slice(1, 16),
        textLocator: {
          kind: "form-control",
          selector: "#form-copy",
          startOffset: 1,
          endOffset: 16,
        },
      });
      command({ ...selected, type: "prepare", requestId: "form-capture" });
      await Promise.resolve();
      await Promise.resolve();
      expect(messages("ready")[0]?.status).toBe("ready");
      expect(messages("cancel")).toEqual([]);
      expect(
        document.querySelector("[data-browser-comment-text-selection-mirror]"),
      ).toBeNull();
      expect(activated).not.toHaveBeenCalled();
      input.value = "A script replaced the form value";
      await vi.advanceTimersByTimeAsync(100);
      expect(messages("cancel")[0]).toMatchObject({
        reason: "document-changed",
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      if (originalCaret)
        Object.defineProperty(
          document,
          "caretPositionFromPoint",
          originalCaret,
        );
      else Reflect.deleteProperty(document, "caretPositionFromPoint");
      if (originalRects)
        Object.defineProperty(Range.prototype, "getClientRects", originalRects);
      else Reflect.deleteProperty(Range.prototype, "getClientRects");
      vi.useRealTimers();
    }
  });
  it("selects text with the same element tool, suppresses page actions and cancels changed text", async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<p id="text">Hello <b>browser</b> 😀</p>',
    );
    const p = document.querySelector("p")!;
    const originalCaret = Object.getOwnPropertyDescriptor(
      document,
      "caretPositionFromPoint",
    );
    const originalRects = Object.getOwnPropertyDescriptor(
      Range.prototype,
      "getClientRects",
    );
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: (x: number) =>
        x < 200
          ? { offsetNode: p.firstChild, offset: 1 }
          : { offsetNode: p.lastChild, offset: 3 },
    });
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => [
        {
          x: 100,
          y: 120,
          left: 100,
          right: 300,
          top: 120,
          bottom: 140,
          width: 200,
          height: 20,
        },
      ],
    });
    try {
      const activated = vi.fn();
      p.addEventListener("pointerdown", activated);
      command({ ...begin, kind: "element" });
      pointer("pointerdown", 120, 130);
      pointer("pointermove", 280, 130);
      pointer("pointerup", 280, 130);
      const selected = messages("selection")[0];
      expect(selected.selection).toMatchObject({
        kind: "text",
        targetText: "ello browser 😀",
        textLocator: {
          kind: "dom",
          selector: "#text",
          startOffset: 1,
          endOffset: 16,
          direction: "forward",
        },
        selectionRects: [{ x: 100, y: 120, width: 200, height: 20 }],
      });
      expect(activated).not.toHaveBeenCalled();
      command({ ...selected, type: "prepare", requestId: "text-capture" });
      expect(messages("ready")[0]).toMatchObject({
        status: "ready",
        selection: selected.selection,
      });
      p.querySelector("b")!.textContent = "changed";
      await Promise.resolve();
      expect(messages("cancel")[0]).toMatchObject({
        reason: "document-changed",
      });
    } finally {
      if (originalCaret)
        Object.defineProperty(
          document,
          "caretPositionFromPoint",
          originalCaret,
        );
      else Reflect.deleteProperty(document, "caretPositionFromPoint");
      if (originalRects)
        Object.defineProperty(Range.prototype, "getClientRects", originalRects);
      else Reflect.deleteProperty(Range.prototype, "getClientRects");
    }
  });
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
        framePath: [],
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
    // Native focus restoration must preserve an already committed capture target.
    command({ ...selected, type: "resume" });
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
