import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderWithKeysDisplay } from "@/lib/api/apiKeyProvider";

vi.mock("@/hooks/useProviderModels", () => ({
  useProviderModels: () => ({
    models: [],
    loading: false,
    error: null,
  }),
}));

import { ProviderConfigForm } from "./ProviderConfigForm";

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: RenderResult[] = [];

function createProvider(
  overrides: Partial<ProviderWithKeysDisplay> = {},
): ProviderWithKeysDisplay {
  return {
    id: "openai",
    name: "OpenAI",
    type: "openai-response",
    api_host: "https://api.openai.com",
    is_system: true,
    group: "mainstream",
    enabled: true,
    sort_order: 1,
    api_key_count: 1,
    custom_models: ["gpt-4.1"],
    created_at: new Date("2026-03-15T00:00:00.000Z").toISOString(),
    updated_at: new Date("2026-03-15T00:00:00.000Z").toISOString(),
    api_keys: [],
    ...overrides,
  };
}

function renderForm(
  provider: ProviderWithKeysDisplay,
  onUpdate = vi.fn().mockResolvedValue(undefined),
): RenderResult & { onUpdate: typeof onUpdate } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ProviderConfigForm provider={provider} onUpdate={onUpdate} />);
  });

  const rendered = { container, root };
  mountedRoots.push(rendered);
  return { ...rendered, onUpdate };
}

function findDivByText(text: string): HTMLDivElement {
  const target = Array.from(document.querySelectorAll("div")).find(
    (element) => element.textContent?.trim() === text,
  );

  if (!(target instanceof HTMLDivElement)) {
    throw new Error(`未找到文本为 ${text} 的节点`);
  }

  return target;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
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
  vi.useRealTimers();
});

describe("ProviderConfigForm", () => {
  it("系统 Provider 应显示协议选择并保存协议变更", async () => {
    const provider = createProvider();
    const { container, onUpdate } = renderForm(provider);

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="provider-type-select"]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).toContain("OpenAI Responses API");

    await act(async () => {
      trigger?.click();
    });

    await act(async () => {
      findDivByText("OpenAI 兼容").click();
    });

    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(
      "openai",
      expect.objectContaining({
        type: "openai",
      }),
    );
  });
});
