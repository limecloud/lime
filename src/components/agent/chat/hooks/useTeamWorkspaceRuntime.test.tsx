import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTeamWorkspaceRuntime } from "./useTeamWorkspaceRuntime";

const {
  mockSafeListen,
  mockParseStreamEvent,
} = vi.hoisted(() => ({
  mockSafeListen: vi.fn(),
  mockParseStreamEvent: vi.fn((payload: unknown) => payload),
}));

vi.mock("@/lib/api/agentStream", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api/agentStream")>(
      "@/lib/api/agentStream",
    );
  return {
    ...actual,
    parseStreamEvent: mockParseStreamEvent,
  };
});

vi.mock("@/lib/dev-bridge", () => ({
  safeListen: mockSafeListen,
}));

type HookProps = Parameters<typeof useTeamWorkspaceRuntime>[0];

let latestValue: ReturnType<typeof useTeamWorkspaceRuntime> | null = null;
const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function HookProbe(props: HookProps) {
  latestValue = useTeamWorkspaceRuntime(props);
  return null;
}

async function flushHookEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderHookProbe(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: HookProps = {
    currentSessionId: "parent-1",
    childSubagentSessions: [
      {
        id: "child-1",
        name: "研究员",
        created_at: 1_710_000_000,
        updated_at: 1_710_000_100,
        session_type: "sub_agent",
        runtime_status: "queued",
        latest_turn_status: "queued",
        task_summary: "整理竞品与数据来源",
        role_hint: "explorer",
      },
    ],
  };

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<HookProbe {...defaultProps} {...props} {...nextProps} />);
      await Promise.resolve();
    });
    await flushHookEffects();
  };

  await render();
  mountedRoots.push({ root, container });
  return { render };
}

