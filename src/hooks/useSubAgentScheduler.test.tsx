import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke, mockSafeListen } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockSafeListen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeListen: mockSafeListen,
}));

import {
  shouldConsumeSchedulerEvent,
  useSubAgentScheduler,
} from "./useSubAgentScheduler";

interface ProbeProps {
  sessionId?: string | null;
  onReady: ReturnType<typeof vi.fn>;
}

function HookProbe({ sessionId, onReady }: ProbeProps) {
  const scheduler = useSubAgentScheduler(sessionId);

  useEffect(() => {
    onReady(scheduler);
  }, [onReady, scheduler]);

  return null;
}

describe("useSubAgentScheduler", () => {
  let container: HTMLDivElement;
  let root: Root;
  let schedulerEventHandler:
    | ((event: { payload: Record<string, unknown> }) => void)
    | null;
  let latestScheduler: ReturnType<typeof useSubAgentScheduler> | null;
  let onReady: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    schedulerEventHandler = null;
    latestScheduler = null;
    onReady = vi.fn((scheduler) => {
      latestScheduler = scheduler;
    });

    mockInvoke.mockReset();
    mockSafeListen.mockReset();
    mockSafeListen.mockImplementation(async (_event, handler) => {
      schedulerEventHandler = handler;
      return vi.fn();
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  async function flushEffects() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  async function renderProbe(sessionId?: string | null) {
    await act(async () => {
      root.render(<HookProbe sessionId={sessionId} onReady={onReady} />);
    });
    await flushEffects();
  }

  it("应只消费当前会话的调度事件", async () => {
    await renderProbe("session-a");

    expect(schedulerEventHandler).not.toBeNull();

    await act(async () => {
      schedulerEventHandler?.({
        payload: {
          type: "started",
          totalTasks: 2,
          sessionId: "session-b",
        },
      });
    });

    expect(latestScheduler?.events).toHaveLength(0);
    expect(latestScheduler?.isRunning).toBe(false);

    await act(async () => {
      schedulerEventHandler?.({
        payload: {
          type: "started",
          totalTasks: 2,
          sessionId: "session-a",
        },
      });
    });

    expect(latestScheduler?.events).toHaveLength(1);
    expect(latestScheduler?.isRunning).toBe(true);
  });

  it("切换会话后应重置状态，并在执行时透传 sessionId", async () => {
    mockInvoke.mockResolvedValue({
      success: true,
      results: [],
      totalDurationMs: 0,
      successfulCount: 0,
      failedCount: 0,
      skippedCount: 0,
      totalTokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    });

    await renderProbe("session-a");

    await act(async () => {
      schedulerEventHandler?.({
        payload: {
          type: "started",
          totalTasks: 1,
          sessionId: "session-a",
        },
      });
    });

    expect(latestScheduler?.isRunning).toBe(true);
    expect(latestScheduler?.events).toHaveLength(1);

    await renderProbe("session-b");

    expect(latestScheduler?.isRunning).toBe(false);
    expect(latestScheduler?.events).toHaveLength(0);

    await act(async () => {
      await latestScheduler?.execute([
        {
          id: "task-1",
          taskType: "code",
          prompt: "检查 harness",
        },
      ]);
    });

    expect(mockInvoke).toHaveBeenCalledWith("execute_subagent_tasks", {
      tasks: [
        {
          id: "task-1",
          taskType: "code",
          prompt: "检查 harness",
        },
      ],
      config: undefined,
      sessionId: "session-b",
    });
  });
});

describe("shouldConsumeSchedulerEvent", () => {
  it("应兼容 camelCase 与 snake_case 的 sessionId", () => {
    expect(
      shouldConsumeSchedulerEvent({ sessionId: "session-a" }, "session-a"),
    ).toBe(true);
    expect(
      shouldConsumeSchedulerEvent({ session_id: "session-a" }, "session-a"),
    ).toBe(true);
    expect(
      shouldConsumeSchedulerEvent({ sessionId: "session-b" }, "session-a"),
    ).toBe(false);
  });
});
