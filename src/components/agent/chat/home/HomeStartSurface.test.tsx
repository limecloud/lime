import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeStartSurface } from "./HomeStartSurface";
import type {
  HomeGuideCard,
  HomeSkillSection,
  HomeSkillSurfaceItem,
  HomeStarterChip,
} from "./homeSurfaceTypes";

vi.mock("./HomeSceneSkillManagerDialog", () => ({
  HomeSceneSkillManagerDialog: ({
    open,
    onClose,
  }: {
    open: boolean;
    onClose: () => void;
  }) =>
    open ? (
      <div data-testid="home-scene-skill-manager-mock">
        <button type="button" onClick={onClose}>
          关闭管理
        </button>
      </div>
    ) : null,
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

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

function createStarterChips(): HomeStarterChip[] {
  return [
    {
      id: "starter-guide",
      label: "引导帮助",
      launchKind: "toggle_guide",
      testId: "home-guide-help-trigger",
    },
    {
      id: "starter-daily-trend",
      label: "帮我想选题",
      launchKind: "curated_task_launcher",
      targetItemId: "daily-trend-briefing",
      testId: "entry-recommended-daily-trend-briefing",
    },
    {
      id: "starter-more",
      label: "更多做法",
      launchKind: "open_drawer",
      testId: "home-more-skills-trigger",
    },
    {
      id: "starter-manager",
      label: "⚙",
      launchKind: "open_manager",
      testId: "home-skill-manager-trigger",
    },
  ];
}

function createGuideCards(): HomeGuideCard[] {
  return [
    {
      id: "guide-voice",
      title: "语音输入怎么设置？",
      summary: "把灵感直接说进生成容器。",
      prompt: "请告诉我语音输入怎么设置。",
      testId: "home-guide-voice",
    },
  ];
}

function renderSurface(options?: {
  starterChips?: HomeStarterChip[];
  sections?: HomeSkillSection[];
  supplementalActions?: React.ComponentProps<
    typeof HomeStartSurface
  >["supplementalActions"];
  guideCards?: HomeGuideCard[];
  onSelectStarterChip?: (chip: HomeStarterChip) => void;
  onSelectGuideCard?: (card: HomeGuideCard) => void;
  onSelectSkillItem?: (item: HomeSkillSurfaceItem) => void;
}) {
  const item = createItem();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onSelectStarterChip = options?.onSelectStarterChip ?? vi.fn();
  const onSelectGuideCard = options?.onSelectGuideCard ?? vi.fn();
  const onSelectSkillItem = options?.onSelectSkillItem ?? vi.fn();
  mountedRoots.push({ root, container });

  act(() => {
    root.render(
      <HomeStartSurface
        starterChips={options?.starterChips ?? createStarterChips()}
        guideCards={options?.guideCards ?? createGuideCards()}
        sections={
          options?.sections ?? [
            { id: "social", title: "社交媒体", items: [item] },
          ]
        }
        supplementalActions={options?.supplementalActions}
        onSelectStarterChip={onSelectStarterChip}
        onSelectGuideCard={onSelectGuideCard}
        onSelectSkillItem={onSelectSkillItem}
      />,
    );
  });

  return {
    container,
    item,
    onSelectStarterChip,
    onSelectGuideCard,
    onSelectSkillItem,
  };
}

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
});

describe("HomeStartSurface", () => {
  it("普通起手 chip 只透传给上层，不打开抽屉或管理弹窗", () => {
    const { container, onSelectStarterChip } = renderSurface();
    const chip = container.querySelector(
      '[data-testid="entry-recommended-daily-trend-briefing"]',
    ) as HTMLButtonElement | null;

    act(() => {
      chip?.click();
    });

    expect(onSelectStarterChip).toHaveBeenCalledWith(
      expect.objectContaining({ id: "starter-daily-trend" }),
    );
    expect(
      container.querySelector('[data-testid="home-more-skills-drawer"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="home-scene-skill-manager-mock"]'),
    ).toBeNull();
  });

  it("引导帮助 chip 展开帮助卡并把卡片选择交给上层", () => {
    const { container, onSelectGuideCard } = renderSurface();
    const guide = container.querySelector(
      '[data-testid="home-guide-help-trigger"]',
    ) as HTMLButtonElement | null;

    act(() => {
      guide?.click();
    });

    expect(
      container.querySelector('[data-testid="home-guide-cards"]'),
    ).toBeTruthy();

    const card = container.querySelector(
      '[data-testid="home-guide-voice"]',
    ) as HTMLButtonElement | null;
    act(() => {
      card?.click();
    });

    expect(onSelectGuideCard).toHaveBeenCalledWith(
      expect.objectContaining({ id: "guide-voice" }),
    );
  });

  it("更多做法 chip 切换抽屉，抽屉条目继续透传选择", () => {
    const { container, item, onSelectSkillItem } = renderSurface();
    const more = container.querySelector(
      '[data-testid="home-more-skills-trigger"]',
    ) as HTMLButtonElement | null;

    act(() => {
      more?.click();
    });

    expect(
      container.querySelector('[data-testid="home-more-skills-drawer"]'),
    ).toBeTruthy();

    const drawerItem = container.querySelector(
      '[data-testid="home-drawer-entry-recommended-daily-trend-briefing"]',
    ) as HTMLButtonElement | null;
    act(() => {
      drawerItem?.click();
    });

    expect(onSelectSkillItem).toHaveBeenCalledWith(item);
  });

  it("抽屉打开后按 Escape 可关闭", () => {
    const { container } = renderSurface();
    const more = container.querySelector(
      '[data-testid="home-more-skills-trigger"]',
    ) as HTMLButtonElement | null;

    act(() => {
      more?.click();
    });
    expect(
      container.querySelector('[data-testid="home-more-skills-drawer"]'),
    ).toBeTruthy();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(
      container.querySelector('[data-testid="home-more-skills-drawer"]'),
    ).toBeNull();
  });

  it("管理 chip 打开场景管理弹窗并允许关闭", () => {
    const { container } = renderSurface();
    const manager = container.querySelector(
      '[data-testid="home-skill-manager-trigger"]',
    ) as HTMLButtonElement | null;

    act(() => {
      manager?.click();
    });

    const dialog = container.querySelector(
      '[data-testid="home-scene-skill-manager-mock"]',
    );
    expect(dialog).toBeTruthy();

    const close = container.querySelector(
      '[data-testid="home-scene-skill-manager-mock"] button',
    ) as HTMLButtonElement | null;
    act(() => {
      close?.click();
    });

    expect(
      container.querySelector('[data-testid="home-scene-skill-manager-mock"]'),
    ).toBeNull();
  });

  it("补充入口使用轻按钮呈现并触发自身动作", () => {
    const onSelect = vi.fn();
    const { container } = renderSurface({
      supplementalActions: [
        {
          id: "connect-browser",
          label: "连接浏览器",
          testId: "entry-connect-browser",
          onSelect,
        },
      ],
    });

    const action = container.querySelector(
      '[data-testid="entry-connect-browser"]',
    ) as HTMLButtonElement | null;
    expect(action?.textContent).toBe("连接浏览器");

    act(() => {
      action?.click();
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
