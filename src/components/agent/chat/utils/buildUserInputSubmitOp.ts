import type { AgentUserInputOp } from "@/lib/api/agentProtocol";
import type {
  AsterExecutionStrategy,
  AsterSessionExecutionRuntime,
  AutoContinueRequestPayload,
  ImageInput,
} from "@/lib/api/agentRuntime";
import type { SessionModelPreference } from "../hooks/agentChatShared";
import type { MessageImage } from "../types";
import type { ChatToolPreferences } from "./chatToolPreferences";
import { buildSubmitOpRuntimeCompaction } from "./submitOpRuntimeCompaction";

function buildSubmitImages(images: MessageImage[]): ImageInput[] | undefined {
  if (images.length === 0) {
    return undefined;
  }

  return images.map((image) => ({
    data: image.data,
    media_type: image.mediaType,
  }));
}

export interface BuildUserInputSubmitOpOptions {
  content: string;
  images: MessageImage[];
  sessionId: string;
  eventName: string;
  workspaceId?: string;
  turnId?: string;
  systemPrompt?: string;
  queueIfBusy?: boolean;
  requestMetadata?: Record<string, unknown>;
  executionRuntime?: AsterSessionExecutionRuntime | null;
  syncedRecentPreferences?: ChatToolPreferences | null;
  syncedSessionModelPreference?: SessionModelPreference | null;
  syncedExecutionStrategy?: AsterExecutionStrategy | null;
  effectiveExecutionStrategy: AsterExecutionStrategy;
  effectiveProviderType: string;
  effectiveModel: string;
  modelOverride?: string;
  webSearch?: boolean;
  thinking?: boolean;
  autoContinue?: AutoContinueRequestPayload;
}

export function buildUserInputSubmitOp(
  options: BuildUserInputSubmitOpOptions,
): AgentUserInputOp {
  const {
    content,
    images,
    sessionId,
    eventName,
    workspaceId,
    turnId,
    systemPrompt,
    queueIfBusy,
    requestMetadata,
    executionRuntime,
    syncedRecentPreferences,
    syncedSessionModelPreference,
    syncedExecutionStrategy,
    effectiveExecutionStrategy,
    effectiveProviderType,
    effectiveModel,
    modelOverride,
    webSearch,
    thinking,
    autoContinue,
  } = options;

  const compaction = buildSubmitOpRuntimeCompaction({
    requestMetadata,
    executionRuntime,
    syncedRecentPreferences,
    syncedSessionModelPreference,
    syncedExecutionStrategy,
    effectiveExecutionStrategy,
    effectiveProviderType,
    effectiveModel,
    modelOverride,
    webSearch,
    thinking,
  });

  return {
    type: "user_input",
    text: content,
    sessionId,
    eventName,
    workspaceId,
    turnId,
    images: buildSubmitImages(images),
    preferences: {
      providerPreference: compaction.shouldSubmitProviderPreference
        ? effectiveProviderType
        : undefined,
      modelPreference: compaction.shouldSubmitModelPreference
        ? effectiveModel
        : undefined,
      thinking: compaction.shouldSubmitThinking ? thinking : undefined,
      executionStrategy: compaction.shouldSubmitExecutionStrategy
        ? effectiveExecutionStrategy
        : undefined,
      webSearch: compaction.shouldSubmitWebSearch ? webSearch : undefined,
      autoContinue,
    },
    systemPrompt,
    metadata: compaction.metadata,
    queueIfBusy,
  };
}
