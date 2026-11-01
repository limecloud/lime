import { seedCloudAccount } from "@/test/cloudAccountFixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startOemCloudStartupLoginIfRequired } from "@/lib/oemCloudStartupLogin";

const { mockGetPublicAuthCatalog, mockStartOemCloudLogin } = vi.hoisted(() => ({
  mockGetPublicAuthCatalog: vi.fn(),
  mockStartOemCloudLogin: vi.fn(),
}));

vi.mock("@/lib/api/oemCloudControlPlane", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/oemCloudControlPlane")>();

  return {
    ...actual,
    getPublicAuthCatalog: mockGetPublicAuthCatalog,
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

    delete window.__LIME_OEM_CLOUD__;

    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockGetPublicAuthCatalog.mockReset().mockResolvedValue({
      providers: [
        {
          provider: "google",
          displayName: "Google",
          enabled: true,
          scopes: ["openid", "email"],
        },
      ],
      authPolicy: {
        required: true,
        startupTrigger: "oauth",
        primaryProvider: "google",
      },
    });
    mockStartOemCloudLogin.mockReset().mockResolvedValue({
      mode: "desktop_auth",
      openedUrl: "https://user.limeai.run/oauth/desktop/authorize",
    });
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();

    delete window.__LIME_OEM_CLOUD__;

    vi.restoreAllMocks();
  });

  it("启动时发现品牌云端配置了 Google 登录且本地无会话，只提示需要手动登录", async () => {
    configureRuntime();

    const result = await startOemCloudStartupLoginIfRequired();

    expect(result.status).toBe("manual_required");
    expect(mockGetPublicAuthCatalog).toHaveBeenCalledWith("tenant-0001");
    expect(mockStartOemCloudLogin).not.toHaveBeenCalled();
  });

  it("同一窗口重复检查也不应打开浏览器", async () => {
    configureRuntime();

    await startOemCloudStartupLoginIfRequired();
    const result = await startOemCloudStartupLoginIfRequired();

    expect(result.status).toBe("manual_required");
    expect(mockStartOemCloudLogin).not.toHaveBeenCalled();
  });

  it("已有当前租户会话时不应启动登录", async () => {
    configureRuntime();
    await seedCloudAccount({
      token: "session-token",
      tenant: { id: "tenant-0001" },
      user: { id: "user-001" },
      session: { id: "session-001", provider: "google" },
    });

    const result = await startOemCloudStartupLoginIfRequired();

    expect(result.status).toBe("has_session");
    expect(mockGetPublicAuthCatalog).not.toHaveBeenCalled();
    expect(mockStartOemCloudLogin).not.toHaveBeenCalled();
  });

  it("后端返回内部租户 ID 但 slug 命中运行时租户时不应重复登录", async () => {
    configureRuntime();
    await seedCloudAccount({
      token: "session-token",
      tenant: { id: "tenant-0514", slug: "tenant-0001" },
      user: { id: "user-001" },
      session: { id: "session-001", provider: "google" },
    });

    const result = await startOemCloudStartupLoginIfRequired();

    expect(result.status).toBe("has_session");
    expect(mockGetPublicAuthCatalog).not.toHaveBeenCalled();
    expect(mockStartOemCloudLogin).not.toHaveBeenCalled();
  });

  it("后端未下发 Google Provider 时保持开源默认使用", async () => {
    configureRuntime();
    mockGetPublicAuthCatalog.mockResolvedValue({
      providers: [
        {
          provider: "github",
          displayName: "GitHub",
          enabled: true,
          scopes: [],
        },
      ],
      authPolicy: {
        required: true,
        startupTrigger: "oauth",
        primaryProvider: "google",
      },
    });

    const result = await startOemCloudStartupLoginIfRequired();

    expect(result.status).toBe("no_google_provider");
    expect(mockStartOemCloudLogin).not.toHaveBeenCalled();
  });

  it("读取后端登录策略失败时不应阻塞主应用启动", async () => {
    configureRuntime();
    mockGetPublicAuthCatalog.mockRejectedValue(new Error("network down"));

    const result = await startOemCloudStartupLoginIfRequired();

    expect(result).toEqual({
      status: "failed",
      reason: "network down",
    });
    expect(mockStartOemCloudLogin).not.toHaveBeenCalled();
  });

  it("后端未要求启动登录时应保持开源默认使用", async () => {
    configureRuntime();
    mockGetPublicAuthCatalog.mockResolvedValue({
      providers: [
        {
          provider: "google",
          displayName: "Google",
          enabled: true,
          scopes: ["openid", "email"],
        },
      ],
      authPolicy: {
        required: false,
        startupTrigger: "none",
      },
    });

    const result = await startOemCloudStartupLoginIfRequired();

    expect(result.status).toBe("not_required");
    expect(mockStartOemCloudLogin).not.toHaveBeenCalled();
  });

  it("后端要求的启动策略不是 Google OAuth 时不应猜测兜底", async () => {
    configureRuntime();
    mockGetPublicAuthCatalog.mockResolvedValue({
      providers: [
        {
          provider: "github",
          displayName: "GitHub",
          enabled: true,
          scopes: [],
        },
      ],
      authPolicy: {
        required: true,
        startupTrigger: "oauth",
        primaryProvider: "github",
      },
    });

    const result = await startOemCloudStartupLoginIfRequired();

    expect(result.status).toBe("unsupported_policy");
    expect(mockStartOemCloudLogin).not.toHaveBeenCalled();
  });
});
