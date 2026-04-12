import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProviderWithKeysDisplay } from "@/lib/api/apiKeyProvider";
import { ProviderListItem } from "./ProviderListItem";

interface MountedRoot {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedRoot[] = [];

function createProvider(
  overrides: Partial<ProviderWithKeysDisplay> = {},
): ProviderWithKeysDisplay {
  return {
    id: "provider-001",
    name: "测试渠道",
    type: "openai",
    api_host: "https://api.example.com",
    is_system: false,
    group: "custom",
    enabled: true,
    sort_order: 1,
    api_key_count: 1,
    created_at: new Date("2026-03-15T00:00:00.000Z").toISOString(),
    updated_at: new Date("2026-03-15T00:00:00.000Z").toISOString(),
    api_keys: [
      {
        id: "key-001",
        provider_id: "provider-001",
        api_key_masked: "sk-****1234",
        alias: "默认密钥",
        enabled: true,
        usage_count: 0,
        error_count: 0,
        created_at: new Date("2026-03-15T00:00:00.000Z").toISOString(),
      },
    ],
    ...overrides,
  };
}

function renderItem(provider: ProviderWithKeysDisplay) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ProviderListItem provider={provider} />);
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

describe("ProviderListItem", () => {
  it("anthropic-compatible Provider 应展示显式缓存标签", () => {
    const container = renderItem(
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
    expect(badge?.textContent).toContain("显式缓存");
  });

  it("非 anthropic-compatible Provider 不应展示显式缓存标签", () => {
    const container = renderItem(createProvider());

    expect(
      container.querySelector('[data-testid="provider-prompt-cache-badge"]'),
    ).toBeNull();
  });
});
