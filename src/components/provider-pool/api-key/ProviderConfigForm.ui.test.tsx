import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderWithKeysDisplay } from "@/lib/api/apiKeyProvider";

const { mockUseProviderModels } = vi.hoisted(() => ({
  mockUseProviderModels: vi.fn(),
}));

vi.mock("@/hooks/useProviderModels", () => ({
  useProviderModels: mockUseProviderModels,
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
  mockUseProviderModels.mockReturnValue({
    models: [],
    loading: false,
    error: null,
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
  vi.useRealTimers();
});

describe("ProviderConfigForm", () => {
  it("系统 Provider 应固定原生协议，不展示兼容协议切换", () => {
    const provider = createProvider();
    const { container } = renderForm(provider);

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="provider-type-select"]',
    );
    expect(trigger).toBeNull();
    expect(container.textContent ?? "").toContain("OpenAI Responses API");
    expect(
      container.querySelector('[data-testid="provider-config-info-button"]'),
    ).not.toBeNull();
  });

  it("实时拉模型渠道在未读取到真实目录时不应继续展示旧模型", () => {
    const provider = createProvider({
      custom_models: ["gpt-4.1"],
      api_keys: [],
    });
    const { container } = renderForm(provider);

    expect(container.textContent ?? "").toContain("先补一把可用 API Key");
    expect(container.textContent ?? "").toContain("已保存 1 个模型配置");
    expect(container.textContent ?? "").not.toContain("推荐最新模型：gpt-4.1");
    expect(container.textContent ?? "").not.toContain(">gpt-4.1<");
    expect(container.textContent ?? "").not.toContain("当前默认模型：gpt-4.1");
  });

  it("自定义 Provider 应允许切换兼容协议并保存", async () => {
    const provider = createProvider({
      id: "custom-openai",
      name: "自定义 OpenAI",
      is_system: false,
      type: "openai-response",
    });
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
      "custom-openai",
      expect.objectContaining({
        type: "openai",
      }),
    );
  });
});
