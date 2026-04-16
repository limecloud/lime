import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderWithKeysDisplay } from "@/lib/api/apiKeyProvider";

vi.mock("./ProviderConfigForm", () => ({
  ProviderConfigForm: React.forwardRef((_props, _ref) => (
    <div data-testid="provider-config-form-stub">协议配置表单</div>
  )),
}));

vi.mock("./ProviderModelList", () => ({
  ProviderModelList: () => (
    <div data-testid="provider-model-list-stub">模型列表</div>
  ),
}));

vi.mock("./ConnectionTestButton", () => ({
  ConnectionTestButton: (props: { disabled?: boolean }) => (
    <div
      data-testid="connection-test-button-stub"
      data-disabled={String(Boolean(props.disabled))}
    >
      连接测试按钮
    </div>
  ),
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

function renderSetting(provider: ProviderWithKeysDisplay | null) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <ProviderSetting provider={provider} onDeleteProvider={vi.fn()} />,
    );
  });

  mountedRoots.push({ container, root });
  return container;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
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
  it("空状态应提示进入服务商配置工作台", () => {
    const container = renderSetting(null);

    expect(container.textContent ?? "").toContain("服务商配置工作台");
    expect(container.textContent ?? "").toContain("模型、密钥和必要配置");
  });

  it("应展示新的分区式编辑工作台", () => {
    const container = renderSetting(createProvider());
    const text = container.textContent ?? "";

    expect(text).toContain("模型设置");
    expect(text).toContain("API Key");
    expect(text).toContain("协议配置表单");
    expect(text).toContain("连接验证");
    expect(text).toContain("读取真实模型目录前，不展示旧模型");
    expect(text).toContain("默认：待读取");
    expect(
      container.querySelector('[data-testid="provider-models-info-button"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="provider-connection-info-button"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="delete-provider-button"]'),
    ).not.toBeNull();
  });

  it("服务商工作台应保留原分栏，并允许模型区头部自然换行", () => {
    const container = renderSetting(createProvider());
    const workbenchGrid = container.querySelector<HTMLElement>(
      '[data-testid="provider-setting-workbench-grid"]',
    );
    const modelsHeader = container.querySelector<HTMLElement>(
      '[data-testid="supported-models-header"]',
    );

    expect(workbenchGrid?.className).toContain(
      "xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,340px)]",
    );
    expect(modelsHeader?.className).toContain("flex-wrap");
    expect(modelsHeader?.className).toContain("justify-between");
  });

  it("anthropic-compatible Provider 应在头部展示显式缓存标签", () => {
    const container = renderSetting(
      createProvider({
        id: "anthropic-proxy",
        name: "Anthropic Proxy",
        type: "anthropic-compatible",
      }),
    );

    const badge = container.querySelector(
      '[data-testid="provider-prompt-cache-badge"]',
    );

    expect(badge).not.toBeNull();
    expect(badge?.textContent ?? "").toContain("显式缓存");
  });

  it("显式声明 automatic 的 anthropic-compatible Provider 不应在头部展示显式缓存标签", () => {
    const container = renderSetting(
      createProvider({
        id: "anthropic-proxy-automatic",
        name: "Anthropic Proxy Automatic",
        type: "anthropic-compatible",
        prompt_cache_mode: "automatic",
      }),
    );

    expect(
      container.querySelector('[data-testid="provider-prompt-cache-badge"]'),
    ).toBeNull();
  });

  it.each([
    {
      id: "glm-anthropic",
      name: "GLM Anthropic",
      apiHost: "https://open.bigmodel.cn/api/anthropic",
    },
    {
      id: "kimi-anthropic",
      name: "Kimi Anthropic",
      apiHost: "https://api.moonshot.cn/anthropic",
    },
    {
      id: "minimax-anthropic",
      name: "MiniMax Anthropic",
      apiHost: "https://api.minimaxi.com/anthropic",
    },
    {
      id: "mimo-anthropic",
      name: "MiMo Anthropic",
      apiHost: "https://token-plan-cn.xiaomimimo.com/anthropic",
    },
  ])("$name 官方 Host 不应在头部展示显式缓存标签", ({ id, name, apiHost }) => {
    const container = renderSetting(
      createProvider({
        id,
        name,
        type: "anthropic-compatible",
        api_host: apiHost,
      }),
    );

    expect(
      container.querySelector('[data-testid="provider-prompt-cache-badge"]'),
    ).toBeNull();
  });

  it("已保存默认模型的 anthropic-compatible Provider 在真实目录未返回时仍应允许连接测试", () => {
    const container = renderSetting(
      createProvider({
        id: "minimax-anthropic-saved-default",
        name: "MiniMax Anthropic",
        type: "anthropic-compatible",
        api_host: "https://api.minimaxi.com/anthropic",
        custom_models: ["MiniMax-M2.7"],
      }),
    );

    expect(container.textContent ?? "").toContain("MiniMax-M2.7");
    expect(container.textContent ?? "").toContain("可测试");
    expect(container.textContent ?? "").toContain(
      "已保存默认模型，可先用于连接验证",
    );
    expect(
      container
        .querySelector('[data-testid="connection-test-button-stub"]')
        ?.getAttribute("data-disabled"),
    ).toBe("false");
  });
});
