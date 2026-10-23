import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  browserState,
  createBrowserComponentHarness,
} from "./browserWorkspace.testFixtures";
import { BrowserWorkspace } from "./BrowserWorkspace";
import type { BrowserTabCommandEvent } from "@/lib/api/browserTab";
import { act } from "react";

const projection = vi.hoisted(() => ({
  selecting: false,
  suspended: false,
  addModifierPressed: false,
  command: null as ((event: BrowserTabCommandEvent) => void) | null,
}));
const exit = vi.fn(async () => {
  projection.selecting = false;
});
vi.mock("react-i18next", () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
vi.mock("./useBrowserAnnotations", () => ({
  useBrowserAnnotations: () => ({
    ...projection,
    available: true,
    begin: vi.fn(),
    exit,
    addToComposer: vi.fn(),
  }),
}));
vi.mock("./useBrowserWorkspaceHydration", () => ({
  useBrowserWorkspaceHydration: () => ({
    owner: null,
    identity: null,
    tabs: [browserState()],
    acceptState: vi.fn(),
    isCurrent: () => false,
  }),
}));
vi.mock("./useBrowserNativeMenu", () => ({
  useBrowserNativeMenu: () => ({ open: false, show: vi.fn() }),
}));
vi.mock("./BrowserOptionsMenu", () => ({ BrowserOptionsMenu: () => null }));
vi.mock("@/hooks/useBrowserPreferences", () => ({
  useBrowserPreferences: () => ({ addressBarFontSize: "default" }),
}));
vi.mock("@/lib/api/browserTab", async (original) => ({
  ...(await original<typeof import("@/lib/api/browserTab")>()),
  isBrowserTabHostAvailable: () => false,
  listenBrowserTabCommand: async (
    handler: (event: BrowserTabCommandEvent) => void,
  ) => {
    projection.command = handler;
    return () => undefined;
  },
  listenBrowserTabLoadFailed: async () => () => undefined,
  listenBrowserTabDownload: async () => () => undefined,
  listenBrowserTabPermissionRequest: async () => () => undefined,
}));

let harness: ReturnType<typeof createBrowserComponentHarness>;
beforeEach(() => {
  projection.selecting = false;
  projection.suspended = false;
  projection.addModifierPressed = false;
  harness = createBrowserComponentHarness();
});
afterEach(async () => harness.unmount());

describe("Browser workspace annotation chrome", () => {
  it("keeps the native address shortcut working while annotating and rejects a foreign tab event", async () => {
    projection.selecting = true;
    await harness.render(<BrowserWorkspace threadId="thread-1" />);
    await act(async () =>
      projection.command!({
        ...browserState({ tabId: "other" }),
        command: "focus-address",
      }),
    );
    expect(
      document.querySelector('[data-testid="browser-workspace-address"]'),
    ).toBeNull();
    await act(async () =>
      projection.command!({ ...browserState(), command: "focus-address" }),
    );
    const address = document.querySelector(
      '[data-testid="browser-workspace-address"]',
    );
    expect(address).not.toBeNull();
    expect(document.activeElement).toBe(address);
    expect(
      document.querySelector('[data-testid="browser-annotation-toolbar"]'),
    ).toBeNull();
  });
  it("replaces navigation with one annotation toolbar and restores it on exit", async () => {
    const workspace = () => (
      <BrowserWorkspace threadId="thread-1" onSelectedStateChange={vi.fn()} />
    );
    await harness.render(workspace());
    expect(
      document.querySelector('[data-testid="browser-workspace-address"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="browser-annotation-toolbar"]'),
    ).toBeNull();
    projection.selecting = true;
    projection.suspended = true;
    await harness.render(workspace());
    expect(
      document.querySelector('[data-testid="browser-workspace-address"]'),
    ).toBeNull();
    expect(
      document.querySelectorAll('[data-testid="browser-annotation-toolbar"]'),
    ).toHaveLength(1);
    expect(
      document.querySelectorAll('[data-testid="browser-workspace-viewport"]'),
    ).toHaveLength(1);
    projection.selecting = false;
    await harness.render(workspace());
    expect(
      document.querySelector('[data-testid="browser-workspace-address"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="browser-annotation-toolbar"]'),
    ).toBeNull();
  });
});
