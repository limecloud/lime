// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  native,
  fixture,
  presentation,
  message,
  flush,
  type TestContents,
} from "./browserAnnotationEditorHost.testFixture";
import {
  BrowserAnnotationEditorHost,
  browserAnnotationEditorUrl,
} from "./browserAnnotationEditorHost";
import { BrowserOverlayHost } from "./browserOverlayHost";
import { BROWSER_ANNOTATION_EDITOR_CHANNEL } from "../src/lib/api/browserAnnotationEditorTypes";

describe("trusted browser annotation editor", () => {
  it("binds image changes to the same draft revision and preserves final flushed images", async () => {
    const f = fixture();
    const image = {
      id: "manual-image",
      dataUrl: "data:image/png;base64,YWJj",
      filename: "manual.png",
    };
    await f.show({
      ...presentation(),
      body: "Comment",
      revision: 2,
      attachedImages: [image],
    });
    const view = native.views[0];
    message(view, {
      kind: "action",
      action: "change",
      body: "Comment",
      revision: 2,
      attachedImages: [],
    });
    message(view, {
      kind: "action",
      action: "change",
      body: "Comment",
      revision: 3,
      attachedImages: [{ ...image, localPath: "/private/secret" }],
    });
    message(
      view,
      {
        kind: "action",
        action: "change",
        body: "Comment",
        revision: 3,
        attachedImages: [],
      },
      {},
    );
    expect(f.events).toEqual([]);
    message(view, {
      kind: "action",
      action: "change",
      body: "Comment",
      revision: 3,
      attachedImages: [],
    });
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toMatchObject({
      action: "change",
      body: "Comment",
      revision: 3,
      attachedImages: [],
    });
    f.host.hideWindow(1, "hidden");
    const flushId = view.webContents.send.mock.calls.at(-1)?.[1].flushId;
    message(view, {
      kind: "flushed",
      flushId,
      body: "Final comment",
      revision: 4,
      attachedImages: [image],
    });
    expect(f.events.at(-1)).toMatchObject({
      action: "close",
      body: "Final comment",
      revision: 4,
      attachedImages: [image],
    });
    expect(view.webContents.close).toHaveBeenCalledOnce();
  });

  it("retains the exact submitted image batch for retry after host failure", async () => {
    const f = fixture();
    const image = { id: "manual-image", dataUrl: "data:image/png;base64,YWJj" };
    const visible = await f.show();
    const view = native.views[0];
    const send = {
      kind: "action",
      action: "send",
      body: "Comment",
      revision: 1,
      attachedImages: [image],
    };
    message(view, send);
    message(view, send);
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toMatchObject({
      action: "send",
      attachedImages: [image],
    });
    if (!(f.host instanceof BrowserAnnotationEditorHost))
      throw new Error("Expected annotation editor owner");
    f.host.update("view-1", {
      editorId: visible.editorId,
      generation: visible.generation,
      pending: false,
      error: true,
    });
    message(view, send);
    expect(f.events).toHaveLength(2);
    expect(f.events[1]).toMatchObject({
      action: "send",
      attachedImages: [image],
    });
  });

  it("derives only the fixed local entry and rejects remote or credentialed owners", () => {
    expect(
      browserAnnotationEditorUrl(
        "http://127.0.0.1:1420/path?token=secret#route",
      ),
    ).toBe("http://127.0.0.1:1420/browser-annotation.html");
    expect(
      browserAnnotationEditorUrl(
        "file:///Applications/Lime.app/Contents/Resources/dist/index.html#/thread",
      ),
    ).toBe(
      "file:///Applications/Lime.app/Contents/Resources/dist/browser-annotation.html",
    );
    for (const url of [
      "https://example.test/index.html",
      "data:text/html,local",
      "file://remote/share/index.html",
      "http://user:password@localhost:1420/",
    ])
      expect(() => browserAnnotationEditorUrl(url)).toThrow();
  });

  it("places a compact sandboxed native view within the window and refuses child navigation", async () => {
    const f = fixture();
    expect(await f.show()).toEqual({
      editorId: "editor-1",
      generation: 1,
      visible: true,
    });
    const view = native.views[0];
    expect(view.webContents.loadURL).toHaveBeenCalledExactlyOnceWith(
      "http://localhost:1420/browser-annotation.html",
    );
    expect(view.options.webPreferences).toMatchObject({
      preload: "/isolated/browserAnnotationEditor.cjs",
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    });
    const bounds = view.setBounds.mock.calls[0][0];
    expect(bounds).toMatchObject({ width: 360, height: 264 });
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(800);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(600);
    expect(view.webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({
      action: "deny",
    });
    for (const name of [
      "will-navigate",
      "will-frame-navigate",
      "will-redirect",
      "will-attach-webview",
    ]) {
      const event = { preventDefault: vi.fn() };
      view.webContents.emit(name, event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }
    view.webContents.emit("frame-created", {}, { frame: { parent: {} } });
    expect(f.visible.size).toBe(0);
    flush(view, "", 0);
    expect(view.webContents.close).toHaveBeenCalledOnce();
    f.host.dispose();
  });

  it("checks exact sender, frame, nonce, generation and monotonic body revision", async () => {
    const f = fixture();
    await f.show();
    const view = native.views[0];
    const change = {
      kind: "action",
      action: "change",
      body: "First",
      revision: 1,
    };
    message(view, { ...change, token: "forged" });
    message(view, { ...change, generation: 0 });
    message(view, { ...change, editorId: "other" });
    message(view, change, {});
    message(view, change, view.webContents.mainFrame, {
      id: view.webContents.id,
    } as TestContents);
    expect(f.events).toEqual([]);
    message(view, change);
    message(view, change);
    message(view, { ...change, body: "Changed without revision" });
    message(view, { ...change, revision: 0 });
    message(view, { ...change, revision: Number.NaN });
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toMatchObject({
      action: "change",
      body: "First",
      revision: 1,
      pageRevision: 7,
    });
    f.host.hide("view-1");
    flush(view, "First", 1);
    f.host.dispose();
  });

  it("locks duplicate send and close while pending, and only a matching failure permits retry", async () => {
    const f = fixture();
    await f.show();
    const view = native.views[0];
    const host = f.host as BrowserAnnotationEditorHost;
    const send = {
      kind: "action",
      action: "send",
      body: "Comment",
      revision: 1,
    };
    message(view, send);
    message(view, send);
    message(view, { ...send, action: "save" });
    message(view, { ...send, action: "close" });
    expect(f.visible.size).toBe(1);
    expect(f.events.filter((event) => event.action === "send")).toHaveLength(1);
    expect(() =>
      host.update("view-1", {
        editorId: "editor-1",
        generation: 0,
        pending: false,
        error: true,
      }),
    ).toThrow("stale");
    message(view, send);
    expect(f.events).toHaveLength(1);
    host.update("view-1", {
      editorId: "editor-1",
      generation: 1,
      pending: false,
      error: true,
    });
    message(view, send);
    expect(f.events.filter((event) => event.action === "send")).toHaveLength(2);
    host.update("view-1", {
      editorId: "editor-1",
      generation: 1,
      pending: false,
      error: false,
    });
    message(view, send);
    expect(f.events.filter((event) => event.action === "send")).toHaveLength(2);
    f.host.hide("view-1");
    flush(view, "Comment", 1);
    f.host.dispose();
  });

  it("removes presentation immediately, then flushes only a draft against the captured identity", async () => {
    const f = fixture();
    await f.show();
    const view = native.views[0];
    message(view, {
      kind: "action",
      action: "change",
      body: "Known",
      revision: 1,
    });
    f.identity.pageRevision = 99;
    f.page.emit("did-start-navigation", {}, "https://other.test/", false, true);
    expect(f.visible.size).toBe(0);
    expect(view.webContents.close).not.toHaveBeenCalled();
    message(view, {
      kind: "action",
      action: "send",
      body: "Must not send",
      revision: 2,
    });
    message(view, {
      kind: "flushed",
      flushId: "forged",
      body: "Must not save",
      revision: 2,
    });
    expect(f.events.map((event) => event.action)).toEqual(["change"]);
    flush(view, "Latest canonical draft", 2);
    expect(f.events.at(-1)).toMatchObject({
      action: "close",
      body: "Latest canonical draft",
      revision: 2,
      pageRevision: 7,
      threadId: "thread-1",
    });
    expect(view.webContents.close).toHaveBeenCalledOnce();
    flush(view, "Too late", 3);
    expect(f.events).toHaveLength(2);
    f.host.dispose();
  });

  it.each(["blur", "closed"])(
    "preserves the acknowledged draft when %s cannot finish the flush",
    async (name) => {
      const f = fixture();
      await f.show();
      const view = native.views[0];
      message(view, {
        kind: "action",
        action: "change",
        body: "Acknowledged",
        revision: 1,
      });
      if (name === "blur") f.blur();
      else f.window.emit(name);
      vi.advanceTimersByTime(249);
      expect(view.webContents.close).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(view.webContents.close).toHaveBeenCalledOnce();
      expect(f.events.at(-1)).toMatchObject({
        action: "close",
        body: "Acknowledged",
        revision: 1,
      });
      expect(f.window.listenerCount("blur")).toBe(0);
      expect(f.page.listenerCount("did-start-navigation")).toBe(0);
      f.host.dispose();
      expect(native.ipc!.listenerCount(BROWSER_ANNOTATION_EDITOR_CHANNEL)).toBe(
        0,
      );
    },
  );

  it("moves the same editor on live geometry and resize without changing its draft or pending state", async () => {
    const f = fixture();
    if (!(f.host instanceof BrowserAnnotationEditorHost))
      throw new Error("Expected editor host");
    const receipt = await f.show();
    const view = native.views[0];
    message(view, {
      kind: "action",
      action: "send",
      body: "Preserve pending text",
      revision: 1,
    });
    f.window.emit("resize");
    expect(f.visible.has(view)).toBe(true);
    const page = { x: 100, y: 80, width: 700, height: 500 };
    const anchor = {
      viewportSize: { width: 700, height: 500 },
      targetRect: { x: 20, y: 40, width: 80, height: 30 },
    };
    f.host.position(
      { ...f.identity, pageRevision: 6 },
      "annotation-1",
      anchor,
      page,
    );
    expect(view.setBounds).toHaveBeenCalledTimes(1);
    f.host.position(f.identity, "annotation-1", anchor, page);
    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: 212,
      y: 120,
      width: 360,
      height: 264,
    });
    f.host.position(
      f.identity,
      "annotation-1",
      { ...anchor, targetRect: null },
      page,
    );
    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: 108,
      y: 88,
      width: 360,
      height: 264,
    });
    expect(native.views).toHaveLength(1);
    const focusCount = view.webContents.focus.mock.calls.length;
    f.host.focus(f.identity, "annotation-1");
    expect(view.webContents.focus).toHaveBeenCalledTimes(focusCount + 1);
    expect(view.webContents.close).not.toHaveBeenCalled();
    expect(view.webContents.send.mock.calls.at(-1)![1]).toMatchObject({
      generation: receipt.generation,
      pending: true,
      presentation: { body: "Preserve pending text", revision: 1 },
    });
    f.host.dispose();
  });

  it("keeps one menu or editor visible and does not restack a draining editor", async () => {
    const f = fixture(true);
    const host = f.host as BrowserOverlayHost;
    await host.show(
      f.window as never,
      "view-1",
      {
        menuId: "menu-1",
        anchor: { x: 10, y: 10, width: 20, height: 20 },
        items: [{ id: "print", label: "Print" }],
      },
      f.page as never,
    );
    const menu = native.views[0];
    await f.show();
    expect(menu.webContents.close).toHaveBeenCalledOnce();
    expect(f.visible.size).toBe(1);
    const editor = native.views[1];
    host.restack(1);
    expect(f.visible.has(editor)).toBe(true);
    await host.show(
      f.window as never,
      "view-1",
      {
        menuId: "menu-2",
        anchor: { x: 10, y: 10, width: 20, height: 20 },
        items: [{ id: "print", label: "Print" }],
      },
      f.page as never,
    );
    expect(f.visible.size).toBe(1);
    expect(f.visible.has(editor)).toBe(false);
    host.restack(1);
    expect(f.visible.has(editor)).toBe(false);
    flush(editor, "Saved on replacement", 1);
    expect(native.views[2].webContents.close).not.toHaveBeenCalled();
    host.dispose();
  });

  it("isolates windows and a late load failure from a replacement generation", async () => {
    const f = fixture();
    const other = fixture(false, 2);
    let reject!: (error: Error) => void;
    native.nextLoad = new Promise<void>((_resolve, fail) => {
      reject = fail;
    });
    const old = f.show();
    const rejected = expect(old).rejects.toThrow("old load");
    native.nextLoad = undefined;
    expect(await f.show(presentation("editor-2"))).toEqual({
      editorId: "editor-2",
      generation: 2,
      visible: true,
    });
    await other.show();
    reject(new Error("old load"));
    await rejected;
    expect(native.views[1].webContents.close).not.toHaveBeenCalled();
    f.host.hide("view-1");
    flush(native.views[1], "", 0);
    expect(native.views[2].webContents.close).not.toHaveBeenCalled();
    f.host.dispose();
    other.host.dispose();
  });

  it("retains the narrow listener only until disposed editors finish their bounded draft flush", async () => {
    const f = fixture();
    await f.show();
    const view = native.views[0];
    f.host.dispose();
    expect(native.ipc!.listenerCount(BROWSER_ANNOTATION_EDITOR_CHANNEL)).toBe(
      1,
    );
    flush(view, "Final draft", 1);
    expect(f.events.at(-1)).toMatchObject({
      action: "close",
      body: "Final draft",
    });
    expect(native.ipc!.listenerCount(BROWSER_ANNOTATION_EDITOR_CHANNEL)).toBe(
      0,
    );
    await expect(f.show()).rejects.toThrow("unavailable");
  });

  it("ignores a late exact-close for a replaced editor while keeping the successor visible", async () => {
    const f = fixture(true);
    const host = f.host as BrowserOverlayHost;
    const first = await f.show();
    const old = native.views[0];
    const next = await f.show(presentation("editor-2"));
    const successor = native.views[1];
    expect(host.closeAnnotation("view-1", first)).toBe(false);
    expect(f.visible.has(successor)).toBe(true);
    flush(old, "Original draft", 1);
    expect(host.closeAnnotation("view-1", next)).toBe(true);
    expect(host.closeAnnotation("view-1", next)).toBe(false);
    flush(successor, "Successor draft", 1);
    expect(f.events.map((event) => [event.editorId, event.body])).toEqual([
      ["editor-1", "Original draft"],
      ["editor-2", "Successor draft"],
    ]);
    host.dispose();
  });

  it("rejects malformed presentations and mismatched page ownership before creating a view", async () => {
    const f = fixture();
    await expect(
      f.show({ ...presentation(), unexpected: "capability" } as never),
    ).rejects.toThrow("unsupported");
    f.identity.webContentsId = 999;
    await expect(f.show()).rejects.toThrow("identity");
    expect(native.views).toHaveLength(0);
    f.host.dispose();
  });
});
