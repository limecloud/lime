import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TeamWorkbenchSummaryPanel } from "./TeamWorkbenchSummaryPanel";

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

function renderPanel(
  props: Partial<Parameters<typeof TeamWorkbenchSummaryPanel>[0]> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <TeamWorkbenchSummaryPanel
        currentSessionQueuedTurnCount={0}
        childSubagentSessions={[]}
        selectedTeamRoles={[]}
        liveRuntimeBySessionId={{}}
        liveActivityBySessionId={{}}
        {...props}
      />,
    );
  });

  mountedRoots.push({ container, root });
  return container;
}

describe("TeamWorkbenchSummaryPanel", () => {
  it("应在主视图中展示 Team 记忆影子卡片", () => {
    const container = renderPanel({
      selectedTeamLabel: "研究双人组",
      selectedTeamSummary: "分析、实现、验证三段式推进。",
      teamMemorySnapshot: {
        repoScope: "/workspace/lime",
        entries: {
          "team.selection": {
            key: "team.selection",
            content: "Team：研究双人组\n角色：\n- 研究员：梳理上下文",
            updatedAt: 100,
          },
        },
      },
    });

    expect(container.textContent).toContain("团队工作台");
    expect(container.textContent).toContain("协作记忆影子");
    expect(container.textContent).toContain("/workspace/lime");
    expect(container.textContent).toContain("当前 Team");
    expect(container.textContent).toContain("研究双人组");
  });
});
