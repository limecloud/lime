import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUseOemCloudAccess,
  mockFormatOemCloudDateTime,
  mockGetCompanionPetStatus,
  mockLaunchCompanionPet,
  mockListenCompanionPetStatus,
  mockSendCompanionPetCommand,
  mockProviderPoolGetOverview,
  mockSubscribeProviderDataChanged,
} = vi.hoisted(() => ({
  mockUseOemCloudAccess: vi.fn(),
  mockFormatOemCloudDateTime: vi.fn((value?: string) => `fmt:${value ?? ""}`),
  mockGetCompanionPetStatus: vi.fn(),
  mockLaunchCompanionPet: vi.fn(),
  mockListenCompanionPetStatus: vi.fn(),
  mockSendCompanionPetCommand: vi.fn(),
  mockProviderPoolGetOverview: vi.fn(),
  mockSubscribeProviderDataChanged: vi.fn(),
}));

vi.mock("@/components/provider-pool", () => ({
  ProviderPoolPage: () => <div data-testid="provider-pool-stub">凭证池占位</div>,
}));

vi.mock("@/lib/api/companion", () => ({
  getCompanionPetStatus: () => mockGetCompanionPetStatus(),
  launchCompanionPet: () => mockLaunchCompanionPet(),
  listenCompanionPetStatus: (...args: unknown[]) =>
    mockListenCompanionPetStatus(...args),
  sendCompanionPetCommand: (...args: unknown[]) =>
    mockSendCompanionPetCommand(...args),
}));

vi.mock("@/lib/api/providerPool", () => ({
  providerPoolApi: {
    getOverview: (...args: unknown[]) => mockProviderPoolGetOverview(...args),
  },
}));

vi.mock("@/lib/providerDataEvents", () => ({
  subscribeProviderDataChanged: (...args: unknown[]) =>
    mockSubscribeProviderDataChanged(...args),
}));

vi.mock("@/hooks/useOemCloudAccess", () => ({
  useOemCloudAccess: () => mockUseOemCloudAccess(),
  formatOemCloudDateTime: (value?: string) =>
    mockFormatOemCloudDateTime(value),
  formatOemCloudAccessModeLabel: (value?: string) => value || "未知",
  formatOemCloudConfigModeLabel: (value?: string) => value || "未知",
  formatOemCloudModelsSourceLabel: (value?: string) => value || "未知",
  formatOemCloudOfferStateLabel: (value?: string) => value || "未知",
}));

import { CloudProviderSettings } from ".";

interface MountedPage {
  container: HTMLDivElement;
  root: Root;
}

const mounted: MountedPage[] = [];

function createOffer(overrides: Record<string, unknown> = {}) {
  return {
    providerKey: "lime-hub-main",
    displayName: "Lime Hub 主服务",
    source: "oem_cloud",
    state: "available_ready",
    description: "统一下发的云端目录",
    visible: true,
    loggedIn: true,
    accountStatus: "logged_in",
    subscriptionStatus: "active",
    quotaStatus: "ok",
    canInvoke: true,
    defaultModel: "gpt-5.2-pro",
    effectiveAccessMode: "session",
    apiKeyModeEnabled: false,
    tenantOverrideApplied: false,
    configMode: "managed",
    modelsSource: "hub_catalog",
    developerAccessVisible: false,
    availableModelCount: 2,
    fallbackToLocalAllowed: true,
    currentPlan: "Pro",
    creditsSummary: "余额充足",
    tags: [],
    ...overrides,
  };
}

function createAccessState(overrides: Record<string, unknown> = {}) {
  return {
    runtime: {
      baseUrl: "https://user.150404.xyz",
      controlPlaneBaseUrl: "https://user.150404.xyz/api",
      sceneBaseUrl: "https://user.150404.xyz/scene-api",
      gatewayBaseUrl: "https://user.150404.xyz/gateway-api",
      tenantId: "tenant-0001",
      sessionToken: null,
      hubProviderName: "Lime Hub",
      loginPath: "/login",
      desktopClientId: "desktop-client",
      desktopOauthRedirectUrl: "lime://oauth/callback",
      desktopOauthNextPath: "/welcome",
    },
    configuredTarget: {
      baseUrl: "https://user.150404.xyz",
      tenantId: "tenant-0001",
    },
    hubProviderName: "Lime Hub",
    session: null,
    offers: [],
    preference: null,
    selectedOffer: null,
    selectedModels: [],
    defaultCloudOffer: null,
    activeCloudOffer: null,
    initializing: false,
    refreshing: false,
    loadingDetail: false,
    savingDefault: "",
    errorMessage: null,
    infoMessage: null,
    defaultProviderSummary: null,
    defaultProviderSourceLabel: "未设定",
    activeAccessModeLabel: "登录会话",
    activeConfigModeLabel: "托管模式",
    activeModelsSourceLabel: "云端目录",
    activeDeveloperAccessEnabled: false,
    activeDeveloperAccessLabel: "已关闭",
    handleRefresh: vi.fn(),
    openOfferDetail: vi.fn(),
    handleSetDefault: vi.fn(),
    openUserCenter: vi.fn(),
    ...overrides,
  };
}

