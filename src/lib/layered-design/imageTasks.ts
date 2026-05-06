import type {
  CreateImageGenerationTaskArtifactRequest,
  MediaTaskArtifactOutput,
  MediaTaskLookupRequest,
} from "@/lib/api/mediaTasks";
import {
  createImageGenerationTaskArtifact,
  getMediaTaskArtifact,
} from "@/lib/api/mediaTasks";
import { applyLayeredDesignGeneratedAsset } from "./generation";
import type {
  GeneratedDesignAsset,
  LayerEditRecord,
  LayeredDesignDocument,
  LayeredDesignDocumentInput,
} from "./types";
import {
  isImageDesignLayer,
  normalizeLayeredDesignDocument,
} from "./document";
import {
  createSingleLayerAssetGenerationRequest,
  type LayeredDesignAssetGenerationRequest,
} from "./generation";
import {
  createLayeredDesignImageRuntimeContract,
  normalizeLayeredDesignImageTaskSize,
  resolveLayeredDesignAlphaPolicy,
  type LayeredDesignAlphaPolicy,
  type LayeredDesignImageTaskSize,
} from "./imageModelCapabilities";

export interface LayeredDesignImageTaskContext {
  projectRootPath: string;
  providerId?: string;
  model?: string;
  sessionId?: string;
  threadId?: string;
  turnId?: string;
  projectId?: string;
  contentId?: string;
  style?: string;
  usage?: string;
  referenceImages?: string[];
}

export interface CreateLayeredDesignImageTaskArtifactsParams
  extends LayeredDesignImageTaskContext {
  document: LayeredDesignDocumentInput | LayeredDesignDocument;
  requests: LayeredDesignAssetGenerationRequest[];
  createTaskArtifact?: (
    request: CreateImageGenerationTaskArtifactRequest,
  ) => Promise<MediaTaskArtifactOutput>;
}

export interface LayeredDesignImageTaskSubmission {
  generationRequest: LayeredDesignAssetGenerationRequest;
  taskRequest: CreateImageGenerationTaskArtifactRequest;
  output: MediaTaskArtifactOutput;
}

export interface CreateGeneratedDesignAssetFromTaskOutputOptions {
  assetId?: string;
  createdAt?: string;
}

export interface RecordLayeredDesignImageTaskSubmissionsOptions {
  recordedAt?: string;
}

export interface PendingLayeredDesignImageTask {
  recordId: string;
  layerId: string;
  assetId: string;
  taskId: string;
  taskPath?: string;
  taskStatus?: string;
  taskRef: string;
  generationRequest: LayeredDesignAssetGenerationRequest;
}

export interface RefreshLayeredDesignImageTaskResult {
  task: PendingLayeredDesignImageTask;
  status: string;
  applied: boolean;
  output?: MediaTaskArtifactOutput;
  error?: string;
}

export interface RefreshLayeredDesignImageTaskResultsParams {
  document: LayeredDesignDocumentInput | LayeredDesignDocument;
  projectRootPath: string;
  getTaskArtifact?: (
    request: MediaTaskLookupRequest,
  ) => Promise<MediaTaskArtifactOutput>;
}

export interface RefreshLayeredDesignImageTaskResultsOutput {
  document: LayeredDesignDocument;
  tasks: PendingLayeredDesignImageTask[];
  results: RefreshLayeredDesignImageTaskResult[];
  refreshedCount: number;
  appliedCount: number;
  pendingCount: number;
  failedCount: number;
  skippedCount: number;
}

function gcd(left: number, right: number): number {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));

  while (b > 0) {
    const next = a % b;
    a = b;
    b = next;
  }

  return a || 1;
}

