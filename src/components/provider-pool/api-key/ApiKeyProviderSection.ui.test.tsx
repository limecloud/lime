import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderWithKeysDisplay } from "@/lib/api/apiKeyProvider";

const {
  mockUseApiKeyProvider,
  mockUseModelRegistry,
  mockGetSystemProviderCatalog,
  mockTestConnection,
} = vi.hoisted(() => ({
  mockUseApiKeyProvider: vi.fn(),
  mockUseModelRegistry: vi.fn(),
  mockGetSystemProviderCatalog: vi.fn(),
  mockTestConnection: vi.fn(),
}));

vi.mock("@/hooks/useApiKeyProvider", () => ({
  useApiKeyProvider: mockUseApiKeyProvider,
}));

vi.mock("@/hooks/useModelRegistry", () => ({
  useModelRegistry: mockUseModelRegistry,
}));

vi.mock("@/lib/api/apiKeyProvider", () => ({
  apiKeyProviderApi: {
    getSystemProviderCatalog: mockGetSystemProviderCatalog,
    testConnection: mockTestConnection,
    testChat: vi.fn(),
  },
}));

vi.mock("./ProviderSetting", () => ({
  ProviderSetting: (props: { provider: ProviderWithKeysDisplay | null }) => (
    <div data-testid="provider-setting-stub">
      {props.provider?.name ?? "未选择模型"}
    </div>
  ),
}));

vi.mock("./ImportExportDialog", () => ({
  ImportExportDialog: () => null,
}));

import { ApiKeyProviderSection } from "./ApiKeyProviderSection";

interface MountedRoot {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedRoot[] = [];

function createProvider(
  overrides: Partial<ProviderWithKeysDisplay> = {},
): ProviderWithKeysDisplay {
  return {
    id: "deepseek",
    name: "DeepSeek",
    type: "openai",
    api_host: "https://api.deepseek.com",
    is_system: true,
    group: "mainstream",
    enabled: true,
    sort_order: 1,
    api_key_count: 1,
    custom_models: ["deepseek-chat"],
    prompt_cache_mode: null,
    created_at: new Date("2026-03-15T00:00:00.000Z").toISOString(),
    updated_at: new Date("2026-03-15T00:00:00.000Z").toISOString(),
    api_keys: [
      {
        id: "key-1",
        provider_id: "deepseek",
        api_key_masked: "sk-****1234",
        enabled: true,
        usage_count: 0,
        error_count: 0,
        created_at: new Date("2026-03-15T00:00:00.000Z").toISOString(),
      },
    ],
    ...overrides,
  };
}

function createHookState(overrides: Record<string, unknown> = {}) {
  const deepseek = createProvider();
  const openai = createProvider({
    id: "openai",
    name: "OpenAI",
    enabled: false,
    sort_order: 2,
    custom_models: [],
    api_keys: [],
    api_key_count: 0,
  });
  const state = {
    providers: [deepseek, openai],
    selectedProviderId: "deepseek",
    selectedProvider: deepseek,
    loading: false,
    error: null,
    searchQuery: "",
    collapsedGroups: new Set(),
    refresh: vi.fn().mockResolvedValue(undefined),
    selectProvider: vi.fn(),
    setSearchQuery: vi.fn(),
    toggleGroup: vi.fn(),
    reorderProviders: vi.fn().mockResolvedValue(undefined),
    addCustomProvider: vi.fn().mockResolvedValue({ id: "custom-1" }),
    updateProvider: vi.fn().mockResolvedValue({ id: "custom-1" }),
    deleteCustomProvider: vi.fn().mockResolvedValue(true),
    toggleProviderEnabled: vi.fn().mockResolvedValue({ id: "deepseek" }),
    addApiKey: vi.fn().mockResolvedValue({ id: "key-new" }),
    deleteApiKey: vi.fn().mockResolvedValue(true),
    toggleApiKey: vi.fn().mockResolvedValue({ id: "key-1" }),
    updateApiKeyAlias: vi.fn().mockResolvedValue({ id: "key-1" }),
    exportConfig: vi.fn().mockResolvedValue("{}"),
    importConfig: vi.fn().mockResolvedValue({ success: true }),
    filteredProviders: [deepseek, openai],
    providersByGroup: new Map(),
    ...overrides,
  };
  mockUseApiKeyProvider.mockReturnValue(state);
  return state;
}

function renderSection() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ApiKeyProviderSection />);
  });

  mountedRoots.push({ container, root });
  return container;
}

async function flushEffects(times = 2) {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
  });
}

