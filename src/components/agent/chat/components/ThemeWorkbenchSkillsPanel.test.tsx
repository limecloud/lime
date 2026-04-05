import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeWorkbenchSkillsPanel } from "./ThemeWorkbenchSkillsPanel";

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
  props?: Partial<React.ComponentProps<typeof ThemeWorkbenchSkillsPanel>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: React.ComponentProps<typeof ThemeWorkbenchSkillsPanel> = {
    skills: [
      {
        key: "content_post_with_cover",
        name: "content_post_with_cover",
        description: "内容文案与封面生成",
        directory: "content_post_with_cover",
        installed: true,
        sourceKind: "builtin",
      },
      {
        key: "research",
        name: "research",
        description: "信息检索与趋势分析",
        directory: "research",
        installed: true,
        sourceKind: "builtin",
      },
      {
        key: "typesetting",
        name: "typesetting",
        description: "主稿排版与润色",
        directory: "typesetting",
        installed: true,
        sourceKind: "builtin",
      },
    ],
    currentGate: {
      key: "topic_select",
      title: "选题闸门",
      status: "waiting",
      description: "请确认本轮选题方向",
    },
    workspaceSummary: {
      activeContextCount: 2,
      searchResultCount: 5,
      versionCount: 3,
      runState: "await_user_decision",
    },
    onTriggerSkill: vi.fn(),
  };

  act(() => {
    root.render(<ThemeWorkbenchSkillsPanel {...defaultProps} {...props} />);
  });

  mountedRoots.push({ root, container });
  return {
    container,
    props: { ...defaultProps, ...props },
  };
}

describe("ThemeWorkbenchSkillsPanel", () => {
  it("传入折叠回调时应显示折叠按钮并可触发", () => {
    const onRequestCollapse = vi.fn();
    const { container } = renderPanel({ onRequestCollapse });

    const collapseButton = container.querySelector(
      'button[aria-label="折叠操作面板"]',
    ) as HTMLButtonElement | null;
    expect(collapseButton).toBeTruthy();

    if (collapseButton) {
      act(() => {
        collapseButton.click();
      });
    }
    expect(onRequestCollapse).toHaveBeenCalledTimes(1);
  });

  it("应显示操作面板、阶段摘要、推荐动作与统计信息", () => {
    const { container } = renderPanel();
    expect(container.textContent).toContain("操作面板");
    expect(container.textContent).toContain("阶段摘要");
    expect(container.textContent).toContain("选题闸门");
    expect(container.textContent).toContain("推荐动作");
    expect(container.textContent).toContain("可执行能力");
    expect(container.textContent).toContain("启用上下文");
    expect(container.textContent).toContain("搜索结果");
    expect(container.textContent).toContain("版本快照");
    expect(container.textContent).toContain("待决策");
    expect(container.textContent).toContain("research");
    expect(container.textContent).toContain("content_post_with_cover");
  });

  it("点击推荐技能应触发 onTriggerSkill 回调", () => {
    const onTriggerSkill = vi.fn();
    const { container } = renderPanel({ onTriggerSkill });

    const skillButton = container.querySelector(
      'button[aria-label="执行技能 research"]',
    ) as HTMLButtonElement | null;
    expect(skillButton).not.toBeNull();

    if (skillButton) {
      act(() => {
        skillButton.click();
      });
    }

    expect(onTriggerSkill).toHaveBeenCalledTimes(1);
    expect(onTriggerSkill.mock.calls[0][0]?.key).toBe("research");
  });
});
