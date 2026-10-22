import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { BrowserNavigationBar } from "./BrowserNavigationBar";
import {
  browserState,
  createBrowserComponentHarness,
} from "./browserWorkspace.testFixtures";

const host = vi.hoisted(() => ({ navigate: vi.fn(), reload: vi.fn() }));
const preferences = vi.hoisted(() => ({ show_full_url: false }));
vi.mock("@/hooks/useBrowserPreferences", () => ({
  useBrowserPreferences: () => preferences,
}));
vi.mock("@/lib/api/browserTab", () => ({
  navigateBrowserTab: host.navigate,
  reloadBrowserTab: host.reload,
  goBackBrowserTab: vi.fn(),
  goForwardBrowserTab: vi.fn(),
  setBrowserTabZoom: vi.fn(),
  stopBrowserTab: vi.fn(),
}));

let harness: ReturnType<typeof createBrowserComponentHarness>;
const keyDown = async (
  element: HTMLElement,
  options: ConstructorParameters<typeof KeyboardEvent>[1],
) =>
  harness.dispatch(
    element,
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...options,
    }),
  );
const translate = (key: string) => key;
const run = async (operation: () => Promise<unknown>) => {
  await operation();
};
const props = { translate, run, onFind: vi.fn() };
const address = () =>
  harness.query<HTMLInputElement>(
    "browser-workspace-address",
  ) as HTMLInputElement;
const submit = () =>
  harness.dispatch(
    address().closest("form")!,
    new Event("submit", { bubbles: true, cancelable: true }),
  );

describe("BrowserNavigationBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preferences.show_full_url = false;
    harness = createBrowserComponentHarness();
    host.navigate.mockResolvedValue(browserState());
    host.reload.mockResolvedValue(browserState());
  });
  afterEach(async () => harness.unmount());

  it("keeps an address draft while native title, load, zoom and find snapshots update", async () => {
    await harness.render(
      <BrowserNavigationBar {...props} selected={browserState()} />,
    );
    await act(async () => address().focus());
    await harness.change(address(), "localhost:3000/draft");
    await harness.render(
      <BrowserNavigationBar
        {...props}
        selected={browserState({
          title: "Updated title",
          isLoading: true,
          zoomFactor: 1.1,
          find: {
            text: "find",
            matches: 3,
            activeMatchOrdinal: 1,
            finalUpdate: true,
          },
        })}
      />,
    );
    expect(address().value).toBe("localhost:3000/draft");
    await submit();
    expect(host.navigate).toHaveBeenCalledExactlyOnceWith(
      browserState().tabId,
      "http://localhost:3000/draft",
    );
  });

  it("refreshes the same normalized address without replacing its native tab", async () => {
    await harness.render(
      <BrowserNavigationBar {...props} selected={browserState()} />,
    );
    await harness.change(address(), "example.com");
    await submit();
    expect(host.reload).toHaveBeenCalledExactlyOnceWith(browserState().tabId);
    expect(host.navigate).not.toHaveBeenCalled();
  });

  it("leaves an empty submission on the current page", async () => {
    await harness.render(
      <BrowserNavigationBar {...props} selected={browserState()} />,
    );
    await harness.change(address(), "  ");
    await submit();
    expect(host.reload).not.toHaveBeenCalled();
    expect(host.navigate).not.toHaveBeenCalled();
  });

  it("reports invalid addresses through the operation error boundary and retains the draft", async () => {
    const failure = vi.fn();
    const safeRun = async (operation: () => Promise<unknown>) => {
      try {
        await operation();
      } catch (reason) {
        failure(reason);
      }
    };
    await harness.render(
      <BrowserNavigationBar
        {...props}
        run={safeRun}
        selected={browserState()}
      />,
    );
    await act(async () => address().focus());
    await harness.change(address(), "http://localhost:99999/");
    await submit();
    expect(failure).toHaveBeenCalledOnce();
    expect(address().value).toBe("http://localhost:99999/");
    expect(host.navigate).not.toHaveBeenCalled();
  });

  it("accepts only one submission while the native navigation is pending", async () => {
    let resolve!: (value: ReturnType<typeof browserState>) => void;
    host.navigate.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await harness.render(
      <BrowserNavigationBar {...props} selected={browserState()} />,
    );
    await harness.change(address(), "localhost:3000/pending");
    await submit();
    await submit();
    expect(host.navigate).toHaveBeenCalledOnce();
    await act(async () => resolve(browserState()));
    await submit();
    expect(host.navigate).toHaveBeenCalledTimes(2);
  });

  it("restores the current URL on Escape and keeps IME confirmation out of navigation", async () => {
    await harness.render(
      <BrowserNavigationBar {...props} selected={browserState()} />,
    );
    await act(async () => address().focus());
    expect(address().selectionStart).toBe(0);
    expect(address().selectionEnd).toBe(address().value.length);
    await harness.change(address(), "草稿");
    await harness.dispatch(
      address(),
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    await submit();
    await harness.dispatch(
      address(),
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    await keyDown(address(), { key: "Escape" });
    expect(address().value).toBe("example.com");
    expect(document.activeElement).not.toBe(address());
    expect(host.navigate).not.toHaveBeenCalled();
  });

  it("discards the old draft when the native page navigates or another tab is selected", async () => {
    await harness.render(
      <BrowserNavigationBar {...props} selected={browserState()} />,
    );
    await act(async () => address().focus());
    await harness.change(address(), "old draft");
    await harness.render(
      <BrowserNavigationBar
        {...props}
        selected={browserState({ url: "https://example.com/redirect" })}
      />,
    );
    expect(address().value).toBe("https://example.com/redirect");
    await harness.change(address(), "another draft");
    await harness.render(
      <BrowserNavigationBar
        {...props}
        selected={browserState({ tabId: "second-tab" })}
      />,
    );
    expect(address().value).toBe("https://example.com/");
    await submit();
    expect(host.reload).toHaveBeenCalledExactlyOnceWith("second-tab");
  });

  it("uses the full URL preference and expands a short address when focused from the native page", async () => {
    const selected = browserState({ url: "https://example.com/path?q=1" });
    await harness.render(
      <BrowserNavigationBar {...props} selected={selected} />,
    );
    expect(address().value).toBe("example.com");
    await harness.render(
      <BrowserNavigationBar
        {...props}
        selected={selected}
        addressFocusRequest={1}
      />,
    );
    expect(document.activeElement).toBe(address());
    expect(address().value).toBe(selected.url);
    expect(address().selectionStart).toBe(0);
    expect(address().selectionEnd).toBe(selected.url.length);
    await act(async () => address().blur());
    preferences.show_full_url = true;
    await harness.render(
      <BrowserNavigationBar {...props} selected={selected} />,
    );
    expect(address().value).toBe(selected.url);
  });
});
