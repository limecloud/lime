import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserTabState } from "@/lib/api/browserTab";
import type { BrowserAnnotationEditorNativeEvent } from "@/lib/api/browserAnnotation";
import type { BrowserAnnotationSelectionEvent } from "@/lib/api/browserAnnotationTypes";
import {
  BrowserAnnotationContext,
  type BrowserAnnotationRuntime,
} from "./BrowserAnnotationContext";
import {
  BrowserAnnotationDraftStore,
  browserAnnotationDraftsAtom,
} from "./browserAnnotationDrafts";
import { useBrowserAnnotations } from "./useBrowserAnnotations";

const unmounts: Array<() => void> = [];
function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let mounted = true;
  const view = {
    rerender(next: ReactNode) {
      act(() => root.render(next));
    },
    unmount() {
      if (mounted) {
        act(() => root.unmount());
        container.remove();
        mounted = false;
      }
    },
  };
  view.rerender(node);
  unmounts.push(view.unmount);
  return view;
}
const screen = {
  getByRole(_role: string, _options: { name: string }) {
    const button = document.querySelector<HTMLButtonElement>("button");
    if (!button) throw new Error("Missing annotation control");
    return button;
  },
};
const fireEvent = {
  click(button: HTMLButtonElement) {
    act(() => button.click());
  },
};
async function waitFor(check: () => void) {
  await act(async () => {
    await Promise.resolve();
  });
  check();
}
afterEach(() => {
  unmounts.splice(0).forEach((unmount) => unmount());
});

