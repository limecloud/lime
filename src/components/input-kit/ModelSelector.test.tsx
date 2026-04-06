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
});

describe("ModelSelector", () => {
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
});
