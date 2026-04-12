import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AsterSessionDetail } from "@/lib/api/agentRuntime";
import type { ActivityPreviewSession } from "../../team-workspace-runtime/activityPreviewSelectors";
import { useTeamWorkspaceActivityPreviews } from "./useTeamWorkspaceActivityPreviews";

const { mockGetAgentRuntimeSession } = vi.hoisted(() => ({
  mockGetAgentRuntimeSession: vi.fn(),
}));

vi.mock("@/lib/api/agentRuntime", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/agentRuntime")>(
    "@/lib/api/agentRuntime",
  );
  return {
    ...actual,
    getAgentRuntimeSession: mockGetAgentRuntimeSession,
  };
});

type HookProps = Parameters<typeof useTeamWorkspaceActivityPreviews>[0];

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function createSessionDetail(
  sessionId: string,
  text: string,
): AsterSessionDetail {
  return {
    id: sessionId,
    created_at: 1_710_000_000,
    updated_at: 1_710_000_100,
    messages: [],
    items: [
      {
        id: `${sessionId}-item-1`,
        thread_id: `${sessionId}-thread`,
        turn_id: `${sessionId}-turn`,
        sequence: 1,
        status: "completed",
        started_at: "2026-03-20T10:00:00Z",
        updated_at: "2026-03-20T10:00:03Z",
        type: "agent_message",
        text,
      },
    ],
  };
}

function createPreviewSession(
  id: string,
  overrides?: Partial<ActivityPreviewSession>,
): ActivityPreviewSession {
  return {
    id,
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
    await Promise.resolve();
  });
}

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let latestValue: ReturnType<typeof useTeamWorkspaceActivityPreviews> | null =
    null;

  const defaultProps: HookProps = {
    activityRefreshVersionBySessionId: {},
    activityTimelineEntryLimit: 4,
    basePreviewableRailSessions: [],
    liveActivityBySessionId: {},
    selectedBaseSession: null,
    selectedSession: null,
  };

  function Probe(currentProps: HookProps) {
    latestValue = useTeamWorkspaceActivityPreviews(currentProps);
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
  mockGetAgentRuntimeSession.mockReset();
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

  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useTeamWorkspaceActivityPreviews", () => {
  it("refreshVersion 变化时应重新抓取 stale preview", async () => {
    const session = createPreviewSession("child-refresh-1");
    mockGetAgentRuntimeSession
      .mockResolvedValueOnce(
        createSessionDetail("child-refresh-1", "首轮同步完成。"),
      )
      .mockResolvedValueOnce(
        createSessionDetail("child-refresh-1", "第二轮同步已更新。"),
      );

    const harness = renderHook({
      basePreviewableRailSessions: [session],
    });

    await harness.render();

    expect(mockGetAgentRuntimeSession).toHaveBeenCalledTimes(1);
    expect(
      harness.getValue().sessionActivityPreviewById["child-refresh-1"]?.preview,
    ).toContain("首轮同步完成");

    await harness.render({
      activityRefreshVersionBySessionId: {
        "child-refresh-1": 1,
      },
      basePreviewableRailSessions: [session],
    });

    expect(mockGetAgentRuntimeSession).toHaveBeenCalledTimes(2);
    expect(
      harness.getValue().sessionActivityPreviewById["child-refresh-1"]?.preview,
    ).toContain("第二轮同步已更新");
  });

  it("选中运行中的成员时应轮询，完成后应停止继续轮询", async () => {
    vi.useFakeTimers();
    const runningSession = createPreviewSession("child-poll-1", {
      runtimeStatus: "running",
      latestTurnStatus: "running",
    });
    const completedSession = createPreviewSession("child-poll-1", {
      runtimeStatus: "completed",
      latestTurnStatus: "completed",
    });
    mockGetAgentRuntimeSession.mockResolvedValue(
      createSessionDetail("child-poll-1", "轮询中的最新过程。"),
    );

    const harness = renderHook({
      pollIntervalMs: 1200,
      selectedBaseSession: runningSession,
      selectedSession: runningSession,
    });

    await harness.render();

    expect(mockGetAgentRuntimeSession).toHaveBeenCalledTimes(1);
    expect(harness.getValue().selectedSessionActivityState.shouldPoll).toBe(
      true,
    );

    await act(async () => {
      vi.advanceTimersByTime(1200);
      await Promise.resolve();
    });
    await flushHookEffects();

    expect(mockGetAgentRuntimeSession).toHaveBeenCalledTimes(2);

    await harness.render({
      pollIntervalMs: 1200,
      selectedBaseSession: completedSession,
      selectedSession: completedSession,
    });

    const callsAfterCompleted = mockGetAgentRuntimeSession.mock.calls.length;
    expect(harness.getValue().selectedSessionActivityState.shouldPoll).toBe(
      false,
    );

    await act(async () => {
      vi.advanceTimersByTime(2400);
      await Promise.resolve();
    });
    await flushHookEffects();

    expect(mockGetAgentRuntimeSession).toHaveBeenCalledTimes(
      callsAfterCompleted,
    );
  });
});
