import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TeamMemoryShadowCard } from "./TeamMemoryShadowCard";

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedHarness[] = [];

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
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
});

function renderCard(
  snapshot?: Parameters<typeof TeamMemoryShadowCard>[0]["snapshot"],
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<TeamMemoryShadowCard snapshot={snapshot} />);
  });

  mountedRoots.push({ container, root });
  return container;
}

describe("TeamMemoryShadowCard", () => {
  it("没有快照时不应渲染", () => {
    const container = renderCard(null);

    expect(
      container.querySelector('[data-testid="team-memory-shadow-card"]'),
    ).toBeNull();
  });

  it("应展示 repo 作用域和关键任务记忆条目", () => {
    const container = renderCard({
      repoScope: "/workspace/lime",
      entries: {
        "team.selection": {
          key: "team.selection",
          content: "Team：研究双人组\n角色：\n- 研究员：梳理上下文",
          updatedAt: 200,
        },
        "team.subagents": {
          key: "team.subagents",
          content: "子任务：\n- 研究代理 [running] explorer · 梳理主线风险",
          updatedAt: 300,
        },
        "team.parent_context": {
          key: "team.parent_context",
          content: "父会话：主线会话\n当前任务：汇总结论",
          updatedAt: 100,
        },
      },
    });

    expect(
      container.querySelector('[data-testid="team-memory-shadow-card"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("任务记忆影子");
    expect(container.textContent).toContain(
      "当前仓库已缓存 3 条分工续接上下文",
    );
    expect(container.textContent).toContain("/workspace/lime");
    expect(container.textContent).toContain("当前分工方案");
    expect(container.textContent).toContain("分工方案：研究双人组");
    expect(container.textContent).toContain("子任务概览");
    expect(container.textContent).toContain("子任务：");
    expect(container.textContent).toContain("父会话上下文");
    expect(container.textContent).toContain(
      "研究代理 [running] explorer · 梳理主线风险",
    );
    expect(container.textContent).toContain("当前任务：汇总结论");
  });
});
