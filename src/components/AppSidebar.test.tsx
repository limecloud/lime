import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentPageParams, Page, PageParams } from "@/types/page";
import { SettingsTabs } from "@/types/settings";
import { AppSidebar } from "./AppSidebar";

const {
  mockGetConfig,
  mockGetPluginsForSurface,
  mockSubscribeAppConfigChanged,
  mockListAgentRuntimeSessions,
  mockUpdateAgentRuntimeSession,
} = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockGetPluginsForSurface: vi.fn(),
  mockSubscribeAppConfigChanged: vi.fn(),
  mockListAgentRuntimeSessions: vi.fn(),
  mockUpdateAgentRuntimeSession: vi.fn(),
}));

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: mockGetConfig,
  subscribeAppConfigChanged: mockSubscribeAppConfigChanged,
}));

vi.mock("@/lib/api/pluginUI", () => ({
  getPluginsForSurface: mockGetPluginsForSurface,
}));

vi.mock("@/lib/api/agentRuntime", () => ({
  listAgentRuntimeSessions: mockListAgentRuntimeSessions,
  updateAgentRuntimeSession: mockUpdateAgentRuntimeSession,
}));

vi.mock("@/lib/utils/scheduleMinimumDelayIdleTask", () => ({
  scheduleMinimumDelayIdleTask: (task: () => void) => {
    task();
    return () => undefined;
  },
}));

interface MountedSidebar {
  container: HTMLDivElement;
  root: Root;
}

const mountedSidebars: MountedSidebar[] = [];
const APP_SIDEBAR_COLLAPSED_STORAGE_KEY = "lime.app-sidebar.collapsed";
const APP_SIDEBAR_ENABLED_ITEMS_STORAGE_KEY = "lime.app-sidebar.enabled-items";

function mountSidebar(options?: {
  currentPage?: Page;
  currentPageParams?: PageParams;
  onNavigate?: (page: Page, params?: PageParams) => void;
}): MountedSidebar {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <AppSidebar
        currentPage={options?.currentPage ?? "agent"}
        currentPageParams={options?.currentPageParams}
        onNavigate={options?.onNavigate ?? vi.fn()}
      />,
    );
  });

  const mounted = { container, root };
  mountedSidebars.push(mounted);
  return mounted;
}

function mountSidebarContainer(options?: {
  currentPage?: Page;
  currentPageParams?: PageParams;
  onNavigate?: (page: Page, params?: PageParams) => void;
}) {
  return mountSidebar(options).container;
}

