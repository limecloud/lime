import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseModelRegistry } = vi.hoisted(() => ({
  mockUseModelRegistry: vi.fn(),
}));

const { mockGetSystemProviderCatalog } = vi.hoisted(() => ({
  mockGetSystemProviderCatalog: vi.fn(),
}));

vi.mock("@/hooks/useModelRegistry", () => ({
  useModelRegistry: () => mockUseModelRegistry(),
}));

vi.mock("@/lib/api/apiKeyProvider", () => ({
  apiKeyProviderApi: {
    getSystemProviderCatalog: mockGetSystemProviderCatalog,
  },
}));

import { AddCustomProviderModal } from "./AddCustomProviderModal";

interface MountedRoot {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedRoot[] = [];

function renderModal() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <AddCustomProviderModal
        isOpen
        onClose={vi.fn()}
        onAdd={vi.fn().mockResolvedValue({ id: "provider-001" })}
        onAddApiKey={vi.fn().mockResolvedValue(undefined)}
      />,
    );
  });

  mountedRoots.push({ container, root });
}

async function settleModal() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function findByTestId<T extends Element>(testId: string): T {
  const element = document.querySelector<T>(`[data-testid="${testId}"]`);
  if (!element) {
    throw new Error(`未找到节点: ${testId}`);
  }
  return element;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  mockUseModelRegistry.mockReturnValue({
    groupedByProvider: new Map(),
  });

  mockGetSystemProviderCatalog.mockResolvedValue([
    {
      id: "google",
      name: "Google (Gemini)",
      type: "gemini",
      api_host: "https://generativelanguage.googleapis.com",
      group: "cloud",
      sort_order: 1,
      api_version: null,
      legacy_ids: ["gemini"],
    },
    {
      id: "deepseek",
      name: "DeepSeek",
      type: "openai",
      api_host: "https://api.deepseek.com",
      group: "mainstream",
      sort_order: 2,
      api_version: null,
      legacy_ids: [],
    },
    {
      id: "zhipu",
      name: "智谱 AI",
      type: "openai",
      api_host: "https://open.bigmodel.cn/api/paas/v4/",
      group: "chinese",
      sort_order: 3,
      api_version: null,
      legacy_ids: ["zhipuai"],
    },
  ]);
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

describe("AddCustomProviderModal", () => {
  it("应展示双栏模板选择布局", async () => {
    renderModal();

    await settleModal();

    expect(document.body.textContent ?? "").toContain("新增服务商");
    expect(document.body.textContent ?? "").toContain("选择模板");
    expect(document.body.textContent ?? "").toContain("基础接入信息");
    expect(document.body.textContent ?? "").toContain("协议与附加参数");
  });

  it("选择 Gemini 模板后应预填并展示特例协议提示", async () => {
    renderModal();

    await settleModal();

    await act(async () => {
      findByTestId<HTMLButtonElement>("known-provider-item-google").click();
    });

    const nameInput = findByTestId<HTMLInputElement>("provider-name-input");
    const hostInput = findByTestId<HTMLInputElement>("api-host-input");

    expect(nameInput.value).toBe("Google (Gemini)");
    expect(hostInput.value).toBe("https://generativelanguage.googleapis.com");
    expect(document.body.textContent ?? "").toContain("协议特例保留");
    expect(document.body.textContent ?? "").toContain(
      "Gemini 保留原生协议能力",
    );
  });

  it("选择智谱模板后应预填正确的 GLM Base URL", async () => {
    renderModal();

    await settleModal();

    await act(async () => {
      findByTestId<HTMLButtonElement>("known-provider-item-zhipu").click();
    });

    const nameInput = findByTestId<HTMLInputElement>("provider-name-input");
    const hostInput = findByTestId<HTMLInputElement>("api-host-input");

    expect(nameInput.value).toBe("智谱 AI");
    expect(hostInput.value).toBe("https://open.bigmodel.cn/api/paas/v4/");
  });

  it("应注入 Codex CLI、Gemini CLI 与 Claude 特例模板", async () => {
    renderModal();

    await settleModal();

    expect(
      document.querySelector('[data-testid="known-provider-item-codex-cli"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="known-provider-item-gemini-cli"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="known-provider-item-claude-code"]'),
    ).not.toBeNull();
  });

  it("选择 Codex CLI 模板后应预填专属协议与地址", async () => {
    renderModal();

    await settleModal();

    await act(async () => {
      findByTestId<HTMLButtonElement>("known-provider-item-codex-cli").click();
    });

    const nameInput = findByTestId<HTMLInputElement>("provider-name-input");
    const hostInput = findByTestId<HTMLInputElement>("api-host-input");
    const providerTypeSelect = findByTestId<HTMLElement>(
      "provider-type-select",
    );

    expect(nameInput.value).toBe("Codex CLI");
    expect(hostInput.value).toBe("https://api.openai.com");
    expect(providerTypeSelect.textContent ?? "").toContain("Codex CLI");
    expect(document.body.textContent ?? "").toContain(
      "Codex 保留 Lime 的专属协议",
    );
  });

  it("legacy 别名只应参与搜索，不应重复渲染模板卡片", async () => {
    renderModal();

    await settleModal();

    expect(
      document.querySelector('[data-testid="known-provider-item-gemini"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="known-provider-item-zhipuai"]'),
    ).toBeNull();
  });
});
