import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputbarPromptCacheNotice } from "./InputbarPromptCacheNotice";

const mockUseConfiguredProviders = vi.fn();

vi.mock("@/hooks/useConfiguredProviders", () => ({
  useConfiguredProviders: (options: unknown) =>
    mockUseConfiguredProviders(options),
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
  resolveConfiguredProviderPromptCacheSupportNotice: (
    providers: Array<{ key: string; providerId?: string; type?: string }>,
    selection?: string | null,
  ) => {
    const normalizedSelection = (selection || "").trim().toLowerCase();
    const selectedProvider =
      providers.find(
        (provider) => provider.key.trim().toLowerCase() === normalizedSelection,
      ) ??
      providers.find(
        (provider) =>
          (provider.providerId || "").trim().toLowerCase() ===
          normalizedSelection,
      ) ??
      null;
    const normalizedConfiguredType = (
      selectedProvider?.type || ""
    ).trim().toLowerCase();

    if (normalizedConfiguredType === "anthropic-compatible") {
      return {
        label: "未声明自动缓存",
        detail:
          "当前 Provider 未声明支持自动 Prompt Cache；如需复用前缀，请使用显式 cache_control 标记。",
        source: "configured_provider" as const,
      };
    }

    if (normalizedSelection === "anthropic-compatible") {
      return {
        label: "未声明自动缓存",
        detail:
          "当前 Provider 未声明支持自动 Prompt Cache；当前提示基于 Provider 选择器回退判断，如需复用前缀，请使用显式 cache_control 标记。",
        source: "selection_fallback" as const,
      };
    }

    return null;
  },
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  mockUseConfiguredProviders.mockReturnValue({
    providers: [],
    loading: false,
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

function renderNotice(
  props?: Partial<React.ComponentProps<typeof InputbarPromptCacheNotice>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <InputbarPromptCacheNotice
        providerType="custom-provider-id"
        {...props}
      />,
    );
  });

  mountedRoots.push({ root, container });
  return container;
}

describe("InputbarPromptCacheNotice", () => {
  it("anthropic-compatible 自定义 Provider 应展示发送前提示", () => {
    mockUseConfiguredProviders.mockReturnValue({
      providers: [
        {
          key: "custom-provider-id",
          label: "GLM Anthropic",
          registryId: "custom-provider-id",
          type: "anthropic-compatible",
          providerId: "custom-provider-id",
        },
      ],
      loading: false,
    });

    const container = renderNotice();

    expect(
      container.querySelector('[data-testid="inputbar-prompt-cache-warning"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("未声明支持自动 Prompt Cache");
    expect(container.textContent).toContain("cache_control");
  });

  it("官方 Anthropic Provider 不应展示发送前提示", () => {
    mockUseConfiguredProviders.mockReturnValue({
      providers: [
        {
          key: "anthropic",
          label: "Anthropic",
          registryId: "anthropic",
          type: "anthropic",
          providerId: "anthropic",
        },
      ],
      loading: false,
    });

    const container = renderNotice({
      providerType: "anthropic",
    });

    expect(
      container.querySelector('[data-testid="inputbar-prompt-cache-warning"]'),
    ).toBeNull();
  });

  it("未解析到真实 Provider 时，应允许按选择器回退展示提示", () => {
    const container = renderNotice({
      providerType: "anthropic-compatible",
    });

    const warning = container.querySelector(
      '[data-testid="inputbar-prompt-cache-warning"]',
    );
    expect(warning).not.toBeNull();
    expect(warning?.getAttribute("title")).toContain("回退判断");
  });
});
