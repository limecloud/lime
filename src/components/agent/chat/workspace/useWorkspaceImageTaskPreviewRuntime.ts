import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { listDirectory, readFilePreview } from "@/lib/api/fileBrowser";
import type { MediaTaskArtifactOutput } from "@/lib/api/mediaTasks";
import { safeListen } from "@/lib/dev-bridge";
import { resolveAbsoluteWorkspacePath } from "./workspacePath";
import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import {
  replaceDocumentImageTaskPlaceholderWithImage,
  upsertDocumentImageTaskPlaceholder,
} from "@/components/workspace/document/utils/imageTaskPlaceholder";
import type { Message, MessageImageWorkbenchPreview } from "../types";
import {
  buildImageWorkbenchProcessDescriptor,
  resolveImageWorkbenchAssistantMessageId,
  resolveScopedImageWorkbenchApplyTarget,
  type ImageWorkbenchOutput,
  type ImageWorkbenchTask,
  type SessionImageWorkbenchState,
} from "./imageWorkbenchHelpers";

const IMAGE_TASK_EVENT_NAME = "lime://creation_task_submitted";
const IMAGE_TASK_FILE_PREVIEW_MAX_SIZE = 256 * 1024;
const IMAGE_TASK_POLL_INTERVAL_MS = 3000;
const IMAGE_TASK_RESTORE_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const IMAGE_TASK_RESTORE_LIMIT = 8;
const IMAGE_TASKS_ROOT_RELATIVE_PATH = ".lime/tasks";
const IMAGE_TASKS_RESTORE_SCAN_DEPTH = 2;

interface CreationTaskSubmittedPayload {
  task_id?: string;
  task_type?: string;
  task_family?: string;
  status?: string;
  current_attempt_id?: string;
  path?: string;
  absolute_path?: string;
  prompt?: string;
  size?: string;
  mode?: string;
  raw_text?: string;
  count?: number;
  reused_existing?: boolean;
  session_id?: string;
  project_id?: string;
  content_id?: string;
  entry_source?: string;
  requested_target?: string;
  slot_id?: string;
  anchor_hint?: string;
  anchor_section_title?: string;
  anchor_text?: string;
}

interface TrackedImageTask {
  taskId: string;
  taskType: string;
  taskFamily: string;
  artifactPath: string;
  absolutePath: string;
  timerId: number | null;
  polling: boolean;
}

export interface ParsedImageTaskSnapshot {
  taskId: string;
  message: Message;
  task: ImageWorkbenchTask;
  outputs: ImageWorkbenchOutput[];
  terminal: boolean;
  updatedAt: number;
}

interface UseWorkspaceImageTaskPreviewRuntimeParams {
  sessionId?: string | null;
  projectId?: string | null;
  contentId?: string | null;
  projectRootPath?: string | null;
  restoreFromWorkspace?: boolean;
  canvasState: CanvasStateUnion | null;
  setCanvasState: Dispatch<SetStateAction<CanvasStateUnion | null>>;
  setChatMessages: Dispatch<SetStateAction<Message[]>>;
  updateCurrentImageWorkbenchState: (
    updater: (
      current: SessionImageWorkbenchState,
    ) => SessionImageWorkbenchState,
  ) => void;
}

interface TaskContextMetadata {
  sessionId?: string;
  projectId?: string;
  contentId?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return undefined;
}

function readPositiveNumber(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): number | undefined {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    for (const key of keys) {
      const value = candidate[key];
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
  }
  return undefined;
}

function readBoolean(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): boolean | undefined {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === "boolean") {
        return value;
      }
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true") {
          return true;
        }
        if (normalized === "false") {
          return false;
        }
      }
    }
  }
  return undefined;
}

function readStringArray(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): string[] {
  const values: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    for (const key of keys) {
      const value = candidate[key];
      if (!Array.isArray(value)) {
        continue;
      }
      for (const item of value) {
        if (typeof item !== "string") {
          continue;
        }
        const trimmed = item.trim();
        if (!trimmed || values.includes(trimmed)) {
          continue;
        }
        values.push(trimmed);
      }
      if (values.length > 0) {
        return values;
      }
    }
  }
  return values;
}

function normalizeRenderableImageUrl(value?: string | null): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  if (
    normalized.toLowerCase().startsWith("data:image/") ||
    normalized.startsWith("blob:") ||
    normalized.startsWith("file://") ||
    /^https?:\/\//i.test(normalized)
  ) {
    return normalized;
  }
  return null;
}

function resolveTaskSlotId(
  taskRecord: Record<string, unknown>,
): string | undefined {
  return readString(
    [asRecord(taskRecord.relationships), asRecord(taskRecord.payload)],
    ["slot_id", "slotId"],
  );
}

function resolveTaskAnchorSectionTitle(
  taskRecord: Record<string, unknown>,
): string | undefined {
  return readString(
    [asRecord(taskRecord.payload)],
    ["anchor_section_title", "anchorSectionTitle"],
  );
}

function resolveTaskAnchorText(
  taskRecord: Record<string, unknown>,
): string | undefined {
  return readString(
    [asRecord(taskRecord.payload)],
    ["anchor_text", "anchorText"],
  );
}

function isDocumentInlineTaskRecord(
  taskRecord: Record<string, unknown>,
): boolean {
  const payload = asRecord(taskRecord.payload);
  return (
    readString([payload], ["usage"]) === "document-inline" ||
    Boolean(resolveTaskSlotId(taskRecord))
  );
}

function normalizeTaskFamily(
  taskType: string,
  taskFamily?: string,
): string | undefined {
  const normalizedFamily = taskFamily?.trim().toLowerCase();
  if (normalizedFamily) {
    return normalizedFamily;
  }

  const normalizedType = taskType.trim().toLowerCase();
  if (normalizedType.includes("image") || normalizedType.includes("cover")) {
    return "image";
  }
  if (normalizedType.includes("video")) {
    return "video";
  }
  return undefined;
}

