import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeSkillGallery } from "./HomeSkillGallery";
import type { HomeSkillSurfaceItem } from "./homeSurfaceTypes";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function createItem(): HomeSkillSurfaceItem {
  return {
    id: "daily-trend-briefing",
    title: "每日趋势摘要",
    summary: "先收一版内容趋势。",
    category: "social",
    sourceKind: "curated_task",
    launchKind: "curated_task_launcher",
    coverToken: "trend",
    isRecent: false,
    isRecommended: true,
    usedAt: null,
    testId: "entry-recommended-daily-trend-briefing",
  };
}

function renderGallery(items: HomeSkillSurfaceItem[], onSelectItem = vi.fn()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  act(() => {
    root.render(<HomeSkillGallery items={items} onSelectItem={onSelectItem} />);
  });

  return { container, onSelectItem };
}

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
});

describe("HomeSkillGallery", () => {
  it("空列表不渲染第二屏任务库", () => {
    const { container } = renderGallery([]);

    expect(
      container.querySelector('[data-testid="home-skill-gallery"]'),
    ).toBeNull();
  });

  it("渲染第二屏任务卡并触发选择", () => {
    const item = createItem();
    const { container, onSelectItem } = renderGallery([item]);

    expect(container.textContent).toContain("你可以从这些任务开始");
    expect(container.textContent).toContain("每日趋势摘要");

    const button = container.querySelector(
      '[data-testid="home-gallery-entry-recommended-daily-trend-briefing"]',
    ) as HTMLButtonElement | null;
    expect(button).toBeTruthy();

    act(() => {
      button?.click();
    });

    expect(onSelectItem).toHaveBeenCalledWith(item);
  });
});
