import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CompleteStep } from "./CompleteStep";
import { WelcomeStep } from "./WelcomeStep";

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

const mounted: Mounted[] = [];

function renderStep(element: ReactElement): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  mounted.push({ container, root });
  return container;
}

function getText(container: HTMLElement): string {
  return (container.textContent ?? "").replace(/\s+/g, " ").trim();
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

describe("onboarding steps copy", () => {
  it("欢迎页应只展示现役能力文案", () => {
    const container = renderStep(
      <WelcomeStep onNext={vi.fn()} onSkip={vi.fn()} />,
    );
    const text = getText(container);

    expect(text).toContain("欢迎使用 Lime");
    expect(text).toContain("持续工作区");
    expect(text).toContain(
      "围绕同一目标持续整理对话、素材和结果，减少来回切换。",
    );
    expect(text).toContain("语音交互");
    expect(text).not.toContain("插件扩展");
    expect(text).not.toContain("按需安装");
    expect(text).not.toContain("丰富的插件生态");
  });

  it("完成页不再引导去插件中心安装插件", () => {
    const container = renderStep(<CompleteStep onFinish={vi.fn()} />);
    const text = getText(container);

    expect(text).toContain("设置完成！");
    expect(text).toContain("提示：后续可在设置中继续调整语音输入和快捷键。");
    expect(text).not.toContain("插件中心");
    expect(text).not.toContain("安装插件");
  });
});
