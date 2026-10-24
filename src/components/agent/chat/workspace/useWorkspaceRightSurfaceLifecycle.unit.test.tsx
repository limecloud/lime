import { RightSurfaceHost } from "./right-surface/RightSurfaceHost";
import { RightSurfaceTabStrip } from "./right-surface/RightSurfaceTabStrip";
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayoutMode } from "@/lib/workspace/workbenchContract";
import { useWorkspaceRightSurfaceCoordinatorRuntime } from "./useWorkspaceRightSurfaceCoordinatorRuntime";
import {
  useWorkspaceRightSurfaceLocalStateRuntime,
  type WorkspaceRightSurfaceOwner,
} from "./useWorkspaceRightSurfaceLocalStateRuntime";
import type { AgentThreadItem } from "../types";
import { buildWorkspaceRightSurfaceDefinitions } from "./right-surface";
import type { WorkspaceArticleWorkspace } from "./workspaceArticleWorkspaceModel";
import type { WorkspacePluginSurfaceDescriptor } from "./workspacePluginSurfaceModel";
import type { WorkspaceRightSurfaceBrowserIntent } from "./workspaceRightSurfaceBrowserIntent";

const pending = vi.hoisted(() => ({
  pendingIntents: [],
  pendingBrowserIntent: null as WorkspaceRightSurfaceBrowserIntent | null,
  pendingFileTarget: null,
  refreshPendingRequests: vi.fn(async () => undefined),
  consumePendingRequestsForSurface: vi.fn(async () => undefined),
  dismissPendingRequestsForSurface: vi.fn(async () => undefined),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? _key,
  }),
}));
vi.mock("./useWorkspaceRightSurfacePendingBridgeRuntime", () => ({
  useWorkspaceRightSurfacePendingBridgeRuntime: () => pending,
}));

const owner: WorkspaceRightSurfaceOwner = {
  workspaceId: "workspace-a",
  sessionId: "session-a",
  threadId: "thread-a",
};
const file = { relativePath: "src/main.ts", title: "main.ts" };
const article: WorkspaceArticleWorkspace = {
  schemaVersion: "article-workspace.v1",
  appId: "content-factory-app",
  sessionId: "session-a",
  workspaceId: "workspace-a",
  source: "threadRead",
  objects: [],
  objectCount: 0,
  actionHistory: [],
  selectedObjectRef: {
    appId: "content-factory-app",
    sessionId: "session-a",
    kind: "articleDraft",
    id: "draft-selected",
  },
};
const plugin: WorkspacePluginSurfaceDescriptor = {
  appId: "app-a",
  containerId: "container-a",
  title: "App A",
  mcpApp: {
    serverName: "codex_apps",
    connectorId: "demo",
    resourceUri: "ui://demo/view.html",
    toolItemId: "item-demo",
  },
};
const threadItems: never[] = [];
const noop = () => undefined;
const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

interface Props {
  threadItems?: readonly AgentThreadItem[];
  owner: WorkspaceRightSurfaceOwner;
  articleAvailable: boolean;
  shellAvailable: boolean;
  suppressUtilities: boolean;
}

