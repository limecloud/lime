import "@/components/input-kit/composerEditor.testUtils";
import { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerController } from "@/components/input-kit/ComposerController";
import type { BrowserAnnotationSelectionEvent } from "@/lib/api/browserAnnotationTypes";
import { acceptedSubmission } from "../../../hooks/agentSendResult.testFixtures";
import type { RuntimeSubmissionResult } from "../../../hooks/agentSendResult";
import { useBrowserAnnotationSend } from "../../../workspace/useBrowserAnnotationSend";
import {
  BrowserAnnotationDraftStore,
  browserAnnotationDraftsAtom,
} from "../../../workspace/right-surface/browser/browserAnnotationDrafts";
import { useBrowserAnnotationDrafts } from "../../../workspace/right-surface/browser/useBrowserAnnotationDrafts";
import type { InputbarSendHandler } from "../inputbarSendPayload";
import { InputbarCore } from "../components/InputbarCore";
import { buildInputbarCoreCopy } from "../components/inputbarCoreCopy";
import {
  createContextualSuggestionsFixture,
  stubSuggestionGeometry,
} from "../components/contextualSuggestions.testFixtures";
import { useInputbarSend } from "./useInputbarSend";

const copy = buildInputbarCoreCopy((key) => key);
const suggestions = createContextualSuggestionsFixture();
let root: Root;
let container: HTMLDivElement;
let store: BrowserAnnotationDraftStore;
let atoms: ReturnType<typeof createStore>;
let controller: ComposerController;
let onSend: ReturnType<typeof vi.fn<InputbarSendHandler>>;
let onComposerAccepted: ReturnType<typeof vi.fn>;
let onComposerCommitted: ReturnType<typeof vi.fn>;
let clearResources: ReturnType<typeof vi.fn>;

