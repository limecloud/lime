import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setStoredOemCloudSessionState } from "@/lib/oemCloudSession";
import { OEM_CLOUD_PAYMENT_RETURN_EVENT } from "@/lib/oemCloudPaymentReturn";

const controlPlaneMocks = vi.hoisted(() => ({
  getClientBootstrap: vi.fn(),
  getClientCloudActivation: vi.fn(),
  getClientOrder: vi.fn(),
  getClientCreditTopupOrder: vi.fn(),
  getClientProviderOffer: vi.fn(),
  listClientProviderOfferModels: vi.fn(),
  updateClientProviderPreference: vi.fn(),
  createClientOrder: vi.fn(),
  createClientOrderCheckout: vi.fn(),
  createClientCreditTopupOrder: vi.fn(),
  createClientCreditTopupOrderCheckout: vi.fn(),
  createClientAccessToken: vi.fn(),
  rotateClientAccessToken: vi.fn(),
  revokeClientAccessToken: vi.fn(),
  createClientDesktopAuthSession: vi.fn(),
  pollClientDesktopAuthSession: vi.fn(),
  loginClientByPassword: vi.fn(),
  logoutClient: vi.fn(),
  sendClientAuthEmailCode: vi.fn(),
  verifyClientAuthEmailCode: vi.fn(),
}));

const shellOpenMock = vi.hoisted(() => vi.fn());
const desktopAuthMocks = vi.hoisted(() => ({
  completeOemCloudDesktopOAuthLogin: vi.fn(),
}));

vi.mock("@/lib/api/oemCloudControlPlane", () => {
  class MockOemCloudControlPlaneError extends Error {
    status: number;

    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  }

  return {
    OemCloudControlPlaneError: MockOemCloudControlPlaneError,
    getClientBootstrap: controlPlaneMocks.getClientBootstrap,
    getClientCloudActivation: controlPlaneMocks.getClientCloudActivation,
    getClientOrder: controlPlaneMocks.getClientOrder,
    getClientCreditTopupOrder: controlPlaneMocks.getClientCreditTopupOrder,
    getClientProviderOffer: controlPlaneMocks.getClientProviderOffer,
    listClientProviderOfferModels:
      controlPlaneMocks.listClientProviderOfferModels,
    updateClientProviderPreference:
      controlPlaneMocks.updateClientProviderPreference,
    createClientOrder: controlPlaneMocks.createClientOrder,
    createClientOrderCheckout: controlPlaneMocks.createClientOrderCheckout,
    createClientCreditTopupOrder:
      controlPlaneMocks.createClientCreditTopupOrder,
    createClientCreditTopupOrderCheckout:
      controlPlaneMocks.createClientCreditTopupOrderCheckout,
    createClientAccessToken: controlPlaneMocks.createClientAccessToken,
    rotateClientAccessToken: controlPlaneMocks.rotateClientAccessToken,
    revokeClientAccessToken: controlPlaneMocks.revokeClientAccessToken,
    createClientDesktopAuthSession:
      controlPlaneMocks.createClientDesktopAuthSession,
    pollClientDesktopAuthSession:
      controlPlaneMocks.pollClientDesktopAuthSession,
    loginClientByPassword: controlPlaneMocks.loginClientByPassword,
    logoutClient: controlPlaneMocks.logoutClient,
    sendClientAuthEmailCode: controlPlaneMocks.sendClientAuthEmailCode,
    verifyClientAuthEmailCode: controlPlaneMocks.verifyClientAuthEmailCode,
  };
});

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: shellOpenMock,
}));

vi.mock("@/lib/oemCloudDesktopAuth", () => ({
  OEM_CLOUD_OAUTH_COMPLETED_EVENT: "lime:oem-cloud-oauth-completed",
  completeOemCloudDesktopOAuthLogin:
    desktopAuthMocks.completeOemCloudDesktopOAuthLogin,
}));

vi.mock("@/lib/serviceSkillCatalogBootstrap", () => ({
  syncServiceSkillCatalogFromBootstrapPayload: vi.fn(),
}));

vi.mock("@/lib/skillCatalogBootstrap", () => ({
  syncSkillCatalogFromBootstrapPayload: vi.fn(),
}));

vi.mock("@/lib/api/skillCatalog", () => ({
  clearSkillCatalogCache: vi.fn(),
}));

