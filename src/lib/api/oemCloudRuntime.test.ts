import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStoredOemCloudSessionState } from "@/lib/oemCloudSession";
import { resolveOemCloudRuntimeContext } from "./oemCloudRuntime";

describe("oemCloudRuntime", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.__LIME_BOOTSTRAP__;
    delete window.__LIME_OEM_CLOUD__;
    delete window.__LIME_SESSION_TOKEN__;
  });

  afterEach(() => {
    window.localStorage.clear();
    delete window.__LIME_BOOTSTRAP__;
    delete window.__LIME_OEM_CLOUD__;
    delete window.__LIME_SESSION_TOKEN__;
  });

  it("应优先从运行时配置解析基础地址与 Lime Hub 元信息", () => {
    window.__LIME_OEM_CLOUD__ = {
      enabled: true,
      baseUrl: "https://user.150404.xyz/",
      gatewayBaseUrl: "https://gateway.150404.xyz/root/",
      tenantId: "tenant-0001",
      hubProviderName: "Acme Hub",
      sessionToken: "runtime-session-token",
      loginPath: "/login",
      desktopClientId: "limehub-desktop",
      desktopOauthRedirectUrl: "lime://oauth/callback",
      desktopOauthNextPath: "/welcome",
    };

    expect(resolveOemCloudRuntimeContext()).toEqual({
      baseUrl: "https://user.150404.xyz",
      controlPlaneBaseUrl: "https://user.150404.xyz/api",
      sceneBaseUrl: "https://user.150404.xyz/scene-api",
      gatewayBaseUrl: "https://gateway.150404.xyz/root",
      tenantId: "tenant-0001",
      sessionToken: "runtime-session-token",
      hubProviderName: "Acme Hub",
      loginPath: "/login",
      desktopClientId: "limehub-desktop",
      desktopOauthRedirectUrl: "lime://oauth/callback",
      desktopOauthNextPath: "/welcome",
    });
  });

  it("未显式提供 gatewayBaseUrl 时应回退到 baseUrl/gateway-api", () => {
    window.__LIME_OEM_CLOUD__ = {
      enabled: true,
      baseUrl: "https://user.150404.xyz",
      tenantId: "tenant-0001",
    };

    expect(resolveOemCloudRuntimeContext()).toMatchObject({
      baseUrl: "https://user.150404.xyz",
      gatewayBaseUrl: "https://user.150404.xyz/gateway-api",
      tenantId: "tenant-0001",
      hubProviderName: null,
      loginPath: "/login",
      desktopClientId: "desktop-client",
      desktopOauthRedirectUrl: "lime://oauth/callback",
      desktopOauthNextPath: "/welcome",
    });
  });

  it("运行时缺租户时应回退复用本地持久化会话", () => {
    setStoredOemCloudSessionState({
      token: "persisted-session-token",
      tenant: {
        id: "tenant-from-storage",
      },
      user: {
        id: "user-001",
      },
      session: {
        id: "session-001",
      },
    });

    window.__LIME_OEM_CLOUD__ = {
      enabled: true,
      baseUrl: "https://user.150404.xyz",
    };

    expect(resolveOemCloudRuntimeContext()).toMatchObject({
      baseUrl: "https://user.150404.xyz",
      gatewayBaseUrl: "https://user.150404.xyz/gateway-api",
      tenantId: "tenant-from-storage",
      sessionToken: "persisted-session-token",
      loginPath: "/login",
      desktopClientId: "desktop-client",
      desktopOauthRedirectUrl: "lime://oauth/callback",
      desktopOauthNextPath: "/welcome",
    });
  });
});