describe("useTeamWorkspaceRuntime", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    latestValue = null;
    mockParseStreamEvent.mockImplementation((payload: unknown) => payload);
    mockSafeListen.mockImplementation(
      async (_eventName: string, _handler: (event: { payload: unknown }) => void) =>
        () => {},
    );
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
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("收到 team 状态事件后，应立即投影 live runtime 与 live activity，并在去抖后递增刷新版本", async () => {
    const listeners = new Map<
      string,
      (event: { payload: unknown }) => void
    >();
    mockSafeListen.mockImplementation(
      async (eventName: string, handler: (event: { payload: unknown }) => void) => {
        listeners.set(eventName, handler);
        return () => {
          listeners.delete(eventName);
        };
      },
    );

    await renderHookProbe();

    expect(mockSafeListen).toHaveBeenCalledWith(
      "agent_subagent_status:parent-1",
      expect.any(Function),
    );
    expect(latestValue?.liveRuntimeBySessionId["child-1"]).toBeUndefined();

    await act(async () => {
      listeners.get("agent_subagent_status:parent-1")?.({
        payload: {
          type: "subagent_status_changed",
          session_id: "child-1",
          root_session_id: "parent-1",
          status: "running",
        },
      });
      await Promise.resolve();
    });

    expect(latestValue?.liveRuntimeBySessionId["child-1"]?.runtimeStatus).toBe(
      "running",
    );
    expect(
      latestValue?.liveActivityBySessionId["child-1"]?.[0]?.detail,
    ).toContain("已切换为运行中");
    expect(
      latestValue?.activityRefreshVersionBySessionId["child-1"] ?? 0,
    ).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(239);
      await Promise.resolve();
    });
    expect(
      latestValue?.activityRefreshVersionBySessionId["child-1"] ?? 0,
    ).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(
      latestValue?.activityRefreshVersionBySessionId["child-1"] ?? 0,
    ).toBe(1);
  });

  it("收到子代理 runtime stream 事件后，应投影最近过程，并在关键完成事件后递增刷新版本", async () => {
    const listeners = new Map<
      string,
      (event: { payload: unknown }) => void
    >();
    mockSafeListen.mockImplementation(
      async (eventName: string, handler: (event: { payload: unknown }) => void) => {
        listeners.set(eventName, handler);
        return () => {
          listeners.delete(eventName);
        };
      },
    );

    await renderHookProbe();

    expect(mockSafeListen).toHaveBeenCalledWith(
      "agent_subagent_stream:child-1",
      expect.any(Function),
    );

    await act(async () => {
      listeners.get("agent_subagent_stream:child-1")?.({
        payload: {
          type: "tool_start",
          tool_name: "browser_snapshot",
          tool_id: "tool-1",
        },
      });
      await Promise.resolve();
    });

    expect(latestValue?.liveActivityBySessionId["child-1"]?.[0]?.title).toBe(
      "工具 browser_snapshot",
    );
    expect(
      latestValue?.liveActivityBySessionId["child-1"]?.[0]?.detail,
    ).toContain("正在执行 browser_snapshot");
    expect(
      latestValue?.activityRefreshVersionBySessionId["child-1"] ?? 0,
    ).toBe(0);

    await act(async () => {
      listeners.get("agent_subagent_stream:child-1")?.({
        payload: {
          type: "tool_end",
          tool_id: "tool-1",
          result: {
            success: true,
            output: "页面结构差异已提取完成。",
          },
        },
      });
      await Promise.resolve();
    });

    expect(latestValue?.liveActivityBySessionId["child-1"]?.[0]?.title).toBe(
      "工具 browser_snapshot",
    );
    expect(
      latestValue?.liveActivityBySessionId["child-1"]?.[0]?.detail,
    ).toContain("页面结构差异已提取完成");

    await act(async () => {
      vi.advanceTimersByTime(240);
      await Promise.resolve();
    });

    expect(
      latestValue?.activityRefreshVersionBySessionId["child-1"] ?? 0,
    ).toBe(1);
  });

  it("收到 turn_completed 后，应立即把 live runtime 从 running 回落到 completed", async () => {
    const listeners = new Map<
      string,
      (event: { payload: unknown }) => void
    >();
    mockSafeListen.mockImplementation(
      async (eventName: string, handler: (event: { payload: unknown }) => void) => {
        listeners.set(eventName, handler);
        return () => {
          listeners.delete(eventName);
        };
      },
    );

    await renderHookProbe({
      childSubagentSessions: [
        {
          id: "child-1",
          name: "研究员",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "整理竞品与数据来源",
          role_hint: "explorer",
        },
      ],
    });

    await act(async () => {
      listeners.get("agent_subagent_stream:child-1")?.({
        payload: {
          type: "turn_completed",
          turn: {
            id: "turn-1",
          },
        },
      });
      await Promise.resolve();
    });

    expect(latestValue?.liveRuntimeBySessionId["child-1"]?.runtimeStatus).toBe(
      "completed",
    );
    expect(
      latestValue?.liveRuntimeBySessionId["child-1"]?.latestTurnStatus,
    ).toBe("completed");
  });

  it("收到 final_done 且没有后续状态事件时，也应结束 running 状态", async () => {
    const listeners = new Map<
      string,
      (event: { payload: unknown }) => void
    >();
    mockSafeListen.mockImplementation(
      async (eventName: string, handler: (event: { payload: unknown }) => void) => {
        listeners.set(eventName, handler);
        return () => {
          listeners.delete(eventName);
        };
      },
    );

    await renderHookProbe({
      childSubagentSessions: [
        {
          id: "child-1",
          name: "研究员",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "整理竞品与数据来源",
          role_hint: "explorer",
        },
      ],
    });

    await act(async () => {
      listeners.get("agent_subagent_stream:child-1")?.({
        payload: {
          type: "final_done",
        },
      });
      await Promise.resolve();
    });

    expect(latestValue?.liveRuntimeBySessionId["child-1"]?.runtimeStatus).toBe(
      "completed",
    );
  });

  it("收到 error 后，应立即把 live runtime 从 running 回落到 failed", async () => {
    const listeners = new Map<
      string,
      (event: { payload: unknown }) => void
    >();
    mockSafeListen.mockImplementation(
      async (eventName: string, handler: (event: { payload: unknown }) => void) => {
        listeners.set(eventName, handler);
        return () => {
          listeners.delete(eventName);
        };
      },
    );

    await renderHookProbe({
      childSubagentSessions: [
        {
          id: "child-1",
          name: "研究员",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "整理竞品与数据来源",
          role_hint: "explorer",
        },
      ],
    });

    await act(async () => {
      listeners.get("agent_subagent_stream:child-1")?.({
        payload: {
          type: "error",
          message: "工具调用失败",
        },
      });
      await Promise.resolve();
    });

    expect(latestValue?.liveRuntimeBySessionId["child-1"]?.runtimeStatus).toBe(
      "failed",
    );
    expect(
      latestValue?.liveRuntimeBySessionId["child-1"]?.latestTurnStatus,
    ).toBe("failed");
  });

  it("base snapshot 追平或 session 移除后，应自动清理过期 live 状态", async () => {
    const listeners = new Map<
      string,
      (event: { payload: unknown }) => void
    >();
    mockSafeListen.mockImplementation(
      async (eventName: string, handler: (event: { payload: unknown }) => void) => {
        listeners.set(eventName, handler);
        return () => {
          listeners.delete(eventName);
        };
      },
    );

    const { render } = await renderHookProbe();

    await act(async () => {
      listeners.get("agent_subagent_status:parent-1")?.({
        payload: {
          type: "subagent_status_changed",
          session_id: "child-1",
          root_session_id: "parent-1",
          status: "running",
        },
      });
      await Promise.resolve();
    });

    expect(latestValue?.liveRuntimeBySessionId["child-1"]?.runtimeStatus).toBe(
      "running",
    );

    await render({
      childSubagentSessions: [
        {
          id: "child-1",
          name: "研究员",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_300,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "整理竞品与数据来源",
          role_hint: "explorer",
        },
      ],
    });

    expect(latestValue?.liveRuntimeBySessionId["child-1"]).toBeUndefined();
    expect(latestValue?.liveActivityBySessionId["child-1"]?.length ?? 0).toBe(1);

    await render({
      childSubagentSessions: [],
    });

    expect(latestValue?.liveRuntimeBySessionId["child-1"]).toBeUndefined();
    expect(latestValue?.liveActivityBySessionId["child-1"]).toBeUndefined();
    expect(
      latestValue?.activityRefreshVersionBySessionId["child-1"],
    ).toBeUndefined();
  });
});
