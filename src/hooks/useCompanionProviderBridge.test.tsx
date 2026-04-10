import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCompanionProviderBridge } from "./useCompanionProviderBridge";
import {
  COMPANION_OPEN_PROVIDER_SETTINGS_EVENT,
  COMPANION_REQUEST_PROVIDER_SYNC_EVENT,
  type CompanionPetStatus,
  getCompanionPetStatus,
  listenCompanionPetStatus,
  sendCompanionPetCommand,
} from "@/lib/api/companion";
import { safeListen } from "@/lib/dev-bridge";
import { apiKeyProviderApi } from "@/lib/api/apiKeyProvider";
import { providerPoolApi } from "@/lib/api/providerPool";
import { subscribeProviderDataChanged } from "@/lib/providerDataEvents";
import { hasTauriInvokeCapability } from "@/lib/tauri-runtime";
import { SettingsTabs } from "@/types/settings";

vi.mock("@/lib/api/companion", () => ({
  COMPANION_OPEN_PROVIDER_SETTINGS_EVENT: "companion-open-provider-settings",
  COMPANION_REQUEST_PROVIDER_SYNC_EVENT: "companion-request-provider-sync",
  COMPANION_PROVIDER_OVERVIEW_CAPABILITY: "provider-overview",
  getCompanionPetStatus: vi.fn(),
  listenCompanionPetStatus: vi.fn(),
  sendCompanionPetCommand: vi.fn(),
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeListen: vi.fn(),
}));

vi.mock("@/lib/api/apiKeyProvider", () => ({
  apiKeyProviderApi: {
    getProviders: vi.fn(),
  },
}));

vi.mock("@/lib/api/providerPool", () => ({
  providerPoolApi: {
    getOverview: vi.fn(),
  },
}));

vi.mock("@/lib/providerDataEvents", () => ({
  subscribeProviderDataChanged: vi.fn(),
}));

vi.mock("@/lib/tauri-runtime", () => ({
  hasTauriInvokeCapability: vi.fn(() => true),
}));

type HookProps = Parameters<typeof useCompanionProviderBridge>[0];

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function createConnectedStatus(
  overrides: Partial<CompanionPetStatus> = {},
): CompanionPetStatus {
  return {
    endpoint: "ws://127.0.0.1:45554/companion/pet",
    server_listening: true,
    connected: true,
    client_id: "lime",
    platform: "macos",
    capabilities: ["provider-overview"],
    last_event: "pet.ready",
    last_error: null,
    last_state: "walking",
    ...overrides,
  };
}

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function Probe(currentProps: HookProps) {
    useCompanionProviderBridge(currentProps);
    return null;
  }

  const defaultProps: HookProps = {
    onNavigate: vi.fn(),
  };

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<Probe {...defaultProps} {...props} {...nextProps} />);
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  mountedRoots.push({ root, container });

  return {
    render,
    defaultProps: {
      ...defaultProps,
      ...props,
    },
  };
}