function createPetStatus(overrides: Record<string, unknown> = {}) {
  return {
    endpoint: "ws://127.0.0.1:45554/companion/pet",
    server_listening: true,
    connected: false,
    client_id: null,
    platform: null,
    capabilities: [],
    last_event: null,
    last_error: null,
    last_state: "idle",
    ...overrides,
  };
}

function createProviderOverview() {
  return [
    {
      provider_type: "openai",
      stats: {
        total: 2,
        healthy: 1,
        unhealthy: 1,
        disabled: 0,
        total_usage: 6,
        total_errors: 1,
      },
      credentials: [],
    },
    {
      provider_type: "codex",
      stats: {
        total: 1,
        healthy: 1,
        unhealthy: 0,
        disabled: 0,
        total_usage: 3,
        total_errors: 0,
      },
      credentials: [],
    },
  ];
}

async function renderPage(props: { onOpenProfile?: () => void } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<CloudProviderSettings {...props} />);
    await Promise.resolve();
    await Promise.resolve();
  });

  const page = { container, root };
  mounted.push(page);
  return page;
}

function findButton(container: HTMLElement, text: string) {
  const button = Array.from(container.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(text),
  );

  if (!button) {
    throw new Error(`未找到按钮: ${text}`);
  }
  return button as HTMLButtonElement;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  mockUseOemCloudAccess.mockReturnValue(createAccessState());
  mockGetCompanionPetStatus.mockResolvedValue(createPetStatus());
  mockLaunchCompanionPet.mockResolvedValue({
    launched: true,
    resolved_path: "/Applications/Lime Pet.app/Contents/MacOS/Lime Pet",
    endpoint: "ws://127.0.0.1:45554/companion/pet",
    message: null,
  });
  mockListenCompanionPetStatus.mockResolvedValue(vi.fn());
  mockSendCompanionPetCommand.mockResolvedValue({
    delivered: true,
    connected: true,
  });
  mockProviderPoolGetOverview.mockResolvedValue(createProviderOverview());
  mockSubscribeProviderDataChanged.mockReturnValue(vi.fn());
});

afterEach(() => {
  vi.clearAllMocks();

  while (mounted.length > 0) {
    const current = mounted.pop();
    if (!current) {
      break;
    }

    act(() => {
      current.root.unmount();
    });
    current.container.remove();
  }
});

