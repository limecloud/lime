import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUseConfiguredProviders,
  mockUseProviderModels,
} = vi.hoisted(() => ({
  mockUseConfiguredProviders: vi.fn(),
  mockUseProviderModels: vi.fn(),
}));

vi.mock("@/hooks/useConfiguredProviders", () => ({
  useConfiguredProviders: () => mockUseConfiguredProviders(),
}));

vi.mock("@/hooks/useProviderModels", () => ({
  useProviderModels: (...args: unknown[]) => mockUseProviderModels(...args),
}));

import { ProviderModelSelector } from "./ProviderModelSelector";

interface MountedRoot {
  root: Root;
  container: HTMLDivElement;
}

const mountedRoots: MountedRoot[] = [];

function renderSelector(
  props: Partial<React.ComponentProps<typeof ProviderModelSelector>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const mergedProps: React.ComponentProps<typeof ProviderModelSelector> = {
    onSelect: vi.fn(),
    initialProviderId: "custom-codex",
    ...props,
  };

  act(() => {
    root.render(<ProviderModelSelector {...mergedProps} />);
  });

  mountedRoots.push({ root, container });
  return { container };
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
    models: [
      {
        id: "gpt-5.3-codex",
        display_name: "GPT-5.3 Codex",
        capabilities: {
          vision: true,
          tools: true,
          streaming: true,
          json_mode: true,
          function_calling: true,
          reasoning: true,
        },
        is_latest: true,
      },
      {
        id: "gpt-5.2-codex",
        display_name: "GPT-5.2 Codex",
        capabilities: {
          vision: true,
          tools: true,
          streaming: true,
          json_mode: true,
          function_calling: true,
          reasoning: true,
        },
        is_latest: false,
      },
    ],
    loading: false,
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
});

describe("ProviderModelSelector", () => {
  it("支持实时拉取的 API Key Provider 应使用真实模型目录", () => {
    renderSelector();

    expect(mockUseProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({ key: "custom-codex" }),
      expect.objectContaining({
        returnFullMetadata: true,
        liveFetchOnly: true,
        hasApiKey: true,
      }),
    );
  });

  it("应隐藏 codex 不兼容模型并展示兼容提示", () => {
    const { container } = renderSelector();

    expect(container.textContent).toContain(
      "已隐藏 1 个当前登录态不兼容的模型",
    );
    expect(container.textContent).not.toContain("GPT-5.3 Codex");
    expect(container.textContent).toContain("GPT-5.2 Codex");
  });
});
