// @vitest-environment node
import { EventEmitter } from "node:events";
import process from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_ANNOTATION_EDITOR_CHANNEL,
  BROWSER_ANNOTATION_EDITOR_UPDATE,
  type BrowserAnnotationEditorBridge,
} from "../src/lib/api/browserAnnotationEditorTypes";

const native = vi.hoisted(() => ({
  bridge: undefined as BrowserAnnotationEditorBridge | undefined,
  exposed: undefined as string | undefined,
  ipc: undefined as
    | (EventEmitter & { send: ReturnType<typeof vi.fn> })
    | undefined,
}));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  native.ipc = Object.assign(new EventEmitter(), { send: vi.fn() });
  return {
    ipcRenderer: native.ipc,
    contextBridge: {
      exposeInMainWorld: (
        name: string,
        bridge: BrowserAnnotationEditorBridge,
      ) => {
        native.exposed = name;
        native.bridge = bridge;
      },
    },
  };
});
const argv = process.argv;

beforeEach(() => {
  vi.resetModules();
  native.ipc?.send.mockClear();
  process.argv = [
    ...argv,
    "--browser-annotation-token=secret-nonce",
    "--browser-annotation-id=editor-1",
    "--browser-annotation-generation=3",
  ];
});
afterEach(() => {
  process.argv = argv;
  native.ipc?.removeAllListeners();
  vi.unstubAllGlobals();
});

function update(fields: Record<string, unknown> = {}) {
  native.ipc!.emit(
    BROWSER_ANNOTATION_EDITOR_UPDATE,
    {},
    {
      kind: "update",
      token: "secret-nonce",
      editorId: "editor-1",
      generation: 3,
      layout: { width: 360, maxHeight: 584 },
      presentation: {
        editorId: "editor-1",
        body: "",
        attachedImages: [],
        revision: 0,
      },
      pending: false,
      error: false,
      ...fields,
    },
  );
}

