import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseOemCloudAccess, mockFormatOemCloudDateTime } = vi.hoisted(() => ({
  mockUseOemCloudAccess: vi.fn(),
  mockFormatOemCloudDateTime: vi.fn((value?: string) => `fmt:${value ?? ""}`),
}));

vi.mock("@/components/provider-pool", () => ({
  ProviderPoolPage: () => <div data-testid="provider-pool-stub">凭证池占位</div>,
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
  const defaultOffer = createOffer();

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

function renderPage(props: { onOpenProfile?: () => void } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<CloudProviderSettings {...props} />);
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
  it("未配置运行时信息时应展示配置提示并保留本地 Provider 面板", () => {
    mockUseOemCloudAccess.mockReturnValue(
      createAccessState({
        runtime: null,
        configuredTarget: null,
      }),
    );

    const { container } = renderPage();
    const text = container.textContent ?? "";

    expect(text).toContain("云端接入");
    expect(text).toContain("public/oem-runtime-config.js");
    expect(text).toContain("本地 / 其它开发者 Provider");
    expect(text).toContain("凭证池占位");
  });

  it("未登录时应提示前往个人中心登录", async () => {
    const onOpenProfile = vi.fn();
    const { container } = renderPage({ onOpenProfile });

    expect(container.textContent ?? "").toContain("去个人中心登录");

    await act(async () => {
      findButton(container, "去个人中心登录").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onOpenProfile).toHaveBeenCalledTimes(1);
  });

  it("已登录时应展示云端来源目录与模型详情", async () => {
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

    const { container } = renderPage();
    const text = container.textContent ?? "";

    expect(text).toContain("Demo Operator");
    expect(text).toContain("Lime Hub 主服务");
    expect(text).toContain("GPT-5.2 Pro");
    expect(text).toContain("fmt:2026-03-25T08:00:00.000Z");

    await act(async () => {
      findButton(container, "刷新云端状态").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    await act(async () => {
      findButton(container, "已是默认来源").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(handleRefresh).toHaveBeenCalledTimes(1);
    expect(handleSetDefault).toHaveBeenCalledTimes(1);
  });
});
