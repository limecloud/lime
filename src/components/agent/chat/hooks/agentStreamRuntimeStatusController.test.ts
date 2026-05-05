import { describe, expect, it } from "vitest";
import type { AgentThreadItem } from "@/lib/api/agentProtocol";
import {
  buildAgentStreamNormalizedRuntimeStatus,
  buildAgentStreamRuntimeStatusApplyPlan,
  buildAgentStreamRuntimeSummaryItemUpdate,
  selectAgentStreamRuntimeSummaryItem,
} from "./agentStreamRuntimeStatusController";

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
});