vi.mock("@/lib/siteAdapterCatalogBootstrap", () => ({
  syncSiteAdapterCatalogFromBootstrapPayload: vi.fn(),
  clearSiteAdapterCatalogCache: vi.fn(),
}));

import { useOemCloudAccess } from "./useOemCloudAccess";

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return {
    promise,
    resolve,
    reject,
  };
}

let latestState: ReturnType<typeof useOemCloudAccess> | null = null;

function HookHarness() {
  latestState = useOemCloudAccess();
  return (
    <div data-testid="hook-state">
      {latestState.initializing
        ? "initializing"
        : latestState.session?.session.id || "anonymous"}
    </div>
  );
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useOemCloudAccess", () => {
  let mountedHarness: MountedHarness | null = null;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    latestState = null;
    window.localStorage.clear();
    delete window.__LIME_SESSION_TOKEN__;
    delete window.__LIME_BOOTSTRAP__;
    window.__LIME_OEM_CLOUD__ = {
      enabled: true,
      baseUrl: "https://user.limeai.run",
      tenantId: "tenant-0001",
    };

    controlPlaneMocks.getClientCloudActivation.mockResolvedValue({
      gateway: {
        basePath: "https://llm.limeai.run",
        openAIBaseUrl: "https://llm.limeai.run/v1",
        anthropicBaseUrl: "https://llm.limeai.run",
      },
      llmBaseUrl: "https://llm.limeai.run",
      openAIBaseUrl: "https://llm.limeai.run/v1",
      anthropicBaseUrl: "https://llm.limeai.run",
      readiness: {
        status: "no_api_key",
        title: "还没有可用 API Key",
        canInvoke: false,
        blockers: ["api_key"],
        steps: [],
      },
      pendingPayment: null,
      paymentConfigs: [],
      plans: [],
      subscription: null,
      creditAccount: null,
      creditsDashboard: null,
      topupPackages: [],
      usageDashboard: null,
      billingDashboard: null,
      providerOffers: [],
      selectedOffer: null,
      providerModels: [],
      providerPreference: null,
      accessTokens: [],
      activeAccessToken: { hasActive: false, token: null },
      orders: [],
      creditTopupOrders: [],
    });
    controlPlaneMocks.getClientProviderOffer.mockResolvedValue(null);
    controlPlaneMocks.getClientOrder.mockResolvedValue(null);
    controlPlaneMocks.getClientCreditTopupOrder.mockResolvedValue(null);
    controlPlaneMocks.listClientProviderOfferModels.mockResolvedValue([]);
    controlPlaneMocks.updateClientProviderPreference.mockResolvedValue(null);
    controlPlaneMocks.createClientOrder.mockResolvedValue(null);
    controlPlaneMocks.createClientOrderCheckout.mockResolvedValue(null);
    controlPlaneMocks.createClientCreditTopupOrder.mockResolvedValue(null);
    controlPlaneMocks.createClientCreditTopupOrderCheckout.mockResolvedValue(
      null,
    );
    controlPlaneMocks.createClientAccessToken.mockResolvedValue(null);
    controlPlaneMocks.rotateClientAccessToken.mockResolvedValue(null);
    controlPlaneMocks.revokeClientAccessToken.mockResolvedValue(null);
    controlPlaneMocks.createClientDesktopAuthSession.mockResolvedValue(null);
    controlPlaneMocks.pollClientDesktopAuthSession.mockResolvedValue(null);
    controlPlaneMocks.loginClientByPassword.mockResolvedValue(null);
    controlPlaneMocks.logoutClient.mockResolvedValue(undefined);
    controlPlaneMocks.sendClientAuthEmailCode.mockResolvedValue(null);
    controlPlaneMocks.verifyClientAuthEmailCode.mockResolvedValue(null);
    desktopAuthMocks.completeOemCloudDesktopOAuthLogin.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    window.localStorage.clear();
    delete window.__LIME_SESSION_TOKEN__;
    delete window.__LIME_BOOTSTRAP__;
    delete window.__LIME_OEM_CLOUD__;

    if (mountedHarness) {
      act(() => {
        mountedHarness?.root.unmount();
      });
      mountedHarness.container.remove();
      mountedHarness = null;
    }
  });

  it("恢复本地会话时不应因重复 effect 触发而卡在初始化中", async () => {
    const bootstrapPayload = {
      session: {
        tenant: {
          id: "tenant-0001",
          name: "JustAI Demo",
        },
        user: {
          id: "user-001",
          email: "operator@example.com",
          displayName: "Demo Operator",
        },
        session: {
          id: "session-001",
          tenantId: "tenant-0001",
          userId: "user-001",
          expiresAt: "2026-03-25T08:00:00.000Z",
        },
      },
      providerOffersSummary: [],
      providerPreference: null,
      serviceSkillCatalog: {
        items: [],
      },
      sceneCatalog: [],
      gateway: {
        basePath: "/gateway-api",
      },
    };
    const bootstrapDeferred = createDeferred<typeof bootstrapPayload>();
    controlPlaneMocks.getClientBootstrap.mockImplementation(
      () => bootstrapDeferred.promise,
    );

    setStoredOemCloudSessionState({
      token: "session-token-restore",
      tenant: {
        id: "tenant-0001",
      },
      user: {
        id: "user-001",
      },
      session: {
        id: "session-001",
      },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedHarness = { container, root };

    act(() => {
      root.render(<HookHarness />);
    });

    await flushEffects();

    expect(controlPlaneMocks.getClientBootstrap).toHaveBeenCalledTimes(1);
    expect(latestState?.initializing).toBe(true);

    await act(async () => {
      bootstrapDeferred.resolve(bootstrapPayload);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latestState?.initializing).toBe(false);
    expect(latestState?.session?.session.id).toBe("session-001");
    expect(latestState?.session?.token).toBe("session-token-restore");
  });

  it("购买和充值只创建订单、打开 checkout，API Key 明文只临时保存", async () => {
    const bootstrapPayload = {
      session: {
        tenant: {
          id: "tenant-0001",
          name: "JustAI Demo",
        },
        user: {
          id: "user-001",
          email: "operator@example.com",
          displayName: "Demo Operator",
        },
        session: {
          id: "session-001",
          tenantId: "tenant-0001",
          userId: "user-001",
          expiresAt: "2026-03-25T08:00:00.000Z",
        },
      },
      providerOffersSummary: [],
      providerPreference: null,
      serviceSkillCatalog: {
        items: [],
      },
      sceneCatalog: [],
      gateway: {
        basePath: "/gateway-api",
      },
    };
    const order = {
      id: "order-001",
      planName: "Pro",
      paymentReference: "",
    };
    const topupOrder = {
      id: "topup-order-001",
      packageName: "10 万积分包",
      paymentReference: "",
    };
    const accessToken = {
      id: "token-001",
      tenantId: "tenant-0001",
      userId: "user-001",
      name: "Desktop Key",
      tokenMasked: "sk-lime-***abcd",
      scopes: ["llm:invoke"],
      allowedModels: [],
      status: "active",
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:00.000Z",
      expiresAt: "2026-05-27T00:00:00.000Z",
    };
    controlPlaneMocks.getClientBootstrap.mockResolvedValue(bootstrapPayload);
    controlPlaneMocks.createClientOrder.mockResolvedValue(order);
    controlPlaneMocks.getClientOrder.mockResolvedValue({
      ...order,
      planName: "Pro",
      status: "paid",
    });
    controlPlaneMocks.createClientOrderCheckout.mockResolvedValue({
      orderKind: "plan_order",
      orderId: "order-001",
      paymentChannel: "epay",
      paymentMethod: "alipay",
      checkoutUrl: "https://pay.limeai.run/order-001",
      status: "pending",
    });
    controlPlaneMocks.createClientCreditTopupOrder.mockResolvedValue(
      topupOrder,
    );
    controlPlaneMocks.getClientCreditTopupOrder.mockResolvedValue({
      ...topupOrder,
      packageName: "10 万积分包",
      status: "paid",
    });
    controlPlaneMocks.createClientCreditTopupOrderCheckout.mockResolvedValue({
      orderKind: "credit_topup_order",
      orderId: "topup-order-001",
      paymentChannel: "epay",
      paymentMethod: "alipay",
      checkoutUrl: "https://pay.limeai.run/topup-order-001",
      status: "pending",
    });
    controlPlaneMocks.createClientAccessToken.mockResolvedValue({
      token: accessToken,
      apiKey: "sk-lime-once",
    });

    setStoredOemCloudSessionState({
      token: "session-token-restore",
      tenant: {
        id: "tenant-0001",
      },
      user: {
        id: "user-001",
      },
      session: {
        id: "session-001",
      },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedHarness = { container, root };

    act(() => {
      root.render(<HookHarness />);
    });
    await flushEffects();
    vi.useFakeTimers();

    await act(async () => {
      await latestState?.handlePurchasePlan({
        planId: "plan-pro",
        paymentChannel: "epay",
        paymentMethod: "alipay",
        billingCycle: "monthly",
      });
    });

    expect(controlPlaneMocks.createClientOrder).toHaveBeenCalledWith(
      "tenant-0001",
      {
        planId: "plan-pro",
        paymentChannel: "epay",
        paymentMethod: "alipay",
        billingCycle: "monthly",
      },
    );
    expect(controlPlaneMocks.createClientOrderCheckout).toHaveBeenCalledWith(
      "tenant-0001",
      "order-001",
      {
        paymentMethod: "alipay",
        successUrl:
          "https://user.limeai.run/api/v1/public/tenants/tenant-0001/payments/epay/return?orderId=order-001&kind=plan_order&status=success",
        cancelUrl:
          "https://user.limeai.run/api/v1/public/tenants/tenant-0001/payments/epay/return?orderId=order-001&kind=plan_order&status=cancelled",
      },
    );
    expect(shellOpenMock).toHaveBeenCalledWith(
      "https://pay.limeai.run/order-001",
    );
    expect(latestState?.paymentWatcher?.status).toBe("waiting");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
      await Promise.resolve();
    });

    expect(controlPlaneMocks.getClientOrder).toHaveBeenCalledWith(
      "tenant-0001",
      "order-001",
    );
    expect(latestState?.paymentWatcher?.status).toBe("confirmed");

    await act(async () => {
      await latestState?.handleTopupCredits({
        packageId: "topup-100k",
        paymentChannel: "epay",
        paymentMethod: "alipay",
      });
    });

    expect(controlPlaneMocks.createClientCreditTopupOrder).toHaveBeenCalledWith(
      "tenant-0001",
      {
        packageId: "topup-100k",
        paymentChannel: "epay",
        paymentMethod: "alipay",
      },
    );
    expect(
      controlPlaneMocks.createClientCreditTopupOrderCheckout,
    ).toHaveBeenCalledWith("tenant-0001", "topup-order-001", {
      paymentMethod: "alipay",
      successUrl:
        "https://user.limeai.run/api/v1/public/tenants/tenant-0001/payments/epay/return?orderId=topup-order-001&kind=credit_topup_order&status=success",
      cancelUrl:
        "https://user.limeai.run/api/v1/public/tenants/tenant-0001/payments/epay/return?orderId=topup-order-001&kind=credit_topup_order&status=cancelled",
    });
    expect(shellOpenMock).toHaveBeenCalledWith(
      "https://pay.limeai.run/topup-order-001",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
      await Promise.resolve();
    });

    expect(controlPlaneMocks.getClientCreditTopupOrder).toHaveBeenCalledWith(
      "tenant-0001",
      "topup-order-001",
    );
    expect(latestState?.paymentWatcher?.status).toBe("confirmed");

    await act(async () => {
      await latestState?.handleCreateAccessToken({
        name: "Desktop Key",
      });
    });

    expect(controlPlaneMocks.createClientAccessToken).toHaveBeenCalledWith(
      "tenant-0001",
      {
        name: "Desktop Key",
        scopes: ["llm:invoke"],
        allowedModels: undefined,
        maxTokensPerRequest: undefined,
        requestsPerMinute: undefined,
        tokensPerMinute: undefined,
        monthlyCreditLimit: undefined,
      },
    );
    expect(latestState?.lastIssuedRawToken).toBe("sk-lime-once");

    act(() => {
      latestState?.handleDismissIssuedToken();
    });
    expect(latestState?.lastIssuedRawToken).toBeNull();
  });

  it("支付回跳事件应刷新云端权益并接回订单 watcher", async () => {
    const bootstrapPayload = {
      session: {
        tenant: {
          id: "tenant-0001",
          name: "JustAI Demo",
        },
        user: {
          id: "user-001",
          email: "operator@example.com",
          displayName: "Demo Operator",
        },
        session: {
          id: "session-001",
          tenantId: "tenant-0001",
          userId: "user-001",
          expiresAt: "2026-03-25T08:00:00.000Z",
        },
      },
      providerOffersSummary: [],
      providerPreference: null,
      serviceSkillCatalog: {
        items: [],
      },
      sceneCatalog: [],
      gateway: {
        basePath: "/gateway-api",
      },
    };
    controlPlaneMocks.getClientBootstrap.mockResolvedValue(bootstrapPayload);

    setStoredOemCloudSessionState({
      token: "session-token-restore",
      tenant: {
        id: "tenant-0001",
      },
      user: {
        id: "user-001",
      },
      session: {
        id: "session-001",
      },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedHarness = { container, root };

    act(() => {
      root.render(<HookHarness />);
    });
    await flushEffects();
    controlPlaneMocks.getClientBootstrap.mockClear();
    controlPlaneMocks.getClientCloudActivation.mockClear();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(OEM_CLOUD_PAYMENT_RETURN_EVENT, {
          detail: {
            tenantId: "tenant-0001",
            orderId: "order-001",
            kind: "plan_order",
            status: "success",
            sourceUrl:
              "lime://payment/return?tenantId=tenant-0001&orderId=order-001&kind=plan_order&status=success",
            receivedAt: Date.now(),
          },
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(controlPlaneMocks.getClientBootstrap).toHaveBeenCalledWith(
      "tenant-0001",
    );
    expect(controlPlaneMocks.getClientCloudActivation).toHaveBeenCalledWith(
      "tenant-0001",
    );
    expect(latestState?.paymentWatcher).toMatchObject({
      kind: "plan_order",
      orderId: "order-001",
      status: "waiting",
    });
    expect(latestState?.infoMessage).toContain("同步支付状态");
  });

  it("Google 桌面登录应创建 desktop auth session、打开服务端授权页并轮询落地会话", async () => {
    controlPlaneMocks.createClientDesktopAuthSession.mockResolvedValue({
      authSessionId: "desktop-auth-001",
      deviceCode: "device-code-001",
      tenantId: "tenant-0001",
      clientId: "desktop-client",
      clientName: "Lime Desktop",
      provider: "google",
      desktopRedirectUri: "lime://oauth/callback",
      status: "pending_login",
      expiresInSeconds: 600,
      pollIntervalSeconds: 1,
      authorizeUrl:
        "https://user.limeai.run/oauth/desktop/device-code-001/signin",
    });
    controlPlaneMocks.pollClientDesktopAuthSession.mockResolvedValue({
      deviceCode: "device-code-001",
      tenantId: "tenant-0001",
      clientId: "desktop-client",
      clientName: "Lime Desktop",
      provider: "google",
      desktopRedirectUri: "lime://oauth/callback",
      status: "approved",
      expiresInSeconds: 590,
      pollIntervalSeconds: 1,
      sessionToken: "desktop-session-token",
      sessionExpiresAt: "2026-05-27T00:00:00.000Z",
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedHarness = { container, root };

    act(() => {
      root.render(<HookHarness />);
    });
    await flushEffects();

    await act(async () => {
      await latestState?.handleGoogleLogin();
    });

    expect(
      controlPlaneMocks.createClientDesktopAuthSession,
    ).toHaveBeenCalledWith("tenant-0001", {
      clientId: "desktop-client",
      provider: "google",
      desktopRedirectUri: "lime://oauth/callback",
    });
    expect(shellOpenMock).toHaveBeenCalledWith(
      "https://user.limeai.run/oauth/desktop/device-code-001/signin",
    );
    expect(controlPlaneMocks.pollClientDesktopAuthSession).toHaveBeenCalledWith(
      "device-code-001",
    );
    expect(
      desktopAuthMocks.completeOemCloudDesktopOAuthLogin,
    ).toHaveBeenCalledWith({
      tenantId: "tenant-0001",
      token: "desktop-session-token",
      nextPath: "/welcome",
      error: null,
    });
  });

  it("Google 桌面登录不再接受 localhost 本地回调配置", async () => {
    window.__LIME_OEM_CLOUD__ = {
      enabled: true,
      baseUrl: "https://user.limeai.run",
      tenantId: "tenant-0001",
      desktopOauthRedirectUrl: "http://localhost:17834/callback",
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedHarness = { container, root };

    act(() => {
      root.render(<HookHarness />);
    });
    await flushEffects();

    await act(async () => {
      await latestState?.handleGoogleLogin();
    });

    expect(
      controlPlaneMocks.createClientDesktopAuthSession,
    ).not.toHaveBeenCalled();
    expect(latestState?.errorMessage).toContain("localhost 本地回调");
  });
});
