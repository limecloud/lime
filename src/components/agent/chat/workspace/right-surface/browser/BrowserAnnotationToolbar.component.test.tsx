import { act } from "react";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale, getLimeI18n } from "@/i18n/createI18n";
import type { SupportedLocale } from "@/i18n/locales";
import type { BrowserAnnotationSelectionEvent } from "@/lib/api/browserAnnotationTypes";
import {
  BrowserAnnotationContext,
  type BrowserAnnotationRuntime,
} from "./BrowserAnnotationContext";
import {
  BrowserAnnotationDraftStore,
  browserAnnotationDraftsAtom,
} from "./browserAnnotationDrafts";
import { BrowserAnnotationToolbar } from "./BrowserAnnotationToolbar";
import { submitBrowserAnnotations } from "./browserAnnotationSubmission";
import {
  fromQueueAcceptanceResponse,
  type RuntimeSubmissionResult,
} from "../../../hooks/agentSendResult";
import type { InputbarSendPayload } from "../../../components/Inputbar/inputbarSendPayload";
import {
  browserState,
  createBrowserComponentHarness,
  deferred,
} from "./browserWorkspace.testFixtures";

const native = vi.hoisted(() => ({
  hook: vi.fn(),
  show: vi.fn(),
  markers: vi.fn(),
  original: vi.fn(),
}));
vi.mock("./useBrowserNativeMenu", () => ({
  useBrowserNativeMenu: (params: unknown) => {
    native.hook(params);
    return { open: false, show: native.show };
  },
}));
vi.mock("@/lib/api/browserAnnotation", () => ({
  setBrowserAnnotationMarkers: native.markers,
  setBrowserAnnotationOriginal: native.original,
}));

let harness: ReturnType<typeof createBrowserComponentHarness>;
let state: ReturnType<typeof createStore>;
let drafts: BrowserAnnotationDraftStore;
let runtime: BrowserAnnotationRuntime;
const tab = browserState();
const onError = vi.fn();
const onExit = vi.fn(async () => undefined);
const onAddToComposer = vi.fn(async () => undefined);
const accepted = {
  kind: "runtime-accepted" as const,
  receipt: {
    kind: "start" as const,
    sessionId: "session-1",
    threadId: "thread-1",
    turnId: "turn-1",
    clientUserMessageId: "user-1",
  },
};

function add(
  id: string,
  body = "Make this larger",
  selected = tab,
  sessionId = "session-1",
  designSnapshot?: import("@/lib/api/browserDesign").BrowserDesignSnapshot,
) {
  const event: BrowserAnnotationSelectionEvent = {
    ...selected,
    annotationId: id,
    kind: "element",
    scope: "page",
    ...(designSnapshot ? { designSnapshot } : {}),
    selection: {
      kind: "element",
      pageUrl: selected.url,
      pageTitle: selected.title,
      frameUrl: selected.url,
      framePath: [],
      targetRect: { x: 10, y: 20, width: 100, height: 30 },
      viewportSize: { width: 800, height: 600 },
      scrollPosition: { x: 0, y: 0 },
      devicePixelRatio: 1,
      targetSelector: "#title",
      targetPath: null,
      targetRole: null,
      targetText: "Title",
      markerViewportPoint: { x: 10, y: 20 },
    },
  };
  drafts.create(sessionId, event, {
    annotationId: id,
    selection: event.selection,
    screenshot: {
      dataUrl: "data:image/png;base64,aGVsbG8=",
      kind: "viewport",
      width: 800,
      height: 600,
      viewportSize: event.selection.viewportSize,
    },
    screenshotStatus: "captured",
    failureReason: null,
  });
  drafts.update(id, body, 1);
  return drafts.get(id)!;
}
const render = (
  selected = tab,
  active = true,
  input: { suspended?: boolean; addModifierPressed?: boolean } = {},
) =>
  harness.render(
    <Provider store={state}>
      <BrowserAnnotationContext.Provider value={runtime}>
        <BrowserAnnotationToolbar
          selected={selected}
          active={active}
          onExit={onExit}
          onAddToComposer={onAddToComposer}
          onError={onError}
          {...input}
        />
      </BrowserAnnotationContext.Provider>
    </Provider>,
  );
const label = (key: string, locale?: SupportedLocale) =>
  String(
    getLimeI18n().getFixedT(
      locale ?? getLimeI18n().language,
      "agent",
    )(`browserAnnotation.${key}`),
  );
const button = (key: string) => {
  const found = Array.from(document.querySelectorAll("button")).find(
    (element) =>
      element.getAttribute("aria-label") === label(key) ||
      element.textContent === label(key),
  );
  if (!found) throw new Error(`Missing toolbar button ${key}`);
  return found;
};
const click = async (key: string) => act(async () => button(key).click());
const choose = async (id: string) =>
  act(async () => native.hook.mock.calls.at(-1)![0].onAction(id));

