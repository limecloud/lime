import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  changeLimeLocale,
  cleanupAppSidebarTest,
  clickConversationMenuItem,
  flushEffects,
  getStoredOemCloudSessionState,
  mockBuildOemCloudUserCenterUrl,
  mockGetClientReferralDashboard,
  mockListAgentRuntimeSessions,
  mockLogoutClient,
  mockOpenExternalUrl,
  mockStartOemCloudLogin,
  mockToastSuccess,
  mountSidebarContainer,
  openAccountMenu,
  resetAppSidebarTest,
  seedCloudSessionWithReferral,
  setOemCloudBootstrapSnapshot,
  setStoredOemCloudSessionState,
} from "./AppSidebar.testFixtures";
import type { AgentPageParams } from "./AppSidebar.testFixtures";

describe("AppSidebar account menu", () => {
  beforeEach(resetAppSidebarTest);
  afterEach(cleanupAppSidebarTest);

  it("侧栏底部不再渲染账户区，只保留设置与主题入口", async () => {
    setStoredOemCloudSessionState({
      token: "session-token",
      tenant: { id: "tenant-0001" },
      user: { id: "user-001", displayName: "zhong feng shan" },
      session: { id: "session-001" },
    });

    const container = mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: { agentEntry: "new-task" } as AgentPageParams,
    });
    await flushEffects(2);

    expect(
      container.querySelector('[data-testid="app-sidebar-account-button"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="app-sidebar-account-slot"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="app-sidebar-rail-settings"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="app-sidebar-rail-appearance"]'),
    ).not.toBeNull();
  });

  it("已登录账户也不会回到侧栏底部", async () => {
    setStoredOemCloudSessionState({
      token: "session-token",
      tenant: { id: "tenant-0001", name: "Lime Cloud" },
      user: { id: "user-001", displayName: "晚风", email: "wanfeng@example.com" },
      session: { id: "session-001", provider: "google" },
    });
    const container = mountSidebarContainer({ currentPage: "agent", currentPageParams: { agentEntry: "new-task" } as AgentPageParams });
    await flushEffects(2);
    expect(container.querySelector('[data-testid="app-sidebar-account-menu"]')).toBeNull();
    expect(container.querySelector('[data-testid="app-sidebar-account-button"]')).toBeNull();
  });

  it("云端开启邀请时应在头部展示入口并读取 share 事实源", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    seedCloudSessionWithReferral();

    const container = mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects(2);

    const header = container.querySelector(
      '[data-testid="app-sidebar-header"]',
    );
    const inviteButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="app-sidebar-invite-button"]',
    );
    expect(inviteButton).not.toBeNull();
    expect(header?.contains(inviteButton)).toBe(true);

    await act(async () => {
      inviteButton?.click();
      await Promise.resolve();
    });
    await flushEffects(4);

    expect(mockGetClientReferralDashboard).not.toHaveBeenCalled();
    const dialog = document.body.querySelector(
      '[data-testid="app-sidebar-invite-dialog"]',
    );
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("LIME-2026");
    expect(dialog?.textContent).toContain("https://limeai.run");
    expect(dialog?.textContent).toContain("480 积分");
    expect(dialog?.textContent).toContain("120 积分");

    const copyShareButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("复制邀请文案"));

    await act(async () => {
      copyShareButton?.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(
      "邀请你体验Lime，让AI做牛做马，我们来做牛人！前往 https://limeai.run 下载客户端，复制邀请码 LIME-2026 激活并注册账号参与内测",
    );
    expect(mockToastSuccess).toHaveBeenCalledWith("已复制邀请文案");
  });

  it("邀请入口应使用 navigation 命名空间资源", async () => {
    await changeLimeLocale("en-US");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    seedCloudSessionWithReferral();

    const container = mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects(2);

    const inviteButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="app-sidebar-invite-button"]',
    );
    expect(inviteButton?.textContent).toContain("Invite friends");

    await act(async () => {
      inviteButton?.click();
      await Promise.resolve();
    });
    await flushEffects(4);

    const dialog = document.body.querySelector(
      '[data-testid="app-sidebar-invite-dialog"]',
    );
    expect(dialog?.textContent).toContain("Lime Invite");
    expect(dialog?.textContent).toContain("Invite code");
    expect(dialog?.textContent).toContain("480 credits");
    expect(dialog?.textContent).toContain("120 credits");

    const copyShareButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Copy invite message"));

    await act(async () => {
      copyShareButton?.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(
      "邀请你体验Lime，让AI做牛做马，我们来做牛人！前往 https://limeai.run 下载客户端，复制邀请码 LIME-2026 激活并注册账号参与内测",
    );
    expect(mockToastSuccess).toHaveBeenCalledWith("Invite message copied");
  });

  it("缓存的云端邀请开关关闭时不应展示头部邀请入口", async () => {
    seedCloudSessionWithReferral({
      referralEnabled: false,
      referral: null,
    });

    const container = mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects(2);

    expect(
      container.querySelector('[data-testid="app-sidebar-invite-button"]'),
    ).toBeNull();
    expect(mockGetClientReferralDashboard).not.toHaveBeenCalled();
  });

});
