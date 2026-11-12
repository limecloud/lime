import { seedCloudAccount } from "@/test/cloudAccountFixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanupAppSidebarTest,
  flushEffects,
  mountSidebarContainer,
  mockListInstalledPluginCatalog,
  resetAppSidebarTest,
} from "./AppSidebar.testFixtures";
import { logoutCloudAccount } from "@/lib/cloudAccount";

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
    expect(
      container.querySelector(
        '[data-testid="app-sidebar-customization-installed"]',
      ),
    ).toBeNull();
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
      marketplaces: [
        {
          name: "personal",
          plugins: [
            {
              id: "remotion",
              name: "Remotion",
              installed: true,
              enabled: false,
            },
          ],
        },
      ],
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
      marketplaces: [],
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

  it("换号立即清除旧安装列表并拒绝迟到响应，注销后仍读取本地插件", async () => {
    const installed = (name: string) => ({
      marketplaces: [
        {
          name: "workspace-directory",
          plugins: [
            {
              id: `${name}@workspace-directory`,
              name,
              installed: true,
              enabled: true,
            },
          ],
        },
      ],
    });
    await seedCloudAccount({
      userId: "first",
      generation: "first-generation",
    });
    mockListInstalledPluginCatalog.mockResolvedValue(installed("first-plugin"));
    const container = mountSidebarContainer({ currentPage: "plugins" });
    await flushEffects();
    const names = () =>
      Array.from(
        container.querySelectorAll(
          '[data-testid="app-sidebar-installed-plugin"]',
        ),
      ).map((element) => element.textContent);
    expect(names()).toEqual(["first-plugin"]);

    let resolveOld!: (value: unknown) => void;
    mockListInstalledPluginCatalog.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    await act(async () => {
      window.dispatchEvent(new Event("lime:plugin-catalog-changed"));
    });
    let resolveCurrent!: (value: unknown) => void;
    mockListInstalledPluginCatalog.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCurrent = resolve;
      }),
    );
    await act(async () => {
      await seedCloudAccount({
        userId: "second",
        generation: "second-generation",
      });
    });
    expect(names()).toEqual([]);
    await act(async () => {
      resolveOld(installed("first-plugin"));
    });
    expect(names()).toEqual([]);
    await act(async () => {
      resolveCurrent(installed("second-plugin"));
    });
    expect(names()).toEqual(["second-plugin"]);

    mockListInstalledPluginCatalog.mockResolvedValue({
      marketplaces: [
        {
          name: "local",
          plugins: [
            {
              id: "local-plugin@local",
              name: "local-plugin",
              installed: true,
              enabled: true,
            },
          ],
        },
      ],
    });
    await act(async () => {
      await logoutCloudAccount();
    });
    await flushEffects();
    expect(names()).toEqual(["local-plugin"]);
    mockListInstalledPluginCatalog.mockRejectedValueOnce(
      new Error("unavailable"),
    );
    await act(async () => {
      window.dispatchEvent(new Event("lime:plugin-catalog-changed"));
    });
    await flushEffects();
    expect(names()).toEqual([]);
    expect(container.textContent).toContain("暂时无法读取已安装插件");
  });

  it("插件入口应常驻主导航并进入插件页", async () => {
    const onNavigate = vi.fn();
    const container = mountSidebarContainer({ onNavigate });
    await flushEffects(2);

    expect(
      Array.from(
        container.querySelectorAll(
          '[data-testid="app-sidebar-rail"] [data-testid^="app-sidebar-nav-"]:not([data-testid="app-sidebar-nav-settings"])',
        ),
      ).map((button) => button.getAttribute("aria-label")),
    ).toEqual(["定时任务", "插件"]);

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

    const mainNav = container.querySelector('[data-testid="app-sidebar-rail"]');
    expect(mainNav?.textContent).toContain("插件");
    expect(mainNav?.textContent).not.toContain("内容工厂");
    expect(mainNav?.textContent).not.toContain("发布应用");
    expect(
      Array.from(
        container.querySelectorAll(
          '[data-testid="app-sidebar-rail"] [data-testid^="app-sidebar-nav-"]:not([data-testid="app-sidebar-nav-settings"])',
        ),
      ).map((button) => button.getAttribute("aria-label")),
    ).toEqual(["定时任务", "插件"]);
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
          '[data-testid="app-sidebar-rail"] [data-testid^="app-sidebar-nav-"]:not([data-testid="app-sidebar-nav-settings"])',
        ),
      ).map((button) => button.getAttribute("aria-label")),
    ).toEqual(["定时任务", "插件"]);
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