function createDraft(
  id: string,
  body: string,
  sessionId = "session-1",
  threadId = "thread-1",
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
      scrollPosition: { x: 0, y: 0 },
      devicePixelRatio: 2,
      targetSelector: "#title",
      targetPath: "body > h1",
      targetRole: "heading",
      targetText: "Example",
      markerViewportPoint: { x: 10, y: 20 },
    },
  };
  store.create(sessionId, event, {
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
  store.update(id, body, 1);
}

function Harness({
  sessionId = "session-1",
  threadId = "thread-1",
  isLoading = false,
  disabled = false,
}: {
  sessionId?: string | null;
  threadId?: string | null;
  isLoading?: boolean;
  disabled?: boolean;
}) {
  const drafts = useBrowserAnnotationDrafts(sessionId, threadId);
  const hasAdditionalContent = drafts.hasContent && !drafts.pending;
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const browserSend = useBrowserAnnotationSend(onSend, sessionId, threadId);
  const send = useInputbarSend({
    input: snapshot.document.text,
    hasAdditionalContent,
    pendingImages: [],
    pathReferences: [],
    activeCapability: null,
    sessionId,
    isLoading,
    composerController: controller,
    onSend: browserSend,
    onComposerAccepted,
    onComposerCommitted,
    clearPendingImages: clearResources,
    clearActiveCapability: clearResources,
    clearPathReferences: clearResources,
  });
  return (
    <InputbarCore
      uiCopy={copy}
      controller={controller}
      text={snapshot.document.text}
      setText={(text) => controller.setText(text)}
      hasAdditionalContent={hasAdditionalContent}
      onSend={send}
      onToolClick={vi.fn()}
      contextualSuggestions={suggestions}
      sessionId={sessionId}
      isLoading={isLoading}
      disabled={disabled}
    />
  );
}

function render(props: Parameters<typeof Harness>[0] = {}) {
  act(() =>
    root.render(
      <Provider store={atoms}>
        <Harness {...props} />
      </Provider>,
    ),
  );
}
function editor() {
  return container.querySelector<HTMLElement>(
    '[data-testid="composer-editor"][role="textbox"]',
  )!;
}
function sendButton() {
  return container.querySelector<HTMLButtonElement>(
    '[data-testid="send-btn"]',
  )!;
}
async function submit(source: "button" | "enter") {
  await act(async () => {
    if (source === "button") sendButton().click();
    else
      editor().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  stubSuggestionGeometry();
  store = new BrowserAnnotationDraftStore();
  atoms = createStore();
  atoms.set(browserAnnotationDraftsAtom, store);
  controller = new ComposerController();
  onSend = vi.fn<InputbarSendHandler>(async () => acceptedSubmission());
  onComposerAccepted = vi.fn();
  onComposerCommitted = vi.fn();
  clearResources = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Inputbar main submission with Browser annotation content", () => {
  it.each(["button", "enter"] as const)(
    "%s sends a Browser-only draft through the existing text/image adapter without consuming the empty main Composer",
    async (source) => {
      createDraft("own", "Make the heading larger");
      const commit = vi.spyOn(controller, "commit");
      render();
      expect(sendButton().disabled).toBe(false);
      expect(editor().textContent).toBe("");
      await submit(source);
      expect(onSend).toHaveBeenCalledOnce();
      const payload = onSend.mock.calls[0][0]!;
      expect(payload.textOverride).toContain(
        "User comment:\nMake the heading larger",
      );
      expect(payload.images).toEqual([
        { data: "aGVsbG8=", mediaType: "image/png" },
      ]);
      expect(payload.sendOptions).toMatchObject({
        composerTarget: "start",
        targetSessionId: "session-1",
      });
      expect(payload.composerDraft).toBeUndefined();
      expect(payload.composerSubmission).toBeUndefined();
      expect(payload.composerDraftCapture).toBeUndefined();
      expect(payload.composerRestoreToken).toBeUndefined();
      expect(controller.getDocument().text).toBe("");
      expect(controller.getHistory()).toEqual([]);
      expect(commit).not.toHaveBeenCalled();
      expect(onComposerAccepted).not.toHaveBeenCalled();
      expect(onComposerCommitted).not.toHaveBeenCalled();
      expect(clearResources).not.toHaveBeenCalled();
      expect(store.getSnapshot()).toEqual([]);
      expect(sendButton().disabled).toBe(true);
    },
  );

  it("does not enable main submission for empty, whitespace, or foreign-scope Browser drafts", async () => {
    createDraft("empty", "");
    createDraft("whitespace", " \n ");
    createDraft("other-session", "Foreign session", "session-2");
    createDraft("other-thread", "Foreign thread", "session-1", "thread-2");
    render();
    expect(sendButton().disabled).toBe(true);
    await submit("enter");
    expect(onSend).not.toHaveBeenCalled();
    act(() => {
      store.update("empty", "Current content", 2);
    });
    expect(sendButton().disabled).toBe(false);
    render({ sessionId: null });
    expect(sendButton().disabled).toBe(true);
    render({ threadId: null });
    expect(sendButton().disabled).toBe(true);
    render({ sessionId: "session-3", threadId: "thread-3" });
    expect(sendButton().disabled).toBe(true);
  });

  it("continues to settle a nonempty main Composer when it is sent together with Browser annotations", async () => {
    createDraft("own", "Browser comment");
    controller.setText("Main request");
    render();
    await submit("button");
    expect(onSend.mock.calls[0][0]?.textOverride).toContain("Main request");
    expect(onSend.mock.calls[0][0]?.textOverride).toContain(
      "User comment:\nBrowser comment",
    );
    expect(controller.getDocument().text).toBe("");
    expect(onComposerAccepted).toHaveBeenCalledOnce();
    expect(onComposerCommitted).toHaveBeenCalledOnce();
    expect(store.get("own")).toBeUndefined();
  });

  it("respects disabled state even when Browser content exists", async () => {
    createDraft("own", "Comment");
    render({ disabled: true });
    expect(sendButton().disabled).toBe(true);
    await submit("enter");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("keeps Browser drafts and main whitespace after rejection, then permits the main button to retry", async () => {
    createDraft("own", "Retain this comment");
    controller.setText("  ");
    onSend.mockResolvedValueOnce({ kind: "rejected" });
    render();
    await submit("enter");
    expect(store.get("own")).toMatchObject({
      body: "Retain this comment",
      pending: false,
      failure: true,
    });
    expect(controller.getDocument().text).toBe("  ");
    expect(sendButton().disabled).toBe(false);
    await submit("button");
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(store.get("own")).toBeUndefined();
    expect(controller.getDocument().text).toBe("  ");
    expect(onComposerCommitted).not.toHaveBeenCalled();
    expect(clearResources).not.toHaveBeenCalled();
  });

  it("locks a pending Browser-only submission and preserves later main input plus foreign drafts on acceptance", async () => {
    createDraft("own", "Captured comment");
    createDraft("foreign", "Another thread", "session-1", "thread-2");
    let complete!: (result: RuntimeSubmissionResult) => void;
    onSend.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    render();
    await submit("button");
    expect(store.get("own")?.pending).toBe(true);
    expect(sendButton().disabled).toBe(true);
    await submit("enter");
    expect(onSend).toHaveBeenCalledOnce();
    act(() => controller.setText("New main draft while delivery is pending"));
    await act(async () => {
      complete(acceptedSubmission());
    });
    expect(controller.getDocument().text).toBe(
      "New main draft while delivery is pending",
    );
    expect(store.get("own")).toBeUndefined();
    expect(store.get("foreign")?.body).toBe("Another thread");
    expect(onComposerAccepted).not.toHaveBeenCalled();
    expect(onComposerCommitted).not.toHaveBeenCalled();
    expect(clearResources).not.toHaveBeenCalled();
  });

  it("forwards the explicit queue target from the main loading action for Browser-only content", async () => {
    createDraft("own", "Queue this comment");
    onSend.mockResolvedValueOnce({ kind: "rejected" });
    render({ isLoading: true });
    const queue = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${copy.action.queue}"]`,
    )!;
    expect(queue.disabled).toBe(false);
    await act(async () => queue.click());
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend.mock.calls[0][0]?.sendOptions).toMatchObject({
      composerTarget: "queue",
      targetSessionId: "session-1",
    });
    expect(onComposerCommitted).not.toHaveBeenCalled();
  });
});
