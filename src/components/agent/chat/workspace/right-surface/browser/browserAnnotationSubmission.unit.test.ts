import { describe, expect, it, vi } from "vitest";
import type { BrowserAnnotationSelectionEvent } from "@/lib/api/browserAnnotationTypes";
import type { InputbarSendPayload } from "../../../components/Inputbar/inputbarSendPayload";
import { buildTurnInput } from "../../../utils/buildUserInputSubmitOp";
import { BrowserAnnotationDraftStore } from "./browserAnnotationDrafts";
import {
  lowerBrowserAnnotations,
  submitBrowserAnnotations,
} from "./browserAnnotationSubmission";

function createDraft(
  store: BrowserAnnotationDraftStore,
  id = "annotation-1",
  threadId = "thread-1",
) {
  const event: BrowserAnnotationSelectionEvent = {
    annotationId: id,
    kind: "element",
    scope: "main-frame",
    browserSessionId: "browser-1",
    threadId,
    tabId: "tab-1",
    viewId: "view-1",
    ownerWebContentsId: 1,
    webContentsId: 2,
    windowId: 3,
    pageRevision: 4,
    selection: {
      kind: "element",
      pageUrl: "https://example.test/page",
      pageTitle: "Example",
      frameUrl: "https://example.test/page",
      framePath: "main",
      targetRect: { x: 10, y: 20, width: 100, height: 30 },
      viewportSize: { width: 800, height: 600 },
      scrollPosition: { x: 0, y: 200 },
      devicePixelRatio: 2,
      targetSelector: "#title",
      targetPath: "html > body > h1",
      targetRole: "heading",
      targetText: "Example",
      markerViewportPoint: { x: 10, y: 20 },
    },
  };
  store.create("session-1", event, {
    annotationId: id,
    selection: event.selection,
    screenshot: {
      dataUrl: "data:image/png;base64,aGVsbG8=",
      width: 1600,
      height: 1200,
      kind: "viewport",
      viewportSize: event.selection.viewportSize,
    },
    screenshotStatus: "captured",
    failureReason: null,
  });
  store.update(id, "Make the heading larger", 1);
  return store.get(id)!;
}

const receipt = {
  kind: "start" as const,
  sessionId: "session-1",
  threadId: "thread-1",
  turnId: "turn-1",
  clientUserMessageId: "user-1",
};
const accepted = { kind: "runtime-accepted" as const, receipt };

