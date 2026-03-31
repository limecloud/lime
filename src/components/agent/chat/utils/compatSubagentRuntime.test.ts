import { describe, expect, it } from "vitest";

import {
  buildCompatSubagentRuntimeSnapshot,
  summarizeCompatSubagentEvent,
} from "./compatSubagentRuntime";

describe("compatSubagentRuntime", () => {
  it("应将 compat scheduler 状态投影为最近活动摘要", () => {
    const snapshot = buildCompatSubagentRuntimeSnapshot({
      isRunning: true,
      progress: {
        total: 3,
        completed: 1,
        failed: 0,
        running: 1,
        pending: 1,
        skipped: 0,
        cancelled: false,
        currentTasks: ["task-b"],
        percentage: 33,
      },
      events: [
        { type: "started", totalTasks: 3 },
        { type: "taskStarted", taskId: "task-a", taskType: "research" },
        {
          type: "progress",
          progress: {
            total: 3,
            completed: 1,
            failed: 0,
            running: 1,
            pending: 1,
            skipped: 0,
            cancelled: false,
            currentTasks: ["task-b"],
            percentage: 33,
          },
        },
        { type: "taskCompleted", taskId: "task-a", durationMs: 1200 },
        { type: "completed", success: true, durationMs: 4200 },
      ],
      result: {
        success: true,
        results: [],
        totalDurationMs: 4200,
        successfulCount: 1,
        failedCount: 0,
        skippedCount: 0,
        mergedSummary: "已完成汇总",
        totalTokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
      },
      error: null,
      summary: "已完成 1 项子任务",
    });

    expect(snapshot.hasSignals).toBe(true);
    expect(snapshot.summary).toBe("已完成 1 项子任务");
    expect(snapshot.recentActivity).toHaveLength(4);
    expect(snapshot.recentActivity[0]?.summary).toBe("调度完成，耗时 4 秒");
    expect(snapshot.recentActivity[3]?.summary).toBe("任务 task-a 开始执行");
  });

  it("应为队列拒绝和超时事件生成可读摘要", () => {
    expect(
      summarizeCompatSubagentEvent({
        type: "queueRejected",
        requested: 5,
        limit: 3,
      }),
    ).toBe("队列已拒绝：请求 5，上限 3");

    expect(
      summarizeCompatSubagentEvent({
        type: "taskTimedOut",
        taskId: "task-c",
        timeoutMs: 1500,
      }),
    ).toBe("任务 task-c 超时：1500 ms");
  });
});
