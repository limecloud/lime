import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearOemCloudBootstrapSnapshot,
  clearStoredOemCloudSessionState,
  setOemCloudBootstrapSnapshot,
  setStoredOemCloudSessionState,
} from "@/lib/oemCloudSession";

const apiKeyProviderMocks = vi.hoisted(() => ({
  getProviders: vi.fn(),
  updateProvider: vi.fn(),
}));

const controlPlaneMocks = vi.hoisted(() => ({
  listClientProviderOfferModels: vi.fn(),
}));

vi.mock("@/lib/api/apiKeyProvider", () => ({
  apiKeyProviderApi: {
    getProviders: apiKeyProviderMocks.getProviders,
    updateProvider: apiKeyProviderMocks.updateProvider,
  },
}));

vi.mock("@/lib/api/oemCloudControlPlane", () => ({
  listClientProviderOfferModels:
    controlPlaneMocks.listClientProviderOfferModels,
}));

vi.mock("@/lib/tauri-runtime", () => ({
  hasTauriInvokeCapability: () => true,
}));

import { useOemLimeHubProviderSync } from "./useOemLimeHubProviderSync";

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
}

function HookHarness() {
  useOemLimeHubProviderSync();
  return <div data-testid="oem-lime-hub-provider-sync" />;
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useOemLimeHubProviderSync", () => {
  let mountedHarness: MountedHarness | null = null;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    window.localStorage.clear();
    delete window.__LIME_SESSION_TOKEN__;
    delete window.__LIME_BOOTSTRAP__;
    window.__LIME_OEM_CLOUD__ = {
      enabled: true,
      baseUrl: "https://user.150404.xyz",
      gatewayBaseUrl: "https://gateway.150404.xyz/root",
      tenantId: "tenant-0001",
      hubProviderName: "Acme Hub",
    };

    apiKeyProviderMocks.getProviders.mockResolvedValue([
      {
        id: "lime-hub",
        name: "旧 Provider",
        api_host: "https://old-gateway.example.com",
        type: "anthropic",
        enabled: false,
        sort_order: 9,
        custom_models: [],
        api_keys: [],
      },
    ]);
    apiKeyProviderMocks.updateProvider.mockResolvedValue(undefined);
    controlPlaneMocks.listClientProviderOfferModels.mockResolvedValue([
      {
        id: "model-001",
        modelId: "gpt-5.2-fast",
      },
      {
        id: "model-002",
        modelId: "gpt-5.2-pro",
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    clearStoredOemCloudSessionState();
    clearOemCloudBootstrapSnapshot();
    delete window.__LIME_OEM_CLOUD__;

    if (mountedHarness) {
      act(() => {
        mountedHarness?.root.unmount();
      });
      mountedHarness.container.remove();
      mountedHarness = null;
    }
  });

  it("应把默认云端来源的模型目录同步到内部 lime-hub provider", async () => {
    setStoredOemCloudSessionState({
      token: "session-token-001",
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
    setOemCloudBootstrapSnapshot({
      providerPreference: {
        providerSource: "oem_cloud",
        providerKey: "offer-main",
        defaultModel: "gpt-5.2-pro",
      },
      providerOffersSummary: [
        {
          providerKey: "offer-main",
          defaultModel: "gpt-5.2-pro",
        },
      ],
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedHarness = { container, root };

    act(() => {
      root.render(<HookHarness />);
    });

    await flushEffects();

    expect(
      controlPlaneMocks.listClientProviderOfferModels,
    ).toHaveBeenCalledWith("tenant-0001", "offer-main");
    expect(apiKeyProviderMocks.updateProvider).toHaveBeenCalledWith(
      "lime-hub",
      {
        name: "Acme Hub",
        api_host: "https://gateway.150404.xyz/root",
        type: "openai",
        enabled: true,
        sort_order: 0,
        custom_models: ["gpt-5.2-pro", "gpt-5.2-fast"],
      },
    );
  });

  it("bootstrap 切换到本地来源后应清空内部云端模型目录", async () => {
    setStoredOemCloudSessionState({
      token: "session-token-001",
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
    setOemCloudBootstrapSnapshot({
      providerPreference: {
        providerSource: "local",
        providerKey: "openai",
      },
    });

    apiKeyProviderMocks.getProviders.mockResolvedValue([
      {
        id: "lime-hub",
        name: "Acme Hub",
        api_host: "https://gateway.150404.xyz/root",
        type: "openai",
        enabled: true,
        sort_order: 0,
        custom_models: ["stale-model"],
        api_keys: [],
      },
    ]);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedHarness = { container, root };

    act(() => {
      root.render(<HookHarness />);
    });

    await flushEffects();

    expect(
      controlPlaneMocks.listClientProviderOfferModels,
    ).not.toHaveBeenCalled();
    expect(apiKeyProviderMocks.updateProvider).toHaveBeenCalledWith(
      "lime-hub",
      {
        custom_models: [],
      },
    );
  });
});
