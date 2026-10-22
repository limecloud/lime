import type { BrowserTabState } from "@/lib/api/browserTab";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

export function createBrowserComponentHarness() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return {
    async render(node: ReactNode) {
      await act(async () => root.render(node));
    },
    query<T extends HTMLElement = HTMLElement>(testId: string) {
      const element = container.querySelector<T>(`[data-testid="${testId}"]`);
      if (!element) throw new Error(`Missing Browser test element: ${testId}`);
      return element;
    },
    async dispatch(element: Element, event: Event) {
      await act(async () => {
        element.dispatchEvent(event);
      });
    },
    async change(element: HTMLInputElement, value: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
      });
    },
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

export function browserState(
  overrides: Partial<BrowserTabState> = {},
): BrowserTabState {
  return {
    activeTurnId: null,
    browserSessionId: "browser-session-1",
    canGoBack: false,
    canGoForward: false,
    controlOwner: "user",
    find: { activeMatchOrdinal: 0, finalUpdate: true, matches: 0, text: "" },
    humanReason: null,
    isLoading: false,
    mark: null,
    origin: "user",
    ownerWebContentsId: 41,
    pageRevision: 0,
    selected: true,
    tabId: "browser-session-1:user:primary",
    threadId: "thread-1",
    title: "Example",
    url: "https://example.com/",
    viewId: "browser:browser-session-1:user:primary",
    webContentsId: 101,
    windowId: 7,
    zoomFactor: 1,
    ...overrides,
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
