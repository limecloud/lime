import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentPageParams, Page, PageParams } from "@/types/page";
import { SettingsTabs } from "@/types/settings";
import { AppSidebar } from "./AppSidebar";
import { LIME_COLOR_SCHEME_STORAGE_KEY } from "@/lib/appearance/colorSchemes";
import { LIME_THEME_STORAGE_KEY } from "@/lib/appearance/themeMode";
import {
  getStoredOemCloudSessionState,
  setOemCloudBootstrapSnapshot,
  setStoredOemCloudSessionState,
} from "@/lib/oemCloudSession";

const {
  mockGetConfig,
  mockSaveConfig,
  mockGetPluginsForSurface,
  mockSubscribeAppConfigChanged,
  mockListAgentRuntimeSessions,
  mockUpdateAgentRuntimeSession,
  mockSetI18nLanguage,
  mockScheduleMinimumDelayIdleTask,
  mockLogoutClient,
  mockStartOemCloudLogin,
  mockGetClientReferralDashboard,
  mockClearSiteAdapterCatalogCache,
  mockToastSuccess,
  mockToastError,
  mockToastInfo,
} = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockGetPluginsForSurface: vi.fn(),
  mockSubscribeAppConfigChanged: vi.fn(),
  mockListAgentRuntimeSessions: vi.fn(),
  mockUpdateAgentRuntimeSession: vi.fn(),
  mockSetI18nLanguage: vi.fn(),
  mockScheduleMinimumDelayIdleTask: vi.fn((task: () => void) => {
    task();
    return () => undefined;
  }),
  mockLogoutClient: vi.fn(),
  mockStartOemCloudLogin: vi.fn(),
  mockGetClientReferralDashboard: vi.fn(),
  mockClearSiteAdapterCatalogCache: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockToastInfo: vi.fn(),
}));

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: mockGetConfig,
  saveConfig: mockSaveConfig,
  subscribeAppConfigChanged: mockSubscribeAppConfigChanged,
}));

vi.mock("@/i18n/I18nPatchProvider", () => ({
  useI18nPatch: () => ({
    language: "zh",
    setLanguage: mockSetI18nLanguage,
  }),
}));

vi.mock("@/lib/api/pluginUI", () => ({
  getPluginsForSurface: mockGetPluginsForSurface,
}));

vi.mock("@/lib/api/agentRuntime", () => ({
  listAgentRuntimeSessions: mockListAgentRuntimeSessions,
  updateAgentRuntimeSession: mockUpdateAgentRuntimeSession,
}));

vi.mock("@/lib/api/oemCloudControlPlane", () => ({
  logoutClient: mockLogoutClient,
  getClientReferralDashboard: mockGetClientReferralDashboard,
}));

vi.mock("@/lib/oemCloudLoginLauncher", () => ({
  startOemCloudLogin: mockStartOemCloudLogin,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
    info: mockToastInfo,
  },
}));

vi.mock("@/lib/siteAdapterCatalogBootstrap", () => ({
  clearSiteAdapterCatalogCache: mockClearSiteAdapterCatalogCache,
}));

