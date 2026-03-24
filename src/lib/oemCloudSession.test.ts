import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyStoredOemCloudSessionToWindow,
  clearStoredOemCloudSessionState,
  getStoredOemCloudAccessToken,
  getStoredOemCloudSessionState,
  setStoredOemCloudSessionState,
} from "./oemCloudSession";

describe("oemCloudSession", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.__LIME_SESSION_TOKEN__;
    delete window.__LIME_BOOTSTRAP__;
    delete window.__LIME_OEM_CLOUD__;
  });

  afterEach(() => {
    window.localStorage.clear();
    delete window.__LIME_SESSION_TOKEN__;
    delete window.__LIME_BOOTSTRAP__;
    delete window.__LIME_OEM_CLOUD__;
  });

  it("应持久化 session 并同步到 window 全局", () => {
    const saved = setStoredOemCloudSessionState({
      token: "Bearer session-token-demo",
      tenant: {
        id: "tenant-0001",
        name: "JustAI Demo",
        slug: "justai-demo",
      },
      user: {
        id: "user-001",
        email: "operator@example.com",
        displayName: "Demo Operator",
        roles: ["customer"],
      },
      session: {
        id: "session-001",
        tenantId: "tenant-0001",
        userId: "user-001",
        provider: "password",
        roles: ["customer"],
        issuedAt: "2026-03-24T08:00:00.000Z",
        expiresAt: "2026-03-25T08:00:00.000Z",
      },
    });

    expect(saved.token).toBe("session-token-demo");
    expect(getStoredOemCloudAccessToken()).toBe("session-token-demo");
    expect(getStoredOemCloudSessionState()?.session.user.displayName).toBe(
      "Demo Operator",
    );
    expect(window.__LIME_SESSION_TOKEN__).toBe("session-token-demo");
    expect(window.__LIME_OEM_CLOUD__).toMatchObject({
      tenantId: "tenant-0001",
    });
  });

  it("应支持从 localStorage 重新恢复到 window 全局", () => {
    setStoredOemCloudSessionState({
      token: "session-token-restore",
      tenant: {
        id: "tenant-restore",
      },
      user: {
        id: "user-restore",
      },
      session: {
        id: "session-restore",
      },
    });

    delete window.__LIME_SESSION_TOKEN__;
    delete window.__LIME_OEM_CLOUD__;

    const restored = applyStoredOemCloudSessionToWindow();
    expect(restored?.token).toBe("session-token-restore");
    expect(window.__LIME_SESSION_TOKEN__).toBe("session-token-restore");
    expect(window.__LIME_OEM_CLOUD__).toMatchObject({
      tenantId: "tenant-restore",
    });
  });

  it("清理后应移除本地和全局会话", () => {
    setStoredOemCloudSessionState({
      token: "session-token-clear",
      tenant: {
        id: "tenant-clear",
      },
      user: {
        id: "user-clear",
      },
      session: {
        id: "session-clear",
      },
    });

    clearStoredOemCloudSessionState();

    expect(getStoredOemCloudAccessToken()).toBeNull();
    expect(getStoredOemCloudSessionState()).toBeNull();
    expect(window.__LIME_SESSION_TOKEN__).toBeUndefined();
  });
});
