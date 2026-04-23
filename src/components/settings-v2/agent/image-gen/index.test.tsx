import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetConfig, mockSaveConfig } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
}));

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: mockGetConfig,
  saveConfig: mockSaveConfig,
}));

vi.mock("@/components/input-kit", () => ({
  ModelSelector: ({
    providerType,
    model,
    placeholderLabel,
  }: {
    providerType: string;
    model: string;
    placeholderLabel?: string;
  }) => {
    const providerLabel =
      providerType === "relay-openai" ? "Relay OpenAI" : providerType;
    return (
      <div data-testid="image-model-selector">
        {providerLabel || placeholderLabel || "自动选择"} /{" "}
        {model || placeholderLabel || "自动选择"}
      </div>
    );
  },
}));

vi.mock("@/hooks/useApiKeyProvider", () => ({
  useApiKeyProvider: () => ({
    providers: [
      {
        id: "relay-openai",
        type: "openai",
        name: "Relay OpenAI",
        enabled: true,
        api_key_count: 1,
        custom_models: ["gpt-images-2"],
      },
      {
        id: "fal",
        type: "fal",
        name: "Fal",
        enabled: true,
        api_key_count: 1,
        custom_models: ["fal-ai/nano-banana-pro"],
      },
      {
        id: "tts-only",
        type: "audio",
        name: "TTS Only",
        enabled: true,
        api_key_count: 1,
        custom_models: ["gpt-4o-mini-tts"],
      },
    ],
    loading: false,
  }),
}));

import { ImageGenSettings } from ".";

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
    root.render(<ImageGenSettings />);
  });
  mounted.push({ container, root });
  return container;
}

async function flushEffects(times = 2) {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
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

function findSection(container: HTMLElement, title: string): HTMLElement {
  const heading = Array.from(container.querySelectorAll("h3")).find((node) =>
    node.textContent?.includes(title),
  );
  if (!heading) {
    throw new Error(`未找到区块标题: ${title}`);
  }
  const section = heading.closest("section");
  if (!section) {
    throw new Error(`未找到区块容器: ${title}`);
  }
  return section as HTMLElement;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  vi.clearAllMocks();

  mockGetConfig.mockResolvedValue({
    workspace_preferences: {
      media_defaults: {
        image: {
          preferredProviderId: "relay-openai",
          preferredModelId: "gpt-images-2",
          allowFallback: true,
        },
      },
    },
    image_gen: {
      default_count: 3,
      default_quality: "hd",
    },
  });
  mockSaveConfig.mockResolvedValue(undefined);
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

describe("ImageGenSettings", () => {
  it("应加载简化后的图片服务模型设置，并保留 gpt-images-2 选择", async () => {
    const container = renderComponent();
    await flushEffects(3);

    expect(container.textContent).toContain("图片服务模型");
    expect(container.textContent).toContain("Relay OpenAI");
    expect(container.textContent).toContain("gpt-images-2");
    expect(container.textContent).not.toContain("默认图像生成服务");
    expect(container.textContent).not.toContain("默认图像数量");
    expect(container.textContent).not.toContain("图像质量");

    const section = findSection(container, "图片服务模型");
    expect(section.className).toContain("overflow-visible");
    expect(section.className).not.toContain("overflow-hidden");
  });

  it("应把图片设置补充说明收进 tips", async () => {
    renderComponent();
    await flushEffects(3);

    expect(getBodyText()).not.toContain(
      "这里只配置图片生成任务的默认 Provider、模型与回退策略；默认图片数量等全局参数统一收口到同页下方的 AI 图片设置。",
    );
    expect(getBodyText()).not.toContain(
      "关闭后，若当前默认图片服务缺失、被禁用或无可用 Key，将直接提示错误。",
    );

    const sectionTip = await hoverTip("图片服务模型说明");
    expect(getBodyText()).toContain(
      "这里只配置图片生成任务的默认 Provider、模型与回退策略；默认图片数量等全局参数统一收口到同页下方的 AI 图片设置。",
    );
    await leaveTip(sectionTip);

    const fallbackTip = await hoverTip("Provider 不可用时自动回退说明");
    expect(getBodyText()).toContain(
      "关闭后，若当前默认图片服务缺失、被禁用或无可用 Key，将直接提示错误。",
    );
    await leaveTip(fallbackTip);
  });

  it("恢复默认后应清空图片服务覆盖", async () => {
    const container = renderComponent();
    await flushEffects(3);

    await act(async () => {
      findButton(container, "恢复默认").click();
      await flushEffects(2);
    });

    expect(mockSaveConfig).toHaveBeenCalledTimes(1);
    const savedConfig = mockSaveConfig.mock.calls[0][0];
    expect(
      savedConfig.workspace_preferences.media_defaults.image,
    ).toBeUndefined();
    expect(container.textContent).toContain("设置已保存");
  });
});
