import { act } from "react";
import { Provider } from "jotai";
import { describe, expect, it } from "vitest";
import type { BrowserTabState } from "@/lib/api/browserTab";
import type { BrowserAnnotationSelectionEvent } from "@/lib/api/browserAnnotationTypes";
import {
  api,
  tab,
  selected,
  Harness,
  render,
  setup,
  select,
  screen,
  fireEvent,
  waitFor,
  deferred,
  editorEvent,
} from "./browserAnnotationHook.testFixture";

describe("Browser native selection and trusted editor wiring", () => {
  it("keeps manual images with the original capture through native close and reopening", async () => {
    const { drafts } = setup();
    await select();
    const originalCapture = drafts.get(selected.annotationId)!.capture;
    const attachedImages = [
      {
        id: "manual-image",
        dataUrl: "data:image/png;base64,YWJj",
        filename: "reference.png",
      },
    ];
    await act(async () => {
      api.editor!({
        ...editorEvent("change", "Comment with image", 1),
        attachedImages,
      });
      api.editor!({
        ...editorEvent("close", "Comment with image", 1),
        attachedImages,
      });
    });
    expect(drafts.get(selected.annotationId)).toMatchObject({
      body: "Comment with image",
      attachedImages,
      revision: 1,
    });
    expect(drafts.get(selected.annotationId)!.capture).toBe(originalCapture);
    act(() => drafts.focus(selected.annotationId));
    await waitFor(() => expect(api.show).toHaveBeenCalledTimes(2));
    expect(api.show.mock.calls.at(-1)![1]).toMatchObject({
      body: "Comment with image",
      attachedImages,
      revision: 1,
    });
    expect(api.capture).toHaveBeenCalledTimes(1);
  });

  it("keeps mode after capture and restarts only after the trusted editor closes", async () => {
    const { drafts } = setup();
    await select();
    expect(
      screen
        .getByRole("button", { name: "Annotate" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(api.begin).toHaveBeenCalledTimes(1);
    await act(async () => {
      api.editor!(editorEvent("close", "Saved body", 2));
    });
    expect(api.begin).toHaveBeenCalledTimes(2);
    expect(drafts.get(selected.annotationId)?.body).toBe("Saved body");
  });

  it("remains enabled through loading and acquires a fresh picker on the ready revision", async () => {
    const { state, runtime, view } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
    await waitFor(() => expect(api.begin).toHaveBeenCalledTimes(1));
    const next = { ...tab, pageRevision: 5, isLoading: true };
    view.rerender(
      <Provider store={state}>
        <Harness runtime={runtime} currentTab={next} />
      </Provider>,
    );
    expect(api.cancel).toHaveBeenCalledWith(tab.tabId, selected.annotationId);
    expect(
      screen
        .getByRole("button", { name: "Annotate" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(api.begin).toHaveBeenCalledTimes(1);
    await act(async () =>
      view.rerender(
        <Provider store={state}>
          <Harness
            runtime={runtime}
            currentTab={{ ...next, pageRevision: 6, isLoading: false }}
          />
        </Provider>,
      ),
    );
    expect(api.begin).toHaveBeenCalledTimes(2);
    act(() => api.selection!(selected));
    expect(api.capture).not.toHaveBeenCalled();
  });

  it("restores each tab's own intent after pane hiding and tab switching without stealing Agent control", async () => {
    const { state, runtime, view } = setup();
    const show = (currentTab = tab, active = true) =>
      view.rerender(
        <Provider store={state}>
          <Harness runtime={runtime} currentTab={currentTab} active={active} />
        </Provider>,
      );
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
    await waitFor(() => expect(api.begin).toHaveBeenCalledTimes(1));
    await act(async () => show(tab, false));
    await act(async () =>
      show({ ...tab, tabId: "other", viewId: "other", webContentsId: 44 }),
    );
    expect(
      screen
        .getByRole("button", { name: "Annotate" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(api.begin).toHaveBeenCalledTimes(1);
    await act(async () => show({ ...tab, controlOwner: "agent" }));
    expect(api.begin).toHaveBeenCalledTimes(1);
    await act(async () => show({ ...tab, controlOwner: "user" }));
    expect(api.begin).toHaveBeenCalledTimes(2);
    await act(async () => show(tab, false));
    await act(async () => show(tab));
    expect(api.begin).toHaveBeenCalledTimes(3);
  });

  it("exits on Escape and never restarts after a later page update", async () => {
    const { state, runtime, view } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
    await waitFor(() => expect(api.begin).toHaveBeenCalledTimes(1));
    await act(async () => api.cancelled!({ ...selected, reason: "escape" }));
    expect(
      screen
        .getByRole("button", { name: "Annotate" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    await act(async () =>
      view.rerender(
        <Provider store={state}>
          <Harness runtime={runtime} currentTab={{ ...tab, pageRevision: 5 }} />
        </Provider>,
      ),
    );
    expect(api.begin).toHaveBeenCalledTimes(1);
  });

  it("retains only mode intent over an unmount and cancels the old pending begin receipt", async () => {
    const pending = deferred<BrowserAnnotationSelectionEvent>();
    api.begin.mockReturnValueOnce(pending.promise);
    const { state, runtime, view } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
    await waitFor(() => expect(api.begin).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => pending.resolve(selected));
    expect(api.cancel).toHaveBeenCalledWith(tab.tabId, selected.annotationId);
    render(
      <Provider store={state}>
        <Harness runtime={runtime} />
      </Provider>,
    );
    await waitFor(() => expect(api.begin).toHaveBeenCalledTimes(2));
    expect(api.show).not.toHaveBeenCalled();
  });

  it("keeps original capture and body while accepting only a current presentation activation after Agent release", async () => {
    const { view, state, runtime, drafts } = setup();
    await select();
    await act(async () => {
      api.editor!(editorEvent("change"));
      api.editor!(editorEvent("close"));
    });
    const original = structuredClone(drafts.get(selected.annotationId));
    const showCount = api.show.mock.calls.length;
    const currentTab = {
      ...tab,
      pageRevision: 6,
      controlOwner: "agent" as const,
    };
    const rerender = (next: BrowserTabState) =>
      view.rerender(
        <Provider store={state}>
          <Harness runtime={runtime} currentTab={next} />
        </Provider>,
      );
    rerender(currentTab);
    const activation = { ...selected, presentationPageRevision: 6 };
    await act(async () => api.activate!(activation));
    expect(api.show).toHaveBeenCalledTimes(showCount);
    rerender({ ...currentTab, controlOwner: "released" });
    await act(async () =>
      api.activate!({ ...activation, presentationPageRevision: 4 }),
    );
    await act(async () => api.activate!({ ...activation, pageRevision: 5 }));
    expect(api.show).toHaveBeenCalledTimes(showCount);
    await act(async () => api.activate!(activation));
    expect(api.show).toHaveBeenCalledTimes(showCount + 1);
    expect(api.show.mock.calls.at(-1)![1]).toMatchObject({
      body: "Make it larger",
      revision: 1,
    });
    expect(drafts.get(selected.annotationId)).toEqual(original);
    expect(api.capture).toHaveBeenCalledTimes(1);
  });

  it("retains a saved marker, reopens only its matching live draft and removes it with the draft", async () => {
    const { drafts } = setup();
    await select();
    expect(api.cancel).not.toHaveBeenCalled();
    const firstShowCount = api.show.mock.calls.length;
    await act(async () =>
      api.activate!({
        ...selected,
        presentationPageRevision: selected.pageRevision,
      }),
    );
    expect(api.show).toHaveBeenCalledTimes(firstShowCount);
    await act(async () => {
      api.editor!(editorEvent("change"));
      api.editor!(editorEvent("close"));
    });
    const shows = api.show.mock.calls.length;
    await act(async () =>
      api.activate!({
        ...selected,
        pageRevision: selected.pageRevision + 1,
        presentationPageRevision: selected.pageRevision + 1,
      }),
    );
    expect(api.show).toHaveBeenCalledTimes(shows);
    await act(async () =>
      api.activate!({
        ...selected,
        presentationPageRevision: selected.pageRevision,
      }),
    );
    expect(api.show).toHaveBeenCalledTimes(shows + 1);
    expect(api.show.mock.calls.at(-1)![1]).toMatchObject({
      body: "Make it larger",
      revision: 1,
    });
    act(() => {
      drafts.remove(selected.annotationId);
    });
    expect(api.cancel).toHaveBeenCalledWith(tab.tabId, selected.annotationId);
    await act(async () =>
      api.activate!({
        ...selected,
        presentationPageRevision: selected.pageRevision,
      }),
    );
    expect(api.show).toHaveBeenCalledTimes(shows + 1);
  });
  it("explicitly exits mode while keeping the final trusted editor flush and original capture", async () => {
    const { drafts } = setup();
    await select();
    const original = structuredClone(
      drafts.get(selected.annotationId)!.capture,
    );
    await act(async () => api.editor!(editorEvent("change", "Before exit", 1)));
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[data-testid="annotation-exit"]')!
        .click(),
    );
    expect(
      screen
        .getByRole("button", { name: "Annotate" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(api.close).toHaveBeenCalledWith(tab.tabId, expect.any(String), 5);
    await act(async () =>
      api.editor!(editorEvent("close", "Final flushed body", 2)),
    );
    expect(drafts.get(selected.annotationId)).toMatchObject({
      body: "Final flushed body",
      revision: 2,
      capture: original,
    });
    expect(api.begin).toHaveBeenCalledTimes(1);
  });

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

  it("does not let an old runtime's pending capture block or clear the new runtime's picker", async () => {
    const oldCapture = deferred<unknown>();
    const newCapture = deferred<unknown>();
    api.capture.mockImplementation((tabId: string) =>
      tabId === tab.tabId ? oldCapture.promise : newCapture.promise,
    );
    const { state, drafts, runtime, view } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
    await waitFor(() => expect(api.begin).toHaveBeenCalledTimes(1));
    act(() => api.selection!(selected));
    const nextTab = {
      ...tab,
      threadId: "thread-2",
      browserSessionId: "browser-2",
      tabId: "tab-2",
      viewId: "view-2",
      webContentsId: 10,
    };
    const nextSelection = {
      ...selected,
      ...nextTab,
      annotationId: "annotation-2",
    };
    api.begin.mockResolvedValue(nextSelection);
    await act(async () =>
      view.rerender(
        <Provider store={state}>
          <Harness
            runtime={{
              ...runtime,
              sessionId: "session-2",
              threadId: "thread-2",
            }}
            currentTab={nextTab}
          />
        </Provider>,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
    await waitFor(() => expect(api.begin).toHaveBeenCalledTimes(2));
    act(() => api.selection!(nextSelection));
    const captureResult = (event: BrowserAnnotationSelectionEvent) => ({
      annotationId: event.annotationId,
      selection: event.selection,
      screenshot: null,
      screenshotStatus: "failed",
      failureReason: "capture failed",
    });
    await act(async () => oldCapture.resolve(captureResult(selected)));
    expect(drafts.getSnapshot()).toHaveLength(0);
    expect(api.show).not.toHaveBeenCalled();
    expect(api.begin).toHaveBeenCalledTimes(2);
    await act(async () => newCapture.resolve(captureResult(nextSelection)));
    expect(drafts.getSnapshot()).toHaveLength(1);
    expect(api.show).toHaveBeenCalledTimes(1);
    expect(api.show.mock.calls[0]).toMatchObject([
      nextTab.tabId,
      { annotationId: nextSelection.annotationId },
    ]);
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

  it("retains the saved marker on unmount and releases it if the draft is removed while the pane is absent", async () => {
    const { drafts, view } = setup();
    await select();
    const close = editorEvent("close", "Saved while hidden", 2);
    view.unmount();
    expect(api.cancel).not.toHaveBeenCalled();
    act(() => api.editor!(close));
    expect(drafts.get(selected.annotationId)?.body).toBe(close.body);
    act(() => {
      drafts.remove(selected.annotationId);
    });
    expect(api.cancel).toHaveBeenCalledTimes(1);
    expect(api.cancel).toHaveBeenCalledWith(tab.tabId, selected.annotationId);
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