describe("CloudProviderSettings", () => {
  it("默认应直接进入本地 Provider 主区，并保持切换器激活态清晰", async () => {
    mockUseOemCloudAccess.mockReturnValue(
      createAccessState({
        runtime: null,
        configuredTarget: null,
      }),
    );

    const { container } = await renderPage();
    const text = container.textContent ?? "";
    const settingsTab = container.querySelector(
      '[data-testid="provider-workspace-tab-settings"]',
    );
    const cloudTab = container.querySelector(
      '[data-testid="provider-workspace-tab-cloud"]',
    );

    expect(
      container.querySelector('[data-testid="provider-workspace-switcher"]'),
    ).not.toBeNull();
    expect(
      container.querySelectorAll('[data-testid="provider-workspace-switcher"]')
        .length,
    ).toBe(1);
    expect(text).toContain("凭证池占位");
    expect(text).not.toContain("把本地 Provider 配置和 OEM 云端服务拆开管理");
    expect(text).not.toContain("默认先进入“服务商设置”处理 Provider");
    expect(text).not.toContain("public/oem-runtime-config.js");
    expect(settingsTab?.getAttribute("data-state")).toBe("active");
    expect(cloudTab?.getAttribute("data-state")).toBe("inactive");

    await act(async () => {
      findButton(container, "云端服务").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.textContent ?? "").toContain("先配置 OEM 云端运行时");
    expect(container.textContent ?? "").toContain("public/oem-runtime-config.js");
    expect(settingsTab?.getAttribute("data-state")).toBe("inactive");
    expect(cloudTab?.getAttribute("data-state")).toBe("active");
  });

  it("未登录时应提示前往个人中心登录", async () => {
    const onOpenProfile = vi.fn();
    const { container } = await renderPage({ onOpenProfile });

    await act(async () => {
      findButton(container, "云端服务").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.textContent ?? "").toContain("去个人中心登录");

    await act(async () => {
      findButton(container, "去个人中心登录").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onOpenProfile).toHaveBeenCalledTimes(1);
  });

  it("已登录时应在云端页展示 OEM 来源目录与模型详情", async () => {
    const handleRefresh = vi.fn();
    const handleSetDefault = vi.fn();
    const selectedOffer = {
      ...createOffer(),
      access: {
        offerId: "offer-001",
        accessMode: "session",
        hubTokenEnabled: false,
      },
    };

    mockUseOemCloudAccess.mockReturnValue(
      createAccessState({
        session: {
          tenant: { id: "tenant-0001" },
          user: {
            id: "user-001",
            email: "operator@example.com",
            displayName: "Demo Operator",
          },
          session: {
            id: "session-001",
            expiresAt: "2026-03-25T08:00:00.000Z",
          },
        },
        offers: [createOffer()],
        preference: {
          providerSource: "oem_cloud",
          providerKey: "lime-hub-main",
        },
        selectedOffer,
        selectedModels: [
          {
            id: "model-001",
            offerId: "offer-001",
            modelId: "gpt-5.2-pro",
            displayName: "GPT-5.2 Pro",
            recommended: true,
          },
        ],
        defaultCloudOffer: createOffer(),
        activeCloudOffer: createOffer(),
        defaultProviderSummary: "Lime Hub 主服务 · gpt-5.2-pro",
        defaultProviderSourceLabel: "云端服务",
        handleRefresh,
        handleSetDefault,
      }),
    );

    const { container } = await renderPage();

    await act(async () => {
      findButton(container, "云端服务").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    await act(async () => {
      findButton(container, "刷新云端状态").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    const text = container.textContent ?? "";
    expect(text).toContain("Demo Operator");
    expect(text).toContain("当前云端摘要");
    expect(text).toContain("fmt:2026-03-25T08:00:00.000Z");
    expect(text).toContain("Lime Hub 主服务");
    expect(text).toContain("GPT-5.2 Pro");

    await act(async () => {
      findButton(container, "已是默认来源").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(handleRefresh).toHaveBeenCalledTimes(1);
    expect(handleSetDefault).toHaveBeenCalledTimes(1);
  });

  it("服务端误报待登录时应优先展示当前会话的已登录状态", async () => {
    const staleOffer = createOffer({
      state: "available_logged_out",
      loggedIn: true,
      accountStatus: "logged_in",
      subscriptionStatus: "active",
      quotaStatus: "ok",
      canInvoke: true,
    });

    mockUseOemCloudAccess.mockReturnValue(
      createAccessState({
        session: {
          tenant: { id: "tenant-0001" },
          user: {
            id: "user-001",
            email: "operator@example.com",
            displayName: "Demo Operator",
          },
          session: {
            id: "session-001",
            expiresAt: "2026-03-25T08:00:00.000Z",
          },
        },
        offers: [staleOffer],
        preference: {
          providerSource: "oem_cloud",
          providerKey: "lime-hub-main",
        },
        selectedOffer: {
          ...staleOffer,
          loginHint: "请先登录后再查看模型目录",
          access: {
            offerId: "offer-001",
            accessMode: "session",
            sessionTokenRef: "session-001",
            hubTokenEnabled: false,
          },
        },
        selectedModels: [
          {
            id: "model-001",
            offerId: "offer-001",
            modelId: "gpt-5.2-pro",
            displayName: "GPT-5.2 Pro",
            recommended: true,
          },
        ],
        defaultCloudOffer: staleOffer,
        activeCloudOffer: staleOffer,
      }),
    );

    const { container } = await renderPage();

    await act(async () => {
      findButton(container, "云端服务").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    const text = container.textContent ?? "";
    expect(text).toContain("available_ready");
    expect(text).not.toContain("available_logged_out");
    expect(text).not.toContain("登录提示：请先登录后再查看模型目录");
  });

  it("单个云端来源时不应保留空的双列占位", () => {
    mockUseOemCloudAccess.mockReturnValue(
      createAccessState({
        session: {
          tenant: { id: "tenant-0001" },
          user: {
            id: "user-001",
            email: "operator@example.com",
            displayName: "Demo Operator",
          },
          session: {
            id: "session-001",
            expiresAt: "2026-03-25T08:00:00.000Z",
          },
        },
        offers: [createOffer()],
        preference: {
          providerSource: "oem_cloud",
          providerKey: "lime-hub-main",
        },
        selectedOffer: {
          ...createOffer(),
          access: {
            offerId: "offer-001",
            accessMode: "session",
            hubTokenEnabled: false,
          },
        },
        defaultCloudOffer: createOffer(),
        activeCloudOffer: createOffer(),
      }),
    );

    return renderPage().then(({ container }) => {
      act(() => {
        findButton(container, "云端服务").dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
      });
      const offerGrid = container.querySelector(
        '[data-testid="oem-cloud-offer-grid"]',
      );

      expect(offerGrid).not.toBeNull();
      expect(offerGrid?.className).not.toContain("lg:grid-cols-2");
    });
  });

  it("服务商设置页应展示桌宠桥接卡片和脱敏边界说明", async () => {
    mockGetCompanionPetStatus.mockResolvedValue(
      createPetStatus({
        connected: true,
        client_id: "lime-pet",
        platform: "macos",
        capabilities: ["provider-overview"],
        last_event: "pet.ready",
        last_state: "walking",
      }),
    );

    const { container } = await renderPage();
    const text = container.textContent ?? "";

    expect(
      container.querySelector('[data-testid="companion-provider-card"]'),
    ).not.toBeNull();
    expect(text).toContain("Lime Pet Companion");
    expect(text).toContain("桌宠通过本地 Companion 通道复用 Lime 的 AI 服务商状态");
    expect(text).toContain("不会直接读取 API Key、OAuth 凭证或本地凭证文件");
    expect(text).toContain("桌宠已连接");
    expect(text).toContain("Provider 概览");
    expect(text).toContain("桌宠视角预览");
    expect(text).toContain("OpenAI");
    expect(text).toContain("Codex");
    expect(text).toContain("可用 2");
    expect(text).toContain("需关注 1");
    expect(text).toContain("接入检查");
    expect(text).toContain("当前链路已就绪，可以直接点击“立即同步到桌宠”。");
  });

  it("点击启动桌宠后应调用 launch 接口并展示启动反馈", async () => {
    mockGetCompanionPetStatus
      .mockResolvedValueOnce(createPetStatus())
      .mockResolvedValueOnce(
        createPetStatus({
          server_listening: true,
          connected: false,
          last_event: "pet.launch_requested",
        }),
      );

    const { container } = await renderPage();

    await act(async () => {
      findButton(container, "启动 Lime Pet").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockLaunchCompanionPet).toHaveBeenCalledTimes(1);
    expect(container.textContent ?? "").toContain("已请求启动 Lime Pet");
  });

  it("桌宠已连接且支持 provider 概览时，应允许手动同步摘要", async () => {
    mockGetCompanionPetStatus.mockResolvedValue(
      createPetStatus({
        connected: true,
        capabilities: ["provider-overview"],
        last_event: "pet.ready",
      }),
    );

    const { container } = await renderPage();

    await act(async () => {
      findButton(container, "立即同步到桌宠").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSendCompanionPetCommand).toHaveBeenCalledWith({
      event: "pet.provider_overview",
      payload: {
        providers: [
          {
            provider_type: "codex",
            display_name: "Codex",
            total_count: 1,
            healthy_count: 1,
            available: true,
            needs_attention: false,
          },
          {
            provider_type: "openai",
            display_name: "OpenAI",
            total_count: 2,
            healthy_count: 1,
            available: true,
            needs_attention: true,
          },
        ],
        total_provider_count: 2,
        available_provider_count: 2,
        needs_attention_provider_count: 1,
      },
    });
    expect(container.textContent ?? "").toContain("已同步 2 个服务商摘要到桌宠");
    expect(container.textContent ?? "").toContain(
      "当前链路已就绪，可以直接点击“立即同步到桌宠”。",
    );
  });

  it("桌宠已连接但未声明 provider 概览能力时，应展示诊断并禁用手动同步", async () => {
    mockGetCompanionPetStatus.mockResolvedValue(
      createPetStatus({
        connected: true,
        client_id: "lime-pet",
        platform: "windows",
        capabilities: [],
        last_event: "pet.ready",
      }),
    );

    const { container } = await renderPage();
    const syncButton = container.querySelector(
      '[data-testid="companion-sync-preview"]',
    ) as HTMLButtonElement | null;
    const text = container.textContent ?? "";

    expect(syncButton).not.toBeNull();
    expect(syncButton?.disabled).toBe(true);
    expect(text).toContain("能力未声明");
    expect(text).toContain("当前桌宠已连接，但尚未声明 Provider 概览能力");
    expect(text).toContain("平台：Windows");
  });
});
