import { act } from "react";
import { Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import {
  api,
  tab,
  selected,
  Harness,
  setup,
  select,
  screen,
  fireEvent,
  waitFor,
  deferred,
  editorEvent,
} from "./browserAnnotationHook.testFixture";
import type { BrowserAnnotationSelectionEvent } from "@/lib/api/browserAnnotationTypes";
import { BrowserAnnotationAccessory } from "./BrowserAnnotationAccessory";
import { BrowserAnnotationContext } from "./BrowserAnnotationContext";

const input = (overrides = {}) => ({
  ...selected,
  suspended: true,
  addModifierPressed: true,
  ...overrides,
});
const visible = () => ({
  suspended: document.querySelector("output")!.getAttribute("data-suspended"),
  add: document.querySelector("output")!.getAttribute("data-add-modifier"),
});
const clickAdd = () =>
  act(async () =>
    document
      .querySelector<HTMLButtonElement>('[data-testid="annotation-add"]')!
      .click(),
  );

describe("Browser annotation transient input projection", () => {
  it("matches a begin receipt before publishing queued input and rejects old identities", async () => {
    const receipt = deferred<BrowserAnnotationSelectionEvent>();
    api.begin.mockReturnValueOnce(receipt.promise);
    const { state, runtime, view } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
    await waitFor(() => expect(api.begin).toHaveBeenCalledOnce());
    act(() => api.input!(input()));
    expect(visible()).toEqual({ suspended: "false", add: "false" });
    await act(async () => receipt.resolve(selected));
    expect(visible()).toEqual({ suspended: "true", add: "true" });
    act(() =>
      api.input!(
        input({
          annotationId: "old",
          suspended: false,
          addModifierPressed: false,
        }),
      ),
    );
    act(() =>
      api.input!(
        input({ pageRevision: 1, suspended: false, addModifierPressed: false }),
      ),
    );
    expect(visible()).toEqual({ suspended: "true", add: "true" });
    view.rerender(
      <Provider store={state}>
        <Harness runtime={runtime} active={false} />
      </Provider>,
    );
    act(() => api.input!(input()));
    expect(visible()).toEqual({ suspended: "false", add: "false" });
  });

  it("drops queued state for another receipt and resets when a selection is captured", async () => {
    const receipt = deferred<BrowserAnnotationSelectionEvent>();
    api.begin.mockReturnValueOnce(receipt.promise);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
    await waitFor(() => expect(api.begin).toHaveBeenCalledOnce());
    act(() => api.input!(input({ annotationId: "old" })));
    await act(async () => receipt.resolve(selected));
    expect(visible()).toEqual({ suspended: "false", add: "false" });
    act(() => api.input!(input()));
    expect(visible().suspended).toBe("true");
    await act(async () => api.selection!(selected));
    act(() => api.input!(input()));
    expect(visible()).toEqual({ suspended: "false", add: "false" });
  });
});

describe("Browser annotations added to the existing Composer", () => {
  it("exits once, hands focus to the renderer and retains final editor text and original capture without sending", async () => {
    const { drafts, runtime } = setup();
    await select();
    act(() => api.editor!(editorEvent("change", "Original body")));
    const capture = structuredClone(drafts.get(selected.annotationId)?.capture);
    const focus = vi.fn(() => true);
    drafts.subscribeComposerFocus(focus);
    await clickAdd();
    expect(api.focus).toHaveBeenCalledExactlyOnceWith(tab);
    expect(focus).toHaveBeenCalledExactlyOnceWith(
      runtime.sessionId,
      runtime.threadId,
    );
    act(() => api.editor!(editorEvent("close", "Final trusted flush", 2)));
    expect(drafts.get(selected.annotationId)).toMatchObject({
      body: "Final trusted flush",
      capture,
      pending: false,
    });
    expect(runtime.send).not.toHaveBeenCalled();
    expect(visible()).toEqual({ suspended: "false", add: "false" });
  });

  it("does not focus another session after a delayed native receipt", async () => {
    const receipt = deferred<void>();
    api.focus.mockReturnValueOnce(receipt.promise);
    const { state, drafts, runtime, view } = setup();
    await select();
    act(() => api.editor!(editorEvent("change")));
    const focus = vi.fn(() => true);
    drafts.subscribeComposerFocus(focus);
    act(() =>
      document
        .querySelector<HTMLButtonElement>('[data-testid="annotation-add"]')!
        .click(),
    );
    await waitFor(() => expect(api.focus).toHaveBeenCalledOnce());
    view.rerender(
      <Provider store={state}>
        <Harness runtime={{ ...runtime, sessionId: "other" }} />
      </Provider>,
    );
    await act(async () => receipt.resolve());
    expect(focus).not.toHaveBeenCalled();
    expect(drafts.get(selected.annotationId)?.body).toBe("Make it larger");
    expect(runtime.send).not.toHaveBeenCalled();
  });

  it("deduplicates a pending add and does not focus a draft removed before native acknowledgment", async () => {
    const receipt = deferred<void>();
    api.focus.mockReturnValueOnce(receipt.promise);
    const { drafts, runtime } = setup();
    await select();
    act(() => api.editor!(editorEvent("change")));
    const focus = vi.fn(() => true);
    drafts.subscribeComposerFocus(focus);
    await clickAdd();
    await clickAdd();
    expect(api.focus).toHaveBeenCalledOnce();
    act(() => drafts.remove(selected.annotationId));
    await act(async () => receipt.resolve());
    expect(focus).not.toHaveBeenCalled();
    expect(runtime.send).not.toHaveBeenCalled();
  });

  it("can add saved drafts during Agent control without creating another picker or turn", async () => {
    const { state, drafts, runtime, view } = setup();
    await select();
    act(() => api.editor!(editorEvent("change")));
    const agentTab = {
      ...tab,
      pageRevision: tab.pageRevision + 1,
      controlOwner: "agent" as const,
    };
    view.rerender(
      <Provider store={state}>
        <Harness runtime={runtime} currentTab={agentTab} />
      </Provider>,
    );
    const beginCount = api.begin.mock.calls.length;
    await clickAdd();
    expect(api.focus).toHaveBeenCalledExactlyOnceWith(agentTab);
    expect(api.begin).toHaveBeenCalledTimes(beginCount);
    expect(runtime.send).not.toHaveBeenCalled();
    expect(drafts.get(selected.annotationId)?.body).toBe("Make it larger");
  });

  it("delivers Composer focus only to the mounted matching scope and never replays it", async () => {
    const { state, drafts, runtime, view } = setup();
    await select();
    act(() => api.editor!(editorEvent("change")));
    const focus = vi.fn(() =>
      document
        .querySelector<HTMLTextAreaElement>('[data-testid="main-composer"]')!
        .focus(),
    );
    const accessory = () => (
      <Provider store={state}>
        <BrowserAnnotationContext.Provider value={runtime}>
          <textarea data-testid="main-composer" />
          <BrowserAnnotationAccessory onFocusComposer={focus} />
        </BrowserAnnotationContext.Provider>
      </Provider>
    );
    view.rerender(accessory());
    act(() => {
      drafts.focusComposer("other", runtime.threadId);
      drafts.focusComposer(runtime.sessionId, "other");
    });
    expect(focus).not.toHaveBeenCalled();
    act(() => drafts.focusComposer(runtime.sessionId, runtime.threadId));
    expect(focus).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="main-composer"]'),
    );
    view.rerender(<div />);
    act(() => drafts.focusComposer(runtime.sessionId, runtime.threadId));
    view.rerender(accessory());
    expect(focus).toHaveBeenCalledOnce();
    act(() => drafts.remove(selected.annotationId));
    act(() => drafts.focusComposer(runtime.sessionId, runtime.threadId));
    expect(focus).toHaveBeenCalledOnce();
    expect(runtime.send).not.toHaveBeenCalled();
  });

  it("keeps a draft if native focus fails", async () => {
    const { drafts, runtime } = setup();
    await select();
    act(() => api.editor!(editorEvent("change")));
    api.focus.mockRejectedValueOnce(new Error("Tab changed"));
    const focus = vi.fn(() => true);
    drafts.subscribeComposerFocus(focus);
    await clickAdd();
    expect(focus).not.toHaveBeenCalled();
    expect(drafts.get(selected.annotationId)?.body).toBe("Make it larger");
    expect(runtime.send).not.toHaveBeenCalled();
  });
});
