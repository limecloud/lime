import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  focusBrowserAnnotationComposer,
  listenBrowserAnnotationInputState,
  listenBrowserAnnotationEditor,
  setBrowserAnnotationMarkers,
  setBrowserAnnotationOriginal,
} from "./browserAnnotation";
import type { BrowserAnnotationInputState } from "./browserAnnotationTypes";

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: bridge.invoke,
  safeListen: bridge.listen,
}));
beforeEach(() => vi.clearAllMocks());
describe("Browser marker visibility gateway", () => {
  it("uses the current Desktop bridge and requires an exact receipt", async () => {
    bridge.invoke.mockResolvedValue({ tabId: "tab-1", visible: false });
    expect(await setBrowserAnnotationMarkers("tab-1", false)).toEqual({
      tabId: "tab-1",
      visible: false,
    });
    expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith(
      "browser_tab_set_annotation_markers",
      { tabId: "tab-1", visible: false },
    );
  });
  it.each([
    null,
    {},
    { tabId: "other", visible: false },
    { tabId: "tab-1", visible: true },
    { tabId: "tab-1", visible: "false" },
  ])("rejects a stale or malformed receipt %j", async (receipt) => {
    bridge.invoke.mockResolvedValue(receipt);
    await expect(setBrowserAnnotationMarkers("tab-1", false)).rejects.toThrow(
      "receipt",
    );
  });
});

describe("Browser annotation input and focus gateway", () => {
  const identity = {
    browserSessionId: "browser-1",
    threadId: "thread-1",
    tabId: "tab-1",
    viewId: "view-1",
    windowId: 1,
    ownerWebContentsId: 2,
    webContentsId: 3,
    pageRevision: 4,
  };
  it("validates a first Design capture and its page revision before delivering the editor event", async () => {
    const receive = vi.fn();
    await listenBrowserAnnotationEditor(receive);
    const listener = bridge.listen.mock.calls[0][1];
    const payload = {
      ...identity,
      editorId: "editor",
      draftId: "a",
      annotationId: "a",
      generation: 1,
      revision: 1,
      action: "save",
      body: "",
      attachedImages: [],
      designChange: {
        declarations: [],
        text: { previousValue: "Old", value: "New" },
      },
      capture: {
        annotationId: "a",
        selection: {},
        screenshot: {
          dataUrl: "data:image/png;base64,bmV3",
          width: 800,
          height: 600,
          kind: "viewport",
          viewportSize: { width: 800, height: 600 },
        },
        screenshotStatus: "captured",
        failureReason: null,
      },
    };
    listener({ payload });
    expect(receive).toHaveBeenCalledOnce();
    for (const invalid of [
      { ...payload, pageRevision: -1 },
      { ...payload, action: "close" },
      { ...payload, capture: { ...payload.capture, annotationId: "foreign" } },
      {
        ...payload,
        capture: { ...payload.capture, screenshotStatus: "failed" },
      },
      {
        ...payload,
        capture: {
          ...payload.capture,
          screenshot: {
            ...payload.capture.screenshot,
            viewportSize: { width: 0, height: 1 },
          },
        },
      },
    ])
      expect(() => listener({ payload: invalid })).toThrow();
    expect(receive).toHaveBeenCalledOnce();
  });
  it("validates original preview receipts and projects only exact identity fields", async () => {
    bridge.invoke.mockResolvedValue({
      ...identity,
      gestureId: "hold",
      original: true,
    });
    await setBrowserAnnotationOriginal(
      { ...identity, extra: "ignored" } as typeof identity,
      "hold",
      true,
    );
    expect(bridge.invoke).toHaveBeenLastCalledWith(
      "browser_tab_set_annotation_original",
      { tabId: identity.tabId, identity, gestureId: "hold", original: true },
    );
    for (const result of [
      null,
      {},
      { ...identity, gestureId: "old", original: true },
      { ...identity, gestureId: "hold", original: false },
      { ...identity, gestureId: "hold", original: true, extra: 1 },
      ...Object.keys(identity).map((key) => ({
        ...identity,
        [key]: "old",
        gestureId: "hold",
        original: true,
      })),
    ]) {
      bridge.invoke.mockResolvedValue(result);
      await expect(
        setBrowserAnnotationOriginal(identity, "hold", true),
      ).rejects.toThrow("receipt");
    }
  });
  it("requires an exact native focus receipt and sends only explicit identity fields", async () => {
    bridge.invoke.mockResolvedValue({ ...identity, focused: true });
    await focusBrowserAnnotationComposer({
      ...identity,
      extra: "ignored",
    } as typeof identity);
    expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith(
      "browser_tab_focus_annotation_composer",
      { tabId: "tab-1", identity },
    );
    for (const result of [
      null,
      { ...identity, focused: false },
      ...Object.keys(identity).map((key) => ({
        ...identity,
        focused: true,
        [key]: "old",
      })),
    ]) {
      bridge.invoke.mockResolvedValue(result);
      await expect(focusBrowserAnnotationComposer(identity)).rejects.toThrow(
        "receipt",
      );
    }
  });
  it("validates the identity and boolean input fields before publishing", async () => {
    const receive = vi.fn();
    await listenBrowserAnnotationInputState(receive);
    expect(bridge.listen.mock.calls[0][0]).toBe(
      "browser-tab-annotation-input-state",
    );
    const listener = bridge.listen.mock.calls[0][1];
    const payload: BrowserAnnotationInputState = {
      ...identity,
      annotationId: "annotation-1",
      kind: "element",
      scope: "page",
      suspended: true,
      addModifierPressed: false,
    };
    listener({ payload });
    expect(receive).toHaveBeenCalledExactlyOnceWith(payload);
    for (const invalid of [
      null,
      { ...payload, pageRevision: -1 },
      { ...payload, webContentsId: "3" },
      { ...payload, suspended: 1 },
      { ...payload, addModifierPressed: null },
    ])
      expect(() => listener({ payload: invalid })).toThrow();
    expect(receive).toHaveBeenCalledOnce();
  });
});