beforeEach(async () => {
  await changeLimeLocale("en-US");
  vi.clearAllMocks();
  native.show.mockResolvedValue(undefined);
  native.markers.mockImplementation(async (tabId, visible) => ({
    tabId,
    visible,
  }));
  state = createStore();
  drafts = new BrowserAnnotationDraftStore();
  state.set(browserAnnotationDraftsAtom, drafts);
  runtime = {
    sessionId: "session-1",
    threadId: "thread-1",
    workspaceId: null,
    isSending: false,
    send: vi.fn(async () => ({ kind: "rejected" })),
  };
  harness = createBrowserComponentHarness();
});
afterEach(async () => {
  await harness.unmount();
  await changeLimeLocale("zh-CN");
});

describe("Browser annotation toolbar", () => {
  it("enables original only when this tab has a design change", async () => {
    add("plain");
    await render();
    expect(button("holdOriginal").disabled).toBe(true);
    const snapshot = {
      elementTagName: "h1",
      declarations: [
        { property: "font-size", value: "16px", previousValue: "16px" },
      ],
    };
    await act(async () => {
      add("design", "", tab, "session-1", snapshot);
      drafts.update("design", "", 2, [], {
        declarations: [
          { property: "font-size", previousValue: "16px", value: "20px" },
        ],
      });
    });
    expect(button("holdOriginal").disabled).toBe(false);
    await act(async () => {
      drafts.update("design", "", 3, [], null);
    });
    expect(button("holdOriginal").disabled).toBe(true);
  });
  it("includes design-only drafts in the same send action and canonical annotation IDs", async () => {
    const snapshot = {
      elementTagName: "h1",
      declarations: [
        { property: "font-size", value: "16px", previousValue: "16px" },
      ],
    };
    add("design", "", tab, "session-1", snapshot);
    drafts.update("design", "", 2, [], {
      declarations: [
        { property: "font-size", value: "24px", previousValue: "16px" },
      ],
    });
    await render();
    expect(button("sendAll").disabled).toBe(false);
    await click("sendAll");
    expect(runtime.send).toHaveBeenCalledWith(
      expect.objectContaining({ browserAnnotationIds: ["design"] }),
    );
    expect(drafts.get("design")).toBeDefined();
  });
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
    "shows temporary browse state and adds to Composer without sending in %s",
    async (locale) => {
      await changeLimeLocale(locale);
      add("first");
      await render(tab, true, { suspended: true, addModifierPressed: true });
      const toolbar = document.querySelector('[role="toolbar"]')!;
      expect(toolbar.textContent).toContain(label("browsing"));
      expect(toolbar.textContent).toContain(tab.url);
      expect(toolbar.textContent).toContain(label("releaseSpace"));
      await click("addToComposer");
      expect(onAddToComposer).toHaveBeenCalledOnce();
      expect(runtime.send).not.toHaveBeenCalled();
      expect(drafts.get("first")?.body).toBe("Make this larger");
      await render(tab, true);
      expect(toolbar.textContent).toContain(label("annotating"));
      expect(toolbar.textContent).toContain(label("holdSpace"));
    },
  );

  it.each([
    ["MacIntel", "metaKey", "ctrlKey"],
    ["Win32", "ctrlKey", "metaKey"],
  ] as const)(
    "checks the actual pointer modifier on %s even when the page reports an old key state",
    async (platform, primary, other) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      add("first");
      await render(tab, true, { addModifierPressed: true });
      await act(async () =>
        button("addToComposer").dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            detail: 1,
            [primary]: true,
          }),
        ),
      );
      expect(onAddToComposer).toHaveBeenCalledOnce();
      await act(async () =>
        button("addToComposer").dispatchEvent(
          new MouseEvent("click", { bubbles: true, detail: 1, [other]: true }),
        ),
      );
      expect(runtime.send).toHaveBeenCalledOnce();
      expect(onAddToComposer).toHaveBeenCalledOnce();
      vi.restoreAllMocks();
    },
  );
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
    "renders actionable controls and the native confirmation in %s",
    async (locale) => {
      await changeLimeLocale(locale);
      add("first");
      await render();
      expect(button("exit").disabled).toBe(false);
      expect(button("hideMarkers").getAttribute("aria-pressed")).toBe("true");
      expect(button("sendAll").disabled).toBe(false);
      await click("discardAll");
      expect(native.show.mock.calls[0].slice(1)).toEqual([
        [
          { id: "cancel", label: label("cancel", locale) },
          { id: "discard", label: label("discard", locale) },
        ],
        {
          title: label("discardTitle", locale),
          description: label("discardDescription", locale),
        },
      ]);
      await click("exit");
      expect(onExit).toHaveBeenCalledTimes(1);
      expect(drafts.get("first")?.body).toBe("Make this larger");
    },
  );

  it("counts and sends only nonempty drafts for the canonical session, thread and native tab", async () => {
    add("first");
    add("empty", " ");
    add("other-tab", "Other", browserState({ tabId: "other" }));
    add("other-view", "Other", browserState({ webContentsId: 999 }));
    add("other-session", "Other", tab, "other-session");
    await render();
    await click("sendAll");
    expect(runtime.send).toHaveBeenCalledExactlyOnceWith({
      browserAnnotationIds: ["first"],
      sendOptions: {
        composerTarget: "start",
        targetSessionId: "session-1",
        skipSceneCommandRouting: true,
        skipWorkspaceCommandRouting: true,
        skipSessionRestore: true,
      },
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      label("sendFailed"),
    );
    expect(drafts.getSnapshot()).toHaveLength(5);
  });

  it("cancels without deletion and rejects a changed snapshot before allowing a fresh confirmation", async () => {
    const first = add("first");
    await render();
    await click("discardAll");
    await choose("cancel");
    expect(drafts.get(first.id)).toBe(first);
    await click("discardAll");
    await act(async () => {
      drafts.update(first.id, "Edited while confirming", 2);
    });
    await choose("discard");
    expect(drafts.get(first.id)?.body).toBe("Edited while confirming");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      label("discardChanged"),
    );
    await click("discardAll");
    await act(async () => {
      add("new-after-confirmation");
    });
    await choose("discard");
    await choose("discard");
    expect(drafts.getSnapshot().map((draft) => draft.id)).toEqual([
      "new-after-confirmation",
    ]);
  });

  it("blocks pending drafts and an obsolete confirmation after switching the selected native tab", async () => {
    const draft = add("first");
    await render();
    await click("discardAll");
    await render(browserState({ webContentsId: 999 }));
    await choose("discard");
    expect(drafts.get(draft.id)).toBe(draft);
    await render();
    await act(async () => {
      drafts.begin([draft]);
    });
    expect(button("discardAll").disabled).toBe(true);
    expect(button("sendAll").disabled).toBe(true);
    await click("sendAll");
    expect(runtime.send).not.toHaveBeenCalled();
  });

  it("preserves marker preferences and their late acknowledgements across tab switches", async () => {
    const response = deferred<{ tabId: string; visible: boolean }>();
    native.markers.mockReturnValueOnce(response.promise);
    await render();
    await click("hideMarkers");
    await render(browserState({ tabId: "next", webContentsId: 999 }));
    expect(button("hideMarkers").disabled).toBe(false);
    await act(async () =>
      response.resolve({ tabId: tab.tabId, visible: false }),
    );
    await render();
    expect(button("showMarkers").getAttribute("aria-pressed")).toBe("false");
    expect(native.markers).toHaveBeenCalledExactlyOnceWith(tab.tabId, false);
    native.markers.mockRejectedValueOnce(new Error("Host unavailable"));
    await click("showMarkers");
    expect(button("showMarkers").getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      label("markersFailed"),
    );
  });

  it.each([false, true])(
    "uses the existing submission owner once with isSending=%s and consumes only accepted original text and images",
    async (isSending) => {
      const first = add("first");
      const second = add("second", "Change this color");
      const response = deferred<RuntimeSubmissionResult>();
      const submit = vi.fn(
        async (_payload: InputbarSendPayload) => response.promise,
      );
      runtime = {
        ...runtime,
        isSending,
        send: vi.fn((payload) =>
          submitBrowserAnnotations({
            store: drafts,
            sessionId: runtime.sessionId,
            threadId: runtime.threadId,
            isCurrent: () => true,
            payload,
            send: submit,
          }),
        ),
      };
      await render();
      await act(async () => {
        button("sendAll").click();
        button("sendAll").click();
      });
      expect(runtime.send).toHaveBeenCalledTimes(1);
      expect(submit).toHaveBeenCalledTimes(1);
      expect(submit.mock.calls[0][0].sendOptions?.composerTarget).toBe(
        isSending ? "queue" : "start",
      );
      expect(submit.mock.calls[0][0].textOverride).toContain(first.body);
      expect(submit.mock.calls[0][0].textOverride).toContain(second.body);
      expect(submit.mock.calls[0][0].images).toHaveLength(2);
      await act(async () =>
        response.resolve(
          isSending
            ? fromQueueAcceptanceResponse(
                {
                  sessionId: "session-1",
                  threadId: "thread-1",
                  clientUserMessageId: "user-1",
                },
                {
                  id: "queued-1",
                  clientUserMessageId: "user-1",
                  input: [{ type: "text", text: first.body }],
                },
              )
            : accepted,
        ),
      );
      expect(drafts.getSnapshot()).toHaveLength(0);
      expect(document.querySelector('[role="alert"]')).toBeNull();
    },
  );
});