describe("Browser drafts and canonical input acceptance", () => {
  it("lowers page context and a real image input while preserving the submitted Composer image", async () => {
    const store = new BrowserAnnotationDraftStore();
    createDraft(store);
    let captured: InputbarSendPayload | undefined;
    const result = await submitBrowserAnnotations({
      store,
      sessionId: "session-1",
      threadId: "thread-1",
      isCurrent: () => true,
      payload: {
        composerSubmission: {
          text: "Please fix this",
          attachments: [{ data: "dXNlcg==", mediaType: "image/png" }],
          textElements: [],
          inputMentions: [],
          pathReferences: [],
        },
      },
      send: async (payload) => {
        captured = payload;
        return accepted;
      },
    });
    expect(result.kind).toBe("runtime-accepted");
    const input = buildTurnInput({
      content: captured!.textOverride!,
      images: captured!.images!,
      composerSubmission: captured!.sendOptions!.composerSubmission,
    });
    expect(input[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Please fix this"),
    });
    expect(input[0]).toMatchObject({
      text: expect.stringContaining("Selector: #title"),
    });
    expect(input[0]).toMatchObject({
      text: expect.stringContaining("Make the heading larger"),
    });
    expect(input.filter((item) => item.type === "image")).toHaveLength(2);
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it.each(["rejected", "local-handled", "unknown"] as const)(
    "retains body and screenshot on %s",
    async (kind) => {
      const store = new BrowserAnnotationDraftStore();
      const original = createDraft(store);
      await submitBrowserAnnotations({
        store,
        sessionId: "session-1",
        threadId: "thread-1",
        payload: {},
        isCurrent: () => true,
        send: async () => ({ kind }),
      });
      expect(store.get(original.id)).toMatchObject({
        body: original.body,
        pending: false,
        failure: true,
        capture: original.capture,
      });
    },
  );

  it("retains newer edits and unrelated thread drafts after the captured batch is accepted", async () => {
    const store = new BrowserAnnotationDraftStore();
    const original = createDraft(store);
    const foreign = createDraft(store, "foreign", "thread-2");
    await submitBrowserAnnotations({
      store,
      sessionId: "session-1",
      threadId: "thread-1",
      payload: {},
      isCurrent: () => true,
      send: async () => {
        store.update(original.id, "Newer edit", 2);
        return accepted;
      },
    });
    expect(store.get(original.id)).toMatchObject({
      body: "Newer edit",
      revision: 2,
      pending: false,
    });
    expect(store.get(foreign.id)).toBe(foreign);
  });

  it("rejects explicit foreign ids and stale editor revisions without submitting", async () => {
    const store = new BrowserAnnotationDraftStore();
    const original = createDraft(store);
    createDraft(store, "foreign", "thread-2");
    expect(store.update(original.id, "stale", 0)).toBe(false);
    expect(store.update(original.id, "same revision replaced", 1)).toBe(false);
    const send = vi.fn(async () => accepted);
    const result = await submitBrowserAnnotations({
      store,
      sessionId: "session-1",
      threadId: "thread-1",
      payload: { browserAnnotationIds: ["foreign"] },
      isCurrent: () => true,
      send,
    });
    expect(result.kind).toBe("rejected");
    expect(send).not.toHaveBeenCalled();
  });

  it("does not consume drafts or notify the Composer for a different canonical thread", async () => {
    const store = new BrowserAnnotationDraftStore();
    const original = createDraft(store);
    const onRuntimeAccepted = vi.fn();
    const result = await submitBrowserAnnotations({
      store,
      sessionId: "session-1",
      threadId: "thread-1",
      payload: { onRuntimeAccepted },
      isCurrent: () => true,
      send: async () => ({
        ...accepted,
        receipt: { ...receipt, threadId: "thread-foreign" },
      }),
    });
    expect(result.kind).toBe("rejected");
    expect(store.get(original.id)).toMatchObject({
      pending: false,
      failure: true,
    });
    expect(onRuntimeAccepted).not.toHaveBeenCalled();
  });

  it("honors an observed acceptance when later delivery throws and forbids a duplicate in-flight send", async () => {
    const store = new BrowserAnnotationDraftStore();
    createDraft(store);
    const sendAgain = vi.fn(async () => accepted);
    const onRuntimeAccepted = vi.fn();
    const result = await submitBrowserAnnotations({
      store,
      sessionId: "session-1",
      threadId: "thread-1",
      payload: { onRuntimeAccepted },
      isCurrent: () => true,
      send: async (payload) => {
        const duplicate = await submitBrowserAnnotations({
          store,
          sessionId: "session-1",
          threadId: "thread-1",
          payload: {},
          isCurrent: () => true,
          send: sendAgain,
        });
        expect(duplicate.kind).toBe("rejected");
        payload!.sendOptions!.observer!.onRuntimeAccepted!(receipt);
        throw new Error("Projection failed after acceptance");
      },
    });
    expect(result.kind).toBe("runtime-accepted");
    expect(onRuntimeAccepted).toHaveBeenCalledTimes(1);
    expect(sendAgain).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it("does not invent an image when the capture failed", () => {
    const store = new BrowserAnnotationDraftStore();
    const draft = createDraft(store);
    const lowered = lowerBrowserAnnotations([
      {
        ...draft,
        capture: {
          ...draft.capture,
          screenshot: null,
          screenshotStatus: "failed",
        },
      },
    ]);
    expect(lowered.attachments).toHaveLength(0);
    expect(lowered.text).toContain("No screenshot is attached.");
  });
});
