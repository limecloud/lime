import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApiKeyDisplay } from "@/lib/api/apiKeyProvider";
import { ApiKeyList } from "./ApiKeyList";

interface MountedRoot {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedRoot[] = [];

function createApiKey(overrides: Partial<ApiKeyDisplay> = {}): ApiKeyDisplay {
  return {
    id: "key-001",
    provider_id: "openai",
    api_key_masked: "sk-****1234",
    alias: "默认账号",
    enabled: true,
    usage_count: 3,
    error_count: 0,
    last_used_at: new Date("2026-03-30T08:00:00.000Z").toISOString(),
    created_at: new Date("2026-03-29T00:00:00.000Z").toISOString(),
    ...overrides,
  };
}

function renderList(props: Partial<ComponentProps<typeof ApiKeyList>> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const mergedProps: ComponentProps<typeof ApiKeyList> = {
    apiKeys: [],
    providerId: "zhipu",
    providerName: "智谱 AI",
    apiHost: "https://open.bigmodel.cn/api/paas/v4/",
    ...props,
  };

  act(() => {
    root.render(<ApiKeyList {...mergedProps} />);
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

describe("ApiKeyList", () => {
  it("应通过说明按钮展示 API Key 获取入口", () => {
    const container = renderList();

    const infoButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="provider-api-key-info-button"]',
    );

    expect(infoButton).not.toBeNull();

    act(() => {
      infoButton?.click();
    });

    const helpLink = document.querySelector<HTMLAnchorElement>(
      '[data-testid="provider-api-key-help-link"]',
    );

    expect(document.body.textContent ?? "").toContain("如何获取 API Key");
    expect(helpLink).not.toBeNull();
    expect(helpLink?.href).toContain("open.bigmodel.cn/usercenter/apikeys");
  });

  it("本地渠道应在说明按钮内展示通常无需 API Key 的提示", () => {
    const container = renderList({
      providerId: "ollama",
      providerName: "Ollama",
      apiHost: "http://127.0.0.1:11434",
    });

    const infoButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="provider-api-key-info-button"]',
    );
    expect(infoButton).not.toBeNull();

    act(() => {
      infoButton?.click();
    });

    const hint = document.querySelector(
      '[data-testid="provider-api-key-keyless-hint"]',
    );

    expect(hint?.textContent ?? "").toContain("通常无需 API Key");
  });

  it("新增 API Key 按钮应保持单行显示", () => {
    const container = renderList({
      apiKeys: [createApiKey()],
    });

    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="add-api-key-button"]',
    );

    expect(button).not.toBeNull();
    expect(button?.className).toContain("whitespace-nowrap");
  });
});