function useLifecycle(props: Props) {
  const local = useWorkspaceRightSurfaceLocalStateRuntime(props.owner);
  const [layout, setLayout] = useState<LayoutMode>("chat");
  const [expertCollapsed, setExpertCollapsed] = useState(true);
  const [, setHarness] = useState(false);
  const coordinator = useWorkspaceRightSurfaceCoordinatorRuntime({
    articleEditorRightSurface: local.activeArticleWorkspace ?? article,
    articleEditorRightSurfaceAvailable: props.articleAvailable,
    bindRightSurfacePendingActions: noop,
    canvasWorkbenchRootPath: "/workspace/project",

    expertInfoPanelCollapsed: expertCollapsed,
    expertInfoPanelVisible: !expertCollapsed,
    handleToggleCanvas: () =>
      setLayout((current) => (current === "chat" ? "canvas" : "chat")),
    harnessPendingCount: 0,
    hasExpertInfoPanel: true,
    localState: local,
    preferredServiceSkillResultFileTarget: file,
    runtimeWorkspaceId: props.owner.workspaceId,
    sceneIsPreparingSend: false,
    sceneIsSending: false,
    sceneLayoutMode: layout,
    sceneSessionId: props.owner.sessionId,
    sceneThreadId: props.owner.threadId,
    sessionId: props.owner.sessionId,
    shellRightSurfaceAvailable: props.shellAvailable,
    showHarnessToggle: true,
    suppressHomeNavbarUtilityActions: props.suppressUtilities,
    taskCenterHomeHotpathActive: false,
    threadItems: props.threadItems ?? threadItems,
    setExpertInfoPanelCollapsed: setExpertCollapsed,
    setHarnessPanelVisible: setHarness,
    setLayoutMode: setLayout,
  });
  return { local, coordinator };
}

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  let latest!: ReturnType<typeof useLifecycle>;
  const props: Props = {
    owner,
    articleAvailable: true,
    shellAvailable: true,
    suppressUtilities: false,
  };
  function Probe(current: Props) {
    latest = useLifecycle(current);
    if (!latest.coordinator.rightSurfaceState.activeSurface) return null;
    const definitions = buildWorkspaceRightSurfaceDefinitions({
      browser: () => <div>{latest.coordinator.rightSurfaceBrowserTitle}</div>,
      files: ({ tab }) => <div>{tab.filePath ?? "Open file"}</div>,
      articleWorkspace: () => (
        <div>{latest.local.activeArticleWorkspace?.selectedObjectRef?.id}</div>
      ),
      shell: () => <div>Shell output</div>,
      expertInfo: () => <div>Expert info</div>,
      appSurface: () => <div>Plugin</div>,
    });
    return (
      <>
        <RightSurfaceTabStrip
          idPrefix="right-lifecycle"
          tabs={latest.coordinator.sidePanelTabs.tabs}
          activeTabId={latest.coordinator.sidePanelTabs.activeTabId}
          previewTabId={latest.coordinator.sidePanelTabs.previewTabId ?? null}
          onNewTab={latest.coordinator.handleNewSidePanelTab}
          onSelectTab={latest.coordinator.handleSelectSidePanelTab}
          onCloseTab={latest.coordinator.handleCloseSidePanelTab}
          definitions={definitions}
        />
        <RightSurfaceHost
          idPrefix="right-lifecycle"
          tabId={latest.coordinator.sidePanelTabs.activeTabId ?? ""}
          activeSurface={latest.coordinator.rightSurfaceState.activeSurface}
          definitions={definitions}
          tabs={latest.coordinator.sidePanelTabs.tabs}
          onPinTab={latest.coordinator.pinSidePanelTab}
          previewTabId={latest.coordinator.sidePanelTabs.previewTabId ?? null}
        />
      </>
    );
  }
  const render = (changes: Partial<Props> = {}) => {
    Object.assign(props, changes);
    act(() => root.render(<Probe {...props} />));
  };
  render();
  return { get: () => latest, render, container };
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  pending.pendingBrowserIntent = null;
});
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

