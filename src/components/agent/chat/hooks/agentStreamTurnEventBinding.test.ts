import { afterEach, describe, expect, it, vi } from "vitest";
import type { Dispatch, SetStateAction } from "react";
import { activityLogger } from "@/components/content-creator/utils/activityLogger";
import type { AgentThreadItem, AgentThreadTurn } from "@/lib/api/agentProtocol";
import type {
  AsterSessionExecutionRuntime,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import type { ActionRequired, Message } from "../types";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import type { StreamRequestState } from "./agentStreamSubmissionLifecycle";
import { registerAgentStreamTurnEventBinding } from "./agentStreamTurnEventBinding";

function noopDispatch<T>() {
  return vi.fn() as unknown as Dispatch<SetStateAction<T>>;
}

describe("agentStreamTurnEventBinding", () => {
  afterEach(() => {
    activityLogger.clear();
  });

  it("应登记 request start 日志并返回 turn listener", async () => {
    const unlisten = vi.fn();
    const runtime = {
      listenToTurnEvents: vi.fn(async () => unlisten),
    } as unknown as AgentRuntimeAdapter;
    const requestState: StreamRequestState = {
      accumulatedContent: "",
      requestLogId: null,
      requestStartedAt: 0,
      requestFinished: false,
      queuedTurnId: null,
    };

    const result = await registerAgentStreamTurnEventBinding({
      runtime,
      eventName: "event-1",
      requestState,
      skipUserMessage: false,
      effectiveProviderType: "openai",
      effectiveModel: "gpt-5.4",
      effectiveExecutionStrategy: "react",
      content: "继续生成提纲",
      expectingQueue: false,
      activeSessionId: "session-1",
      resolvedWorkspaceId: "workspace-1",
      assistantMsgId: "assistant-1",
      pendingTurnKey: "pending-turn-1",
      pendingItemKey: "pending-item-1",
      effectiveWaitingRuntimeStatus: {
        phase: "preparing",
        title: "处理中",
        detail: "正在准备执行上下文",
      },
      warnedKeysRef: { current: new Set<string>() },
      actionLoggedKeys: new Set<string>(),
      toolLogIdByToolId: new Map<string, string>(),
      toolStartedAtByToolId: new Map<string, number>(),
      toolNameByToolId: new Map<string, string>(),
      callbacks: {
        activateStream: () => {},
        isStreamActivated: () => false,
        clearOptimisticItem: () => {},
        clearOptimisticTurn: () => {},
        disposeListener: () => {},
        removeQueuedDraftMessages: () => {},
        clearActiveStreamIfMatch: () => false,
        upsertQueuedTurn: (_queuedTurn: QueuedTurnSnapshot) => {},
        removeQueuedTurnState: () => {},
      },
      sounds: {
        playToolcallSound: () => {},
        playTypewriterSound: () => {},
      },
      appendThinkingToParts: (parts) => parts,
      setMessages: noopDispatch<Message[]>(),
      setPendingActions: noopDispatch<ActionRequired[]>(),
      setThreadItems: noopDispatch<AgentThreadItem[]>(),
      setThreadTurns: noopDispatch<AgentThreadTurn[]>(),
      setCurrentTurnId: noopDispatch<string | null>(),
      setExecutionRuntime: noopDispatch<AsterSessionExecutionRuntime | null>(),
    });

    expect(result).toBe(unlisten);
    expect(runtime.listenToTurnEvents).toHaveBeenCalledWith(
      "event-1",
      expect.any(Function),
    );
    expect(requestState.requestStartedAt).toBeGreaterThan(0);
    expect(requestState.requestLogId).toBeTruthy();
    expect(activityLogger.getLogs()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: requestState.requestLogId,
          eventType: "chat_request_start",
          status: "pending",
          title: "发送请求",
          sessionId: "session-1",
          workspaceId: "workspace-1",
          source: "aster-chat",
        }),
      ]),
    );
  });
});
