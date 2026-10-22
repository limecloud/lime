// @vitest-environment node
import { EventEmitter } from "node:events";
import process from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BROWSER_ANNOTATION_EDITOR_CHANNEL, BROWSER_ANNOTATION_EDITOR_UPDATE, type BrowserAnnotationEditorBridge } from "../src/lib/api/browserAnnotationEditorTypes";

const native = vi.hoisted(() => ({ bridge: undefined as BrowserAnnotationEditorBridge | undefined, exposed: undefined as string | undefined, ipc: undefined as (EventEmitter & { send: ReturnType<typeof vi.fn> }) | undefined }));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  native.ipc = Object.assign(new EventEmitter(), { send: vi.fn() });
  return { ipcRenderer: native.ipc, contextBridge: { exposeInMainWorld: (name: string, bridge: BrowserAnnotationEditorBridge) => { native.exposed = name; native.bridge = bridge; } } };
});
const argv = process.argv;

beforeEach(() => {
  vi.resetModules();
  native.ipc?.send.mockClear();
  process.argv = [...argv, "--browser-annotation-token=secret-nonce", "--browser-annotation-id=editor-1", "--browser-annotation-generation=3"];
});
afterEach(() => { process.argv = argv; native.ipc?.removeAllListeners(); vi.unstubAllGlobals(); });

function update(fields: Record<string, unknown> = {}) {
  native.ipc!.emit(BROWSER_ANNOTATION_EDITOR_UPDATE, {}, { kind: "update", token: "secret-nonce", editorId: "editor-1", generation: 3,
    presentation: { editorId: "editor-1", body: "", revision: 0 }, pending: false, error: false, ...fields });
}

describe("annotation editor isolated preload", () => {
  it("exposes only the frozen narrow bridge and removes subscriber callbacks", async () => {
    await import("./browserAnnotationEditorPreload");
    expect(native.exposed).toBe("browserAnnotationEditor");
    expect(Object.keys(native.bridge!)).toEqual(["onUpdate", "ready", "act"]); expect(Object.isFrozen(native.bridge)).toBe(true);
    const callback = vi.fn(); const unsubscribe = native.bridge!.onUpdate(callback);
    update({ token: "forged" }); update({ generation: 2 }); update({ editorId: "old" }); expect(callback).not.toHaveBeenCalled();
    update(); expect(callback).toHaveBeenCalledExactlyOnceWith({ presentation: { editorId: "editor-1", body: "", revision: 0 }, generation: 3, pending: false, error: false });
    expect(callback.mock.calls[0][0]).not.toHaveProperty("token");
    unsubscribe(); update(); expect(callback).toHaveBeenCalledTimes(1);
  });

  it("carries the private identity and rejects stale revisions and pending duplicate actions", async () => {
    await import("./browserAnnotationEditorPreload");
    native.bridge!.ready();
    expect(native.ipc!.send).toHaveBeenLastCalledWith(BROWSER_ANNOTATION_EDITOR_CHANNEL, { kind: "ready", token: "secret-nonce", editorId: "editor-1", generation: 3 });
    update(); native.bridge!.act("change", "Canonical", 1);
    native.bridge!.act("change", "Older", 0); native.bridge!.act("send", "Changed without revision", 1);
    native.bridge!.act("send", "Canonical", 1); native.bridge!.act("send", "Canonical", 1); native.bridge!.act("close", "Canonical", 1);
    expect(native.ipc!.send.mock.calls.map(([, message]) => message.kind === "action" ? message.action : message.kind)).toEqual(["ready", "change", "send"]);
  });

  it("flushes synchronous Composer serialization without exposing a new page capability or sending another action", async () => {
    await import("./browserAnnotationEditorPreload"); update();
    const dispatch = vi.fn((event: { type: string }) => {
      expect(event.type).toBe("browser-annotation-editor-flush");
      native.bridge!.act("change", "Latest controller document", 2);
      native.bridge!.act("send", "Must not send", 3);
      return true;
    });
    vi.stubGlobal("dispatchEvent", dispatch);
    native.ipc!.emit(BROWSER_ANNOTATION_EDITOR_UPDATE, {}, { kind: "flush", token: "secret-nonce", editorId: "editor-1", generation: 3, flushId: "flush-1" });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(native.ipc!.send).toHaveBeenCalledExactlyOnceWith(BROWSER_ANNOTATION_EDITOR_CHANNEL, { kind: "flushed", token: "secret-nonce", editorId: "editor-1", generation: 3, flushId: "flush-1", body: "Latest controller document", revision: 2 });
    native.bridge!.ready(); native.bridge!.act("send", "Late", 4);
    expect(native.ipc!.send).toHaveBeenCalledTimes(1);
  });

  it("stays inert without a host-created nonce and generation", async () => {
    process.argv = [...argv]; await import("./browserAnnotationEditorPreload");
    native.bridge!.ready(); update(); native.bridge!.act("send", "Forged", 1);
    expect(native.ipc!.send).not.toHaveBeenCalled();
  });

  it("applies a host failure acknowledgement without replacing a newer local document", async () => {
    await import("./browserAnnotationEditorPreload"); update();
    native.bridge!.act("change", "Captured", 1); native.bridge!.act("send", "Captured", 1);
    native.bridge!.act("change", "Newer local document", 2);
    const callback = vi.fn(); native.bridge!.onUpdate(callback);
    update({ presentation: { editorId: "editor-1", body: "Captured", revision: 1 }, pending: false, error: true });
    expect(callback.mock.calls.at(-1)?.[0]).toMatchObject({ presentation: { body: "Newer local document", revision: 2 }, pending: false, error: true });
    native.bridge!.act("send", "Newer local document", 2);
    expect(native.ipc!.send.mock.calls.at(-1)?.[1]).toMatchObject({ kind: "action", action: "send", body: "Newer local document", revision: 2 });
  });
});
