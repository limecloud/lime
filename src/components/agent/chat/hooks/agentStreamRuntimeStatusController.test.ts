import { describe, expect, it } from "vitest";
import type { AgentThreadItem } from "@/lib/api/agentProtocol";

import {
  applyAgentStreamRuntimeStatusToMessages,
  applyAgentStreamRuntimeStatusToThreadItems,
  buildAgentStreamNormalizedRuntimeStatus,
  buildAgentStreamProviderTraceRuntimeStatusApplyPlan,
  buildAgentStreamRuntimeStatusApplyPlan,
  buildAgentStreamRuntimeSummaryItemUpdate,
  selectAgentStreamRuntimeSummaryItem,
} from "./agentStreamRuntimeStatusController";
import type { Message } from "../types";

function summaryItem(id: string, threadId = "session-a"): AgentThreadItem {
  return {
    id,
    thread_id: threadId,
    turn_id: "turn-a",
    sequence: 1,
    status: "in_progress",
    started_at: "2026-05-05T00:00:00.000Z",
    updated_at: "2026-05-05T00:00:00.000Z",
    type: "turn_summary",
    text: "旧状态",
  };
}

describe("agentStreamRuntimeStatusController", () => {
  it("应归一化 runtime status 并构造 summary 文本", () => {
    const plan = buildAgentStreamRuntimeStatusApplyPlan({
      status: {
        phase: "routing",
        title: "正在分析意图",
        detail: "准备选择执行策略",
      },
      updatedAt: "2026-05-05T10:00:00.000Z",
    });

    expect(plan).toMatchObject({
      normalizedStatus: {
        phase: "routing",
        title: "正在分析意图",
        detail: "准备选择执行策略",
      },
      updatedAt: "2026-05-05T10:00:00.000Z",
    });
    expect(plan.summaryText).toContain("正在分析意图");
    expect(
      buildAgentStreamNormalizedRuntimeStatus({
        phase: "context",
        title: "读取上下文",
        detail: "读取项目资料",
      }),
    ).toMatchObject({ title: "读取上下文" });
  });

  it("应保留 App Server current retrying phase，避免降级成普通 routing", () => {
    const plan = buildAgentStreamRuntimeStatusApplyPlan({
      status: {
        phase: "retrying",
        title: "正在恢复模型输出",
        detail: "模型通道在尾段暂时中断，正在补齐最终答复。",
        metadata: {
          agentui: {
            eventClass: "run.status",
          },
        },
      },
      updatedAt: "2026-05-05T10:00:00.000Z",
    });

    expect(plan.normalizedStatus.phase).toBe("retrying");
    expect(plan.summaryText).toContain("正在恢复模型输出");
  });

  it("provider_trace 首个请求阶段应生成等待态计划", () => {
    const plan = buildAgentStreamProviderTraceRuntimeStatusApplyPlan({
      executionStrategy: "react",
      firstRuntimeStatusAt: null,
      stage: "request_started",
      updatedAt: "2026-05-05T10:00:00.000Z",
    });

    expect(plan).toMatchObject({
      normalizedStatus: {
        phase: "routing",
        title: "正在处理",
      },
      updatedAt: "2026-05-05T10:00:00.000Z",
    });
    expect(plan?.summaryText).toContain("正在处理");
  });



  it("provider_trace 非首个等待阶段不应生成运行态计划", () => {
    expect(
      buildAgentStreamProviderTraceRuntimeStatusApplyPlan({
        executionStrategy: "react",
        firstRuntimeStatusAt: 100,
        stage: "request_started",
        updatedAt: "2026-05-05T10:00:00.000Z",
      }),
    ).toBeNull();
    expect(
      buildAgentStreamProviderTraceRuntimeStatusApplyPlan({
        executionStrategy: "react",
        firstRuntimeStatusAt: null,
        stage: "first_text_delta",
        updatedAt: "2026-05-05T10:00:00.000Z",
      }),
    ).toBeNull();
  });

  it("应优先选择 pending turn summary item", () => {
    const pendingSummary = summaryItem("pending-summary");
    const fallbackSummary = summaryItem("fallback-summary");

    expect(
      selectAgentStreamRuntimeSummaryItem({
        activeSessionId: "session-a",
        items: [fallbackSummary, pendingSummary],
        pendingItemKey: "pending-summary",
      }),
    ).toEqual(pendingSummary);
  });

  it("pending item 存在但不是 turn_summary 时应保持原行为不回退", () => {
    const pendingAgentMessage: AgentThreadItem = {
      id: "pending-item",
      thread_id: "session-a",
      turn_id: "turn-a",
      sequence: 1,
      status: "in_progress",
      started_at: "2026-05-05T00:00:00.000Z",
      updated_at: "2026-05-05T00:00:00.000Z",
      type: "agent_message",
      text: "正文",
    };

    expect(
      selectAgentStreamRuntimeSummaryItem({
        activeSessionId: "session-a",
        items: [summaryItem("fallback-summary"), pendingAgentMessage],
        pendingItemKey: "pending-item",
      }),
    ).toBeNull();
  });

  it("无 pending item 时应选择同 session 最新 in-progress summary", () => {
    const older = summaryItem("older");
    const newer = summaryItem("newer");
    const otherSession = summaryItem("other", "session-b");

    expect(
      selectAgentStreamRuntimeSummaryItem({
        activeSessionId: "session-a",
        items: [older, otherSession, newer],
        pendingItemKey: "missing",
      })?.id,
    ).toBe("newer");
  });

  it("应构造 summary item 更新", () => {
    expect(
      buildAgentStreamRuntimeSummaryItemUpdate({
        activeSessionId: "session-a",
        items: [summaryItem("summary-a")],
        pendingItemKey: "summary-a",
        summaryText: "新状态",
        updatedAt: "2026-05-05T10:00:00.000Z",
      }),
    ).toMatchObject({
      id: "summary-a",
      text: "新状态",
      updated_at: "2026-05-05T10:00:00.000Z",
    });
  });

  it("应把运行态计划统一写入 summary item 与消息", () => {
    const plan = buildAgentStreamRuntimeStatusApplyPlan({
      status: {
        phase: "context",
        title: "正在整理上下文",
        detail: "已收到真实运行时状态",
      },
      updatedAt: "2026-05-05T10:00:00.000Z",
    });
    const messages: Message[] = [
      {
        id: "assistant-a",
        role: "assistant",
        content: "",
        timestamp: new Date("2026-05-05T10:00:00.000Z"),
      },
    ];

    expect(
      applyAgentStreamRuntimeStatusToThreadItems({
        activeSessionId: "session-a",
        items: [summaryItem("summary-a")],
        pendingItemKey: "summary-a",
        plan,
      })?.[0],
    ).toMatchObject({
      id: "summary-a",
      text: expect.stringContaining("正在整理上下文"),
    });
    expect(
      applyAgentStreamRuntimeStatusToMessages({
        assistantMsgId: "assistant-a",
        messages,
        plan,
      })[0]?.runtimeStatus,
    ).toMatchObject({
      phase: "context",
      title: "正在整理上下文",
    });
  });

  it("运行态展示无变化时不应重建 summary item 或 messages 数组", () => {
    const plan = buildAgentStreamRuntimeStatusApplyPlan({
      status: {
        phase: "context",
        title: "正在整理上下文",
        detail: "已收到真实运行时状态",
      },
      updatedAt: "2026-05-05T10:00:00.000Z",
    });
    const existingSummary = {
      ...summaryItem("summary-a"),
      text: plan.summaryText,
      updated_at: "2026-05-05T09:59:59.000Z",
    };
    const messages: Message[] = [
      {
        id: "assistant-a",
        role: "assistant",
        content: "",
        timestamp: new Date("2026-05-05T10:00:00.000Z"),
        runtimeStatus: plan.normalizedStatus,
      },
    ];

    expect(
      applyAgentStreamRuntimeStatusToThreadItems({
        activeSessionId: "session-a",
        items: [existingSummary],
        pendingItemKey: "summary-a",
        plan,
      }),
    ).toBeNull();
    expect(
      applyAgentStreamRuntimeStatusToMessages({
        assistantMsgId: "assistant-a",
        messages,
        plan,
      }),
    ).toBe(messages);
  });
});
