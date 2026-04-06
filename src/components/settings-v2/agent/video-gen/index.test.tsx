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

vi.mock("@/hooks/useApiKeyProvider", () => ({
  useApiKeyProvider: () => ({
    providers: [
      {
        id: "doubao-video",
        type: "openai",
        name: "豆包视频",
        enabled: true,
        api_key_count: 1,
        custom_models: ["seedance-1-5-pro-251215"],
      },
    ],
    loading: false,
  }),
}));

import { VideoGenSettings } from ".";

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
    root.render(<VideoGenSettings />);
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
        video: {
          preferredProviderId: "doubao-video",
          preferredModelId: "seedance-1-5-pro-251215",
          allowFallback: false,
        },
      },
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

describe("VideoGenSettings", () => {
  it("应加载全局视频默认设置", async () => {
    const container = renderComponent();
    await flushEffects();
    await flushEffects();

    expect(container.textContent).toContain("全局默认视频服务");
    expect(container.textContent).toContain("默认视频 Provider");
    expect(container.textContent).toContain("默认视频模型");
  });

  it("应把视频设置补充说明收进 tips", async () => {
    renderComponent();
    await flushEffects();
    await flushEffects();

    expect(getBodyText()).not.toContain(
      "这里配置的是全局默认视频服务。未在项目中单独覆盖时，视频素材与 AI 视频任务都会优先使用这里的 Provider / 模型。",
    );
    expect(getBodyText()).not.toContain(
      "关闭后，若全局默认视频服务缺失、被禁用或无可用 Key，将直接提示错误。",
    );

    const globalTip = await hoverTip("全局默认视频服务说明");
    expect(getBodyText()).toContain(
      "这里配置的是全局默认视频服务。未在项目中单独覆盖时，视频素材与 AI 视频任务都会优先使用这里的 Provider / 模型。",
    );
    await leaveTip(globalTip);

    const fallbackTip = await hoverTip("默认视频服务不可用时自动回退说明");
    expect(getBodyText()).toContain(
      "关闭后，若全局默认视频服务缺失、被禁用或无可用 Key，将直接提示错误。",
    );
    await leaveTip(fallbackTip);
  });

  it("恢复全局默认后应清空视频服务覆盖", async () => {
    const container = renderComponent();
    await flushEffects();
    await flushEffects();

    await act(async () => {
      findButton(container, "恢复默认").click();
      await flushEffects();
    });

    expect(mockSaveConfig).toHaveBeenCalledTimes(1);
    const savedConfig = mockSaveConfig.mock.calls[0][0];
    expect(savedConfig.workspace_preferences.media_defaults.video).toBeUndefined();
    expect(container.textContent).toContain("设置已保存");
  });
});