function normalizeTaskRef(value?: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeTaskStatus(status?: string): string {
  switch ((status || "").trim().toLowerCase()) {
    case "pending_submit":
    case "pending":
      return "pending";
    case "queued":
      return "queued";
    case "running":
    case "processing":
    case "in_progress":
      return "running";
    case "partial":
      return "partial";
    case "completed":
    case "success":
    case "succeeded":
      return "succeeded";
    case "failed":
    case "error":
      return "failed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      return "pending";
  }
}

function matchesRuntimeEventContext(params: {
  payload: CreationTaskSubmittedPayload;
  sessionId?: string | null;
  projectId?: string | null;
  contentId?: string | null;
}): boolean {
  const normalizedSessionId = normalizeTaskRef(params.sessionId);
  const normalizedProjectId = normalizeTaskRef(params.projectId);
  const normalizedContentId = normalizeTaskRef(params.contentId);
  const payloadSessionId = normalizeTaskRef(params.payload.session_id);
  const payloadProjectId = normalizeTaskRef(params.payload.project_id);
  const payloadContentId = normalizeTaskRef(params.payload.content_id);
  let matchedScopedContext = false;

  if (
    normalizedSessionId &&
    payloadSessionId &&
    payloadSessionId !== normalizedSessionId
  ) {
    return false;
  }
  if (normalizedSessionId && payloadSessionId === normalizedSessionId) {
    matchedScopedContext = true;
  }
  if (
    normalizedProjectId &&
    payloadProjectId &&
    payloadProjectId !== normalizedProjectId
  ) {
    return false;
  }
  if (
    normalizedContentId &&
    payloadContentId &&
    payloadContentId !== normalizedContentId
  ) {
    return false;
  }
  if (normalizedContentId && payloadContentId === normalizedContentId) {
    matchedScopedContext = true;
  }

  if (normalizedSessionId || normalizedContentId) {
    return matchedScopedContext;
  }

  return true;
}

function resolveTaskRecordTimestamp(
  taskRecord: Record<string, unknown>,
): number {
  const timestampRaw =
    readString(
      [taskRecord],
      ["updated_at", "updatedAt", "created_at", "createdAt"],
    ) || "";
  const timestamp = Date.parse(timestampRaw);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function resolveTaskContextMetadata(
  taskRecord: Record<string, unknown>,
): TaskContextMetadata {
  const payload = asRecord(taskRecord.payload);
  return {
    sessionId: normalizeTaskRef(
      readString([taskRecord, payload], ["session_id", "sessionId"]),
    ),
    projectId: normalizeTaskRef(
      readString([taskRecord, payload], ["project_id", "projectId"]),
    ),
    contentId: normalizeTaskRef(
      readString([taskRecord, payload], ["content_id", "contentId"]),
    ),
  };
}

function shouldRestoreImageTaskRecord(params: {
  taskRecord: Record<string, unknown>;
  sessionId?: string | null;
  projectId?: string | null;
  contentId?: string | null;
}): boolean {
  const taskType =
    readString([params.taskRecord], ["task_type", "taskType"]) || "";
  const taskFamily = normalizeTaskFamily(
    taskType,
    readString([params.taskRecord], ["task_family", "taskFamily"]),
  );
  if (taskFamily !== "image") {
    return false;
  }

  const metadata = resolveTaskContextMetadata(params.taskRecord);
  const normalizedSessionId = normalizeTaskRef(params.sessionId);
  const normalizedProjectId = normalizeTaskRef(params.projectId);
  const normalizedContentId = normalizeTaskRef(params.contentId);
  let matchedScopedContext = false;

  if (
    normalizedSessionId &&
    metadata.sessionId &&
    metadata.sessionId !== normalizedSessionId
  ) {
    return false;
  }
  if (
    normalizedProjectId &&
    metadata.projectId &&
    metadata.projectId !== normalizedProjectId
  ) {
    return false;
  }
  if (
    normalizedContentId &&
    metadata.contentId &&
    metadata.contentId !== normalizedContentId
  ) {
    return false;
  }

  if (normalizedSessionId && metadata.sessionId === normalizedSessionId) {
    matchedScopedContext = true;
  }
  if (normalizedContentId && metadata.contentId === normalizedContentId) {
    matchedScopedContext = true;
  }

  if (normalizedSessionId || normalizedContentId) {
    return matchedScopedContext;
  }
  if (normalizedProjectId && metadata.projectId === normalizedProjectId) {
    return true;
  }

  const normalizedStatus = normalizeTaskStatus(
    readString([params.taskRecord], ["normalized_status", "status"]),
  );
  if (
    normalizedStatus === "pending" ||
    normalizedStatus === "queued" ||
    normalizedStatus === "running" ||
    normalizedStatus === "partial"
  ) {
    return true;
  }

  return (
    Date.now() - resolveTaskRecordTimestamp(params.taskRecord) <=
    IMAGE_TASK_RESTORE_LOOKBACK_MS
  );
}

async function collectImageTaskCandidatePaths(
  projectRootPath: string,
): Promise<string[]> {
  const normalizedProjectRoot = projectRootPath.trim();
  if (!normalizedProjectRoot) {
    return [];
  }

  const rootPath = resolveAbsoluteWorkspacePath(
    normalizedProjectRoot,
    IMAGE_TASKS_ROOT_RELATIVE_PATH,
  );
  if (!rootPath) {
    return [];
  }

  const pendingDirs: Array<{ path: string; depth: number }> = [
    { path: rootPath, depth: 0 },
  ];
  const discoveredPaths: string[] = [];
  const visitedDirs = new Set<string>();

  while (pendingDirs.length > 0) {
    const currentDir = pendingDirs.shift();
    if (!currentDir || visitedDirs.has(currentDir.path)) {
      continue;
    }
    visitedDirs.add(currentDir.path);

    try {
      const listing = await listDirectory(currentDir.path);
      if (listing.error) {
        continue;
      }

      for (const entry of listing.entries) {
        if (entry.isDir) {
          if (currentDir.depth < IMAGE_TASKS_RESTORE_SCAN_DEPTH) {
            pendingDirs.push({
              path: entry.path,
              depth: currentDir.depth + 1,
            });
          }
          continue;
        }

        if (entry.name.toLowerCase().endsWith(".json")) {
          discoveredPaths.push(entry.path);
        }
      }
    } catch {
      continue;
    }
  }

  return discoveredPaths;
}

function sanitizePreviewPrompt(value?: string): string {
  const trimmed = value?.trim() || "";
  if (!trimmed) {
    return "";
  }

  const mediaTagMatch = trimmed.match(/^\[(?:img|video):(.+)\]$/i);
  if (mediaTagMatch?.[1]) {
    return mediaTagMatch[1].trim();
  }

  return trimmed;
}

export function syncDocumentInlineImageTask(params: {
  taskRecord: Record<string, unknown>;
  taskId: string;
  outputs: ImageWorkbenchOutput[];
  setCanvasState: Dispatch<SetStateAction<CanvasStateUnion | null>>;
}): void {
  if (!isDocumentInlineTaskRecord(params.taskRecord)) {
    return;
  }

  const payload = asRecord(params.taskRecord.payload);
  const prompt =
    sanitizePreviewPrompt(readString([payload], ["prompt"])) || "配图任务";
  const slotId = resolveTaskSlotId(params.taskRecord);
  const anchorSectionTitle = resolveTaskAnchorSectionTitle(params.taskRecord);
  const anchorText = resolveTaskAnchorText(params.taskRecord);
  const normalizedStatus = normalizeTaskStatus(
    readString([params.taskRecord], ["normalized_status", "status"]),
  );
  const firstOutputUrl = params.outputs[0]?.url?.trim();

  params.setCanvasState((previous) => {
    if (!previous || previous.type !== "document") {
      return previous;
    }

    let nextContent = previous.content;
    if (
      (normalizedStatus === "succeeded" || normalizedStatus === "partial") &&
      firstOutputUrl
    ) {
      nextContent = replaceDocumentImageTaskPlaceholderWithImage(
        previous.content,
        {
          taskId: params.taskId,
          slotId,
          anchorSectionTitle,
          anchorText,
          prompt,
          imageUrl: firstOutputUrl,
        },
      );
    } else {
      nextContent = upsertDocumentImageTaskPlaceholder(previous.content, {
        taskId: params.taskId,
        slotId,
        anchorSectionTitle,
        anchorText,
        prompt,
        status:
          normalizedStatus === "failed"
            ? "failed"
            : normalizedStatus === "cancelled"
              ? "cancelled"
              : "running",
      });
    }

    if (nextContent === previous.content) {
      return previous;
    }

    return {
      ...previous,
      content: nextContent,
    };
  });
}

function normalizeTaskModeValue(
  value?: string,
): ImageWorkbenchTask["mode"] | undefined {
  switch ((value || "").trim().toLowerCase()) {
    case "edit":
      return "edit";
    case "variation":
    case "variant":
      return "variation";
    case "generate":
      return "generate";
    default:
      return undefined;
  }
}

function resolveTaskLabel(
  taskType: string,
  taskMode: ImageWorkbenchTask["mode"],
): string {
  const normalizedType = taskType.trim().toLowerCase();
  if (normalizedType === "cover_generate") {
    return "封面任务";
  }
  switch (taskMode) {
    case "edit":
      return "图片编辑任务";
    case "variation":
      return "图片重绘任务";
    case "generate":
    default:
      return normalizedType.includes("image") ? "图片任务" : "媒体任务";
  }
}

function resolveTaskMode(
  taskType: string,
  taskRecord?: Record<string, unknown>,
): ImageWorkbenchTask["mode"] {
  const payloadMode = normalizeTaskModeValue(
    readString([asRecord(taskRecord?.payload)], ["mode", "task_mode"]),
  );
  if (payloadMode) {
    return payloadMode;
  }
  const normalizedType = taskType.trim().toLowerCase();
  if (normalizedType.includes("edit")) {
    return "edit";
  }
  if (
    normalizedType.includes("variation") ||
    normalizedType.includes("variant")
  ) {
    return "variation";
  }
  return "generate";
}

function resolveTaskRequestedTarget(taskType: string): "generate" | "cover" {
  return taskType.trim().toLowerCase() === "cover_generate"
    ? "cover"
    : "generate";
}

function resolvePreviewStatus(
  normalizedStatus: string,
): MessageImageWorkbenchPreview["status"] {
  switch (normalizedStatus) {
    case "partial":
      return "partial";
    case "succeeded":
      return "complete";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    case "pending":
    case "queued":
    case "running":
    default:
      return "running";
  }
}

function resolveWorkbenchStatus(
  normalizedStatus: string,
): ImageWorkbenchTask["status"] {
  switch (normalizedStatus) {
    case "pending":
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "partial":
      return "partial";
    case "succeeded":
      return "complete";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "error";
    default:
      return "routing";
  }
}

function resolvePreviewMessageContent(params: {
  taskLabel: string;
  normalizedStatus: string;
  successCount: number;
  failureMessage?: string;
}): string {
  const label = params.taskLabel;
  switch (params.normalizedStatus) {
    case "partial":
      return `${label}已返回部分结果。`;
    case "succeeded":
      return params.successCount > 0
        ? `${label}已完成，共生成 ${params.successCount} 张。`
        : `${label}已完成。`;
    case "cancelled":
      return params.failureMessage
        ? `${label}已取消：${params.failureMessage}`
        : `${label}已取消。`;
    case "failed":
      return params.failureMessage
        ? `${label}失败：${params.failureMessage}`
        : `${label}失败。`;
    case "queued":
      return `${label}已进入队列，正在等待执行。`;
    case "running":
      return `${label}正在生成中。`;
    case "pending":
    default:
      return `${label}已创建，正在准备执行。`;
  }
}

function resolvePendingProgressPhase(status?: string): string {
  switch (normalizeTaskStatus(status)) {
    case "partial":
      return "partial";
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "pending":
    default:
      return "pending_submit";
  }
}

function resolveTaskProgressPhase(
  progressRecord: Record<string, unknown> | null,
  normalizedStatus: string,
): string | null {
  return (
    readString([progressRecord], ["phase"]) ||
    resolvePendingProgressPhase(normalizedStatus)
  );
}

function resolveAttemptRecord(
  taskRecord: Record<string, unknown>,
): Record<string, unknown> | null {
  const attempts = Array.isArray(taskRecord.attempts)
    ? taskRecord.attempts
    : [];
  if (attempts.length === 0) {
    return null;
  }

  const currentAttemptId =
    typeof taskRecord.current_attempt_id === "string"
      ? taskRecord.current_attempt_id.trim()
      : "";
  if (currentAttemptId) {
    const matched = attempts.find((attempt) => {
      const attemptRecord = asRecord(attempt);
      return attemptRecord?.attempt_id === currentAttemptId;
    });
    if (matched) {
      return asRecord(matched);
    }
  }

  return asRecord(attempts[attempts.length - 1]);
}

interface ParsedImageOutputSeed {
  url: string;
  prompt?: string;
  providerName?: string;
  modelName?: string;
  size?: string;
}

function appendImageOutputSeed(
  target: ParsedImageOutputSeed[],
  seenUrls: Set<string>,
  value: unknown,
  fallbackPrompt: string,
  fallbackProviderName?: string,
  fallbackModelName?: string,
  fallbackSize?: string,
  depth = 0,
): void {
  if (value === null || value === undefined || depth > 4) {
    return;
  }

  if (typeof value === "string") {
    const url = value.trim();
    if (!url || seenUrls.has(url)) {
      return;
    }
    seenUrls.add(url);
    target.push({
      url,
      prompt: fallbackPrompt || undefined,
      providerName: fallbackProviderName,
      modelName: fallbackModelName,
      size: fallbackSize,
    });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) =>
      appendImageOutputSeed(
        target,
        seenUrls,
        item,
        fallbackPrompt,
        fallbackProviderName,
        fallbackModelName,
        fallbackSize,
        depth + 1,
      ),
    );
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  const url = readString([record], ["url", "src", "imageUrl", "image_url"]);
  const prompt = readString([record], ["prompt", "revised_prompt", "title"]);
  const providerName = readString(
    [record],
    ["providerName", "provider_name", "provider", "providerId", "provider_id"],
  );
  const modelName = readString([record], ["modelName", "model_name", "model"]);
  const size = readString([record], ["size", "resolution"]);

  if (url && !seenUrls.has(url)) {
    seenUrls.add(url);
    target.push({
      url,
      prompt: prompt || fallbackPrompt || undefined,
      providerName: providerName || fallbackProviderName,
      modelName: modelName || fallbackModelName,
      size: size || fallbackSize,
    });
  }

  [
    record.images,
    record.outputs,
    record.results,
    record.items,
    record.data,
    record.output,
    record.result,
    record.image,
    record.asset,
    record.assets,
  ].forEach((nested) =>
    appendImageOutputSeed(
      target,
      seenUrls,
      nested,
      prompt || fallbackPrompt,
      providerName || fallbackProviderName,
      modelName || fallbackModelName,
      size || fallbackSize,
      depth + 1,
    ),
  );
}

function buildParsedImageTaskSnapshot(params: {
  taskRecord: Record<string, unknown>;
  taskId: string;
  taskType: string;
  projectId?: string | null;
  contentId?: string | null;
  canvasState: CanvasStateUnion | null;
}): ParsedImageTaskSnapshot | null {
  const payload = asRecord(params.taskRecord.payload);
  const targetOutputSummary = asRecord(payload?.target_output_summary);
  const progressRecord = asRecord(params.taskRecord.progress);
  const uiHintsRecord = asRecord(params.taskRecord.ui_hints);
  const lastErrorRecord = asRecord(params.taskRecord.last_error);
  const currentAttempt = resolveAttemptRecord(params.taskRecord);
  const currentAttemptResult = currentAttempt?.result_snapshot;
  const resultValue = params.taskRecord.result;
  const normalizedStatus = normalizeTaskStatus(
    typeof params.taskRecord.normalized_status === "string"
      ? params.taskRecord.normalized_status
      : typeof params.taskRecord.status === "string"
        ? params.taskRecord.status
        : undefined,
  );
  const prompt = sanitizePreviewPrompt(
    readString(
      [payload, params.taskRecord, uiHintsRecord],
      ["prompt", "summary", "title", "placeholder_text", "placeholderText"],
    ) || "",
  );
  const fallbackProviderName = readString(
    [currentAttempt, payload],
    ["provider", "providerName", "provider_name", "providerId", "provider_id"],
  );
  const fallbackModelName = readString(
    [currentAttempt, payload],
    ["model", "modelName", "model_name"],
  );
  const fallbackSize = readString([payload], ["size", "resolution"]);
  const requestedCount = readPositiveNumber(
    [payload],
    ["count", "imageCount", "image_count"],
  );
  const targetOutputId = readString(
    [payload],
    ["target_output_id", "targetOutputId"],
  );
  const targetOutputRefId = readString(
    [payload],
    ["target_output_ref_id", "targetOutputRefId"],
  );
  const referenceImages = readStringArray(
    [payload],
    ["reference_images", "referenceImages"],
  );
  const sourceImageUrl =
    normalizeRenderableImageUrl(
      readString(
        [targetOutputSummary],
        ["url", "src", "imageUrl", "image_url"],
      ),
    ) ?? normalizeRenderableImageUrl(referenceImages[0]);
  const sourceImagePrompt = sanitizePreviewPrompt(
    readString([targetOutputSummary], ["prompt", "summary", "title"]) || "",
  );
  const sourceImageCount =
    referenceImages.length > 0
      ? referenceImages.length
      : targetOutputId || targetOutputRefId
        ? 1
        : undefined;
  const expectedCount = requestedCount || 1;
  const taskMode = resolveTaskMode(params.taskType, params.taskRecord);
  const taskLabel = resolveTaskLabel(params.taskType, taskMode);
  const lastError =
    readString([lastErrorRecord, progressRecord], ["message"]) ||
    (typeof params.taskRecord.last_error === "string"
      ? params.taskRecord.last_error.trim()
      : undefined);

  const outputSeeds: ParsedImageOutputSeed[] = [];
  const seenUrls = new Set<string>();
  [
    resultValue,
    currentAttemptResult,
    payload?.imageUrl,
    payload?.image_url,
  ].forEach((candidate) =>
    appendImageOutputSeed(
      outputSeeds,
      seenUrls,
      candidate,
      prompt,
      fallbackProviderName,
      fallbackModelName,
      fallbackSize,
    ),
  );

  const applyTarget = resolveScopedImageWorkbenchApplyTarget({
    canvasState: params.canvasState,
    projectId: params.projectId ?? null,
    contentId: params.contentId ?? null,
    requestedTarget: resolveTaskRequestedTarget(params.taskType),
  });
  const createdAtRaw =
    readString(
      [params.taskRecord],
      ["updated_at", "updatedAt", "created_at", "createdAt"],
    ) || new Date().toISOString();
  const createdAt = Number.isNaN(Date.parse(createdAtRaw))
    ? Date.now()
    : Date.parse(createdAtRaw);
  const outputs: ImageWorkbenchOutput[] = outputSeeds.map((output, index) => ({
    id: `${params.taskId}:output:${index + 1}`,
    taskId: params.taskId,
    hookImageId: `${params.taskId}:hook:${index + 1}`,
    refId: `img-${params.taskId.slice(0, 6)}-${index + 1}`,
    url: output.url,
    prompt: output.prompt || prompt || `${taskLabel}结果`,
    createdAt,
    providerName: output.providerName,
    modelName: output.modelName,
    size: output.size,
    parentOutputId: targetOutputId ?? null,
    resourceSaved: false,
    applyTarget,
  }));
  const successCount = outputs.length;
  const previewStatus = resolvePreviewStatus(normalizedStatus);
  const attemptCount = Array.isArray(params.taskRecord.attempts)
    ? params.taskRecord.attempts.length
    : undefined;
  const preview: MessageImageWorkbenchPreview = {
    taskId: params.taskId,
    prompt: prompt || `${taskLabel}进行中`,
    mode: taskMode,
    status: previewStatus,
    projectId: params.projectId ?? null,
    contentId: params.contentId ?? null,
    imageUrl: outputs[0]?.url ?? null,
    imageCount:
      previewStatus === "running" ? requestedCount : successCount || undefined,
    sourceImageUrl,
    sourceImagePrompt: sourceImagePrompt || null,
    sourceImageRef: targetOutputRefId ?? null,
    sourceImageCount,
    size: fallbackSize,
    phase: resolveTaskProgressPhase(progressRecord, normalizedStatus),
    statusMessage:
      readString([progressRecord], ["message"]) || lastError || null,
    retryable: readBoolean([lastErrorRecord], ["retryable"]),
    attemptCount,
    placeholderText:
      readString([uiHintsRecord], ["placeholder_text", "placeholderText"]) ||
      null,
  };

  const runtimeStatus =
    previewStatus === "running"
      ? {
          phase:
            normalizedStatus === "pending" || normalizedStatus === "queued"
              ? ("preparing" as const)
              : ("routing" as const),
          title: `${taskLabel}进行中`,
          detail:
            readString([progressRecord], ["message"]) ||
            (prompt
              ? `正在处理：${prompt}`
              : "任务已提交到异步队列，结果会自动回填。"),
          checkpoints: ["创建任务文件", "轮询任务状态", "回填图片结果"],
        }
      : previewStatus === "cancelled"
        ? {
            phase: "cancelled" as const,
            title: `${taskLabel}已取消`,
            detail: lastError || "任务已停止，不会继续生成新的图片结果。",
            checkpoints: [
              "已保留当前任务记录",
              "可在图片画布重新生成",
              "如需继续可补充新的说明",
            ],
          }
        : previewStatus === "failed"
          ? {
              phase: "failed" as const,
              title: `${taskLabel}失败`,
              detail: lastError || "任务未返回可用结果。",
              checkpoints: [
                "检查任务文件",
                "查看失败详情",
                "可在图片画布继续排查",
              ],
            }
          : undefined;
  const messageTimestamp = new Date(createdAt);
  const processDescriptor = buildImageWorkbenchProcessDescriptor({
    taskId: params.taskId,
    prompt: prompt || `${taskLabel}进行中`,
    mode: taskMode,
    status: previewStatus,
    rawText:
      readString([payload], ["raw_text", "rawText"]) ||
      readString([params.taskRecord], ["summary"]) ||
      undefined,
    count: requestedCount,
    successCount,
    size: fallbackSize,
    imageUrl: outputs[0]?.url ?? null,
    failureMessage: lastError,
    startedAt: messageTimestamp,
    endedAt: previewStatus === "running" ? undefined : messageTimestamp,
  });

  return {
    taskId: params.taskId,
    message: {
      id: resolveImageWorkbenchAssistantMessageId(params.taskId),
      role: "assistant",
      content: resolvePreviewMessageContent({
        taskLabel,
        normalizedStatus,
        successCount,
        failureMessage: lastError,
      }),
      timestamp: messageTimestamp,
      isThinking: previewStatus === "running",
      toolCalls: processDescriptor.toolCalls,
      contentParts: processDescriptor.contentParts,
      imageWorkbenchPreview: preview,
      runtimeStatus,
    },
    task: {
      sessionId: params.taskId,
      id: params.taskId,
      mode: taskMode,
      status: resolveWorkbenchStatus(normalizedStatus),
      prompt: prompt || `${taskLabel}进行中`,
      rawText: prompt || `${taskLabel}进行中`,
      expectedCount,
      outputIds: outputs.map((output) => output.id),
      targetOutputId: targetOutputId ?? null,
      targetOutputRefId: targetOutputRefId ?? null,
      sourceImageUrl,
      sourceImagePrompt: sourceImagePrompt || null,
      sourceImageRef: targetOutputRefId ?? null,
      sourceImageCount,
      createdAt,
      failureMessage: lastError,
      hookImageIds: outputs.map((output) => output.hookImageId),
      applyTarget,
    },
    outputs,
    terminal:
      normalizedStatus === "succeeded" ||
      normalizedStatus === "failed" ||
      normalizedStatus === "cancelled",
    updatedAt: createdAt,
  };
}

function buildPendingImageTaskSnapshot(params: {
  taskId: string;
  taskType: string;
  status?: string;
  payload?: Record<string, unknown>;
  progressMessage?: string;
  projectId?: string | null;
  contentId?: string | null;
  canvasState: CanvasStateUnion | null;
}): ParsedImageTaskSnapshot {
  const taskMode = resolveTaskMode(params.taskType, {
    payload: params.payload || {},
  });
  const taskLabel = resolveTaskLabel(params.taskType, taskMode);
  const startedAt = new Date();
  return (
    buildParsedImageTaskSnapshot({
      taskRecord: {
        task_id: params.taskId,
        task_type: params.taskType,
        status: params.status || "pending_submit",
        normalized_status: normalizeTaskStatus(params.status),
        payload: params.payload || {},
        progress: {
          phase: resolvePendingProgressPhase(params.status),
          message:
            params.progressMessage ||
            "任务已提交到异步队列，正在同步任务状态。",
        },
        created_at: new Date().toISOString(),
      },
      taskId: params.taskId,
      taskType: params.taskType,
      projectId: params.projectId ?? null,
      contentId: params.contentId ?? null,
      canvasState: params.canvasState,
    }) || {
      taskId: params.taskId,
      message: {
        id: resolveImageWorkbenchAssistantMessageId(params.taskId),
        role: "assistant",
        content: `${taskLabel}已创建，正在准备执行。`,
        timestamp: startedAt,
        isThinking: true,
        ...buildImageWorkbenchProcessDescriptor({
          taskId: params.taskId,
          prompt: `${taskLabel}进行中`,
          mode: taskMode,
          status: "running",
          count: 1,
          startedAt,
        }),
        imageWorkbenchPreview: {
          taskId: params.taskId,
          prompt: `${taskLabel}进行中`,
          mode: taskMode,
          status: "running",
          projectId: params.projectId ?? null,
          contentId: params.contentId ?? null,
          phase: resolvePendingProgressPhase(params.status),
          statusMessage:
            params.progressMessage ||
            "任务已提交到异步队列，正在同步任务状态。",
        },
      },
      task: {
        sessionId: params.taskId,
        id: params.taskId,
        mode: taskMode,
        status: "queued",
        prompt: `${taskLabel}进行中`,
        rawText: `${taskLabel}进行中`,
        expectedCount: 1,
        outputIds: [],
        targetOutputId: null,
        createdAt: Date.now(),
        hookImageIds: [],
        applyTarget: resolveScopedImageWorkbenchApplyTarget({
          canvasState: params.canvasState,
          projectId: params.projectId ?? null,
          contentId: params.contentId ?? null,
          requestedTarget: resolveTaskRequestedTarget(params.taskType),
        }),
      },
      outputs: [],
      terminal: false,
      updatedAt: Date.now(),
    }
  );
}

export function buildImageTaskSnapshotFromArtifactOutput(params: {
  artifact: MediaTaskArtifactOutput;
  projectId?: string | null;
  contentId?: string | null;
  canvasState: CanvasStateUnion | null;
}): ParsedImageTaskSnapshot | null {
  const record =
    params.artifact.record &&
    typeof params.artifact.record === "object" &&
    !Array.isArray(params.artifact.record)
      ? (params.artifact.record as Record<string, unknown>)
      : null;

  if (record) {
    return (
      buildParsedImageTaskSnapshot({
        taskRecord: record,
        taskId: params.artifact.task_id,
        taskType: params.artifact.task_type,
        projectId: params.projectId ?? null,
        contentId: params.contentId ?? null,
        canvasState: params.canvasState,
      }) || null
    );
  }

  if (!params.artifact.task_id || !params.artifact.task_type) {
    return null;
  }

  return buildPendingImageTaskSnapshot({
    taskId: params.artifact.task_id,
    taskType: params.artifact.task_type,
    status: params.artifact.status,
    projectId: params.projectId ?? null,
    contentId: params.contentId ?? null,
    canvasState: params.canvasState,
  });
}

function upsertPreviewMessage(
  messages: Message[],
  nextMessage: Message,
): Message[] {
  const nextMessages = [...messages];
  const existingIndex = nextMessages.findIndex(
    (message) => message.id === nextMessage.id,
  );
  if (existingIndex >= 0) {
    nextMessages[existingIndex] = nextMessage;
    return nextMessages;
  }

  const nextTaskId = nextMessage.imageWorkbenchPreview?.taskId;
  if (nextTaskId) {
    const taskMatchedIndex = nextMessages.findIndex(
      (message) =>
        message.role === "assistant" &&
        message.imageWorkbenchPreview?.taskId === nextTaskId,
    );
    if (taskMatchedIndex >= 0) {
      const existingMessage = nextMessages[taskMatchedIndex];
      nextMessages[taskMatchedIndex] = {
        ...existingMessage,
        imageWorkbenchPreview: {
          ...(existingMessage.imageWorkbenchPreview || {}),
          ...nextMessage.imageWorkbenchPreview,
        },
        runtimeStatus:
          nextMessage.runtimeStatus ?? existingMessage.runtimeStatus,
      };
      return nextMessages;
    }
  }

  nextMessages.push(nextMessage);
  return nextMessages;
}

export function mergeImageTaskSnapshot(
  current: SessionImageWorkbenchState,
  snapshot: ParsedImageTaskSnapshot,
): SessionImageWorkbenchState {
  const previousTask = current.tasks.find(
    (task) => task.id === snapshot.taskId,
  );
  const previousOutputs = current.outputs.filter(
    (output) => output.taskId === snapshot.taskId,
  );
  const preservedSelectedOutputId = current.outputs.find(
    (output) =>
      output.id === current.selectedOutputId &&
      output.taskId === snapshot.taskId,
  )?.id;
  const mergedOutputs = snapshot.outputs.map((output) => {
    const previousOutput = previousOutputs.find(
      (candidate) => candidate.url === output.url,
    );
    return previousOutput
      ? {
          ...previousOutput,
          ...output,
        }
      : output;
  });
  const selectedOutputId =
    preservedSelectedOutputId &&
    mergedOutputs.some((output) => output.id === preservedSelectedOutputId)
      ? preservedSelectedOutputId
      : mergedOutputs[0]?.id || current.selectedOutputId;

  return {
    ...current,
    tasks: [
      {
        ...snapshot.task,
        sessionId: previousTask?.sessionId || snapshot.task.sessionId,
      },
      ...current.tasks.filter((task) => task.id !== snapshot.taskId),
    ],
    outputs: [
      ...mergedOutputs,
      ...current.outputs.filter((output) => output.taskId !== snapshot.taskId),
    ],
    selectedOutputId,
  };
}

export function useWorkspaceImageTaskPreviewRuntime({
  sessionId,
  projectId,
  contentId,
  projectRootPath,
  restoreFromWorkspace = true,
  canvasState,
  setCanvasState,
  setChatMessages,
  updateCurrentImageWorkbenchState,
}: UseWorkspaceImageTaskPreviewRuntimeParams) {
  const trackedTasksRef = useRef<Map<string, TrackedImageTask>>(new Map());
  const runtimeContextRef = useRef({
    sessionId,
    projectId,
    contentId,
    projectRootPath,
    canvasState,
  });

  runtimeContextRef.current = {
    sessionId,
    projectId,
    contentId,
    projectRootPath,
    canvasState,
  };

  useEffect(() => {
    const trackedTasks = trackedTasksRef.current;
    trackedTasks.forEach((trackedTask) => {
      if (trackedTask.timerId !== null) {
        window.clearTimeout(trackedTask.timerId);
      }
    });
    trackedTasks.clear();

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const scheduleNextPoll = (taskId: string) => {
      const trackedTask = trackedTasks.get(taskId);
      if (!trackedTask || cancelled) {
        return;
      }
      if (trackedTask.timerId !== null) {
        window.clearTimeout(trackedTask.timerId);
      }
      trackedTask.timerId = window.setTimeout(() => {
        trackedTask.timerId = null;
        void syncTaskFile(taskId);
      }, IMAGE_TASK_POLL_INTERVAL_MS);
    };

    const syncTaskFile = async (taskId: string) => {
      const trackedTask = trackedTasks.get(taskId);
      if (!trackedTask || trackedTask.polling || cancelled) {
        return;
      }

      trackedTask.polling = true;

      try {
        const preview = await readFilePreview(
          trackedTask.absolutePath,
          IMAGE_TASK_FILE_PREVIEW_MAX_SIZE,
        );
        if (cancelled || !trackedTasks.has(taskId)) {
          return;
        }

        if (preview.error || !preview.content?.trim()) {
          scheduleNextPoll(taskId);
          return;
        }

        const parsed = JSON.parse(preview.content) as Record<string, unknown>;
        const snapshot = buildParsedImageTaskSnapshot({
          taskRecord: parsed,
          taskId: trackedTask.taskId,
          taskType: trackedTask.taskType,
          projectId: runtimeContextRef.current.projectId,
          contentId: runtimeContextRef.current.contentId,
          canvasState: runtimeContextRef.current.canvasState,
        });
        if (!snapshot) {
          scheduleNextPoll(taskId);
          return;
        }

        setChatMessages((previous) =>
          upsertPreviewMessage(previous, snapshot.message),
        );
        updateCurrentImageWorkbenchState((current) =>
          mergeImageTaskSnapshot(current, snapshot),
        );
        syncDocumentInlineImageTask({
          taskRecord: parsed,
          taskId,
          outputs: snapshot.outputs,
          setCanvasState,
        });

        if (snapshot.terminal) {
          trackedTasks.delete(taskId);
          return;
        }

        scheduleNextPoll(taskId);
      } catch {
        scheduleNextPoll(taskId);
      } finally {
        const trackedTaskAfterSync = trackedTasks.get(taskId);
        if (trackedTaskAfterSync) {
          trackedTaskAfterSync.polling = false;
        }
      }
    };

    const restoreTrackedTasksFromWorkspace = async () => {
      const currentProjectRootPath =
        runtimeContextRef.current.projectRootPath?.trim();
      if (!currentProjectRootPath || cancelled) {
        return;
      }

      const candidatePaths = await collectImageTaskCandidatePaths(
        currentProjectRootPath,
      );
      if (cancelled || candidatePaths.length === 0) {
        return;
      }

      const restoredSnapshots: Array<{
        snapshot: ParsedImageTaskSnapshot;
        taskRecord: Record<string, unknown>;
        absolutePath: string;
        taskType: string;
        taskFamily: string;
      }> = [];
      const seenTaskIds = new Set<string>();

      for (const candidatePath of candidatePaths) {
        try {
          const preview = await readFilePreview(
            candidatePath,
            IMAGE_TASK_FILE_PREVIEW_MAX_SIZE,
          );
          if (cancelled || preview.error || !preview.content?.trim()) {
            continue;
          }

          const parsed = JSON.parse(preview.content) as Record<string, unknown>;
          if (
            !shouldRestoreImageTaskRecord({
              taskRecord: parsed,
              sessionId: runtimeContextRef.current.sessionId,
              projectId: runtimeContextRef.current.projectId,
              contentId: runtimeContextRef.current.contentId,
            })
          ) {
            continue;
          }

          const taskId = readString([parsed], ["task_id", "taskId"]);
          const taskType = readString([parsed], ["task_type", "taskType"]);
          const taskFamily = normalizeTaskFamily(
            taskType || "",
            readString([parsed], ["task_family", "taskFamily"]),
          );
          if (
            !taskId ||
            !taskType ||
            taskFamily !== "image" ||
            seenTaskIds.has(taskId)
          ) {
            continue;
          }

          const snapshot = buildParsedImageTaskSnapshot({
            taskRecord: parsed,
            taskId,
            taskType,
            projectId: runtimeContextRef.current.projectId,
            contentId: runtimeContextRef.current.contentId,
            canvasState: runtimeContextRef.current.canvasState,
          });
          if (!snapshot) {
            continue;
          }

          seenTaskIds.add(taskId);
          restoredSnapshots.push({
            snapshot,
            taskRecord: parsed,
            absolutePath: candidatePath,
            taskType,
            taskFamily,
          });
        } catch {
          continue;
        }
      }

      if (cancelled || restoredSnapshots.length === 0) {
        return;
      }

      const selectedSnapshots = restoredSnapshots
        .sort(
          (left, right) => right.snapshot.updatedAt - left.snapshot.updatedAt,
        )
        .slice(0, IMAGE_TASK_RESTORE_LIMIT)
        .reverse();

      setChatMessages((previous) =>
        selectedSnapshots.reduce(
          (messages, item) =>
            upsertPreviewMessage(messages, item.snapshot.message),
          previous,
        ),
      );
      updateCurrentImageWorkbenchState((current) =>
        selectedSnapshots.reduce(
          (state, item) => mergeImageTaskSnapshot(state, item.snapshot),
          current,
        ),
      );
      selectedSnapshots.forEach((item) => {
        syncDocumentInlineImageTask({
          taskRecord: item.taskRecord,
          taskId: item.snapshot.taskId,
          outputs: item.snapshot.outputs,
          setCanvasState,
        });
      });

      for (const item of selectedSnapshots) {
        if (item.snapshot.terminal) {
          continue;
        }
        trackedTasks.set(item.snapshot.taskId, {
          taskId: item.snapshot.taskId,
          taskType: item.taskType,
          taskFamily: item.taskFamily,
          artifactPath: item.absolutePath,
          absolutePath: item.absolutePath,
          timerId: null,
          polling: false,
        });
        scheduleNextPoll(item.snapshot.taskId);
      }
    };

    safeListen<CreationTaskSubmittedPayload>(IMAGE_TASK_EVENT_NAME, (event) => {
      if (cancelled) {
        return;
      }

      const payload = event.payload || {};
      const taskId = payload.task_id?.trim();
      const taskType = payload.task_type?.trim();
      const taskFamily = normalizeTaskFamily(
        taskType || "",
        payload.task_family,
      );
      const matchesRuntimeContext = matchesRuntimeEventContext({
        payload,
        sessionId: runtimeContextRef.current.sessionId,
        projectId: runtimeContextRef.current.projectId,
        contentId: runtimeContextRef.current.contentId,
      });
      if (!matchesRuntimeContext) {
        return;
      }
      const artifactPath =
        payload.path?.trim() || payload.absolute_path?.trim() || "";
      const pendingSnapshot =
        taskId && taskType && taskFamily === "image"
          ? buildPendingImageTaskSnapshot({
              taskId,
              taskType,
              status: payload.status,
              payload: {
                prompt: payload.prompt,
                size: payload.size,
                mode: payload.mode,
                raw_text: payload.raw_text,
                count:
                  typeof payload.count === "number" ? payload.count : undefined,
                session_id: payload.session_id,
                project_id: payload.project_id,
                content_id: payload.content_id,
                entry_source: payload.entry_source,
                requested_target: payload.requested_target,
                slot_id: payload.slot_id,
                anchor_hint: payload.anchor_hint,
                anchor_section_title: payload.anchor_section_title,
                anchor_text: payload.anchor_text,
              },
              progressMessage: payload.reused_existing
                ? "已复用现有图片任务，正在同步最新状态。"
                : "任务已提交到异步队列，正在同步任务状态。",
              projectId:
                payload.project_id || runtimeContextRef.current.projectId,
              contentId:
                payload.content_id || runtimeContextRef.current.contentId,
              canvasState: runtimeContextRef.current.canvasState,
            })
          : null;
      if (pendingSnapshot) {
        setChatMessages((previous) =>
          upsertPreviewMessage(previous, pendingSnapshot.message),
        );
        updateCurrentImageWorkbenchState((current) =>
          mergeImageTaskSnapshot(current, pendingSnapshot),
        );
        syncDocumentInlineImageTask({
          taskRecord: {
            task_id: taskId,
            task_type: taskType,
            status: payload.status || "pending_submit",
            normalized_status: normalizeTaskStatus(payload.status),
            relationships: payload.slot_id
              ? {
                  slot_id: payload.slot_id,
                }
              : undefined,
            payload: {
              prompt: payload.prompt,
              size: payload.size,
              mode: payload.mode,
              raw_text: payload.raw_text,
              count:
                typeof payload.count === "number" ? payload.count : undefined,
              session_id: payload.session_id,
              project_id: payload.project_id,
              content_id: payload.content_id,
              entry_source: payload.entry_source,
              requested_target: payload.requested_target,
              slot_id: payload.slot_id,
              anchor_hint: payload.anchor_hint,
              anchor_section_title: payload.anchor_section_title,
              anchor_text: payload.anchor_text,
              usage: payload.slot_id ? "document-inline" : undefined,
            },
          },
          taskId,
          outputs: pendingSnapshot.outputs,
          setCanvasState,
        });
      }
      const absolutePath = resolveAbsoluteWorkspacePath(
        runtimeContextRef.current.projectRootPath,
        payload.absolute_path?.trim() || artifactPath,
      );

      if (!taskId || !taskType || taskFamily !== "image" || !absolutePath) {
        return;
      }

      const previousTracked = trackedTasks.get(taskId);
      if (previousTracked && previousTracked.timerId !== null) {
        window.clearTimeout(previousTracked.timerId);
      }
      trackedTasks.set(taskId, {
        taskId,
        taskType,
        taskFamily,
        artifactPath,
        absolutePath,
        timerId: null,
        polling: false,
      });

      void syncTaskFile(taskId);
    })
      .then((dispose) => {
        if (cancelled) {
          void dispose();
          return;
        }
        unlisten = dispose;
      })
      .catch((error) => {
        console.warn("[AgentChatPage] 监听图片任务事件失败:", error);
      });

    if (restoreFromWorkspace) {
      void restoreTrackedTasksFromWorkspace();
    }

    return () => {
      cancelled = true;
      trackedTasks.forEach((trackedTask) => {
        if (trackedTask.timerId !== null) {
          window.clearTimeout(trackedTask.timerId);
        }
      });
      trackedTasks.clear();
      if (unlisten) {
        unlisten();
      }
    };
  }, [
    projectRootPath,
    restoreFromWorkspace,
    sessionId,
    setCanvasState,
    setChatMessages,
    updateCurrentImageWorkbenchState,
  ]);
}
