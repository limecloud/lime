import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceTeamSessionControlRuntime } from "./useWorkspaceTeamSessionControlRuntime";

const { toast } = vi.hoisted(() => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

const {
  closeAgentRuntimeSubagent,
  resumeAgentRuntimeSubagent,
  sendAgentRuntimeSubagentInput,
  waitAgentRuntimeSubagents,
} = vi.hoisted(() => ({
  closeAgentRuntimeSubagent: vi.fn(),
  resumeAgentRuntimeSubagent: vi.fn(),
  sendAgentRuntimeSubagentInput: vi.fn(),
  waitAgentRuntimeSubagents: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast,
}));

vi.mock("@/lib/api/agentRuntime", () => ({
  closeAgentRuntimeSubagent,
  resumeAgentRuntimeSubagent,
  sendAgentRuntimeSubagentInput,
  waitAgentRuntimeSubagents,
}));

type HookProps = Parameters<typeof useWorkspaceTeamSessionControlRuntime>[0];

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestValue: ReturnType<
    typeof useWorkspaceTeamSessionControlRuntime
  > | null = null;

  const defaultProps: HookProps = {
    childSubagentSessions: [],
    liveRuntimeBySessionId: {},
    stopSending: vi.fn().mockResolvedValue(undefined),
  };

  function Probe(currentProps: HookProps) {
    latestValue = useWorkspaceTeamSessionControlRuntime(currentProps);
    return null;
  }

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<Probe {...defaultProps} {...props} {...nextProps} />);
      await Promise.resolve();
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

describe("useWorkspaceTeamSessionControlRuntime", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    toast.error.mockReset();
    toast.info.mockReset();
    toast.success.mockReset();
    closeAgentRuntimeSubagent.mockReset();
    resumeAgentRuntimeSubagent.mockReset();
    sendAgentRuntimeSubagentInput.mockReset();
    waitAgentRuntimeSubagents.mockReset();
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

  it("等待任一活跃任务超时时应提示任务状态", async () => {
    waitAgentRuntimeSubagents.mockResolvedValue({
      timed_out: true,
      status: {},
    });
    const { render, getValue } = renderHook();

    await render();

    await act(async () => {
      await getValue().handleWaitActiveTeamSessions(["task-1", "task-2"]);
    });

    expect(getValue().teamWaitSummary).toMatchObject({
      awaitedSessionIds: ["task-1", "task-2"],
      timedOut: true,
    });
    expect(toast.info).toHaveBeenCalledWith(
      "等待超时，团队内活跃任务仍未进入最终状态",
    );
  });

  it("收起已完成任务后应提示任务语义的成功消息", async () => {
    closeAgentRuntimeSubagent
      .mockResolvedValueOnce({
        changed_session_ids: ["task-1"],
        cascade_session_ids: [],
      })
      .mockResolvedValueOnce({
        changed_session_ids: ["task-2"],
        cascade_session_ids: [],
      });
    const { render, getValue } = renderHook();

    await render();

    await act(async () => {
      await getValue().handleCloseCompletedTeamSessions(["task-1", "task-2"]);
    });

    expect(getValue().teamControlSummary).toMatchObject({
      action: "close_completed",
      requestedSessionIds: ["task-1", "task-2"],
      affectedSessionIds: ["task-1", "task-2"],
    });
    expect(toast.success).toHaveBeenCalledWith("已级联收起 2 项任务");
  });

  it("停止发送后批量暂停任务时应提示任务语义", async () => {
    const stopSending = vi.fn().mockResolvedValue(undefined);
    closeAgentRuntimeSubagent
      .mockResolvedValueOnce({
        changed_session_ids: ["task-1"],
        cascade_session_ids: [],
      })
      .mockResolvedValueOnce({
        changed_session_ids: ["task-2"],
        cascade_session_ids: [],
      });
    const { render, getValue } = renderHook({
      stopSending,
      childSubagentSessions: [
        {
          id: "task-1",
          name: "分析",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "收敛问题边界",
        },
        {
          id: "task-2",
          name: "执行",
          created_at: 1_710_000_010,
          updated_at: 1_710_000_120,
          session_type: "sub_agent",
          runtime_status: "queued",
          latest_turn_status: "queued",
          task_summary: "等待接手",
        },
      ],
    });

    await render();

    await act(async () => {
      await getValue().handleStopSending();
    });

    expect(stopSending).toHaveBeenCalledTimes(1);
    expect(getValue().teamControlSummary).toMatchObject({
      action: "close",
      requestedSessionIds: ["task-1", "task-2"],
      affectedSessionIds: ["task-1", "task-2"],
    });
    expect(toast.success).toHaveBeenCalledWith("已暂停 2 项任务的处理");
  });
});
