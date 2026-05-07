import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentPageParams, Page, PageParams } from "@/types/page";
import { SettingsTabs } from "@/types/settings";
import { AppSidebar } from "./AppSidebar";
import {
  TASK_CENTER_CREATE_DRAFT_TASK_EVENT,
  TASK_CENTER_OPEN_TASK_EVENT,
  TASK_CENTER_PREFETCH_TASK_EVENT,
} from "@/components/agent/chat/taskCenterDraftTaskEvents";
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
  mockDeleteAgentRuntimeSession,
  mockSetI18nLanguage,
  mockScheduleMinimumDelayIdleTask,
  mockLogoutClient,
  mockGetConfiguredOemCloudTarget,
  mockBuildOemCloudUserCenterUrl,
  mockCreateExternalBrowserOpenTarget,
  mockOpenExternalUrl,
  mockStartOemCloudLogin,
  mockGetClientReferralDashboard,
  mockClearSiteAdapterCatalogCache,
  mockToastSuccess,
  mockToastError,
  mockToastInfo,
  mockRecordAgentUiPerformanceMetric,
} = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockGetPluginsForSurface: vi.fn(),
  mockSubscribeAppConfigChanged: vi.fn(),
  mockListAgentRuntimeSessions: vi.fn(),
  mockUpdateAgentRuntimeSession: vi.fn(),
  mockDeleteAgentRuntimeSession: vi.fn(),
  mockSetI18nLanguage: vi.fn(),
  mockScheduleMinimumDelayIdleTask: vi.fn((task: () => void) => {
    task();
    return () => undefined;
  }),
  mockLogoutClient: vi.fn(),
  mockGetConfiguredOemCloudTarget: vi.fn(),
  mockBuildOemCloudUserCenterUrl: vi.fn(
    (baseUrl: string, path = "") => `${baseUrl}${path}`,
  ),
  mockCreateExternalBrowserOpenTarget: vi.fn(() => null),
  mockOpenExternalUrl: vi.fn(),
  mockStartOemCloudLogin: vi.fn(),
  mockGetClientReferralDashboard: vi.fn(),
  mockClearSiteAdapterCatalogCache: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockToastInfo: vi.fn(),
  mockRecordAgentUiPerformanceMetric: vi.fn(),
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
  deleteAgentRuntimeSession: mockDeleteAgentRuntimeSession,
  listAgentRuntimeSessions: mockListAgentRuntimeSessions,
  updateAgentRuntimeSession: mockUpdateAgentRuntimeSession,
}));

vi.mock("@/lib/api/oemCloudControlPlane", () => ({
  logoutClient: mockLogoutClient,
  getConfiguredOemCloudTarget: mockGetConfiguredOemCloudTarget,
  getClientReferralDashboard: mockGetClientReferralDashboard,
}));

