import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../image-gen", () => ({
  ImageGenSettings: () => <div>图片配置内容</div>,
}));

vi.mock("../video-gen", () => ({
  VideoGenSettings: () => <div>视频配置内容</div>,
}));

vi.mock("../voice", () => ({
  VoiceSettings: () => <div>语音配置内容</div>,
}));

import { MediaServicesSettings } from ".";

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

const mounted: Mounted[] = [];

function renderComponent(
  props: Partial<ComponentProps<typeof MediaServicesSettings>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<MediaServicesSettings {...props} />);
  });

  mounted.push({ container, root });
  return container;
}

async function flushEffects(times = 6) {
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
    await flushEffects();
  });

  return trigger as HTMLButtonElement;
}

async function leaveTip(trigger: HTMLButtonElement | null) {
  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    await flushEffects();
  });
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(text),
  );

  if (!button) {
    throw new Error(`未找到按钮: ${text}`);
  }

  return button as HTMLButtonElement;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  while (mounted.length > 0) {
    const target = mounted.pop();
    if (!target) {
      break;
    }

    act(() => {
      target.root.unmount();
    });
    target.container.remove();
  }
});

describe("MediaServicesSettings", () => {
  it("默认应展示图片服务页签", async () => {
    const container = renderComponent();
    await flushEffects();
    const text = container.textContent ?? "";

    expect(text).toContain("媒体服务");
    expect(text).toContain("图片配置内容");
    expect(text).not.toContain("视频配置内容");
  });

  it("应支持通过初始参数打开语音页签", async () => {
    const container = renderComponent({ initialSection: "voice" });
    await flushEffects();
    const text = container.textContent ?? "";

    expect(text).toContain("语音配置内容");
    expect(text).not.toContain("图片配置内容");
  });

  it("点击页签后应切换到视频配置", async () => {
    const container = renderComponent();
    await flushEffects();

    act(() => {
      findButton(container, "视频服务").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flushEffects();

    const text = container.textContent ?? "";
    expect(text).toContain("视频配置内容");
    expect(text).not.toContain("图片配置内容");
  });

  it("应把首屏说明和当前策略说明收进 tips", async () => {
    renderComponent();
    await flushEffects();

    expect(getBodyText()).not.toContain(
      "将图片、视频和语音的全局默认服务集中到一个工作台里管理，减少在侧栏来回切换，也让默认策略更容易统一。",
    );

    const heroTip = await hoverTip("媒体服务总览说明");
    expect(getBodyText()).toContain(
      "将图片、视频和语音的全局默认服务集中到一个工作台里管理，减少在侧栏来回切换，也让默认策略更容易统一。",
    );
    await leaveTip(heroTip);

    const panelTip = await hoverTip("图片生成默认策略说明");
    expect(getBodyText()).toContain(
      "适合统一新项目的出图入口、常用模型和默认质量参数，避免重复在项目里逐个配置。",
    );
    await leaveTip(panelTip);
  });
});
