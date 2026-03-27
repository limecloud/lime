import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";
import type {
  AssistantDraftState,
  SendMessageObserver,
  SessionModelPreference,
} from "./agentChatShared";
import type { Message, MessageImage } from "../types";
import { prepareAgentStreamSubmitDraft } from "./agentStreamSubmitDraft";
import type { AgentStreamPreparedSendEnv } from "./agentStreamPreparedSendEnv";

export type AgentStreamUserInputSendPreparationEnv = Pick<
  AgentStreamPreparedSendEnv,
  | "executionStrategy"
  | "providerTypeRef"
  | "modelRef"
  | "sessionIdRef"
  | "activeStreamRef"
  | "getQueuedTurnsCount"
  | "getSyncedSessionModelPreference"
  | "setMessages"
  | "setIsSending"
>;

interface PrepareAgentStreamUserInputSendOptions {
  content: string;
  images: MessageImage[];
  webSearch?: boolean;
  thinking?: boolean;
  skipUserMessage: boolean;
  executionStrategyOverride?: AsterExecutionStrategy;
  modelOverride?: string;
  autoContinue?: import("@/lib/api/agentRuntime").AutoContinueRequestPayload;
  systemPrompt?: string;
  options?: {
    purpose?: Message["purpose"];
    observer?: SendMessageObserver;
    requestMetadata?: Record<string, unknown>;
    assistantDraft?: AssistantDraftState;
  };
  env: AgentStreamUserInputSendPreparationEnv;
}

export interface PreparedAgentStreamUserInputSend {
  content: string;
  images: MessageImage[];
  webSearch?: boolean;
  thinking?: boolean;
  skipUserMessage: boolean;
  effectiveExecutionStrategy: AsterExecutionStrategy;
  effectiveProviderType: string;
  effectiveModel: string;
  modelOverride?: string;
  autoContinue?: import("@/lib/api/agentRuntime").AutoContinueRequestPayload;
  systemPrompt?: string;
  syncedSessionModelPreference: SessionModelPreference | null;
  observer?: SendMessageObserver;
  requestMetadata?: Record<string, unknown>;
  assistantDraft?: AssistantDraftState;
  expectingQueue: boolean;
  assistantMsgId: string;
  userMsgId: string | null;
  assistantMsg: Message;
}

export function prepareAgentStreamUserInputSend(
  options: PrepareAgentStreamUserInputSendOptions,
): PreparedAgentStreamUserInputSend {
  const {
    content,
    images,
    webSearch,
    thinking,
    skipUserMessage,
    executionStrategyOverride,
    modelOverride,
    autoContinue,
    systemPrompt,
    options: sendOptions,
    env,
  } = options;

  const effectiveExecutionStrategy =
    executionStrategyOverride || env.executionStrategy;
  const effectiveProviderType = env.providerTypeRef.current;
  const effectiveModel = modelOverride?.trim() || env.modelRef.current;
  const currentSessionId = env.sessionIdRef.current;
  const syncedSessionModelPreference = currentSessionId
    ? env.getSyncedSessionModelPreference(currentSessionId)
    : null;
  const observer = sendOptions?.observer;
  const requestMetadata = sendOptions?.requestMetadata;
  const messagePurpose = sendOptions?.purpose;
  const assistantDraft = sendOptions?.assistantDraft;
  const expectingQueue =
    Boolean(env.activeStreamRef.current) || env.getQueuedTurnsCount() > 0;
  const assistantMsgId = crypto.randomUUID();
  const userMsgId = skipUserMessage ? null : crypto.randomUUID();
  const { assistantMsg } = prepareAgentStreamSubmitDraft({
    content,
    images,
    skipUserMessage,
    expectingQueue,
    assistantMsgId,
    userMsgId,
    assistantDraft,
    messagePurpose,
    effectiveExecutionStrategy,
    webSearch,
    thinking,
    setMessages: env.setMessages,
    setIsSending: env.setIsSending,
  });

  return {
    content,
    images,
    webSearch,
    thinking,
    skipUserMessage,
    effectiveExecutionStrategy,
    effectiveProviderType,
    effectiveModel,
    modelOverride,
    autoContinue,
    systemPrompt,
    syncedSessionModelPreference,
    observer,
    requestMetadata,
    assistantDraft,
    expectingQueue,
    assistantMsgId,
    userMsgId,
    assistantMsg,
  };
}
