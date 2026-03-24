import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setStoredOemCloudSessionState } from "@/lib/oemCloudSession";

const controlPlaneMocks = vi.hoisted(() => ({
  getClientBootstrap: vi.fn(),
  listClientProviderOffers: vi.fn(),
  getClientProviderPreference: vi.fn(),
  getClientProviderOffer: vi.fn(),
  listClientProviderOfferModels: vi.fn(),
  updateClientProviderPreference: vi.fn(),
  createClientDesktopAuthSession: vi.fn(),
  pollClientDesktopAuthSession: vi.fn(),
  loginClientByPassword: vi.fn(),
  logoutClient: vi.fn(),
  sendClientAuthEmailCode: vi.fn(),
  verifyClientAuthEmailCode: vi.fn(),
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
    listClientProviderOffers: controlPlaneMocks.listClientProviderOffers,
    getClientProviderPreference: controlPlaneMocks.getClientProviderPreference,
    getClientProviderOffer: controlPlaneMocks.getClientProviderOffer,
    listClientProviderOfferModels:
      controlPlaneMocks.listClientProviderOfferModels,
    updateClientProviderPreference:
      controlPlaneMocks.updateClientProviderPreference,
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

vi.mock("@/lib/oemCloudDesktopAuth", () => ({
  OEM_CLOUD_OAUTH_COMPLETED_EVENT: "lime:oem-cloud-oauth-completed",
  completeOemCloudDesktopOAuthLogin: vi.fn(),
}));

vi.mock("@/lib/serviceSkillCatalogBootstrap", () => ({
  syncServiceSkillCatalogFromBootstrapPayload: vi.fn(),
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
      baseUrl: "https://user.150404.xyz",
      tenantId: "tenant-0001",
    };

    controlPlaneMocks.listClientProviderOffers.mockResolvedValue([]);
    controlPlaneMocks.getClientProviderPreference.mockResolvedValue(null);
    controlPlaneMocks.getClientProviderOffer.mockResolvedValue(null);
    controlPlaneMocks.listClientProviderOfferModels.mockResolvedValue([]);
    controlPlaneMocks.updateClientProviderPreference.mockResolvedValue(null);
    controlPlaneMocks.createClientDesktopAuthSession.mockResolvedValue(null);
    controlPlaneMocks.pollClientDesktopAuthSession.mockResolvedValue(null);
    controlPlaneMocks.loginClientByPassword.mockResolvedValue(null);
    controlPlaneMocks.logoutClient.mockResolvedValue(undefined);
    controlPlaneMocks.sendClientAuthEmailCode.mockResolvedValue(null);
    controlPlaneMocks.verifyClientAuthEmailCode.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
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
});
