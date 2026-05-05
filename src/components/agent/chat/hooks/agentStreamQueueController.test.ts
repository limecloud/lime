import { describe, expect, it } from "vitest";
import {
  buildAgentStreamQueuedDraftMessagePatch,
  buildAgentStreamQueuedDraftStatePlan,
  shouldWatchAgentStreamQueuedDraftCleanup,
  shouldWatchAgentStreamQueuedDraftCleanupForCleared,
} from "./agentStreamQueueController";

describe("agentStreamQueueController", () => {
  it("应构造 queued draft 消息 patch，并优先使用 queued message text", () => {
    const patch = buildAgentStreamQueuedDraftMessagePatch({
      contentFallback: "fallback",
      executionStrategy: "auto",
      queuedMessageText: " queued text ",
      webSearch: true,
    });

    expect(patch.isThinking).toBe(false);
    expect(patch.runtimeStatus).toMatchObject({
      phase: "routing",
      title: "已加入排队列表",
      detail: expect.stringContaining("queued text"),
    });
  });

  it("queued message text 为空时应回退当前内容", () => {
    expect(
      buildAgentStreamQueuedDraftMessagePatch({
        contentFallback: "fallback text",
        executionStrategy: "react",
        queuedMessageText: " ",
      }).runtimeStatus?.detail,
    ).toContain("fallback text");
  });

  it("应构造 queued draft 状态副作用计划", () => {
    const plan = buildAgentStreamQueuedDraftStatePlan({
      contentFallback: "fallback",
      executionStrategy: "code_orchestrated",
      queuedMessageText: "queued draft",
      webSearch: false,
    });

    expect(plan).toMatchObject({
      shouldClearActiveStream: true,
      shouldClearOptimisticItem: true,
      shouldClearOptimisticTurn: true,
      shouldSetSendingFalse: true,
      messagePatch: {
        isThinking: false,
        runtimeStatus: {
          phase: "routing",
          title: "已加入排队列表",
        },
      },
    });
    expect(plan.messagePatch.runtimeStatus?.detail).toContain("queued draft");
  });

  it("应判断单个 queue removed 是否需要继续观察当前 draft", () => {
    expect(
      shouldWatchAgentStreamQueuedDraftCleanup({
        affectedQueuedTurnId: "queued-a",
        currentQueuedTurnId: null,
      }),
    ).toBe(true);
    expect(
      shouldWatchAgentStreamQueuedDraftCleanup({
        affectedQueuedTurnId: "queued-a",
        currentQueuedTurnId: "queued-a",
      }),
    ).toBe(true);
    expect(
      shouldWatchAgentStreamQueuedDraftCleanup({
        affectedQueuedTurnId: "queued-a",
        currentQueuedTurnId: "queued-b",
      }),
    ).toBe(false);
  });

  it("应判断 queue cleared 是否覆盖当前 draft", () => {
    expect(
      shouldWatchAgentStreamQueuedDraftCleanupForCleared({
        clearedQueuedTurnIds: ["queued-a", "queued-b"],
        currentQueuedTurnId: "queued-b",
      }),
    ).toBe(true);
    expect(
      shouldWatchAgentStreamQueuedDraftCleanupForCleared({
        clearedQueuedTurnIds: ["queued-a"],
        currentQueuedTurnId: "queued-b",
      }),
    ).toBe(false);
  });
});
