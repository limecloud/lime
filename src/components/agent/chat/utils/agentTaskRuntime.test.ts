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
          content: "已经定位到主问题，并完成前端当前进展补齐。",
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

  it("submittedActionsInFlight 命中同一请求时不应继续判定为 waiting_input", () => {
    const model = buildAgentTaskRuntimeCardModel({
      messages: [
        {
          id: "msg-user-1",
          role: "user",
          content: "继续完善文案",
          timestamp: new Date("2026-05-06T10:00:00.000Z"),
        },
        {
          id: "msg-assistant-1",
          role: "assistant",
          content: "",
          timestamp: new Date("2026-05-06T10:00:01.000Z"),
          runtimeStatus: {
            phase: "routing",
            title: "已提交补充信息，继续执行中",
            detail: "补充信息已回填到当前执行链路，正在恢复后续步骤。",
          },
        },
      ],
      turns: [
        {
          id: "turn-1",
          thread_id: "thread-1",
          prompt_text: "继续完善文案",
          status: "running",
          started_at: "2026-05-06T10:00:00Z",
          created_at: "2026-05-06T10:00:00Z",
          updated_at: "2026-05-06T10:00:03Z",
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
            request_type: "ask_user",
            status: "pending",
            title: "请补充品牌语气",
          },
        ],
        diagnostics: {
          warning_count: 0,
          context_compaction_count: 0,
          failed_tool_call_count: 0,
          failed_command_count: 0,
          pending_request_count: 1,
          primary_blocking_summary: "等待你补充品牌语气",
        },
      },
      submittedActionsInFlight: [
        {
          requestId: "req-1",
          actionType: "ask_user",
          status: "submitted",
          prompt: "请补充品牌语气",
        },
      ],
    });

    expect(model?.status).toBe("running");
    expect(model?.phase).toBe("reasoning");
    expect(model?.pendingRequestCount).toBe(0);
    expect(model?.detail).toContain("恢复后续步骤");
    expect(model?.supportingLines).not.toContain("等待你补充品牌语气");
  });

  it("运行时权限确认等待不应投影为普通失败任务", () => {
    const internalError =
      "运行时权限声明需要真实确认，当前 turn 已在模型执行前等待用户确认：confirmationStatus=not_requested，askProfileKeys=web_search。已创建真实权限确认请求；请确认后重试或恢复本轮执行。";
    const model = buildAgentTaskRuntimeCardModel({
      messages: [
        {
          id: "msg-user-runtime-permission",
          role: "user",
          content: "@搜索 OpenAI 最新模型公告",
          timestamp: new Date("2026-05-06T10:00:00.000Z"),
        },
      ],
      turns: [
        {
          id: "turn-runtime-permission",
          thread_id: "thread-1",
          prompt_text: "@搜索 OpenAI 最新模型公告",
          status: "failed",
          error_message: internalError,
          started_at: "2026-05-06T10:00:00Z",
          completed_at: "2026-05-06T10:00:01Z",
          created_at: "2026-05-06T10:00:00Z",
          updated_at: "2026-05-06T10:00:01Z",
        },
      ],
      currentTurnId: "turn-runtime-permission",
      threadItems: [
        {
          id: "permission-request-1",
          thread_id: "thread-1",
          turn_id: "turn-runtime-permission",
          sequence: 1,
          status: "in_progress",
          started_at: "2026-05-06T10:00:00Z",
          updated_at: "2026-05-06T10:00:00Z",
          type: "request_user_input",
          request_id: "runtime_permission_confirmation:turn-runtime-permission",
          action_type: "elicitation",
          prompt:
            "当前执行需要确认运行时权限：web_search。确认后才允许继续模型执行；拒绝会保持阻断。",
        },
        {
          id: "permission-error-1",
          thread_id: "thread-1",
          turn_id: "turn-runtime-permission",
          sequence: 2,
          status: "failed",
          started_at: "2026-05-06T10:00:01Z",
          completed_at: "2026-05-06T10:00:01Z",
          updated_at: "2026-05-06T10:00:01Z",
          type: "error",
          message: internalError,
        },
      ],
    });

    expect(model?.status).toBe("waiting_input");
    expect(model?.phase).toBe("waiting_input");
    expect(model?.detail).toContain("当前执行需要确认运行时权限");
    expect(model?.detail || "").not.toContain("confirmationStatus");
    expect(model?.detail || "").not.toContain("askProfileKeys");
  });

  it("运行时权限确认提交后不应保留失败任务卡", () => {
    const internalError =
      "运行时权限声明需要真实确认，当前 turn 已在模型执行前等待用户确认：confirmationStatus=confirmed，askProfileKeys=web_search。已创建真实权限确认请求；请确认后重试或恢复本轮执行。";
    const model = buildAgentTaskRuntimeCardModel({
      messages: [
        {
          id: "msg-user-runtime-permission-submitted",
          role: "user",
          content: "@搜索 OpenAI 最新模型公告",
          timestamp: new Date("2026-05-06T10:00:00.000Z"),
        },
      ],
      turns: [
        {
          id: "turn-runtime-permission-submitted",
          thread_id: "thread-1",
          prompt_text: "@搜索 OpenAI 最新模型公告",
          status: "failed",
          error_message: internalError,
          started_at: "2026-05-06T10:00:00Z",
          completed_at: "2026-05-06T10:00:01Z",
          created_at: "2026-05-06T10:00:00Z",
          updated_at: "2026-05-06T10:00:01Z",
        },
      ],
      currentTurnId: "turn-runtime-permission-submitted",
      threadItems: [
        {
          id: "permission-request-submitted",
          thread_id: "thread-1",
          turn_id: "turn-runtime-permission-submitted",
          sequence: 1,
          status: "completed",
          started_at: "2026-05-06T10:00:00Z",
          completed_at: "2026-05-06T10:00:00Z",
          updated_at: "2026-05-06T10:00:00Z",
          type: "request_user_input",
          request_id: "runtime_permission_confirmation:turn-runtime-permission-submitted",
          action_type: "elicitation",
          prompt:
            "当前执行需要确认运行时权限：web_search。确认后才允许继续模型执行；拒绝会保持阻断。",
          response: { answer: "允许本次执行" },
        },
        {
          id: "permission-error-submitted",
          thread_id: "thread-1",
          turn_id: "turn-runtime-permission-submitted",
          sequence: 2,
          status: "failed",
          started_at: "2026-05-06T10:00:01Z",
          completed_at: "2026-05-06T10:00:01Z",
          updated_at: "2026-05-06T10:00:01Z",
          type: "error",
          message: internalError,
        },
      ],
      pendingActions: [
        {
          requestId:
            "runtime_permission_confirmation:turn-runtime-permission-submitted",
          actionType: "elicitation",
          prompt:
            "当前执行需要确认运行时权限：web_search。确认后才允许继续模型执行；拒绝会保持阻断。",
          status: "submitted",
          submittedUserData: { answer: "允许本次执行" },
        },
      ],
    });

    expect(model).toBeNull();
  });
});
