import { describe, expect, it, vi } from "vitest";
import type { AgentThreadItem, AgentThreadTurn } from "../types";
import {
  applyAgentStreamErrorToastPlan,
  buildAgentStreamErrorFailurePlan,
  buildAgentStreamErrorToastPlan,
  buildAgentStreamFailedAssistantMessagePatch,
  buildAgentStreamFailedTimelineItemUpdate,
  buildAgentStreamFailedTimelineStatePlan,
  buildAgentStreamFailedTimelineTurnUpdate,
  selectAgentStreamFailedTimelineTurn,
} from "./agentStreamErrorController";

describe("agentStreamErrorController", () => {
  it("应把 rate limit 错误展示为 warning toast", () => {
    expect(buildAgentStreamErrorToastPlan("HTTP 429 rate limit")).toEqual({
      level: "warning",
      message: "请求过于频繁，请稍后重试",
    });
  });

  it("应把普通错误展示为 runtime error toast", () => {
    expect(buildAgentStreamErrorToastPlan("provider failed")).toEqual({
      level: "error",
      message: "响应错误: provider failed",
    });
  });

  it("应构造失败 assistant 消息 patch，并保留局部输出", () => {
    expect(
      buildAgentStreamFailedAssistantMessagePatch({
        accumulatedContent: "已输出一半",
        errorMessage: "provider failed",
        previousContent: "旧内容",
      }),
    ).toMatchObject({
      isThinking: false,
      content: "已输出一半\n\n执行失败：provider failed",
      runtimeStatus: {
        phase: "failed",
        title: "当前处理失败",
        detail: "provider failed",
      },
    });
  });

  it("应在无局部输出时回退 previousContent，并按需带回 usage", () => {
    const usage = { input_tokens: 1, output_tokens: 2 };
    expect(
      buildAgentStreamFailedAssistantMessagePatch({
        accumulatedContent: "",
        errorMessage: "boom",
        previousContent: "旧内容",
        usage,
      }),
    ).toMatchObject({
      content: "旧内容\n\n执行失败：boom",
      usage,
    });
  });

  it("应构造错误失败副作用计划", () => {
    expect(
      buildAgentStreamErrorFailurePlan({
        errorMessage: "provider failed",
        queuedTurnId: "queued-1",
      }),
    ).toEqual({
      errorMessage: "provider failed",
      queuedTurnIds: ["queued-1"],
      requestLogPayload: {
        eventType: "chat_request_error",
        status: "error",
        error: "provider failed",
      },
      toast: {
        level: "error",
        message: "响应错误: provider failed",
      },
    });
  });

  it("错误失败计划应保留 rate limit toast 降级", () => {
    expect(
      buildAgentStreamErrorFailurePlan({
        errorMessage: "HTTP 429 rate limit",
      }),
    ).toMatchObject({
      queuedTurnIds: [],
      toast: {
        level: "warning",
        message: "请求过于频繁，请稍后重试",
      },
    });
  });

  it("应按错误 toast level 调用对应 dispatcher", () => {
    const dispatcher = {
      error: vi.fn(),
      warning: vi.fn(),
    };

    applyAgentStreamErrorToastPlan(
      { level: "warning", message: "请求过于频繁" },
      dispatcher,
    );
    applyAgentStreamErrorToastPlan(
      { level: "error", message: "响应错误" },
      dispatcher,
    );

    expect(dispatcher.warning).toHaveBeenCalledWith("请求过于频繁");
    expect(dispatcher.error).toHaveBeenCalledWith("响应错误");
  });

  it("应构造失败 timeline 执行层计划", () => {
    expect(
      buildAgentStreamFailedTimelineStatePlan({
        activeSessionId: "session-1",
        errorMessage: "provider failed",
        failedAt: "2026-05-05T08:02:00.000Z",
        pendingItemKey: "pending-item",
        pendingTurnKey: "pending-turn",
      }),
    ).toEqual({
      activeSessionId: "session-1",
      errorMessage: "provider failed",
      failedAt: "2026-05-05T08:02:00.000Z",
      pendingItemKey: "pending-item",
      pendingTurnKey: "pending-turn",
    });
  });

  it("应优先选择 pending turn 标记为失败", () => {
    const turns: AgentThreadTurn[] = [
      {
        id: "turn-running-old",
        thread_id: "session-1",
        prompt_text: "旧 turn",
        status: "running",
        started_at: "2026-05-05T08:00:00.000Z",
        created_at: "2026-05-05T08:00:00.000Z",
        updated_at: "2026-05-05T08:00:00.000Z",
      },
      {
        id: "pending-turn",
        thread_id: "session-1",
        prompt_text: "当前 turn",
        status: "running",
        started_at: "2026-05-05T08:01:00.000Z",
        created_at: "2026-05-05T08:01:00.000Z",
        updated_at: "2026-05-05T08:01:00.000Z",
      },
    ];

    expect(
      selectAgentStreamFailedTimelineTurn({
        activeSessionId: "session-1",
        pendingTurnKey: "pending-turn",
        turns,
      })?.id,
    ).toBe("pending-turn");
    expect(
      buildAgentStreamFailedTimelineTurnUpdate({
        activeSessionId: "session-1",
        errorMessage: "provider failed",
        failedAt: "2026-05-05T08:02:00.000Z",
        pendingTurnKey: "pending-turn",
        turns,
      }),
    ).toMatchObject({
      id: "pending-turn",
      status: "failed",
      error_message: "provider failed",
      completed_at: "2026-05-05T08:02:00.000Z",
      updated_at: "2026-05-05T08:02:00.000Z",
    });
  });

  it("pending turn 不存在时应回退当前会话最后一个 running turn", () => {
    const turns: AgentThreadTurn[] = [
      {
        id: "turn-other-session",
        thread_id: "session-other",
        prompt_text: "其他会话",
        status: "running",
        started_at: "2026-05-05T08:00:00.000Z",
        created_at: "2026-05-05T08:00:00.000Z",
        updated_at: "2026-05-05T08:00:00.000Z",
      },
      {
        id: "turn-old",
        thread_id: "session-1",
        prompt_text: "旧 turn",
        status: "running",
        started_at: "2026-05-05T08:01:00.000Z",
        created_at: "2026-05-05T08:01:00.000Z",
        updated_at: "2026-05-05T08:01:00.000Z",
      },
      {
        id: "turn-latest",
        thread_id: "session-1",
        prompt_text: "最新 turn",
        status: "running",
        started_at: "2026-05-05T08:02:00.000Z",
        created_at: "2026-05-05T08:02:00.000Z",
        updated_at: "2026-05-05T08:02:00.000Z",
      },
    ];

    expect(
      selectAgentStreamFailedTimelineTurn({
        activeSessionId: "session-1",
        pendingTurnKey: "missing-turn",
        turns,
      })?.id,
    ).toBe("turn-latest");
  });

  it("应构造失败 turn summary item 更新并保留已完成时间", () => {
    const items: AgentThreadItem[] = [
      {
        id: "pending-item",
        thread_id: "session-1",
        turn_id: "pending-turn",
        sequence: 1,
        status: "in_progress",
        started_at: "2026-05-05T08:01:00.000Z",
        completed_at: "2026-05-05T08:01:30.000Z",
        updated_at: "2026-05-05T08:01:00.000Z",
        type: "turn_summary",
        text: "处理中",
      },
    ];

    expect(
      buildAgentStreamFailedTimelineItemUpdate({
        errorMessage: "provider failed",
        failedAt: "2026-05-05T08:02:00.000Z",
        items,
        pendingItemKey: "pending-item",
      }),
    ).toMatchObject({
      id: "pending-item",
      status: "failed",
      completed_at: "2026-05-05T08:01:30.000Z",
      updated_at: "2026-05-05T08:02:00.000Z",
      text: "当前处理失败\n\nprovider failed",
    });
  });

  it("pending item 不存在或不是 turn_summary 时应跳过更新", () => {
    const items: AgentThreadItem[] = [
      {
        id: "agent-message",
        thread_id: "session-1",
        turn_id: "pending-turn",
        sequence: 1,
        status: "in_progress",
        started_at: "2026-05-05T08:01:00.000Z",
        updated_at: "2026-05-05T08:01:00.000Z",
        type: "agent_message",
        text: "正文",
      },
    ];

    expect(
      buildAgentStreamFailedTimelineItemUpdate({
        errorMessage: "provider failed",
        failedAt: "2026-05-05T08:02:00.000Z",
        items,
        pendingItemKey: "agent-message",
      }),
    ).toBeNull();
  });
});