async function flushEffects(times = 1) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("AppSidebar", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localStorage.clear();
    mockGetConfig.mockResolvedValue({});
    mockGetPluginsForSurface.mockResolvedValue([]);
    mockListAgentRuntimeSessions.mockResolvedValue([]);
    mockUpdateAgentRuntimeSession.mockResolvedValue(undefined);
    mockSubscribeAppConfigChanged.mockImplementation(
      (listener: () => void) => {
        (globalThis as typeof globalThis & { __appConfigListener?: () => void })
          .__appConfigListener = listener;
        return () => {
          (
            globalThis as typeof globalThis & {
              __appConfigListener?: () => void;
            }
          ).__appConfigListener = undefined;
        };
      },
    );
  });

  afterEach(() => {
    while (mountedSidebars.length > 0) {
      const mounted = mountedSidebars.pop();
      if (!mounted) {
        continue;
      }

      act(() => {
        mounted.root.unmount();
      });
      mounted.container.remove();
    }

    vi.clearAllMocks();
    vi.unstubAllGlobals();
    (
      globalThis as typeof globalThis & {
        __appConfigListener?: () => void;
      }
    ).__appConfigListener = undefined;
  });

  it("进入任务中心页时应保持导航栏展开，以承接左侧任务导航", async () => {
    localStorage.setItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY, "false");

    const container = mountSidebarContainer({
      currentPageParams: {
        agentEntry: "claw",
      } as AgentPageParams,
    });
    await flushEffects();

    expect(
      container.querySelector('button[aria-label="折叠导航栏"]'),
    ).not.toBeNull();
    expect(localStorage.getItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe(
      "false",
    );
  });

  it("新建任务页应自动展开导航栏", async () => {
    localStorage.setItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY, "true");

    const container = mountSidebarContainer({
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects();

    expect(
      container.querySelector('button[aria-label="折叠导航栏"]'),
    ).not.toBeNull();
    expect(localStorage.getItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe(
      "false",
    );
  });

  it("默认应渲染一级主导航和底部系统入口", async () => {
    const container = mountSidebarContainer({
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects(2);

    expect(container.textContent).toContain("任务");
    expect(container.textContent).toContain("新建任务");
    expect(container.textContent).not.toContain("生成");
    expect(container.textContent).toContain("我的方法");
    expect(container.textContent).toContain("灵感库");
    expect(container.textContent).toContain("设置");
    expect(container.textContent).toContain("持续流程");
    expect(container.textContent).toContain("消息渠道");
    expect(container.textContent).not.toContain("插件中心");
    expect(container.textContent).not.toContain("OpenClaw");
    expect(container.textContent).not.toContain("桌宠");
    expect(container.textContent).not.toContain("支撑");
    expect(container.textContent).not.toContain("技能");
    expect(container.textContent).not.toContain("能力");
    expect(container.textContent).not.toContain("资料");
    expect(container.textContent).not.toContain("系统");

    const mainNavButtons = Array.from(
      container.querySelectorAll('[data-testid="app-sidebar-main-nav"] button'),
    ).map((button) => button.getAttribute("aria-label"));
    const footerNavButtons = Array.from(
      container.querySelectorAll('[data-testid="app-sidebar-footer-nav"] button'),
    ).map((button) => button.getAttribute("aria-label"));
    const footerArea = container.querySelector(
      '[data-testid="app-sidebar-footer-area"]',
    );

    expect(mainNavButtons).toEqual(["新建任务", "我的方法", "灵感库"]);
    expect(footerNavButtons).toEqual(["设置", "持续流程", "消息渠道"]);
    expect(footerArea).not.toBeNull();
    expect(getComputedStyle(footerArea as Element).paddingBottom).toBe("16px");
  });

  it("新建任务页应高亮新建任务入口", async () => {
    const container = mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects(2);

    expect(
      container.querySelector('button[aria-label="新建任务"][aria-current="page"]'),
    ).not.toBeNull();
  });

  it("生成页不应再展示旧的侧栏生成入口", async () => {
    const container = mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "claw",
      } as AgentPageParams,
    });
    await flushEffects(2);

    expect(container.querySelector('button[aria-label="生成"]')).toBeNull();
  });

  it("一级导航下方应继续展示最近对话与归档", async () => {
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: "session-recent",
        name: "最近会话",
        created_at: 1714000000,
        updated_at: 1714000600,
        archived_at: null,
        workspace_id: "project-1",
      },
      {
        id: "session-archived",
        name: "归档会话",
        created_at: 1713000000,
        updated_at: 1713000600,
        archived_at: 1713003600,
        workspace_id: "project-1",
      },
    ]);

    const container = mountSidebarContainer({
      currentPage: "settings",
    });
    await flushEffects(2);

    expect(container.textContent).toContain("最近对话");
    expect(container.textContent).toContain("归档");
    expect(container.textContent).toContain("最近会话");
    expect(container.textContent).toContain("归档会话");

    const mainNav = container.querySelector(
      '[data-testid="app-sidebar-main-nav"]',
    );
    const conversationShelf = container.querySelector(
      '[data-testid="app-sidebar-conversation-shelf"]',
    );
    const recentConversationList = container.querySelector(
      '[data-testid="app-sidebar-recent-conversations"]',
    );
    const archivedConversationList = container.querySelector(
      '[data-testid="app-sidebar-archived-conversations"]',
    );

    expect(mainNav).not.toBeNull();
    expect(conversationShelf).not.toBeNull();
    expect(recentConversationList).not.toBeNull();
    expect(archivedConversationList).not.toBeNull();
    expect(getComputedStyle(recentConversationList as Element).overflowY).toBe(
      "auto",
    );
    expect(getComputedStyle(archivedConversationList as Element).overflowY).toBe(
      "auto",
    );
    expect(
      Boolean(
        mainNav &&
          conversationShelf &&
          (mainNav.compareDocumentPosition(conversationShelf) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
            0,
      ),
    ).toBe(true);
  });

  it("切换人物或项目上下文时不应把已有最近对话重置成加载态", async () => {
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: "session-recent",
        name: "最近会话",
        created_at: 1714000000,
        updated_at: 1714000600,
        archived_at: null,
        workspace_id: null,
      },
    ]);

    const mounted = mountSidebar({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "claw",
        projectId: "project-1",
      } as AgentPageParams,
    });
    await flushEffects(2);

    expect(mounted.container.textContent).toContain("最近会话");
    expect(mounted.container.textContent).not.toContain("正在加载对话");
    expect(mockListAgentRuntimeSessions).toHaveBeenCalledTimes(1);

    await act(async () => {
      mounted.root.render(
        <AppSidebar
          currentPage="agent"
          currentPageParams={
            {
              agentEntry: "claw",
              projectId: "project-2",
            } as AgentPageParams
          }
          onNavigate={vi.fn()}
        />,
      );
      await Promise.resolve();
    });
    await flushEffects(2);

    expect(mounted.container.textContent).toContain("最近会话");
    expect(mounted.container.textContent).not.toContain("正在加载对话");
    expect(mockListAgentRuntimeSessions).toHaveBeenCalledTimes(1);
  });

  it("点击导航栏归档动作时应走统一 session update 命令", async () => {
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: "session-recent",
        name: "最近会话",
        created_at: 1714000000,
        updated_at: 1714000600,
        archived_at: null,
        workspace_id: "project-1",
      },
    ]);

    const container = mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "claw",
        projectId: "project-1",
      } as AgentPageParams,
    });
    await flushEffects(2);

    const archiveButton = container.querySelector(
      'button[aria-label="归档 最近会话"]',
    ) as HTMLButtonElement | null;

    expect(archiveButton).not.toBeNull();

    await act(async () => {
      archiveButton?.click();
      await Promise.resolve();
    });

    expect(mockUpdateAgentRuntimeSession).toHaveBeenCalledWith({
      session_id: "session-recent",
      archived: true,
    });
  });

  it("显式开启后应显示可选系统扩展入口", async () => {
    mockGetConfig.mockResolvedValue({
      navigation: {
        enabled_items: ["plugins", "openclaw", "companion"],
      },
    });

    const container = mountSidebarContainer({
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects(2);

    expect(container.textContent).toContain("持续流程");
    expect(container.textContent).toContain("消息渠道");
    expect(container.textContent).toContain("插件中心");
    expect(container.textContent).toContain("OpenClaw");
    expect(container.textContent).toContain("桌宠");
  });

  it("配置变更后应重新读取可选入口并刷新侧栏", async () => {
    mockGetConfig
      .mockResolvedValueOnce({
        navigation: {
          enabled_items: [],
        },
      })
      .mockResolvedValueOnce({
        navigation: {
          enabled_items: ["plugins", "companion"],
        },
      });

    const container = mountSidebarContainer({
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects(2);

    expect(container.textContent).toContain("持续流程");
    expect(container.textContent).toContain("消息渠道");
    expect(container.textContent).not.toContain("插件中心");
    expect(container.textContent).not.toContain("桌宠");

    await act(async () => {
      (
        globalThis as typeof globalThis & {
          __appConfigListener?: () => void;
        }
      ).__appConfigListener?.();
      await Promise.resolve();
    });
    await flushEffects(2);

    expect(container.textContent).toContain("插件中心");
    expect(container.textContent).toContain("桌宠");
  });

  it("sceneapps 页面不应再在侧栏展示独立主入口", async () => {
    const container = mountSidebarContainer({
      currentPage: "sceneapps",
      currentPageParams: {
        sceneappId: "story-video-suite",
        projectId: "project-9",
      },
    });
    await flushEffects(2);

    expect(
      container.querySelector('button[aria-label="创作场景"]'),
    ).toBeNull();
  });

  it("点击当前已激活的我的方法入口时不应重复导航", async () => {
    const onNavigate = vi.fn();
    const container = mountSidebarContainer({
      currentPage: "skills",
      onNavigate,
    });
    await flushEffects();

    const button = container.querySelector(
      'button[aria-label="我的方法"]',
    ) as HTMLButtonElement | null;

    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-current")).toBe("page");

    act(() => {
      button?.click();
    });

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("旧的 enabled-items 本地缓存不应再复活历史导航", async () => {
    localStorage.setItem(
      APP_SIDEBAR_ENABLED_ITEMS_STORAGE_KEY,
      JSON.stringify(["plugins", "openclaw", "companion", "video"]),
    );
    mockGetConfig.mockImplementation(() => new Promise(() => undefined));

    const container = mountSidebarContainer({
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects();

    expect(container.textContent).not.toContain("插件中心");
    expect(container.textContent).not.toContain("OpenClaw");
    expect(container.textContent).not.toContain("桌宠");
  });

  it("桌宠入口开启后，进入 companion 视图应高亮桌宠", async () => {
    mockGetConfig.mockResolvedValue({
      navigation: {
        enabled_items: ["companion"],
      },
    });

    const container = mountSidebarContainer({
      currentPage: "settings",
      currentPageParams: {
        tab: SettingsTabs.Providers,
        providerView: "companion",
      },
    });
    await flushEffects(2);

    expect(
      container.querySelector('button[aria-label="桌宠"][aria-current="page"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="设置"][aria-current="page"]'),
    ).toBeNull();
  });

  it("插件中心未开启时不应渲染插件扩展分组", async () => {
    mockGetPluginsForSurface.mockResolvedValue([
      {
        pluginId: "demo-sidebar",
        name: "Demo Sidebar",
        description: "demo",
        icon: "Bot",
        surfaces: ["sidebar"],
      },
    ]);

    const container = mountSidebarContainer({
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects(3);

    expect(container.textContent).not.toContain("插件扩展");
    expect(container.textContent).not.toContain("Demo Sidebar");
  });

  it("插件中心开启后才应显示插件扩展分组", async () => {
    mockGetConfig.mockResolvedValue({
      navigation: {
        enabled_items: ["plugins"],
      },
    });
    mockGetPluginsForSurface.mockResolvedValue([
      {
        pluginId: "demo-sidebar",
        name: "Demo Sidebar",
        description: "demo",
        icon: "Bot",
        surfaces: ["sidebar"],
      },
    ]);

    const container = mountSidebarContainer({
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects(3);

    expect(container.textContent).toContain("插件扩展");
    expect(container.textContent).toContain("Demo Sidebar");
  });
});
