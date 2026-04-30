import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeMoreSkillsDrawer } from "./HomeMoreSkillsDrawer";
import type {
  HomeSkillSection,
  HomeSkillSurfaceItem,
} from "./homeSurfaceTypes";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function createItem(id: string, title: string): HomeSkillSurfaceItem {
  return {
    id,
    title,
    summary: `${title} 摘要`,
    category: "social",
    sourceKind: "curated_task",
    launchKind: "curated_task_launcher",
    coverToken: "trend",
    isRecent: false,
    isRecommended: true,
    usedAt: null,
    testId: `entry-recommended-${id}`,
  };
}

function renderDrawer(
  sections: HomeSkillSection[],
  open = true,
  onSelectItem = vi.fn(),
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  act(() => {
    root.render(
      <HomeMoreSkillsDrawer
        open={open}
        sections={sections}
        onSelectItem={onSelectItem}
      />,
    );
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

describe("HomeMoreSkillsDrawer", () => {
  it("关闭时不渲染抽屉", () => {
    const { container } = renderDrawer(
      [
        {
          id: "social",
          title: "社交媒体",
          items: [createItem("draft", "写第一版")],
        },
      ],
      false,
    );

    expect(
      container.querySelector('[data-testid="home-more-skills-drawer"]'),
    ).toBeNull();
  });

  it("按分组渲染 compact 做法列表并触发选择", () => {
    const item = createItem("draft", "写第一版");
    const { container, onSelectItem } = renderDrawer([
      { id: "recent", title: "最近使用", items: [item] },
    ]);

    expect(container.textContent).toContain("最近使用");
    expect(container.textContent).toContain("/写第一版");

    const button = container.querySelector(
      '[data-testid="home-drawer-entry-recommended-draft"]',
    ) as HTMLButtonElement | null;
    expect(button).toBeTruthy();

    act(() => {
      button?.click();
    });

    expect(onSelectItem).toHaveBeenCalledWith(item);
  });
});
