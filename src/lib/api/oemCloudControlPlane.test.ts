import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createClientDesktopAuthSession,
  getClientProviderOffer,
  listClientProviderOffers,
  pollClientDesktopAuthSession,
} from "./oemCloudControlPlane";

describe("oemCloudControlPlane desktop auth", () => {
  beforeEach(() => {
    delete window.__LIME_BOOTSTRAP__;
    delete window.__LIME_SESSION_TOKEN__;
    window.__LIME_OEM_CLOUD__ = {
      enabled: true,
      baseUrl: "https://user.150404.xyz",
      tenantId: "tenant-0001",
    };
  });

  afterEach(() => {
    delete window.__LIME_BOOTSTRAP__;
    delete window.__LIME_OEM_CLOUD__;
    delete window.__LIME_SESSION_TOKEN__;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("应创建桌面授权会话并返回浏览器授权地址", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        code: 201,
        message: "success",
        data: {
          authSessionId: "desktop-auth-0001",
          deviceCode: "device-code-001",
          tenantId: "tenant-0001",
          clientId: "desktop-client",
          clientName: "Desktop Client",
          provider: "google",
          desktopRedirectUri: "lime://oauth/callback",
          status: "pending_login",
          expiresInSeconds: 600,
          pollIntervalSeconds: 2,
          authorizeUrl:
            "https://user.150404.xyz/oauth/desktop/device-code-001/authorize?provider=google",
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createClientDesktopAuthSession("tenant-0001", {
      clientId: "desktop-client",
      provider: "google",
      desktopRedirectUri: "lime://oauth/callback",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://user.150404.xyz/api/v1/public/tenants/tenant-0001/desktop/auth-sessions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Accept: "application/json",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          clientId: "desktop-client",
          provider: "google",
          desktopRedirectUri: "lime://oauth/callback",
        }),
      }),
    );
    expect(result).toEqual({
      authSessionId: "desktop-auth-0001",
      deviceCode: "device-code-001",
      tenantId: "tenant-0001",
      clientId: "desktop-client",
      clientName: "Desktop Client",
      provider: "google",
      desktopRedirectUri: "lime://oauth/callback",
      status: "pending_login",
      expiresInSeconds: 600,
      pollIntervalSeconds: 2,
      authorizeUrl:
        "https://user.150404.xyz/oauth/desktop/device-code-001/authorize?provider=google",
    });
  });

  it("应轮询桌面授权结果并解析 session token", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 200,
        message: "success",
        data: {
          deviceCode: "device-code-001",
          tenantId: "tenant-0001",
          clientId: "desktop-client",
          clientName: "Desktop Client",
          provider: "google",
          status: "approved",
          expiresInSeconds: 388,
          pollIntervalSeconds: 2,
          sessionToken: "session-token-001",
          sessionExpiresAt: "2026-03-24T16:00:00.000Z",
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await pollClientDesktopAuthSession("device-code-001");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://user.150404.xyz/api/v1/public/desktop/auth-sessions/device-code-001/poll",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Accept: "application/json",
        }),
      }),
    );
    expect(result).toEqual({
      deviceCode: "device-code-001",
      tenantId: "tenant-0001",
      clientId: "desktop-client",
      clientName: "Desktop Client",
      provider: "google",
      desktopRedirectUri: undefined,
      status: "approved",
      expiresInSeconds: 388,
      pollIntervalSeconds: 2,
      sessionToken: "session-token-001",
      sessionExpiresAt: "2026-03-24T16:00:00.000Z",
    });
  });

  it("应解析服务端下发的云端治理字段", async () => {
    window.__LIME_SESSION_TOKEN__ = "session-token-001";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: 200,
          message: "success",
          data: {
            items: [
              {
                providerKey: "lime-hub-main",
                displayName: "Lime Hub 主服务",
                source: "oem_cloud",
                state: "available_ready",
                visible: true,
                loggedIn: true,
                accountStatus: "logged_in",
                subscriptionStatus: "active",
                quotaStatus: "ok",
                canInvoke: true,
                defaultModel: "gpt-5.2-pro",
                effectiveAccessMode: "session",
                apiKeyModeEnabled: false,
                tenantOverrideApplied: true,
                configMode: "managed",
                modelsSource: "hub_catalog",
                developerAccessVisible: false,
                availableModelCount: 18,
                fallbackToLocalAllowed: true,
              },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: 200,
          message: "success",
          data: {
            providerKey: "lime-hub-main",
            displayName: "Lime Hub 主服务",
            source: "oem_cloud",
            state: "available_ready",
            visible: true,
            loggedIn: true,
            accountStatus: "logged_in",
            subscriptionStatus: "active",
            quotaStatus: "ok",
            canInvoke: true,
            defaultModel: "gpt-5.2-pro",
            effectiveAccessMode: "session",
            apiKeyModeEnabled: true,
            tenantOverrideApplied: false,
            configMode: "hybrid",
            modelsSource: "manual",
            developerAccessVisible: true,
            availableModelCount: 6,
            fallbackToLocalAllowed: true,
            access: {
              offerId: "offer-001",
              accessMode: "api_key",
              hubTokenEnabled: true,
              hubTokenRef: "hub-token-ref",
            },
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const [offers, detail] = await Promise.all([
      listClientProviderOffers("tenant-0001"),
      getClientProviderOffer("tenant-0001", "lime-hub-main"),
    ]);

    expect(offers[0]).toMatchObject({
      effectiveAccessMode: "session",
      apiKeyModeEnabled: false,
      tenantOverrideApplied: true,
      configMode: "managed",
      modelsSource: "hub_catalog",
      developerAccessVisible: false,
    });
    expect(detail).toMatchObject({
      effectiveAccessMode: "session",
      apiKeyModeEnabled: true,
      configMode: "hybrid",
      modelsSource: "manual",
      developerAccessVisible: true,
      access: {
        offerId: "offer-001",
        accessMode: "api_key",
        hubTokenEnabled: true,
        hubTokenRef: "hub-token-ref",
      },
    });
  });
});
