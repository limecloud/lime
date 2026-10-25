import { act } from "react";
import {
  AppShell,
  AppShellHeader,
  HeaderAction,
} from "@/components/app-shell/AppShell";
import { AppNavigationContext } from "@/contexts/AppNavigationContext";
import { SettingsTabs } from "@/types/settings";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWorkspaceRightSurfaceHostRuntime,
  type RenderWorkspaceRightSurfaceHostRuntimeParams,
} from "./WorkspaceRightSurfaceHostRuntime";
import type { ThreadOutput } from "./right-surface/threadOutputs";
import type { ThreadSidePanelTab } from "./right-surface/threadSidePanelTabs";
import type { LinkClick } from "@/lib/linkOpening";
import { useWorkspaceRightSurfaceHostRuntime } from "./useWorkspaceRightSurfaceHostRuntime";
import {
  applyWorkspaceRightSurfacePendingChanges,
  buildWorkspaceRightSurfacePendingListParams,
} from "./useWorkspaceRightSurfacePendingRuntime";
import type {
  WorkspaceRightSurfacePendingRequest,
  WorkspaceRightSurfaceRequestParams,
} from "@/lib/api/workspaceRightSurface";

const requestWebsite = vi.hoisted(() =>
  vi.fn<(params: WorkspaceRightSurfaceRequestParams) => Promise<void>>(),
);
const links = vi.hoisted(() => ({
  preferences: vi.fn(),
  external: vi.fn(async () => undefined),
  newTab: vi.fn(),
}));
const actionsProbe = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("./LocalConversationActions", () => ({
  LocalConversationActions: (props: unknown) => {
    actionsProbe.render(props);
    return <button data-testid="actions-probe" />;
  },
}));
vi.mock("@/lib/api/desktopPreferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/desktopPreferences")>()),
  getDesktopPreferences: links.preferences,
}));
vi.mock("@/lib/api/externalUrl", () => ({
  isDefaultBrowser: async () => false,
  openExternalUrlWithSystemBrowser: links.external,
}));
vi.mock("@/lib/api/browserTab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/browserTab")>()),
  isBrowserTabHostAvailable: () => true,
}));
vi.mock("@/lib/api/browserWorkspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/browserWorkspace")>()),
  createBrowserWorkspaceLinkTab: links.newTab,
}));
vi.mock("@/lib/api/workspaceRightSurface", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/workspaceRightSurface")>()),
  requestWorkspaceRightSurface: requestWebsite,
}));
vi.mock("@/lib/api/projectGit", () => ({
  readProjectGitStatus: vi.fn(async () => ({ available: false })),
}));