const api = vi.hoisted(() => ({
  begin: vi.fn(),
  cancel: vi.fn(async () => undefined),
  capture: vi.fn(),
  show: vi.fn(),
  update: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
  selection: undefined as
    | ((event: BrowserAnnotationSelectionEvent) => void)
    | undefined,
  editor: undefined as
    | ((event: BrowserAnnotationEditorNativeEvent) => void)
    | undefined,
  stopEditor: vi.fn(),
}));
vi.mock("@/lib/api/browserAnnotation", () => ({
  beginBrowserAnnotation: api.begin,
  cancelBrowserAnnotation: api.cancel,
  captureBrowserAnnotation: api.capture,
  showBrowserAnnotationEditor: api.show,
  updateBrowserAnnotationEditor: api.update,
  closeBrowserAnnotationEditor: api.close,
  listenBrowserAnnotationSelection: vi.fn(async (callback) => {
    api.selection = callback;
    return () => undefined;
  }),
  listenBrowserAnnotationCancelled: vi.fn(async () => () => undefined),
  listenBrowserAnnotationEditor: vi.fn(async (callback) => {
    api.editor = callback;
    return api.stopEditor;
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const tab = {
  tabId: "tab-1",
  threadId: "thread-1",
  browserSessionId: "browser-1",
  viewId: "view-1",
  ownerWebContentsId: 1,
  webContentsId: 2,
  windowId: 3,
  pageRevision: 4,
  url: "https://example.test/",
  title: "Example",
  selected: true,
} as BrowserTabState;
const selected: BrowserAnnotationSelectionEvent = {
  ...tab,
  annotationId: "annotation-1",
  kind: "element",
  scope: "main-frame",
  selection: {
    kind: "element",
    pageUrl: tab.url,
    pageTitle: tab.title,
    frameUrl: tab.url,
    framePath: "main",
    targetRect: { x: 10, y: 20, width: 100, height: 30 },
    viewportSize: { width: 800, height: 600 },
    scrollPosition: { x: 0, y: 0 },
    devicePixelRatio: 1,
    targetSelector: "#title",
    targetPath: null,
    targetRole: null,
    targetText: "Example",
    markerViewportPoint: { x: 10, y: 20 },
  },
};

function Harness({
  currentTab = tab,
  runtime,
}: {
  currentTab?: BrowserTabState;
  runtime: BrowserAnnotationRuntime;
}) {
  return (
    <BrowserAnnotationContext.Provider value={runtime}>
      <Controls currentTab={currentTab} />
    </BrowserAnnotationContext.Provider>
  );
}
function Controls({ currentTab }: { currentTab: BrowserTabState }) {
  const state = useBrowserAnnotations({
    selected: currentTab,
    active: true,
    onError: () => undefined,
  });
  return (
    <button onClick={() => void state.begin()} aria-pressed={state.selecting}>
      Annotate
    </button>
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function setup() {
  const state = createStore();
  const drafts = new BrowserAnnotationDraftStore();
  state.set(browserAnnotationDraftsAtom, drafts);
  const runtime: BrowserAnnotationRuntime = {
    sessionId: "session-1",
    threadId: "thread-1",
    workspaceId: "workspace-1",
    isSending: false,
    send: vi.fn(async () => ({ kind: "rejected" })),
  };
  const view = render(
    <Provider store={state}>
      <Harness runtime={runtime} />
    </Provider>,
  );
  return { state, drafts, runtime, view };
}

async function select() {
  fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
  await waitFor(() => expect(api.begin).toHaveBeenCalled());
  await act(async () => {
    api.selection!(selected);
  });
  await waitFor(() => expect(api.show).toHaveBeenCalled());
}
function editorEvent(
  action: BrowserAnnotationEditorNativeEvent["action"],
  body = "Make it larger",
  revision = 1,
): BrowserAnnotationEditorNativeEvent {
  const presentation = api.show.mock.calls.at(-1)![1];
  return {
    ...tab,
    editorId: presentation.editorId,
    draftId: selected.annotationId,
    annotationId: selected.annotationId,
    generation: 5,
    action,
    body,
    revision,
  };
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  api.begin.mockResolvedValue(selected);
  api.capture.mockResolvedValue({
    annotationId: selected.annotationId,
    selection: selected.selection,
    screenshot: null,
    screenshotStatus: "failed",
    failureReason: "capture failed",
  });
  api.show.mockImplementation(async (_tabId, presentation) => ({
    editorId: presentation.editorId,
    generation: 5,
    visible: true,
  }));
  api.update.mockResolvedValue(undefined);
});

describe("Browser native selection and trusted editor wiring", () => {
  it("saves the selected page context and body, with an exact editor close", async () => {
    const { drafts } = setup();
    await select();
    await act(async () => {
      api.editor!(editorEvent("change"));
      api.editor!(editorEvent("save"));
    });
    expect(drafts.get(selected.annotationId)).toMatchObject({
      body: "Make it larger",
      event: selected,
      capture: { screenshot: null, screenshotStatus: "failed" },
    });
    expect(api.close).toHaveBeenCalledWith(tab.tabId, expect.any(String), 5);
  });

  it("drops a capture arriving after the visible tab changes", async () => {
    const capture = deferred<unknown>();
    api.capture.mockReturnValue(capture.promise);
    const { state, drafts, runtime, view } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
    await waitFor(() => expect(api.begin).toHaveBeenCalled());
    act(() => api.selection!(selected));
    view.rerender(
      <Provider store={state}>
        <Harness
          runtime={runtime}
          currentTab={{
            ...tab,
            tabId: "tab-2",
            viewId: "view-2",
            webContentsId: 10,
          }}
        />
      </Provider>,
    );
    await act(async () =>
      capture.resolve({
        annotationId: selected.annotationId,
        selection: selected.selection,
        screenshot: null,
        screenshotStatus: "failed",
        failureReason: "failed",
      }),
    );
    expect(drafts.getSnapshot()).toHaveLength(0);
    expect(api.show).not.toHaveBeenCalled();
  });

  it("rechecks the current session after the pending ACK before sending", async () => {
    const { state, runtime, view } = setup();
    await select();
    const ack = deferred<void>();
    api.update.mockReturnValueOnce(ack.promise);
    act(() => api.editor!(editorEvent("send")));
    view.rerender(
      <Provider store={state}>
        <Harness
          runtime={{ ...runtime, sessionId: "session-2", threadId: "thread-2" }}
          currentTab={{ ...tab, threadId: "thread-2" }}
        />
      </Provider>,
    );
    await act(async () => ack.resolve());
    expect(runtime.send).not.toHaveBeenCalled();
    expect(api.close).toHaveBeenCalledWith(tab.tabId, expect.any(String), 5);
  });

  it("keeps listening for a final trusted close flush after its workspace unmounts", async () => {
    const { drafts, view } = setup();
    await select();
    const close = editorEvent("close", "Final text from Composer flush", 2);
    view.unmount();
    expect(api.stopEditor).not.toHaveBeenCalled();
    act(() => api.editor!(close));
    expect(drafts.get(selected.annotationId)?.body).toBe(close.body);
    expect(api.stopEditor).toHaveBeenCalledTimes(1);
  });

  it("retains the final close flush when the native route has already been revoked", async () => {
    api.close.mockRejectedValueOnce(
      new Error("Browser tab owner is unavailable"),
    );
    const { drafts, view } = setup();
    await select();
    const close = editorEvent("close", "Preserved after tab removal", 3);
    await act(async () => view.unmount());
    expect(api.stopEditor).not.toHaveBeenCalled();
    act(() => api.editor!(close));
    expect(drafts.get(selected.annotationId)?.body).toBe(close.body);
    expect(api.stopEditor).toHaveBeenCalledTimes(1);
  });

  it("closes a late show receipt from the previous session and still accepts its final body", async () => {
    const receipt = deferred<{
      editorId: string;
      generation: number;
      visible: boolean;
    }>();
    api.show.mockReturnValueOnce(receipt.promise);
    const { state, runtime, view, drafts } = setup();
    await select();
    const close = editorEvent("close", "Previous session body", 2);
    const oldListener = api.editor!;
    view.rerender(
      <Provider store={state}>
        <Harness runtime={{ ...runtime, sessionId: "session-2" }} />
      </Provider>,
    );
    await act(async () =>
      receipt.resolve({
        editorId: close.editorId,
        generation: 5,
        visible: true,
      }),
    );
    expect(api.close).toHaveBeenCalledWith(tab.tabId, close.editorId, 5);
    act(() => oldListener(close));
    expect(drafts.get(selected.annotationId)?.body).toBe(close.body);
    expect(runtime.send).not.toHaveBeenCalled();
  });

  it("treats a second picker click as cancellation even while begin is pending", async () => {
    const begin = deferred<BrowserAnnotationSelectionEvent>();
    api.begin.mockReturnValueOnce(begin.promise);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
    await waitFor(() => expect(api.begin).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
    await act(async () => begin.resolve(selected));
    expect(api.begin).toHaveBeenCalledTimes(1);
    expect(api.cancel).toHaveBeenCalledWith(tab.tabId, selected.annotationId);
    expect(api.show).not.toHaveBeenCalled();
  });
});
