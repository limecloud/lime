import type { CanvasStateUnion } from "@/components/workspace/canvas/canvasUtils";
import type { MediaTaskArtifactOutput } from "@/lib/api/agentRuntime/mediaTaskTypes";
import type {
  ImageStoryboardSlot,
  Message,
  MessageImageWorkbenchPreview,
} from "../types";
import { parseImageWorkbenchCommand } from "../utils/imageWorkbenchCommand";
import { buildImageWorkbenchCaption } from "../utils/imageWorkbenchPresentation";
import {
  resolveImageWorkbenchAssistantMessageId,
  resolveScopedImageWorkbenchApplyTarget,
  type ImageWorkbenchOutput,
  type ImageWorkbenchTask,
} from "./imageWorkbenchHelpers";
import { resolveTaskRecordInlineApplyTarget } from "./imageTaskPreviewApplyTarget";
import { normalizeImageTaskPath } from "./imageTaskLocator";
import {
  asRecord,
  buildNormalizedStoryboardSlot,
  mergeStoryboardSlots,
  readBoolean,
  readImageCommandRunSnapshot,

  readImageTaskPresentationCaption,
  readImageTaskPresentationText,
  readPositiveNumber,
  readStoryboardSlotsFromUnknown,
  readString,
  readStringArray,
  resolveImageRuntimeContractSnapshot,
} from "./imageTaskPreviewRuntimePayload";

export interface ParsedImageTaskSnapshot {
  taskId: string;
  message: Message;
  task: ImageWorkbenchTask;
  outputs: ImageWorkbenchOutput[];
  terminal: boolean;
  updatedAt: number;
}

