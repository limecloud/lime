import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/lib/api/agentProtocol";
import type { Message } from "../types";
import { handleTurnStreamEvent } from "./agentStreamRuntimeHandler";

describe("agentStreamRuntimeHandler", () => {
  it("收到 final_done 时应把 usage 写回 assistant 消息", () => {
    let messages: Message[] = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "图片已经生成完成",
        timestamp: new Date("2026-04-07T10:00:00.000Z"),
        isThinking: true,
      },
    ];

    const setMessages = vi.fn(
      (value: Message[] | ((prev: Message[]) => Message[])) => {
        messages = typeof value === "function" ? value(messages) : value;
      },
    );

    handleTurnStreamEvent({
      data: {
        type: "final_done",
        usage: {
          input_tokens: 12_000,
          output_tokens: 19_000,
        },
      } as AgentEvent,
      requestState: {
        accumulatedContent: "图片已经生成完成",
        queuedTurnId: null,
        requestLogId: null,
        requestStartedAt: 0,
        requestFinished: false,
      },
      callbacks: {
        activateStream: () => {},
        isStreamActivated: () => true,
        clearOptimisticItem: () => {},
        clearOptimisticTurn: () => {},
        disposeListener: () => {},
        removeQueuedDraftMessages: () => {},
        clearActiveStreamIfMatch: () => true,
        upsertQueuedTurn: () => {},
        removeQueuedTurnState: () => {},
        playToolcallSound: () => {},
        playTypewriterSound: () => {},
        appendThinkingToParts: (parts) => parts,
      },
      eventName: "agent-runtime-test",
      pendingTurnKey: "pending-turn",
      pendingItemKey: "pending-item",
      assistantMsgId: "assistant-1",
      activeSessionId: "session-1",
      resolvedWorkspaceId: "workspace-1",
      effectiveExecutionStrategy: "react",
      content: "图片已经生成完成",
      runtime: {} as never,
      warnedKeysRef: { current: new Set<string>() },
      actionLoggedKeys: new Set<string>(),
      toolLogIdByToolId: new Map<string, string>(),
      toolStartedAtByToolId: new Map<string, number>(),
      toolNameByToolId: new Map<string, string>(),
      setMessages: setMessages as never,
      setPendingActions: vi.fn() as never,
      setThreadItems: vi.fn() as never,
      setThreadTurns: vi.fn() as never,
      setCurrentTurnId: vi.fn() as never,
      setExecutionRuntime: vi.fn() as never,
      setIsSending: vi.fn() as never,
    });

    expect(setMessages).toHaveBeenCalled();
    expect(messages[0]).toMatchObject({
      isThinking: false,
      usage: {
        input_tokens: 12_000,
        output_tokens: 19_000,
      },
    });
  });
});
