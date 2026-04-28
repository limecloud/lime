import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setStoredOemCloudSessionState } from "@/lib/oemCloudSession";
import { startOemCloudStartupLoginIfRequired } from "@/lib/oemCloudStartupLogin";

const { mockListPublicOAuthProviders, mockStartOemCloudLogin } = vi.hoisted(
  () => ({
    mockListPublicOAuthProviders: vi.fn(),
    mockStartOemCloudLogin: vi.fn(),
  }),
);

vi.mock("@/lib/api/oemCloudControlPlane", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/oemCloudControlPlane")>();

  return {
    ...actual,
    listPublicOAuthProviders: mockListPublicOAuthProviders,
  };
});

vi.mock("@/lib/oemCloudLoginLauncher", () => ({
  startOemCloudLogin: mockStartOemCloudLogin,
}));

function configureRuntime() {
  window.__LIME_OEM_CLOUD__ = {
    enabled: true,
    baseUrl: "https://user.limeai.run",
    tenantId: "tenant-0001",
    desktopClientId: "desktop-client",
    desktopOauthRedirectUrl: "lime://oauth/callback",
  };
}

describe("oemCloudStartupLogin", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete window.__LIME_BOOTSTRAP__;
    delete window.__LIME_OEM_CLOUD__;
    delete window.__LIME_SESSION_TOKEN__;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockListPublicOAuthProviders.mockResolvedValue([
      {
        provider: "google",
        displayName: "Google",
        enabled: true,
        scopes: ["openid", "email"],
      },
    ]);
    mockStartOemCloudLogin.mockResolvedValue({
      mode: "desktop_auth",
      openedUrl: "https://user.limeai.run/oauth/desktop/authorize",
    });
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete window.__LIME_BOOTSTRAP__;
    delete window.__LIME_OEM_CLOUD__;
    delete window.__LIME_SESSION_TOKEN__;
    vi.restoreAllMocks();
  });

  it("启动时发现品牌云端配置了 Google 登录且本地无会话，应发起登录", async () => {
    configureRuntime();

    const result = await startOemCloudStartupLoginIfRequired();

    expect(result.status).toBe("started");
    expect(mockListPublicOAuthProviders).toHaveBeenCalledWith("tenant-0001");
    expect(mockStartOemCloudLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://user.limeai.run",
        tenantId: "tenant-0001",
      }),
    );
  });

  it("同一窗口已尝试启动登录后不应重复打开浏览器", async () => {
    configureRuntime();

    await startOemCloudStartupLoginIfRequired();
    const result = await startOemCloudStartupLoginIfRequired();

    expect(result.status).toBe("already_attempted");
    expect(mockStartOemCloudLogin).toHaveBeenCalledTimes(1);
  });

  it("已有当前租户会话时不应启动登录", async () => {
    configureRuntime();
    setStoredOemCloudSessionState({
      token: "session-token",
      tenant: { id: "tenant-0001" },
      user: { id: "user-001" },
      session: { id: "session-001", provider: "google" },
    });

    const result = await startOemCloudStartupLoginIfRequired();

    expect(result.status).toBe("has_session");
    expect(mockListPublicOAuthProviders).not.toHaveBeenCalled();
    expect(mockStartOemCloudLogin).not.toHaveBeenCalled();
  });

  it("后端未下发 Google Provider 时保持开源默认使用", async () => {
    configureRuntime();
    mockListPublicOAuthProviders.mockResolvedValue([
      {
        provider: "github",
        displayName: "GitHub",
        enabled: true,
        scopes: [],
      },
    ]);

    const result = await startOemCloudStartupLoginIfRequired();

    expect(result.status).toBe("no_google_provider");
    expect(mockStartOemCloudLogin).not.toHaveBeenCalled();
  });

  it("读取后端登录策略失败时不应阻塞主应用启动", async () => {
    configureRuntime();
    mockListPublicOAuthProviders.mockRejectedValue(new Error("network down"));

    const result = await startOemCloudStartupLoginIfRequired();

    expect(result).toEqual({
      status: "failed",
      reason: "network down",
    });
    expect(mockStartOemCloudLogin).not.toHaveBeenCalled();
  });
});
