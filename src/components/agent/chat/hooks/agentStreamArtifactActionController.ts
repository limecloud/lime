import type {
  AgentArtifactSignal,
  AgentEventActionRequired,
} from "@/lib/api/agentProtocol";

export interface AgentStreamArtifactSnapshotPreApplyPlan {
  artifactId: string | null;
  hasFilePath: boolean;
  hasInlineContent: boolean;
  shouldActivateStream: boolean;
  shouldClearOptimisticItem: boolean;
  shouldMarkMeaningfulCompletionSignal: boolean;
}

export interface AgentStreamActionRequiredPreApplyPlan {
  actionType: AgentEventActionRequired["action_type"];
  requestId: string;
  shouldActivateStream: boolean;
  shouldClearOptimisticItem: boolean;
}

export function buildAgentStreamArtifactSnapshotPreApplyPlan(params: {
  artifact: AgentArtifactSignal;
}): AgentStreamArtifactSnapshotPreApplyPlan {
  return {
    artifactId: params.artifact.artifactId || null,
    hasFilePath: Boolean(params.artifact.filePath?.trim()),
    hasInlineContent: Boolean(params.artifact.content?.trim()),
    shouldActivateStream: true,
    shouldClearOptimisticItem: true,
    shouldMarkMeaningfulCompletionSignal: true,
  };
}

export function buildAgentStreamActionRequiredPreApplyPlan(
  event: AgentEventActionRequired,
): AgentStreamActionRequiredPreApplyPlan {
  return {
    actionType: event.action_type,
    requestId: event.request_id,
    shouldActivateStream: true,
    shouldClearOptimisticItem: true,
  };
}
