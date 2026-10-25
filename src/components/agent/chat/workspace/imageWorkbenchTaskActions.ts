import type { AgentRuntimeGeneratedTitleResult } from "@/lib/api/agentRuntime/sessionTypes";
import type {
  CreateImageGenerationTaskArtifactRequest,
  MediaTaskArtifactOutput,
} from "@/lib/api/agentRuntime/mediaTaskTypes";
import type { SessionImageWorkbenchState } from "./imageWorkbenchHelpers";

type ImageWorkbenchTask = SessionImageWorkbenchState["tasks"][number];

function dedupeReferenceImages(values: Array<string | undefined>): string[] {
  const normalized: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || normalized.includes(trimmed)) {
      continue;
    }
    normalized.push(trimmed);
  }
  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function readTaskPayloadString(
  payload: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export function resolveTaskRecordSlotId(
  taskRecord: MediaTaskArtifactOutput["record"] | undefined,
): string | undefined {
  return (
    readTaskPayloadString(asRecord(taskRecord?.relationships) || {}, [
      "slot_id",
      "slotId",
    ]) ||
    readTaskPayloadString(asRecord(taskRecord?.payload) || {}, [
      "slot_id",
      "slotId",
    ])
  );
}

export function resolveTaskRecordAnchorHint(
  taskRecord: MediaTaskArtifactOutput["record"] | undefined,
): string | undefined {
  return readTaskPayloadString(asRecord(taskRecord?.payload) || {}, [
    "anchor_hint",
    "anchorHint",
  ]);
}

export function resolveTaskRecordAnchorSectionTitle(
  taskRecord: MediaTaskArtifactOutput["record"] | undefined,
): string | undefined {
  return readTaskPayloadString(asRecord(taskRecord?.payload) || {}, [
    "anchor_section_title",
    "anchorSectionTitle",
  ]);
}

export function resolveTaskRecordAnchorText(
  taskRecord: MediaTaskArtifactOutput["record"] | undefined,
): string | undefined {
  return readTaskPayloadString(asRecord(taskRecord?.payload) || {}, [
    "anchor_text",
    "anchorText",
  ]);
}

export function readTaskPayloadPositiveNumber(
  payload: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return undefined;
}

export function readTaskPayloadStringArray(
  payload: Record<string, unknown>,
  keys: string[],
): string[] {
  for (const key of keys) {
    const value = payload[key];
    if (!Array.isArray(value)) {
      continue;
    }

    const normalized = dedupeReferenceImages(
      value.map((item) => (typeof item === "string" ? item : undefined)),
    );
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return [];
}

export function readTaskPayloadTitleGenerationResult(
  payload: Record<string, unknown>,
): AgentRuntimeGeneratedTitleResult | undefined {
  const result =
    asRecord(payload.title_generation_result) ||
    asRecord(payload.titleGenerationResult);
  if (!result) {
    return undefined;
  }

  const title =
    (typeof result.title === "string" && result.title.trim()) || undefined;
  if (!title) {
    return undefined;
  }

  const sessionId =
    (typeof result.sessionId === "string" && result.sessionId.trim()) ||
    (typeof result.session_id === "string" && result.session_id.trim()) ||
    null;
  const executionRuntime =
    result.executionRuntime ?? result.execution_runtime ?? null;
  const usedFallback =
    typeof result.usedFallback === "boolean"
      ? result.usedFallback
      : typeof result.used_fallback === "boolean"
        ? result.used_fallback
        : false;
  const fallbackReason =
    (typeof result.fallbackReason === "string" && result.fallbackReason) ||
    (typeof result.fallback_reason === "string" && result.fallback_reason) ||
    null;

  return {
    title,
    sessionId,
    executionRuntime:
      executionRuntime === null
        ? null
        : (executionRuntime as AgentRuntimeGeneratedTitleResult["executionRuntime"]),
    usedFallback,
    fallbackReason,
  };
}

export function resolveReplayMode(
  value: unknown,
): CreateImageGenerationTaskArtifactRequest["mode"] {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "edit") {
    return "edit";
  }
  if (normalized === "variation" || normalized === "variant") {
    return "variation";
  }
  return "generate";
}

export function resolveReplayTarget(
  value: unknown,
): CreateImageGenerationTaskArtifactRequest["requestedTarget"] {
  return typeof value === "string" && value.trim().toLowerCase() === "cover"
    ? "cover"
    : "generate";
}

export function resolveTrackedTaskReplayTarget(
  task: ImageWorkbenchTask | undefined,
): CreateImageGenerationTaskArtifactRequest["requestedTarget"] {
  return task?.applyTarget?.kind === "document-cover" ? "cover" : "generate";
}

export function resolveTrackedTaskReplayUsage(
  task: ImageWorkbenchTask | undefined,
): CreateImageGenerationTaskArtifactRequest["usage"] {
  if (task?.applyTarget?.kind === "document-cover") {
    return "cover";
  }
  if (task?.applyTarget?.kind === "canvas-insert") {
    return "document-inline";
  }
  return "image-workbench";
}

export function resolvePendingImageTaskId(
  tasks: SessionImageWorkbenchState["tasks"],
): string | null {
  let latestTask: ImageWorkbenchTask | null = null;

  for (const task of tasks) {
    if (
      task.status !== "queued" &&
      task.status !== "routing" &&
      task.status !== "running"
    ) {
      continue;
    }
    if (!latestTask || task.createdAt >= latestTask.createdAt) {
      latestTask = task;
    }
  }

  return latestTask?.id ?? null;
}

export function matchesTaskActionContext(params: {
  detailProjectId?: string | null;
  detailContentId?: string | null;
  projectId?: string | null;
  contentId?: string | null;
}): boolean {
  if (
    params.detailProjectId &&
    params.projectId &&
    params.detailProjectId !== params.projectId
  ) {
    return false;
  }

  if (
    params.detailContentId &&
    params.contentId &&
    params.detailContentId !== params.contentId
  ) {
    return false;
  }

  return true;
}