vi.mock("../components/TerminalTab", () => ({ TerminalTab: () => null }));
vi.mock("./LocalConversationBackgroundTerminalTab", () => ({
  LocalConversationBackgroundTerminalTab: () => null,
}));
vi.mock("../experts/ExpertInfoPanel", () => ({ ExpertInfoPanel: () => null }));
vi.mock("./WorkspaceHarnessDialogs", () => ({
  GeneralWorkbenchHarnessSurfaceSection: () => null,
}));
vi.mock("./WorkspaceArticleEditorRightSurface", () => ({
  WorkspaceArticleEditorRightSurface: () => null,
}));
vi.mock("./WorkspaceFileThreadSidePanelTab", () => ({
  WorkspaceFileThreadSidePanelTab: () => null,
}));
vi.mock("./ReviewThreadSidePanelTab", () => ({
  ReviewThreadSidePanelTab: () => null,
}));
vi.mock("./WorkspacePluginSurface", () => ({
  WorkspacePluginSurface: () => null,
}));
vi.mock("./right-surface/browser/RightSurfaceBrowserPanel", () => ({
  RightSurfaceBrowserPanel: ({
    launchRequestId,
  }: {
    launchRequestId?: string | null;
  }) => (
    <div
      data-testid="browser-launch-probe"
      data-launch-request={launchRequestId ?? ""}
    />
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  links.preferences.mockReset().mockResolvedValue({});
  links.external.mockClear();
  links.newTab.mockReset().mockResolvedValue({
    browserSessionId: "canonical-browser",
    tabId: "canonical-new",
  });
  requestWebsite.mockClear();
  requestWebsite.mockResolvedValue(undefined);
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Recents production Host routing", () => {
  it("mounts conversation Actions beside the existing launcher and delegates to the same coordinator", async () => {
    actionsProbe.render.mockClear();
    const runAction = vi.fn();
    const navigate = vi.fn();
    const params = {
      canvasWorkbenchRootPath: "/project",
      sceneSessionId: "session",
      sceneThreadId: "thread",
      rightSurfaceRuntime: {
        sidePanelTabs: { open: false, activeTabId: null, tabs: [] },
        rightSurfaceState: {
          activeSurface: null,
          previousSurface: null,
          openSurfaces: [],
          source: "user",
          layoutVariant: "docked",
        },
        rightSurfaceLaunchers: [{ kind: "shell", disabled: false }],
        outputs: [],
        getFileDraft: () => null,
        setFileDraft: vi.fn(),
        handleCloseSidePanelTab: vi.fn(),
        handleRunAction: runAction,
      },
      handleSendRef: { current: vi.fn() },
      restoreInput: vi.fn(),
      setLayoutMode: vi.fn(),
    } as unknown as Parameters<typeof useWorkspaceRightSurfaceHostRuntime>[0];
    function Probe() {
      const { launcher } = useWorkspaceRightSurfaceHostRuntime(params);
      return <HeaderAction actionId="actions-test">{launcher}</HeaderAction>;
    }
    await act(async () =>
      root.render(
        <AppShell>
          <AppShellHeader />
          <AppNavigationContext.Provider value={navigate}>
            <Probe />
          </AppNavigationContext.Provider>
        </AppShell>,
      ),
    );
    expect(
      container.querySelector('[data-testid="actions-probe"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="thread-side-panel-toggle"]'),
    ).not.toBeNull();
    expect(actionsProbe.render).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaceRoot: "/project",
        onRunAction: runAction,
        loading: false,
        onConfigureActions: expect.any(Function),
      }),
    );
    act(() =>
      actionsProbe.render.mock.lastCall?.[0].onConfigureActions(
        "/project/.lime/environments/environment.toml",
      ),
    );
    expect(navigate).toHaveBeenCalledExactlyOnceWith("settings", {
      tab: SettingsTabs.LocalEnvironments,
      localEnvironmentFocus: {
        workspaceRoot: "/project",
        configPath: "/project/.lime/environments/environment.toml",
        requestKey: expect.any(Number),
      },
    });
  });
  it.each([
    { historical: false, applied: false, expected: "browser-request" },
    { historical: true, applied: false, expected: "browser-request" },
    { historical: true, applied: true, expected: "" },
  ])(
    "无导航URL的Browser请求仍转发展示确认：%j",
    async ({ historical, applied, expected }) => {
      const tabs = {
        open: true,
        activeTabId: "browser-tab",
        tabs: [{ tabId: "browser-tab", kind: "browser" }],
      };
      const params = {
        canvasWorkbenchRootPath: "/project",
        runtimeWorkspaceId: "workspace",
        sceneSessionId: "session",
        sceneThreadId: "thread",
        rightSurfaceRuntime: {
          sidePanelTabs: tabs,
          rightSurfaceState: {
            activeSurface: "browser",
            previousSurface: null,
            openSurfaces: ["browser"],
            source: "user",
            layoutVariant: "docked",
          },
          browserRightSurfaceAvailable: true,
          browserRightSurfaceIntent: {
            sourceRequestId: "browser-request",
            launchApplied: applied,
            historicalProjection: historical ? { readOnly: true } : null,
          },
          rightSurfaceLaunchers: [],
          outputs: [],
          getFileDraft: () => null,
          setFileDraft: vi.fn(),
          setNewTabAddressDraft: vi.fn(),
          handleCloseSidePanelTab: vi.fn(),
        },
        handleSendRef: { current: vi.fn() },
        restoreInput: vi.fn(),
        setLayoutMode: vi.fn(),
      } as unknown as Parameters<typeof useWorkspaceRightSurfaceHostRuntime>[0];
      function Probe() {
        return useWorkspaceRightSurfaceHostRuntime(params).content;
      }
      await act(async () => root.render(<Probe />));
      expect(
        container
          .querySelector('[data-testid="browser-launch-probe"]')
          ?.getAttribute("data-launch-request"),
      ).toBe(expected);
    },
  );

  it.each([
    [{ type: "website", target: "http://localhost:4317/demo" }, null],
    [{ type: "website", target: "out/index.html" }, "/project/out/index.html"],
    [{ type: "file", path: "/project/report.pdf" }, "/project/report.pdf"],
    [
      { type: "generated-image", path: "/project/image.png" },
      "/project/image.png",
    ],
  ] as const)(
    "routes %j through the existing owner with the reference source-tab policy",
    (resource, path) => {
      const source: ThreadSidePanelTab = {
        tabId: "new-tab:source",
        kind: "workspace-new-tab",
      };
      const output: ThreadOutput = {
        ...resource,
        threadId: "thread",
        turnId: "turn",
        itemId: "item",
      };
      const onOpenWebsite = vi.fn(),
        onOpenWorkspaceFile = vi.fn();
      // 非活动surface的props不会被求值；实际渲染New tab、Recents和共享Host。
      const params = {
        idPrefix: "recents-host",
        outputs: [output],
        onOpenWebsite,
        onOpenWorkspaceFile,
        canvasWorkbenchRootPath: "/project",
        sidePanelActions: [],
        sidePanelTabs: {
          open: true,
          activeTabId: source.tabId,
          tabs: [source],
        },
        rightSurfaceState: {
          activeSurface: "workspace-new-tab",
          previousSurface: null,
          openSurfaces: ["workspace-new-tab"],
          source: "user",
          layoutVariant: "docked",
        },
      } as RenderWorkspaceRightSurfaceHostRuntimeParams;
      act(() =>
        root.render(renderWorkspaceRightSurfaceHostRuntime(params).content),
      );
      const button = container.querySelector<HTMLButtonElement>("ul button")!;
      expect(button).not.toBeNull();
      act(() => button.click());
      if (path) {
        if (resource.type === "website") {
          expect(onOpenWorkspaceFile).toHaveBeenCalledExactlyOnceWith(path);
        } else {
          expect(onOpenWorkspaceFile).toHaveBeenCalledExactlyOnceWith(
            path,
            source,
          );
          expect(onOpenWorkspaceFile.mock.calls[0][1]).toBe(source);
        }
        expect(onOpenWebsite).not.toHaveBeenCalled();
      } else {
        expect(onOpenWebsite).toHaveBeenCalledExactlyOnceWith(
          "http://localhost:4317/demo",
          expect.objectContaining({ button: 0 }),
        );
        expect(onOpenWorkspaceFile).not.toHaveBeenCalled();
        expect(
          container.querySelector('[data-testid="thread-side-panel-new-tab"]'),
        ).not.toBeNull();
      }
    },
  );

  it.each<{
    external: boolean;
    platform: string;
    click: LinkClick;
    newTab: boolean;
    background: boolean;
  }>([
    {
      external: false,
      platform: "MacIntel",
      click: {},
      newTab: false,
      background: false,
    },
    {
      external: true,
      platform: "MacIntel",
      click: {},
      newTab: false,
      background: false,
    },
    {
      external: true,
      platform: "MacIntel",
      click: { metaKey: true },
      newTab: false,
      background: false,
    },
    {
      external: false,
      platform: "MacIntel",
      click: { ctrlKey: true },
      newTab: false,
      background: false,
    },
    {
      external: false,
      platform: "Win32",
      click: { ctrlKey: true, shiftKey: true },
      newTab: true,
      background: false,
    },
    {
      external: false,
      platform: "MacIntel",
      click: { button: 1 },
      newTab: true,
      background: true,
    },
  ])(
    "真实Host hook消费local偏好/点击意图并保留作用域：%j",
    async ({ external, platform, click, newTab, background }) => {
      vi.spyOn(window.navigator, "platform", "get").mockReturnValue(platform);
      links.preferences.mockResolvedValue({
        "open-local-url-in-target-preference":
          external && !click.metaKey ? "external-browser" : "in-app-browser",
      });
      const source: ThreadSidePanelTab = {
        tabId: "new-tab:website",
        kind: "workspace-new-tab",
      };
      const tabs = { open: true, activeTabId: source.tabId, tabs: [source] };
      const state = {
        activeSurface: "workspace-new-tab",
        previousSurface: null,
        openSurfaces: ["workspace-new-tab"],
        source: "user",
        layoutVariant: "docked",
      };
      const outputs: ThreadOutput[] = [
        {
          type: "website",
          target: "http://localhost:4317/demo",
          threadId: "thread",
          turnId: "turn",
          itemId: "website-message",
        },
      ];
      const params = {
        sidePanelTabs: tabs,
        rightSurfaceState: state,
        canvasWorkbenchRootPath: "/project",
        runtimeWorkspaceId: "workspace",
        sceneSessionId: "session",
        sceneThreadId: "thread",
        rightSurfaceRuntime: {
          sidePanelTabs: tabs,
          rightSurfaceState: state,
          rightSurfaceLaunchers: [],
          outputs,
          getFileDraft: () => null,
          setFileDraft: vi.fn(),
          setNewTabAddressDraft: vi.fn(),
          handleCloseSidePanelTab: vi.fn(),
          openWorkspaceFile: vi.fn(),
          openBrowserInBackground: vi.fn(),
        },
        handleSendRef: { current: vi.fn() },
        restoreInput: vi.fn(),
        setLayoutMode: vi.fn(),
      } as unknown as Parameters<typeof useWorkspaceRightSurfaceHostRuntime>[0];
      function Probe() {
        return useWorkspaceRightSurfaceHostRuntime(params).content;
      }
      await act(async () => root.render(<Probe />));
      const button = container.querySelector<HTMLButtonElement>("ul button")!;
      await act(async () =>
        button.dispatchEvent(
          new MouseEvent(click.button === 1 ? "auxclick" : "click", {
            bubbles: true,
            cancelable: true,
            ...click,
          }),
        ),
      );
      if (external) {
        expect(links.external).toHaveBeenCalledExactlyOnceWith(
          "http://localhost:4317/demo",
        );
        expect(requestWebsite).not.toHaveBeenCalled();
        expect(
          container.querySelector('[data-testid="thread-side-panel-new-tab"]'),
        ).not.toBeNull();
        return;
      }
      if (newTab) {
        expect(links.newTab).toHaveBeenCalledWith(
          expect.objectContaining({
            owner: { runtimeSessionId: "session", threadId: "thread" },
            url: "http://localhost:4317/demo",
            background,
          }),
        );
      } else expect(links.newTab).not.toHaveBeenCalled();
      if (background) {
        expect(
          params.rightSurfaceRuntime.openBrowserInBackground,
        ).toHaveBeenCalledOnce();
        expect(requestWebsite).not.toHaveBeenCalled();
        expect(
          container.querySelector('[data-testid="thread-side-panel-new-tab"]'),
        ).not.toBeNull();
        return;
      }
      expect(requestWebsite).toHaveBeenCalledOnce();
      const request = requestWebsite.mock.calls[0]?.[0];
      expect(request).toMatchObject({
        surfaceKind: "browser",
        sessionId: "session",
        workspaceId: "workspace",
        workspaceRoot: "/project",
        priority: "foreground",
        metadata: { browser: { launchUrl: "http://localhost:4317/demo" } },
      });
      if (newTab)
        expect(request).toMatchObject({
          metadata: { browser: { tabId: "canonical-new" } },
        });
      const pending = {
        ...request,
        requestId: "website-request",
        status: "pending",
        requestedAt: "2026-10-21T00:00:00Z",
      } as WorkspaceRightSurfacePendingRequest;
      const listParams = buildWorkspaceRightSurfacePendingListParams({
        workspaceId: "workspace",
        workspaceRoot: "/project",
        sessionId: "session",
      });
      expect(
        applyWorkspaceRightSurfacePendingChanges(
          [],
          [{ changeType: "requested", pending: [pending] }],
          listParams,
        ),
      ).toEqual([pending]);
    },
  );
});
