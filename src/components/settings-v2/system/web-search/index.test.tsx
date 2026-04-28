import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetConfig, mockSaveConfig } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
}));
const { mockOpen } = vi.hoisted(() => ({
  mockOpen: vi.fn(),
}));

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: mockGetConfig,
  saveConfig: mockSaveConfig,
}));
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: mockOpen,
}));

import { WebSearchSettings } from ".";

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

const mounted: Mounted[] = [];

function renderComponent(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<WebSearchSettings />);
  });
  mounted.push({ container, root });
  return container;
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

function getBodyText() {
  return document.body.textContent ?? "";
}

async function hoverTip(ariaLabel: string) {
  const trigger = document.body.querySelector(
    `button[aria-label='${ariaLabel}']`,
  );
  expect(trigger).toBeInstanceOf(HTMLButtonElement);

  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await Promise.resolve();
  });

  return trigger as HTMLButtonElement;
}

async function leaveTip(trigger: HTMLButtonElement | null) {
  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    await Promise.resolve();
  });
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const target = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.includes(text),
  );
  if (!target) {
    throw new Error(`未找到按钮: ${text}`);
  }
  return target as HTMLButtonElement;
}

async function switchTab(container: HTMLElement, text: string) {
  await act(async () => {
    findButton(container, text).click();
    await flushEffects();
  });
}

function findSelect(container: HTMLElement, id: string): HTMLSelectElement {
  const node = container.querySelector<HTMLSelectElement>(`#${id}`);
  if (!node) {
    throw new Error(`未找到下拉框: ${id}`);
  }
  return node;
}

function findInput(container: HTMLElement, id: string): HTMLInputElement {
  const node = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!node) {
    throw new Error(`未找到输入框: ${id}`);
  }
  return node;
}

async function setInputValue(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!nativeSetter) {
    throw new Error("未找到 input value setter");
  }

  await act(async () => {
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flushEffects();
  });
}

async function setSelectValue(select: HTMLSelectElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    "value",
  )?.set;
  if (!nativeSetter) {
    throw new Error("未找到 select value setter");
  }

  await act(async () => {
    nativeSetter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flushEffects();
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  vi.clearAllMocks();

  mockGetConfig.mockResolvedValue({
    web_search: {
      engine: "google",
      provider: "duckduckgo_instant",
      provider_priority: ["duckduckgo_instant", "bing_search_api"],
      tavily_api_key: "tavily-old-key",
      bing_search_api_key: "bing-old-key",
      google_search_api_key: "google-old-key",
      google_search_engine_id: "cx-old-id",
      multi_search: {
        priority: ["google", "bing"],
        engines: [
          {
            name: "google",
            url_template: "https://www.google.com/search?q={query}",
            enabled: true,
          },
        ],
        max_results_per_engine: 5,
        max_total_results: 20,
        timeout_ms: 4000,
      },
    },
    image_gen: {
      image_search_pexels_api_key: "old-key",
      image_search_pixabay_api_key: "old-pixabay-key",
    },
  });
  mockSaveConfig.mockResolvedValue(undefined);
  mockOpen.mockResolvedValue(undefined);
});

afterEach(() => {
  while (mounted.length > 0) {
    const target = mounted.pop();
    if (!target) break;
    act(() => {
      target.root.unmount();
    });
    target.container.remove();
  }
  vi.clearAllMocks();
});