function findByTestId<T extends HTMLElement>(testId: string): T {
  const element = document.querySelector(`[data-testid="${testId}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`未找到 data-testid=${testId} 的节点`);
  }
  return element as T;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(input, "value")?.set;
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input),
    "value",
  )?.set;

  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(input, value);
  } else {
    input.value = value;
  }

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mockGetSystemProviderCatalog.mockResolvedValue([
    {
      id: "deepseek",
      name: "DeepSeek",
      type: "openai",
      api_host: "https://api.deepseek.com",
      group: "mainstream",
      sort_order: 1,
      legacy_ids: [],
    },
  ]);
  mockUseModelRegistry.mockReturnValue({
    groupedByProvider: new Map([
      [
        "kimi-for-coding",
        [
          {
            id: "kimi-for-coding",
            provider_name: "Kimi Coding Plan",
          },
        ],
      ],
    ]),
  });
  mockTestConnection.mockResolvedValue({ success: true, latency_ms: 12 });
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

describe("ApiKeyProviderSection 模型管理布局", () => {
  it("常态左侧只展示启用模型，不再展示旧 Provider 分组列表", async () => {
    createHookState();
    const container = renderSection();
    await flushEffects();

    expect(container.querySelector('[data-testid="provider-list"]')).toBeNull();
    expect(container.querySelector('[data-testid="enabled-model-list"]')).not.toBeNull();
    expect(container.textContent ?? "").toContain("启用的模型");
    expect(container.textContent ?? "").toContain("DeepSeek");
    expect(container.textContent ?? "").not.toContain("OpenAI");
  });

  it("点击添加模型后，右侧进入可筛选的服务商目录", async () => {
    createHookState();
    const container = renderSection();

    await act(async () => {
      findByTestId<HTMLButtonElement>("add-model-button").click();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="model-add-catalog"]')).not.toBeNull();
    expect(container.textContent ?? "").toContain("推荐服务");
    expect(container.querySelector('[data-testid="custom-provider-template-card"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="provider-setting-stub"]')).toBeNull();
  });

  it("添加流程中点击左侧已有模型，应退出目录并展开该模型配置", async () => {
    const hookState = createHookState();
    const container = renderSection();

    await act(async () => {
      findByTestId<HTMLButtonElement>("add-model-button").click();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="model-add-catalog"]')).not.toBeNull();

    await act(async () => {
      const item = container.querySelector<HTMLButtonElement>(
        '[data-testid="enabled-model-item"][data-provider-id="deepseek"]',
      );
      item?.click();
      await Promise.resolve();
    });

    expect(hookState.selectProvider).toHaveBeenCalledWith("deepseek");
    expect(container.querySelector('[data-testid="model-add-catalog"]')).toBeNull();
    expect(container.querySelector('[data-testid="provider-setting-stub"]')).not.toBeNull();
  });

  it("国内分类应展示 DeepSeek，资源模型目录里的渠道也应进入添加列表", async () => {
    createHookState();
    const container = renderSection();

    await act(async () => {
      findByTestId<HTMLButtonElement>("add-model-button").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      findByTestId<HTMLButtonElement>("model-catalog-category-cn").click();
      await Promise.resolve();
    });

    expect(container.textContent ?? "").toContain("DeepSeek");
    expect(container.textContent ?? "").toContain("Kimi Coding Plan");
    expect(container.querySelector('[data-testid="model-add-catalog"]')?.className).toContain(
      "overflow-y-auto",
    );
  });

  it("自定义供应商可在添加流程内完成创建、加 Key、写入模型并激活", async () => {
    const hookState = createHookState();
    renderSection();

    await act(async () => {
      findByTestId<HTMLButtonElement>("add-model-button").click();
      await Promise.resolve();
    });

    await act(async () => {
      findByTestId<HTMLButtonElement>("custom-provider-template-card").click();
      await Promise.resolve();
    });

    await act(async () => {
      setInputValue(findByTestId<HTMLInputElement>("model-provider-name-input"), "My API");
      setInputValue(
        findByTestId<HTMLInputElement>("model-api-host-input"),
        "https://api.example.com/v1",
      );
      setInputValue(findByTestId<HTMLInputElement>("model-api-key-input"), "sk-test");
      setInputValue(findByTestId<HTMLInputElement>("model-draft-input"), "my-model");
    });

    await act(async () => {
      findByTestId<HTMLButtonElement>("model-draft-add-button").click();
      await Promise.resolve();
    });

    await act(async () => {
      findByTestId<HTMLButtonElement>("model-activate-button").click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hookState.addCustomProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "My API",
        type: "openai",
        api_host: "https://api.example.com/v1",
      }),
    );
    expect(hookState.updateProvider).toHaveBeenCalledWith(
      "custom-1",
      expect.objectContaining({
        enabled: true,
        custom_models: ["my-model"],
      }),
    );
    expect(hookState.addApiKey).toHaveBeenCalledWith("custom-1", "sk-test", undefined);
    expect(mockTestConnection).toHaveBeenCalledWith("custom-1", "my-model");
    expect(hookState.selectProvider).toHaveBeenCalledWith("custom-1");
  });
});
