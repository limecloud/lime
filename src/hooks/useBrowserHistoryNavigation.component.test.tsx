import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsTabs } from "@/types/settings";
import type { BrowserWorkspaceIdentity } from "@/lib/api/browserWorkspace";
import { buildClawAgentParams } from "@/lib/workspace/navigation";
import { useBrowserHistoryNavigation } from "./useBrowserHistoryNavigation";
import { useAppNavigation } from "./useAppNavigation";

const api = vi.hoisted(() => ({
  available: vi.fn(),
  create: vi.fn(),
  close: vi.fn(),
  request: vi.fn(),
  consume: vi.fn(),
  getSession: vi.fn(),
  getProject: vi.fn(),
}));
vi.mock("@/lib/api/agentRuntime/sessionClient", () => ({
  getAgentRuntimeSession: api.getSession,
}));
vi.mock("@/lib/api/project", () => ({ getProject: api.getProject }));
vi.mock("@/lib/api/browserTab", () => ({
  isBrowserTabHostAvailable: api.available,
  closeBrowserTab: api.close,
}));
vi.mock("@/lib/api/browserWorkspace", () => ({
  createBrowserWorkspaceLinkTab: api.create,
}));
vi.mock("@/lib/api/workspaceRightSurface", () => ({
  requestWorkspaceRightSurface: api.request,
  consumeWorkspaceRightSurfacePending: api.consume,
}));

