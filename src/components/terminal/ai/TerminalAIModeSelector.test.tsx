import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseConfiguredProviders, mockUseProviderModels } = vi.hoisted(
  () => ({
    mockUseConfiguredProviders: vi.fn(),
    mockUseProviderModels: vi.fn(),
  }),
);

vi.mock("@/hooks/useConfiguredProviders", () => ({
  useConfiguredProviders: () => mockUseConfiguredProviders(),
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

import { TerminalAIModeSelector } from "./TerminalAIModeSelector";

interface MountedRoot {
  root: Root;
  container: HTMLDivElement;
}

const mountedRoots: MountedRoot[] = [];

function renderSelector(
  props: Partial<React.ComponentProps<typeof TerminalAIModeSelector>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const mergedProps: React.ComponentProps<typeof TerminalAIModeSelector> = {
    providerId: "custom-codex",
    onProviderChange: vi.fn(),
    modelId: "gpt-5.3-codex",
    onModelChange: vi.fn(),
    ...props,
  };

  act(() => {
    root.render(<TerminalAIModeSelector {...mergedProps} />);
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
        credentialType: "codex_oauth",
      },
    ],
    loading: false,
  });

  mockUseProviderModels.mockReturnValue({
    modelIds: ["gpt-5.3-codex", "gpt-5.2-codex"],
    models: [],
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

describe("TerminalAIModeSelector", () => {
  it("应在 codex 不兼容模型被选中时自动回退到兼容模型", () => {
    const onModelChange = vi.fn();

    renderSelector({
      modelId: "gpt-5.3-codex",
      onModelChange,
    });

    expect(onModelChange).toHaveBeenCalledWith("gpt-5.2-codex");
  });
});