describe("annotation editor isolated preload", () => {
  it("reports only bounded height with the private identity after the first host update", async () => {
    await import("./browserAnnotationEditorPreload");
    native.bridge!.resize(180);
    expect(native.ipc!.send).not.toHaveBeenCalled();
    update({ layout: { width: 360, maxHeight: 584, x: 900 } });
    native.bridge!.resize(180);
    expect(native.ipc!.send).not.toHaveBeenCalled();
    update();
    for (const height of [0, -1, 1.5, NaN, Infinity, 20_001])
      native.bridge!.resize(height);
    expect(native.ipc!.send).not.toHaveBeenCalled();
    native.bridge!.resize(180);
    expect(native.ipc!.send).toHaveBeenCalledExactlyOnceWith(
      BROWSER_ANNOTATION_EDITOR_CHANNEL,
      {
        kind: "resize",
        token: "secret-nonce",
        editorId: "editor-1",
        generation: 3,
        height: 180,
      },
    );
    native.ipc!.emit(
      BROWSER_ANNOTATION_EDITOR_UPDATE,
      {},
      {
        kind: "flush",
        token: "secret-nonce",
        editorId: "editor-1",
        generation: 3,
        flushId: "resize-flush",
      },
    );
    native.ipc!.send.mockClear();
    native.bridge!.resize(200);
    expect(native.ipc!.send).not.toHaveBeenCalled();
  });

  it("revisions text and images together and includes the current images in final flush", async () => {
    await import("./browserAnnotationEditorPreload");
    update();
    const images = [
      {
        id: "manual-image",
        dataUrl: "data:image/png;base64,YWJj",
        filename: "manual.png",
      },
    ];
    native.bridge!.act("change", "", 0, images);
    expect(native.ipc!.send).not.toHaveBeenCalled();
    native.bridge!.act("change", "Comment", 1, images);
    native.bridge!.act("change", "Comment", 1, []);
    expect(native.ipc!.send).toHaveBeenCalledTimes(1);
    const receive = vi.fn();
    native.bridge!.onUpdate(receive);
    update({
      presentation: {
        editorId: "editor-1",
        body: "",
        revision: 0,
        attachedImages: [],
      },
      error: true,
    });
    expect(receive.mock.calls.at(-1)?.[0].presentation).toMatchObject({
      body: "Comment",
      revision: 1,
      attachedImages: images,
    });
    native.ipc!.emit(
      BROWSER_ANNOTATION_EDITOR_UPDATE,
      {},
      {
        kind: "flush",
        token: "secret-nonce",
        editorId: "editor-1",
        generation: 3,
        flushId: "flush-images",
      },
    );
    expect(native.ipc!.send.mock.calls.at(-1)?.[1]).toMatchObject({
      kind: "flushed",
      body: "Comment",
      revision: 1,
      attachedImages: images,
    });
  });

  it("exposes only the frozen narrow bridge and removes subscriber callbacks", async () => {
    await import("./browserAnnotationEditorPreload");
    expect(native.exposed).toBe("browserAnnotationEditor");
    expect(Object.keys(native.bridge!)).toEqual([
      "onUpdate",
      "ready",
      "resize",
      "act",
    ]);
    expect(Object.isFrozen(native.bridge)).toBe(true);
    const callback = vi.fn();
    const unsubscribe = native.bridge!.onUpdate(callback);
    update({ token: "forged" });
    update({ generation: 2 });
    update({ editorId: "old" });
    expect(callback).not.toHaveBeenCalled();
    update();
    expect(callback).toHaveBeenCalledExactlyOnceWith({
      presentation: {
        editorId: "editor-1",
        body: "",
        attachedImages: [],
        revision: 0,
      },
      generation: 3,
      layout: { width: 360, maxHeight: 584 },
      pending: false,
      error: false,
    });
    expect(callback.mock.calls[0][0]).not.toHaveProperty("token");
    unsubscribe();
    update();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("carries the private identity and rejects stale revisions and pending duplicate actions", async () => {
    await import("./browserAnnotationEditorPreload");
    native.bridge!.ready();
    expect(native.ipc!.send).toHaveBeenLastCalledWith(
      BROWSER_ANNOTATION_EDITOR_CHANNEL,
      {
        kind: "ready",
        token: "secret-nonce",
        editorId: "editor-1",
        generation: 3,
      },
    );
    update();
    native.bridge!.act("change", "Canonical", 1, []);
    native.bridge!.act("change", "Older", 0, []);
    native.bridge!.act("send", "Changed without revision", 1, []);
    native.bridge!.act("send", "Canonical", 1, []);
    native.bridge!.act("send", "Canonical", 1, []);
    native.bridge!.act("close", "Canonical", 1, []);
    expect(
      native.ipc!.send.mock.calls.map(([, message]) =>
        message.kind === "action" ? message.action : message.kind,
      ),
    ).toEqual(["ready", "change", "send"]);
  });

  it("flushes synchronous Composer serialization without exposing a new page capability or sending another action", async () => {
    await import("./browserAnnotationEditorPreload");
    update();
    const dispatch = vi.fn((event: { type: string }) => {
      expect(event.type).toBe("browser-annotation-editor-flush");
      native.bridge!.act("change", "Latest controller document", 2, []);
      native.bridge!.act("send", "Must not send", 3, []);
      return true;
    });
    vi.stubGlobal("dispatchEvent", dispatch);
    native.ipc!.emit(
      BROWSER_ANNOTATION_EDITOR_UPDATE,
      {},
      {
        kind: "flush",
        token: "secret-nonce",
        editorId: "editor-1",
        generation: 3,
        flushId: "flush-1",
      },
    );
    expect(dispatch).toHaveBeenCalledOnce();
    expect(native.ipc!.send).toHaveBeenCalledExactlyOnceWith(
      BROWSER_ANNOTATION_EDITOR_CHANNEL,
      {
        kind: "flushed",
        token: "secret-nonce",
        editorId: "editor-1",
        generation: 3,
        flushId: "flush-1",
        body: "Latest controller document",
        attachedImages: [],
        revision: 2,
      },
    );
    native.bridge!.ready();
    native.bridge!.act("send", "Late", 4, []);
    expect(native.ipc!.send).toHaveBeenCalledTimes(1);
  });

  it("stays inert without a host-created nonce and generation", async () => {
    process.argv = [...argv];
    await import("./browserAnnotationEditorPreload");
    native.bridge!.ready();
    update();
    native.bridge!.act("send", "Forged", 1, []);
    expect(native.ipc!.send).not.toHaveBeenCalled();
  });

  it("applies a host failure acknowledgement without replacing a newer local document", async () => {
    await import("./browserAnnotationEditorPreload");
    update();
    native.bridge!.act("change", "Captured", 1, []);
    native.bridge!.act("send", "Captured", 1, []);
    native.bridge!.act("change", "Newer local document", 2, []);
    const callback = vi.fn();
    native.bridge!.onUpdate(callback);
    update({
      presentation: {
        editorId: "editor-1",
        body: "Captured",
        attachedImages: [],
        revision: 1,
      },
      pending: false,
      error: true,
    });
    expect(callback.mock.calls.at(-1)?.[0]).toMatchObject({
      presentation: { body: "Newer local document", revision: 2 },
      pending: false,
      error: true,
    });
    native.bridge!.act("send", "Newer local document", 2, []);
    expect(native.ipc!.send.mock.calls.at(-1)?.[1]).toMatchObject({
      kind: "action",
      action: "send",
      body: "Newer local document",
      revision: 2,
    });
  });
});
