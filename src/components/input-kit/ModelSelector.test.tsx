import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUseConfiguredProviders,
  mockUseProviderModels,
  mockFilterModelsByTheme,
} = vi.hoisted(() => ({
  mockUseConfiguredProviders: vi.fn(),
  mockUseProviderModels: vi.fn(),
  mockFilterModelsByTheme: vi.fn(),
}));

vi.mock("@/hooks/useConfiguredProviders", () => ({
  useConfiguredProviders: (...args: unknown[]) =>
    mockUseConfiguredProviders(...args),
  findConfiguredProviderBySelection: (
    providers: Array<{ key: string; providerId?: string }>,
    selection?: string | null,
  ) => {
    const normalizedSelection = (selection || "").trim().toLowerCase();
    const keyMatch =
      providers.find(
        (provider) => provider.key.trim().toLowerCase() === normalizedSelection,
      ) ?? null;
    const providerIdMatch =
      providers.find(
        (provider) =>
          (provider.providerId || "").trim().toLowerCase() ===
          normalizedSelection,
      ) ?? null;

    if (keyMatch && providerIdMatch && keyMatch !== providerIdMatch) {
      if (!keyMatch.providerId && providerIdMatch.providerId) {
        return providerIdMatch;
      }
    }

    return keyMatch ?? providerIdMatch ?? null;
  },
}));

vi.mock("@/hooks/useProviderModels", () => ({
  useProviderModels: (...args: unknown[]) => mockUseProviderModels(...args),
}));

vi.mock("@/components/agent/chat/utils/modelThemePolicy", () => ({
  filterModelsByTheme: (...args: unknown[]) => mockFilterModelsByTheme(...args),
}));

import { ModelSelector } from "./ModelSelector";

interface MountedRoot {
  root: Root;
  container: HTMLDivElement;
}

const mountedRoots: MountedRoot[] = [];

function renderModelSelector(
  props: Partial<React.ComponentProps<typeof ModelSelector>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const mergedProps: React.ComponentProps<typeof ModelSelector> = {
    providerType: "custom-codex",
    setProviderType: vi.fn(),
    model: "gpt-5.3-codex",
    setModel: vi.fn(),
    activeTheme: "general",
    ...props,
  };

  act(() => {
    root.render(<ModelSelector {...mergedProps} />);
  });

  mountedRoots.push({ root, container });
  return { container, props: mergedProps };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  vi.clearAllMocks();
  window.localStorage.clear();

  mockUseConfiguredProviders.mockReturnValue({
    providers: [
      {
        key: "custom-codex",
        label: "Codex Custom",
        registryId: "custom-codex",
        fallbackRegistryId: "codex",
        type: "codex",
        providerId: "custom-codex",
        apiHost: "https://api.openai.com/v1",
      },
    ],
    loading: false,
  });

  mockUseProviderModels.mockReturnValue({
    modelIds: ["gpt-5.3-codex", "gpt-5.2-codex"],
    models: [
      {
        id: "gpt-5.3-codex",
        capabilities: {
          vision: true,
          tools: true,
          streaming: true,
          json_mode: true,
          function_calling: true,
          reasoning: true,
        },
      },
      {
        id: "gpt-5.2-codex",
        capabilities: {
          vision: false,
          tools: true,
          streaming: true,
          json_mode: true,
          function_calling: true,
          reasoning: false,
        },
      },
    ],
    loading: false,
    error: null,
  });

  mockFilterModelsByTheme.mockImplementation((_theme, models) => ({
    models,
    usedFallback: false,
    filteredOutCount: 0,
    policyName: "none",
  }));
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
  window.localStorage.clear();
});