type Params = Parameters<typeof useBrowserHistoryNavigation>[0];
const owner = {
  runtimeSessionId: "runtime-session",
  threadId: "canonical-thread",
  workspaceId: "workspace",
};
const identity = { browserSessionId: "browser-session", tabId: "history-tab" };
const address = "https://example.com/history?q=retained#section";
const returnLocation = {
  sessionId: owner.runtimeSessionId,
  workspaceId: owner.workspaceId,
};
const sessionDetail = {
  id: owner.runtimeSessionId,
  thread_id: owner.threadId,
  workspace_id: undefined as string | undefined,
  working_dir: "/workspace/project",
  thread_read: { thread_id: owner.threadId },
};
const workspace = {
  id: owner.workspaceId,
  rootPath: sessionDetail.working_dir,
};
const navigate = vi.fn();
const tryNavigate = vi.fn();
let root: Root;
let container: HTMLDivElement;
let latest: ReturnType<typeof useBrowserHistoryNavigation>;
function Probe(props: Params) {
  latest = useBrowserHistoryNavigation(props);
  return null;
}
const defaults = (): Params => ({
  page: "settings",
  pageParams: {
    tab: SettingsTabs.Browser,
    browserPage: "history",
    browserReturnOwner: owner,
  },
  navigationRequestId: 3,
  agentLocation: null,
  settingsReturnLocation: null,
  navigate,
  tryNavigate,
});
const render = (overrides: Partial<Params> = {}) =>
  act(async () => {
    root.render(
      <StrictMode>
        <Probe {...defaults()} {...overrides} />
      </StrictMode>,
    );
  });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  api.available.mockReturnValue(true);
  api.create.mockResolvedValue(identity);
  api.close.mockResolvedValue(undefined);
  api.consume.mockResolvedValue(undefined);
  api.request.mockResolvedValue({ requestId: "history-request" });
  api.getSession.mockResolvedValue(sessionDetail);
  api.getProject.mockResolvedValue(workspace);
  tryNavigate.mockImplementation((page, params) => {
    navigate(page, params);
    return true;
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("browser history canonical navigation", () => {
  it("creates a real foreground tab, publishes its identity and returns to the same session and workspace", async () => {
    await render();
    await latest.openHistoryUrl!(address);
    expect(api.create).toHaveBeenCalledExactlyOnceWith({
      owner: {
        runtimeSessionId: "runtime-session",
        threadId: "canonical-thread",
      },
      url: address,
      background: false,
      isCurrent: expect.any(Function),
    });
    expect(api.request).toHaveBeenCalledExactlyOnceWith({
      surfaceKind: "browser",
      origin: "user",
      priority: "foreground",
      reason: "open_browser_history",
      sessionId: "runtime-session",
      workspaceId: "workspace",
      workspaceRoot: null,
      candidateId: address,
      metadata: { browser: { launchUrl: address, tabId: "history-tab" } },
    });
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      "agent",
      buildClawAgentParams({
        initialSessionId: "runtime-session",
        projectId: "workspace",
      }),
    );
    expect(api.close).not.toHaveBeenCalled();
    expect(api.consume).not.toHaveBeenCalled();
    expect(api.getSession).not.toHaveBeenCalled();
    expect(api.getProject).not.toHaveBeenCalled();
  });

  it.each([
    { page: "agent" as const },
    { pageParams: { tab: SettingsTabs.Browser } },
    {
      pageParams: {
        browserReturnOwner: { ...owner, threadId: " " },
      },
    },
  ])(
    "does not infer a canonical thread from a session or settings location: %j",
    async (overrides) => {
      await render({
        agentLocation: {
          sessionId: owner.runtimeSessionId,
          workspaceId: "workspace",
        },
        ...overrides,
      });
      expect(latest.openHistoryUrl).toBeNull();
      expect(api.create).not.toHaveBeenCalled();
    },
  );

  it("disables history opening when the native browser host is unavailable", async () => {
    api.available.mockReturnValue(false);
    await render();
    expect(latest.openHistoryUrl).toBeNull();
  });

  it.each(["javascript:alert(1)", "file:///private/secret", "not-an-address"])(
    "rejects an invalid recorded address before creating a tab: %s",
    async (url) => {
      await render();
      await expect(latest.openHistoryUrl!(url)).rejects.toBeDefined();
      expect(api.create).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    },
  );

  it("reports a canonical gateway failure without navigating; a retry can create the tab", async () => {
    const failure = new Error("App Server refused identity");
    api.create.mockRejectedValueOnce(failure);
    await render();
    await expect(latest.openHistoryUrl!(address)).rejects.toBe(failure);
    expect(api.request).not.toHaveBeenCalled();
    expect(api.close).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    await latest.openHistoryUrl!(address);
    expect(api.create).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("closes the created native tab if foreground publication fails, then permits retry", async () => {
    const failure = new Error("foreground request failed");
    api.request.mockRejectedValueOnce(failure);
    await render();
    await expect(latest.openHistoryUrl!(address)).rejects.toBe(failure);
    expect(api.close).toHaveBeenCalledExactlyOnceWith("history-tab");
    expect(navigate).not.toHaveBeenCalled();
    await latest.openHistoryUrl!(address);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("cleans up the native tab and foreground request when the navigation owner refuses to leave settings", async () => {
    tryNavigate.mockReturnValueOnce(false);
    await render();
    await expect(latest.openHistoryUrl!(address)).rejects.toThrow(
      "navigation was blocked",
    );
    expect(api.consume).toHaveBeenCalledExactlyOnceWith({
      requestId: "history-request",
    });
    expect(api.close).toHaveBeenCalledExactlyOnceWith("history-tab");
    expect(navigate).not.toHaveBeenCalled();
    await latest.openHistoryUrl!(address);
    expect(tryNavigate).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it.each(["menu", "settings-return"])(
    "uses the real navigation owner's live guard for %s if a draft becomes dirty while foreground publication is pending",
    async (source) => {
      let navigation!: ReturnType<typeof useAppNavigation>;
      function AppProbe() {
        navigation = useAppNavigation();
        latest = useBrowserHistoryNavigation({
          page: navigation.requestedPage,
          pageParams: navigation.requestedPageParams,
          navigationRequestId: navigation.navigationRequestId,
          agentLocation: navigation.agentLocation,
          settingsReturnLocation: navigation.settingsReturnLocation,
          navigate: navigation.handleNavigate,
          tryNavigate: navigation.tryNavigate,
        });
        return null;
      }
      const publication = deferred<{ requestId: string }>();
      api.request.mockReturnValue(publication.promise);
      window.sessionStorage.clear();
      await act(async () => root.render(<AppProbe />));
      await act(async () =>
        navigation.handleNavigate(
          "agent",
          buildClawAgentParams({
            initialSessionId: owner.runtimeSessionId,
            projectId: owner.workspaceId,
          }),
        ),
      );
      await act(async () =>
        navigation.handleNavigate("settings", {
          tab: SettingsTabs.Browser,
          browserPage: "history",
          ...(source === "menu" ? { browserReturnOwner: owner } : {}),
        }),
      );
      const open = latest.openHistoryUrl!(address);
      await vi.waitFor(() => expect(api.request).toHaveBeenCalledOnce());
      let unregister = () => {};
      await act(async () => {
        unregister = navigation.navigationGuard.register({
          dirty: true,
          saving: false,
        });
      });
      await act(async () => {
        publication.resolve({ requestId: "guarded-request" });
        await expect(open).rejects.toThrow("navigation was blocked");
      });
      expect(navigation.currentPage).toBe("settings");
      expect(navigation.navigationGuard.pendingNavigation).toBe(false);
      expect(api.consume).toHaveBeenCalledExactlyOnceWith({
        requestId: "guarded-request",
      });
      expect(api.close).toHaveBeenCalledExactlyOnceWith("history-tab");
      await act(async () => unregister());
      window.sessionStorage.clear();
    },
  );

  it("rejects a duplicate dispatch while identity creation is pending", async () => {
    const creation = deferred<BrowserWorkspaceIdentity>();
    api.create.mockReturnValue(creation.promise);
    await render();
    const first = latest.openHistoryUrl!(address);
    await expect(latest.openHistoryUrl!(address)).rejects.toThrow(
      "already opening",
    );
    expect(api.create).toHaveBeenCalledOnce();
    creation.resolve(identity);
    await first;
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("closes a late tab after the user leaves settings and never publishes or navigates", async () => {
    const creation = deferred<BrowserWorkspaceIdentity>();
    api.create.mockReturnValue(creation.promise);
    await render();
    const open = latest.openHistoryUrl!(address);
    const isCurrent = api.create.mock.calls[0][0].isCurrent;
    expect(isCurrent()).toBe(true);
    await render({ page: "skills", navigationRequestId: 4 });
    expect(isCurrent()).toBe(false);
    creation.resolve(identity);
    await open;
    expect(api.close).toHaveBeenCalledExactlyOnceWith("history-tab");
    expect(api.request).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("consumes a stale foreground request and closes its tab even when another settings section retains the owner", async () => {
    const publication = deferred<{ requestId: string }>();
    api.request.mockReturnValue(publication.promise);
    await render();
    const open = latest.openHistoryUrl!(address);
    await Promise.resolve();
    expect(api.request).toHaveBeenCalledOnce();
    await render({
      navigationRequestId: 4,
      pageParams: { tab: SettingsTabs.Appearance, browserReturnOwner: owner },
    });
    publication.resolve({ requestId: "late-request" });
    await open;
    expect(api.consume).toHaveBeenCalledExactlyOnceWith({
      requestId: "late-request",
    });
    expect(api.close).toHaveBeenCalledExactlyOnceWith("history-tab");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("cleans up on application unmount and does not allow an old callback to reopen a page", async () => {
    const publication = deferred<{ requestId: string }>();
    api.request.mockReturnValue(publication.promise);
    await render();
    const callback = latest.openHistoryUrl!;
    const open = callback(address);
    await Promise.resolve();
    await act(async () => root.render(null));
    publication.resolve({ requestId: "unmounted-request" });
    await open;
    await callback(address);
    expect(api.create).toHaveBeenCalledOnce();
    expect(api.consume).toHaveBeenCalledExactlyOnceWith({
      requestId: "unmounted-request",
    });
    expect(api.close).toHaveBeenCalledExactlyOnceWith("history-tab");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("retains the original failure when native cleanup fails and releases the pending lock", async () => {
    const original = new Error("publish failed");
    const cleanup = new Error("close failed");
    api.request.mockRejectedValueOnce(original);
    api.close.mockRejectedValueOnce(cleanup);
    await render();
    await expect(latest.openHistoryUrl!(address)).rejects.toMatchObject({
      errors: [original, cleanup],
    });
    await latest.openHistoryUrl!(address);
    expect(navigate).toHaveBeenCalledOnce();
  });
});

describe("browser history settings return fallback", () => {
  const fallback: Partial<Params> = {
    pageParams: { tab: SettingsTabs.Browser, browserPage: "history" },
    settingsReturnLocation: returnLocation,
  };

  it.each([undefined, owner.workspaceId])(
    "validates the saved workspace root before opening the explicit return thread (server workspace %s)",
    async (workspaceId) => {
      api.getSession.mockResolvedValue({
        ...sessionDetail,
        workspace_id: workspaceId,
      });
      await render(fallback);
      expect(api.getSession).not.toHaveBeenCalled();
      await latest.openHistoryUrl!(address);
      expect(api.getSession).toHaveBeenCalledExactlyOnceWith(
        owner.runtimeSessionId,
        {
          source: "browserHistory",
          historyLimit: 1,
        },
      );
      expect(api.getProject).toHaveBeenCalledExactlyOnceWith(owner.workspaceId);
      expect(api.create).toHaveBeenCalledExactlyOnceWith({
        owner: {
          runtimeSessionId: owner.runtimeSessionId,
          threadId: owner.threadId,
        },
        url: address,
        background: false,
        isCurrent: expect.any(Function),
      });
      expect(api.request.mock.calls[0][0]).toMatchObject({
        sessionId: owner.runtimeSessionId,
        workspaceId: owner.workspaceId,
        metadata: { browser: { launchUrl: address, tabId: identity.tabId } },
      });
      expect(navigate).toHaveBeenCalledExactlyOnceWith(
        "agent",
        buildClawAgentParams({
          initialSessionId: owner.runtimeSessionId,
          projectId: owner.workspaceId,
        }),
      );
      expect(api.close).not.toHaveBeenCalled();
    },
  );

  it.each([
    { page: "agent" as const },
    { settingsReturnLocation: null },
    { settingsReturnLocation: { sessionId: " ", workspaceId: "workspace" } },
    { pageParams: { browserReturnOwner: { ...owner, threadId: " " } } },
  ])(
    "keeps unavailable or malformed targets disabled without selecting another session: %j",
    async (change) => {
      await render({ ...fallback, ...change });
      expect(latest.openHistoryUrl).toBeNull();
      expect(api.getSession).not.toHaveBeenCalled();
      expect(api.create).not.toHaveBeenCalled();
    },
  );

  it("requires the native host before exposing the fallback", async () => {
    api.available.mockReturnValue(false);
    await render(fallback);
    expect(latest.openHistoryUrl).toBeNull();
    expect(api.getSession).not.toHaveBeenCalled();
  });

  it("preserves an explicit detached return scope when the canonical session has no workspace", async () => {
    api.getSession.mockResolvedValue({
      ...sessionDetail,
      workspace_id: undefined,
    });
    await render({
      ...fallback,
      settingsReturnLocation: { ...returnLocation, workspaceId: null },
    });
    await latest.openHistoryUrl!(address);
    expect(api.getProject).not.toHaveBeenCalled();
    expect(api.request.mock.calls[0][0].workspaceId).toBeNull();
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      "agent",
      buildClawAgentParams({
        initialSessionId: owner.runtimeSessionId,
        projectId: undefined,
      }),
    );
  });

  it.each([
    { id: "another-session" },
    { id: " " },
    { thread_id: undefined },
    { thread_id: " " },
    { thread_read: { thread_id: "another-thread" } },
    { thread_read: { thread_id: " " } },
    { workspace_id: "another-workspace" },
    { working_dir: undefined },
    { working_dir: "/another-workspace" },
    { working_dir: "/workspace/project/child" },
    { workspace_id: owner.workspaceId, working_dir: "/another-workspace" },
  ])(
    "rejects canonical identity or scope mismatches before creating a tab and permits a corrected retry: %j",
    async (change) => {
      api.getSession.mockResolvedValueOnce({ ...sessionDetail, ...change });
      await render(fallback);
      await expect(latest.openHistoryUrl!(address)).rejects.toThrow(
        "return owner mismatch",
      );
      expect(api.create).not.toHaveBeenCalled();
      expect(api.request).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
      await latest.openHistoryUrl!(address);
      expect(api.getSession).toHaveBeenCalledTimes(2);
      expect(api.create).toHaveBeenCalledOnce();
    },
  );

  it("does not attach a detached return location to a server workspace", async () => {
    api.getSession.mockResolvedValue({
      ...sessionDetail,
      workspace_id: owner.workspaceId,
    });
    await render({
      ...fallback,
      settingsReturnLocation: { ...returnLocation, workspaceId: null },
    });
    await expect(latest.openHistoryUrl!(address)).rejects.toThrow(
      "return owner mismatch",
    );
    expect(api.create).not.toHaveBeenCalled();
    expect(api.getProject).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { ...workspace, id: "another-workspace" },
    { ...workspace, rootPath: "" },
  ])(
    "rejects a missing or mismatched workspace read and permits retry: %j",
    async (result) => {
      api.getProject.mockResolvedValueOnce(result);
      await render(fallback);
      await expect(latest.openHistoryUrl!(address)).rejects.toThrow(
        "return owner mismatch",
      );
      expect(api.create).not.toHaveBeenCalled();
      expect(api.request).not.toHaveBeenCalled();
      await latest.openHistoryUrl!(address);
      expect(api.create).toHaveBeenCalledOnce();
    },
  );

  it("surfaces a workspace read failure for retry without creating native resources", async () => {
    const failure = new Error("workspace read unavailable");
    api.getProject.mockRejectedValueOnce(failure);
    await render(fallback);
    await expect(latest.openHistoryUrl!(address)).rejects.toBe(failure);
    expect(api.create).not.toHaveBeenCalled();
    expect(api.request).not.toHaveBeenCalled();
    await latest.openHistoryUrl!(address);
    expect(api.create).toHaveBeenCalledOnce();
  });

  it.each(
    ["resolve", "reject"].flatMap((outcome) =>
      ["scope", "navigation", "unmount"].map((change) => [outcome, change]),
    ),
  )(
    "discards a workspace read %s after %s changes its lifetime",
    async (outcome, change) => {
      const read = deferred<typeof workspace>();
      api.getProject.mockReturnValue(read.promise);
      await render(fallback);
      const open = latest.openHistoryUrl!(address);
      await vi.waitFor(() => expect(api.getProject).toHaveBeenCalledOnce());
      if (change === "unmount") await act(async () => root.render(null));
      else
        await render({
          ...fallback,
          ...(change === "navigation"
            ? { navigationRequestId: 4 }
            : {
                settingsReturnLocation: {
                  ...returnLocation,
                  workspaceId: null,
                },
              }),
        });
      if (outcome === "resolve") read.resolve(workspace);
      else read.reject(new Error("late workspace failure"));
      await open;
      expect(api.create).not.toHaveBeenCalled();
      expect(api.request).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    },
  );

  it("surfaces a session read failure for retry without preparing native resources", async () => {
    const failure = new Error("session read unavailable");
    api.getSession.mockRejectedValueOnce(failure);
    await render(fallback);
    await expect(latest.openHistoryUrl!(address)).rejects.toBe(failure);
    expect(api.create).not.toHaveBeenCalled();
    expect(api.request).not.toHaveBeenCalled();
    await latest.openHistoryUrl!(address);
    expect(api.getSession).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("rejects duplicate opens while the canonical read is pending", async () => {
    const read = deferred<typeof sessionDetail>();
    api.getSession.mockReturnValue(read.promise);
    await render(fallback);
    const first = latest.openHistoryUrl!(address);
    await expect(latest.openHistoryUrl!(address)).rejects.toThrow(
      "already opening",
    );
    expect(api.getSession).toHaveBeenCalledOnce();
    read.resolve(sessionDetail);
    await first;
    expect(api.create).toHaveBeenCalledOnce();
  });

  it.each([
    { page: "skills" as const },
    { navigationRequestId: 4 },
    {
      settingsReturnLocation: {
        ...returnLocation,
        sessionId: "another-session",
      },
    },
    {
      settingsReturnLocation: {
        ...returnLocation,
        workspaceId: "another-workspace",
      },
    },
  ])(
    "discards a late read and its old callback after the target changes: %j",
    async (change) => {
      const read = deferred<typeof sessionDetail>();
      api.getSession.mockReturnValue(read.promise);
      await render(fallback);
      const callback = latest.openHistoryUrl!;
      const open = callback(address);
      await render({ ...fallback, ...change });
      read.resolve(sessionDetail);
      await open;
      await callback(address);
      expect(api.getSession).toHaveBeenCalledOnce();
      expect(api.getProject).not.toHaveBeenCalled();
      expect(api.create).not.toHaveBeenCalled();
      expect(api.request).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    },
  );

  it.each(["resolve", "reject"])(
    "ignores a session read %s after unmount",
    async (outcome) => {
      const read = deferred<typeof sessionDetail>();
      api.getSession.mockReturnValue(read.promise);
      await render(fallback);
      const open = latest.openHistoryUrl!(address);
      await act(async () => root.render(null));
      if (outcome === "resolve") read.resolve(sessionDetail);
      else read.reject(new Error("late read failure"));
      await open;
      expect(api.create).not.toHaveBeenCalled();
      expect(api.request).not.toHaveBeenCalled();
    },
  );

  it("closes a late tab if the return workspace changes after canonical resolution", async () => {
    const creation = deferred<BrowserWorkspaceIdentity>();
    api.create.mockReturnValue(creation.promise);
    await render(fallback);
    const open = latest.openHistoryUrl!(address);
    await vi.waitFor(() => expect(api.create).toHaveBeenCalledOnce());
    await render({
      ...fallback,
      settingsReturnLocation: {
        ...returnLocation,
        workspaceId: "new-workspace",
      },
    });
    expect(api.create.mock.calls[0][0].isCurrent()).toBe(false);
    creation.resolve(identity);
    await open;
    expect(api.close).toHaveBeenCalledExactlyOnceWith(identity.tabId);
    expect(api.request).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("consumes a late foreground request and closes the tab if the return session changes", async () => {
    const publication = deferred<{ requestId: string }>();
    api.request.mockReturnValue(publication.promise);
    await render(fallback);
    const open = latest.openHistoryUrl!(address);
    await vi.waitFor(() => expect(api.request).toHaveBeenCalledOnce());
    await render({
      ...fallback,
      settingsReturnLocation: { ...returnLocation, sessionId: "new-session" },
    });
    publication.resolve({ requestId: "late-return-request" });
    await open;
    expect(api.consume).toHaveBeenCalledExactlyOnceWith({
      requestId: "late-return-request",
    });
    expect(api.close).toHaveBeenCalledExactlyOnceWith(identity.tabId);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("browser menu settings navigation", () => {
  it.each(["history", undefined])(
    "captures the matching active workspace at the %s menu boundary",
    async (browserPage) => {
      await render({
        page: "agent",
        agentLocation: {
          sessionId: owner.runtimeSessionId,
          workspaceId: "active-workspace",
        },
      });
      latest.navigateFromBrowser("settings", {
        tab: SettingsTabs.Browser,
        browserPage,
        browserReturnOwner: {
          runtimeSessionId: owner.runtimeSessionId,
          threadId: owner.threadId,
        },
      });
      expect(navigate).toHaveBeenCalledExactlyOnceWith("settings", {
        tab: SettingsTabs.Browser,
        browserPage,
        browserReturnOwner: { ...owner, workspaceId: "active-workspace" },
      });
    },
  );

  it("preserves an active workspace with no project instead of retaining a stale project", async () => {
    await render({
      page: "agent",
      agentLocation: { sessionId: owner.runtimeSessionId, workspaceId: null },
    });
    latest.navigateFromBrowser("settings", {
      tab: SettingsTabs.Browser,
      browserReturnOwner: owner,
    });
    expect(navigate.mock.calls[0][1].browserReturnOwner.workspaceId).toBeNull();
  });

  it.each([
    {
      agentLocation: {
        sessionId: "different-session",
        workspaceId: "wrong-workspace",
      },
    },
    { agentLocation: null },
    { page: "settings" as const },
  ])(
    "drops a stale menu owner without inventing a thread or workspace: %j",
    async (overrides) => {
      await render({ page: "agent", ...overrides });
      latest.navigateFromBrowser("settings", {
        tab: SettingsTabs.Browser,
        browserPage: "history",
        browserReturnOwner: owner,
      });
      expect(navigate).toHaveBeenCalledExactlyOnceWith("settings", {
        tab: SettingsTabs.Browser,
        browserPage: "history",
      });
    },
  );

  it("delegates ordinary application navigation without adding browser state", async () => {
    await render();
    latest.navigateFromBrowser("skills", { initialSearchQuery: "browser" });
    expect(navigate).toHaveBeenCalledExactlyOnceWith("skills", {
      initialSearchQuery: "browser",
    });
  });
});
