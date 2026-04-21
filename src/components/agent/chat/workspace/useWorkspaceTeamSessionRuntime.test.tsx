import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceTeamSessionRuntime } from "./useWorkspaceTeamSessionRuntime";

const { mockUseTeamWorkspaceRuntime } = vi.hoisted(() => ({
  mockUseTeamWorkspaceRuntime: vi.fn(),
}));

vi.mock("../hooks", () => ({
  useTeamWorkspaceRuntime: mockUseTeamWorkspaceRuntime,
}));

type HookProps = Parameters<typeof useWorkspaceTeamSessionRuntime>[0];

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestValue: ReturnType<typeof useWorkspaceTeamSessionRuntime> | null =
    null;

  const defaultProps: HookProps = {
    sessionId: "session-1",
    topics: [
      {
        id: "session-1",
        title: "主助手",
      },
    ],
    turns: [{ status: "completed" }],
    queuedTurnCount: 0,
    isSending: false,
    subagentEnabled: false,
    childSubagentSessions: [],
    subagentParentContext: null,
  };

  function Probe(currentProps: HookProps) {
    latestValue = useWorkspaceTeamSessionRuntime(currentProps);
    return null;
  }

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<Probe {...defaultProps} {...props} {...nextProps} />);
      await Promise.resolve();
    });
  };

  mountedRoots.push({ container, root });

  return {
    render,
    getValue: () => {
      if (!latestValue) {
        throw new Error("hook 尚未初始化");
      }
      return latestValue;
    },
  };
}

describe("useWorkspaceTeamSessionRuntime", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    mockUseTeamWorkspaceRuntime.mockReset();
    mockUseTeamWorkspaceRuntime.mockReturnValue({
      liveRuntimeBySessionId: {},
      liveActivityBySessionId: {},
      activityRefreshVersionBySessionId: {},
    });
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

  it("存在运行态任务时应暴露 runtime sessions 语义并打开 team workspace", async () => {
    const harness = renderHook({
      childSubagentSessions: [
        {
          id: "task-1",
          name: "资料整理",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_010,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
        },
      ],
    });

    await harness.render();

    expect(harness.getValue()).toMatchObject({
      currentSessionTitle: "主助手",
      hasRuntimeSessions: true,
      teamWorkspaceEnabled: true,
    });
  });

  it("只有 subagent 开关开启时也应展示 workspace，但不应伪造 runtime sessions", async () => {
    const harness = renderHook({
      subagentEnabled: true,
    });

    await harness.render();

    expect(harness.getValue()).toMatchObject({
      hasRuntimeSessions: false,
      teamWorkspaceEnabled: true,
    });
  });
});
