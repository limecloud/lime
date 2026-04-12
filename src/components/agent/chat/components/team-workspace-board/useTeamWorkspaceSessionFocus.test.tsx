import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TeamWorkspaceWaitSummary } from "../../teamWorkspaceRuntime";
import type { TeamSessionCard } from "../../utils/teamWorkspaceSessions";
import { useTeamWorkspaceSessionFocus } from "./useTeamWorkspaceSessionFocus";

type HookProps = Parameters<typeof useTeamWorkspaceSessionFocus>[0];

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function createSession(
  id: string,
  overrides?: Partial<TeamSessionCard>,
): TeamSessionCard {
  return {
    id,
    name: `成员-${id}`,
    sessionType: "sub_agent",
    runtimeStatus: "completed",
    latestTurnStatus: "completed",
    ...overrides,
  };
}

async function flushHookEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let latestValue: ReturnType<typeof useTeamWorkspaceSessionFocus> | null =
    null;

  const defaultProps: HookProps = {
    baseRailSessions: [],
    currentSessionId: null,
    isChildSession: false,
    memberCanvasSessions: [],
    orchestratorSessionId: null,
    railSessions: [],
    visibleTeamWaitSummary: null,
  };

  function Probe(currentProps: HookProps) {
    latestValue = useTeamWorkspaceSessionFocus(currentProps);
    return null;
  }

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<Probe {...defaultProps} {...props} {...nextProps} />);
      await Promise.resolve();
    });
    await flushHookEffects();
  };

  mountedRoots.push({ root, container });

  return {
    getValue: () => {
      if (!latestValue) {
        throw new Error("hook 尚未初始化");
      }
      return latestValue;
    },
    render,
  };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      continue;
    }

    await act(async () => {
      mounted.root.unmount();
      await Promise.resolve();
    });
    mounted.container.remove();
  }
});

describe("useTeamWorkspaceSessionFocus", () => {
  it("主线程存在真实成员时应默认聚焦首个成员而不是 orchestrator", async () => {
    const orchestrator = createSession("parent-1", {
      name: "主线程",
      sessionType: "user",
    });
    const childOne = createSession("child-focus-1", {
      name: "研究员",
      runtimeStatus: "running",
      latestTurnStatus: "running",
    });
    const childTwo = createSession("child-focus-2", {
      name: "执行器",
    });
    const harness = renderHook({
      baseRailSessions: [orchestrator, childOne, childTwo],
      currentSessionId: "parent-1",
      isChildSession: false,
      memberCanvasSessions: [childOne, childTwo],
      orchestratorSessionId: "parent-1",
      railSessions: [orchestrator, childOne, childTwo],
    });

    await harness.render();

    expect(harness.getValue().selectedSession?.id).toBe("child-focus-1");
    expect(harness.getValue().selectedBaseSession?.id).toBe("child-focus-1");
    expect(harness.getValue().expandedSessionId).toBeNull();
  });

  it("team wait 命中结果时应自动聚焦并展开对应成员", async () => {
    const childOne = createSession("child-wait-1", {
      name: "研究员",
    });
    const childTwo = createSession("child-wait-2", {
      name: "执行器",
    });
    const harness = renderHook({
      baseRailSessions: [childOne, childTwo],
      currentSessionId: "parent-1",
      isChildSession: false,
      memberCanvasSessions: [childOne, childTwo],
      railSessions: [childOne, childTwo],
      visibleTeamWaitSummary: {
        awaitedSessionIds: ["child-wait-1", "child-wait-2"],
        timedOut: false,
        resolvedSessionId: "child-wait-2",
        resolvedStatus: "completed",
        updatedAt: 1_775_915_704_733,
      },
    });

    await harness.render();

    expect(harness.getValue().selectedSession?.id).toBe("child-wait-2");
    expect(harness.getValue().selectedBaseSession?.id).toBe("child-wait-2");
    expect(harness.getValue().expandedSessionId).toBe("child-wait-2");
  });

  it("同一个 team wait key 重新渲染时不应重复抢回用户焦点", async () => {
    const childOne = createSession("child-sticky-1", {
      name: "研究员",
    });
    const childTwo = createSession("child-sticky-2", {
      name: "执行器",
    });
    const waitSummary: TeamWorkspaceWaitSummary = {
      awaitedSessionIds: ["child-sticky-1", "child-sticky-2"],
      timedOut: false,
      resolvedSessionId: "child-sticky-2",
      resolvedStatus: "completed",
      updatedAt: 1_775_915_704_999,
    };
    const harness = renderHook({
      baseRailSessions: [childOne, childTwo],
      currentSessionId: "parent-1",
      isChildSession: false,
      memberCanvasSessions: [childOne, childTwo],
      railSessions: [childOne, childTwo],
      visibleTeamWaitSummary: waitSummary,
    });

    await harness.render();

    expect(harness.getValue().selectedSession?.id).toBe("child-sticky-2");

    await act(async () => {
      harness.getValue().focusSession("child-sticky-1");
      await Promise.resolve();
    });
    await flushHookEffects();

    await harness.render({
      visibleTeamWaitSummary: {
        ...waitSummary,
      },
    });

    expect(harness.getValue().selectedSession?.id).toBe("child-sticky-1");
    expect(harness.getValue().expandedSessionId).toBe("child-sticky-1");
  });
});