describe("useCompanionProviderBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    vi.mocked(getCompanionPetStatus).mockResolvedValue(createConnectedStatus());
    vi.mocked(listenCompanionPetStatus).mockResolvedValue(vi.fn());
    vi.mocked(sendCompanionPetCommand).mockResolvedValue({
      delivered: true,
      connected: true,
    });
    vi.mocked(providerPoolApi.getOverview).mockResolvedValue([
      {
        provider_type: "openai",
        stats: {
          total: 1,
          healthy: 1,
          unhealthy: 0,
          disabled: 0,
          total_usage: 3,
          total_errors: 0,
        },
        credentials: [],
      },
    ]);
    vi.mocked(apiKeyProviderApi.getProviders).mockResolvedValue([]);
    vi.mocked(subscribeProviderDataChanged).mockReturnValue(vi.fn());
    vi.mocked(safeListen).mockResolvedValue(vi.fn());
    vi.mocked(hasTauriInvokeCapability).mockReturnValue(true);
  });

  afterEach(() => {
    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop();
      if (!mounted) {
        break;
      }
      act(() => {
        mounted.root.unmount();
      });
      mounted.container.remove();
    }

    vi.clearAllMocks();
  });

  it("桌宠已连接且支持 provider 概览时，应下发脱敏摘要", async () => {
    const { render } = renderHook();

    await render();

    expect(sendCompanionPetCommand).toHaveBeenCalledWith({
      event: "pet.provider_overview",
      payload: {
        providers: [
          {
            provider_type: "openai",
            display_name: "OpenAI",
            total_count: 1,
            healthy_count: 1,
            available: true,
            needs_attention: false,
          },
        ],
        total_provider_count: 1,
        available_provider_count: 1,
        needs_attention_provider_count: 0,
      },
    });
  });

  it("浏览器开发模式下不应注册桌宠事件桥", async () => {
    vi.mocked(hasTauriInvokeCapability).mockReturnValue(false);

    const { render } = renderHook();
    await render();

    expect(getCompanionPetStatus).not.toHaveBeenCalled();
    expect(listenCompanionPetStatus).not.toHaveBeenCalled();
    expect(safeListen).not.toHaveBeenCalled();
    expect(subscribeProviderDataChanged).not.toHaveBeenCalled();
  });

  it("收到打开服务商设置事件时，应导航到 Providers 标签页", async () => {
    const onNavigate = vi.fn();
    let openSettingsHandler: (() => void) | null = null;

    vi.mocked(safeListen).mockImplementation(async (event, handler) => {
      if (event === COMPANION_OPEN_PROVIDER_SETTINGS_EVENT) {
        openSettingsHandler = handler as () => void;
      }
      return vi.fn();
    });

    const { render } = renderHook({ onNavigate });
    await render();

    await act(async () => {
      openSettingsHandler?.();
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledWith("settings", {
      tab: SettingsTabs.Providers,
    });
  });

  it("收到桌宠摘要同步请求事件时，应强制重发脱敏摘要", async () => {
    let requestProviderSyncHandler: (() => void) | null = null;

    vi.mocked(safeListen).mockImplementation(async (event, handler) => {
      if (event === COMPANION_REQUEST_PROVIDER_SYNC_EVENT) {
        requestProviderSyncHandler = handler as () => void;
      }
      return vi.fn();
    });

    const { render } = renderHook();
    await render();

    vi.mocked(sendCompanionPetCommand).mockClear();
    vi.mocked(providerPoolApi.getOverview).mockClear();
    vi.mocked(apiKeyProviderApi.getProviders).mockClear();

    await act(async () => {
      requestProviderSyncHandler?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(providerPoolApi.getOverview).toHaveBeenCalledWith({
      forceRefresh: true,
    });
    expect(apiKeyProviderApi.getProviders).toHaveBeenCalledWith({
      forceRefresh: true,
    });
    expect(sendCompanionPetCommand).toHaveBeenCalledWith({
      event: "pet.provider_overview",
      payload: {
        providers: [
          {
            provider_type: "openai",
            display_name: "OpenAI",
            total_count: 1,
            healthy_count: 1,
            available: true,
            needs_attention: false,
          },
        ],
        total_provider_count: 1,
        available_provider_count: 1,
        needs_attention_provider_count: 0,
      },
    });
  });

  it("应把 API Key Provider 一并整理进桌宠摘要", async () => {
    vi.mocked(apiKeyProviderApi.getProviders).mockResolvedValue([
      {
        id: "deepseek",
        name: "DeepSeek",
        type: "openai",
        api_host: "https://api.deepseek.com/v1",
        is_system: false,
        group: "cloud",
        enabled: true,
        sort_order: 10,
        custom_models: [],
        api_key_count: 1,
        api_keys: [
          {
            id: "deepseek-key-1",
            provider_id: "deepseek",
            api_key_masked: "sk-***1234",
            enabled: true,
            usage_count: 0,
            error_count: 0,
            created_at: "2026-04-01T00:00:00Z",
          },
        ],
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
      },
    ]);

    const { render } = renderHook();
    await render();

    expect(sendCompanionPetCommand).toHaveBeenCalledWith({
      event: "pet.provider_overview",
      payload: {
        providers: [
          {
            provider_type: "deepseek",
            display_name: "DeepSeek",
            total_count: 1,
            healthy_count: 1,
            available: true,
            needs_attention: false,
          },
          {
            provider_type: "openai",
            display_name: "OpenAI",
            total_count: 1,
            healthy_count: 1,
            available: true,
            needs_attention: false,
          },
        ],
        total_provider_count: 2,
        available_provider_count: 2,
        needs_attention_provider_count: 0,
      },
    });
  });

  it("桌宠未声明 provider 能力时，不应下发摘要", async () => {
    vi.mocked(getCompanionPetStatus).mockResolvedValue(
      createConnectedStatus({
        capabilities: [],
      }),
    );

    const { render } = renderHook();
    await render();

    expect(sendCompanionPetCommand).not.toHaveBeenCalled();
  });
});
