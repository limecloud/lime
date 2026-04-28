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
  mockApiKeyProviderGetProviders,
  mockProviderPoolGetOverview,
  mockSubscribeProviderDataChanged,
  mockGetConfig,
  mockSaveConfig,
  mockOpenUrl,
} = vi.hoisted(() => ({
  mockUseOemCloudAccess: vi.fn(),
  mockFormatOemCloudDateTime: vi.fn((value?: string) => `fmt:${value ?? ""}`),
  mockGetCompanionPetStatus: vi.fn(),
  mockLaunchCompanionPet: vi.fn(),
  mockListenCompanionPetStatus: vi.fn(),
  mockSendCompanionPetCommand: vi.fn(),
  mockApiKeyProviderGetProviders: vi.fn(),
  mockProviderPoolGetOverview: vi.fn(),
  mockSubscribeProviderDataChanged: vi.fn(),
  mockGetConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockOpenUrl: vi.fn(),
}));

vi.mock("@/components/provider-pool", () => ({
  ProviderPoolPage: () => (
    <div data-testid="provider-pool-stub">凭证池占位</div>
  ),
}));

vi.mock("@/components/input-kit", () => ({
  ModelSelector: ({
    providerType,
    model,
    activeTheme,
    placeholderLabel,
  }: {
    providerType: string;
    model: string;
    activeTheme?: string;
    placeholderLabel?: string;
  }) => (
    <div data-testid="provider-settings-model-selector">
      {activeTheme ? `[${activeTheme}] ` : ""}
      {providerType || placeholderLabel || "自动选择"} /{" "}
      {model || placeholderLabel || "自动选择"}
    </div>
  ),
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

vi.mock("@/lib/api/apiKeyProvider", () => ({
  apiKeyProviderApi: {
    getProviders: (...args: unknown[]) =>
      mockApiKeyProviderGetProviders(...args),
  },
}));

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
}));

vi.mock("@/lib/providerDataEvents", () => ({
  subscribeProviderDataChanged: (...args: unknown[]) =>
    mockSubscribeProviderDataChanged(...args),
}));

vi.mock("@/components/openclaw/openUrl", () => ({
  openUrl: (...args: unknown[]) => mockOpenUrl(...args),
}));

