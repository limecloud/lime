import { describe, expect, it } from "vitest";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AgentThreadItem, AgentThreadTurn } from "@/lib/api/agentProtocol";
import type {
  AsterSessionExecutionRuntime,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import type { ActiveStreamState } from "./agentStreamSubmissionLifecycle";
import type { WorkspacePathMissingState } from "./agentChatShared";
import type { ActionRequired, Message } from "../types";
import { createAgentStreamPreparedSendEnv } from "./agentStreamPreparedSendEnv";

function noopDispatch<T>() {
  return (() => undefined) as unknown as Dispatch<SetStateAction<T>>;
}

describe("createAgentStreamPreparedSendEnv", () => {
  it("应把 queuedTurnsCount 封装成稳定 getter", () => {
    const env = createAgentStreamPreparedSendEnv({
      queuedTurnsCount: 3,
      threadBusy: false,
      runtime: {} as never,
      ensureSession: async () => "session-1",
      attemptSilentTurnRecovery: async () => false,
      executionStrategy: "react",
      accessMode: "current",
      providerTypeRef: { current: "openai" } as MutableRefObject<string>,
      modelRef: { current: "gpt-5.4" } as MutableRefObject<string>,
      sessionIdRef: { current: "session-1" } as MutableRefObject<string | null>,
      hasPendingPreparedSubmit: () => false,
      runPreparedSubmit: async (task) => task(),
      getRequiredWorkspaceId: () => "workspace-1",
      getSyncedSessionModelPreference: () => null,
      getSyncedSessionExecutionStrategy: () => "react",
      listenerMapRef: { current: new Map() },
      activeStreamRef: {
        current: null,
      } as MutableRefObject<ActiveStreamState | null>,
      warnedKeysRef: { current: new Set<string>() },
      setActiveStream: () => undefined,
      clearActiveStreamIfMatch: () => false,
      setMessages: noopDispatch<Message[]>(),
      setThreadItems: noopDispatch<AgentThreadItem[]>(),
      setThreadTurns: noopDispatch<AgentThreadTurn[]>(),
      setCurrentTurnId: noopDispatch<string | null>(),
      setExecutionRuntime: noopDispatch<AsterSessionExecutionRuntime | null>(),
      setQueuedTurns: noopDispatch<QueuedTurnSnapshot[]>(),
      setPendingActions: noopDispatch<ActionRequired[]>(),
      setWorkspacePathMissing: noopDispatch<WorkspacePathMissingState | null>(),
      setIsSending: noopDispatch<boolean>(),
      playToolcallSound: () => undefined,
      playTypewriterSound: () => undefined,
      appendThinkingToParts: (parts) => parts,
    });

    expect(env.getQueuedTurnsCount()).toBe(3);
  });
});
