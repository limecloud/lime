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
  designSnapshot?: import("@/lib/api/browserDesign").BrowserDesignSnapshot,
) {
  const event: BrowserAnnotationSelectionEvent = {
    annotationId: id,
    kind: "element",
    scope: "page",
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
      framePath: [],
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
    ...(designSnapshot ? { designSnapshot } : {}),
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

it("submits a design-only draft through the existing canonical text/image path and retains rejected changes", async () => {
  const store = new BrowserAnnotationDraftStore();
  const seed = {
    elementTagName: "h1",
    declarations: [
      { property: "font-size", previousValue: "16px", value: "16px" },
    ],
    text: { previousValue: "Original", value: "Original" },
  };
  createDraft(store, "design", "thread-1", seed);
  const design = {
    declarations: [
      { property: "font-size", previousValue: "16px", value: "24px" },
    ],
    text: { previousValue: "Original", value: "Revised" },
  };
  expect(store.update("design", "", 2, [], design)).toBe(true);
  expect(store.capture("session-1", "thread-1")).toHaveLength(1);
  const lowered = lowerBrowserAnnotations(
    store.capture("session-1", "thread-1"),
  );
  expect(lowered.text).toContain('CSS font-size: "16px" -> "24px"');
  expect(lowered.text).toContain('Text: "Original" -> "Revised"');
  expect(lowered.text).toContain("source code or design tokens");
  expect(lowered.text).not.toContain("data-browser-design-");
  const send = vi.fn(async (payload: InputbarSendPayload) => {
    expect(payload.textOverride).toContain("Design changes");
    return { kind: "rejected" as const };
  });
  const result = await submitBrowserAnnotations({
    store,
    sessionId: "session-1",
    threadId: "thread-1",
    payload: { browserAnnotationIds: ["design"] },
    send,
    isCurrent: () => true,
  });
  expect(result.kind).toBe("rejected");
  expect(store.get("design")).toMatchObject({
    designChange: design,
    pending: false,
    failure: true,
  });
  expect(send.mock.calls[0][0].textOverride).toContain(
    'CSS font-size: "16px" -> "24px"',
  );
  expect(store.update("design", "", 2, [], null)).toBe(false);
});

describe("Browser drafts and canonical input acceptance", () => {
  it("lowers Composer images, the original screenshot, then manual images through the same submission", async () => {
    const store = new BrowserAnnotationDraftStore();
    const draft = createDraft(store);
    const images = [
      {
        id: "manual",
        dataUrl: "data:image/gif;base64,YWJj",
        filename: "参考.gif",
      },
    ];
    store.update(draft.id, draft.body, 2, images);
    const send = vi.fn(async (payload: InputbarSendPayload) => {
      expect(payload.images).toEqual([
        { data: "composer", mediaType: "image/jpeg" },
        { data: "aGVsbG8=", mediaType: "image/png" },
        { data: "YWJj", mediaType: "image/gif" },
      ]);
      expect(payload.textOverride).toContain('"参考.gif"');
      payload.sendOptions?.observer?.onRuntimeAccepted?.(receipt);
      return accepted;
    });
    expect(
      await submitBrowserAnnotations({
        store,
        sessionId: "session-1",
        threadId: "thread-1",
        payload: {
          browserAnnotationIds: [draft.id],
          images: [{ data: "composer", mediaType: "image/jpeg" }],
        },
        send,
        isCurrent: () => true,
      }),
    ).toEqual(accepted);
    expect(send).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toEqual([]);
  });

  it("keeps a newer image revision when an older image batch is accepted", async () => {
    const store = new BrowserAnnotationDraftStore();
    const draft = createDraft(store);
    const oldImage = { id: "old-image", dataUrl: "data:image/png;base64,YQ==" };
    const newImage = { id: "new-image", dataUrl: "data:image/png;base64,Yg==" };
    store.update(draft.id, draft.body, 2, [oldImage]);
    const send = vi.fn(async (payload: InputbarSendPayload) => {
      expect(store.update(draft.id, draft.body, 2, [newImage])).toBe(false);
      expect(store.update(draft.id, draft.body, 3, [newImage])).toBe(true);
      payload.sendOptions?.observer?.onRuntimeAccepted?.(receipt);
      return accepted;
    });
    await submitBrowserAnnotations({
      store,
      sessionId: "session-1",
      threadId: "thread-1",
      payload: { browserAnnotationIds: [draft.id] },
      send,
      isCurrent: () => true,
    });
    expect(store.get(draft.id)).toMatchObject({
      revision: 3,
      attachedImages: [newImage],
      pending: false,
      failure: false,
    });
    expect(
      lowerBrowserAnnotations([store.get(draft.id)!]).attachments.at(-1),
    ).toEqual({ data: "Yg==", mediaType: "image/png" });
  });

  it("keeps manual images on rejection and does not let a body-only edit erase them", async () => {
    const store = new BrowserAnnotationDraftStore();
    const draft = createDraft(store);
    const images = [{ id: "manual", dataUrl: "data:image/webp;base64,YWJj" }];
    store.update(draft.id, draft.body, 2, images);
    store.update(draft.id, "Revised comment", 3);
    const send = vi.fn(async () => ({ kind: "rejected" as const }));
    await submitBrowserAnnotations({
      store,
      sessionId: "session-1",
      threadId: "thread-1",
      payload: {},
      send,
      isCurrent: () => true,
    });
    expect(store.get(draft.id)).toMatchObject({
      body: "Revised comment",
      revision: 3,
      attachedImages: images,
      pending: false,
      failure: true,
    });
  });

  it("discards only the confirmed immutable snapshot and releases its markers once", () => {
    const release = vi.fn();
    const store = new BrowserAnnotationDraftStore(release);
    const first = createDraft(store);
    const second = createDraft(store, "second");
    expect(store.discard([first, first])).toBe(false);
    store.update(second.id, "Updated during confirmation", 2);
    expect(store.discard([first, second])).toBe(false);
    expect(store.getSnapshot()).toHaveLength(2);
    const updated = store.get(second.id)!;
    expect(store.begin([updated])).toBe(true);
    expect(store.discard([first, store.get(second.id)!])).toBe(false);
    store.finish([updated], false);
    const third = createDraft(store, "new-after-confirmation");
    expect(store.discard([first, store.get(second.id)!])).toBe(true);
    expect(store.getSnapshot()).toEqual([third]);
    expect(release.mock.calls.map((call) => call[0].id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(store.discard([first])).toBe(false);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("releases native presentation exactly when removal or accepted consumption removes a draft", () => {
    const release = vi.fn();
    const store = new BrowserAnnotationDraftStore(release);
    const first = createDraft(store);
    const second = createDraft(store, "second");
    expect(store.begin([first])).toBe(true);
    expect(store.remove(first.id)).toBe(false);
    store.finish([first], false);
    expect(release).not.toHaveBeenCalled();
    const retry = store.get(first.id)!;
    store.begin([retry]);
    store.finish([retry], true);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0][0].id).toBe(first.id);
    expect(store.remove(second.id)).toBe(true);
    expect(release).toHaveBeenCalledTimes(2);
    expect(store.remove(second.id)).toBe(false);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("delivers nested frame and shadow locators through the existing text input", () => {
    const store = new BrowserAnnotationDraftStore();
    const draft = createDraft(store);
    draft.event.selection.frameUrl = "https://example.test/frame";
    draft.event.selection.framePath = [
      { selector: "#outer", shadowHosts: [] },
      { selector: "#inner", shadowHosts: ["#host"] },
    ];
    const lowered = lowerBrowserAnnotations([draft]);
    expect(lowered.text).toContain(
      'Frame: https://example.test/frame [{"selector":"#outer","shadowHosts":[]},{"selector":"#inner","shadowHosts":["#host"]}]',
    );
    expect(lowered.attachments).toHaveLength(1);
  });
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

it.each(["captured", "timeout", "failed"] as const)(
  "atomically replaces the initial screenshot with a %s first-commit result at the same revision",
  async (screenshotStatus) => {
    const store = new BrowserAnnotationDraftStore();
    const draft = createDraft(store);
    const capture = {
      ...draft.capture,
      screenshotStatus,
      screenshot:
        screenshotStatus === "captured"
          ? {
              ...draft.capture.screenshot!,
              dataUrl: "data:image/png;base64,bmV3",
            }
          : null,
      failureReason: screenshotStatus === "captured" ? null : "capture-failed",
    };
    expect(
      store.update(
        draft.id,
        draft.body,
        draft.revision,
        [],
        undefined,
        capture,
      ),
    ).toBe(true);
    expect(store.get(draft.id)!.capture).toEqual(capture);
    const send = vi.fn(async (payload: InputbarSendPayload) => {
      expect(payload.images?.map((image) => image.data) ?? []).toEqual(
        screenshotStatus === "captured" ? ["bmV3"] : [],
      );
      return accepted;
    });
    await submitBrowserAnnotations({
      store,
      sessionId: "session-1",
      threadId: "thread-1",
      payload: { browserAnnotationIds: [draft.id] },
      send,
      isCurrent: () => true,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.get(draft.id)).toBeUndefined();
  },
);

it("refuses late or foreign capture results without replacing newer content or immutable selection", () => {
  const store = new BrowserAnnotationDraftStore();
  const draft = createDraft(store);
  store.update(draft.id, "New revision", 2);
  expect(
    store.update(draft.id, draft.body, 1, [], undefined, draft.capture),
  ).toBe(false);
  for (const capture of [
    { ...draft.capture, annotationId: "foreign" },
    {
      ...draft.capture,
      selection: { ...draft.event.selection, targetText: "foreign" },
    },
    { ...draft.capture, screenshotStatus: "failed" as const },
    {
      ...draft.capture,
      screenshot: {
        ...draft.capture.screenshot!,
        viewportSize: { width: 0, height: 1 },
      },
    },
  ])
    expect(
      store.update(draft.id, "New revision", 2, [], undefined, capture),
    ).toBe(false);
  expect(store.get(draft.id)!.body).toBe("New revision");
  expect(store.get(draft.id)!.capture).toBe(draft.capture);
});
