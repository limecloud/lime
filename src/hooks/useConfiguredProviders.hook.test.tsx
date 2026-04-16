import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseProviderPool, mockUseApiKeyProvider } = vi.hoisted(() => ({
  mockUseProviderPool: vi.fn(),
  mockUseApiKeyProvider: vi.fn(),
}));

vi.mock("./useProviderPool", () => ({
  useProviderPool: mockUseProviderPool,
}));

vi.mock("./useApiKeyProvider", () => ({
  useApiKeyProvider: mockUseApiKeyProvider,
}));

import { useConfiguredProviders } from "./useConfiguredProviders";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function mountHook(autoLoad = true) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let hookValue: ReturnType<typeof useConfiguredProviders> | null = null;

  function TestComponent() {
    hookValue = useConfiguredProviders({ autoLoad });
    return null;
  }

  act(() => {
    root.render(<TestComponent />);
  });

  mountedRoots.push({ root, container });
  return {
    getValue() {
      if (!hookValue) {
        throw new Error("hook 尚未初始化");
      }
      return hookValue;
    },
  };
}

describe("useConfiguredProviders", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mockUseProviderPool.mockReturnValue({
      overview: [],
      loading: false,
    });
    mockUseApiKeyProvider.mockReturnValue({
      providers: [],
      loading: false,
    });
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

  it("仅为配置列表加载 provider 数据时不应再拉取 UI 状态", () => {
    const harness = mountHook(true);

    expect(mockUseProviderPool).toHaveBeenCalledWith({ autoLoad: true });
    expect(mockUseApiKeyProvider).toHaveBeenCalledWith({
      autoLoad: true,
      hydrateUiState: false,
    });
    expect(harness.getValue()).toEqual({
      providers: [],
      loading: false,
    });
  });
});
