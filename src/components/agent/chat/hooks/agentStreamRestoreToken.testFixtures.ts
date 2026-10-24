import { vi } from "vitest";
import type { Dispatch, SetStateAction } from "react";
import type { AgentStreamPreparedSendEnv } from "./agentStreamPreparedSendEnv";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import type { Message } from "../types";
import type { AgentThreadItem, AgentThreadTurn } from "@/lib/api/agentProtocol";
import type { ActiveStreamState } from "./agentStreamSubmissionLifecycle";
import type { InterruptedInputRestoreRequest } from "./agentStreamInputRestoreTypes";

export function createRestoreTokenFixture() {
  const state = {
    messages: [] as Message[],
    items: [] as AgentThreadItem[],
    turns: [] as AgentThreadTurn[],
    currentTurnId: null as string | null,
    active: null as ActiveStreamState | null,
  };
  function setter<T>(read: () => T, write: (next: T) => void) {
    return vi.fn((next: SetStateAction<T>) => {
      write(
        typeof next === "function" ? (next as (value: T) => T)(read()) : next,
      );
    });
  }
  function ignore<T>() {
    return vi.fn() as Dispatch<SetStateAction<T>>;
  }
  const runtime = {
    listenToTurnEvents: vi.fn().mockResolvedValue(vi.fn()),
    getThreadTurnControl: vi.fn().mockResolvedValue({
      activeTurnId: null,
      queuedTurnIds: [],
      threadId: "thread-1",
      updatedAtMs: 0,
    }),
    submitOp: vi.fn().mockResolvedValue({
      turn: { id: "turn-1", status: "inProgress" },
    }),
    steerTurn: vi.fn().mockResolvedValue({ turnId: "turn-1" }),
    interruptTurn: vi.fn().mockResolvedValue(undefined),
    getSessionReadModel: vi.fn().mockResolvedValue({ thread_items: [] }),
  };
  const env: AgentStreamPreparedSendEnv = {
    runtime: runtime as unknown as AgentRuntimeAdapter,
    executionStrategy: "react",
    accessMode: "current",
    executionRuntime: null,

    providerTypeRef: { current: "openai" },
    modelRef: { current: "fixture" },
    reasoningEffortRef: { current: "" },
    sessionIdRef: { current: "session-1" },
    runPreparedSubmit: (task) => task(),
    getWorkspaceIdForSubmit: () => "workspace-1",
    getThreadIdForSubmit: () => "thread-1",
    waitForSessionProviderSelectionSync: vi.fn().mockResolvedValue(undefined),
    getSyncedSessionExecutionStrategy: () => "react",
    getSyncedSessionModelPreference: () => null,
    ensureSession: vi.fn().mockResolvedValue("session-1"),
    attemptSilentTurnRecovery: vi.fn().mockResolvedValue(false),
    refreshSessionReadModel: vi.fn().mockResolvedValue(true),
    warnedKeysRef: { current: new Set() },
    listenerMapRef: { current: new Map() },
    activeStreamRef: { current: null },
    setActiveStream: (active) => {
      state.active = active;
      env.activeStreamRef.current = active;
    },
    clearActiveStreamIfMatch: (eventName) => {
      if (state.active?.eventName !== eventName) return false;
      env.setActiveStream(null);
      return true;
    },
    setMessages: setter(
      () => state.messages,
      (next) => (state.messages = next),
    ),
    getThreadItems: () => state.items,
    setThreadItems: setter(
      () => state.items,
      (next) => (state.items = next),
    ),
    setThreadTurns: setter(
      () => state.turns,
      (next) => (state.turns = next),
    ),
    setCurrentTurnId: setter(
      () => state.currentTurnId,
      (next) => (state.currentTurnId = next),
    ),
    setTodoItems: ignore(),
    setExecutionRuntime: ignore(),
    setPendingActions: ignore(),
    setWorkspacePathMissing: ignore(),
    setIsSending: ignore(),
    appendThinkingToParts: (parts) => parts,
  };
  const onRestoreInterruptedInput =
    vi.fn<(request: InterruptedInputRestoreRequest) => void>();
  const stopOptions = () => ({
    activeStream: state.active,
    sessionIdRef: env.sessionIdRef,
    threadId: "thread-1",
    currentTurnId: state.currentTurnId,
    runtime: env.runtime,
    removeStreamListener: vi.fn().mockReturnValue(true),
    refreshSessionReadModel: env.refreshSessionReadModel,
    setThreadItems: env.setThreadItems,
    setThreadTurns: env.setThreadTurns,
    setCurrentTurnId: env.setCurrentTurnId,
    setMessages: env.setMessages,
    getMessages: () => state.messages,
    getThreadItems: () => state.items,
    setActiveStream: env.setActiveStream,
    onRestoreInterruptedInput,
    notify: { info: vi.fn(), error: vi.fn() },
  });
  return { state, runtime, env, stopOptions, onRestoreInterruptedInput };
}