vi.mock("@/hooks/useOemCloudAccess", () => ({
  useOemCloudAccess: () => mockUseOemCloudAccess(),
  formatOemCloudDateTime: (value?: string) => mockFormatOemCloudDateTime(value),
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
      baseUrl: "https://user.limeai.run",
      controlPlaneBaseUrl: "https://user.limeai.run/api",
      sceneBaseUrl: "https://user.limeai.run/scene-api",
      gatewayBaseUrl: "https://user.limeai.run/gateway-api",
      tenantId: "tenant-0001",
      sessionToken: null,
      hubProviderName: "Lime Hub",
      loginPath: "/login",
      desktopClientId: "desktop-client",
      desktopOauthRedirectUrl: "lime://oauth/callback",
      desktopOauthNextPath: "/welcome",
    },
    configuredTarget: {
      baseUrl: "https://user.limeai.run",
      tenantId: "tenant-0001",
    },
    hubProviderName: "Lime Hub",
    session: null,
    bootstrap: null,
    offers: [],
    preference: null,
    paymentConfigs: [],
    plans: [],
    subscription: null,
    creditAccount: null,
    creditsDashboard: null,
    topupPackages: [],
    usageDashboard: null,
    billingDashboard: null,
    orders: [],
    creditTopupOrders: [],
    accessTokens: [],
    activeAccessToken: null,
    lastIssuedRawToken: null,
    commerceErrorMessage: null,
    selectedOffer: null,
    selectedModels: [],
    defaultCloudOffer: null,
    activeCloudOffer: null,
    initializing: false,
    refreshing: false,
    loadingCommerce: false,
    loadingDetail: false,
    openingGoogleLogin: false,
    savingDefault: "",
    orderingPlanId: "",
    creatingTopupPackageId: "",
    managingToken: "",
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
    handleGoogleLogin: vi.fn(),
    openOfferDetail: vi.fn(),
    handleSetDefault: vi.fn(),
    handlePurchasePlan: vi.fn(),
    handleTopupCredits: vi.fn(),
    handleCreateAccessToken: vi.fn(),
    handleRotateAccessToken: vi.fn(),
    handleRevokeAccessToken: vi.fn(),
    handleDismissIssuedToken: vi.fn(),
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

function createApiKeyProviders() {
  return [
    {
      id: "deepseek",
      name: "DeepSeek",
      type: "openai",
      api_host: "https://api.deepseek.com/v1",
      is_system: false,
      group: "cloud",
      enabled: true,
      sort_order: 5,
      api_version: undefined,
      project: undefined,
      location: undefined,
      region: undefined,
      custom_models: [],
      api_key_count: 1,
      api_keys: [
        {
          id: "key-deepseek-1",
          provider_id: "deepseek",
          api_key_masked: "sk-***1234",
          alias: "主 Key",
          enabled: true,
          usage_count: 0,
          error_count: 0,
          last_used_at: undefined,
          created_at: "2026-04-01T00:00:00Z",
        },
      ],
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    },
  ];
}

async function renderPage(
  props: {
    initialView?: "settings" | "cloud" | "companion";
  } = {},
) {
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

function getBodyText() {
  return document.body.textContent ?? "";
}

async function hoverTip(ariaLabel: string) {
  const trigger = document.body.querySelector(
    `button[aria-label='${ariaLabel}']`,
  );
  expect(trigger).toBeInstanceOf(HTMLButtonElement);

  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await Promise.resolve();
  });

  return trigger as HTMLButtonElement;
}

async function leaveTip(trigger: HTMLButtonElement | null) {
  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    await Promise.resolve();
  });
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
  mockApiKeyProviderGetProviders.mockResolvedValue(createApiKeyProviders());
  mockProviderPoolGetOverview.mockResolvedValue(createProviderOverview());
  mockSubscribeProviderDataChanged.mockReturnValue(vi.fn());
  mockGetConfig.mockResolvedValue({
    workspace_preferences: {
      companion_defaults: {
        general: {
          preferredProviderId: "deepseek",
          preferredModelId: "deepseek-chat",
          allowFallback: false,
        },
      },
    },
  });
  mockSaveConfig.mockResolvedValue(undefined);
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
  it("桌宠页应把 Companion 说明和桥接 hint 收进 tips", async () => {
    await renderPage({ initialView: "companion" });

    expect(getBodyText()).not.toContain(
      "桌宠通过本地 Companion 通道复用 Lime 的 AI 服务商状态",
    );
    expect(getBodyText()).not.toContain(
      "Lime 负责本地 Companion 宿主，桌宠作为独立原生壳接入。",
    );

    const introTip = await hoverTip("桌宠 Companion 说明");
    expect(getBodyText()).toContain(
      "桌宠通过本地 Companion 通道复用 Lime 的 AI 服务商状态",
    );
    await leaveTip(introTip);

    const bridgeTip = await hoverTip("桥接状态说明");
    expect(getBodyText()).toContain(
      "Lime 负责本地 Companion 宿主，桌宠作为独立原生壳接入。",
    );
    await leaveTip(bridgeTip);
  });

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
    const companionTab = container.querySelector(
      '[data-testid="provider-workspace-tab-companion"]',
    );

    expect(
      container.querySelector('[data-testid="provider-workspace-switcher"]'),
    ).not.toBeNull();
    expect(
      container.querySelectorAll('[data-testid="provider-workspace-switcher"]')
        .length,
    ).toBe(1);
    expect(text).toContain("凭证池占位");
    expect(text).not.toContain("Lime Pet Companion");
    expect(text).not.toContain("把本地 Provider 配置和 OEM 云端服务拆开管理");
    expect(text).not.toContain("把本地 Provider 配置和品牌云端服务拆开管理");
    expect(text).not.toContain("默认先进入“服务商设置”处理 Provider");
    expect(text).not.toContain("public/oem-runtime-config.js");
    expect(settingsTab?.getAttribute("data-state")).toBe("active");
    expect(cloudTab?.getAttribute("data-state")).toBe("inactive");
    expect(companionTab?.getAttribute("data-state")).toBe("inactive");

    await act(async () => {
      findButton(container, "云端服务").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.textContent ?? "").toContain("当前版本未配置云端服务");
    expect(container.textContent ?? "").not.toContain(
      "public/oem-runtime-config.js",
    );
    expect(settingsTab?.getAttribute("data-state")).toBe("inactive");
    expect(cloudTab?.getAttribute("data-state")).toBe("active");
    expect(companionTab?.getAttribute("data-state")).toBe("inactive");
  });

  it("未登录时应直接打开品牌云端登录入口", async () => {
    const handleGoogleLogin = vi.fn().mockResolvedValue(undefined);
    mockUseOemCloudAccess.mockReturnValue(
      createAccessState({ handleGoogleLogin }),
    );

    const { container } = await renderPage();

    await act(async () => {
      findButton(container, "云端服务").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    const text = container.textContent ?? "";
    expect(text).toContain("正在打开 Lime Hub 登录");
    expect(text).toContain("重新打开登录页");
    expect(text).not.toContain("去个人中心登录");
    expect(text).not.toContain("云端页面承接什么");
    expect(handleGoogleLogin).toHaveBeenCalledTimes(1);
  });

  it("已登录时应在云端页展示品牌来源目录与模型详情", async () => {
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
        cloudActivation: {
          gateway: {
            basePath: "https://llm.limeai.run",
            openAIBaseUrl: "https://llm.limeai.run/v1",
            anthropicBaseUrl: "https://llm.limeai.run",
            authorizationHeader: "Authorization",
            authorizationScheme: "Bearer",
            tenantHeader: "X-Lime-Tenant-ID",
          },
          llmBaseUrl: "https://llm.limeai.run",
          openAIBaseUrl: "https://llm.limeai.run/v1",
          anthropicBaseUrl: "https://llm.limeai.run",
        },
        cloudReadiness: {
          status: "ready",
          title: "云端模型调用已就绪",
          description: "套餐、API Key 和模型目录均已准备完成。",
          nextAction: "开始调用",
          canInvoke: true,
          blockers: [],
          steps: [
            {
              key: "plan",
              label: "套餐权益",
              done: true,
            },
            {
              key: "api_key",
              label: "API Key",
              done: true,
            },
          ],
        },
        pendingPayment: null,
        selectedOffer,
        selectedModels: [
          {
            id: "model-001",
            offerId: "offer-001",
            modelId: "gpt-5.2-pro",
            displayName: "GPT-5.2 Pro",
            recommended: true,
            abilities: ["chat", "vision_understanding", "image_generation"],
            upstreamMapping: "openai/gpt-image-1",
            description: "统一下发的多能力目录项",
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
    expect(text).toContain("云端模型调用已就绪");
    expect(text).toContain("购买套餐");
    expect(text).toContain("Token 积分");
    expect(text).toContain("API Key");
    expect(text).toContain("SDK 调用");
    expect(text).toContain("OpenAI SDK");
    expect(text).toContain("Anthropic SDK");
    expect(text).toContain("https://llm.limeai.run/v1");
    expect(text).toContain("X-Lime-Tenant-ID");
    expect(text).toContain("最小 curl 测试");
    expect(text).toContain("云端额度");
    expect(text).toContain("账本记录");
    expect(text).toContain("Lime Hub 主服务");
    expect(text).toContain("GPT-5.2 Pro");
    expect(text).toContain("Lime 云端");
    expect(text).toContain("对话");
    expect(text).toContain("视觉理解");
    expect(text).toContain("图片生成");
    expect(text).toContain("实际映射：gpt-5.2-pro → openai/gpt-image-1");
    expect(text).toContain("统一下发的多能力目录项");

    await act(async () => {
      findButton(container, "设为默认").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(handleRefresh).toHaveBeenCalledTimes(1);
    expect(handleSetDefault).toHaveBeenCalledTimes(1);
  });

  it("已登录时应支持套餐购买、积分充值和 API Key 管理入口", async () => {
    const handlePurchasePlan = vi.fn();
    const handleTopupCredits = vi.fn();
    const handleCreateAccessToken = vi.fn();
    const handleRotateAccessToken = vi.fn();
    const handleRevokeAccessToken = vi.fn();
    const handleDismissIssuedToken = vi.fn();
    const activeToken = {
      id: "token-001",
      tenantId: "tenant-0001",
      userId: "user-001",
      name: "Desktop Key",
      tokenMasked: "sk-lime-***abcd",
      tokenPrefix: "sk-lime-abcd",
      scopes: ["llm:invoke"],
      allowedModels: [],
      status: "active",
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:00.000Z",
      expiresAt: "2026-05-27T00:00:00.000Z",
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
        paymentConfigs: [
          {
            id: "pay-alipay",
            tenantId: "tenant-0001",
            provider: "epay",
            displayName: "易支付",
            enabled: true,
            methods: [
              {
                key: "alipay",
                displayName: "支付宝",
                enabled: true,
              },
            ],
            providerOptions: {},
            credentialMasks: {},
          },
        ],
        cloudReadiness: {
          status: "payment_pending",
          title: "存在待支付订单",
          description: "请先完成支付，再刷新云端激活状态。",
          nextAction: "刷新支付状态",
          canInvoke: false,
          blockers: ["payment"],
          steps: [
            {
              key: "payment",
              label: "支付确认",
              done: false,
            },
          ],
        },
        pendingPayment: {
          kind: "plan_order",
          orderId: "order-001",
          title: "Pro",
          paymentChannel: "epay",
          paymentReference: "https://pay.limeai.run/order-001",
          amountCents: 9900,
          status: "pending",
          createdAt: "2026-04-27T00:00:00.000Z",
          updatedAt: "2026-04-27T00:00:00.000Z",
        },
        plans: [
          {
            id: "plan-pro",
            tenantId: "tenant-0001",
            key: "pro",
            name: "Pro",
            tagline: "适合 coding plan 和高频模型调用",
            priceMonthly: 9900,
            creditsMonthly: 1000000,
            features: ["Anthropic-compatible coding", "GLM / Kimi / MiniMax"],
            status: "active",
            recommended: true,
            billingCycles: [
              {
                key: "monthly",
                label: "月付",
                priceCents: 9900,
                credits: 1000000,
                autoRenew: true,
              },
            ],
            quotaSummaries: [],
            featureSections: [],
          },
        ],
        subscription: null,
        creditAccount: {
          tenantId: "tenant-0001",
          balance: 120000,
          reserved: 0,
          currency: "credits",
          updatedAt: "2026-04-27T00:00:00.000Z",
        },
        topupPackages: [
          {
            id: "topup-100k",
            tenantId: "tenant-0001",
            key: "100k",
            name: "10 万积分包",
            credits: 100000,
            priceCents: 1900,
            bonusCredits: 10000,
            validDays: 365,
            recommended: true,
            status: "active",
          },
        ],
        usageDashboard: {
          usageRecords: [
            {
              id: "usage-001",
              tenantId: "tenant-0001",
              userId: "user-001",
              createdAt: "2026-04-27T00:00:00.000Z",
              usageType: "llm",
              triggerType: "api",
              model: "glm-4.6",
              tokens: 1024,
              credits: 88,
              durationMs: 1200,
              status: "charged",
            },
          ],
          monthlySummary: {
            freeCreditsUsed: 10,
            freeCreditsLimit: 100,
            topupCreditsUsed: 20,
            topupCreditsLimit: 1000,
            subscriptionCreditsUsed: 30,
            subscriptionCreditsLimit: 1000000,
          },
        },
        billingDashboard: {
          billingSummary: {
            currency: "CNY",
            nextPaymentAmountCents: 9900,
            autoRenew: true,
            totalSpentCents: 19900,
          },
          subscription: null,
          currentPlan: null,
          orders: [
            {
              id: "order-001",
              tenantId: "tenant-0001",
              userId: "user-001",
              planId: "plan-pro",
              planKey: "pro",
              planName: "Pro",
              amountCents: 9900,
              creditsGranted: 1000000,
              paymentChannel: "epay",
              paymentMethod: "alipay",
              billingCycle: "monthly",
              status: "paid",
              paidAt: "2026-04-27T00:00:00.000Z",
              createdAt: "2026-04-27T00:00:00.000Z",
              updatedAt: "2026-04-27T00:00:00.000Z",
            },
          ],
        },
        creditsDashboard: {
          creditAccount: {
            tenantId: "tenant-0001",
            balance: 120000,
            reserved: 0,
            currency: "credits",
            updatedAt: "2026-04-27T00:00:00.000Z",
          },
          subscription: null,
          topupPackages: [],
          creditWallets: [
            {
              id: "wallet-001",
              tenantId: "tenant-0001",
              userId: "user-001",
              packageName: "10 万积分包",
              sourceType: "topup",
              grantedCredits: 110000,
              usedCredits: 10000,
              remainingCredits: 100000,
              status: "active",
              effectiveAt: "2026-04-27T00:00:00.000Z",
              expiresAt: "2027-04-27T00:00:00.000Z",
              createdAt: "2026-04-27T00:00:00.000Z",
              updatedAt: "2026-04-27T00:00:00.000Z",
            },
          ],
          creditOrders: [
            {
              id: "topup-order-001",
              tenantId: "tenant-0001",
              userId: "user-001",
              packageId: "topup-100k",
              packageName: "10 万积分包",
              creditsGranted: 110000,
              amountCents: 1900,
              paymentChannel: "epay",
              paymentMethod: "alipay",
              status: "paid",
              paidAt: "2026-04-27T00:00:00.000Z",
              createdAt: "2026-04-27T00:00:00.000Z",
              updatedAt: "2026-04-27T00:00:00.000Z",
            },
          ],
        },
        accessTokens: [activeToken],
        activeAccessToken: {
          hasActive: true,
          token: activeToken,
        },
        lastIssuedRawToken: "sk-lime-once",
        offers: [createOffer()],
        preference: {
          providerSource: "oem_cloud",
          providerKey: "lime-hub-main",
        },
        defaultCloudOffer: createOffer(),
        activeCloudOffer: createOffer(),
        handlePurchasePlan,
        handleTopupCredits,
        handleCreateAccessToken,
        handleRotateAccessToken,
        handleRevokeAccessToken,
        handleDismissIssuedToken,
      }),
    );

    const { container } = await renderPage();

    await act(async () => {
      findButton(container, "云端服务").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    const text = container.textContent ?? "";
    expect(
      container.querySelector(
        '[data-testid="oem-cloud-commerce-compact-panel"]',
      ),
    ).not.toBeNull();
    expect(text).toContain("购买套餐");
    expect(text).toContain("Pro");
    expect(text).toContain("存在待支付订单");
    expect(text).toContain("继续支付");
    expect(text).toContain("Anthropic-compatible coding");
    expect(text).toContain("积分充值");
    expect(text).toContain("10 万积分包");
    expect(text).toContain("sk-lime-once");
    expect(text).toContain("glm-4.6");
    expect(text).toContain("账本记录");
    expect(text).toContain("最近用量");
    expect(text).toContain("已支付");
    expect(text).not.toContain("套餐订单");
    expect(text).not.toContain("充值订单");
    expect(text).not.toContain("积分钱包");
    expect(text).not.toContain("支付后台配置");

    await act(async () => {
      findButton(container, "购买套餐").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(handlePurchasePlan).toHaveBeenCalledWith({
      planId: "plan-pro",
      paymentChannel: "epay",
      paymentMethod: "alipay",
      billingCycle: "monthly",
    });

    await act(async () => {
      findButton(container, "立即充值").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(handleTopupCredits).toHaveBeenCalledWith({
      packageId: "topup-100k",
      paymentChannel: "epay",
      paymentMethod: "alipay",
    });

    await act(async () => {
      findButton(container, "继续支付").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(mockOpenUrl).toHaveBeenCalledWith(
      "https://pay.limeai.run/order-001",
    );

    await act(async () => {
      findButton(container, "创建 API Key").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(handleCreateAccessToken).toHaveBeenCalledTimes(1);

    await act(async () => {
      findButton(container, "轮换 Key").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(handleRotateAccessToken).toHaveBeenCalledWith("token-001");

    await act(async () => {
      findButton(container, "撤销 Key").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(handleRevokeAccessToken).toHaveBeenCalledWith("token-001");

    await act(async () => {
      findButton(container, "我已保存").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(handleDismissIssuedToken).toHaveBeenCalledTimes(1);
  });

  it("已下发 taxonomy 时应优先使用统一 schema 渲染品牌模型目录", async () => {
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
        selectedModels: [
          {
            id: "model-002",
            offerId: "offer-001",
            modelId: "relay-gpt-images-2",
            displayName: "Relay GPT Images 2",
            abilities: ["chat", "vision_understanding"],
            task_families: ["image_generation"],
            input_modalities: ["text"],
            output_modalities: ["image"],
            runtime_features: ["images_api"],
            canonical_model_id: "openai/gpt-images-2",
            alias_source: "oem",
            recommended: true,
            description: "应优先使用统一 taxonomy",
          },
        ],
        defaultCloudOffer: createOffer(),
        activeCloudOffer: createOffer(),
      }),
    );

    const { container } = await renderPage();

    await act(async () => {
      findButton(container, "云端服务").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    const text = container.textContent ?? "";
    expect(text).toContain("Relay GPT Images 2");
    expect(text).toContain("图片生成");
    expect(text).not.toContain("视觉理解");
    expect(text).not.toContain("对话");
    expect(text).toContain(
      "实际映射：relay-gpt-images-2 → openai/gpt-images-2",
    );
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

  it("桌宠管理页应展示桌宠桥接卡片和脱敏边界说明", async () => {
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

    expect(
      container.querySelector('[data-testid="companion-provider-card"]'),
    ).toBeNull();

    await act(async () => {
      findButton(container, "桌宠管理").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    const text = container.textContent ?? "";

    expect(
      container.querySelector('[data-testid="companion-provider-card"]'),
    ).not.toBeNull();
    expect(text).toContain("Lime Pet Companion");

    const introTip = await hoverTip("桌宠 Companion 说明");
    expect(getBodyText()).toContain(
      "桌宠通过本地 Companion 通道复用 Lime 的 AI 服务商状态",
    );
    expect(getBodyText()).toContain(
      "不会直接读取 API Key、OAuth 凭证或本地凭证文件",
    );
    await leaveTip(introTip);

    expect(text).toContain("桌宠已连接");
    expect(text).toContain("Provider 概览");
    expect(text).toContain("桌宠视角预览");
    expect(text).toContain("DeepSeek");
    expect(text).toContain("OpenAI");
    expect(text).toContain("Codex");
    expect(text).toContain("可用 3");
    expect(text).toContain("需关注 1");
    expect(text).toContain("接入检查");
    expect(text).toContain("当前链路已就绪，可以直接点击“立即同步到桌宠”。");
    expect(text).toContain("桌宠能力偏好");
    expect(text).toContain("桌宠通用模型");
    expect(text).not.toContain("桌宠语音播报");
    expect(
      container.querySelectorAll(
        "[data-testid='provider-settings-model-selector']",
      ),
    ).toHaveLength(1);
  });

  it("带 initialView=companion 时应默认打开桌宠管理页", async () => {
    const { container } = await renderPage({ initialView: "companion" });

    expect(
      container.querySelector('[data-testid="companion-provider-card"]'),
    ).not.toBeNull();
    expect(container.textContent ?? "").toContain("Lime Pet Companion");
  });

  it("点击开启桌宠后应调用 launch 接口并展示启动反馈", async () => {
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
      findButton(container, "桌宠管理").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    await act(async () => {
      findButton(container, "开启桌宠").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockLaunchCompanionPet).toHaveBeenCalledTimes(1);
    expect(container.textContent ?? "").toContain("已请求开启桌宠");
  });

  it("未安装桌宠时应展示安装引导并支持一键打开下载页", async () => {
    mockLaunchCompanionPet.mockResolvedValue({
      launched: false,
      resolved_path: null,
      endpoint: "ws://127.0.0.1:45554/companion/pet",
      message:
        "未找到 Lime Pet 可执行产物，请先安装桌宠应用或通过 app_path 显式指定。",
    });
    mockGetCompanionPetStatus
      .mockResolvedValueOnce(createPetStatus())
      .mockResolvedValueOnce(createPetStatus());

    const { container } = await renderPage({ initialView: "companion" });

    await act(async () => {
      findButton(container, "开启桌宠").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="companion-install-guide"]'),
    ).not.toBeNull();
    expect(container.textContent ?? "").toContain("还没有安装 Lime Pet");
    expect(container.textContent ?? "").toContain("下载安装 Lime Pet");

    await act(async () => {
      findButton(container, "下载安装 Lime Pet").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(mockOpenUrl).toHaveBeenCalledWith(
      "https://github.com/limecloud/lime-pet/releases/latest",
    );
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
      findButton(container, "桌宠管理").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

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
            provider_type: "deepseek",
            display_name: "DeepSeek",
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
        total_provider_count: 3,
        available_provider_count: 3,
        needs_attention_provider_count: 1,
      },
    });
    expect(container.textContent ?? "").toContain(
      "已同步 3 个服务商摘要到桌宠",
    );
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

    await act(async () => {
      findButton(container, "桌宠管理").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    const syncButton = container.querySelector(
      '[data-testid="companion-sync-preview"]',
    ) as HTMLButtonElement | null;
    const text = container.textContent ?? "";

    expect(syncButton).not.toBeNull();
    expect(syncButton?.disabled).toBe(true);
    expect(text).toContain("能力未声明");
    expect(text).toContain("当前桌宠已连接，但尚未声明 Provider 概览能力");

    const identityTip = await hoverTip("桌宠身份说明");
    expect(getBodyText()).toContain("平台：Windows");
    await leaveTip(identityTip);
  });
});
