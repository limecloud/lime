import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_SIDEBAR_COLLAPSED_STORAGE_KEY,
  act,
  cleanupAppSidebarTest,
  flushEffects,
  mockListRecentThreads,
  mockScheduleMinimumDelayIdleTask,
  mountSidebarContainer,
  resetAppSidebarTest,
} from "./AppSidebar.testFixtures";
import type { AgentPageParams } from "./AppSidebar.testFixtures";

describe("AppSidebar navigation", () => {
  beforeEach(resetAppSidebarTest);
  afterEach(cleanupAppSidebarTest);

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

  it("展开态分离图标导航和会话侧栏，复用唯一导航动作", async () => {
    const onNavigate = vi.fn();
    const container = mountSidebarContainer({ onNavigate });
    await flushEffects(2);
    expect(
      container.querySelector('[data-testid="app-sidebar-rail"]'),
    ).not.toBeNull();
    const buttons = container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="app-sidebar-nav-scheduled-tasks"]',
    );
    expect(buttons).toHaveLength(1);
    const settings = container.querySelector<HTMLButtonElement>(
      '[data-testid="app-sidebar-nav-settings"]',
    )!;
    expect(settings).not.toBeNull();
    expect(getComputedStyle(settings).display).not.toBe("none");
    act(() => settings.click());
    expect(onNavigate).toHaveBeenCalledWith("settings", { tab: "general" });
    act(() => buttons[0].click());
    expect(onNavigate).toHaveBeenCalledWith("scheduled-tasks", undefined);
  });

  it("折叠后保留图标导航，设置和首页仍可操作", async () => {
    const onNavigate = vi.fn();
    const container = mountSidebarContainer({ onNavigate });
    await flushEffects(2);
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="折叠导航栏"]')
        ?.click(),
    );
    await flushEffects();
    const sidebar = container.querySelector<HTMLElement>(
      '[data-testid="app-sidebar"]',
    )!;
    expect(sidebar.dataset.collapsed).toBe("true");
    expect(getComputedStyle(sidebar).width).toBe("52px");
    expect(
      container.querySelector('[data-testid="app-sidebar-rail"]'),
    ).not.toBeNull();
    const settings = container.querySelector<HTMLButtonElement>(
      '[data-testid="app-sidebar-nav-settings"]',
    )!;
    act(() => settings.click());
    expect(onNavigate).toHaveBeenCalledWith("settings", { tab: "general" });
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="app-sidebar-expand"]')
        ?.click(),
    );
    await flushEffects();
    expect(sidebar.dataset.collapsed).toBe("false");
  });

  it("新建任务首页应短 idle 加载最近对话，避免列表首屏长时间为空", async () => {
    const scheduledTasks: Array<{
      task: () => void;
      options?: { minimumDelayMs?: number; idleTimeoutMs?: number };
    }> = [];
    mockScheduleMinimumDelayIdleTask.mockImplementation(
      (
        task: () => void,
        options?: { minimumDelayMs?: number; idleTimeoutMs?: number },
      ) => {
        scheduledTasks.push({ task, options });
        return () => undefined;
      },
    );

    mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "new-task",
        projectId: "project-1",
      } as AgentPageParams,
    });
    await flushEffects(2);

    const deferredSessionLoad = scheduledTasks.find(
      (entry) =>
        entry.options?.minimumDelayMs === 0 &&
        entry.options?.idleTimeoutMs === 0,
    );
    expect(deferredSessionLoad).toBeDefined();

    await act(async () => {
      deferredSessionLoad?.task();
      await Promise.resolve();
    });
    await flushEffects(2);

    expect(mockListRecentThreads).toHaveBeenCalledWith({
      archived: false,
      limit: 11,
      sectionId: null,
    });
  });

  it("用户折叠和展开导航栏都会保存实际选择", async () => {
    localStorage.setItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY, "false");

    const container = mountSidebarContainer();
    await flushEffects();

    expect(
      container.querySelector('button[aria-label="折叠导航栏"]'),
    ).not.toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="折叠导航栏"]')
        ?.click();
      await Promise.resolve();
    });

    expect(
      container.querySelector('button[aria-label="展开导航栏"]'),
    ).not.toBeNull();
    expect(localStorage.getItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe(
      "true",
    );

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="展开导航栏"]')
        ?.click();
      await Promise.resolve();
    });

    expect(
      container.querySelector('button[aria-label="折叠导航栏"]'),
    ).not.toBeNull();
    expect(localStorage.getItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe(
      "false",
    );
  });

  it("图标栏承接主入口与设置，只有新聊天留在上下文侧栏", async () => {
    const container = mountSidebarContainer({
      currentPage: "agent",
    });
    await flushEffects(2);

    expect(container.textContent).toContain("任务");
    expect(container.textContent).toContain("新聊天");
    expect(container.textContent).not.toContain("工作台");
    expect(container.textContent).not.toContain("生成");
    expect(container.textContent).not.toContain("专家");
    expect(container.textContent).not.toContain("Skills");
    expect(container.textContent).toContain("插件");
    expect(container.textContent).toContain("已安排任务");
    expect(container.textContent).not.toContain("项目资料");
    expect(container.textContent).not.toContain("灵感");
    expect(container.textContent).toContain("设置");
    expect(container.textContent).not.toContain("持续流程");
    expect(container.textContent).not.toContain("消息渠道");
    expect(container.textContent).not.toContain("桌宠");
    expect(container.textContent).not.toContain("支撑");
    expect(container.textContent).not.toContain("技能");
    expect(container.textContent).not.toContain("能力");
    expect(container.textContent).not.toContain("系统");

    const mainNavButtons = Array.from(
      container.querySelectorAll('[data-testid="app-sidebar-main-nav"] button'),
    ).map((button) => button.getAttribute("aria-label"));
    const menuScroll = container.querySelector(
      '[data-testid="app-sidebar-menu-scroll"]',
    );
    const settingsRailButton = container.querySelector(
      '[data-testid="app-sidebar-nav-settings"]',
    );

    expect(mainNavButtons).toEqual(["新聊天"]);
    const rail = container.querySelector('[data-testid="app-sidebar-rail"]')!;
    expect(rail.contains(settingsRailButton)).toBe(true);
    expect(
      rail.querySelector('[data-testid="app-sidebar-nav-plugins"]'),
    ).not.toBeNull();
    expect(
      rail.querySelector('[data-testid="app-sidebar-nav-new-chat"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="app-sidebar-footer-nav"]'),
    ).toBeNull();
    expect(menuScroll).not.toBeNull();
    expect(getComputedStyle(menuScroll as Element).flexGrow).toBe("1");
    expect(getComputedStyle(menuScroll as Element).flexShrink).toBe("1");
    expect(settingsRailButton).not.toBeNull();
    expect(
      container.querySelector('[data-testid="app-sidebar-appearance"]'),
    ).not.toBeNull();
    expect(
      rail.querySelector('[data-testid="app-sidebar-account-button"]'),
    ).not.toBeNull();
  });

  it("已安排任务应作为一级入口打开独立任务页面", async () => {
    const onNavigate = vi.fn();
    const container = mountSidebarContainer({ onNavigate });
    await flushEffects(2);

    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="app-sidebar-nav-scheduled-tasks"]',
    );

    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-label")).toBe("已安排任务");

    act(() => {
      button?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith("scheduled-tasks", undefined);
  });

  it("已安排任务页沿用同一导航栏", async () => {
    localStorage.setItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY, "false");
    const container = mountSidebarContainer({
      currentPage: "scheduled-tasks",
    });
    await flushEffects(2);

    expect(
      container
        .querySelector('[data-testid="app-sidebar"]')
        ?.getAttribute("data-collapsed"),
    ).toBe("false");
    expect(
      container.querySelector('[data-testid="app-sidebar-nav-settings"]'),
    ).not.toBeNull();
  });

  it("从项目工作区进入已安排任务时应保留项目作用域", async () => {
    const onNavigate = vi.fn();
    const container = mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "new-task",
        projectId: "project-current",
      } as AgentPageParams,
      onNavigate,
    });
    await flushEffects(2);

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="app-sidebar-nav-scheduled-tasks"]',
        )
        ?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith("scheduled-tasks", {
      projectId: "project-current",
    });
  });

  it("Lime 首页入口应保持在左侧栏顶部，并在 macOS 预留系统按钮安全区", async () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });

    const onNavigate = vi.fn();
    const container = mountSidebarContainer({
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
      onNavigate,
    });
    await flushEffects(2);

    const header = container.querySelector(
      '[data-testid="app-sidebar-header"]',
    );
    const homeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="返回 Lime 首页"]',
    );
    const mainNav = container.querySelector(
      '[data-testid="app-sidebar-main-nav"]',
    );

    expect(
      container.querySelector<HTMLElement>("[data-app-shell-titlebar]")?.style
        .paddingInlineStart,
    ).toBe("92px");
    expect(header).not.toBeNull();
    expect(homeButton).not.toBeNull();
    expect(homeButton?.textContent).toContain("Lime");
    expect(homeButton?.querySelector("img")).toBeNull();
    expect(header?.contains(homeButton)).toBe(true);
    expect(
      Boolean(
        header &&
        mainNav &&
        (header.compareDocumentPosition(mainNav) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
          0,
      ),
    ).toBe(true);

    await act(async () => {
      homeButton?.click();
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate.mock.calls[0]?.[0]).toBe("agent");
    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agentEntry: "new-task",
      }),
    );
    expect((onNavigate.mock.calls[0]?.[1] as AgentPageParams).projectId).toBe(
      undefined,
    );
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
      container.querySelector(
        'button[aria-label="新聊天"][aria-current="page"]',
      ),
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
});
