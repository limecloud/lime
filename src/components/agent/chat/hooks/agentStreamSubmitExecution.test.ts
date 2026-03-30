import { afterEach, describe, expect, it, vi } from "vitest";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { activityLogger } from "@/lib/workspace/workbenchRuntime";
import type { AgentThreadItem, AgentThreadTurn } from "@/lib/api/agentProtocol";
import type {
  AsterSessionExecutionRuntime,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import type { ActionRequired, Message } from "../types";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import type { StreamRequestState } from "./agentStreamSubmissionLifecycle";
import { executeAgentStreamSubmit } from "./agentStreamSubmitExecution";

function noopDispatch<T>() {
  return vi.fn() as unknown as Dispatch<SetStateAction<T>>;
}

describe("agentStreamSubmitExecution", () => {
  afterEach(() => {
    activityLogger.clear();
  });

  it("应串起 submit context、listener 绑定与 submitOp", async () => {
    const unlisten = vi.fn();
    const submitOp = vi.fn(async () => {});
    const registerListener = vi.fn();
    const activateStream = vi.fn();
    const runtime = {
      listenToTurnEvents: vi.fn(async () => unlisten),
      submitOp,
    } as unknown as AgentRuntimeAdapter;
    const requestState: StreamRequestState = {
      accumulatedContent: "",
      requestLogId: null,
      requestStartedAt: 0,
      requestFinished: false,
      queuedTurnId: null,
    };

    await executeAgentStreamSubmit({
      runtime,
      ensureSession: async () => "session-1",
      sessionIdRef: { current: null } as MutableRefObject<string | null>,
      getRequiredWorkspaceId: () => "workspace-1",
      getSyncedSessionExecutionStrategy: () => "react",
      getSyncedSessionRecentPreferences: () => ({
        webSearch: true,
        thinking: true,
        task: false,
        subagent: true,
      }),
      effectiveAccessMode: "read-only",
      content: "继续生成提纲",
      images: [],
      skipUserMessage: false,
      expectingQueue: false,
      effectiveProviderType: "openai",
      effectiveModel: "gpt-5.4",
      effectiveExecutionStrategy: "react",
      webSearch: true,
      thinking: true,
      eventName: "event-1",
      requestTurnId: "turn-1",
      requestState,
      assistantMsgId: "assistant-1",
      pendingTurnKey: "pending-turn-1",
      pendingItemKey: "pending-item-1",
      warnedKeysRef: { current: new Set<string>() },
      actionLoggedKeys: new Set<string>(),
      toolLogIdByToolId: new Map<string, string>(),
      toolStartedAtByToolId: new Map<string, number>(),
      toolNameByToolId: new Map<string, string>(),
      callbacks: {
        activateStream,
        isStreamActivated: () => false,
        clearOptimisticItem: () => {},
        clearOptimisticTurn: () => {},
        disposeListener: () => {},
        removeQueuedDraftMessages: () => {},
        clearActiveStreamIfMatch: () => false,
        upsertQueuedTurn: (_queuedTurn: QueuedTurnSnapshot) => {},
        removeQueuedTurnState: () => {},
        registerListener,
      },
      sounds: {
        playToolcallSound: () => {},
        playTypewriterSound: () => {},
      },
      appendThinkingToParts: (parts: NonNullable<Message["contentParts"]>) => parts,
      setMessages: noopDispatch<Message[]>(),
      setIsSending: noopDispatch<boolean>(),
      setPendingActions: noopDispatch<ActionRequired[]>(),
      setThreadItems: noopDispatch<AgentThreadItem[]>(),
      setThreadTurns: noopDispatch<AgentThreadTurn[]>(),
      setCurrentTurnId: noopDispatch<string | null>(),
      setExecutionRuntime: noopDispatch<AsterSessionExecutionRuntime | null>(),
    });

    expect(registerListener).toHaveBeenCalledWith(unlisten);
    expect(submitOp).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "user_input",
        sessionId: "session-1",
        eventName: "event-1",
        workspaceId: "workspace-1",
        turnId: "turn-1",
        text: "继续生成提纲",
        preferences: expect.objectContaining({
          approvalPolicy: "on-request",
          sandboxPolicy: "read-only",
        }),
      }),
    );
    expect(activateStream).toHaveBeenCalled();
    expect(requestState.requestLogId).toBeTruthy();
  });
});
