import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseOemCloudAccess, mockFormatOemCloudDateTime } = vi.hoisted(() => ({
  mockUseOemCloudAccess: vi.fn(),
  mockFormatOemCloudDateTime: vi.fn((value?: string) => `fmt:${value ?? ""}`),
}));

vi.mock("@/hooks/useOemCloudAccess", () => ({
  useOemCloudAccess: () => mockUseOemCloudAccess(),
  formatOemCloudDateTime: (value?: string) =>
    mockFormatOemCloudDateTime(value),
}));

import { UserCenterSessionSettings } from ".";

interface MountedPage {
  container: HTMLDivElement;
  root: Root;
}

const mounted: MountedPage[] = [];

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
    loginMode: "password",
    setLoginMode: vi.fn(),
    passwordForm: {
      identifier: "",
      password: "",
    },
    setPasswordForm: vi.fn(),
    emailCodeForm: {
      identifier: "",
      code: "",
      displayName: "",
      username: "",
    },
    setEmailCodeForm: vi.fn(),
    codeDelivery: null,
    session: null,
    bootstrap: null,
    initializing: false,
    refreshing: false,
    sendingCode: false,
    loggingIn: false,
    loggingOut: false,
    openingGoogleLogin: false,
    errorMessage: null,
    infoMessage: null,
    defaultProviderSummary: null,
    handleRefresh: vi.fn(),
    handleSendEmailCode: vi.fn(),
    handleEmailCodeLogin: vi.fn(),
    handlePasswordLogin: vi.fn(),
    handleGoogleLogin: vi.fn(),
    handleLogout: vi.fn(),
    openUserCenter: vi.fn(),
    ...overrides,
  };
}

function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<UserCenterSessionSettings />);
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

describe("UserCenterSessionSettings", () => {
  it("未登录时应展示个人中心登录面板", () => {
    const { container } = renderPage();
    const text = container.textContent ?? "";

    expect(text).toContain("个人中心会话");
    expect(text).toContain("使用 Google 一键登录");
    expect(text).toContain("登录后自动完成");
  });

  it("点击 Google 一键登录时应调用 hook 的 handleGoogleLogin", async () => {
    const handleGoogleLogin = vi.fn();
    mockUseOemCloudAccess.mockReturnValue(
      createAccessState({
        handleGoogleLogin,
      }),
    );

    const { container } = renderPage();

    await act(async () => {
      findButton(container, "使用 Google 一键登录").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(handleGoogleLogin).toHaveBeenCalledTimes(1);
  });

  it("展开备用登录方式后点击验证码模式切换时应调用 hook 的 setLoginMode", async () => {
    const setLoginMode = vi.fn();
    mockUseOemCloudAccess.mockReturnValue(
      createAccessState({
        setLoginMode,
      }),
    );

    const { container } = renderPage();

    await act(async () => {
      findButton(container, "使用邮箱验证码 / 账号密码").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    await act(async () => {
      findButton(container, "邮箱验证码").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(setLoginMode).toHaveBeenCalledWith("email_code");
  });

  it("已登录时应展示会话摘要并允许退出", async () => {
    const handleLogout = vi.fn();
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
        bootstrap: {
          serviceSkillCatalog: {
            items: [{ id: "skill-001" }, { id: "skill-002" }],
          },
          sceneCatalog: [{ id: "scene-001" }],
          gateway: {
            basePath: "/gateway-api",
          },
        },
        defaultProviderSummary: "Lime Hub 主服务 · gpt-5.2-pro",
        handleLogout,
      }),
    );

    const { container } = renderPage();
    const text = container.textContent ?? "";

    expect(text).toContain("Demo Operator");
    expect(text).toContain("fmt:2026-03-25T08:00:00.000Z");
    expect(text).toContain("2 项");
    expect(text).toContain("Lime Hub 主服务 · gpt-5.2-pro");

    await act(async () => {
      findButton(container, "退出登录").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(handleLogout).toHaveBeenCalledTimes(1);
  });
});