describe("ModelSelector", () => {
  it("后端回填原始 providerId 时，应解析到真实受管 Provider 读取模型", () => {
    mockUseConfiguredProviders.mockReturnValue({
      providers: [
        {
          key: "openai",
          label: "OpenAI OAuth",
          registryId: "openai",
          type: "openai",
        },
        {
          key: "openai_api_key",
          label: "OpenAI API Key",
          registryId: "openai",
          fallbackRegistryId: "openai",
          type: "openai",
          providerId: "openai",
          apiHost: "https://api.openai.com/v1",
        },
      ],
      loading: false,
    });

    renderModelSelector({
      providerType: "openai",
    });

    expect(mockUseProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "openai_api_key",
        providerId: "openai",
      }),
      expect.objectContaining({
        returnFullMetadata: true,
        autoLoad: true,
        liveFetchOnly: true,
        hasApiKey: true,
      }),
    );
  });

  it("禁用后台预加载时，关闭状态下应延后加载模型选择数据", () => {
    renderModelSelector({
      backgroundPreload: "disabled",
    });

    expect(mockUseConfiguredProviders).toHaveBeenCalledWith({
      autoLoad: false,
    });
    expect(mockUseProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({ key: "custom-codex" }),
      expect.objectContaining({
        returnFullMetadata: true,
        autoLoad: false,
        liveFetchOnly: true,
        hasApiKey: true,
      }),
    );
  });

  it("默认后台预加载开启时，应在未展开选择器前纠正失效持久化模型", async () => {
    const setModel = vi.fn();

    mockUseProviderModels.mockReturnValue({
      modelIds: ["gpt-5.2-codex", "gpt-5.1-codex-mini"],
      models: [
        {
          id: "gpt-5.2-codex",
          capabilities: {
            vision: true,
            tools: true,
            streaming: true,
            json_mode: true,
            function_calling: true,
            reasoning: true,
          },
        },
        {
          id: "gpt-5.1-codex-mini",
          capabilities: {
            vision: false,
            tools: true,
            streaming: true,
            json_mode: true,
            function_calling: true,
            reasoning: false,
          },
        },
      ],
      loading: false,
      error: null,
    });

    renderModelSelector({
      model: "gpt-5.9-codex-preview",
      setModel,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockUseProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({ key: "custom-codex" }),
      expect.objectContaining({
        returnFullMetadata: true,
        autoLoad: true,
      }),
    );
    expect(setModel).toHaveBeenCalledWith("gpt-5.2-codex");
  });

  it("打开选择器后应加载数据并回退到兼容模型", () => {
    const setModel = vi.fn();
    const { container } = renderModelSelector({
      model: "gpt-5.3-codex",
      setModel,
    });

    const trigger = container.querySelector(
      'button[role="combobox"]',
    ) as HTMLButtonElement | null;
    if (!trigger) {
      throw new Error("未找到模型选择触发器");
    }

    act(() => {
      trigger.click();
    });

    expect(setModel).toHaveBeenCalledWith("gpt-5.2-codex");
  });

  it("展开后应显示模型的思考与多模态能力标签", () => {
    const { container } = renderModelSelector();

    const trigger = container.querySelector(
      'button[role="combobox"]',
    ) as HTMLButtonElement | null;
    if (!trigger) {
      throw new Error("未找到模型选择触发器");
    }

    act(() => {
      trigger.click();
    });

    const pageText = document.body.textContent || "";
    expect(pageText).toContain("支持思考");
    expect(pageText).toContain("支持多模态");
    expect(pageText).toContain("无多模态");
  });

  it("未知 anthropic-compatible Provider 应在选择器中展示显式缓存提示", () => {
    mockUseConfiguredProviders.mockReturnValue({
      providers: [
        {
          key: "custom-anthropic-compatible",
          label: "GLM Anthropic",
          registryId: "custom-anthropic-compatible",
          fallbackRegistryId: "anthropic",
          type: "anthropic-compatible",
          providerId: "custom-anthropic-compatible",
          apiHost: "https://api.example.com/anthropic",
        },
      ],
      loading: false,
    });
    mockUseProviderModels.mockReturnValue({
      modelIds: ["glm-5.1"],
      models: [
        {
          id: "glm-5.1",
          capabilities: {
            vision: true,
            tools: true,
            streaming: true,
            json_mode: true,
            function_calling: true,
            reasoning: true,
          },
        },
      ],
      loading: false,
      error: null,
    });

    const { container } = renderModelSelector({
      providerType: "custom-anthropic-compatible",
      model: "glm-5.1",
    });

    const trigger = container.querySelector(
      'button[role="combobox"]',
    ) as HTMLButtonElement | null;
    if (!trigger) {
      throw new Error("未找到模型选择触发器");
    }

    act(() => {
      trigger.click();
    });

    const pageText = document.body.textContent || "";
    expect(pageText).toContain("显式缓存");
    expect(pageText).toContain("未声明自动 Prompt Cache");
    expect(pageText).toContain("cache_control");
  });

  it.each([
    {
      label: "GLM Anthropic",
      apiHost: "https://open.bigmodel.cn/api/anthropic",
      model: "glm-5.1",
    },
    {
      label: "Kimi Anthropic",
      apiHost: "https://api.moonshot.cn/anthropic",
      model: "kimi-k2.5",
    },
    {
      label: "MiniMax Anthropic",
      apiHost: "https://api.minimaxi.com/anthropic",
      model: "minimax-m1",
    },
    {
      label: "MiMo Anthropic",
      apiHost: "https://token-plan-cn.xiaomimimo.com/anthropic",
      model: "mimo-v2-flash",
    },
  ])("$label 不应在选择器中误报显式缓存提示", ({ label, apiHost, model }) => {
    mockUseConfiguredProviders.mockReturnValue({
      providers: [
        {
          key: "custom-anthropic-compatible",
          label,
          registryId: "custom-anthropic-compatible",
          fallbackRegistryId: "anthropic",
          type: "anthropic-compatible",
          providerId: "custom-anthropic-compatible",
          apiHost,
        },
      ],
      loading: false,
    });
    mockUseProviderModels.mockReturnValue({
      modelIds: [model],
      models: [
        {
          id: model,
          capabilities: {
            vision: true,
            tools: true,
            streaming: true,
            json_mode: true,
            function_calling: true,
            reasoning: true,
          },
        },
      ],
      loading: false,
      error: null,
    });

    const { container } = renderModelSelector({
      providerType: "custom-anthropic-compatible",
      model,
    });

    const trigger = container.querySelector(
      'button[role="combobox"]',
    ) as HTMLButtonElement | null;
    if (!trigger) {
      throw new Error("未找到模型选择触发器");
    }

    act(() => {
      trigger.click();
    });

    const pageText = document.body.textContent || "";
    expect(pageText).not.toContain("显式缓存");
    expect(pageText).not.toContain("未声明自动 Prompt Cache");
  });

  it("显式声明 automatic 的 anthropic-compatible Provider 不应在选择器中误报显式缓存提示", () => {
    mockUseConfiguredProviders.mockReturnValue({
      providers: [
        {
          key: "custom-anthropic-compatible",
          label: "GLM Anthropic Automatic",
          registryId: "custom-anthropic-compatible",
          fallbackRegistryId: "anthropic",
          type: "anthropic-compatible",
          providerId: "custom-anthropic-compatible",
          apiHost: "https://open.bigmodel.cn/api/anthropic",
          promptCacheMode: "automatic",
        },
      ],
      loading: false,
    });
    mockUseProviderModels.mockReturnValue({
      modelIds: ["glm-5.1"],
      models: [
        {
          id: "glm-5.1",
          capabilities: {
            vision: true,
            tools: true,
            streaming: true,
            json_mode: true,
            function_calling: true,
            reasoning: true,
          },
        },
      ],
      loading: false,
      error: null,
    });

    const { container } = renderModelSelector({
      providerType: "custom-anthropic-compatible",
      model: "glm-5.1",
    });

    const trigger = container.querySelector(
      'button[role="combobox"]',
    ) as HTMLButtonElement | null;
    if (!trigger) {
      throw new Error("未找到模型选择触发器");
    }

    act(() => {
      trigger.click();
    });

    const pageText = document.body.textContent || "";
    expect(pageText).not.toContain("显式缓存");
    expect(pageText).not.toContain("未声明自动 Prompt Cache");
  });

  it("无 Provider 引导关闭后应隐藏，并在重新挂载时保持关闭状态", () => {
    mockUseConfiguredProviders.mockReturnValue({
      providers: [],
      loading: false,
    });
    mockUseProviderModels.mockReturnValue({
      modelIds: [],
      models: [],
      loading: false,
      error: null,
    });

    const firstRender = renderModelSelector({
      providerType: "",
      model: "",
    });

    expect(firstRender.container.textContent).toContain("工具模型未配置");

    const dismissButton = firstRender.container.querySelector(
      'button[aria-label="关闭工具模型未配置提示"]',
    ) as HTMLButtonElement | null;
    if (!dismissButton) {
      throw new Error("未找到关闭引导按钮");
    }

    act(() => {
      dismissButton.click();
    });

    expect(firstRender.container.textContent ?? "").not.toContain(
      "工具模型未配置",
    );
    expect(
      window.localStorage.getItem(
        "lime_model_selector_no_provider_guide_dismissed_v1",
      ),
    ).toBe("1");

    const secondRender = renderModelSelector({
      providerType: "",
      model: "",
    });

    expect(secondRender.container.textContent ?? "").not.toContain(
      "工具模型未配置",
    );
  });
});
