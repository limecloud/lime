import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserExtensionsToolbar } from "./BrowserExtensionsToolbar";

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/api/browserExtensions", () => ({
  listBrowserExtensions: api.list,
}));

const translate = (key: string) => key;

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  api.list.mockResolvedValue([
    {
      id: "ext-a",
      name: "Alpha",
      version: "1.0.0",
      manifestVersion: 3,
      path: "/a",
      enabled: true,
    },
    {
      id: "ext-b",
      name: "Beta",
      version: "2.0.0",
      manifestVersion: 3,
      path: "/b",
      enabled: false,
    },
  ]);
  localStorage.removeItem("lime.browser.extensions.pinned.v1");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(<BrowserExtensionsToolbar translate={translate} />),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("BrowserExtensionsToolbar", () => {
  it("opens the extension menu and pins an extension", async () => {
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="browser-extensions-toolbar"]',
    )!;
    await act(async () => trigger.click());
    await act(async () => Promise.resolve());
    expect(container.textContent).toContain("Alpha");
    expect(container.textContent).not.toContain("Beta");

    const pin = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "browserExtensions.pin",
    )!;
    await act(async () => pin.click());
    expect(localStorage.getItem("lime.browser.extensions.pinned.v1")).toContain(
      "ext-a",
    );
    expect(container.querySelector('button[title="Alpha"]')).not.toBeNull();
  });

  it("shows a more-options menu for a pinned extension", async () => {
    localStorage.setItem("lime.browser.extensions.pinned.v1", '["ext-a"]');
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () =>
      root.render(<BrowserExtensionsToolbar translate={translate} />),
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="browser-extensions-toolbar"]',
    )!;
    await act(async () => trigger.click());
    await act(async () => Promise.resolve());
    const pinned = container.querySelector<HTMLButtonElement>(
      'button[title="Alpha"]',
    )!;
    await act(async () => pinned.click());
    expect(container.textContent).toContain("browserExtensions.manage");
    expect(container.textContent).toContain("browserExtensions.webStore");
    expect(container.textContent).toContain("browserExtensions.hide");
  });

  it("moves pinned extensions into overflow when space is insufficient", async () => {
    localStorage.setItem(
      "lime.browser.extensions.pinned.v1",
      '["ext-a","ext-b"]',
    );
    api.list.mockResolvedValue([
      {
        id: "ext-a",
        name: "Alpha",
        version: "1.0.0",
        manifestVersion: 3,
        path: "/a",
        enabled: true,
      },
      {
        id: "ext-b",
        name: "Beta",
        version: "2.0.0",
        manifestVersion: 3,
        path: "/b",
        enabled: true,
      },
    ]);
    class FakeResizeObserver {
      constructor(private callback: globalThis.ResizeObserverCallback) {}
      observe() {
        this.callback(
          [{ contentRect: { width: 20 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      disconnect() {}
    }
    Object.assign(globalThis, {
      ResizeObserver: FakeResizeObserver as unknown as typeof ResizeObserver,
    });
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () =>
      root.render(<BrowserExtensionsToolbar translate={translate} />),
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="browser-extensions-toolbar"]',
    )!;
    await act(async () => trigger.click());
    await act(async () => Promise.resolve());
    expect(
      container.querySelector('[data-testid="browser-extensions-overflow"]'),
    ).not.toBeNull();
  });
});
