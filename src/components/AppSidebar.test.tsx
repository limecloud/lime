import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentPageParams, Page, PageParams } from "@/types/page";
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

function mountSidebar(
  options?: {
    currentPage?: Page;
    currentPageParams?: PageParams;
  },
): MountedSidebar["container"] {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <AppSidebar
        currentPage={options?.currentPage ?? "agent"}
        currentPageParams={options?.currentPageParams}
        onNavigate={vi.fn()}
      />,
    );
  });

  mountedSidebars.push({ container, root });
  return container;
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

  it("进入 Claw 任务中心时应自动折叠导航栏", async () => {
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
    expect(localStorage.getItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe("true");
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
    expect(localStorage.getItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe("false");
  });

  it("旧导航配置未包含能力入口时也应显示固定能力分组和核心能力项", async () => {
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
    expect(container.textContent).toContain("视频");
    expect(container.textContent).toContain("技能");
    expect(container.textContent).toContain("自动化");
    expect(container.textContent).toContain("IM 配置");
  });

  it("进入 IM 配置页时应高亮对应能力入口并保留能力分组标题", async () => {
    const container = mountSidebar({
      currentPage: "channels",
    });
    await flushEffects();

    expect(container.textContent).toContain("能力");
    expect(
      container.querySelector('button[aria-label="IM 配置"][aria-current="page"]'),
    ).not.toBeNull();
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
