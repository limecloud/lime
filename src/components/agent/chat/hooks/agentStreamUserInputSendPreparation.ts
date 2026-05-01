import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";
import type {
  AssistantDraftState,
  SendMessageObserver,
  SendMessageOptions,
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
  | "isThreadBusy"
  | "hasPendingPreparedSubmit"
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
  options?: SendMessageOptions;
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
  skillRequest?: SendMessageOptions["skillRequest"];
  skipSessionRestore?: boolean;
  skipSessionStartHooks?: boolean;
  skipPreSubmitResume?: boolean;
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
  const resolvedProviderOverride = sendOptions?.providerOverride?.trim();
  const resolvedModelOverride =
    sendOptions?.modelOverride?.trim() || modelOverride?.trim();
  const effectiveProviderType =
    resolvedProviderOverride || env.providerTypeRef.current;
  const effectiveModel = resolvedModelOverride || env.modelRef.current;
  const currentSessionId = env.sessionIdRef.current;
  const syncedSessionModelPreference = currentSessionId
    ? env.getSyncedSessionModelPreference(currentSessionId)
    : null;
  const observer = sendOptions?.observer;
  const requestMetadata = sendOptions?.requestMetadata;
  const messagePurpose = sendOptions?.purpose;
  const assistantDraft = sendOptions?.assistantDraft;
  const skipSessionRestore = sendOptions?.skipSessionRestore === true;
  const skipSessionStartHooks = sendOptions?.skipSessionStartHooks === true;
  const skipPreSubmitResume = sendOptions?.skipPreSubmitResume === true;
  const resolvedSystemPrompt =
    sendOptions?.systemPromptOverride?.trim() || systemPrompt;
  const displayContent = sendOptions?.displayContent;
  const skillRequest = sendOptions?.skillRequest;
  const expectingQueue =
    Boolean(env.activeStreamRef.current) ||
    env.getQueuedTurnsCount() > 0 ||
    env.isThreadBusy() ||
    env.hasPendingPreparedSubmit();
  const assistantMsgId = crypto.randomUUID();
  const userMsgId = skipUserMessage ? null : crypto.randomUUID();
  const { assistantMsg } = prepareAgentStreamSubmitDraft({
    content,
    displayContent,
    images,
    skipUserMessage,
    expectingQueue,
    assistantMsgId,
    userMsgId,
    assistantDraft,
    requestMetadata,
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
    modelOverride: resolvedModelOverride,
    autoContinue,
    systemPrompt: resolvedSystemPrompt,
    syncedSessionModelPreference,
    observer,
    requestMetadata,
    assistantDraft,
    skillRequest,
    skipSessionRestore,
    skipSessionStartHooks,
    skipPreSubmitResume,
    expectingQueue,
    assistantMsgId,
    userMsgId,
    assistantMsg,
  };
}
