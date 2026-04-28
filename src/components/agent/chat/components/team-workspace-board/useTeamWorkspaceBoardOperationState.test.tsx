import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTeamWorkspaceBoardOperationState } from "./useTeamWorkspaceBoardOperationState";

type HookProps = Parameters<typeof useTeamWorkspaceBoardOperationState>[0];

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let latestValue: ReturnType<
    typeof useTeamWorkspaceBoardOperationState
  > | null = null;

  const defaultProps: HookProps = {
    currentChildSession: null,
    currentSessionId: null,
    isChildSession: false,
    railSessions: [],
    teamControlSummary: null,
    teamWaitSummary: null,
    visibleSessions: [],
  };

  function Probe(currentProps: HookProps) {
    latestValue = useTeamWorkspaceBoardOperationState(currentProps);
    return null;
  }

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<Probe {...defaultProps} {...props} {...nextProps} />);
      await Promise.resolve();
    });
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

describe("useTeamWorkspaceBoardOperationState", () => {
  it("应从当前可见成员与主轨道派生 schedule 状态", async () => {
    const harness = renderHook({
      currentChildSession: {
        id: "child-1",
        name: "当前成员",
        runtimeStatus: "running",
        sessionType: "sub_agent",
      },
      currentSessionId: "child-1",
      isChildSession: true,
      railSessions: [
        {
          id: "child-1",
          name: "当前成员",
          runtimeStatus: "running",
          sessionType: "sub_agent",
        },
        {
          id: "child-2",
          name: "资料整理",
          runtimeStatus: "queued",
          sessionType: "sub_agent",
        },
        {
          id: "child-3",
          name: "已完成成员",
          runtimeStatus: "completed",
          sessionType: "sub_agent",
        },
        {
          id: "user-main",
          name: "主线程",
          runtimeStatus: "running",
          sessionType: "user",
        },
      ],
      visibleSessions: [
        {
          id: "child-1",
          name: "当前成员",
          runtimeStatus: "running",
          sessionType: "sub_agent",
        },
        {
          id: "child-2",
          name: "资料整理",
          runtimeStatus: "queued",
          sessionType: "sub_agent",
        },
      ],
    });

    await harness.render();

    expect(harness.getValue().statusSummary).toEqual({
      queued: 1,
      running: 1,
    });
    expect(harness.getValue().waitableTeamSessionIds).toEqual([
      "child-1",
      "child-2",
    ]);
    expect(harness.getValue().completedTeamSessionIds).toEqual(["child-3"]);
  });

  it("应只展示当前可见成员相关的等待动态", async () => {
    const harness = renderHook({
      railSessions: [
        {
          id: "child-1",
          name: "资料整理",
          runtimeStatus: "running",
          sessionType: "sub_agent",
        },
      ],
      teamControlSummary: {
        action: "close_completed",
        affectedSessionIds: ["hidden-child"],
        cascadeSessionIds: [],
        requestedSessionIds: ["hidden-child"],
        updatedAt: 100,
      },
      teamWaitSummary: {
        awaitedSessionIds: ["child-1"],
        resolvedSessionId: "child-1",
        resolvedStatus: "completed",
        timedOut: false,
        updatedAt: 200,
      },
      visibleSessions: [
        {
          id: "child-1",
          name: "资料整理",
          runtimeStatus: "running",
          sessionType: "sub_agent",
        },
      ],
    });

    await harness.render();

    expect(harness.getValue().visibleTeamWaitSummary).toEqual({
      awaitedSessionIds: ["child-1"],
      resolvedSessionId: "child-1",
      resolvedStatus: "completed",
      timedOut: false,
      updatedAt: 200,
    });
    expect(harness.getValue().teamOperationEntries).toHaveLength(1);
    expect(harness.getValue().teamOperationEntries[0]).toMatchObject({
      targetSessionId: "child-1",
      title: "收到结果",
    });
    expect(harness.getValue().teamOperationEntries[0]?.detail).toContain(
      "资料整理",
    );
  });
});