vi.mock("@/lib/oemCloudLoginLauncher", () => ({
  buildOemCloudUserCenterUrl: mockBuildOemCloudUserCenterUrl,
  createExternalBrowserOpenTarget: mockCreateExternalBrowserOpenTarget,
  openExternalUrl: mockOpenExternalUrl,
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

vi.mock("@/lib/agentUiPerformanceMetrics", () => ({
  recordAgentUiPerformanceMetric: mockRecordAgentUiPerformanceMetric,
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

function setInputValue(input: HTMLInputElement, value: string) {
  const prototype = Object.getPrototypeOf(input) as HTMLInputElement;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (valueSetter) {
    valueSetter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function openConversationMenu(title: string) {
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>(
        `button[aria-label="打开 ${title} 操作菜单"]`,
      )
      ?.click();
    await Promise.resolve();
  });

  return document.body.querySelector<HTMLElement>(
    '[data-testid="app-sidebar-conversation-menu"]',
  );
}

async function clickConversationMenuItem(testId: string) {
  await act(async () => {
    document.body
      .querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
      ?.click();
    await Promise.resolve();
  });
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
    mockDeleteAgentRuntimeSession.mockResolvedValue(undefined);
    mockLogoutClient.mockResolvedValue(undefined);
    mockGetConfiguredOemCloudTarget.mockReturnValue({
      baseUrl: "https://user.limeai.run",
      tenantId: "tenant-0001",
    });
    mockBuildOemCloudUserCenterUrl.mockImplementation(
      (baseUrl: string, path = "") => `${baseUrl}${path}`,
    );
    mockOpenExternalUrl.mockResolvedValue(undefined);
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

    expect(mockListAgentRuntimeSessions).toHaveBeenCalledWith({
      limit: 11,
      workspaceId: "project-1",
    });
  });

  it("文件管理器临时折叠导航栏后应恢复用户原始状态", async () => {
    localStorage.setItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY, "false");

    const container = mountSidebarContainer();
    await flushEffects();

    expect(
      container.querySelector('button[aria-label="折叠导航栏"]'),
    ).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("lime:app-sidebar-collapse", {
          detail: { collapsed: true, source: "file-manager" },
        }),
      );
      await Promise.resolve();
    });

    expect(
      container.querySelector('button[aria-label="展开导航栏"]'),
    ).not.toBeNull();
    expect(localStorage.getItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe(
      "false",
    );

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("lime:app-sidebar-collapse", {
          detail: { collapsed: false, source: "file-manager" },
        }),
      );
      await Promise.resolve();
    });

    expect(
      container.querySelector('button[aria-label="折叠导航栏"]'),
    ).not.toBeNull();
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
    expect(container.textContent).toContain("Skills");
    expect(container.textContent).toContain("灵感");
    expect(container.textContent).toContain("项目资料");
    expect(container.textContent).not.toContain("设置");
    expect(container.textContent).not.toContain("持续流程");
    expect(container.textContent).not.toContain("消息渠道");
    expect(container.textContent).not.toContain("插件中心");
    expect(container.textContent).not.toContain("OpenClaw");
    expect(container.textContent).not.toContain("桌宠");
    expect(container.textContent).not.toContain("支撑");
    expect(container.textContent).not.toContain("技能");
    expect(container.textContent).not.toContain("能力");
    expect(container.textContent).not.toContain("系统");

    const mainNavButtons = Array.from(
      container.querySelectorAll('[data-testid="app-sidebar-main-nav"] button'),
    ).map((button) => button.getAttribute("aria-label"));
    const footerArea = container.querySelector(
      '[data-testid="app-sidebar-footer-area"]',
    );

    expect(mainNavButtons).toEqual([
      "新建任务",
      "Skills",
      "灵感",
      "项目资料",
    ]);
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

  it("已登录账号弹框应展示真实套餐摘要并跳出到用户中心详情", async () => {
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

    expect(onNavigate).not.toHaveBeenCalled();
    expect(mockBuildOemCloudUserCenterUrl).toHaveBeenCalledWith(
      "https://user.limeai.run",
      "/billing?tab=usage",
    );
    expect(mockOpenExternalUrl).toHaveBeenCalledWith(
      "https://user.limeai.run/billing?tab=usage",
      { browserTarget: null },
    );
    expect(mockToastSuccess).toHaveBeenCalledWith("已打开 Lime 云端 用户中心");
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
        ?.querySelector<HTMLButtonElement>(
          'button[aria-label="连接 Lime 云端"]',
        )
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
    expect(accountMenu?.textContent).not.toContain("本地开源功能可直接使用");
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

    await clickAccountMenuItem(container, "用户中心");
    expect(mockBuildOemCloudUserCenterUrl).toHaveBeenLastCalledWith(
      "https://user.limeai.run",
      "/welcome",
    );
    expect(mockOpenExternalUrl).toHaveBeenLastCalledWith(
      "https://user.limeai.run/welcome",
      { browserTarget: null },
    );
    expect(onNavigate).toHaveBeenLastCalledWith("settings", {
      tab: SettingsTabs.Providers,
      providerView: "settings",
    });

    await clickAccountMenuItem(container, "Lime 云端");
    expect(mockBuildOemCloudUserCenterUrl).toHaveBeenLastCalledWith(
      "https://user.limeai.run",
      "/welcome",
    );
    expect(mockOpenExternalUrl).toHaveBeenLastCalledWith(
      "https://user.limeai.run/welcome",
      { browserTarget: null },
    );
    expect(onNavigate).toHaveBeenLastCalledWith("settings", {
      tab: SettingsTabs.Providers,
      providerView: "settings",
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

  it("任务中心内点击一级新建任务应交给本地草稿标签，不跳出到新建首页", async () => {
    const onNavigate = vi.fn();
    const receivedDetails: unknown[] = [];
    const listener = (event: Event) => {
      receivedDetails.push(
        event instanceof CustomEvent ? event.detail : undefined,
      );
      event.preventDefault();
    };
    window.addEventListener(TASK_CENTER_CREATE_DRAFT_TASK_EVENT, listener);

    try {
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

      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('button[aria-label="新建任务"]')
          ?.click();
        await Promise.resolve();
      });

      expect(receivedDetails).toEqual([{ source: "sidebar" }]);
      expect(onNavigate).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(TASK_CENTER_CREATE_DRAFT_TASK_EVENT, listener);
    }
  });

  it("任务中心内点击已有会话应交给本地标签栏，不重复触发导航", async () => {
    const onNavigate = vi.fn();
    const receivedDetails: unknown[] = [];
    const listener = (event: Event) => {
      receivedDetails.push(
        event instanceof CustomEvent ? event.detail : undefined,
      );
      event.preventDefault();
    };
    window.addEventListener(TASK_CENTER_OPEN_TASK_EVENT, listener);
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: "session-target",
        name: "目标历史会话",
        created_at: 1713000000,
        updated_at: 1713000600,
        archived_at: null,
        workspace_id: "project-1",
        messages_count: 3,
      },
    ]);

    try {
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

      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('button[title="目标历史会话"]')
          ?.click();
        await Promise.resolve();
      });

      expect(receivedDetails).toEqual([
        {
          sessionId: "session-target",
          workspaceId: "project-1",
          source: "sidebar",
        },
      ]);
      expect(onNavigate).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(TASK_CENTER_OPEN_TASK_EVENT, listener);
    }
  });

  it("新建任务首页点击已有会话应进入对应历史对话", async () => {
    const onNavigate = vi.fn();
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: "session-target",
        name: "目标历史会话",
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
        agentEntry: "new-task",
        projectId: "project-1",
      } as AgentPageParams,
      onNavigate,
    });
    await flushEffects(2);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[title="目标历史会话"]')
        ?.click();
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agentEntry: "claw",
        projectId: "project-1",
        initialSessionId: "session-target",
      }),
    );
  });

  it("任务中心内悬停已有会话应延迟通知本地预取旧会话", async () => {
    vi.useFakeTimers();
    const receivedDetails: unknown[] = [];
    const listener = (event: Event) => {
      receivedDetails.push(
        event instanceof CustomEvent ? event.detail : undefined,
      );
    };
    window.addEventListener(TASK_CENTER_PREFETCH_TASK_EVENT, listener);
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: "session-prefetch",
        name: "可预取历史会话",
        created_at: 1713000000,
        updated_at: 1713000600,
        archived_at: null,
        workspace_id: "project-1",
        messages_count: 3,
      },
    ]);

    try {
      const container = mountSidebarContainer({
        currentPage: "agent",
        currentPageParams: {
          agentEntry: "claw",
          projectId: "project-1",
          initialSessionId: "session-current",
        } as AgentPageParams,
      });
      await flushEffects(2);

      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('button[title="可预取历史会话"]')
          ?.focus();
        await Promise.resolve();
      });

      expect(receivedDetails).toEqual([]);

      act(() => {
        vi.advanceTimersByTime(920);
      });

      expect(receivedDetails).toEqual([
        {
          sessionId: "session-prefetch",
          workspaceId: "project-1",
          source: "conversation_shelf",
        },
      ]);
    } finally {
      vi.useRealTimers();
      window.removeEventListener(TASK_CENTER_PREFETCH_TASK_EVENT, listener);
    }
  });

  it("点击已有会话时不应先触发旧会话预取抢占切换链路", async () => {
    vi.useFakeTimers();
    const receivedPrefetchDetails: unknown[] = [];
    const listener = (event: Event) => {
      receivedPrefetchDetails.push(
        event instanceof CustomEvent ? event.detail : undefined,
      );
    };
    window.addEventListener(TASK_CENTER_PREFETCH_TASK_EVENT, listener);
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: "session-click",
        name: "立即打开历史会话",
        created_at: 1713000000,
        updated_at: 1713000600,
        archived_at: null,
        workspace_id: "project-1",
        messages_count: 3,
      },
    ]);

    try {
      const onNavigate = vi.fn();
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

      const button = container.querySelector<HTMLButtonElement>(
        'button[title="立即打开历史会话"]',
      );

      await act(async () => {
        button?.focus();
        button?.click();
        await Promise.resolve();
      });

      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(receivedPrefetchDetails).toEqual([]);
      expect(onNavigate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      window.removeEventListener(TASK_CENTER_PREFETCH_TASK_EVENT, listener);
    }
  });

  it("搜索按钮应打开标题搜索弹窗，并按会话标题过滤结果", async () => {
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: "session-agent",
        name: "写一篇AI Agent的公众号",
        created_at: 1713000000,
        updated_at: 1713000600,
        archived_at: null,
        workspace_id: "project-1",
        messages_count: 3,
      },
      {
        id: "session-daily",
        name: "啊啊啊啊啊",
        created_at: 1712900000,
        updated_at: 1712900600,
        archived_at: null,
        workspace_id: "project-1",
        messages_count: 1,
      },
    ]);

    const container = mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "new-task",
        projectId: "project-1",
      } as AgentPageParams,
    });
    await flushEffects(2);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="app-sidebar-search-button"]',
        )
        ?.click();
      await Promise.resolve();
    });

    const dialog = document.body.querySelector<HTMLElement>(
      '[data-testid="app-sidebar-search-dialog"]',
    );
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("新建对话");
    expect(dialog?.textContent).toContain("写一篇AI Agent的公众号");
    expect(dialog?.textContent).toContain("啊啊啊啊啊");

    const input = document.body.querySelector<HTMLInputElement>(
      '[data-testid="app-sidebar-search-input"]',
    );
    expect(input).not.toBeNull();

    await act(async () => {
      setInputValue(input as HTMLInputElement, "Agent");
      await Promise.resolve();
    });

    expect(dialog?.textContent).toContain("匹配结果");
    expect(dialog?.textContent).toContain("写一篇AI Agent的公众号");
    expect(dialog?.textContent).not.toContain("啊啊啊啊啊");

    await act(async () => {
      setInputValue(input as HTMLInputElement, "不存在");
      await Promise.resolve();
    });

    expect(dialog?.textContent).toContain("没有匹配的对话标题");
  });

  it("搜索弹窗应支持查看更多对话并展示后续结果", async () => {
    const sessions = Array.from({ length: 12 }, (_, index) => {
      const number = String(index + 1).padStart(2, "0");
      return {
        id: `session-${number}`,
        name: `对话 ${number}`,
        created_at: 1713000000 + index,
        updated_at: 1713000600 + index,
        archived_at: null,
        workspace_id: "project-1",
        messages_count: 1,
      };
    });
    mockListAgentRuntimeSessions.mockResolvedValue(sessions);

    const container = mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "new-task",
        projectId: "project-1",
      } as AgentPageParams,
    });
    await flushEffects(2);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="app-sidebar-search-button"]',
        )
        ?.click();
      await Promise.resolve();
    });

    let dialog = document.body.querySelector<HTMLElement>(
      '[data-testid="app-sidebar-search-dialog"]',
    );
    expect(dialog?.textContent).toContain("查看更多对话");
    expect(dialog?.textContent).toContain("对话 12");
    expect(dialog?.textContent).not.toContain("对话 02");

    await act(async () => {
      dialog
        ?.querySelector<HTMLButtonElement>(
          '[data-testid="app-sidebar-search-more"]',
        )
        ?.click();
      await Promise.resolve();
    });
    await flushEffects(2);

    dialog = document.body.querySelector<HTMLElement>(
      '[data-testid="app-sidebar-search-dialog"]',
    );
    expect(dialog?.textContent).toContain("对话 02");
    expect(dialog?.textContent).not.toContain("查看更多对话");
    expect(mockListAgentRuntimeSessions).toHaveBeenLastCalledWith({
      limit: 21,
      workspaceId: "project-1",
    });
  });

  it("搜索结果点击应复用会话导航并关闭弹窗", async () => {
    const onNavigate = vi.fn();
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: "session-target",
        name: "目标历史会话",
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
        projectId: "project-1",
      } as AgentPageParams,
      onNavigate,
    });
    await flushEffects(2);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="app-sidebar-search-button"]',
        )
        ?.click();
      await Promise.resolve();
    });

    const dialog = document.body.querySelector<HTMLElement>(
      '[data-testid="app-sidebar-search-dialog"]',
    );

    await act(async () => {
      dialog
        ?.querySelector<HTMLButtonElement>('button[title="目标历史会话"]')
        ?.click();
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agentEntry: "claw",
        projectId: "project-1",
        initialSessionId: "session-target",
      }),
    );
    expect(mockRecordAgentUiPerformanceMetric).toHaveBeenCalledWith(
      "sidebar.conversation.click",
      expect.objectContaining({
        sessionId: "session-target",
        source: "sidebar_search",
        workspaceId: "project-1",
      }),
    );
    expect(
      document.body.querySelector('[data-testid="app-sidebar-search-dialog"]'),
    ).toBeNull();
  });

  it("搜索结果悬停应延迟触发旧会话预取，避免抢占点击切换", async () => {
    vi.useFakeTimers();
    const receivedDetails: unknown[] = [];
    const listener = (event: Event) => {
      receivedDetails.push(
        event instanceof CustomEvent ? event.detail : undefined,
      );
    };
    window.addEventListener(TASK_CENTER_PREFETCH_TASK_EVENT, listener);
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: "session-prefetch-search",
        name: "搜索预取历史会话",
        created_at: 1713000000,
        updated_at: 1713000600,
        archived_at: null,
        workspace_id: "project-1",
        messages_count: 3,
      },
    ]);

    try {
      const container = mountSidebarContainer({
        currentPage: "agent",
        currentPageParams: {
          agentEntry: "new-task",
          projectId: "project-1",
        } as AgentPageParams,
      });
      await flushEffects(2);

      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            '[data-testid="app-sidebar-search-button"]',
          )
          ?.click();
        await Promise.resolve();
      });
      await flushEffects(5);

      const dialog = document.body.querySelector<HTMLElement>(
        '[data-testid="app-sidebar-search-dialog"]',
      );
      const resultButton = dialog?.querySelector<HTMLButtonElement>(
        'button[title="搜索预取历史会话"]',
      );
      expect(resultButton?.disabled).toBe(false);

      await act(async () => {
        resultButton?.dispatchEvent(
          new Event("pointerover", { bubbles: true }),
        );
        await Promise.resolve();
      });

      expect(receivedDetails).toEqual([]);

      act(() => {
        vi.advanceTimersByTime(899);
      });
      expect(receivedDetails).toEqual([]);

      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(receivedDetails).toEqual([
        {
          sessionId: "session-prefetch-search",
          workspaceId: "project-1",
          source: "sidebar_search",
        },
      ]);
      expect(mockRecordAgentUiPerformanceMetric).toHaveBeenCalledWith(
        "sidebar.conversation.prefetchFired",
        expect.objectContaining({
          sessionId: "session-prefetch-search",
          source: "sidebar_search",
          workspaceId: "project-1",
        }),
      );
    } finally {
      vi.useRealTimers();
      window.removeEventListener(TASK_CENTER_PREFETCH_TASK_EVENT, listener);
    }
  });

  it("搜索结果快速点击应取消预取计时器并直接导航", async () => {
    vi.useFakeTimers();
    const onNavigate = vi.fn();
    const receivedPrefetchDetails: unknown[] = [];
    const listener = (event: Event) => {
      receivedPrefetchDetails.push(
        event instanceof CustomEvent ? event.detail : undefined,
      );
    };
    window.addEventListener(TASK_CENTER_PREFETCH_TASK_EVENT, listener);
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: "session-click-search",
        name: "搜索点击历史会话",
        created_at: 1713000000,
        updated_at: 1713000600,
        archived_at: null,
        workspace_id: "project-1",
        messages_count: 3,
      },
    ]);

    try {
      const container = mountSidebarContainer({
        currentPage: "agent",
        currentPageParams: {
          agentEntry: "new-task",
          projectId: "project-1",
        } as AgentPageParams,
        onNavigate,
      });
      await flushEffects(2);

      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            '[data-testid="app-sidebar-search-button"]',
          )
          ?.click();
        await Promise.resolve();
      });

      const dialog = document.body.querySelector<HTMLElement>(
        '[data-testid="app-sidebar-search-dialog"]',
      );
      const resultButton = dialog?.querySelector<HTMLButtonElement>(
        'button[title="搜索点击历史会话"]',
      );

      await act(async () => {
        resultButton?.focus();
        resultButton?.click();
        await Promise.resolve();
      });

      act(() => {
        vi.advanceTimersByTime(900);
      });

      expect(receivedPrefetchDetails).toEqual([]);
      expect(onNavigate).toHaveBeenCalledWith(
        "agent",
        expect.objectContaining({
          agentEntry: "claw",
          projectId: "project-1",
          initialSessionId: "session-click-search",
        }),
      );
    } finally {
      vi.useRealTimers();
      window.removeEventListener(TASK_CENTER_PREFETCH_TASK_EVENT, listener);
    }
  });

  it("搜索弹窗的新建对话入口应复用现有新建导航", async () => {
    const onNavigate = vi.fn();
    mockListAgentRuntimeSessions.mockResolvedValue([]);

    const container = mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        projectId: "project-1",
      } as AgentPageParams,
      onNavigate,
    });
    await flushEffects(2);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="app-sidebar-search-button"]',
        )
        ?.click();
      await Promise.resolve();
    });

    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>(
          '[data-testid="app-sidebar-search-new-conversation"]',
        )
        ?.click();
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agentEntry: "new-task",
        projectId: "project-1",
      }),
    );
    expect(
      document.body.querySelector('[data-testid="app-sidebar-search-dialog"]'),
    ).toBeNull();
  });

  it("Meta/Ctrl + K 应打开搜索弹窗，Escape 应关闭弹窗", async () => {
    mockListAgentRuntimeSessions.mockResolvedValue([]);

    mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "new-task",
        projectId: "project-1",
      } as AgentPageParams,
    });
    await flushEffects(2);

    expect(
      document.body.querySelector('[data-testid="app-sidebar-search-dialog"]'),
    ).toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
    });
    await flushEffects();

    expect(
      document.body.querySelector('[data-testid="app-sidebar-search-dialog"]'),
    ).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
    });

    expect(
      document.body.querySelector('[data-testid="app-sidebar-search-dialog"]'),
    ).toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
    });

    expect(
      document.body.querySelector('[data-testid="app-sidebar-search-dialog"]'),
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
      limit: 11,
      workspaceId: "project-1",
    });
    expect(mockRecordAgentUiPerformanceMetric).toHaveBeenCalledWith(
      "appSidebar.recentConversations.loadBreakdown",
      expect.objectContaining({
        limit: 11,
        sessionsCount: 1,
        workspaceId: "project-1",
      }),
    );

    const mainNav = container.querySelector(
      '[data-testid="app-sidebar-main-nav"]',
    );
    const conversationShelf = container.querySelector(
      '[data-testid="app-sidebar-conversation-shelf"]',
    );
    const recentConversationList = container.querySelector(
      '[data-testid="app-sidebar-recent-conversations"]',
    );
    const archivedToggle = conversationShelf?.querySelector(
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
      limit: 9,
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

  it("窗口重新聚焦时应低优先级刷新会话列表", async () => {
    localStorage.setItem("agent_last_project_id", JSON.stringify("project-1"));
    const cancelFocusRefresh = vi.fn();
    mockScheduleMinimumDelayIdleTask.mockImplementation((task: () => void) => {
      task();
      return cancelFocusRefresh;
    });

    mountSidebarContainer({
      currentPage: "settings",
    });
    await flushEffects(2);
    mockScheduleMinimumDelayIdleTask.mockClear();
    mockListAgentRuntimeSessions.mockClear();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    await flushEffects(2);

    expect(mockScheduleMinimumDelayIdleTask).toHaveBeenCalledTimes(1);
    expect(mockScheduleMinimumDelayIdleTask).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        minimumDelayMs: expect.any(Number),
        idleTimeoutMs: expect.any(Number),
      }),
    );
    expect(mockListAgentRuntimeSessions).toHaveBeenCalledWith({
      limit: 11,
      workspaceId: "project-1",
    });
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
      limit: 11,
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
      limit: 11,
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
      limit: 11,
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
      limit: 11,
      workspaceId: "project-1",
    });
  });

  it("点击会话菜单归档动作时应走统一 session update 命令", async () => {
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

    mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "claw",
        projectId: "project-1",
      } as AgentPageParams,
    });
    await flushEffects(2);

    const menu = await openConversationMenu("最近会话");
    expect(menu).not.toBeNull();
    expect(menu?.textContent).toContain("重命名");
    expect(menu?.textContent).toContain("收藏");
    expect(menu?.textContent).toContain("归档");
    expect(menu?.textContent).toContain("多选");
    expect(menu?.textContent).toContain("删除");
    expect(mockListAgentRuntimeSessions).toHaveBeenCalledWith({
      limit: 11,
      workspaceId: "project-1",
    });

    await clickConversationMenuItem("app-sidebar-conversation-menu-archive");

    expect(mockUpdateAgentRuntimeSession).toHaveBeenCalledWith({
      session_id: "session-recent",
      archived: true,
    });
  });

  it("归档会话菜单应展示恢复动作并走统一 session update 命令", async () => {
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
          : [],
    );

    const container = mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "claw",
        projectId: "project-1",
      } as AgentPageParams,
    });
    await flushEffects(2);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-expanded="false"]')
        ?.click();
      await Promise.resolve();
    });
    await flushEffects(2);

    const menu = await openConversationMenu("归档会话");
    expect(menu).not.toBeNull();
    expect(menu?.textContent).toContain("重命名");
    expect(menu?.textContent).toContain("收藏");
    expect(menu?.textContent).toContain("恢复");
    expect(menu?.textContent).toContain("多选");
    expect(menu?.textContent).toContain("删除");
    expect(menu?.textContent).not.toContain("归档");

    await clickConversationMenuItem("app-sidebar-conversation-menu-archive");

    expect(mockUpdateAgentRuntimeSession).toHaveBeenCalledWith({
      session_id: "session-archived",
      archived: false,
    });
  });

  it("会话菜单应支持重命名并同步更新 session 名称", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("重命名后的会话");
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

    mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "claw",
        projectId: "project-1",
      } as AgentPageParams,
    });
    await flushEffects(2);

    await openConversationMenu("最近会话");
    await clickConversationMenuItem("app-sidebar-conversation-menu-rename");
    await flushEffects(2);

    expect(window.prompt).toHaveBeenCalledWith("重命名对话", "最近会话");
    expect(mockUpdateAgentRuntimeSession).toHaveBeenCalledWith({
      session_id: "session-recent",
      name: "重命名后的会话",
    });
    expect(mockToastSuccess).toHaveBeenCalledWith("已重命名对话");
  });

  it("会话菜单应支持删除并在执行前要求确认", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
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

    mountSidebarContainer({
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "claw",
        projectId: "project-1",
      } as AgentPageParams,
    });
    await flushEffects(2);

    await openConversationMenu("最近会话");
    await clickConversationMenuItem("app-sidebar-conversation-menu-delete");
    await flushEffects(2);

    expect(window.confirm).toHaveBeenCalledWith(
      "确定要删除“最近会话”吗？删除后无法恢复。",
    );
    expect(mockDeleteAgentRuntimeSession).toHaveBeenCalledWith(
      "session-recent",
    );
    expect(mockToastSuccess).toHaveBeenCalledWith("已删除对话");
  });

  it("会话菜单的收藏与多选应提供即时反馈", async () => {
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

    await openConversationMenu("最近会话");
    await clickConversationMenuItem("app-sidebar-conversation-menu-favorite");

    expect(
      container.querySelector(
        '[data-testid="app-sidebar-conversation-favorite-badge"]',
      ),
    ).not.toBeNull();

    const favoriteMenu = await openConversationMenu("最近会话");
    expect(favoriteMenu?.textContent).toContain("取消收藏");

    await clickConversationMenuItem(
      "app-sidebar-conversation-menu-multiselect",
    );

    expect(
      container.querySelector(
        '[data-testid="app-sidebar-conversation-multiselect-toolbar"]',
      )?.textContent,
    ).toContain("已选择 1 个对话");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[title="最近会话"]')
        ?.click();
      await Promise.resolve();
    });

    expect(
      container.querySelector(
        '[data-testid="app-sidebar-conversation-multiselect-toolbar"]',
      )?.textContent,
    ).toContain("已选择 0 个对话");
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

  it("点击当前已激活的Skills入口时不应重复导航", async () => {
    const onNavigate = vi.fn();
    const container = mountSidebarContainer({
      currentPage: "skills",
      onNavigate,
    });
    await flushEffects();

    const button = container.querySelector(
      'button[aria-label="Skills"]',
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
    expect(popover?.textContent).toContain("随机");
    expect(popover?.textContent).toContain("墨绿");
    expect(popover?.textContent).toContain("自然");
    expect(popover?.textContent).toContain("海洋");
    expect(popover?.textContent).toContain("复古");
    expect(popover?.textContent).toContain("霓虹");
    expect(popover?.textContent).toContain("青柠");
    expect(popover?.textContent).toContain("黄昏");
    expect(popover?.textContent).toContain("极简");
    expect(popover?.textContent).toContain("活力");
    expect(popover?.textContent).toContain("文艺");
    expect(popover?.textContent).toContain("奢华");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="切换配色为海洋"]')
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

  it("外观弹层的随机配色应持久化到一个真实预设", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    try {
      const container = mountSidebarContainer({
        currentPage: "agent",
        currentPageParams: {
          agentEntry: "new-task",
        } as AgentPageParams,
      });
      await flushEffects(2);

      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('button[aria-label="快速切换外观"]')
          ?.click();
        await Promise.resolve();
      });

      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('button[aria-label="随机切换配色"]')
          ?.click();
        await Promise.resolve();
      });

      expect(localStorage.getItem(LIME_COLOR_SCHEME_STORAGE_KEY)).toBe(
        "lime-forest",
      );
      expect(document.documentElement.dataset.limeColorScheme).toBe(
        "lime-forest",
      );
    } finally {
      randomSpy.mockRestore();
    }
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
