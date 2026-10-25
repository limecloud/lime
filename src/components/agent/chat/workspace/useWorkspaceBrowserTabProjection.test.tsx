import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserState } from "./right-surface/browser/browserWorkspace.testFixtures";
import { readBrowserPresentation } from "./right-surface/browser/browserPresentation";

const host = vi.hoisted(() => ({
  list: vi.fn(),
  mount: vi.fn(),
  identity: vi.fn(),
  publish: vi.fn(),
}));
vi.mock("@/lib/api/browserTab", () => ({
  isBrowserTabHostAvailable: () => true,
  listBrowserTabs: host.list,
  mountBrowserTab: host.mount,
  listenBrowserTabState: async () => () => {},
  listenBrowserTabClosed: async () => () => {},
}));
vi.mock("@/lib/api/browserWorkspace", () => ({
  openBrowserWorkspaceIdentity: host.identity,
}));
import { useWorkspaceBrowserTabProjection } from "./useWorkspaceBrowserTabProjection";

function Probe({
  resumeUrl = "https://news.baidu.com/",
}: {
  resumeUrl?: string | null;
}) {
  useWorkspaceBrowserTabProjection({
    enabled: true,
    runtimeSessionId: "session",
    threadId: "thread",
    resumeUrl,
    onProjection: host.publish,
  });
  return null;
}
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  vi.clearAllMocks();
  container = document.createElement("div");
  root = createRoot(container);
  host.identity.mockResolvedValue({
    browserSessionId: "new-session",
    tabId: "new-tab",
  });
  host.list.mockResolvedValue([]);
  host.mount.mockResolvedValue(
    browserState({
      browserSessionId: "new-session",
      tabId: "new-tab",
      threadId: "thread",
      url: "https://news.baidu.com/",
    }),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = async (resumeUrl?: string | null) =>
  act(async () => {
    root.render(<Probe resumeUrl={resumeUrl} />);
  });

describe("browser host projection recovery", () => {
  it("cold restores navigation with a newly issued identity and no inherited agent control", async () => {
    await render();
    expect(host.mount).toHaveBeenCalledWith({
      browserSessionId: "new-session",
      tabId: "new-tab",
      threadId: "thread",
      url: "https://news.baidu.com/",
      selected: true,
      visible: false,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    });
    expect(host.publish.mock.lastCall?.[0][0].tabId).toBe("new-tab");
    expect(
      readBrowserPresentation({ sessionId: "session", threadId: "thread" }),
    ).toBe("new-tab");
  });
  it("reuses a live native tab without navigating it back to the old URL", async () => {
    const live = browserState({
      browserSessionId: "new-session",
      threadId: "thread",
      url: "https://example.com/new",
    });
    host.list.mockResolvedValue([live]);
    await render();
    expect(host.mount).not.toHaveBeenCalled();
    expect(host.publish).toHaveBeenCalledWith([live]);
  });
  it("does not resurrect an explicitly closed browser without a resume hint", async () => {
    await render(null);
    expect(host.mount).not.toHaveBeenCalled();
    expect(host.publish).toHaveBeenCalledWith([]);
  });
  it("ignores an identity response arriving after leaving the conversation", async () => {
    let resolve!: (value: unknown) => void;
    host.identity.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await render();
    act(() => root.render(null));
    await act(async () => resolve({ browserSessionId: "late", tabId: "late" }));
    expect(host.mount).not.toHaveBeenCalled();
    expect(host.publish).not.toHaveBeenCalled();
  });
});
