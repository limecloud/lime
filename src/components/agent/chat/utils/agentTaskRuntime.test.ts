import { describe, expect, it } from "vitest";
import type { Message } from "../types";
import { buildAgentTaskRuntimeCardModel } from "./agentTaskRuntime";

describe("agentTaskRuntime", () => {
  it("简单直接回答完成后不应继续显示主任务卡", () => {
    const model = buildAgentTaskRuntimeCardModel({
      messages: [
        {
          id: "msg-user-hello",
          role: "user",
          content: "你好",
          timestamp: new Date("2026-04-14T10:00:00.000Z"),
        },
        {
          id: "msg-assistant-hello",
          role: "assistant",
          content: "你好！我是 Lime 助手。",
          timestamp: new Date("2026-04-14T10:00:02.000Z"),
          usage: {
            input_tokens: 2048,
            output_tokens: 256,
          },
        },
      ],
      turns: [
        {
          id: "turn-hello",
          thread_id: "thread-hello",
          prompt_text: "你好",
          status: "completed",
          started_at: "2026-04-14T10:00:00Z",
          completed_at: "2026-04-14T10:00:02Z",
          created_at: "2026-04-14T10:00:00Z",
          updated_at: "2026-04-14T10:00:02Z",
        },
      ],
      threadRead: {
        thread_id: "thread-hello",
        status: "completed",
      },
    });

    expect(model).toBeNull();
  });

  it("应在主会话执行工具批次时投影为可见任务卡", () => {
    const now = new Date("2026-04-14T10:00:00.000Z");
    const messages: Message[] = [
      {
        id: "msg-user-1",
        role: "user",
        content: "分析 claudecode 项目结构",
        timestamp: now,
      },
      {
        id: "msg-assistant-1",
        role: "assistant",
        content: "",
        timestamp: now,
        toolCalls: [
          {
            id: "tool-1",
            name: "Read",
            arguments: JSON.stringify({ file_path: "/repo/src/main.ts" }),
            status: "completed",
            startTime: now,
            endTime: now,
          },
          {
            id: "tool-2",
            name: "Grep",
            arguments: JSON.stringify({ pattern: "task", path: "/repo/src" }),
            status: "running",
            startTime: now,
          },
        ],
      },
    ];

    const model = buildAgentTaskRuntimeCardModel({
      messages,
      turns: [
        {
          id: "turn-1",
          thread_id: "thread-1",
          prompt_text: "分析 claudecode 项目结构",
          status: "running",
          started_at: "2026-04-14T10:00:00Z",
          created_at: "2026-04-14T10:00:00Z",
          updated_at: "2026-04-14T10:00:03Z",
        },
      ],
      currentTurnId: "turn-1",
      threadRead: {
        thread_id: "thread-1",
        status: "running",
      },
      childSubagentSessions: [
        {
          id: "sub-1",
          name: "代码浏览",
          created_at: now.getTime(),
          updated_at: now.getTime(),
          session_type: "subagent",
          runtime_status: "running",
        },
        {
          id: "sub-2",
          name: "回归检查",
          created_at: now.getTime(),
          updated_at: now.getTime(),
          session_type: "subagent",
          runtime_status: "completed",
        },
      ],
      isSending: true,
    });

    expect(model).not.toBeNull();
    expect(model?.status).toBe("running");
    expect(model?.phase).toBe("tool_batch");
    expect(model?.batchDescriptor?.title).toBe("已探索项目");
    expect(model?.supportingLines).toContain("子任务 1/2 进行中");
  });

  it("等待用户确认时应投影为 waiting_input", () => {
    const model = buildAgentTaskRuntimeCardModel({
      messages: [
        {
          id: "msg-user-1",
          role: "user",
          content: "继续执行危险命令",
          timestamp: new Date("2026-04-14T10:00:00.000Z"),
        },
      ],
      turns: [
        {
          id: "turn-1",
          thread_id: "thread-1",
          prompt_text: "继续执行危险命令",
          status: "running",
          started_at: "2026-04-14T10:00:00Z",
          created_at: "2026-04-14T10:00:00Z",
          updated_at: "2026-04-14T10:00:05Z",
        },
      ],
      currentTurnId: "turn-1",
      threadRead: {
        thread_id: "thread-1",
        status: "waiting_request",
        pending_requests: [
          {
            id: "req-1",
            thread_id: "thread-1",
            request_type: "tool_confirmation",
            status: "pending",
            title: "请确认是否继续执行 rm -rf",
          },
        ],
        diagnostics: {
          warning_count: 0,
          context_compaction_count: 0,
          failed_tool_call_count: 0,
          failed_command_count: 0,
          pending_request_count: 1,
          primary_blocking_summary: "等待你确认是否继续执行该命令",
        },
      },
      pendingActions: [
        {
          requestId: "req-1",
          actionType: "tool_confirmation",
          prompt: "请确认是否继续执行 rm -rf",
        },
      ],
    });

    expect(model?.status).toBe("waiting_input");
    expect(model?.phase).toBe("waiting_input");
    expect(model?.detail).toContain("等待你确认");
  });

  it("复杂任务完成后应自动折叠，回到消息级 usage 与结算展示", () => {
    const model = buildAgentTaskRuntimeCardModel({
      messages: [
        {
          id: "msg-user-1",
          role: "user",
          content: "总结这次修复",
          timestamp: new Date("2026-04-14T10:00:00.000Z"),
        },
        {
          id: "msg-assistant-1",
          role: "assistant",
          content: "已经定位到主问题，并完成前端任务视图补齐。",
          timestamp: new Date("2026-04-14T10:00:08.000Z"),
          usage: {
            input_tokens: 1200,
            output_tokens: 320,
            cached_input_tokens: 512,
            cache_creation_input_tokens: 128,
          },
        },
      ],
      turns: [
        {
          id: "turn-1",
          thread_id: "thread-1",
          prompt_text: "总结这次修复",
          status: "completed",
          started_at: "2026-04-14T10:00:00Z",
          completed_at: "2026-04-14T10:00:08Z",
          created_at: "2026-04-14T10:00:00Z",
          updated_at: "2026-04-14T10:00:08Z",
        },
      ],
      threadItems: [
        {
          id: "item-summary-1",
          type: "turn_summary",
          thread_id: "thread-1",
          turn_id: "turn-1",
          sequence: 4,
          status: "completed",
          started_at: "2026-04-14T10:00:08Z",
          completed_at: "2026-04-14T10:00:08Z",
          updated_at: "2026-04-14T10:00:08Z",
          text: "已补齐主任务卡，并恢复 token 与 Prompt Cache 可见性。",
        },
      ],
      threadRead: {
        thread_id: "thread-1",
        status: "completed",
      },
    });

    expect(model).toBeNull();
  });
});
