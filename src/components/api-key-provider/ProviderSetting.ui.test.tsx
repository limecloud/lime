import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderWithKeysDisplay } from "@/lib/api/apiKeyProvider";

const { mockFetchProviderModelsAuto } = vi.hoisted(() => ({
  mockFetchProviderModelsAuto: vi.fn(),
}));

vi.mock("@/lib/api/modelRegistry", () => ({
  fetchProviderModelsAuto: (...args: unknown[]) =>
    mockFetchProviderModelsAuto(...args),
  normalizeFetchProviderModelsSource: (result: {
    source: "Api" | "Catalog" | "CustomModels" | "LocalFallback";
    models: unknown[];
    error: string | null;
  }) => {
    if (
      result.source === "LocalFallback" &&
      typeof result.error === "string" &&
      result.error.includes("已保留当前 Provider 的自定义模型")
    ) {
      return "CustomModels";
    }

    return result.source;
  },
}));

import { ProviderSetting } from "./ProviderSetting";

interface MountedRoot {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedRoot[] = [];

function createProvider(
  overrides: Partial<ProviderWithKeysDisplay> = {},
): ProviderWithKeysDisplay {
  return {
    id: "deepseek",
    name: "DeepSeek",
    type: "openai",
    api_host: "https://api.deepseek.com",
    is_system: false,
    group: "mainstream",
    enabled: true,
    sort_order: 1,
    api_key_count: 1,
    custom_models: ["deepseek-chat"],
    created_at: new Date("2026-03-15T00:00:00.000Z").toISOString(),
    updated_at: new Date("2026-03-15T00:00:00.000Z").toISOString(),
    api_keys: [
      {
        id: "key-001",
        provider_id: "deepseek",
        api_key_masked: "sk-****1234",
        alias: "生产账号",
        enabled: true,
        usage_count: 12,
        error_count: 0,
        last_used_at: new Date("2026-03-15T08:00:00.000Z").toISOString(),
        created_at: new Date("2026-03-14T00:00:00.000Z").toISOString(),
      },
    ],
    ...overrides,
  };
}

function renderSetting(
  provider: ProviderWithKeysDisplay | null,
  props: Partial<React.ComponentProps<typeof ProviderSetting>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ProviderSetting provider={provider} {...props} />);
  });

  mountedRoots.push({ container, root });
  return container;
}

async function flushEffects(times = 2) {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
  });
}

function changeInput(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mockFetchProviderModelsAuto.mockResolvedValue({
    source: "Api",
    models: [{ id: "deepseek-chat" }],
    error: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();

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
});

describe("ProviderSetting", () => {
  it("空状态应提示选择或添加模型", async () => {
    const container = renderSetting(null);
    await flushEffects();

    expect(container.textContent ?? "").toContain("选择或添加模型");
    expect(container.textContent ?? "").toContain("密钥、模型优先级和测试连接");
  });

  it("详情页应只保留密钥、模型优先级和测试连接", async () => {
    const container = renderSetting(createProvider());
    await flushEffects();
    const text = container.textContent ?? "";

    expect(text).toContain("DeepSeek");
    expect(text).toContain("API 密钥");
    expect(text).toContain("模型优先级");
    expect(text).toContain("从接口获取");
    expect(text).toContain("测试连接");
    expect(text).toContain("主模型");
    expect(text).toContain("deepseek-chat");
    expect(text).not.toContain("协议配置表单");
    expect(text).not.toContain("连接验证");
    expect(text).not.toContain("支持的模型");
    expect(
      container.querySelector('[data-testid="provider-simple-card"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="provider-test-connection-button"]'),
    ).not.toBeNull();
  });

  it("手动添加模型应直接更新 custom_models", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const container = renderSetting(createProvider({ custom_models: [] }), {
      onUpdate,
    });
    await flushEffects();

    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="model-draft-input"]',
    );
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="model-draft-add-button"]',
    );

    expect(input).not.toBeNull();
    expect(button).not.toBeNull();

    await act(async () => {
      changeInput(input!, "deepseek-reasoner");
      await Promise.resolve();
    });

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(onUpdate).toHaveBeenCalledWith("deepseek", {
      custom_models: ["deepseek-reasoner"],
    });
    expect(container.textContent ?? "").toContain("deepseek-reasoner");
  });

  it("接口获取只接受 Api 来源，不展示本地兜底模型", async () => {
    mockFetchProviderModelsAuto.mockResolvedValueOnce({
      source: "LocalFallback",
      models: [{ id: "wrong-fallback-model" }],
      error: "API 获取失败，已使用本地数据",
    });
    const container = renderSetting(createProvider({ custom_models: [] }));
    await flushEffects();

    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="fetch-models-button"]',
    );

    await act(async () => {
      button?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockFetchProviderModelsAuto).toHaveBeenCalledWith("deepseek");
    expect(container.textContent ?? "").toContain("已忽略本地目录或兜底结果");
    expect(container.textContent ?? "").not.toContain("wrong-fallback-model");
    expect(
      container.querySelector('[data-testid="api-model-suggestions"]'),
    ).toBeNull();
  });

  it("接口获取成功后点击模型建议才加入优先级", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    mockFetchProviderModelsAuto.mockResolvedValueOnce({
      source: "Api",
      models: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }],
      error: null,
    });
    const container = renderSetting(createProvider({ custom_models: [] }), {
      onUpdate,
    });
    await flushEffects();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="fetch-models-button"]')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent ?? "").toContain("接口返回 2 个模型");
    expect(onUpdate).not.toHaveBeenCalled();

    const suggestions = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '[data-testid="api-model-suggestion"]',
      ),
    );
    expect(suggestions.map((button) => button.textContent?.trim())).toContain(
      "deepseek-chat",
    );

    await act(async () => {
      suggestions[0]?.click();
      await Promise.resolve();
    });

    expect(onUpdate).toHaveBeenCalledWith("deepseek", {
      custom_models: ["deepseek-chat"],
    });
  });

  it("测试连接应先保存新密钥，并只显示简洁状态", async () => {
    const onAddApiKey = vi.fn().mockResolvedValue(undefined);
    const onTestConnection = vi.fn().mockResolvedValue({
      success: true,
      latencyMs: 128,
    });
    const container = renderSetting(
      createProvider({ api_key_count: 0, api_keys: [] }),
      {
        onAddApiKey,
        onTestConnection,
      },
    );
    await flushEffects();

    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="provider-api-key-input"]',
    );
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="provider-test-connection-button"]',
    );

    await act(async () => {
      changeInput(input!, "sk-new-key");
      await Promise.resolve();
    });

    expect(button?.disabled).toBe(false);

    await act(async () => {
      button?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onAddApiKey).toHaveBeenCalledWith("deepseek", "sk-new-key");
    expect(onTestConnection).toHaveBeenCalledWith("deepseek");
    expect(container.textContent ?? "").toContain("连接成功 · 128ms");
    expect(container.textContent ?? "").not.toContain("错误详情");
    expect(container.textContent ?? "").not.toContain("对话测试");
  });
});
