import { describe, expect, it } from "vitest";

import {
  summarizeSubAgentProgress,
  summarizeSubAgentResult,
  summarizeSubAgentTask,
  summarizeSubAgentTaskBatch,
} from "./subAgentSummary";

describe("subAgentSummary", () => {
  it("应优先使用 description 生成任务摘要", () => {
    expect(
      summarizeSubAgentTask({
        id: "task-1",
        taskType: "research",
        prompt: "检查 MCP 连接",
        description: "梳理 MCP 连接状态",
      }),
    ).toBe("梳理 MCP 连接状态");
  });

  it("应生成批次启动摘要与进度摘要", () => {
    expect(
      summarizeSubAgentTaskBatch([
        {
          id: "task-1",
          taskType: "research",
          prompt: "检查 MCP",
          description: "检查 MCP 连接",
        },
        {
          id: "task-2",
          taskType: "code",
          prompt: "整理批次摘要",
        },
      ]),
    ).toBe("准备执行：检查 MCP 连接、整理批次摘要 共 2 项");

    expect(
      summarizeSubAgentProgress({
        total: 3,
        completed: 1,
        failed: 0,
        skipped: 0,
        currentTasks: ["task-b"],
      }),
    ).toBe("正在执行：task-b");
  });

  it("应在没有 mergedSummary 时回退到结果统计摘要", () => {
    expect(
      summarizeSubAgentResult(
        {
          success: true,
          successfulCount: 2,
          failedCount: 1,
          skippedCount: 0,
        },
        [
          {
            id: "task-1",
            taskType: "research",
            prompt: "检查",
          },
        ],
      ),
    ).toBe("已完成 2 项，失败 1 项");
  });

  it("单任务成功但后端未回填 successfulCount 时，仍应给出完成摘要", () => {
    expect(
      summarizeSubAgentResult(
        {
          success: true,
          successfulCount: 0,
          failedCount: 0,
          skippedCount: 0,
        },
        [
          {
            id: "task-1",
            taskType: "research",
            prompt: "检查 harness",
            description: "检查 harness 主入口",
          },
        ],
      ),
    ).toBe("已完成：检查 harness 主入口");
  });
});