export function buildPreviewImageUrls(
  outputs: ImageWorkbenchOutput[],
): string[] {
  const urls: string[] = [];
  outputs.forEach((output) => {
    const normalized = output.url.trim();
    if (!normalized || urls.includes(normalized)) {
      return;
    }
    urls.push(normalized);
  });
  return urls.slice(0, 9);
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

export function normalizeTaskStatus(status?: string): string {
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

function resolveDisplayPromptFromImageTaskPayload(params: {
  payload?: Record<string, unknown> | null;
  fallbackPrompt: string;
}): string {
  const rawText = sanitizePreviewPrompt(
    readString([params.payload || null], ["raw_text", "rawText"]) || "",
  );
  const parsedRawText = rawText ? parseImageWorkbenchCommand(rawText) : null;
  const parsedPrompt = sanitizePreviewPrompt(parsedRawText?.prompt || "");

  return parsedPrompt || rawText || params.fallbackPrompt;
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

export function resolveTaskLabel(
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

export function resolveTaskLabelFromMode(
  mode: ImageWorkbenchTask["mode"],
): string {
  switch (mode) {
    case "edit":
      return "图片编辑任务";
    case "variation":
      return "图片重绘任务";
    case "generate":
    default:
      return "图片任务";
  }
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

function resolveOutputAwareNormalizedStatus(
  normalizedStatus: string,
  outputCount: number,
): string {
  if (
    outputCount === 0 &&
    (normalizedStatus === "succeeded" || normalizedStatus === "partial")
  ) {
    return "running";
  }

  return normalizedStatus;
}

export function resolvePreviewPhaseFromWorkbenchTaskStatus(
  status: ImageWorkbenchTask["status"],
): string {
  switch (status) {
    case "complete":
      return "succeeded";
    case "partial":
      return "partial";
    case "cancelled":
      return "cancelled";
    case "error":
      return "failed";
    case "queued":
      return "queued";
    case "routing":
    case "running":
    default:
      return "running";
  }
}

function resolveTaskProgressPhase(
  progressRecord: Record<string, unknown> | null,
  normalizedStatus: string,
  outputCount: number,
): string | null {
  if (
    outputCount === 0 &&
    (normalizedStatus === "succeeded" || normalizedStatus === "partial")
  ) {
    return "running";
  }

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
  slotId?: string | null;
  slotIndex?: number;
  slotLabel?: string | null;
  slotPrompt?: string | null;
  shotType?: string | null;
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
      slotId: null,
      slotLabel: null,
      slotPrompt: null,
      shotType: null,
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
  const slotId = readString([record], ["slot_id", "slotId"]);
  const slotIndex = readPositiveNumber([record], ["slot_index", "slotIndex"]);
  const slotLabel = readString([record], ["slot_label", "slotLabel", "label"]);
  const slotPrompt = readString([record], ["slot_prompt", "slotPrompt"]);
  const shotType = readString([record], ["shot_type", "shotType"]);

  if (url && !seenUrls.has(url)) {
    seenUrls.add(url);
    target.push({
      url,
      prompt: prompt || fallbackPrompt || undefined,
      providerName: providerName || fallbackProviderName,
      modelName: modelName || fallbackModelName,
      size: size || fallbackSize,
      slotId: slotId || null,
      slotIndex,
      slotLabel: slotLabel || null,
      slotPrompt: slotPrompt || null,
      shotType: shotType || null,
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

export function buildParsedImageTaskSnapshot(params: {
  taskRecord: Record<string, unknown>;
  taskId: string;
  taskType: string;
  projectId?: string | null;
  contentId?: string | null;
  taskFilePath?: string | null;
  artifactPath?: string | null;
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
  const resultRecord = asRecord(resultValue);
  const attemptResultRecord = asRecord(currentAttemptResult);
  const normalizedStatus = normalizeTaskStatus(
    typeof params.taskRecord.normalized_status === "string"
      ? params.taskRecord.normalized_status
      : typeof params.taskRecord.status === "string"
        ? params.taskRecord.status
        : undefined,
  );
  const runtimeContract = resolveImageRuntimeContractSnapshot({
    taskRecord: params.taskRecord,
    normalizedStatus,
  });
  const workflowRun = readImageCommandRunSnapshot([payload, params.taskRecord]);
  const runtimeTurnId =
    readString([payload, params.taskRecord], ["turn_id", "turnId"]) ||
    undefined;

  const prompt = sanitizePreviewPrompt(
    readString(
      [payload, params.taskRecord, uiHintsRecord],
      ["prompt", "summary", "title", "placeholder_text", "placeholderText"],
    ) || "",
  );
  const displayPrompt = resolveDisplayPromptFromImageTaskPayload({
    payload,
    fallbackPrompt: prompt,
  });
  const rawText =
    sanitizePreviewPrompt(
      readString([payload], ["raw_text", "rawText"]) || "",
    ) ||
    prompt ||
    displayPrompt;
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
  const payloadStoryboardSlots = readStoryboardSlotsFromUnknown(
    payload?.storyboard_slots,
  );
  const progressStoryboardSlots = readStoryboardSlotsFromUnknown(
    progressRecord?.preview_slots,
  );
  const expectedCount = Math.max(
    requestedCount || 1,
    payloadStoryboardSlots.length,
    progressStoryboardSlots.length,
  );
  const layoutHint =
    readString(
      [payload, uiHintsRecord, params.taskRecord],
      ["layout_hint", "layoutHint"],
    ) || null;
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
  outputSeeds.sort(
    (left, right) =>
      (left.slotIndex ?? Number.MAX_SAFE_INTEGER) -
      (right.slotIndex ?? Number.MAX_SAFE_INTEGER),
  );

  const applyTarget = resolveTaskRecordInlineApplyTarget({
    baseApplyTarget: resolveScopedImageWorkbenchApplyTarget({
      canvasState: params.canvasState,
      projectId: params.projectId ?? null,
      contentId: params.contentId ?? null,
      requestedTarget: resolveTaskRequestedTarget(params.taskType),
    }),
    taskRecord: params.taskRecord,
    projectId: params.projectId ?? null,
    contentId: params.contentId ?? null,
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
    id: `${params.taskId}:output:${output.slotIndex ?? index + 1}`,
    taskId: params.taskId,
    hookImageId: `${params.taskId}:hook:${output.slotIndex ?? index + 1}`,
    refId: `img-${params.taskId.slice(0, 6)}-${output.slotIndex ?? index + 1}`,
    url: output.url,
    prompt: output.prompt || prompt || `${taskLabel}结果`,
    slotId: output.slotId ?? null,
    slotIndex: output.slotIndex ?? index + 1,
    slotLabel: output.slotLabel ?? null,
    slotPrompt: output.slotPrompt ?? null,
    createdAt,
    providerName: output.providerName,
    modelName: output.modelName,
    size: output.size,
    parentOutputId: targetOutputId ?? null,
    applyTarget,
  }));
  const resolvedNormalizedStatus = resolveOutputAwareNormalizedStatus(
    normalizedStatus,
    outputs.length,
  );
  const storyboardSlots = mergeStoryboardSlots(
    payloadStoryboardSlots,
    progressStoryboardSlots,
    outputs
      .map((output, index) =>
        buildNormalizedStoryboardSlot({
          slotIndex: output.slotIndex ?? index + 1,
          slotId: output.slotId,
          label: output.slotLabel,
          prompt: output.slotPrompt || output.prompt,
          status: "complete",
        }),
      )
      .filter((item): item is ImageStoryboardSlot => Boolean(item)),
  );
  const successCount = outputs.length;
  const previewStatus = resolvePreviewStatus(resolvedNormalizedStatus);
  const attemptCount = Array.isArray(params.taskRecord.attempts)
    ? params.taskRecord.attempts.length
    : undefined;
  const taskFilePath = normalizeImageTaskPath(params.taskFilePath) ?? null;
  const artifactPath = normalizeImageTaskPath(params.artifactPath) ?? null;
  const previewProviderName =
    outputs[0]?.providerName ?? fallbackProviderName ?? null;
  const previewModelName =
    outputs[0]?.modelName ??
    fallbackModelName ??
    runtimeContract?.model ??
    null;
  const previewPrompt = displayPrompt || prompt || `${taskLabel}进行中`;
  const assistantIntro =
    readImageTaskPresentationText(
      [
        resultRecord,
        attemptResultRecord,
        payload,
        uiHintsRecord,
        params.taskRecord,
      ],
      previewPrompt,
    ) || "";
  const previewCaption =
    readImageTaskPresentationCaption(
      [
        resultRecord,
        attemptResultRecord,
        payload,
        uiHintsRecord,
        params.taskRecord,
      ],
      previewStatus,
      previewPrompt,
    ) ||
    buildImageWorkbenchCaption({
      prompt: previewPrompt,
      status: previewStatus,
      imageCount: successCount || undefined,
      statusMessage: lastError || null,
    });
  const preview: MessageImageWorkbenchPreview = {
    taskId: params.taskId,
    prompt: previewPrompt,
    mode: taskMode,
    status: previewStatus,
    projectId: params.projectId ?? null,
    contentId: params.contentId ?? null,
    taskFilePath,
    artifactPath,
    imageUrl: outputs[0]?.url ?? null,
    previewImages: buildPreviewImageUrls(outputs),
    imageCount:
      previewStatus === "running" ? expectedCount : successCount || undefined,
    expectedImageCount: expectedCount,
    providerName: previewProviderName,
    modelName: previewModelName,
    caption: previewCaption,
    layoutHint,
    storyboardSlots: storyboardSlots.length > 0 ? storyboardSlots : undefined,
    sourceImageUrl,
    sourceImagePrompt: sourceImagePrompt || null,
    sourceImageRef: targetOutputRefId ?? null,
    sourceImageCount,
    size: fallbackSize,
    phase: resolveTaskProgressPhase(
      progressRecord,
      normalizedStatus,
      outputs.length,
    ),
    statusMessage:
      readString([progressRecord], ["message"]) || lastError || null,
    retryable: readBoolean([lastErrorRecord], ["retryable"]),
    attemptCount,
    placeholderText:
      readString([uiHintsRecord], ["placeholder_text", "placeholderText"]) ||
      null,
    runtimeContract,
    workflowRun,

  };

  const messageTimestamp = new Date(createdAt);

  return {
    taskId: params.taskId,
    message: {
      id: resolveImageWorkbenchAssistantMessageId(params.taskId),
      role: "assistant",
      content: assistantIntro,
      timestamp: messageTimestamp,
      runtimeTurnId,
      imageWorkbenchPreview: preview,
    },
    task: {
      sessionId: params.taskId,
      id: params.taskId,
      mode: taskMode,
      status: resolveWorkbenchStatus(resolvedNormalizedStatus),
      prompt: previewPrompt,
      assistantIntro,
      caption: previewCaption,
      rawText,
      expectedCount,
      layoutHint,
      storyboardSlots: storyboardSlots.length > 0 ? storyboardSlots : undefined,
      outputIds: outputs.map((output) => output.id),
      targetOutputId: targetOutputId ?? null,
      targetOutputRefId: targetOutputRefId ?? null,
      sourceImageUrl,
      sourceImagePrompt: sourceImagePrompt || null,
      sourceImageRef: targetOutputRefId ?? null,
      sourceImageCount,
      createdAt,
      failureMessage: lastError,
      runtimeContract,
      workflowRun,

      hookImageIds: outputs.map((output) => output.hookImageId),
      applyTarget,
      taskFilePath,
      artifactPath,
    },
    outputs,
    terminal:
      resolvedNormalizedStatus === "succeeded" ||
      resolvedNormalizedStatus === "failed" ||
      resolvedNormalizedStatus === "cancelled",
    updatedAt: createdAt,
  };
}

export function buildPendingImageTaskSnapshot(params: {
  taskId: string;
  taskType: string;
  status?: string;
  payload?: Record<string, unknown>;
  progressMessage?: string;
  projectId?: string | null;
  contentId?: string | null;
  taskFilePath?: string | null;
  artifactPath?: string | null;
  canvasState: CanvasStateUnion | null;
}): ParsedImageTaskSnapshot {
  const taskMode = resolveTaskMode(params.taskType, {
    payload: params.payload || {},
  });
  const storyboardSlots = readStoryboardSlotsFromUnknown(
    params.payload?.storyboard_slots,
  );
  const expectedCount = Math.max(
    readPositiveNumber([params.payload || null], ["count", "image_count"]) || 1,
    storyboardSlots.length,
  );
  const layoutHint =
    readString([params.payload || null], ["layout_hint", "layoutHint"]) || null;
  const taskLabel = resolveTaskLabel(params.taskType, taskMode);
  const startedAt = new Date();
  const previewPrompt =
    resolveDisplayPromptFromImageTaskPayload({
      payload: params.payload,
      fallbackPrompt:
        readString([params.payload || null], ["prompt", "summary", "title"]) ||
        "",
    }) || `${taskLabel}进行中`;
  const rawText =
    sanitizePreviewPrompt(
      readString([params.payload || null], ["raw_text", "rawText"]) || "",
    ) || previewPrompt;
  const previewModelName =
    readString(
      [params.payload || null],
      ["model", "modelName", "model_name"],
    ) || null;
  const workflowRun = readImageCommandRunSnapshot([params.payload || null]);
  const runtimeTurnId =
    readString([params.payload || null], ["turn_id", "turnId"]) || undefined;

  const fallbackAssistantIntro =
    readImageTaskPresentationText([params.payload || null], previewPrompt) ||
    "";
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
          message: params.progressMessage || "正在生成图片。",
        },
        created_at: new Date().toISOString(),
      },
      taskId: params.taskId,
      taskType: params.taskType,
      projectId: params.projectId ?? null,
      contentId: params.contentId ?? null,
      taskFilePath: params.taskFilePath ?? null,
      artifactPath: params.artifactPath ?? null,
      canvasState: params.canvasState,
    }) || {
      taskId: params.taskId,
      message: {
        id: resolveImageWorkbenchAssistantMessageId(params.taskId),
        role: "assistant",
        content: fallbackAssistantIntro,
        timestamp: startedAt,
        isThinking: false,
        runtimeTurnId,
        imageWorkbenchPreview: {
          taskId: params.taskId,
          prompt: previewPrompt,
          mode: taskMode,
          status: "running",
          expectedImageCount: expectedCount,
          providerName:
            readString(
              [params.payload || null],
              ["provider", "providerName", "provider_name", "provider_id"],
            ) || null,
          modelName: previewModelName,
          caption: null,
          projectId: params.projectId ?? null,
          contentId: params.contentId ?? null,
          taskFilePath: normalizeImageTaskPath(params.taskFilePath) ?? null,
          artifactPath: normalizeImageTaskPath(params.artifactPath) ?? null,
          imageCount: expectedCount,
          layoutHint,
          storyboardSlots:
            storyboardSlots.length > 0 ? storyboardSlots : undefined,
          phase: resolvePendingProgressPhase(params.status),
          statusMessage: params.progressMessage || "正在生成图片。",
          workflowRun,

        },
      },
      task: {
        sessionId: params.taskId,
        id: params.taskId,
        mode: taskMode,
        status: "queued",
        prompt: previewPrompt,
        assistantIntro: fallbackAssistantIntro,
        caption: null,
        rawText,
        expectedCount,
        layoutHint,
        storyboardSlots:
          storyboardSlots.length > 0 ? storyboardSlots : undefined,
        outputIds: [],
        targetOutputId: null,
        createdAt: Date.now(),
        workflowRun,

        hookImageIds: [],
        applyTarget: resolveScopedImageWorkbenchApplyTarget({
          canvasState: params.canvasState,
          projectId: params.projectId ?? null,
          contentId: params.contentId ?? null,
          requestedTarget: resolveTaskRequestedTarget(params.taskType),
        }),
        taskFilePath: normalizeImageTaskPath(params.taskFilePath) ?? null,
        artifactPath: normalizeImageTaskPath(params.artifactPath) ?? null,
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
  const record = asRecord(params.artifact.record);

  if (record) {
    return (
      buildParsedImageTaskSnapshot({
        taskRecord: record,
        taskId: params.artifact.task_id,
        taskType: params.artifact.task_type,
        projectId: params.projectId ?? null,
        contentId: params.contentId ?? null,
        taskFilePath: params.artifact.absolute_path,
        artifactPath: params.artifact.artifact_path,
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
    taskFilePath: params.artifact.absolute_path,
    artifactPath: params.artifact.artifact_path,
    canvasState: params.canvasState,
  });
}
