import { vi } from "vitest";
import type { ComposerSubmission } from "@/components/input-kit/types";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import { executeAgentStreamSubmit } from "./agentStreamSubmitExecution";

const submission: ComposerSubmission = {
  text: "A😀@x",
  textElements: [{ byteRange: { start: 5, end: 7 }, placeholder: "@x" }],
  inputMentions: [{ type: "skill", name: "x", path: "/skills/x" }],
  attachments: [],
  pathReferences: [
    { id: "path-1", path: "/tmp/report.md", name: "report.md", isDir: false },
    { id: "path-2", path: "/tmp/report.md", name: "report.md", isDir: false },
  ],
};

export function createAcceptanceOptions(activeTurnId: string | null) {
  const submitOp = vi
    .fn()
    .mockResolvedValue({ turn: { id: "turn-start", status: "inProgress" } });
  const steerTurn = vi.fn().mockResolvedValue({ turnId: activeTurnId });
  const options: Parameters<typeof executeAgentStreamSubmit>[0] = {
    runtime: {
      getThreadTurnControl: vi.fn().mockResolvedValue({
        activeTurnId,
        queuedTurnIds: [],
        threadId: "thread-1",
        updatedAtMs: 0,
      }),
      listenToTurnEvents: vi.fn().mockResolvedValue(vi.fn()),
      submitOp,
      steerTurn,
    } as unknown as AgentRuntimeAdapter,
    ensureSession: vi.fn().mockResolvedValue("session-1"),
    attemptSilentTurnRecovery: vi.fn().mockResolvedValue(false),
    refreshSessionReadModel: vi.fn().mockResolvedValue(true),
    sessionIdRef: { current: "session-1" },
    getWorkspaceIdForSubmit: () => "workspace-1",
    getThreadIdForSubmit: () => "thread-1",
    getSyncedSessionExecutionStrategy: () => "react",
    effectiveAccessMode: "current",
    content: submission.text,
    images: [],
    composerSubmission: submission,
    skipUserMessage: false,
    effectiveProviderType: "openai",
    effectiveModel: "fixture",
    effectiveExecutionStrategy: "react",
    eventName: "event-1",
    clientUserMessageId: "client-1",
    assistantMsgId: "assistant-1",
    pendingTurnKey: "pending-turn-1",
    pendingItemKey: "pending-item-1",
    warnedKeysRef: { current: new Set() },
    actionLoggedKeys: new Set(),
    toolLogIdByToolId: new Map(),
    toolStartedAtByToolId: new Map(),
    toolNameByToolId: new Map(),
    requestState: {
      accumulatedContent: "",
      requestLogId: null,
      requestStartedAt: 0,
      requestFinished: false,
    },
    callbacks: {
      activateStream: vi.fn(),
      isStreamActivated: () => false,
      clearOptimisticItem: vi.fn(),
      clearOptimisticTurn: vi.fn(),
      disposeListener: vi.fn(),
      clearActiveStreamIfMatch: () => false,
      registerListener: vi.fn(),
    },
    appendThinkingToParts: (parts) => parts,
    setMessages: vi.fn(),
    setIsSending: vi.fn(),
    setPendingActions: vi.fn(),
    setThreadItems: vi.fn(),
    setThreadTurns: vi.fn(),
    setCurrentTurnId: vi.fn(),
    setExecutionRuntime: vi.fn(),
  };
  return { options, submitOp, steerTurn };
}

import type { AgentStreamPreparedSendEnv } from "./agentStreamPreparedSendEnv";
export function createAcceptanceEnv(
  activeTurnId: string | null = null,
): AgentStreamPreparedSendEnv {
  const { options } = createAcceptanceOptions(activeTurnId);
  return {
    runtime: options.runtime,
    ensureSession: options.ensureSession,
    attemptSilentTurnRecovery: options.attemptSilentTurnRecovery,
    refreshSessionReadModel: options.refreshSessionReadModel,
    executionStrategy: "react",
    accessMode: "current",

    providerTypeRef: { current: "openai" },
    modelRef: { current: "fixture" },
    reasoningEffortRef: { current: "" },
    sessionIdRef: options.sessionIdRef,
    runPreparedSubmit: (task) => task(),
    getWorkspaceIdForSubmit: options.getWorkspaceIdForSubmit,
    getThreadIdForSubmit: options.getThreadIdForSubmit,
    getSyncedSessionModelPreference: () => null,
    getSyncedSessionExecutionStrategy:
      options.getSyncedSessionExecutionStrategy,
    warnedKeysRef: options.warnedKeysRef,
    listenerMapRef: { current: new Map() },
    activeStreamRef: { current: null },
    setActiveStream: vi.fn(),
    clearActiveStreamIfMatch: vi.fn().mockReturnValue(false),
    setMessages: options.setMessages,
    setThreadItems: options.setThreadItems,
    setThreadTurns: options.setThreadTurns,
    setCurrentTurnId: options.setCurrentTurnId,
    setExecutionRuntime: options.setExecutionRuntime,
    setPendingActions: options.setPendingActions,
    setWorkspacePathMissing: vi.fn(),
    setIsSending: options.setIsSending,
    appendThinkingToParts: options.appendThinkingToParts,
  };
}