describe("WebSearchSettings", () => {
  it("应默认进入搜索链路 tab，并延迟挂载其他配置区", async () => {
    const container = renderComponent();
    await flushEffects();
    await flushEffects();

    const text = container.textContent ?? "";
    expect(text).toContain("网络搜索");
    expect(text).toContain("管理搜索引擎、Provider 回退和图片搜索 Key。");
    expect(text).toContain("当前 Provider：duckduckgo_instant");
    expect(text).toContain("状态：已保存");
    expect(text).toContain("联网搜索配置");
    expect(text).toContain("Provider 凭证");
    expect(text).toContain("MSE 聚合");
    expect(text).toContain("图片搜索");
    expect(text).not.toContain("联网图片搜索");
    expect(container.querySelector("#web-search-tavily-key")).toBeNull();
    expect(container.querySelector("#web-search-mse-priority")).toBeNull();
    expect(container.querySelector("#web-search-pexels-key")).toBeNull();

    const select = findSelect(container, "web-search-engine");
    expect(select.value).toBe("google");
    const provider = findSelect(container, "web-search-provider");
    expect(provider.value).toBe("duckduckgo_instant");
  });

  it("切到 Provider 凭证 tab 后应加载搜索服务 Key", async () => {
    const container = renderComponent();
    await flushEffects();
    await flushEffects();

    await switchTab(container, "Provider 凭证");

    expect(container.textContent).toContain("Provider 凭证");
    const tavilyInput = findInput(container, "web-search-tavily-key");
    expect(tavilyInput.value).toBe("tavily-old-key");

    const bingKeyInput = findInput(container, "web-search-bing-key");
    expect(bingKeyInput.value).toBe("bing-old-key");
    const googleKeyInput = findInput(container, "web-search-google-key");
    expect(googleKeyInput.value).toBe("google-old-key");
    const googleEngineInput = findInput(
      container,
      "web-search-google-engine-id",
    );
    expect(googleEngineInput.value).toBe("cx-old-id");
  });

  it("切到 MSE 聚合 tab 后应加载聚合配置", async () => {
    const container = renderComponent();
    await flushEffects();
    await flushEffects();

    await switchTab(container, "MSE 聚合");

    expect(container.textContent).toContain("Multi Search Engine");
    expect(findInput(container, "web-search-mse-priority").value).toBe(
      "google, bing",
    );
    expect(findInput(container, "web-search-mse-max-per-engine").value).toBe(
      "5",
    );
    expect(findInput(container, "web-search-mse-timeout").value).toBe("4000");
  });

  it("切到图片搜索 tab 后应加载图片 Key 和观测面板", async () => {
    const container = renderComponent();
    await flushEffects();
    await flushEffects();

    await switchTab(container, "图片搜索");

    expect(container.textContent).toContain("联网图片搜索");
    expect(container.textContent).toContain("观测面板");
    const input = findInput(container, "web-search-pexels-key");
    expect(input.value).toBe("old-key");
    const pixabayInput = findInput(container, "web-search-pixabay-key");
    expect(pixabayInput.value).toBe("old-pixabay-key");
  });

  it("应把联网搜索补充说明收进 tips", async () => {
    renderComponent();
    await flushEffects();
    await flushEffects();

    expect(getBodyText()).not.toContain(
      "管理搜索引擎、Provider 回退链和图片搜索 Key；各服务的接入说明已经分别收进对应配置分区。",
    );
    expect(getBodyText()).not.toContain(
      "申请地址：https://www.pexels.com/api/new/",
    );

    const heroTip = await hoverTip("联网搜索设置总览说明");
    expect(getBodyText()).toContain(
      "管理搜索引擎、Provider 回退链和图片搜索 Key；各服务的接入说明已经分别收进对应配置分区。",
    );
    await leaveTip(heroTip);

    const pexelsTip = await hoverTip("Pexels 接入说明");
    expect(getBodyText()).toContain(
      "申请地址：https://www.pexels.com/api/new/",
    );
    expect(getBodyText()).toContain(
      "验证路径：Claw → @素材 → Pexels 图片候选。",
    );
    await leaveTip(pexelsTip);
  });

  it("修改搜索提供商与图片 Key 后应统一保存", async () => {
    const container = renderComponent();
    await flushEffects();
    await flushEffects();

    await setSelectValue(
      findSelect(container, "web-search-engine"),
      "xiaohongshu",
    );
    await setSelectValue(
      findSelect(container, "web-search-provider"),
      "multi_search_engine",
    );
    await setInputValue(
      findInput(container, "web-search-provider-priority"),
      "multi_search_engine, tavily, bing_search_api",
    );
    await setInputValue(
      findInput(container, "web-search-tavily-key"),
      "tavily-new-key",
    );
    await setInputValue(
      findInput(container, "web-search-bing-key"),
      "bing-new-key",
    );
    await setInputValue(
      findInput(container, "web-search-google-key"),
      "google-new-key",
    );
    await setInputValue(
      findInput(container, "web-search-google-engine-id"),
      "cx-new-id",
    );
    await setInputValue(
      findInput(container, "web-search-mse-custom-engine-name"),
      "hn",
    );
    await setInputValue(
      findInput(container, "web-search-mse-custom-engine-template"),
      "https://hn.algolia.com/?q={query}",
    );
    await setInputValue(
      findInput(container, "web-search-pexels-key"),
      "new-key",
    );
    await setInputValue(
      findInput(container, "web-search-pixabay-key"),
      "new-pixabay-key",
    );

    await act(async () => {
      findButton(container, "保存").click();
      await flushEffects();
    });

    expect(mockSaveConfig).toHaveBeenCalledTimes(1);
    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        web_search: expect.objectContaining({
          engine: "xiaohongshu",
          provider: "multi_search_engine",
          provider_priority: [
            "multi_search_engine",
            "tavily",
            "bing_search_api",
          ],
          tavily_api_key: "tavily-new-key",
          bing_search_api_key: "bing-new-key",
          google_search_api_key: "google-new-key",
          google_search_engine_id: "cx-new-id",
          multi_search: expect.objectContaining({
            priority: ["google", "bing"],
            timeout_ms: 4000,
          }),
        }),
        image_gen: expect.objectContaining({
          image_search_pexels_api_key: "new-key",
          image_search_pixabay_api_key: "new-pixabay-key",
        }),
      }),
    );
    expect(container.textContent).toContain("网络搜索设置已保存");
  });

  it("点击一键申请 Key 应打开官方申请页面", async () => {
    const container = renderComponent();
    await flushEffects();
    await flushEffects();

    await act(async () => {
      findButton(container, "申请 Pexels Key").click();
      await flushEffects();
    });

    expect(mockOpen).toHaveBeenCalledWith("https://www.pexels.com/api/new/");
  });

  it("点击 Tavily 申请按钮应打开官方页面", async () => {
    const container = renderComponent();
    await flushEffects();
    await flushEffects();

    await act(async () => {
      findButton(container, "申请 Tavily Key").click();
      await flushEffects();
    });

    expect(mockOpen).toHaveBeenCalledWith("https://app.tavily.com/");
  });

  it("插件打开失败时应回退到 window.open", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockOpen.mockRejectedValueOnce(new Error("plugin failed"));
    const fallbackSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    try {
      const container = renderComponent();
      await flushEffects();
      await flushEffects();

      await act(async () => {
        findButton(container, "申请 Pexels Key").click();
        await flushEffects();
      });

      expect(fallbackSpy).toHaveBeenCalledWith(
        "https://www.pexels.com/api/new/",
        "_blank",
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("点击 Pixabay 申请按钮应打开官方页面", async () => {
    const container = renderComponent();
    await flushEffects();
    await flushEffects();

    await act(async () => {
      findButton(container, "申请 Pixabay Key").click();
      await flushEffects();
    });

    expect(mockOpen).toHaveBeenCalledWith(
      "https://pixabay.com/accounts/register/",
    );
  });

  it("点击 Bing 申请按钮应打开 Azure 页面", async () => {
    const container = renderComponent();
    await flushEffects();
    await flushEffects();

    await act(async () => {
      findButton(container, "申请 Bing Key").click();
      await flushEffects();
    });

    expect(mockOpen).toHaveBeenCalledWith(
      "https://portal.azure.com/#create/Microsoft.CognitiveServicesBingSearch-v7",
    );
  });

  it("点击 Google 申请按钮应打开 Google Cloud API 页面", async () => {
    const container = renderComponent();
    await flushEffects();
    await flushEffects();

    await act(async () => {
      findButton(container, "申请 Google Key").click();
      await flushEffects();
    });

    expect(mockOpen).toHaveBeenCalledWith(
      "https://console.cloud.google.com/apis/library/customsearch.googleapis.com",
    );
  });

  it("点击创建 CSE 按钮应打开可编程搜索引擎页面", async () => {
    const container = renderComponent();
    await flushEffects();
    await flushEffects();

    await act(async () => {
      findButton(container, "创建 CSE").click();
      await flushEffects();
    });

    expect(mockOpen).toHaveBeenCalledWith(
      "https://programmablesearchengine.google.com/",
    );
  });
});