vi.mock("@/lib/utils/scheduleMinimumDelayIdleTask", () => ({
  scheduleMinimumDelayIdleTask: mockScheduleMinimumDelayIdleTask,
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

async function openAccountMenu(container: HTMLElement) {
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>(
        '[data-testid="app-sidebar-account-button"]',
      )
      ?.click();
    await Promise.resolve();
  });
}

async function clickAccountMenuItem(container: HTMLElement, label: string) {
  await openAccountMenu(container);

  await act(async () => {
    container
      .querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
      ?.click();
    await Promise.resolve();
  });
}

function buildMockReferralDashboard() {
  return {
    code: {
      id: "refcode-001",
      tenantId: "tenant-0001",
      userId: "user-001",
      code: "LIME-2026",
      landingUrl: "https://limeai.run/invite?code=LIME-2026",
      status: "active",
      createdAt: "2026-04-28T00:00:00.000Z",
      updatedAt: "2026-04-28T00:00:00.000Z",
    },
    policy: {
      enabled: true,
      rewardCredits: 600,
      referrerRewardCredits: 480,
      inviteeRewardCredits: 120,
      claimWindowDays: 30,
      autoClaimEnabled: true,
      allowManualClaimFallback: true,
      riskReviewEnabled: false,
    },
    summary: {
      totalInvites: 0,
      successfulInvites: 0,
      totalRewardCredits: 0,
      referrerRewardCreditsTotal: 0,
      inviteeRewardCreditsTotal: 0,
    },
    events: [],
    rewards: [],
    invitedBy: {},
    share: {
      brandName: "Lime",
      code: "LIME-2026",
      landingUrl: "https://limeai.run/invite?code=LIME-2026",
      downloadUrl: "https://limeai.run",
      shareText:
        "邀请你体验Lime，让AI做牛做马，我们来做牛人！前往 https://limeai.run 下载客户端，复制邀请码 LIME-2026 激活并注册账号参与内测",
      headline: "登录后自动领取奖励",
      rules: "复制邀请码后完成注册即可参与内测。",
    },
  };
}

describe("AppSidebar", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localStorage.clear();
    delete window.__LIME_BOOTSTRAP__;
    delete window.__LIME_OEM_CLOUD__;
    delete window.__LIME_SESSION_TOKEN__;
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("data-lime-theme");
    document.documentElement.removeAttribute("data-lime-color-scheme");
    document.documentElement.removeAttribute("style");
    mockGetConfig.mockResolvedValue({});
    mockSaveConfig.mockResolvedValue(undefined);
    mockGetPluginsForSurface.mockResolvedValue([]);
    mockListAgentRuntimeSessions.mockResolvedValue([]);
    mockUpdateAgentRuntimeSession.mockResolvedValue(undefined);
    mockLogoutClient.mockResolvedValue(undefined);
    mockStartOemCloudLogin.mockResolvedValue({
      mode: "login_url",
      openedUrl: "https://user.limeai.run/login",
    });
    mockGetClientReferralDashboard.mockResolvedValue(
      buildMockReferralDashboard(),
    );
    mockClearSiteAdapterCatalogCache.mockResolvedValue(null);
    mockScheduleMinimumDelayIdleTask.mockImplementation((task: () => void) => {
      task();
      return () => undefined;
    });
    mockSubscribeAppConfigChanged.mockImplementation((listener: () => void) => {
      (
        globalThis as typeof globalThis & { __appConfigListener?: () => void }
      ).__appConfigListener = listener;
      return () => {
        (
          globalThis as typeof globalThis & {
            __appConfigListener?: () => void;
          }
        ).__appConfigListener = undefined;
      };
    });
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
    delete window.__LIME_BOOTSTRAP__;
    delete window.__LIME_OEM_CLOUD__;
    delete window.__LIME_SESSION_TOKEN__;
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("data-lime-theme");
    document.documentElement.removeAttribute("data-lime-color-scheme");
    document.documentElement.removeAttribute("style");
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

  it("默认应渲染一级主导航，并将系统入口收进用户弹框", async () => {
    const container = mountSidebarContainer({
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects(2);

    expect(container.textContent).toContain("任务");
    expect(container.textContent).toContain("新建任务");
    expect(container.textContent).not.toContain("工作台");
    expect(container.textContent).not.toContain("生成");
    expect(container.textContent).toContain("我的方法");
    expect(container.textContent).toContain("灵感库");
    expect(container.textContent).not.toContain("设置");
    expect(container.textContent).not.toContain("持续流程");
    expect(container.textContent).not.toContain("消息渠道");
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
    const footerArea = container.querySelector(
      '[data-testid="app-sidebar-footer-area"]',
    );

    expect(mainNavButtons).toEqual(["新建任务", "我的方法", "灵感库"]);
    expect(
      container.querySelector('[data-testid="app-sidebar-footer-nav"]'),
    ).toBeNull();
    expect(footerArea).not.toBeNull();
    expect(getComputedStyle(footerArea as Element).paddingBottom).toBe("16px");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="app-sidebar-account-button"]',
        )
        ?.click();
      await Promise.resolve();
    });

    const accountMenu = container.querySelector(
      '[data-testid="app-sidebar-account-menu"]',
    );
    expect(accountMenu?.textContent).toContain("设置");
    expect(accountMenu?.textContent).toContain("持续流程");
    expect(accountMenu?.textContent).toContain("消息渠道");
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

    const sidebar = container.querySelector('[data-testid="app-sidebar"]');
    const header = container.querySelector(
      '[data-testid="app-sidebar-header"]',
    );
    const homeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="返回 Lime 首页"]',
    );
    const mainNav = container.querySelector(
      '[data-testid="app-sidebar-main-nav"]',
    );

    expect(sidebar?.getAttribute("data-window-controls-reserved")).toBe("true");
    expect(header).not.toBeNull();
    expect(homeButton).not.toBeNull();
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
  });

  it("首页侧边栏底部应展示紧凑用户弹框与 Lime 云端入口", async () => {
    const onNavigate = vi.fn();
    setStoredOemCloudSessionState({
      token: "session-token",
      tenant: { id: "tenant-0001" },
      user: {
        id: "user-001",
        displayName: "zhong feng shan",
        email: "user@example.com",
      },
      session: { id: "session-001" },
    });

    const container = mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
      onNavigate,
    });
    await flushEffects(2);

    const accountButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="app-sidebar-account-button"]',
    );
    expect(accountButton).not.toBeNull();
    expect(container.textContent).toContain("zhong feng shan");
    expect(container.textContent).toContain("云端");

    await act(async () => {
      accountButton?.click();
      await Promise.resolve();
    });

    const accountMenu = container.querySelector(
      '[data-testid="app-sidebar-account-menu"]',
    );
    expect(accountMenu).not.toBeNull();
    expect(accountMenu?.textContent).toContain("user@example.com");
    expect(accountMenu?.textContent).toContain("免费版");
    expect(accountMenu?.textContent).toContain("查看详情");
    expect(accountMenu?.textContent).not.toContain("云端已连接");
    expect(accountMenu?.textContent).not.toContain("套餐、积分和模型目录");
    expect(accountMenu?.textContent).not.toContain("登录方式：");
    expect(accountMenu?.textContent).not.toContain("默认服务：");
    expect(accountMenu?.textContent).toContain("语言");
    expect(accountMenu?.textContent).toContain("持续流程");
    expect(accountMenu?.textContent).toContain("消息渠道");
    expect(accountMenu?.textContent).toContain("设置");
    expect(accountMenu?.textContent).toContain("用户中心");
    expect(accountMenu?.textContent).toContain("模型设置");
    expect(accountMenu?.textContent).toContain("关于");
    expect(accountMenu?.textContent).toContain("退出登录");
    expect(accountMenu?.textContent).not.toContain("连接 Lime 云端");
    expect(accountMenu?.textContent).not.toContain("主题");
    expect(accountMenu?.textContent).not.toContain("帮助中心");

    const settingsButton = Array.from(
      accountMenu?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent?.includes("设置"));

    await act(async () => {
      settingsButton?.click();
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledWith("settings", {
      tab: SettingsTabs.Home,
    });
  });

  it("已登录账号弹框应展示真实套餐摘要并可直达详情", async () => {
    const onNavigate = vi.fn();
    setStoredOemCloudSessionState({
      token: "session-token",
      tenant: { id: "tenant-0001", name: "Lime Cloud" },
      user: {
        id: "user-001",
        displayName: "晚风",
        email: "wanfeng@example.com",
      },
      session: { id: "session-001", provider: "google" },
    });
    setOemCloudBootstrapSnapshot({
      features: {
        referralEnabled: false,
      },
      providerPreference: {
        providerKey: "lime-hub",
      },
      providerOffersSummary: [
        {
          providerKey: "lime-hub",
          currentPlan: "免费版",
          creditsSummary: "0 / 20 积分 已用0%",
        },
      ],
    });

    const container = mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
      onNavigate,
    });
    await flushEffects(2);
    await openAccountMenu(container);

    const accountMenu = container.querySelector(
      '[data-testid="app-sidebar-account-menu"]',
    );
    expect(accountMenu?.textContent).toContain("免费版");
    expect(accountMenu?.textContent).toContain("0 / 20 积分 已用0%");
    expect(accountMenu?.textContent).toContain("查看详情");
    expect(accountMenu?.textContent).toContain("wanfeng@example.com");
    expect(accountMenu?.textContent).toContain("Lime Cloud");
    expect(accountMenu?.textContent).not.toContain("登录方式：Google");

    await act(async () => {
      accountMenu
        ?.querySelector<HTMLButtonElement>(
          '[data-testid="app-sidebar-cloud-account-card"]',
        )
        ?.click();
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledWith("settings", {
      tab: SettingsTabs.Providers,
      providerView: "cloud",
    });
  });

  it("云端开启邀请时应在头部展示入口并读取 share 事实源", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    setStoredOemCloudSessionState({
      token: "session-token",
      tenant: { id: "tenant-0001", name: "Lime Cloud" },
      user: {
        id: "user-001",
        displayName: "晚风",
        email: "wanfeng@example.com",
      },
      session: { id: "session-001", provider: "google" },
    });
    setOemCloudBootstrapSnapshot({
      session: {
        tenant: { id: "tenant-0001", name: "Lime Cloud" },
      },
      features: {
        referralEnabled: true,
      },
      referral: buildMockReferralDashboard(),
    });

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

  it("缓存的云端邀请开关关闭时不应展示头部邀请入口", async () => {
    setStoredOemCloudSessionState({
      token: "session-token",
      tenant: { id: "tenant-0001", name: "Lime Cloud" },
      user: {
        id: "user-001",
        displayName: "晚风",
        email: "wanfeng@example.com",
      },
      session: { id: "session-001", provider: "google" },
    });
    setOemCloudBootstrapSnapshot({
      session: {
        tenant: { id: "tenant-0001", name: "Lime Cloud" },
      },
      features: {
        referralEnabled: false,
      },
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

  it("未连接 Lime 云端时应保持开源使用口径", async () => {
    const container = mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects(2);

    expect(container.textContent).toContain("开源使用");
    expect(container.textContent).toContain("开源");
    expect(container.textContent).not.toContain("升级");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="app-sidebar-account-button"]',
        )
        ?.click();
      await Promise.resolve();
    });

    const accountMenu = container.querySelector(
      '[data-testid="app-sidebar-account-menu"]',
    );
    expect(accountMenu?.textContent).toContain("开源使用");
    expect(accountMenu?.textContent).toContain("免费版");
    expect(accountMenu?.textContent).toContain("本地模型可配置");
    expect(accountMenu?.textContent).toContain("模型设置");
    expect(accountMenu?.textContent).toContain("连接 Lime 云端");
    expect(accountMenu?.textContent).not.toContain("退出登录");
    expect(
      accountMenu?.querySelector('button[aria-label="Lime 云端"]'),
    ).toBeNull();

    await act(async () => {
      accountMenu
        ?.querySelector<HTMLButtonElement>('button[aria-label="连接 Lime 云端"]')
        ?.click();
      await Promise.resolve();
    });

    expect(mockStartOemCloudLogin).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "已打开 Lime 云端 登录页，请在浏览器完成授权",
    );
  });

  it("开源使用说明应折叠到信息图标中", async () => {
    const container = mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects(2);
    await openAccountMenu(container);

    const accountMenu = container.querySelector(
      '[data-testid="app-sidebar-account-menu"]',
    );
    expect(accountMenu?.textContent).not.toContain(
      "本地开源功能可直接使用",
    );
    expect(
      accountMenu?.querySelector('button[aria-label="开源使用说明"]'),
    ).not.toBeNull();
  });

  it("Lime 云端登录完成后侧边栏应从开源态刷新为账号信息", async () => {
    const container = mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects(2);

    expect(container.textContent).toContain("开源使用");

    await act(async () => {
      setStoredOemCloudSessionState({
        token: "session-token",
        tenant: {
          id: "tenant-0001",
          name: "Lime Cloud",
        },
        user: {
          id: "user-001",
          displayName: "晚风",
          email: "wanfeng@example.com",
          avatarUrl: "https://example.com/avatar.png",
        },
        session: {
          id: "session-001",
          provider: "google",
        },
      });
      await Promise.resolve();
    });
    await flushEffects(2);

    expect(container.textContent).toContain("晚风");
    expect(container.textContent).toContain("云端");

    await openAccountMenu(container);
    const accountMenu = container.querySelector(
      '[data-testid="app-sidebar-account-menu"]',
    );
    expect(accountMenu?.textContent).toContain("wanfeng@example.com");
    expect(accountMenu?.textContent).toContain("Lime Cloud");
    expect(accountMenu?.textContent).toContain("免费版");
    expect(accountMenu?.textContent).not.toContain("登录方式：Google");
  });

  it("用户弹框的语言入口应使用二级弹框并保存真实语言设置", async () => {
    mockGetConfig.mockResolvedValue({ language: "zh" });

    const container = mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects(2);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="app-sidebar-account-button"]',
        )
        ?.click();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="app-sidebar-language-menu"]'),
    ).toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="语言"]')
        ?.click();
      await Promise.resolve();
    });

    const languageMenu = container.querySelector(
      '[data-testid="app-sidebar-language-menu"]',
    );
    expect(languageMenu).not.toBeNull();
    expect(languageMenu?.textContent).toContain("中文");
    expect(languageMenu?.textContent).toContain("English");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="切换语言为English"]',
        )
        ?.click();
      await Promise.resolve();
    });
    await flushEffects(2);

    expect(mockSetI18nLanguage).toHaveBeenCalledWith("en");
    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ language: "en" }),
    );
    expect(
      container.querySelector('[data-testid="app-sidebar-language-menu"]'),
    ).toBeNull();
  });

  it("用户弹框中的收缩入口应导航到真实页面", async () => {
    const onNavigate = vi.fn();
    setStoredOemCloudSessionState({
      token: "session-token",
      tenant: { id: "tenant-0001" },
      user: {
        id: "user-001",
        displayName: "zhong feng shan",
      },
      session: { id: "session-001" },
    });
    const container = mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
      onNavigate,
    });
    await flushEffects(2);

    await clickAccountMenuItem(container, "设置");
    expect(onNavigate).toHaveBeenLastCalledWith("settings", {
      tab: SettingsTabs.Home,
    });

    await clickAccountMenuItem(container, "持续流程");
    expect(onNavigate).toHaveBeenLastCalledWith("automation", undefined);

    await clickAccountMenuItem(container, "消息渠道");
    expect(onNavigate).toHaveBeenLastCalledWith("channels", undefined);

    await clickAccountMenuItem(container, "模型设置");
    expect(onNavigate).toHaveBeenLastCalledWith("settings", {
      tab: SettingsTabs.Providers,
      providerView: "settings",
    });

    await clickAccountMenuItem(container, "Lime 云端");
    expect(onNavigate).toHaveBeenLastCalledWith("settings", {
      tab: SettingsTabs.Providers,
      providerView: "cloud",
    });

    await clickAccountMenuItem(container, "关于");
    expect(onNavigate).toHaveBeenLastCalledWith("settings", {
      tab: SettingsTabs.About,
    });
  });

  it("用户弹框退出登录应清理个人中心会话", async () => {
    setStoredOemCloudSessionState({
      token: "session-token",
      tenant: { id: "tenant-0001" },
      user: {
        id: "user-001",
        displayName: "zhong feng shan",
      },
      session: { id: "session-001" },
    });

    const container = mountSidebarContainer();
    await flushEffects(2);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="app-sidebar-account-button"]',
        )
        ?.click();
      await Promise.resolve();
    });

    const logoutButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("退出登录"),
    );

    await act(async () => {
      logoutButton?.click();
      await Promise.resolve();
    });
    await flushEffects(2);

    expect(mockLogoutClient).toHaveBeenCalledWith("tenant-0001");
    expect(getStoredOemCloudSessionState()).toBeNull();
    expect(
      container.querySelector('[data-testid="app-sidebar-account-menu"]'),
    ).toBeNull();
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
        'button[aria-label="新建任务"][aria-current="page"]',
      ),
    ).not.toBeNull();
  });

  it("claw 页面不应再外露左侧工作台一级入口", async () => {
    const onNavigate = vi.fn();
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: "session-recent",
        name: "最近会话",
        created_at: 1713000000,
        updated_at: 1713000600,
        archived_at: null,
        workspace_id: "project-1",
        messages_count: 3,
      },
    ]);

    const container = mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "claw",
        projectId: "project-1",
        initialSessionId: "session-current",
      } as AgentPageParams,
      onNavigate,
    });
    await flushEffects(2);

    expect(container.querySelector('button[aria-label="工作台"]')).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
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

  it("一级导航下方应继续展示最近对话与归档，并对归档列表懒加载", async () => {
    localStorage.setItem("agent_last_project_id", JSON.stringify("project-1"));
    mockListAgentRuntimeSessions.mockImplementation(
      async (options?: {
        archivedOnly?: boolean;
        includeArchived?: boolean;
        limit?: number;
        workspaceId?: string;
      }) =>
        options?.archivedOnly
          ? [
              {
                id: "session-archived",
                name: "归档会话",
                created_at: 1713000000,
                updated_at: 1713000600,
                archived_at: 1713003600,
                workspace_id: "project-1",
              },
            ]
          : [
              {
                id: "session-recent",
                name: "最近会话",
                created_at: 1714000000,
                updated_at: 1714000600,
                archived_at: null,
                workspace_id: "project-1",
              },
            ],
    );

    const container = mountSidebarContainer({
      currentPage: "settings",
    });
    await flushEffects(2);

    expect(container.textContent).toContain("最近对话");
    expect(container.textContent).toContain("归档");
    expect(container.textContent).toContain("最近会话");
    expect(container.textContent).not.toContain("归档会话");
    expect(mockListAgentRuntimeSessions).toHaveBeenCalledTimes(1);
    expect(mockListAgentRuntimeSessions).toHaveBeenCalledWith({
      limit: 37,
      workspaceId: "project-1",
    });

    const mainNav = container.querySelector(
      '[data-testid="app-sidebar-main-nav"]',
    );
    const conversationShelf = container.querySelector(
      '[data-testid="app-sidebar-conversation-shelf"]',
    );
    const recentConversationList = container.querySelector(
      '[data-testid="app-sidebar-recent-conversations"]',
    );
    const archivedToggle = container.querySelector(
      'button[aria-expanded="false"]',
    ) as HTMLButtonElement | null;

    expect(mainNav).not.toBeNull();
    expect(conversationShelf).not.toBeNull();
    expect(recentConversationList).not.toBeNull();
    expect(getComputedStyle(recentConversationList as Element).overflowY).toBe(
      "auto",
    );
    expect(archivedToggle).not.toBeNull();
    expect(
      Boolean(
        mainNav &&
        conversationShelf &&
        (mainNav.compareDocumentPosition(conversationShelf) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
          0,
      ),
    ).toBe(true);

    await act(async () => {
      archivedToggle?.click();
      await Promise.resolve();
    });
    await flushEffects(2);

    const archivedConversationList = container.querySelector(
      '[data-testid="app-sidebar-archived-conversations"]',
    );
    expect(archivedConversationList).not.toBeNull();
    expect(container.textContent).toContain("归档会话");
    expect(
      getComputedStyle(archivedConversationList as Element).overflowY,
    ).toBe("auto");
    expect(mockListAgentRuntimeSessions).toHaveBeenCalledWith({
      archivedOnly: true,
      limit: 17,
      workspaceId: "project-1",
    });
  });

  it("没有当前工作区时不应加载全局最近对话", async () => {
    const container = mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects(2);

    expect(container.textContent).toContain("最近对话");
    expect(container.textContent).toContain("还没有开始对话");
    expect(mockListAgentRuntimeSessions).not.toHaveBeenCalled();
  });

  it("最近对话应限制初始渲染数量，并保留当前会话可见", async () => {
    mockListAgentRuntimeSessions.mockResolvedValue(
      Array.from({ length: 25 }, (_, index) => {
        const order = index + 1;
        return {
          id: `session-${order}`,
          name: `会话 ${order}`,
          created_at: 1714000000 - order,
          updated_at: 1714000600 - order,
          archived_at: null,
          workspace_id: "project-1",
        };
      }),
    );

    const container = mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "claw",
        projectId: "project-1",
        initialSessionId: "session-25",
      } as AgentPageParams,
    });
    await flushEffects(2);

    expect(container.querySelector('button[title="会话 1"]')).not.toBeNull();
    expect(container.querySelector('button[title="会话 25"]')).not.toBeNull();
    expect(container.querySelector('button[title="会话 24"]')).toBeNull();
    expect(container.textContent).toContain("查看更多对话");
    expect(mockListAgentRuntimeSessions).toHaveBeenCalledWith({
      limit: 37,
      workspaceId: "project-1",
    });

    const targetButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("查看更多对话"),
    );

    expect(targetButton).not.toBeUndefined();

    await act(async () => {
      (targetButton as HTMLButtonElement | undefined)?.click();
      await Promise.resolve();
    });
    await flushEffects(2);

    expect(container.querySelector('button[title="会话 19"]')).not.toBeNull();
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
    expect(mockListAgentRuntimeSessions).toHaveBeenCalledWith({
      limit: 37,
      workspaceId: "project-1",
    });

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
    expect(mockListAgentRuntimeSessions).toHaveBeenCalledTimes(2);
    expect(mockListAgentRuntimeSessions).toHaveBeenCalledWith({
      limit: 37,
      workspaceId: "project-2",
    });
  });

  it("打开已有会话时若导航已有缓存任务，不应立即刷新最近对话列表", async () => {
    const scheduledTasks: Array<() => void> = [];
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: "session-current",
        name: "最近会话",
        created_at: 1713000000,
        updated_at: 1713000600,
        archived_at: null,
        workspace_id: "project-1",
        messages_count: 3,
      },
    ]);

    const mounted = mountSidebar({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "new-task",
        projectId: "project-1",
      } as AgentPageParams,
    });
    await flushEffects(2);

    expect(mockListAgentRuntimeSessions).toHaveBeenCalledTimes(1);

    mockScheduleMinimumDelayIdleTask.mockImplementation((task: () => void) => {
      scheduledTasks.push(task);
      return () => undefined;
    });

    act(() => {
      mounted.root.render(
        <AppSidebar
          currentPage="agent"
          currentPageParams={
            {
              agentEntry: "claw",
              projectId: "project-1",
              initialSessionId: "session-current",
            } as AgentPageParams
          }
          onNavigate={vi.fn()}
        />,
      );
    });
    await flushEffects(2);

    expect(mockListAgentRuntimeSessions).toHaveBeenCalledTimes(1);
    expect(scheduledTasks).toHaveLength(1);

    await act(async () => {
      scheduledTasks[0]?.();
      await Promise.resolve();
    });

    expect(mockListAgentRuntimeSessions).toHaveBeenCalledTimes(2);
    expect(mockListAgentRuntimeSessions).toHaveBeenLastCalledWith({
      limit: 37,
      workspaceId: "project-1",
    });
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
    expect(mockListAgentRuntimeSessions).toHaveBeenCalledWith({
      limit: 37,
      workspaceId: "project-1",
    });

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

    expect(container.textContent).not.toContain("插件中心");
    expect(container.textContent).not.toContain("OpenClaw");
    expect(container.textContent).not.toContain("桌宠");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="app-sidebar-account-button"]',
        )
        ?.click();
      await Promise.resolve();
    });

    const accountMenu = container.querySelector(
      '[data-testid="app-sidebar-account-menu"]',
    );
    expect(accountMenu?.textContent).toContain("设置");
    expect(accountMenu?.textContent).toContain("持续流程");
    expect(accountMenu?.textContent).toContain("消息渠道");
    expect(accountMenu?.textContent).toContain("插件中心");
    expect(accountMenu?.textContent).toContain("OpenClaw");
    expect(accountMenu?.textContent).toContain("桌宠");
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

    expect(container.textContent).not.toContain("插件中心");
    expect(container.textContent).not.toContain("桌宠");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="app-sidebar-account-button"]',
        )
        ?.click();
      await Promise.resolve();
    });

    let accountMenu = container.querySelector(
      '[data-testid="app-sidebar-account-menu"]',
    );
    expect(accountMenu?.textContent).toContain("设置");
    expect(accountMenu?.textContent).toContain("持续流程");
    expect(accountMenu?.textContent).toContain("消息渠道");
    expect(accountMenu?.textContent).not.toContain("插件中心");
    expect(accountMenu?.textContent).not.toContain("桌宠");

    await act(async () => {
      (
        globalThis as typeof globalThis & {
          __appConfigListener?: () => void;
        }
      ).__appConfigListener?.();
      await Promise.resolve();
    });
    await flushEffects(2);

    accountMenu = container.querySelector(
      '[data-testid="app-sidebar-account-menu"]',
    );
    expect(accountMenu?.textContent).toContain("插件中心");
    expect(accountMenu?.textContent).toContain("桌宠");
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

    expect(container.querySelector('button[aria-label="创作场景"]')).toBeNull();
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

  it("底部外观入口应弹出轻量快捷面板并同步主题与配色", async () => {
    const container = mountSidebarContainer({
      currentPageParams: {
        agentEntry: "new-task",
      } as AgentPageParams,
    });
    await flushEffects(2);

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="快速切换外观"]',
    );

    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger?.click();
      await Promise.resolve();
    });

    const popover = container.querySelector(
      '[data-testid="app-sidebar-appearance-popover"]',
    );
    expect(popover).not.toBeNull();
    expect(popover?.textContent).toContain("浅色");
    expect(popover?.textContent).toContain("深色");
    expect(popover?.textContent).toContain("跟随系统");
    expect(popover?.textContent).toContain("Lime 经典");
    expect(popover?.textContent).toContain("森林");
    expect(popover?.textContent).toContain("海雾");
    expect(popover?.textContent).toContain("砂岩");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="切换配色为海雾"]')
        ?.click();
      await Promise.resolve();
    });

    expect(localStorage.getItem(LIME_COLOR_SCHEME_STORAGE_KEY)).toBe(
      "lime-ocean",
    );
    expect(document.documentElement.dataset.limeColorScheme).toBe("lime-ocean");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="切换主题为深色"]')
        ?.click();
      await Promise.resolve();
    });

    expect(localStorage.getItem(LIME_THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.limeTheme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
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

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="app-sidebar-account-button"]',
        )
        ?.click();
      await Promise.resolve();
    });

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
