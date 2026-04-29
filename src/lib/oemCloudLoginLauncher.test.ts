import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildOemCloudLoginUrl,
  createExternalBrowserOpenTarget,
  openExternalUrl,
  startOemCloudLogin,
} from "@/lib/oemCloudLoginLauncher";
import { setStoredOemCloudSessionState } from "@/lib/oemCloudSession";

const shellOpenMock = vi.hoisted(() => vi.fn());
const controlPlaneMocks = vi.hoisted(() => ({
  createClientDesktopAuthSession: vi.fn(),
  pollClientDesktopAuthSession: vi.fn(),
}));
const tauriRuntimeMocks = vi.hoisted(() => ({
  hasTauriInvokeCapability: vi.fn(),
  hasTauriRuntimeMarkers: vi.fn(),
}));

vi.mock("@/lib/api/oemCloudControlPlane", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/oemCloudControlPlane")>();

  return {
    ...actual,
    createClientDesktopAuthSession:
      controlPlaneMocks.createClientDesktopAuthSession,
    pollClientDesktopAuthSession: controlPlaneMocks.pollClientDesktopAuthSession,
  };
});

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: shellOpenMock,
}));

vi.mock("@/lib/tauri-runtime", () => ({
  hasTauriInvokeCapability: tauriRuntimeMocks.hasTauriInvokeCapability,
  hasTauriRuntimeMarkers: tauriRuntimeMocks.hasTauriRuntimeMarkers,
}));

function createOpenedWindow() {
  return {
    closed: false,
    opener: {},
    close: vi.fn(),
    document: {
      title: "",
      body: {
        innerHTML: "",
      },
    },
    location: {
      assign: vi.fn(),
    },
  } as unknown as Window;
}

