import { describe, expect, it, vi } from "vitest";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AgentThreadItem, AgentThreadTurn } from "@/lib/api/agentProtocol";
import type {
  AsterSessionExecutionRuntime,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import type { ActiveStreamState } from "./agentStreamSubmissionLifecycle";
import type { WorkspacePathMissingState } from "./agentChatShared";
import { dispatchPreparedAgentStreamSend } from "./agentStreamPreparedSendDispatch";
import type { PreparedAgentStreamUserInputSend } from "./agentStreamUserInputSendPreparation";
import type { ActionRequired, Message } from "../types";

vi.mock("./agentStreamSlashSkillPreflight", () => ({
  maybeHandleSlashSkillBeforeSend: vi.fn(),
}));

vi.mock("./agentStreamUserInputSubmission", () => ({
  submitAgentStreamUserInput: vi.fn(),
}));

import { maybeHandleSlashSkillBeforeSend } from "./agentStreamSlashSkillPreflight";
import { submitAgentStreamUserInput } from "./agentStreamUserInputSubmission";
import type { AgentStreamPreparedSendEnv } from "./agentStreamPreparedSendEnv";

function noopDispatch<T>() {
  return vi.fn() as unknown as Dispatch<SetStateAction<T>>;
}

const preparedSend: PreparedAgentStreamUserInputSend = {
  content: "继续生成提纲",
  images: [],
  skipUserMessage: false,
  expectingQueue: false,
  effectiveExecutionStrategy: "react",
  effectiveProviderType: "openai",
  effectiveModel: "gpt-5.4",
  syncedSessionModelPreference: null,
  assistantMsgId: "00000000-0000-0000-0000-000000000001",
  userMsgId: "00000000-0000-0000-0000-000000000002",
  assistantMsg: {
    id: "assistant-1",
    role: "assistant",
    content: "",
    timestamp: new Date("2026-03-27T01:00:00.000Z"),
    isThinking: true,
    contentParts: [],
    runtimeStatus: {
      phase: "routing",
      title: "正在准备处理",
      detail: "正在同步上下文",
    },
  },
};

describe("agentStreamPreparedSendDispatch", () => {
  function createEnv(): AgentStreamPreparedSendEnv {
    const runPreparedSubmit = vi.fn(async <T>(task: () => Promise<T>) =>
      task(),
    ) as unknown as AgentStreamPreparedSendEnv["runPreparedSubmit"];
    return {
      runtime: {} as never,
      ensureSession: async () => "session-1",
      attemptSilentTurnRecovery: async () => false,
      executionStrategy: "react",
      accessMode: "current",
      providerTypeRef: { current: "openai" } as MutableRefObject<string>,
      modelRef: { current: "gpt-5.4" } as MutableRefObject<string>,
      sessionIdRef: { current: null } as MutableRefObject<string | null>,
      getQueuedTurnsCount: () => 0,
      isThreadBusy: () => false,
      hasPendingPreparedSubmit: () => false,
      runPreparedSubmit,
      getRequiredWorkspaceId: () => "workspace-1",
      getSyncedSessionModelPreference: () => null,
      getSyncedSessionExecutionStrategy: (_sessionId) => "react",
      listenerMapRef: { current: new Map() },
      activeStreamRef: {
        current: null,
      } as MutableRefObject<ActiveStreamState | null>,
      warnedKeysRef: { current: new Set<string>() },
      setActiveStream: () => {},
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
      playToolcallSound: () => {},
      playTypewriterSound: () => {},
      appendThinkingToParts: (parts) => parts,
    };
  }

  it("slash preflight 已处理时不再继续 user_input submit", async () => {
    vi.mocked(maybeHandleSlashSkillBeforeSend).mockResolvedValueOnce(true);

    await dispatchPreparedAgentStreamSend({
      preparedSend,
      env: createEnv(),
    });

    expect(maybeHandleSlashSkillBeforeSend).toHaveBeenCalledWith(
      expect.objectContaining({ preparedSend }),
    );
    expect(submitAgentStreamUserInput).not.toHaveBeenCalled();
  });

  it("slash preflight 未处理时继续普通 user_input submit", async () => {
    vi.mocked(maybeHandleSlashSkillBeforeSend).mockResolvedValueOnce(false);
    const env = createEnv();

    await dispatchPreparedAgentStreamSend({
      preparedSend,
      env,
    });

    expect(vi.mocked(env.runPreparedSubmit)).toHaveBeenCalledTimes(1);
    expect(submitAgentStreamUserInput).toHaveBeenCalledWith(
      expect.objectContaining({ preparedSend }),
    );
  });
});
