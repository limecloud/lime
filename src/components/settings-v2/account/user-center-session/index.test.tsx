import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseOemCloudAccess, mockFormatOemCloudDateTime } = vi.hoisted(
  () => ({
    mockUseOemCloudAccess: vi.fn(),
    mockFormatOemCloudDateTime: vi.fn((value?: string) => `fmt:${value ?? ""}`),
  }),
);

vi.mock("@/hooks/useOemCloudAccess", () => ({
  useOemCloudAccess: () => mockUseOemCloudAccess(),
  formatOemCloudDateTime: (value?: string) => mockFormatOemCloudDateTime(value),
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

    expect(text).toContain("账户资料");
    expect(text).toContain("使用 Google 一键登录");
    expect(text).toContain("登录后会自动完成");
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
    const openUserCenter = vi.fn();
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
          features: {
            profileEditable: true,
          },
          gateway: {
            basePath: "/gateway-api",
          },
        },
        defaultProviderSummary: "Lime Hub 主服务 · gpt-5.2-pro",
        handleLogout,
        openUserCenter,
      }),
    );

    const { container } = renderPage();
    const text = container.textContent ?? "";

    expect(text).toContain("Demo Operator");
    expect(text).toContain("fmt:2026-03-25T08:00:00.000Z");
    expect(text).toContain("2 项技能 / 1 个入口");
    expect(text).toContain("Lime Hub 主服务 · gpt-5.2-pro");
    expect(text).toContain("资料维护已统一到账号中心");
    expect(text).toContain("前往账号中心修改资料");
    expect(text).not.toContain("会话说明");

    await act(async () => {
      findButton(container, "前往账号中心修改资料").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(openUserCenter).toHaveBeenCalledWith("");

    await act(async () => {
      findButton(container, "退出当前账号").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(handleLogout).toHaveBeenCalledTimes(1);
  });

  it("应把账户总览和登录结果说明收进 tips", async () => {
    renderPage();

    expect(getBodyText()).not.toContain(
      "昵称、头像、邮箱等资料统一由账号中心维护。本地只同步展示当前账户状态与默认服务配置，避免在多个入口重复编辑后出现不一致。",
    );

    const accountTip = await hoverTip("账户资料说明");
    expect(getBodyText()).toContain(
      "昵称、头像、邮箱等资料统一由账号中心维护。本地只同步展示当前账户状态与默认服务配置，避免在多个入口重复编辑后出现不一致。",
    );
    await leaveTip(accountTip);

    const loginTip = await hoverTip("登录后自动完成说明");
    expect(getBodyText()).toContain("同步默认 AI 服务、模型目录与已开通能力。");
    await leaveTip(loginTip);
  });
});
