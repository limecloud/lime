import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";
import type { Message, MessageImage } from "../types";
import {
  buildWaitingAgentRuntimeStatus,
  formatAgentRuntimeStatusSummary,
} from "../utils/agentRuntimeStatus";

export interface SubmissionPreviewSnapshot {
  key: string;
  prompt: string;
  images: MessageImage[];
  createdAt: number;
  runtimeStatus: NonNullable<Message["runtimeStatus"]>;
}

interface CreateSubmissionPreviewSnapshotOptions {
  key: string;
  prompt: string;
  images: MessageImage[];
  executionStrategy: AsterExecutionStrategy;
  webSearch?: boolean;
  thinking?: boolean;
}

export function createSubmissionPreviewSnapshot(
  options: CreateSubmissionPreviewSnapshotOptions,
): SubmissionPreviewSnapshot {
  const { key, prompt, images, executionStrategy, webSearch, thinking } =
    options;

  return {
    key,
    prompt,
    images,
    createdAt: Date.now(),
    runtimeStatus: buildWaitingAgentRuntimeStatus({
      executionStrategy,
      webSearch,
      thinking,
    }),
  };
}

export function buildSubmissionPreviewMessages(
  snapshot: SubmissionPreviewSnapshot,
): Message[] {
  const timestamp = new Date(snapshot.createdAt);

  return [
    {
      id: `submission-preview:${snapshot.key}:user`,
      role: "user",
      content: snapshot.prompt,
      images: snapshot.images.length > 0 ? snapshot.images : undefined,
      timestamp,
    },
    {
      id: `submission-preview:${snapshot.key}:assistant`,
      role: "assistant",
      content: formatAgentRuntimeStatusSummary(snapshot.runtimeStatus),
      timestamp: new Date(timestamp.getTime() + 1),
      isThinking: true,
      runtimeStatus: snapshot.runtimeStatus,
    },
  ];
}