describe("oemCloudLoginLauncher", () => {
  beforeEach(() => {
    localStorage.clear();
    shellOpenMock.mockReset();
    shellOpenMock.mockResolvedValue(undefined);
    controlPlaneMocks.createClientDesktopAuthSession.mockReset();
    controlPlaneMocks.pollClientDesktopAuthSession.mockReset();
    tauriRuntimeMocks.hasTauriInvokeCapability.mockReset();
    tauriRuntimeMocks.hasTauriRuntimeMarkers.mockReset();
    tauriRuntimeMocks.hasTauriInvokeCapability.mockReturnValue(false);
    tauriRuntimeMocks.hasTauriRuntimeMarkers.mockReturnValue(false);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("Tauri 可用时应通过 shell open 打开系统浏览器", async () => {
    tauriRuntimeMocks.hasTauriInvokeCapability.mockReturnValue(true);
    tauriRuntimeMocks.hasTauriRuntimeMarkers.mockReturnValue(true);
    const browserTarget = {
      navigate: vi.fn(),
      close: vi.fn(),
    };

    await openExternalUrl("https://user.limeai.run/login", { browserTarget });

    expect(shellOpenMock).toHaveBeenCalledWith("https://user.limeai.run/login");
    expect(browserTarget.close).toHaveBeenCalledTimes(1);
    expect(browserTarget.navigate).not.toHaveBeenCalled();
  });

  it("Tauri shell open 失败时应抛错且不回退成假成功", async () => {
    tauriRuntimeMocks.hasTauriInvokeCapability.mockReturnValue(true);
    tauriRuntimeMocks.hasTauriRuntimeMarkers.mockReturnValue(true);
    shellOpenMock.mockRejectedValue(new Error("permission denied"));
    const windowOpenSpy = vi.spyOn(window, "open").mockReturnValue(null);

    await expect(
      openExternalUrl("https://user.limeai.run/login"),
    ).rejects.toThrow("系统浏览器打开失败：permission denied");

    expect(windowOpenSpy).not.toHaveBeenCalled();
  });

  it("浏览器场景应先预打开空白页，再导航到登录 URL", async () => {
    shellOpenMock.mockRejectedValue(new Error("not in tauri"));
    const openedWindow = createOpenedWindow();
    const windowOpenSpy = vi
      .spyOn(window, "open")
      .mockReturnValueOnce(openedWindow);

    const browserTarget = createExternalBrowserOpenTarget();

    expect(browserTarget).not.toBeNull();
    expect(windowOpenSpy).toHaveBeenCalledWith("about:blank", "_blank");

    await openExternalUrl("https://user.limeai.run/login", { browserTarget });

    expect(openedWindow.location.assign).toHaveBeenCalledWith(
      "https://user.limeai.run/login",
    );
    expect(windowOpenSpy).toHaveBeenCalledTimes(1);
  });

  it("浏览器弹窗被拦截时应抛出可感知错误", async () => {
    shellOpenMock.mockRejectedValue(new Error("not in tauri"));
    vi.spyOn(window, "open").mockReturnValue(null);

    await expect(
      openExternalUrl("https://user.limeai.run/login"),
    ).rejects.toThrow("可能被弹窗拦截");
  });

  it("构建云端登录页时应携带租户、桌面回跳和返回路径", () => {
    const loginUrl = buildOemCloudLoginUrl({
      baseUrl: "https://user.limeai.run",
      loginPath: "/login",
      tenantId: "tenant-0001",
      desktopOauthRedirectUrl: "lime://oauth/callback",
      desktopOauthNextPath: "/welcome",
    });

    const parsedUrl = new URL(loginUrl);

    expect(parsedUrl.origin).toBe("https://user.limeai.run");
    expect(parsedUrl.pathname).toBe("/login");
    expect(parsedUrl.searchParams.get("tenant")).toBe("tenant-0001");
    expect(parsedUrl.searchParams.get("tenantId")).toBe("tenant-0001");
    expect(parsedUrl.searchParams.get("redirectUrl")).toBe(
      "lime://oauth/callback",
    );
    expect(parsedUrl.searchParams.get("redirect")).toBe("/welcome");
    expect(parsedUrl.searchParams.get("next")).toBe("/welcome");
  });

  it("桌面 OAuth 回调返回内部租户 ID 且本地会话 slug 命中时应完成登录", async () => {
    tauriRuntimeMocks.hasTauriInvokeCapability.mockReturnValue(true);
    tauriRuntimeMocks.hasTauriRuntimeMarkers.mockReturnValue(true);
    controlPlaneMocks.createClientDesktopAuthSession.mockResolvedValue({
      authSessionId: "auth-session-001",
      deviceCode: "device-001",
      tenantId: "tenant-0514",
      clientId: "desktop-client",
      clientName: "Lime Desktop",
      provider: "google",
      desktopRedirectUri: "lime://oauth/callback",
      status: "pending_login",
      expiresInSeconds: 600,
      pollIntervalSeconds: 2,
      authorizeUrl: "https://user.limeai.run/oauth/desktop/device-001/signin",
    });
    controlPlaneMocks.pollClientDesktopAuthSession.mockReturnValue(
      new Promise(() => undefined),
    );

    const loginPromise = startOemCloudLogin({
      baseUrl: "https://user.limeai.run",
      controlPlaneBaseUrl: "https://user.limeai.run/api",
      sceneBaseUrl: "https://user.limeai.run/scene-api",
      gatewayBaseUrl: "https://llm.limeai.run",
      tenantId: "tenant-0001",
      sessionToken: null,
      hubProviderName: null,
      loginPath: "/login",
      desktopClientId: "desktop-client",
      desktopOauthRedirectUrl: "lime://oauth/callback",
      desktopOauthNextPath: "/welcome",
    });

    await vi.waitFor(() => {
      expect(shellOpenMock).toHaveBeenCalledWith(
        "https://user.limeai.run/oauth/desktop/device-001/signin",
      );
    });

    setStoredOemCloudSessionState({
      token: "session-token",
      tenant: { id: "tenant-0514", slug: "tenant-0001" },
      user: { id: "user-001" },
      session: { id: "session-001", provider: "google" },
    });
    window.dispatchEvent(
      new CustomEvent("lime:oem-cloud-oauth-completed", {
        detail: {
          tenantId: "tenant-0514",
          nextPath: "/welcome",
          provider: "google",
        },
      }),
    );

    await expect(loginPromise).resolves.toEqual({
      mode: "desktop_auth",
      openedUrl: "https://user.limeai.run/oauth/desktop/device-001/signin",
    });
  });
});
