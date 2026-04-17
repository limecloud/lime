import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentPageParams, Page, PageParams } from "@/types/page";
import { recordSceneAppRecentVisit } from "@/lib/sceneapp";
import { AppSidebar } from "./AppSidebar";

const { mockGetConfig, mockGetPluginsForSurface } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockGetPluginsForSurface: vi.fn(),
}));

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: mockGetConfig,
}));

vi.mock("@/lib/api/pluginUI", () => ({
  getPluginsForSurface: mockGetPluginsForSurface,
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
}): MountedSidebar["container"] {
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

  mountedSidebars.push({ container, root });
  return container;
}

function mountControlledSidebar(options?: {
  currentPage?: Page;
  currentPageParams?: PageParams;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const navigationCalls: Array<{ page: Page; params?: PageParams }> = [];

  function ControlledSidebar() {
    const [currentPage, setCurrentPage] = React.useState<Page>(
      options?.currentPage ?? "agent",
    );
    const [currentPageParams, setCurrentPageParams] = React.useState<PageParams>(
      options?.currentPageParams ?? {},
    );

    const handleNavigate = React.useCallback(
      (page: Page, params?: PageParams) => {
        navigationCalls.push({ page, params });
        setCurrentPage(page);
        setCurrentPageParams(params ?? {});
      },
      [],
    );

    return (
      <AppSidebar
        currentPage={currentPage}
        currentPageParams={currentPageParams}
        onNavigate={handleNavigate}
      />
    );
  }

  act(() => {
    root.render(<ControlledSidebar />);
  });

  mountedSidebars.push({ container, root });
  return {
    container,
    navigationCalls,
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("AppSidebar", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localStorage.clear();
    mockGetConfig.mockResolvedValue({});
    mockGetPluginsForSurface.mockResolvedValue([]);
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
  });

  it("进入 Claw 生成页时应自动折叠导航栏", async () => {
    localStorage.setItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY, "false");

    const container = mountSidebar({
      currentPageParams: {
        agentEntry: "claw",
      } as AgentPageParams,
    });
    await flushEffects();

    expect(
      container.querySelector('button[aria-label="展开导航栏"]'),
    ).not.toBeNull();
    expect(localStorage.getItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe(
      "true",
    );
  });

  it("新建任务页应自动展开导航栏，不沿用上一个页面的折叠状态", async () => {
    localStorage.setItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY, "true");

    const container = mountSidebar({
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

  it("旧导航配置未包含能力入口时也应显示固定能力分组和核心入口", async () => {
    mockGetConfig.mockResolvedValue({
      navigation: {
        enabled_items: ["home-general", "claw"],
      },
    });

    const container = mountSidebar({
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects();

    expect(container.textContent).toContain("能力");
    expect(container.textContent).toContain("我的方法");
    expect(container.textContent).toContain("消息渠道");
    expect(container.textContent).toContain("资料");
    expect(container.textContent).toContain("资料库");
    expect(container.textContent).toContain("灵感库");
    expect(container.textContent).not.toContain("视频");
    expect(container.textContent).not.toContain("持续流程");
  });

  it("进入消息渠道页时应高亮对应能力入口并保留能力分组标题", async () => {
    const container = mountSidebar({
      currentPage: "channels",
    });
    await flushEffects();

    expect(container.textContent).toContain("能力");
    expect(
      container.querySelector(
        'button[aria-label="消息渠道"][aria-current="page"]',
      ),
    ).not.toBeNull();
  });

  it("点击当前已激活的创作场景入口时不应重复导航", async () => {
    const onNavigate = vi.fn();
    const container = mountSidebar({
      currentPage: "sceneapps",
      currentPageParams: {
        sceneappId: "story-video-suite",
        projectId: "project-9",
      },
      onNavigate,
    });
    await flushEffects();

    const button = container.querySelector(
      'button[aria-label="创作场景"]',
    ) as HTMLButtonElement | null;

    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-current")).toBe("page");

    act(() => {
      button?.click();
    });

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("侧边栏重新挂载前应先恢复缓存的可选入口，避免持续流程短暂消失", () => {
    localStorage.setItem(
      APP_SIDEBAR_ENABLED_ITEMS_STORAGE_KEY,
      JSON.stringify(["automation"]),
    );
    mockGetConfig.mockImplementation(() => new Promise(() => undefined));

    const container = mountSidebar({
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });

    expect(container.textContent).toContain("持续流程");
  });

  it("点击创作场景入口时应优先恢复最近一次 SceneApp 上下文", async () => {
    const onNavigate = vi.fn();
    recordSceneAppRecentVisit(
      {
        sceneappId: "story-video-suite",
        projectId: "project-9",
        runId: "run-2",
      },
      {
        visitedAt: 600,
      },
    );

    const container = mountSidebar({
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
      onNavigate,
    });
    await flushEffects();

    const button = container.querySelector(
      'button[aria-label="创作场景"]',
    ) as HTMLButtonElement | null;

    expect(button).not.toBeNull();

    act(() => {
      button?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith("sceneapps", {
      sceneappId: "story-video-suite",
      projectId: "project-9",
      runId: "run-2",
    });
  });

  it("快速从持续流程切回创作场景时不应吞掉第二次导航", async () => {
    localStorage.setItem(
      APP_SIDEBAR_ENABLED_ITEMS_STORAGE_KEY,
      JSON.stringify(["automation"]),
    );
    mockGetConfig.mockResolvedValue({
      navigation: {
        enabled_items: ["automation"],
      },
    });
    recordSceneAppRecentVisit(
      {
        sceneappId: "story-video-suite",
        projectId: "project-9",
        runId: "run-2",
      },
      {
        visitedAt: 600,
      },
    );

    const { container, navigationCalls } = mountControlledSidebar({
      currentPage: "sceneapps",
      currentPageParams: {
        sceneappId: "story-video-suite",
        projectId: "project-9",
        runId: "run-2",
      },
    });
    await flushEffects();

    const automationButton = container.querySelector(
      'button[aria-label="持续流程"]',
    ) as HTMLButtonElement | null;
    const sceneAppsButton = container.querySelector(
      'button[aria-label="创作场景"]',
    ) as HTMLButtonElement | null;

    expect(automationButton).not.toBeNull();
    expect(sceneAppsButton).not.toBeNull();

    act(() => {
      automationButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      sceneAppsButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    await flushEffects();

    expect(navigationCalls).toEqual([
      {
        page: "automation",
        params: undefined,
      },
      {
        page: "sceneapps",
        params: {
          sceneappId: "story-video-suite",
          projectId: "project-9",
          runId: "run-2",
        },
      },
    ]);
    expect(
      container.querySelector(
        'button[aria-label="创作场景"][aria-current="page"]',
      ),
    ).not.toBeNull();
  });

  it("默认应隐藏系统区的可选入口，只保留设置", async () => {
    const container = mountSidebar({
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects();

    expect(container.textContent).toContain("系统");
    expect(container.textContent).toContain("设置");
    expect(container.textContent).not.toContain("终端");
    expect(container.textContent).not.toContain("桌宠");
  });

  it("侧边栏不应再渲染旧主题分组标题", async () => {
    const container = mountSidebar({
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects();

    expect(container.textContent).not.toContain("创作主题");
    expect(container.textContent).not.toContain("社媒内容");
  });
});
