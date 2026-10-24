import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserTabState } from "@/lib/api/browserTab";
import { BrowserNavigationBar } from "./BrowserNavigationBar";
import {
  browserState,
  createBrowserComponentHarness,
  deferred,
} from "./browserWorkspace.testFixtures";

const host = vi.hoisted(() => ({
  navigate: vi.fn(),
  reload: vi.fn(),
  focus: vi.fn(),
}));
const preferences = vi.hoisted(() => ({ show_full_url: false }));
vi.mock("@/lib/api/browserTab", () => ({
  navigateBrowserTab: host.navigate,
  reloadBrowserTab: host.reload,
  focusBrowserTabPage: host.focus,
  stopBrowserTab: vi.fn(),
  goBackBrowserTab: vi.fn(),
  goForwardBrowserTab: vi.fn(),
}));
vi.mock("@/hooks/useBrowserPreferences", () => ({
  useBrowserPreferences: () => preferences,
}));

let harness: ReturnType<typeof createBrowserComponentHarness>;
const input = () =>
  harness.query<HTMLInputElement>("browser-workspace-address");
const render = (selected: BrowserTabState | null = browserState()) =>
  harness.render(
    <BrowserNavigationBar
      selected={selected}
      translate={(key) => key}
      run={async (operation) => {
        await operation();
      }}
    />,
  );
const focus = () => act(async () => input().focus());
const keyDown = async (
  options: ConstructorParameters<typeof KeyboardEvent>[1],
) => {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...options,
  });
  await harness.dispatch(input(), event);
  return event;
};
const submit = () =>
  harness.dispatch(
    input().closest("form")!,
    new Event("submit", { bubbles: true, cancelable: true }),
  );

