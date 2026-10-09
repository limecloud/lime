import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanupAppSidebarTest,
  flushEffects,
  mountSidebarContainer,
  mockListInstalledPluginCatalog,
  resetAppSidebarTest,
} from "./AppSidebar.testFixtures";

describe("AppSidebar Plugins", () => {
  beforeEach(resetAppSidebarTest);
  afterEach(cleanupAppSidebarTest);

  it("插件上下文应替换任务目录，切换安装态和技能时保留项目作用域", async () => {
    const onNavigate = vi.fn();
    const container = mountSidebarContainer({
      currentPage: "plugins",
      currentPageParams: { currentProjectId: "project-1" },
      onNavigate,
    });
    await flushEffects();

    expect(
      container.querySelector('[data-testid="app-sidebar-customization"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="app-sidebar-main-nav"]'),
    ).toBeNull();
    expect(container.textContent).toContain("自定义");
    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="app-sidebar-customization-installed"]',
        )
        ?.click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith("plugins", {
      statusFilter: "installed",
      currentProjectId: "project-1",
    });
    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="app-sidebar-customization-skills"]',
        )
        ?.click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith("skills", {
      creationProjectId: "project-1",
    });
  });

  it("已安装目录应读取真实 catalog 投影并随变更刷新，点击直接打开插件详情", async () => {
    mockListInstalledPluginCatalog.mockResolvedValue({
      plugins: [
        { id: "remotion", name: "Remotion", installed: true, enabled: false },
      ],
      generatedAt: "now",
    });
    const onNavigate = vi.fn();
    const container = mountSidebarContainer({
      currentPage: "plugins",
      onNavigate,
    });
    await flushEffects();
    expect(
      container.querySelector('[data-testid="app-sidebar-installed-plugin"]')
        ?.textContent,
    ).toBe("Remotion");
    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="app-sidebar-installed-plugin"]',
        )
        ?.click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith("plugins", {
      statusFilter: "installed",
      selectedPluginId: "remotion",
    });

    mockListInstalledPluginCatalog.mockResolvedValue({
      plugins: [],
      generatedAt: "updated",
    });
    await act(async () => {
      window.dispatchEvent(new Event("lime:plugin-catalog-changed"));
      await Promise.resolve();
    });
    await flushEffects();
    expect(
      container.querySelector('[data-testid="app-sidebar-installed-plugin"]'),
    ).toBeNull();
    expect(container.textContent).toContain("还没有已安装插件");
  });

  it("插件读取失败应显示错误并保留可用的静态上下文导航", async () => {
    mockListInstalledPluginCatalog.mockRejectedValue(new Error("offline"));
    const container = mountSidebarContainer({ currentPage: "plugins" });
    await flushEffects();
    expect(container.textContent).toContain("暂时无法读取已安装插件");
    expect(
      container.querySelector(
        '[data-testid="app-sidebar-customization-skills"]',
      ),
    ).not.toBeNull();
  });

  it("插件中心入口应常驻主导航并进入插件页", async () => {
    const onNavigate = vi.fn();
    const container = mountSidebarContainer({ onNavigate });
    await flushEffects(2);

    expect(
      Array.from(
        container.querySelectorAll(
          '[data-testid="app-sidebar-main-nav"] button',
        ),
      ).map((button) => button.getAttribute("aria-label")),
    ).toEqual(["新建任务", "已安排任务", "插件"]);

    act(() => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="插件"]')
        ?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith("plugins", undefined);
  });

  it("已安装 Plugin 不应作为左侧独立导航项显示", async () => {
    const container = mountSidebarContainer();
    await flushEffects(2);

    const mainNav = container.querySelector(
      '[data-testid="app-sidebar-main-nav"]',
    );
    expect(mainNav?.textContent).toContain("插件");
    expect(mainNav?.textContent).not.toContain("内容工厂");
    expect(mainNav?.textContent).not.toContain("发布应用");
    expect(
      Array.from(
        container.querySelectorAll(
          '[data-testid="app-sidebar-main-nav"] button',
        ),
      ).map((button) => button.getAttribute("aria-label")),
    ).toEqual(["新建任务", "已安排任务", "插件"]);
  });

  it("Plugin 变更事件不应影响侧栏聚合入口", async () => {
    const container = mountSidebarContainer();
    await flushEffects(2);

    await act(async () => {
      window.dispatchEvent(new Event("lime:plugins-changed"));
      await Promise.resolve();
    });
    await flushEffects(2);

    expect(
      Array.from(
        container.querySelectorAll(
          '[data-testid="app-sidebar-main-nav"] button',
        ),
      ).map((button) => button.getAttribute("aria-label")),
    ).toEqual(["新建任务", "已安排任务", "插件"]);
  });

  it("安装态读取失败不应影响静态 Plugins 聚合入口", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const container = mountSidebarContainer();
      await flushEffects(2);

      expect(
        container.querySelector<HTMLButtonElement>('button[aria-label="插件"]'),
      ).not.toBeNull();
      expect(container.textContent).not.toContain("内容工厂");
      expect(
        errorSpy.mock.calls.map(([message]) => String(message)),
      ).not.toEqual(
        expect.arrayContaining([
          expect.stringContaining("加载 Plugin 导航失败"),
        ]),
      );
      expect(
        warnSpy.mock.calls.map(([message]) => String(message)),
      ).not.toEqual(
        expect.arrayContaining([
          expect.stringContaining("加载 Plugin 导航失败"),
        ]),
      );
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
