import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AsterSubagentParentContext,
  AsterSubagentSessionInfo,
} from "@/lib/api/agentRuntime";
import type {
  TeamWorkspaceLiveRuntimeState,
  TeamWorkspaceRuntimeFormationState,
} from "../../teamWorkspaceRuntime";
import { useTeamWorkspaceBoardSessionGraph } from "./useTeamWorkspaceBoardSessionGraph";

type HookProps = Parameters<typeof useTeamWorkspaceBoardSessionGraph>[0];

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function createSubagentSessionInfo(
  overrides: Partial<AsterSubagentSessionInfo> &
    Pick<AsterSubagentSessionInfo, "id" | "name">,
): AsterSubagentSessionInfo {
  return {
    created_at: overrides.created_at ?? 1,
    updated_at: overrides.updated_at ?? 2,
    session_type: overrides.session_type ?? "sub_agent",
    ...overrides,
  };
}

function createFormationState(
  overrides?: Partial<TeamWorkspaceRuntimeFormationState>,
): TeamWorkspaceRuntimeFormationState {
  return {
    requestId: overrides?.requestId ?? "dispatch-1",
    status: overrides?.status ?? "formed",
    label: overrides?.label ?? null,
    summary: overrides?.summary ?? null,
    members: overrides?.members ?? [],
    blueprint: overrides?.blueprint ?? null,
    errorMessage: overrides?.errorMessage ?? null,
    updatedAt: overrides?.updatedAt ?? 1,
  };
}

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let latestValue: ReturnType<typeof useTeamWorkspaceBoardSessionGraph> | null =
    null;

  const defaultProps: HookProps = {
    childSubagentSessions: [],
    currentSessionId: "parent-1",
    currentSessionLatestTurnStatus: "running",
    currentSessionName: "主线程",
    currentSessionQueuedTurnCount: 0,
    currentSessionRuntimeStatus: "running",
    liveRuntimeBySessionId: {},
    shellVisible: false,
    subagentParentContext: null,
    teamDispatchPreviewState: null,
  };

  function Probe(currentProps: HookProps) {
    latestValue = useTeamWorkspaceBoardSessionGraph(currentProps);
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

describe("useTeamWorkspaceBoardSessionGraph", () => {
  it("应在子成员上下文里用 live runtime 覆盖当前任务进行时图谱", async () => {
    const subagentParentContext = {
      parent_session_id: "parent-1",
      parent_session_name: "主线程",
      task_summary: "拆解主线并推进。",
      role_hint: "analysis",
      blueprint_role_id: "role-analysis",
      blueprint_role_label: "分析",
      role_key: "analysis",
      sibling_subagent_sessions: [
        createSubagentSessionInfo({
          id: "child-verifier",
          name: "复核成员",
          runtime_status: "queued",
          latest_turn_status: "queued",
          queued_turn_count: 2,
          blueprint_role_id: "role-verify",
          blueprint_role_label: "验证",
          role_key: "verifier",
        }),
        createSubagentSessionInfo({
          id: "child-executor",
          name: "执行成员",
          runtime_status: "running",
          latest_turn_status: "running",
          queued_turn_count: 1,
          blueprint_role_id: "role-executor",
          blueprint_role_label: "执行",
          role_key: "executor",
        }),
      ],
    } as AsterSubagentParentContext;
    const liveRuntimeBySessionId: Record<
      string,
      TeamWorkspaceLiveRuntimeState
    > = {
      "child-current": {
        runtimeStatus: "running",
        latestTurnStatus: "running",
        queuedTurnCount: 3,
        teamActiveCount: 1,
        teamParallelBudget: 2,
        baseFingerprint: "child-current:live",
      },
      "child-executor": {
        runtimeStatus: "completed",
        latestTurnStatus: "completed",
        queuedTurnCount: 0,
        baseFingerprint: "child-executor:live",
      },
    };
    const harness = renderHook({
      childSubagentSessions: [
        createSubagentSessionInfo({
          id: "ignored-root-child",
          name: "不会进入当前子成员视图",
          runtime_status: "running",
        }),
      ],
      currentSessionId: "child-current",
      currentSessionLatestTurnStatus: "queued",
      currentSessionName: "分析成员",
      currentSessionQueuedTurnCount: 1,
      currentSessionRuntimeStatus: "queued",
      liveRuntimeBySessionId,
      subagentParentContext,
      teamDispatchPreviewState: createFormationState({
        blueprint: {
          label: "主线 Team",
          summary: "分析、执行、验证并行推进。",
          roles: [
            {
              id: "role-analysis",
              label: "分析",
              summary: "收敛当前主线边界。",
              roleKey: "analysis",
            },
            {
              id: "role-executor",
              label: "执行",
              summary: "落实当前改动。",
              roleKey: "executor",
            },
            {
              id: "role-verify",
              label: "验证",
              summary: "确认任务进行时语义。",
              roleKey: "verifier",
            },
          ],
        },
      }),
    });

    await harness.render();

    expect(harness.getValue().isChildSession).toBe(true);
    expect(harness.getValue().canvasStorageScopeId).toBe("child-current");
    expect(harness.getValue().hasRealTeamGraph).toBe(true);
    expect(harness.getValue().isEmptyShellState).toBe(false);
    expect(harness.getValue().siblingCount).toBe(2);
    expect(harness.getValue().totalTeamSessions).toBe(3);
    expect(harness.getValue().currentChildSession).toMatchObject({
      id: "child-current",
      name: "分析成员",
      runtimeStatus: "running",
      latestTurnStatus: "running",
      queuedTurnCount: 3,
      teamActiveCount: 1,
      teamParallelBudget: 2,
      isCurrent: true,
    });
    expect(harness.getValue().visibleSessions).toMatchObject([
      {
        id: "child-verifier",
        runtimeStatus: "queued",
        latestTurnStatus: "queued",
        queuedTurnCount: 2,
      },
      {
        id: "child-executor",
        runtimeStatus: "completed",
        latestTurnStatus: "completed",
        queuedTurnCount: 0,
      },
    ]);
    expect(
      harness.getValue().visibleSessions.map((session) => session.id),
    ).toEqual(["child-verifier", "child-executor"]);
    expect(
      harness.getValue().visibleSessions.some(
        (session) => session.id === "ignored-root-child",
      ),
    ).toBe(false);
    expect(
      harness.getValue().railSessions.map((session) => session.id),
    ).toEqual(["child-current", "child-verifier", "child-executor"]);
    expect(
      harness.getValue().memberCanvasSessions.map((session) => session.id),
    ).toEqual(["child-current", "child-verifier", "child-executor"]);
    expect(
      harness.getValue().basePreviewableRailSessions.map((session) => session.id),
    ).toEqual(["child-current", "child-verifier", "child-executor"]);
  });

  it("应在空 shell 态下回退到 dispatch preview request id 作为 schedule 作用域", async () => {
    const harness = renderHook({
      currentSessionId: "   ",
      currentSessionName: "主线程",
      shellVisible: true,
      teamDispatchPreviewState: createFormationState({
        requestId: "dispatch-preview-42",
        status: "forming",
      }),
    });

    await harness.render();

    expect(harness.getValue().isChildSession).toBe(false);
    expect(harness.getValue().hasRealTeamGraph).toBe(false);
    expect(harness.getValue().isEmptyShellState).toBe(true);
    expect(harness.getValue().canvasStorageScopeId).toBe(
      "dispatch-preview-42",
    );
    expect(harness.getValue().currentChildSession).toBeNull();
    expect(harness.getValue().visibleSessions).toEqual([]);
    expect(harness.getValue().baseRailSessions).toEqual([]);
    expect(harness.getValue().railSessions).toEqual([]);
    expect(harness.getValue().memberCanvasSessions).toEqual([]);
    expect(harness.getValue().basePreviewableRailSessions).toEqual([]);
    expect(harness.getValue().totalTeamSessions).toBe(0);
  });
});
