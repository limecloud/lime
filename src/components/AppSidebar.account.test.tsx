import { accountFixture, seedCloudAccount } from "@/test/cloudAccountFixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  APP_SIDEBAR_COLLAPSED_STORAGE_KEY,
  changeLimeLocale,
  cleanupAppSidebarTest,
  flushEffects,
  mockStartOemCloudLogin,
  mockToastError,
  mountSidebarContainer,
  resetAppSidebarTest,
  SettingsTabs,
} from "./AppSidebar.testFixtures";
import type { AgentPageParams } from "./AppSidebar.testFixtures";

async function openProfileMenu(container: HTMLElement) {
  const button = container.querySelector<HTMLButtonElement>(
    '[data-testid="app-sidebar-account-button"]',
  )!;
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  await act(async () => {
    button.focus();
    button.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
  });
  return await vi.waitFor(() => {
    const menu = document.body.querySelector<HTMLElement>(
      '[data-testid="app-sidebar-account-menu"]',
    );
    expect(menu).not.toBeNull();
    return menu!;
  });
}

function menuItem(menu: HTMLElement, label: string) {
  return Array.from(
    menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ).find((item) => item.textContent === label)!;
}

describe("AppSidebar profile footer", () => {
  beforeEach(resetAppSidebarTest);
  afterEach(cleanupAppSidebarTest);

  it("展开和折叠均在 rail 底部保留紧凑账号入口，菜单使用共享账号投影", async () => {
    await seedCloudAccount({
      tenant: { id: "tenant-0001" },
      user: {
        id: "user-001",
        displayName: "晚风",
        email: "wanfeng@example.com",
      },
      session: { id: "session-001" },
    });
    const onNavigate = vi.fn();
    const container = mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: { agentEntry: "new-task" } as AgentPageParams,
      onNavigate,
    });
    await flushEffects(2);
    const footer = container.querySelector(
      '[data-testid="app-sidebar-footer"]',
    )!;
    const accountButton = footer.querySelector(
      '[data-testid="app-sidebar-account-button"]',
    )!;
    expect(accountButton.getAttribute("title")).toBe("晚风");
    expect(
      footer.querySelector('[data-testid="app-sidebar-nav-settings"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="app-sidebar-cloud-account-card"]'),
    ).toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="app-sidebar-collapse"]',
        )!
        .click();
    });
    expect(localStorage.getItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe(
      "true",
    );
    expect(footer.contains(accountButton)).toBe(true);
    const menu = await openProfileMenu(container);
    expect(menu.textContent).toContain("wanfeng@example.com");
    await act(async () => menuItem(menu, "个人资料").click());
    expect(onNavigate).toHaveBeenCalledWith("settings", {
      tab: SettingsTabs.Profile,
    });
  });

  it("退出登录调用 canonical 账号 owner，随后菜单切到登录动作", async () => {
    await seedCloudAccount({
      tenant: { id: "tenant-0001" },
      user: { id: "user-001", displayName: "晚风" },
      session: { id: "session-001" },
    });
    const container = mountSidebarContainer();
    await flushEffects(2);
    let menu = await openProfileMenu(container);
    await act(async () => menuItem(menu, "退出登录").click());
    expect(accountFixture.logout).toHaveBeenCalledOnce();
    menu = await openProfileMenu(container);
    expect(menuItem(menu, "登录")).toBeDefined();
    expect(menuItem(menu, "退出登录")).toBeUndefined();
  });

  it("未登录可打开登录，失败仍可重试", async () => {
    mockStartOemCloudLogin.mockRejectedValueOnce(
      new Error("login unavailable"),
    );
    const container = mountSidebarContainer();
    await flushEffects(2);
    let menu = await openProfileMenu(container);
    await act(async () => menuItem(menu, "登录").click());
    expect(mockToastError).toHaveBeenCalledWith("login unavailable");
    menu = await openProfileMenu(container);
    await act(async () => menuItem(menu, "登录").click());
    expect(mockStartOemCloudLogin).toHaveBeenCalledTimes(2);
  });

  it("五语言均提供账号菜单可访问名称", async () => {
    const container = mountSidebarContainer();
    for (const [locale, label] of [
      ["zh-CN", "打开账号菜单"],
      ["zh-TW", "開啟帳號選單"],
      ["en-US", "Open profile menu"],
      ["ja-JP", "プロフィールメニューを開く"],
      ["ko-KR", "프로필 메뉴 열기"],
    ]) {
      await act(async () => changeLimeLocale(locale));
      expect(
        container
          .querySelector('[data-testid="app-sidebar-account-button"]')
          ?.getAttribute("aria-label"),
      ).toBe(label);
    }
  });
});
