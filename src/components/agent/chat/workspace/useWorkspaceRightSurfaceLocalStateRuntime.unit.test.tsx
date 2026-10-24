import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureBooleanGateway } from "@/hooks/usePersistedBooleanAtom.testFixtures";
import { browserState } from "./right-surface/browser/browserWorkspace.testFixtures";
import {
  useWorkspaceRightSurfaceLocalStateRuntime,
  type WorkspaceRightSurfaceLocalStateRuntime,
  type WorkspaceRightSurfaceOwner,
} from "./useWorkspaceRightSurfaceLocalStateRuntime";

const atomGateway = vi.hoisted(() => ({
  read: vi.fn(),
  update: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("@/lib/api/persistedAtoms", () => ({
  sendPersistedAtomState: atomGateway.read,
  updatePersistedAtomState: atomGateway.update,
  listenPersistedAtomUpdates: atomGateway.listen,
}));
const treeKey = "app-shell-file-tree-open";
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

const owner: WorkspaceRightSurfaceOwner = {
  workspaceId: "workspace-a",
  sessionId: "session-a",
  threadId: "thread-a",
};
const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

function mount(initialOwner: WorkspaceRightSurfaceOwner = owner) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  let latest!: WorkspaceRightSurfaceLocalStateRuntime;
  const observations: WorkspaceRightSurfaceLocalStateRuntime[] = [];
  function Probe(props: WorkspaceRightSurfaceOwner) {
    latest = useWorkspaceRightSurfaceLocalStateRuntime(props);
    observations.push(latest);
    return null;
  }
  const render = (nextOwner = initialOwner) => {
    act(() => root.render(<Probe {...nextOwner} />));
  };
  render();
  const unmount = () => {
    act(() => root.unmount());
    container.remove();
    mounted.splice(
      mounted.findIndex((entry) => entry.root === root),
      1,
    );
  };
  return { render, get: () => latest, observations, unmount };
}

beforeEach(() => {
  configureBooleanGateway(atomGateway);
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.resetAllMocks();
});

describe("Right Surface 本地显示状态", () => {
  it("New tab地址草稿由原tab owner保存且不串到其他tab", () => {
    const view = mount();
    act(() => view.get().openSidePanelTab("workspace-new-tab"));
    const first = view.get().sidePanelTabs.tabs[0].tabId;
    act(() =>
      view.get().setNewTabAddressDraft(first, "  localhost:5173/草稿  "),
    );
    act(() => view.get().openSidePanelTab("workspace-new-tab"));
    const second = view.get().sidePanelTabs.activeTabId!;
    act(() => view.get().setNewTabAddressDraft(second, "second.example/path"));
    act(() => view.get().selectSidePanelTab(first));
    expect(
      view.get().sidePanelTabs.tabs.map((tab) => tab.addressDraft),
    ).toEqual(["  localhost:5173/草稿  ", "second.example/path"]);
    expect(view.get().sidePanelTabs.activeTabId).toBe(first);
    act(() => view.get().setNewTabAddressDraft(first, ""));
    expect(view.get().sidePanelTabs.tabs[0].addressDraft).toBe("");
    expect(view.get().sidePanelTabs.tabs[1].addressDraft).toBe(
      "second.example/path",
    );
  });

  it("旧草稿回调不创建已关闭或被替换的New tab，也不写入其他owner", () => {
    const view = mount();
    act(() => view.get().openSidePanelTab("workspace-new-tab"));
    const tab = view.get().sidePanelTabs.tabs[0];
    const stale = view.get().setNewTabAddressDraft;
    act(() => view.get().closeSidePanelTab(tab.tabId));
    act(() => stale(tab.tabId, "closed tab"));
    expect(view.get().sidePanelTabs.tabs).toEqual([]);
    act(() => view.get().openSidePanelTab("files"));
    const file = view.get().sidePanelTabs.tabs[0];
    act(() => view.get().setNewTabAddressDraft(file.tabId, "not a New tab"));
    expect(view.get().sidePanelTabs.tabs[0]).toBe(file);
    view.render({ ...owner, threadId: "other-thread" });
    act(() => stale(tab.tabId, "foreign owner"));
    expect(view.get().sidePanelTabs.tabs).toEqual([]);
  });

  it("首次canonical owner接管保留New tab草稿，原位导航替换后不再接受草稿", () => {
    const view = mount({ ...owner, sessionId: null, threadId: null });
    act(() => view.get().openSidePanelTab("workspace-new-tab"));
    const tab = view.get().sidePanelTabs.tabs[0];
    act(() => view.get().setNewTabAddressDraft(tab.tabId, "example.com/path"));
    const source = view.get().captureBrowserAddressSource(tab.tabId);
    view.render(owner);
    expect(view.get().sidePanelTabs.tabs[0].addressDraft).toBe(
      "example.com/path",
    );
    act(() =>
      source.replace(
        { runtimeSessionId: owner.sessionId!, threadId: owner.threadId! },
        "native-tab",
      ),
    );
    const native = view.get().sidePanelTabs.tabs[0];
    act(() => view.get().setNewTabAddressDraft(tab.tabId, "late draft"));
    expect(view.get().sidePanelTabs.tabs).toEqual([native]);
    expect(native.addressDraft).toBeUndefined();
  });

  it("设置往返卸载后从同一Host投影恢复原Browser，workspace暂缺不创建第二页签", async () => {
    const scope = {
      ...owner,
      sessionId: "settings-return",
      threadId: "settings-thread",
    };
    const native = browserState({ threadId: scope.threadId });
    const first = mount(scope);
    await flush();
    act(() => first.get().setManualRightSurface("browser"));
    act(() => first.get().synchronizeBrowserTabs([native]));
    expect(first.get().sidePanelTabs.open).toBe(true);
    first.unmount();
    const returned = mount({ ...scope, workspaceId: null });
    await flush();
    act(() => returned.get().synchronizeBrowserTabs([native]));
    expect(returned.get().sidePanelTabs.open).toBe(true);
    expect(returned.get().sidePanelTabs.activeTabId).toBe(native.tabId);
    expect(returned.get().sidePanelTabs.tabs).toHaveLength(1);
    expect(returned.get().sidePanelTabs.tabs[0].browser?.webContentsId).toBe(
      native.webContentsId,
    );
  });

  it("用户主动收起后设置往返保持收起", async () => {
    const scope = {
      ...owner,
      sessionId: "settings-hidden",
      threadId: "hidden-thread",
    };
    const native = browserState({ threadId: scope.threadId });
    const first = mount(scope);
    await flush();
    act(() => first.get().setManualRightSurface("browser"));
    act(() => first.get().synchronizeBrowserTabs([native]));
    act(() => first.get().clearActiveRightSurfaceTargets());
    first.unmount();
    const returned = mount(scope);
    await flush();
    act(() => returned.get().synchronizeBrowserTabs([native]));
    expect(returned.get().sidePanelTabs.open).toBe(false);
    expect(returned.get().sidePanelTabs.activeTabId).toBeNull();
  });

  it("原生页已关闭时不按旧展示记录打开新页", async () => {
    const scope = {
      ...owner,
      sessionId: "settings-closed",
      threadId: "closed-thread",
    };
    const native = browserState({ threadId: scope.threadId });
    const first = mount(scope);
    await flush();
    act(() => first.get().setManualRightSurface("browser"));
    act(() => first.get().synchronizeBrowserTabs([native]));
    first.unmount();
    const returned = mount(scope);
    await flush();
    act(() => returned.get().synchronizeBrowserTabs([]));
    expect(returned.get().sidePanelTabs.tabs).toEqual([]);
    expect(returned.get().sidePanelTabs.open).toBe(false);
    act(() =>
      returned
        .get()
        .synchronizeBrowserTabs([{ ...native, tabId: "new-background-tab" }]),
    );
    expect(returned.get().sidePanelTabs.open).toBe(false);
  });

  it("Browser恢复不跨会话且不覆盖用户在Host快照到达前选中的Files", async () => {
    const scope = {
      ...owner,
      sessionId: "settings-source",
      threadId: "source-thread",
    };
    const native = browserState({ threadId: scope.threadId });
    const first = mount(scope);
    await flush();
    act(() => first.get().setManualRightSurface("browser"));
    act(() => first.get().synchronizeBrowserTabs([native]));
    first.unmount();
    const foreign = mount({ ...scope, sessionId: "settings-foreign" });
    await flush();
    act(() => foreign.get().synchronizeBrowserTabs([native]));
    expect(foreign.get().sidePanelTabs.open).toBe(false);
    const returned = mount(scope);
    await flush();
    act(() => returned.get().openWorkspaceFile("/work/README.md"));
    const file = returned.get().sidePanelTabs.activeTabId;
    act(() => returned.get().synchronizeBrowserTabs([native]));
    expect(returned.get().sidePanelTabs.activeTabId).toBe(file);
    expect(returned.get().manualRightSurface).toBe("files");
  });
  it("New tab地址在首次canonical owner接管后仍可原位替换，跨会话结果不能复活源标签", async () => {
    const view = mount({
      workspaceId: owner.workspaceId,
      sessionId: null,
      threadId: null,
    });
    await flush();
    act(() => view.get().openSidePanelTab("workspace-new-tab"));
    const tab = view.get().sidePanelTabs.tabs[0];
    const source = view.get().captureBrowserAddressSource(tab.tabId);
    view.render(owner);
    const resolved = {
      runtimeSessionId: owner.sessionId!,
      threadId: owner.threadId!,
    };
    expect(source.isCurrent(resolved)).toBe(true);
    expect(source.isCurrent({ ...resolved, threadId: "other" })).toBe(false);
    act(() => source.replace(resolved, "canonical-tab"));
    expect(view.get().sidePanelTabs.tabs.map((tab) => tab.tabId)).toEqual([
      "canonical-tab",
    ]);
    expect(view.get().sidePanelTabs.activeTabId).toBe("canonical-tab");
    view.render({ ...owner, threadId: "thread-b", sessionId: "session-b" });
    view.render(owner);
    act(() => source.replace(resolved, "stale-tab"));
    expect(view.get().sidePanelTabs.tabs).toEqual([]);
  });
  it("正文后台打开Browser保持关闭的侧栏和空选择，随后可显式选择同一标签", async () => {
    const view = mount();
    await flush();
    act(() => view.get().openBrowserInBackground());
    const tabs = view.get().sidePanelTabs;
    expect(tabs.tabs.map((tab) => tab.kind)).toEqual(["browser"]);
    expect(tabs.open).toBe(false);
    expect(tabs.activeTabId).toBeNull();
    expect(view.get().manualRightSurface).toBeNull();
    act(() => view.get().selectSidePanelTab(tabs.tabs[0].tabId));
    expect(view.get().sidePanelTabs.open).toBe(true);
    expect(view.get().sidePanelTabs.tabs[0]).toBe(tabs.tabs[0]);
    expect(view.get().manualRightSurface).toBe("browser");
  });
  it("后台Browser保留来源New tab和选择，重复打开不新增壳标签，旧owner不能写入", async () => {
    const view = mount();
    await flush();
    act(() => view.get().openSidePanelTab("workspace-new-tab"));
    const source = view.get().sidePanelTabs.tabs[0];
    act(() => view.get().openBrowserInBackground());
    expect(view.get().sidePanelTabs.tabs.map((tab) => tab.kind)).toEqual([
      "workspace-new-tab",
      "browser",
    ]);
    expect(view.get().sidePanelTabs.tabs[0]).toBe(source);
    expect(view.get().sidePanelTabs.activeTabId).toBe(source.tabId);
    expect(view.get().manualRightSurface).toBe("workspace-new-tab");
    act(() => view.get().openBrowserInBackground());
    expect(view.get().sidePanelTabs.tabs).toHaveLength(2);
    expect(view.get().sidePanelTabs.activeTabId).toBe(source.tabId);
    const stale = view.get();
    view.render({ ...owner, threadId: "thread-b", sessionId: "session-b" });
    act(() => stale.openBrowserInBackground());
    expect(view.get().sidePanelTabs.tabs).toEqual([]);
    await flush();
  });
  it("新空Files展开共享树；已有标签的激活尊重用户折叠，关闭重建才再次展开", async () => {
    const gateway = configureBooleanGateway(atomGateway);
    const view = mount();
    await flush();
    act(() => view.get().openSidePanelTab("workspace-new-tab"));
    const newTab = view.get().sidePanelTabs.tabs[0];
    act(() => view.get().openSidePanelTab("files", newTab.tabId));
    await flush();
    expect(atomGateway.update).toHaveBeenCalledExactlyOnceWith({
      key: treeKey,
      mutation: { op: "set", value: true },
    });
    const picker = view.get().sidePanelTabs.tabs[0];
    expect(picker.kind).toBe("files");
    act(() => gateway.set(treeKey, false, 2));
    await flush();
    act(() => view.get().setManualRightSurface("browser"));
    act(() => view.get().openSidePanelTab("files"));
    await flush();
    expect(view.get().sidePanelTabs.tabs[0]).toBe(picker);
    expect(atomGateway.update).toHaveBeenCalledTimes(1);
    act(() => view.get().closeSidePanelTab(picker.tabId));
    act(() => view.get().setManualRightSurface("files"));
    await flush();
    expect(atomGateway.update).toHaveBeenCalledTimes(2);
  });

  it("直接打开路径、非法替换和旧owner不修改共享树状态", async () => {
    const view = mount();
    await flush();
    act(() => view.get().openWorkspaceFile("/work/README.md"));
    act(() => view.get().openSidePanelTab("files", "closed-new-tab"));
    const stale = view.get();
    view.render({ ...owner, threadId: "thread-b" });
    act(() => stale.openSidePanelTab("files"));
    await flush();
    expect(atomGateway.update).not.toHaveBeenCalled();
    expect(view.get().sidePanelTabs.tabs).toEqual([]);
  });

  it.each(["close", "switch-owner"] as const)(
    "Host尚未ready时关闭或换owner，不因迟到读取重开树：%s",
    async (action) => {
      const gateway = configureBooleanGateway(atomGateway);
      let finish!: (value: ReturnType<typeof gateway.read>) => void;
      atomGateway.read.mockImplementationOnce(
        () => new Promise((resolve) => (finish = resolve)),
      );
      const view = mount();
      await flush();
      act(() => view.get().openSidePanelTab("files"));
      expect(atomGateway.update).not.toHaveBeenCalled();
      if (action === "close") act(() => view.get().closeSidePanelTab("file:"));
      else view.render({ ...owner, threadId: "thread-b" });
      await act(async () => finish(gateway.read(treeKey)));
      expect(atomGateway.update).not.toHaveBeenCalled();
      expect(view.get().sidePanelTabs.tabs).toEqual([]);
    },
  );

  it("新空Files等待同一Host读取就绪后仅展开一次", async () => {
    const gateway = configureBooleanGateway(atomGateway);
    let finish!: (value: ReturnType<typeof gateway.read>) => void;
    atomGateway.read.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const view = mount();
    await flush();
    act(() => view.get().openSidePanelTab("files"));
    expect(atomGateway.update).not.toHaveBeenCalled();
    await act(async () => finish(gateway.read(treeKey)));
    expect(atomGateway.update).toHaveBeenCalledExactlyOnceWith({
      key: treeKey,
      mutation: { op: "set", value: true },
    });
  });

  it("外部资源引用激活同一路径文件标签，保留终端与文件内容实例", async () => {
    const view = mount();
    await flush();
    act(() => view.get().openSidePanelTab("files"));
    act(() => view.get().setManualRightSurface("shell"));
    const terminal = view.get().sidePanelTabs.tabs[1];
    const path = "/skills/Review work/SKILL.md";
    act(() => view.get().openWorkspaceFile(path));
    const file = view.get().sidePanelTabs.tabs[1];
    expect(view.get().sidePanelTabs.activeTabId).toBe(file.tabId);
    expect(view.get().manualRightSurface).toBe("files");
    expect(file.filePath).toBe(path);
    act(() => view.get().selectSidePanelTab(terminal.tabId));
    act(() => view.get().openWorkspaceFile(path));
    expect(view.get().sidePanelTabs.tabs).toEqual([terminal, file]);
    expect(view.get().sidePanelTabs.tabs[1]).toBe(file);
    expect(view.get().sidePanelTabs.activeTabId).toBe(file.tabId);
    const stale = view.get();
    view.render({ ...owner, sessionId: "session-b", threadId: "thread-b" });
    act(() => stale.openWorkspaceFile(path));
    expect(view.get().sidePanelTabs.tabs).toEqual([]);
    await flush();
  });

  it("预览固定保留同一内容对象与草稿，旧owner固定不影响新预览", async () => {
    const view = mount();
    await flush();
    act(() => view.get().openSidePanelTab("files"));
    const picker = view.get().sidePanelTabs.tabs[0];
    act(() => view.get().openWorkspaceFile("/work/a.ts", picker));
    const first = view.get().sidePanelTabs.tabs[0];
    act(() =>
      view.get().openWorkspaceFile("/work/b.ts", first, { isPreview: true }),
    );
    const preview = view.get().sidePanelTabs.tabs[1];
    const draft = {
      content: "edited",
      document: { kind: "ready" as const, baseContent: "base" },
    };
    view.get().setFileDraft(preview, draft);
    act(() => view.get().pinSidePanelTab(preview.tabId));
    expect(view.get().sidePanelTabs.tabs[1]).toBe(preview);
    expect(view.get().getFileDraft(preview)).toBe(draft);
    expect(view.get().sidePanelTabs.previewTabId).toBeNull();
    const stale = view.get();
    view.render({ ...owner, sessionId: "session-b", threadId: "thread-b" });
    act(() => view.get().openSidePanelTab("files"));
    const newPicker = view.get().sidePanelTabs.tabs[0];
    act(() =>
      view
        .get()
        .openWorkspaceFile("/work/b.ts", newPicker, { isPreview: true }),
    );
    const currentPreview = view.get().sidePanelTabs.tabs[0];
    act(() => stale.pinSidePanelTab(currentPreview.tabId));
    expect(view.get().sidePanelTabs.previewTabId).toBe(currentPreview.tabId);
    expect(view.get().getFileDraft(currentPreview)).toBeNull();
    await flush();
  });
  it("切换保留打开顺序；关闭未选中标签只移除它，关闭选中标签回退", async () => {
    const view = mount();
    await flush();
    act(() => view.get().setManualRightSurface("browser"));
    act(() => view.get().setManualRightSurface("shell"));
    act(() => view.get().setManualRightSurface("files"));
    act(() => view.get().setManualRightSurface("browser"));
    expect(view.get().openedRightSurfaces).toEqual([
      "browser",
      "shell",
      "files",
    ]);
    act(() => view.get().closeRightSurface("shell"));
    expect(view.get().openedRightSurfaces).toEqual(["browser", "files"]);
    expect(view.get().manualRightSurface).toBe("browser");
    act(() => view.get().closeRightSurface("browser"));
    expect(view.get().openedRightSurfaces).toEqual(["files"]);
    expect(view.get().manualRightSurface).toBe("files");
    act(() => view.get().closeRightSurface("files"));
    expect(view.get().openedRightSurfaces).toEqual([]);
    expect(view.get().manualRightSurface).toBeNull();
    await flush();
  });

  it.each([
    { ...owner, workspaceId: "workspace-b" },
    { ...owner, sessionId: "session-b" },
    { ...owner, threadId: "thread-b" },
  ])("owner 切换在首次渲染就隔离所有显示状态：%j", async (nextOwner) => {
    const view = mount();
    await flush();
    act(() => {
      view.get().setManualRightSurface("browser");
      view.get().setRightSurfaceBrowserTitle("Old browser");
      view.get().setActiveBrowserRightSurfaceIntent({
        source: "rightSurfacePending",
        sourceRequestId: "old",
        origin: "runtime",
        launchUrl: "https://example.com/old",
        priority: "background",
      });
      view.get().setActiveFilesRightSurfaceTarget({ relativePath: "old.md" });
      view.get().setActiveArticleWorkspace({
        schemaVersion: "article-workspace.v1",
        appId: "content-factory-app",
        sessionId: "session-a",
        source: "threadRead",
        objects: [],
        objectCount: 0,
        actionHistory: [],
      });
      view.get().setActivePluginSurfaces([
        {
          appId: "old-app",
          containerId: "old-plugin",
          title: "Old plugin",
          mcpApp: {
            serverName: "codex_apps",
            connectorId: "demo",
            resourceUri: "ui://demo/view.html",
            toolItemId: "item-demo",
          },
        },
      ]);
      view.get().setActivePluginSurfaceContainerId("old-plugin");
      view.get().setDismissedPluginSurfaceContainerIds(["old-dismissed"]);
    });
    const index = view.observations.length;
    view.render(nextOwner);
    const first = view.observations[index];
    expect(first.openedRightSurfaces).toEqual([]);
    expect(first.manualRightSurface).toBeNull();
    expect(first.rightSurfaceBrowserTitle).toBeNull();
    expect(first.activeBrowserRightSurfaceIntent).toBeNull();
    expect(first.activeFilesRightSurfaceTarget).toBeNull();
    expect(first.activeArticleWorkspace).toBeNull();
    expect(first.activePluginSurfaces).toEqual([]);
    expect(first.activePluginSurfaceContainerId).toBeNull();
    expect(first.dismissedPluginSurfaceContainerIds).toEqual([]);
    await flush();
  });

  it("A → B → A 后拒绝最初 A 的迟到 setter", async () => {
    const view = mount();
    await flush();
    const stale = view.get();
    view.render({ ...owner, sessionId: "session-b", threadId: "thread-b" });
    view.render(owner);
    act(() => {
      stale.setManualRightSurface("browser");
      stale.setRightSurfaceBrowserTitle("late");
      stale.setActiveFilesRightSurfaceTarget({ relativePath: "late.md" });
      stale.rememberRightSurface("shell");
    });
    expect(view.get().openedRightSurfaces).toEqual([]);
    expect(view.get().rightSurfaceBrowserTitle).toBeNull();
    expect(view.get().activeFilesRightSurfaceTarget).toBeNull();
    act(() => view.get().setManualRightSurface("files"));
    expect(view.get().manualRightSurface).toBe("files");
    await flush();
  });

  it("同工作区首页可由首次 canonical owner 接管，真实 owner 变化后不接管", async () => {
    const view = mount({ ...owner, sessionId: null, threadId: null });
    await flush();
    act(() => {
      view.get().setManualRightSurface("browser");
      view.get().setRightSurfaceBrowserTitle("Home intent");
    });
    view.render({ ...owner, threadId: null });
    view.render(owner);
    expect(view.get().openedRightSurfaces).toEqual(["browser"]);
    expect(view.get().rightSurfaceBrowserTitle).toBe("Home intent");
    view.render({ ...owner, sessionId: "session-b", threadId: null });
    expect(view.get().openedRightSurfaces).toEqual([]);
    view.render({ ...owner, sessionId: "session-b", threadId: "thread-b" });
    expect(view.get().rightSurfaceBrowserTitle).toBeNull();
    await flush();
  });

  it("取消选择保留标签；可用性撤销只移除指定种类并回退", async () => {
    const view = mount();
    await flush();
    act(() => view.get().setManualRightSurface("browser"));
    act(() => view.get().setManualRightSurface("shell"));
    act(() => view.get().setManualRightSurface(null));
    expect(view.get().openedRightSurfaces).toEqual(["browser", "shell"]);
    act(() => view.get().setManualRightSurface("shell"));
    act(() => view.get().pruneRightSurfaces(new Set(["browser", "files"])));
    expect(view.get().openedRightSurfaces).toEqual(["browser"]);
    expect(view.get().manualRightSurface).toBe("browser");
    await flush();
  });
});
