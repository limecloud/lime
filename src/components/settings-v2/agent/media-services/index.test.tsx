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
});
