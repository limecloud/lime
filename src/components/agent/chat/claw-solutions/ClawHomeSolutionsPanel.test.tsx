import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClawHomeSolutionsPanel } from "./ClawHomeSolutionsPanel";
import type { ClawSolutionHomeItem } from "./types";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

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
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

function renderPanel(
  props: React.ComponentProps<typeof ClawHomeSolutionsPanel>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ClawHomeSolutionsPanel {...props} />);
  });

  mountedRoots.push({ root, container });
  return container;
}

describe("ClawHomeSolutionsPanel", () => {
  it("应渲染方案信息并透传选择回调", () => {
    const solutions: ClawSolutionHomeItem[] = [
      {
        id: "social-post-starter",
        title: "社媒主稿生成",
        summary: "进入社媒专项工作台并生成一版首稿。",
        outputHint: "社媒首稿 + 平台结构",
        recommendedCapabilities: ["模型", "社媒主题"],
        readiness: "ready",
        readinessMessage: "可直接开始",
        badge: "社媒方案",
        recentUsedAt: null,
        isRecent: false,
        readinessLabel: "可直接开始",
        readinessTone: "emerald",
      },
    ];
    const onSelect = vi.fn();

    const container = renderPanel({
      solutions,
      onSelect,
    });

    expect(container.textContent).toContain("推荐方案");
    expect(container.textContent).toContain("社媒主稿生成");
    expect(container.textContent).toContain("产出：社媒首稿 + 平台结构");
    expect(container.textContent).toContain("可直接开始");
    expect(container.textContent).toContain("立即开始");

    const solutionButton = container.querySelector(
      '[data-testid="claw-solution-social-post-starter"]',
    ) as HTMLButtonElement | null;

    expect(solutionButton).toBeTruthy();

    act(() => {
      solutionButton?.click();
    });

    expect(onSelect).toHaveBeenCalledWith(solutions[0]);
  });

  it("加载中且无方案时应展示加载状态", () => {
    const container = renderPanel({
      solutions: [],
      loading: true,
      onSelect: vi.fn(),
    });

    expect(container.textContent).toContain("正在加载推荐方案");
  });

  it("未就绪方案应展示去配置动作文案", () => {
    const solutions: ClawSolutionHomeItem[] = [
      {
        id: "web-research-brief",
        title: "网页研究简报",
        summary: "先配置模型后再开始。",
        outputHint: "研究提纲 + 结论摘要",
        recommendedCapabilities: ["模型"],
        readiness: "needs_setup",
        readinessMessage: "请先配置模型",
        reasonCode: "missing_model",
        badge: "Claw 方案",
        recentUsedAt: null,
        isRecent: false,
        readinessLabel: "先配置模型",
        readinessTone: "amber",
      },
    ];

    const container = renderPanel({
      solutions,
      onSelect: vi.fn(),
    });

    expect(container.textContent).toContain("先配置模型");
    expect(container.textContent).toContain("去配置");
  });
});
