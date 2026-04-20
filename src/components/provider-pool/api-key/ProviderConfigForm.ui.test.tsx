import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderWithKeysDisplay } from "@/lib/api/apiKeyProvider";
import type { EnhancedModelMetadata } from "@/lib/types/modelRegistry";

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
    prompt_cache_mode: null,
    created_at: new Date("2026-03-15T00:00:00.000Z").toISOString(),
    updated_at: new Date("2026-03-15T00:00:00.000Z").toISOString(),
    api_keys: [],
    ...overrides,
  };
}

function createEnabledApiKey() {
  return {
    id: "key-1",
    provider_id: "provider-1",
    api_key_masked: "sk-****",
    enabled: true,
    usage_count: 0,
    error_count: 0,
    created_at: new Date("2026-03-15T00:00:00.000Z").toISOString(),
  };
}

function createModel(
  id: string,
  overrides: Partial<EnhancedModelMetadata> = {},
): EnhancedModelMetadata {
  return {
    id,
    display_name: id,
    provider_id: "minimax",
    provider_name: "MiniMax",
    family: "minimax",
    tier: "pro",
    capabilities: {
      vision: false,
      tools: true,
      streaming: true,
      json_mode: true,
      function_calling: true,
      reasoning: true,
    },
    pricing: null,
    limits: {
      context_length: null,
      max_output_tokens: null,
      requests_per_minute: null,
      tokens_per_minute: null,
    },
    status: "active",
    release_date: null,
    is_latest: false,
    description: null,
    source: "custom",
    created_at: 0,
    updated_at: 0,
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

  it("anthropic-compatible 渠道在未返回模型目录时仍应允许保留和手动补充模型", () => {
    const provider = createProvider({
      id: "custom-xfyun-coding-plan",
      name: "讯飞 Coding Plan",
      is_system: false,
      type: "anthropic-compatible",
      api_host: "https://spark-api-open.xf-yun.com/v1/anthropic",
      custom_models: ["astron-code-latest"],
      api_keys: [],
    });
    const { container } = renderForm(provider);

    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="custom-models-input"]',
    );

    expect(container.textContent ?? "").not.toContain("先补一把可用 API Key");
    expect(container.textContent ?? "").toContain("当前：astron-code-latest");
    expect(container.textContent ?? "").toContain("astron-code-latest");
    expect(input?.disabled).toBe(false);
    expect(input?.getAttribute("placeholder")).toContain("手动输入模型 ID");
  });

  it("anthropic-compatible 渠道在拿到真实目录后不应自动覆盖已填写模型", async () => {
    mockUseProviderModels.mockReturnValue({
      modelIds: ["MiniMax-M2.1", "MiniMax-M2.7"],
      models: [
        createModel("MiniMax-M2.1"),
        createModel("MiniMax-M2.7", {
          is_latest: true,
        }),
      ],
      loading: false,
      error: null,
    });

    const provider = createProvider({
      id: "custom-minimax",
      name: "Minimax-test",
      is_system: false,
      type: "anthropic-compatible",
      api_host: "https://api.minimaxi.com/anthropic",
      custom_models: ["claude-opus-4-6"],
      api_keys: [createEnabledApiKey()],
    });
    const { container, onUpdate } = renderForm(provider);

    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });

    expect(onUpdate).not.toHaveBeenCalled();
    expect(container.textContent ?? "").toContain("当前：claude-opus-4-6");
    expect(container.textContent ?? "").toContain("推荐最新：MiniMax-M2.7");
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

  it("anthropic-compatible Provider 应展示显式 Prompt Cache 提示", () => {
    const provider = createProvider({
      id: "custom-anthropic-compatible",
      name: "Anthropic 兼容渠道",
      is_system: false,
      type: "anthropic-compatible",
      api_host: "https://example.com/anthropic",
    });
    const { container } = renderForm(provider);

    const notice = container.querySelector(
      '[data-testid="provider-prompt-cache-notice"]',
    );

    expect(notice).not.toBeNull();
    expect(notice?.textContent ?? "").toContain(
      "Anthropic 兼容只表示请求格式兼容",
    );
    expect(notice?.textContent ?? "").toContain("未声明支持自动 Prompt Cache");
    expect(notice?.textContent ?? "").toContain("显式 cache_control");
  });

  it("显式声明 automatic 的 anthropic-compatible Provider 不应展示 Prompt Cache 提示", () => {
    const provider = createProvider({
      id: "custom-anthropic-compatible-automatic",
      name: "Anthropic 兼容自动缓存渠道",
      is_system: false,
      type: "anthropic-compatible",
      prompt_cache_mode: "automatic",
      api_host: "https://example.com/anthropic",
    });
    const { container } = renderForm(provider);

    expect(
      container.querySelector('[data-testid="provider-prompt-cache-notice"]'),
    ).toBeNull();
  });

  it("anthropic-compatible Provider 切换到 automatic 后应带上 prompt_cache_mode 保存", async () => {
    const provider = createProvider({
      id: "custom-anthropic-compatible",
      name: "Anthropic 兼容渠道",
      is_system: false,
      type: "anthropic-compatible",
      api_host: "https://example.com/anthropic",
    });
    const { container, onUpdate } = renderForm(provider);

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="prompt-cache-mode-select"]',
    );

    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger?.click();
    });

    await act(async () => {
      findDivByText("已声明自动缓存").click();
    });

    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });

    expect(onUpdate).toHaveBeenCalledWith(
      "custom-anthropic-compatible",
      expect.objectContaining({
        type: "anthropic-compatible",
        prompt_cache_mode: "automatic",
      }),
    );
    expect(
      container.querySelector('[data-testid="provider-prompt-cache-notice"]'),
    ).toBeNull();
  });

  it("anthropic-compatible Provider 的协议说明弹层应明确未默认声明自动 Prompt Cache", async () => {
    const provider = createProvider({
      id: "custom-anthropic-compatible",
      name: "Anthropic 兼容渠道",
      is_system: false,
      type: "anthropic-compatible",
      api_host: "https://example.com/anthropic",
    });
    const { container } = renderForm(provider);

    const infoButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="provider-config-info-button"]',
    );

    expect(infoButton).not.toBeNull();

    await act(async () => {
      infoButton?.click();
    });

    const specialHint = document.querySelector<HTMLElement>(
      '[data-testid="protocol-special-hint"]',
    );

    expect(specialHint).not.toBeNull();
    expect(specialHint?.textContent ?? "").toContain(
      "已知官方 Anthropic 兼容端点",
    );
  });
});
