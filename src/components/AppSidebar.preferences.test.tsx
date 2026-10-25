import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_SIDEBAR_ENABLED_ITEMS_STORAGE_KEY,
  act,
  cleanupAppSidebarTest,
  flushEffects,
  mockGetConfig,
  mockGetUpdateInstallSession,
  mountSidebarContainer,
  resetAppSidebarTest,
} from "./AppSidebar.testFixtures";
import type { AgentPageParams } from "./AppSidebar.testFixtures";

describe("AppSidebar preferences", () => {
  beforeEach(resetAppSidebarTest);
  afterEach(cleanupAppSidebarTest);

  it("版本尚未确认的下载会话不应显示更新入口", async () => {
    mockGetUpdateInstallSession.mockResolvedValue({
      sessionId: "checking-update",
      stage: "downloading",
      currentVersion: "1.57.0",
      latestVersion: null,
      downloadUrl: null,
      downloadedBytes: 0,
      totalBytes: null,
      percent: 0,
      message: "正在下载并验证更新",
      error: null,
      startedAt: 1,
      updatedAt: 2,
      completedAt: null,
      canCloseWindow: true,
      isActive: true,
    });

    const container = mountSidebarContainer({
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects(3);

    expect(
      container.querySelector('[data-testid="app-sidebar-update-button"]'),
    ).toBeNull();
  });

  it.each(["plugins", "skills", "experts"] as const)(
    "自定义侧栏在 %s 子页面应激活对应入口",
    async (currentPage) => {
      const container = mountSidebarContainer({ currentPage });
      await flushEffects();

      const button = container.querySelector<HTMLButtonElement>(
        `[data-testid="app-sidebar-customization-${currentPage}"]`,
      );

      expect(button).not.toBeNull();
      expect(button?.getAttribute("aria-current")).toBe("page");
      expect(
        container.querySelector('[data-testid="app-sidebar-nav-skills"]'),
      ).toBeNull();
      expect(
        container.querySelector('[data-testid="app-sidebar-nav-experts"]'),
      ).toBeNull();
    },
  );

  it("从 Skills 子页面点击侧栏插件入口应回到插件 Tab", async () => {
    const onNavigate = vi.fn();
    const container = mountSidebarContainer({
      currentPage: "skills",
      onNavigate,
    });
    await flushEffects();

    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="app-sidebar-customization-plugins"]',
    );

    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-current")).toBeNull();

    act(() => {
      button?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith("plugins", {});
  });

  it("从项目会话进入插件工作台应保留当前项目作用域", async () => {
    const onNavigate = vi.fn();
    const container = mountSidebarContainer({
      currentPageParams: {
        agentEntry: "conversation",
        projectId: "project-1",
      } as AgentPageParams,
      onNavigate,
    });
    await flushEffects();

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="app-sidebar-nav-plugins"]',
        )
        ?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith("plugins", {
      currentProjectId: "project-1",
    });
  });

  it("旧的 enabled-items 本地缓存不应再复活历史导航", async () => {
    localStorage.setItem(
      APP_SIDEBAR_ENABLED_ITEMS_STORAGE_KEY,
      JSON.stringify(["plugins", "companion", "video"]),
    );
    mockGetConfig.mockImplementation(() => new Promise(() => undefined));

    const container = mountSidebarContainer({
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects();

    expect(container.textContent).not.toContain("插件中心");
    expect(container.textContent).not.toContain("桌宠");
  });

  it("旧皮肤偏好不能恢复外观快捷面板，设置入口仍可导航", async () => {
    localStorage.setItem("lime.appearance.skin", "dream-blossom");
    const container = mountSidebarContainer({ currentPage: "agent" });
    await flushEffects(2);
    expect(
      container.querySelector('[data-testid="app-sidebar-appearance"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="app-sidebar-appearance-popover"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="app-sidebar-nav-settings"]'),
    ).not.toBeNull();
  });
});
