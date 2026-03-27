import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AgentThreadItem, AgentThreadTurn } from "@/lib/api/agentProtocol";
import type {
  AsterExecutionStrategy,
  AsterSessionExecutionRuntime,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import type {
  SessionModelPreference,
  WorkspacePathMissingState,
} from "./agentChatShared";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import type { ActiveStreamState } from "./agentStreamSubmissionLifecycle";
import type { ActionRequired, Message } from "../types";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";

export type AppendThinkingToPartsFn = (
  parts: NonNullable<Message["contentParts"]>,
  textDelta: string,
) => NonNullable<Message["contentParts"]>;

export interface AgentStreamPreparedSendEnv {
  runtime: AgentRuntimeAdapter;
  ensureSession: () => Promise<string | null>;
  executionStrategy: AsterExecutionStrategy;
  providerTypeRef: MutableRefObject<string>;
  modelRef: MutableRefObject<string>;
  sessionIdRef: MutableRefObject<string | null>;
  getQueuedTurnsCount: () => number;
  getRequiredWorkspaceId: () => string;
  getSyncedSessionModelPreference: (
    sessionId: string,
  ) => SessionModelPreference | null;
  getSyncedSessionExecutionStrategy: (
    sessionId: string,
  ) => AsterExecutionStrategy | null;
  getSyncedSessionRecentPreferences?: (
    sessionId: string,
  ) => ChatToolPreferences | null;
  listenerMapRef: MutableRefObject<Map<string, () => void>>;
  activeStreamRef: MutableRefObject<ActiveStreamState | null>;
  warnedKeysRef: MutableRefObject<Set<string>>;
  onWriteFile?: (
    content: string,
    fileName: string,
    context?: import("../types").WriteArtifactContext,
  ) => void;
  executionRuntime?: AsterSessionExecutionRuntime | null;
  setActiveStream: (nextActive: ActiveStreamState | null) => void;
  clearActiveStreamIfMatch: (eventName: string) => boolean;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setThreadItems: Dispatch<SetStateAction<AgentThreadItem[]>>;
  setThreadTurns: Dispatch<SetStateAction<AgentThreadTurn[]>>;
  setCurrentTurnId: Dispatch<SetStateAction<string | null>>;
  setExecutionRuntime: Dispatch<
    SetStateAction<AsterSessionExecutionRuntime | null>
  >;
  setQueuedTurns: Dispatch<SetStateAction<QueuedTurnSnapshot[]>>;
  setPendingActions: Dispatch<SetStateAction<ActionRequired[]>>;
  setWorkspacePathMissing: Dispatch<
    SetStateAction<WorkspacePathMissingState | null>
  >;
  setIsSending: Dispatch<SetStateAction<boolean>>;
  playToolcallSound: () => void;
  playTypewriterSound: () => void;
  appendThinkingToParts: AppendThinkingToPartsFn;
}