describe("Right Surface 标签生命周期接线", () => {
  it("文件草稿归同一内容实例；关闭重开及owner变化拒绝旧回调", () => {
    const view = mount();
    act(() => view.get().local.openSidePanelTab("files"));
    const picker = view.get().local.sidePanelTabs.tabs[0];
    act(() => view.get().local.openWorkspaceFile("/workspace/a.ts", picker));
    const first = view.get().local.sidePanelTabs.tabs[0];
    const draft = {
      content: "local",
      document: { kind: "ready" as const, baseContent: "base" },
    };
    view.get().local.setFileDraft(first, draft);
    expect(view.get().coordinator.getFileDraft(first)).toBe(draft);
    act(() => view.get().local.openWorkspaceFile("/workspace/b.ts", first));
    const second = view.get().local.sidePanelTabs.tabs[1];
    expect(view.get().local.getFileDraft(second)).toBeNull();
    expect(view.get().local.getFileDraft(first)).toBe(draft);
    const stale = view.get().local;
    act(() => stale.closeSidePanelTab(first.tabId));
    act(() => view.get().local.openWorkspaceFile("/workspace/a.ts", second));
    const reopened = view.get().local.sidePanelTabs.tabs[1];
    stale.setFileDraft(first, draft);
    expect(view.get().local.getFileDraft(reopened)).toBeNull();
    view.get().local.setFileDraft(reopened, draft);
    const prior = view.get().local;
    view.render({
      owner: { ...owner, sessionId: "session-b", threadId: "thread-b" },
    });
    prior.setFileDraft(reopened, draft);
    expect(prior.getFileDraft(reopened)).toBeNull();
    expect(view.get().local.getFileDraft(reopened)).toBeNull();
  });

  it("后台输出标签无项目目录也能打开，关闭不干预后台进程且拒绝跨线程迟到动作", () => {
    const view = mount();
    const item = {
      id: "command",
      thread_id: "thread-a",
      turn_id: "turn-a",
      type: "command_execution",
      process_id: "process-a",
      command: "npm test",
    } as AgentThreadItem;
    view.render({ shellAvailable: false, threadItems: [item] });
    act(() => view.get().coordinator.openBackgroundTerminal(item));
    const opened = view.get().local.sidePanelTabs.tabs[0];
    expect(opened).toMatchObject({
      kind: "background-terminal",
      backgroundTerminal: {
        threadId: "thread-a",
        turnId: "turn-a",
        itemId: "command",
      },
    });
    expect(view.get().coordinator.rightSurfaceState.activeSurface).toBe(
      "background-terminal",
    );
    const lateOpen = view.get().coordinator.openBackgroundTerminal;
    act(() => view.get().coordinator.handleCloseSidePanelTab(opened.tabId));
    expect(view.get().local.sidePanelTabs.tabs).toHaveLength(0);
    expect(pending.dismissPendingRequestsForSurface).not.toHaveBeenCalled();
    view.render({ owner: { ...owner, threadId: "thread-b" } });
    act(() => lateOpen(item));
    expect(view.get().local.sidePanelTabs.tabs).toHaveLength(0);
  });
  it("same item ids in different turns open the requested canonical output without a live process id", () => {
    const view = mount();
    const first = {
      id: "reused",
      type: "command_execution",
      thread_id: "thread-a",
      turn_id: "first",
      command: "first command",
    } as AgentThreadItem;
    const second = { ...first, turn_id: "second", command: "second command" };
    view.render({ threadItems: [first, second] });
    act(() => view.get().coordinator.openBackgroundTerminal(second));
    expect(view.get().local.sidePanelTabs.tabs[0]).toMatchObject({
      title: "second command",
      backgroundTerminal: {
        threadId: "thread-a",
        turnId: "second",
        itemId: "reused",
      },
    });
    act(() =>
      view
        .get()
        .coordinator.openBackgroundTerminal({ ...second, turn_id: "unloaded" }),
    );
    expect(view.get().local.sidePanelTabs.tabs).toHaveLength(1);
  });
  it("文件选择进入路径标签，切回已有路径不产生空Files或丢掉其它路径", () => {
    const view = mount();
    act(() => view.get().coordinator.handleSelectRightSurfaceTab("files"));
    const picker = view.get().local.sidePanelTabs.tabs[0];
    act(() =>
      view
        .get()
        .coordinator.openWorkspaceFile("/workspace/project/a.ts", picker),
    );
    const first = view.get().local.sidePanelTabs.tabs[0];
    act(() =>
      view
        .get()
        .coordinator.openWorkspaceFile("/workspace/project/b.ts", first),
    );
    act(() => view.get().coordinator.handleSelectSidePanelTab(first.tabId));
    expect(
      view.get().local.sidePanelTabs.tabs.map((tab) => tab.filePath),
    ).toEqual(["/workspace/project/a.ts", "/workspace/project/b.ts"]);
    expect(view.get().local.sidePanelTabs.activeTabId).toBe(first.tabId);
    expect(
      view.container.querySelector(
        '[data-testid="workspace-right-surface-active-pane"]',
      )?.textContent,
    ).toBe("/workspace/project/a.ts");
    act(() => view.get().coordinator.handleCloseSidePanelTab(first.tabId));
    expect(
      view.get().local.sidePanelTabs.tabs.map((tab) => tab.filePath),
    ).toEqual(["/workspace/project/b.ts"]);
    act(() =>
      view
        .get()
        .coordinator.openWorkspaceFile("/workspace/project/late.ts", first),
    );
    expect(view.get().local.sidePanelTabs.tabs).toHaveLength(1);
  });
  it("可用 launcher 不会自动打开标签", () => {
    const view = mount();
    expect(view.get().coordinator.rightSurfaceLaunchers.length).toBeGreaterThan(
      0,
    );
    expect(view.get().coordinator.rightSurfaceState.openSurfaces).toEqual([]);
    expect(view.container.querySelectorAll('[role="tab"]')).toHaveLength(0);
  });

  it("选择已有 New tab 不增加标签；Chat 关闭对应身份并恢复现有编辑器焦点", () => {
    const view = mount();
    const host = document.createElement("div");
    host.setAttribute("data-composer-editor-host", "true");
    const editor = document.createElement("div");
    editor.setAttribute("role", "textbox");
    editor.setAttribute("contenteditable", "true");
    editor.tabIndex = 0;
    editor.textContent = "unsent draft";
    host.append(editor);
    document.body.append(host);
    try {
      act(() => view.get().coordinator.handleNewSidePanelTab());
      const tabId = view.get().local.sidePanelTabs.activeTabId!;
      act(() => view.get().coordinator.handleSelectRightSurfaceTab("browser"));
      act(() => view.get().coordinator.handleSelectSidePanelTab(tabId));
      expect(view.get().local.sidePanelTabs.tabs).toHaveLength(2);
      act(() => view.get().coordinator.handleSelectChatFromNewTab(tabId));
      expect(
        view.get().local.sidePanelTabs.tabs.map((tab) => tab.kind),
      ).toEqual(["browser"]);
      expect(view.get().local.sidePanelTabs.open).toBe(false);
      expect(document.activeElement).toBe(editor);
      expect(editor.textContent).toBe("unsent draft");
    } finally {
      host.remove();
    }
  });

  it("关闭 New tab 后的迟到动作不消费请求或改变当前面板", () => {
    const view = mount();
    act(() => view.get().coordinator.handleNewSidePanelTab());
    const tabId = view.get().local.sidePanelTabs.activeTabId!;
    const select = view.get().coordinator.handleSelectRightSurfaceTab;
    act(() => view.get().coordinator.handleCloseSidePanelTab(tabId));
    pending.refreshPendingRequests.mockClear();
    pending.consumePendingRequestsForSurface.mockClear();
    act(() => select("browser", tabId));
    expect(view.get().local.sidePanelTabs.tabs).toHaveLength(0);
    expect(view.get().coordinator.rightSurfaceState.activeSurface).toBeNull();
    expect(pending.refreshPendingRequests).not.toHaveBeenCalled();
    expect(pending.consumePendingRequestsForSurface).not.toHaveBeenCalled();
  });

  it("已展示的前台Browser请求在等待确认期间不抢回用户的新标签或Files选择", () => {
    pending.pendingBrowserIntent = {
      source: "rightSurfacePending",
      sourceRequestId: "browser-request-first",
      origin: "user",
      priority: "foreground",
      launchUrl: "https://example.com/first",
    };
    const view = mount();
    expect(view.get().coordinator.rightSurfaceState.activeSurface).toBe(
      "browser",
    );
    expect(pending.consumePendingRequestsForSurface).not.toHaveBeenCalled();
    act(() =>
      view
        .get()
        .coordinator.handleBrowserLaunchApplied("browser-request-first"),
    );
    expect(
      pending.consumePendingRequestsForSurface,
    ).toHaveBeenCalledExactlyOnceWith("browser", ["browser-request-first"]);

    act(() =>
      view.container
        .querySelector('[data-testid="workspace-right-surface-new-tab"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    const newTabId = view.get().local.sidePanelTabs.activeTabId;
    expect(view.get().coordinator.rightSurfaceState.activeSurface).toBe(
      "workspace-new-tab",
    );
    view.render();
    expect(view.get().local.sidePanelTabs.activeTabId).toBe(newTabId);

    act(() => view.get().coordinator.handleSelectRightSurfaceTab("files"));
    expect(view.get().coordinator.rightSurfaceState.activeSurface).toBe(
      "files",
    );
    // 只有显式Files动作额外消费一次，旧Browser请求不能再消费或改变选择。
    expect(pending.consumePendingRequestsForSurface.mock.calls).toEqual([
      ["browser", ["browser-request-first"]],
      ["files"],
    ]);

    pending.pendingBrowserIntent = {
      ...pending.pendingBrowserIntent,
      sourceRequestId: "browser-request-next",
      launchUrl: "https://example.com/next",
    };
    view.render();
    expect(view.get().coordinator.rightSurfaceState.activeSurface).toBe(
      "browser",
    );
    expect(
      view.get().local.activeBrowserRightSurfaceIntent?.sourceRequestId,
    ).toBe("browser-request-next");
    expect(pending.consumePendingRequestsForSurface).toHaveBeenCalledTimes(2);
    act(() =>
      view.get().coordinator.handleBrowserLaunchApplied("browser-request-next"),
    );
    expect(pending.consumePendingRequestsForSurface).toHaveBeenLastCalledWith(
      "browser",
      ["browser-request-next"],
    );
    expect(pending.consumePendingRequestsForSurface).toHaveBeenCalledTimes(3);

    act(() => view.get().coordinator.handleToggleRightSurfaceBrowser());
    expect(view.get().local.sidePanelTabs.open).toBe(true);
    expect(view.get().coordinator.rightSurfaceState.activeSurface).not.toBe(
      "browser",
    );
    const selectedAfterClose = view.get().local.sidePanelTabs.activeTabId;
    view.render();
    expect(view.get().local.sidePanelTabs.activeTabId).toBe(selectedAfterClose);
    expect(
      view.get().local.sidePanelTabs.tabs.some((tab) => tab.kind === "browser"),
    ).toBe(false);
    expect(pending.consumePendingRequestsForSurface).toHaveBeenCalledTimes(3);
  });

  it("后台Browser请求不改变选择，换owner后可接收自己的同名新请求", () => {
    const view = mount();
    act(() => view.get().coordinator.handleNewSidePanelTab());
    const tabId = view.get().local.sidePanelTabs.activeTabId;
    pending.pendingBrowserIntent = {
      source: "rightSurfacePending",
      sourceRequestId: "browser-request",
      origin: "user",
      priority: "background",
      launchUrl: "https://example.com/background",
    };
    view.render();
    expect(view.get().local.sidePanelTabs.activeTabId).toBe(tabId);
    expect(pending.consumePendingRequestsForSurface).not.toHaveBeenCalled();
    pending.pendingBrowserIntent = {
      ...pending.pendingBrowserIntent,
      priority: "foreground",
    };
    view.render();
    expect(view.get().coordinator.rightSurfaceState.activeSurface).toBe(
      "browser",
    );
    expect(pending.consumePendingRequestsForSurface).not.toHaveBeenCalled();
    act(() =>
      view.get().coordinator.handleBrowserLaunchApplied("browser-request"),
    );
    expect(
      pending.consumePendingRequestsForSurface,
    ).toHaveBeenCalledExactlyOnceWith("browser", ["browser-request"]);
    view.render({
      owner: { ...owner, sessionId: "session-b", threadId: "thread-b" },
    });
    expect(view.get().local.owner.threadId).toBe("thread-b");
    expect(view.get().coordinator.rightSurfaceState.activeSurface).toBe(
      "browser",
    );
    expect(pending.consumePendingRequestsForSurface).toHaveBeenCalledTimes(1);
    act(() =>
      view.get().coordinator.handleBrowserLaunchApplied("browser-request"),
    );
    expect(pending.consumePendingRequestsForSurface.mock.calls).toEqual([
      ["browser", ["browser-request"]],
      ["browser", ["browser-request"]],
    ]);
  });

  it("Browser打开请求只确认当前身份，关闭重开保留已应用标记", () => {
    const view = mount();
    act(() =>
      view.get().local.setActiveBrowserRightSurfaceIntent({
        source: "rightSurfacePending",
        sourceRequestId: "request-current",
        origin: "user",
        priority: "foreground",
        launchUrl: "http://localhost:4317/",
      }),
    );
    act(() => view.get().coordinator.handleBrowserLaunchApplied("request-old"));
    expect(
      view.get().local.activeBrowserRightSurfaceIntent?.launchApplied,
    ).not.toBe(true);
    act(() =>
      view.get().coordinator.handleBrowserLaunchApplied("request-current"),
    );
    expect(
      view.get().local.activeBrowserRightSurfaceIntent?.launchApplied,
    ).toBe(true);
    act(() => view.get().coordinator.handleToggleRightSurfaceBrowser());
    act(() => view.get().coordinator.handleCloseRightSurfaceTab("browser"));
    act(() => view.get().coordinator.handleToggleRightSurfaceBrowser());
    expect(view.get().local.activeBrowserRightSurfaceIntent).toMatchObject({
      sourceRequestId: "request-current",
      launchApplied: true,
    });
  });
  it("Browser → Files → Browser 保留标签、Browser 标题和 Files 目标", () => {
    const view = mount();
    act(() => view.get().coordinator.handleToggleRightSurfaceBrowser());
    act(() =>
      view
        .get()
        .coordinator.handleRightSurfaceBrowserNavigate(
          "https://example.com",
          "Browser selected tab",
        ),
    );
    act(() => view.get().coordinator.handleToggleRightSurfaceFiles());
    expect(view.get().coordinator.rightSurfaceState.openSurfaces).toEqual([
      "browser",
      "files",
    ]);
    act(() =>
      view.container
        .querySelector('[data-testid="workspace-right-surface-tab-browser"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(
      view.container
        .querySelector('[data-testid="workspace-right-surface-host"]')
        ?.getAttribute("data-surface"),
    ).toBe("browser");
    expect(
      Array.from(view.container.querySelectorAll('[role="tab"]'), (element) =>
        element.getAttribute("data-testid"),
      ),
    ).toEqual([
      "workspace-right-surface-tab-browser",
      "workspace-right-surface-tab-files",
    ]);
    expect(view.get().coordinator.rightSurfaceBrowserTitle).toBe(
      "Browser selected tab",
    );
    expect(view.get().local.activeFilesRightSurfaceTarget).toEqual(file);
    act(() => view.get().coordinator.handleSelectRightSurfaceTab("files"));
    expect(view.get().coordinator.filesRightSurfaceTarget).toEqual(file);
  });

  it("Article → Files → Article 保留 selected object 和文章显示意图", () => {
    const view = mount();
    act(() => view.get().local.openArticleWorkspaceRightSurface(article));
    act(() => view.get().coordinator.handleSelectRightSurfaceTab("files"));
    expect(view.get().local.activeArticleWorkspace).toBe(article);
    act(() =>
      view.get().coordinator.handleSelectRightSurfaceTab("articleWorkspace"),
    );
    expect(view.get().local.activeArticleWorkspace?.selectedObjectRef?.id).toBe(
      "draft-selected",
    );
    expect(view.get().local.activeFilesRightSurfaceTarget).toEqual(file);
    expect(view.get().coordinator.rightSurfaceState.openSurfaces).toEqual([
      "articleWorkspace",
      "files",
    ]);
  });

  it("Shell 后台关闭只删除 Shell；选中关闭回退到 Browser", () => {
    const view = mount();
    act(() => view.get().coordinator.handleToggleRightSurfaceBrowser());
    act(() => view.get().coordinator.handleToggleRightSurfaceShell());
    act(() => view.get().coordinator.handleSelectRightSurfaceTab("browser"));
    act(() =>
      view
        .get()
        .coordinator.handleCloseSidePanelTab(
          view
            .get()
            .local.sidePanelTabs.tabs.find((tab) => tab.kind === "shell")!
            .tabId,
        ),
    );
    expect(view.get().coordinator.rightSurfaceState.openSurfaces).toEqual([
      "browser",
    ]);
    expect(view.get().coordinator.rightSurfaceState.activeSurface).toBe(
      "browser",
    );
    act(() => view.get().coordinator.handleToggleRightSurfaceShell());
    act(() => view.get().coordinator.handleToggleRightSurfaceShell());
    expect(view.get().coordinator.rightSurfaceState.activeSurface).toBe(
      "browser",
    );
    expect(pending.dismissPendingRequestsForSurface).toHaveBeenCalledWith(
      "shell",
      "user_closed_surface",
    );
  });

  it("失去可用性只裁剪对应标签并清理对应目标", () => {
    const view = mount();
    act(() => view.get().local.openArticleWorkspaceRightSurface(article));
    act(() => view.get().coordinator.handleToggleRightSurfaceBrowser());
    act(() => view.get().coordinator.handleToggleRightSurfaceShell());
    view.render({ shellAvailable: false });
    expect(view.get().coordinator.rightSurfaceState.openSurfaces).toEqual([
      "articleWorkspace",
      "browser",
    ]);
    expect(view.get().coordinator.rightSurfaceState.activeSurface).toBe(
      "browser",
    );
    expect(view.get().local.activeArticleWorkspace).toBe(article);
    view.render({ articleAvailable: false });
    expect(view.get().coordinator.rightSurfaceState.openSurfaces).toEqual([
      "browser",
    ]);
    expect(view.get().local.activeArticleWorkspace).toBeNull();
  });

  it("utility suppression 使用同一 availability 投影移除 inactive Shell", () => {
    const view = mount();
    act(() => view.get().coordinator.handleToggleRightSurfaceShell());
    act(() => view.get().coordinator.handleToggleRightSurfaceBrowser());
    view.render({ suppressUtilities: true });
    expect(view.get().coordinator.rightSurfaceState.openSurfaces).toEqual([
      "browser",
    ]);
    expect(view.get().coordinator.rightSurfaceState.activeSurface).toBe(
      "browser",
    );
    pending.consumePendingRequestsForSurface.mockClear();
    act(() => view.get().coordinator.handleToggleRightSurfaceShell());
    act(() => view.get().coordinator.handleSelectRightSurfaceTab("shell"));
    expect(view.get().local.openedRightSurfaces).toEqual(["browser"]);
    expect(pending.consumePendingRequestsForSurface).not.toHaveBeenCalled();
  });

  it("Expert 和 Canvas 切换保留已有 Files 与 Article 目标", () => {
    const view = mount();
    act(() => view.get().local.openArticleWorkspaceRightSurface(article));
    act(() => view.get().coordinator.handleToggleRightSurfaceFiles());
    act(() => view.get().coordinator.handleToggleExpertInfoPanel());
    expect(view.get().coordinator.rightSurfaceState.activeSurface).toBe(
      "expertInfo",
    );
    act(() => view.get().coordinator.handleToggleExpertInfoPanel());
    expect(view.get().coordinator.rightSurfaceState.activeSurface).toBe(
      "files",
    );
    act(() => view.get().coordinator.handleToggleCanvasFromRightSurface());
    expect(view.get().coordinator.rightSurfaceState.activeSurface).toBe(
      "workbench",
    );
    expect(view.get().coordinator.rightSurfaceState.openSurfaces).toEqual([
      "articleWorkspace",
      "files",
      "workbench",
    ]);
    expect(view.get().local.activeArticleWorkspace).toBe(article);
    expect(view.get().local.activeFilesRightSurfaceTarget).toEqual(file);
  });

  it("Plugin 分组最后一个关闭时即使在后台也移除分组", () => {
    const view = mount();
    const second = { ...plugin, containerId: "container-b" };
    act(() => {
      view.get().local.setActivePluginSurfaces([plugin, second]);
      view.get().local.setActivePluginSurfaceContainerId(plugin.containerId);
      view.get().local.setManualRightSurface("appSurface");
    });
    act(() => view.get().coordinator.handleToggleRightSurfaceBrowser());
    act(() => view.get().coordinator.handleClosePluginSurface(plugin));
    expect(view.get().coordinator.rightSurfaceState.openSurfaces).toEqual([
      "appSurface",
      "browser",
    ]);
    act(() => view.get().coordinator.handleClosePluginSurface(second));
    expect(view.get().coordinator.rightSurfaceState.openSurfaces).toEqual([
      "browser",
    ]);
    expect(view.get().coordinator.rightSurfaceState.activeSurface).toBe(
      "browser",
    );
    expect(view.get().local.dismissedPluginSurfaceContainerIds).toEqual([
      "container-a",
      "container-b",
    ]);
  });

  it("关闭 Browser 回退到 Expert 后，Expert toggle 关闭实际选中的标签", () => {
    const view = mount();
    act(() => view.get().coordinator.handleToggleExpertInfoPanel());
    act(() => view.get().coordinator.handleToggleRightSurfaceBrowser());
    act(() => view.get().coordinator.handleToggleRightSurfaceBrowser());
    expect(view.get().coordinator.rightSurfaceState.activeSurface).toBe(
      "expertInfo",
    );
    act(() => view.get().coordinator.handleToggleExpertInfoPanel());
    expect(view.get().coordinator.rightSurfaceState.openSurfaces).toEqual([]);
    expect(view.get().coordinator.rightSurfaceState.activeSurface).toBeNull();
  });

  it("会话 epoch 隔离保留的标签、标题及外部回调", () => {
    const view = mount();
    act(() => view.get().coordinator.handleToggleRightSurfaceBrowser());
    const previous = view.get().coordinator;
    view.render({
      owner: { ...owner, sessionId: "session-b", threadId: "thread-b" },
    });
    act(() =>
      previous.handleRightSurfaceBrowserNavigate(
        "https://late.example",
        "late",
      ),
    );
    expect(view.get().coordinator.rightSurfaceState.openSurfaces).toEqual([]);
    expect(view.get().coordinator.rightSurfaceBrowserTitle).toBeNull();
  });

  it("共享标签关闭后台Browser后保留Files目标，关闭最后标签不再恢复旧面", () => {
    const view = mount();
    act(() => view.get().coordinator.handleToggleRightSurfaceBrowser());
    act(() => view.get().coordinator.handleToggleRightSurfaceFiles());
    act(() => view.get().coordinator.handleCloseRightSurfaceTab("browser"));
    expect(view.get().coordinator.rightSurfaceState.openSurfaces).toEqual([
      "files",
    ]);
    expect(view.get().coordinator.rightSurfaceState.activeSurface).toBe(
      "files",
    );
    expect(view.get().coordinator.filesRightSurfaceTarget).toEqual(file);
    act(() => view.get().coordinator.handleCloseRightSurfaceTab("files"));
    expect(view.get().coordinator.rightSurfaceState.openSurfaces).toEqual([]);
    expect(view.get().coordinator.rightSurfaceState.activeSurface).toBeNull();
    expect(view.get().local.activeFilesRightSurfaceTarget).toBeNull();
  });

  it("共享标签关闭Plugin分组清除描述符与待处理投影，旧会话关闭不污染新会话", () => {
    const view = mount();
    act(() => view.get().local.setActivePluginSurfaces([plugin]));
    act(() => view.get().coordinator.handleSelectPluginSurface(plugin));
    act(() => view.get().coordinator.handleCloseRightSurfaceTab("appSurface"));
    expect(view.get().coordinator.pluginSurfaceRightSurfaces).toEqual([]);
    expect(view.get().coordinator.rightSurfaceState.activeSurface).toBeNull();
    expect(view.get().local.dismissedPluginSurfaceContainerIds).toContain(
      plugin.containerId,
    );
    const previous = view.get().coordinator;
    view.render({
      owner: { ...owner, sessionId: "session-b", threadId: "thread-b" },
    });
    act(() => view.get().coordinator.handleToggleRightSurfaceFiles());
    act(() => previous.handleCloseRightSurfaceTab("files"));
    expect(view.get().coordinator.rightSurfaceState.activeSurface).toBe(
      "files",
    );
  });
});
