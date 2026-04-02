import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseModelRegistry } = vi.hoisted(() => ({
  mockUseModelRegistry: vi.fn(),
}));
const { mockGetSystemProviderCatalog, mockGetModelRegistryProviderIds } =
  vi.hoisted(() => ({
    mockGetSystemProviderCatalog: vi.fn(async () => []),
    mockGetModelRegistryProviderIds: vi.fn(async () => ["openai"]),
  }));
const { mockFetchProviderModelsAuto } = vi.hoisted(() => ({
  mockFetchProviderModelsAuto: vi.fn(),
}));

vi.mock("@/hooks/useModelRegistry", () => ({
  useModelRegistry: mockUseModelRegistry,
}));

vi.mock("@/lib/api/apiKeyProvider", () => ({
  apiKeyProviderApi: {
    getSystemProviderCatalog: mockGetSystemProviderCatalog,
  },
}));

vi.mock("@/lib/api/modelRegistry", () => ({
  fetchProviderModelsAuto: mockFetchProviderModelsAuto,
  modelRegistryApi: {
    getModelRegistryProviderIds: mockGetModelRegistryProviderIds,
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import {
  ProviderModelList,
} from "./ProviderModelList";
import { isProviderModelsCacheExpired } from "./providerModelListCache";

interface MountedRoot {
  root: Root;
  container: HTMLDivElement;
}

const mountedRoots: MountedRoot[] = [];

function renderProviderModelList(
  props: Partial<React.ComponentProps<typeof ProviderModelList>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const mergedProps: React.ComponentProps<typeof ProviderModelList> = {
    providerId: "openai",
    providerType: "openai",
    ...props,
  };

  act(() => {
    root.render(<ProviderModelList {...mergedProps} />);
  });

  mountedRoots.push({ root, container });
  return container;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  mockUseModelRegistry.mockReturnValue({
    models: [
      {
        id: "gpt-4.1",
        display_name: "GPT-4.1",
        provider_id: "openai",
        provider_name: "OpenAI",
        family: "gpt-4.1",
        tier: "pro",
        capabilities: {
          vision: true,
          tools: true,
          streaming: true,
          json_mode: true,
          function_calling: true,
          reasoning: false,
        },
        pricing: null,
        limits: {
          context_length: null,
          max_output_tokens: null,
          requests_per_minute: null,
          tokens_per_minute: null,
        },
        status: "active",
        release_date: "2026-03-01",
        is_latest: true,
        description: null,
        source: "local",
        created_at: 0,
        updated_at: 0,
      },
    ],
    loading: false,
    error: null,
  });
  mockGetSystemProviderCatalog.mockResolvedValue([]);
  mockGetModelRegistryProviderIds.mockResolvedValue(["openai"]);
  mockFetchProviderModelsAuto.mockResolvedValue({
    models: [],
    source: "Api",
    error: null,
  });
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

describe("ProviderModelList", () => {
  it("应展示思考与多模态能力标签", async () => {
    const container = renderProviderModelList({
      providerId: "openai",
      providerType: "azure-openai",
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("无思考");
    expect(container.textContent).toContain("支持多模态");
  });

  it("官方供应商即使未配置 Key 也应显式展示获取最新模型按钮", async () => {
    const container = renderProviderModelList({
      providerId: "gemini",
      providerType: "gemini",
      hasApiKey: false,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("获取最新模型"),
    );

    expect(button).not.toBeUndefined();
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("支持实时拉模型的渠道在无 Key 时不应展示 registry 旧模型", async () => {
    const container = renderProviderModelList({
      providerId: "openai",
      providerType: "openai",
      hasApiKey: false,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent ?? "").toContain("请先添加可用 API Key");
    expect(container.textContent ?? "").not.toContain("GPT-4.1");
  });

  it("Ollama 在未配置 Key 时也应允许直接获取最新模型", async () => {
    const container = renderProviderModelList({
      providerId: "ollama",
      providerType: "ollama",
      hasApiKey: false,
      apiHost: "http://localhost:11434",
    });

    await act(async () => {
      await Promise.resolve();
    });

    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("获取最新模型"),
    );

    expect(button).not.toBeUndefined();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("获取最新模型按钮应保持单行，避免被工具栏挤压换行", async () => {
    const container = renderProviderModelList({
      providerId: "deepseek",
      providerType: "openai",
      hasApiKey: true,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("获取最新模型"),
    ) as HTMLButtonElement | undefined;

    expect(button).not.toBeUndefined();
    expect(button?.className).toContain("whitespace-nowrap");
    expect(button?.className).toContain("shrink-0");
  });

  it("窄容器时工具栏应默认纵向堆叠，避免标题被压成逐字换行", async () => {
    const container = renderProviderModelList({
      providerId: "openai",
      providerType: "azure-openai",
      hasApiKey: true,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const toolbar = container.querySelector<HTMLElement>(
      '[data-testid="provider-model-list-toolbar"]',
    );
    const actions = container.querySelector<HTMLElement>(
      '[data-testid="provider-model-list-actions"]',
    );

    expect(toolbar?.className).toContain("flex-col");
    expect(toolbar?.className).toContain("2xl:flex-row");
    expect(actions?.className).toContain("w-full");
    expect(actions?.className).toContain("2xl:min-w-[360px]");
  });

  it("暂不支持自动获取的云端协议不应再展示获取最新模型按钮", async () => {
    const container = renderProviderModelList({
      providerId: "azure-openai",
      providerType: "azure-openai",
      hasApiKey: true,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("获取最新模型"),
    );

    expect(button).toBeUndefined();
    expect(container.textContent).toContain("当前不展示自动获取入口");
  });

  it("模型真相源异常时应显式展示错误，不再伪装成正常空态", async () => {
    mockGetModelRegistryProviderIds.mockRejectedValueOnce(
      new Error("未找到 models index.json"),
    );

    const container = renderProviderModelList();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("模型真相源异常");
    expect(container.textContent).toContain("未找到 models index.json");
  });

  it("Provider 模型缓存应在 TTL 后过期", () => {
    expect(isProviderModelsCacheExpired(1_000, 1_000)).toBe(false);
    expect(
      isProviderModelsCacheExpired(1_000, 1_000 + 5 * 60 * 1000 - 1),
    ).toBe(false);
    expect(
      isProviderModelsCacheExpired(1_000, 1_000 + 5 * 60 * 1000),
    ).toBe(true);
  });
});
