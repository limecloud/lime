import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentPageParams, Page, PageParams } from "@/types/page";
import { SettingsTabs } from "@/types/settings";
import { AppSidebar } from "./AppSidebar";

const { mockGetConfig, mockGetPluginsForSurface, mockSubscribeAppConfigChanged } =
  vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockGetPluginsForSurface: vi.fn(),
  mockSubscribeAppConfigChanged: vi.fn(),
}));

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: mockGetConfig,
  subscribeAppConfigChanged: mockSubscribeAppConfigChanged,
}));

vi.mock("@/lib/api/pluginUI", () => ({
  getPluginsForSurface: mockGetPluginsForSurface,
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

  it("进入生成页时应自动折叠导航栏", async () => {
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

  it("新建任务页应自动展开导航栏", async () => {
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

  it("默认应渲染任务、能力、资料、系统四段导航，并隐藏系统扩展入口", async () => {
    const container = mountSidebar({
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects(2);

    expect(container.textContent).toContain("任务");
    expect(container.textContent).toContain("新建任务");
    expect(container.textContent).toContain("生成");
    expect(container.textContent).toContain("能力");
    expect(container.textContent).toContain("我的方法");
    expect(container.textContent).toContain("创作场景");
    expect(container.textContent).toContain("持续流程");
    expect(container.textContent).toContain("消息渠道");
    expect(container.textContent).toContain("资料");
    expect(container.textContent).toContain("资料库");
    expect(container.textContent).toContain("灵感库");
    expect(container.textContent).toContain("系统");
    expect(container.textContent).toContain("设置");
    expect(container.textContent).not.toContain("插件中心");
    expect(container.textContent).not.toContain("OpenClaw");
    expect(container.textContent).not.toContain("桌宠");
    expect(container.textContent).not.toContain("支撑");
    expect(container.textContent).not.toContain("技能");
  });

  it("恢复默认 agent 页时应把当前主舞台归到生成", async () => {
    const container = mountSidebar({
      currentPage: "agent",
    });
    await flushEffects(2);

    expect(
      container.querySelector('button[aria-label="生成"][aria-current="page"]'),
    ).not.toBeNull();
  });

  it("显式开启后应显示隐藏的系统扩展入口", async () => {
    mockGetConfig.mockResolvedValue({
      navigation: {
        enabled_items: ["plugins", "openclaw", "companion"],
      },
    });

    const container = mountSidebar({
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects(2);

    expect(container.textContent).toContain("插件中心");
    expect(container.textContent).toContain("OpenClaw");
    expect(container.textContent).toContain("桌宠");
  });

  it("配置变更后应重新读取隐藏入口并刷新侧栏", async () => {
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

    const container = mountSidebar({
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects(2);

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

  it("sceneapps 页面应高亮创作场景，而不是把它并回我的方法", async () => {
    const container = mountSidebar({
      currentPage: "sceneapps",
      currentPageParams: {
        sceneappId: "story-video-suite",
        projectId: "project-9",
      },
    });
    await flushEffects(2);

    expect(
      container.querySelector(
        'button[aria-label="创作场景"][aria-current="page"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="我的方法"][aria-current="page"]'),
    ).toBeNull();
  });

  it("点击当前已激活的我的方法入口时不应重复导航", async () => {
    const onNavigate = vi.fn();
    const container = mountSidebar({
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

    const container = mountSidebar({
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

    const container = mountSidebar({
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

    const container = mountSidebar({
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

    const container = mountSidebar({
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects(3);

    expect(container.textContent).toContain("插件扩展");
    expect(container.textContent).toContain("Demo Sidebar");
  });
});