describe("BrowserNavigationBar address editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preferences.show_full_url = false;
    harness = createBrowserComponentHarness();
    host.navigate.mockResolvedValue(browserState());
    host.reload.mockResolvedValue(browserState());
    host.focus.mockResolvedValue(browserState());
  });
  afterEach(async () => harness.unmount());

  it("shows the host at rest and selects the full LTR address when focused", async () => {
    await render(browserState({ url: "https://example.com/路径?q=value" }));
    expect(input().value).toBe("example.com");
    expect(input().dir).toBe("ltr");
    await focus();
    expect(input().value).toBe(
      "https://example.com/%E8%B7%AF%E5%BE%84?q=value",
    );
    expect([input().selectionStart, input().selectionEnd]).toEqual([
      0,
      input().value.length,
    ]);
  });

  it("cancels editing and releases focus when a different native tab is selected", async () => {
    await render();
    await focus();
    await harness.change(input(), "unfinished search");
    await render(
      browserState({
        tabId: "second",
        viewId: "second-view",
        webContentsId: 202,
        url: "https://second.example/path",
      }),
    );
    expect(document.activeElement).not.toBe(input());
    expect(input().value).toBe("second.example");
    expect(host.navigate).not.toHaveBeenCalled();
    await focus();
    expect(input().value).toBe("https://second.example/path");
  });

  it("does not carry focus or a draft into a replaced native view with the same tab id", async () => {
    await render();
    await focus();
    await harness.change(input(), "old view draft");
    await render(browserState({ viewId: "replacement", webContentsId: 202 }));
    expect(document.activeElement).not.toBe(input());
    expect(input().value).toBe("example.com");
  });

  it("cancels an edited address when the actual page navigates", async () => {
    await render();
    await focus();
    await harness.change(input(), "never submit this draft");
    await render(browserState({ url: "https://example.com/redirected" }));
    expect(document.activeElement).not.toBe(input());
    expect(input().value).toBe("example.com");
    await submit();
    expect(host.navigate).not.toHaveBeenCalled();
    expect(host.reload).toHaveBeenCalledOnce();
  });

  it("keeps a pristine focused address in sync with native navigation", async () => {
    await render();
    await focus();
    await render(browserState({ url: "https://example.com/redirected" }));
    expect(document.activeElement).toBe(input());
    expect(input().value).toBe("https://example.com/redirected");
  });

  it("preserves the draft and caret across title, load, zoom and find projection changes", async () => {
    await render();
    await focus();
    await harness.change(input(), "localhost:3000/draft");
    input().setSelectionRange(4, 4);
    await render(
      browserState({
        title: "New title",
        isLoading: true,
        pageRevision: 9,
        zoomFactor: 1.1,
        find: {
          text: "find",
          matches: 3,
          activeMatchOrdinal: 1,
          finalUpdate: true,
        },
      }),
    );
    expect(input().value).toBe("localhost:3000/draft");
    expect(document.activeElement).toBe(input());
    expect(input().selectionStart).toBe(4);
    await submit();
    expect(host.navigate).toHaveBeenCalledExactlyOnceWith(
      browserState().tabId,
      "http://localhost:3000/draft",
    );
  });

  it.each(["Escape", "blur"])(
    "discards edits on %s and restores the real URL on refocus",
    async (action) => {
      await render();
      await focus();
      await harness.change(input(), "cancel me");
      if (action === "Escape") await keyDown({ key: "Escape" });
      else await act(async () => input().blur());
      expect(input().value).toBe("example.com");
      expect(document.activeElement).not.toBe(input());
      await focus();
      expect(input().value).toBe("https://example.com/");
      expect(host.navigate).not.toHaveBeenCalled();
    },
  );

  it("pastes plain text over the selection and puts the caret after the inserted text", async () => {
    await render();
    await focus();
    await harness.change(input(), "https://example.com/old?x=1");
    input().setSelectionRange(20, 23);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: () => "新 路径" },
    });
    await harness.dispatch(input(), event);
    expect(event.defaultPrevented).toBe(true);
    expect(input().value).toBe("https://example.com/新 路径?x=1");
    expect([input().selectionStart, input().selectionEnd]).toEqual([24, 24]);
    expect(host.navigate).not.toHaveBeenCalled();
  });

  it("ignores empty clipboard data without changing the selection", async () => {
    await render();
    await focus();
    input().setSelectionRange(8, 12);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: () => "" },
    });
    await harness.dispatch(input(), event);
    expect(event.defaultPrevented).toBe(false);
    expect([input().selectionStart, input().selectionEnd]).toEqual([8, 12]);
  });

  it("blocks composition Enter and submits only after composition ends", async () => {
    await render();
    await focus();
    await harness.change(input(), "中文查询");
    await harness.dispatch(
      input(),
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    expect((await keyDown({ key: "Enter" })).defaultPrevented).toBe(true);
    await submit();
    expect(host.navigate).not.toHaveBeenCalled();
    await harness.dispatch(
      input(),
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    await submit();
    expect(host.navigate).toHaveBeenCalledExactlyOnceWith(
      browserState().tabId,
      "https://www.google.com/search?q=%E4%B8%AD%E6%96%87%E6%9F%A5%E8%AF%A2",
    );
  });

  it("blocks IME confirmation reported through the native composing flag or keyCode 229", async () => {
    await render();
    await focus();
    await harness.change(input(), "中文");
    expect(
      (await keyDown({ key: "Enter", isComposing: true })).defaultPrevented,
    ).toBe(true);
    expect(
      (await keyDown({ key: "Enter", keyCode: 229 })).defaultPrevented,
    ).toBe(true);
    expect(host.navigate).not.toHaveBeenCalled();
  });

  it("clears an interrupted composition when focus leaves, so refocusing can submit", async () => {
    await render();
    await focus();
    await harness.dispatch(
      input(),
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    await act(async () => input().blur());
    await focus();
    await harness.change(input(), "next.example");
    await submit();
    expect(host.navigate).toHaveBeenCalledExactlyOnceWith(
      browserState().tabId,
      "https://next.example/",
    );
  });

  it("coalesces pending Enter and reloads an unchanged URL", async () => {
    const pending = deferred<BrowserTabState>();
    host.navigate.mockReturnValueOnce(pending.promise);
    await render();
    await focus();
    await harness.change(input(), "next.example");
    await submit();
    await submit();
    expect(host.navigate).toHaveBeenCalledOnce();
    await act(async () =>
      pending.resolve(browserState({ url: "https://next.example/" })),
    );
    await submit();
    expect(host.navigate).toHaveBeenCalledTimes(2);
    await render();
    await act(async () => input().blur());
    await focus();
    await submit();
    expect(host.reload).toHaveBeenCalledExactlyOnceWith(browserState().tabId);
  });

  it("disables address editing while no native tab is selected", async () => {
    await render(null);
    expect(input().disabled).toBe(true);
    await submit();
    expect(host.navigate).not.toHaveBeenCalled();
  });

  it("releases the address immediately and hands focus to the same page after navigation is accepted", async () => {
    const pending = deferred<BrowserTabState>();
    host.navigate.mockReturnValueOnce(pending.promise);
    await render();
    await focus();
    await harness.change(input(), "next.example");
    await submit();
    expect(document.activeElement).not.toBe(input());
    expect(host.focus).not.toHaveBeenCalled();
    await act(async () =>
      pending.resolve(browserState({ url: "https://next.example/" })),
    );
    expect(host.focus).toHaveBeenCalledExactlyOnceWith(browserState());
  });

  it("hands focus to the page when the unchanged address reloads", async () => {
    await render();
    await focus();
    await submit();
    expect(host.reload).toHaveBeenCalledExactlyOnceWith(browserState().tabId);
    expect(document.activeElement).not.toBe(input());
    expect(host.focus).toHaveBeenCalledExactlyOnceWith(browserState());
  });

  it.each(["edit", "tab", "unmount", "other-input"] as const)(
    "does not steal focus after a delayed navigation when the user moves to %s",
    async (action) => {
      const pending = deferred<BrowserTabState>();
      host.navigate.mockReturnValueOnce(pending.promise);
      await render();
      await focus();
      await harness.change(input(), "next.example");
      await submit();
      const other = document.createElement("input");
      document.body.append(other);
      try {
        if (action === "edit") {
          await focus();
          await harness.change(input(), "new draft");
        } else if (action === "tab") {
          await render(
            browserState({
              tabId: "second",
              viewId: "second-view",
              webContentsId: 202,
            }),
          );
        } else if (action === "unmount") {
          await harness.render(<></>);
        } else {
          await act(async () => other.focus());
        }
        await act(async () =>
          pending.resolve(browserState({ url: "https://next.example/" })),
        );
        expect(host.focus).not.toHaveBeenCalled();
        if (action === "edit") {
          expect(document.activeElement).toBe(input());
          expect(input().value).toBe("new draft");
        }
        if (action === "other-input")
          expect(document.activeElement).toBe(other);
      } finally {
        other.remove();
      }
    },
  );

  it("refreshes the same normalized address without replacing its native tab", async () => {
    await render();
    await harness.change(input(), "example.com");
    await submit();
    expect(host.reload).toHaveBeenCalledExactlyOnceWith(browserState().tabId);
    expect(host.navigate).not.toHaveBeenCalled();
  });

  it("leaves an empty submission on the current page", async () => {
    await render();
    await harness.change(input(), "  ");
    await submit();
    expect(host.reload).not.toHaveBeenCalled();
    expect(host.navigate).not.toHaveBeenCalled();
  });

  it("reports invalid addresses through the operation error boundary and retains the draft", async () => {
    const failure = vi.fn();
    await harness.render(
      <BrowserNavigationBar
        selected={browserState()}
        translate={(key) => key}
        run={async (operation) => {
          try {
            await operation();
          } catch (reason) {
            failure(reason);
          }
        }}
      />,
    );
    await focus();
    await harness.change(input(), "http://localhost:99999/");
    await submit();
    expect(failure).toHaveBeenCalledOnce();
    expect(input().value).toBe("http://localhost:99999/");
    expect(host.navigate).not.toHaveBeenCalled();
  });

  it("uses the full URL preference and expands a short address when focused from the native page", async () => {
    const selected = browserState({ url: "https://example.com/path?q=1" });
    await render(selected);
    expect(input().value).toBe("example.com");
    await harness.render(
      <BrowserNavigationBar
        selected={selected}
        translate={(key) => key}
        run={async (operation) => {
          await operation();
        }}
        addressFocusRequest={1}
      />,
    );
    expect(document.activeElement).toBe(input());
    expect(input().value).toBe(selected.url);
    expect(input().selectionStart).toBe(0);
    expect(input().selectionEnd).toBe(selected.url.length);
    await act(async () => input().blur());
    preferences.show_full_url = true;
    await render(selected);
    expect(input().value).toBe(selected.url);
  });
});