function createAspectRatio(width: number, height: number): string {
  const divisor = gcd(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function createLayeredDesignLayoutHint(
  document: LayeredDesignDocument,
  request: LayeredDesignAssetGenerationRequest,
  taskSize: LayeredDesignImageTaskSize,
  alphaPolicy: LayeredDesignAlphaPolicy,
): string {
  return [
    "layered-design",
    `document=${document.id}`,
    `layer=${request.layerId}`,
    `asset=${request.assetId}`,
    `kind=${request.kind}`,
    `alpha=${request.hasAlpha ? "required" : "none"}`,
    `alphaStrategy=${alphaPolicy.strategy}`,
    `requestedSize=${request.width}x${request.height}`,
    `taskSize=${taskSize.size}`,
  ].join("; ");
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readFirstImageRecord(
  output: MediaTaskArtifactOutput,
): Record<string, unknown> | undefined {
  const result = readRecord(output.record.result);
  const images = Array.isArray(result?.images) ? result.images : [];
  return readRecord(images[0]);
}

function readTaskPayloadString(
  output: MediaTaskArtifactOutput,
  key: string,
): string | undefined {
  return readString(output.record.payload[key]);
}

function readOptionalTaskRef(record: LayerEditRecord): string | undefined {
  return readString(record.taskPath) ?? readString(record.taskId);
}

function readOutputStatus(output: MediaTaskArtifactOutput): string {
  return (
    readString(output.normalized_status) ??
    readString(output.record.normalized_status) ??
    readString(output.status) ??
    "unknown"
  );
}

function isSucceededTaskStatus(status: string): boolean {
  return status === "succeeded" || status === "success" || status === "done";
}

function isFailedTaskStatus(status: string): boolean {
  return [
    "failed",
    "error",
    "blocked",
    "cancelled",
    "canceled",
    "timeout",
  ].includes(status);
}

function createPendingTaskFromRecord(
  document: LayeredDesignDocument,
  record: LayerEditRecord,
): PendingLayeredDesignImageTask | null {
  const layerId = readString(record.layerId);
  const assetId = readString(record.nextAssetId);
  const taskId = readString(record.taskId);
  const taskRef = readOptionalTaskRef(record);

  if (!layerId || !assetId || !taskId || !taskRef) {
    return null;
  }

  const layer = document.layers.find((item) => item.id === layerId);
  if (!isImageDesignLayer(layer) || layer.assetId !== assetId) {
    return null;
  }

  const taskPath = readString(record.taskPath);
  const taskStatus = readString(record.taskStatus);

  return {
    recordId: record.id,
    layerId,
    assetId,
    taskId,
    ...(taskPath ? { taskPath } : {}),
    ...(taskStatus ? { taskStatus } : {}),
    taskRef,
    generationRequest: createSingleLayerAssetGenerationRequest(
      document,
      layerId,
    ),
  };
}

export function createLayeredDesignImageTaskRequest(
  documentInput: LayeredDesignDocumentInput | LayeredDesignDocument,
  generationRequest: LayeredDesignAssetGenerationRequest,
  context: LayeredDesignImageTaskContext,
): CreateImageGenerationTaskArtifactRequest {
  const document = normalizeLayeredDesignDocument(documentInput);
  if (generationRequest.documentId !== document.id) {
    throw new Error(
      `生成请求不属于当前图层文档：${generationRequest.documentId}`,
    );
  }

  const layer = document.layers.find(
    (item) => item.id === generationRequest.layerId,
  );
  if (!layer) {
    throw new Error(`未找到图层：${generationRequest.layerId}`);
  }

  const taskSize = normalizeLayeredDesignImageTaskSize({
    width: generationRequest.width,
    height: generationRequest.height,
    model: context.model,
    providerId: context.providerId,
  });
  const alphaPolicy = resolveLayeredDesignAlphaPolicy({
    hasAlpha: generationRequest.hasAlpha,
    model: context.model,
    providerId: context.providerId,
  });

  return {
    projectRootPath: context.projectRootPath,
    prompt: generationRequest.prompt,
    title: `${document.title} · ${layer.name}`,
    mode: "generate",
    rawText: document.title,
    layoutHint: createLayeredDesignLayoutHint(
      document,
      generationRequest,
      taskSize,
      alphaPolicy,
    ),
    size: taskSize.size,
    aspectRatio: createAspectRatio(taskSize.width, taskSize.height),
    count: 1,
    usage: context.usage ?? "layered_design_asset",
    style: context.style,
    providerId: context.providerId,
    model: context.model,
    sessionId: context.sessionId,
    threadId: context.threadId,
    turnId: context.turnId,
    projectId: context.projectId,
    contentId: context.contentId ?? document.id,
    entrySource: "layered_design_canvas",
    modalityContractKey: "image_generation",
    modality: "image",
    requiredCapabilities: ["image_generation"],
    routingSlot: "image_generation_model",
    runtimeContract: createLayeredDesignImageRuntimeContract({
      documentId: document.id,
      request: generationRequest,
      model: context.model,
      providerId: context.providerId,
      taskSize,
    }),
    requestedTarget: "generate",
    slotId: generationRequest.layerId,
    anchorHint: `layered-design:${document.id}:${generationRequest.layerId}`,
    anchorSectionTitle: layer.name,
    anchorText: document.title,
    targetOutputId: generationRequest.assetId,
    targetOutputRefId: generationRequest.id,
    referenceImages: context.referenceImages,
  };
}

export async function createLayeredDesignImageTaskArtifacts({
  document,
  requests,
  createTaskArtifact = createImageGenerationTaskArtifact,
  ...context
}: CreateLayeredDesignImageTaskArtifactsParams): Promise<
  LayeredDesignImageTaskSubmission[]
> {
  const submissions: LayeredDesignImageTaskSubmission[] = [];

  for (const generationRequest of requests) {
    const taskRequest = createLayeredDesignImageTaskRequest(
      document,
      generationRequest,
      context,
    );
    const output = await createTaskArtifact(taskRequest);
    submissions.push({ generationRequest, taskRequest, output });
  }

  return submissions;
}

export function createGeneratedDesignAssetFromImageTaskOutput(
  request: LayeredDesignAssetGenerationRequest,
  output: MediaTaskArtifactOutput,
  options: CreateGeneratedDesignAssetFromTaskOutputOptions = {},
): GeneratedDesignAsset | null {
  const firstImage = readFirstImageRecord(output);
  const imageUrl = readString(firstImage?.url);
  const b64Json = readString(firstImage?.b64_json);
  const src = imageUrl || (b64Json ? `data:image/png;base64,${b64Json}` : "");

  if (!src) {
    return null;
  }

  const postprocess = readRecord(firstImage?.postprocess);

  return {
    id: options.assetId ?? `${request.assetId}-generated-${output.task_id}`,
    kind: request.kind,
    src,
    width: request.width,
    height: request.height,
    hasAlpha: request.hasAlpha,
    provider: readTaskPayloadString(output, "provider_id"),
    modelId: readTaskPayloadString(output, "model"),
    prompt: readString(firstImage?.revised_prompt) ?? request.prompt,
    params: {
      source: "image_generation_task",
      taskId: output.task_id,
      taskPath: output.path,
      documentId: request.documentId,
      layerId: request.layerId,
      originalAssetId: request.assetId,
      ...(postprocess ? { postprocess } : {}),
    },
    createdAt:
      options.createdAt ??
      output.record.updated_at ??
      output.record.created_at ??
      new Date().toISOString(),
  };
}

export function applyLayeredDesignImageTaskOutput(
  document: LayeredDesignDocument,
  request: LayeredDesignAssetGenerationRequest,
  output: MediaTaskArtifactOutput,
): LayeredDesignDocument | null {
  const asset = createGeneratedDesignAssetFromImageTaskOutput(request, output);
  if (!asset) {
    return null;
  }

  return applyLayeredDesignGeneratedAsset(document, {
    layerId: request.layerId,
    asset,
    summary: `图片任务 ${output.task_id} 已生成图层资产`,
  });
}

export function recordLayeredDesignImageTaskSubmissions(
  document: LayeredDesignDocument,
  submissions: LayeredDesignImageTaskSubmission[],
  options: RecordLayeredDesignImageTaskSubmissionsOptions = {},
): LayeredDesignDocument {
  if (submissions.length === 0) {
    return document;
  }

  const recordedAt = options.recordedAt ?? new Date().toISOString();
  const records: LayerEditRecord[] = submissions.map((submission, index) => ({
    id: `asset-generation-requested-${document.editHistory.length + index + 1}`,
    type: "asset_generation_requested",
    layerId: submission.generationRequest.layerId,
    actor: "assistant",
    nextAssetId: submission.generationRequest.assetId,
    taskId: submission.output.task_id,
    taskPath: submission.output.path,
    taskStatus: readOutputStatus(submission.output),
    summary: `已提交图片任务 ${submission.output.task_id}，等待写回图层资产。`,
    createdAt: recordedAt,
  }));

  return {
    ...document,
    editHistory: [...document.editHistory, ...records],
    updatedAt: recordedAt,
  };
}

export function listPendingLayeredDesignImageTasks(
  documentInput: LayeredDesignDocumentInput | LayeredDesignDocument,
): PendingLayeredDesignImageTask[] {
  const document = normalizeLayeredDesignDocument(documentInput);
  const closedLayerIds = new Set<string>();
  const pendingTasks: PendingLayeredDesignImageTask[] = [];

  for (let index = document.editHistory.length - 1; index >= 0; index -= 1) {
    const record = document.editHistory[index];
    const layerId = readString(record.layerId);
    if (!layerId) {
      continue;
    }

    if (record.type === "asset_replaced") {
      closedLayerIds.add(layerId);
      continue;
    }

    if (record.type !== "asset_generation_requested") {
      continue;
    }

    if (closedLayerIds.has(layerId)) {
      continue;
    }

    closedLayerIds.add(layerId);
    const pendingTask = createPendingTaskFromRecord(document, record);
    if (pendingTask) {
      pendingTasks.push(pendingTask);
    }
  }

  return pendingTasks.reverse();
}

export async function refreshLayeredDesignImageTaskResults({
  document: documentInput,
  projectRootPath,
  getTaskArtifact = getMediaTaskArtifact,
}: RefreshLayeredDesignImageTaskResultsParams): Promise<RefreshLayeredDesignImageTaskResultsOutput> {
  let nextDocument = normalizeLayeredDesignDocument(documentInput);
  const tasks = listPendingLayeredDesignImageTasks(nextDocument);
  const results: RefreshLayeredDesignImageTaskResult[] = [];
  let appliedCount = 0;
  let pendingCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const task of tasks) {
    try {
      const output = await getTaskArtifact({
        projectRootPath,
        taskRef: task.taskRef,
      });
      const status = readOutputStatus(output);
      let applied = false;

      if (isSucceededTaskStatus(status)) {
        const appliedDocument = applyLayeredDesignImageTaskOutput(
          nextDocument,
          task.generationRequest,
          output,
        );
        if (appliedDocument) {
          nextDocument = appliedDocument;
          applied = true;
          appliedCount += 1;
        } else {
          skippedCount += 1;
        }
      } else if (isFailedTaskStatus(status)) {
        failedCount += 1;
      } else {
        pendingCount += 1;
      }

      results.push({
        task,
        status,
        applied,
        output,
      });
    } catch (error) {
      failedCount += 1;
      results.push({
        task,
        status: "lookup_failed",
        applied: false,
        error:
          error instanceof Error ? error.message : "刷新图片任务结果失败。",
      });
    }
  }

  return {
    document: nextDocument,
    tasks,
    results,
    refreshedCount: results.length,
    appliedCount,
    pendingCount,
    failedCount,
    skippedCount,
  };
}
