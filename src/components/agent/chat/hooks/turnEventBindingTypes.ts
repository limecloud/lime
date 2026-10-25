import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AgentThreadItem, AgentThreadTurn } from "@/lib/api/agentProtocol";
import type {
  AgentExecutionStrategy,
  AgentSessionExecutionRuntime,
} from "@/lib/api/agentExecutionRuntime";
import type {
  AgentTodoItem,
  AutoContinueRequestPayload,
} from "@/lib/api/agentRuntime/sessionTypes";
import type { ActionRequired, Message } from "../types";

import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import type { StreamRequestState } from "./agentStreamRuntimeHandlerTypes";

type MessageParts = NonNullable<Message["contentParts"]>;
interface StreamObserver {
  onTextDelta?: (delta: string, accumulated: string) => void;
  onComplete?: (content: string) => void;
  onError?: (message: string) => void;
}

export interface RegisterAgentStreamTurnEventBindingOptions {
  runtime: AgentRuntimeAdapter;
  eventName: string;
  requestState: StreamRequestState;
  attemptSilentTurnRecovery?: (
    sessionId: string,
    requestStartedAt: number,
    promptText: string,
    options?: { requireTerminal?: boolean; turnId?: string | null },
  ) => Promise<boolean>;
  skipUserMessage: boolean;
  effectiveProviderType: string;
  effectiveModel: string;
  effectiveExecutionStrategy: AgentExecutionStrategy;
  systemPrompt?: string;
  content: string;
  webSearch?: boolean;
  autoContinue?: AutoContinueRequestPayload;
  activeSessionId: string;
  resolvedWorkspaceId: string;
  assistantMsgId: string;
  pendingTurnKey: string;
  pendingItemKey: string;
  effectiveWaitingRuntimeStatus: NonNullable<Message["runtimeStatus"]>;
  preserveAssistantContent?: string | null;
  assistantFallbackContent?: string | null;
  warnedKeysRef: MutableRefObject<Set<string>>;
  actionLoggedKeys: Set<string>;
  toolLogIdByToolId: Map<string, string>;
  toolStartedAtByToolId: Map<string, number>;
  toolNameByToolId: Map<string, string>;
  observer?: StreamObserver;
  onWriteFile?: (
    content: string,
    fileName: string,
    context?: import("../types").WriteArtifactContext,
  ) => void;
  callbacks: {
    activateStream: (
      activeSessionId: string,
      effectiveWaitingRuntimeStatus: NonNullable<Message["runtimeStatus"]>,
    ) => void;
    isStreamActivated: () => boolean;
    clearOptimisticItem: () => void;
    clearOptimisticTurn: () => void;
    disposeListener: () => void;
    clearActiveStreamIfMatch: (eventName: string) => boolean;
  };
  appendThinkingToParts: (
    parts: MessageParts,
    textDelta: string,
  ) => MessageParts;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setPendingActions: Dispatch<SetStateAction<ActionRequired[]>>;
  getThreadItems?: () => readonly AgentThreadItem[];
  setThreadItems: Dispatch<SetStateAction<AgentThreadItem[]>>;
  setTodoItems?: Dispatch<SetStateAction<AgentTodoItem[]>>;
  setThreadTurns: Dispatch<SetStateAction<AgentThreadTurn[]>>;
  setCurrentTurnId: Dispatch<SetStateAction<string | null>>;
  setExecutionRuntime: Dispatch<
    SetStateAction<AgentSessionExecutionRuntime | null>
  >;
  setIsSending: Dispatch<SetStateAction<boolean>>;

}
