import { describe, expect, it } from "vitest";

import {
  buildRealSubagentTimelineItems,
  buildSyntheticSubagentTimelineItems,
} from "./subagentTimeline";

describe("subagentTimeline", () => {
  it("应将调度事件映射为子代理 timeline items", () => {
    const items = buildSyntheticSubagentTimelineItems({
      threadId: "thread-1",
      turnId: "turn-1",
      baseTime: new Date("2026-03-13T10:00:00Z"),
      events: [
        { type: "started", totalTasks: 2 },
        { type: "taskStarted", taskId: "task-a", taskType: "research" },
        {
          type: "progress",
          progress: {
            total: 2,
            completed: 0,
            failed: 0,
            running: 1,
            pending: 1,
            skipped: 0,
            cancelled: false,
            currentTasks: ["task-a"],
            percentage: 50,
          },
        },
        { type: "taskCompleted", taskId: "task-a", durationMs: 1200 },
        { type: "completed", success: true, durationMs: 1800 },
      ],
    });

    expect(items.some((item) => item.id.includes(":run"))).toBe(true);
    expect(items.some((item) => item.id.includes("task-a"))).toBe(true);
    expect(items.find((item) => item.id.includes("task-a"))?.status).toBe(
      "completed",
    );
  });

  it("缺少 thread 或 turn 时应返回空数组", () => {
    expect(
      buildSyntheticSubagentTimelineItems({
        threadId: null,
        turnId: "turn-1",
        events: [{ type: "started", totalTasks: 1 }],
      }),
    ).toEqual([]);
  });

  it("应将真实 child session 投影为可归属到父 turn 的 timeline items", () => {
    const items = buildRealSubagentTimelineItems({
      threadId: "thread-1",
      turns: [
        {
          id: "turn-1",
          thread_id: "thread-1",
          prompt_text: "先做规划",
          status: "completed",
          started_at: "2026-03-18T10:00:00Z",
          completed_at: "2026-03-18T10:00:40Z",
          created_at: "2026-03-18T10:00:00Z",
          updated_at: "2026-03-18T10:00:40Z",
        },
        {
          id: "turn-2",
          thread_id: "thread-1",
          prompt_text: "再执行图片处理",
          status: "running",
          started_at: "2026-03-18T10:01:00Z",
          created_at: "2026-03-18T10:01:00Z",
          updated_at: "2026-03-18T10:01:20Z",
        },
      ],
      childSessions: [
        {
          id: "child-1",
          name: "Image #1",
          created_at: Date.parse("2026-03-18T10:01:05Z") / 1000,
          updated_at: Date.parse("2026-03-18T10:01:12Z") / 1000,
          session_type: "sub_agent",
          created_from_turn_id: "turn-2",
          role_hint: "image_editor",
          task_summary: "处理封面图细节优化",
          runtime_status: "running",
          model: "gpt-image-1",
        },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "real:subagent:child-1",
      turn_id: "turn-2",
      type: "subagent_activity",
      status: "in_progress",
      status_label: "running",
      session_id: "child-1",
      title: "Image #1",
      role: "image_editor",
    });
  });

  it("应优先使用 child session 的真实父 turn id 而不是时间推断", () => {
    const items = buildRealSubagentTimelineItems({
      threadId: "thread-1",
      turns: [
        {
          id: "turn-1",
          thread_id: "thread-1",
          prompt_text: "先做规划",
          status: "completed",
          started_at: "2026-03-18T10:00:00Z",
          completed_at: "2026-03-18T10:00:40Z",
          created_at: "2026-03-18T10:00:00Z",
          updated_at: "2026-03-18T10:00:40Z",
        },
        {
          id: "turn-2",
          thread_id: "thread-1",
          prompt_text: "再执行图片处理",
          status: "running",
          started_at: "2026-03-18T10:01:00Z",
          created_at: "2026-03-18T10:01:00Z",
          updated_at: "2026-03-18T10:01:20Z",
        },
      ],
      childSessions: [
        {
          id: "child-2",
          name: "Planner #1",
          created_at: Date.parse("2026-03-18T10:01:05Z") / 1000,
          updated_at: Date.parse("2026-03-18T10:01:10Z") / 1000,
          session_type: "sub_agent",
          created_from_turn_id: "turn-1",
          task_summary: "先做规划再回传",
          runtime_status: "completed",
        },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "real:subagent:child-2",
      turn_id: "turn-1",
      status: "completed",
      session_id: "child-2",
    });
  });
});
