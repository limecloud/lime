import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import {
  getMediaTaskArtifact,
  listMediaTaskArtifacts,
  type ListMediaTaskArtifactsOutput,
  type MediaTaskModalityRuntimeContractIndexEntry,
  type MediaTaskArtifactOutput,
  type MediaTaskLookupRequest,
} from "@/lib/api/mediaTasks";
import { readFilePreview } from "@/lib/api/fileBrowser";
import { resolveArtifactProtocolFilePath } from "@/lib/artifact-protocol";
import { safeListen } from "@/lib/dev-bridge";
import type { Message, MessageGenericTaskPreview } from "../types";
import {
  buildArtifactFromWrite,
  upsertMessageArtifact,
} from "../utils/messageArtifacts";
import { buildTranscriptionTaskArtifactDocument } from "../utils/taskPreviewFromToolResult";
import {
  extractTranscriptSegmentsFromRecords,
  normalizeTranscriptSegments,
  parseTranscriptContent,
} from "../utils/transcriptSegments";
import { buildImageTaskLookupRequest } from "./imageTaskLocator";
import { doesWorkspaceFileCandidateMatch } from "./workspaceFilePathMatch";
import { resolveAbsoluteWorkspacePath } from "./workspacePath";

const TRANSCRIPTION_TASK_EVENT_NAME = "lime://creation_task_submitted";
const TRANSCRIPTION_TASK_POLL_INTERVAL_MS = 3000;
const TRANSCRIPTION_TASK_INDEX_RESTORE_LIMIT = 24;
const TRANSCRIPTION_TEXT_PREVIEW_MAX_SIZE = 256 * 1024;
const AUDIO_TRANSCRIPTION_CONTRACT_KEY = "audio_transcription";

interface LoadedTranscriptPreview {
  text: string | null;
  segments: MessageGenericTaskPreview["transcriptSegments"];
}

interface UseWorkspaceTranscriptionTaskPreviewRuntimeParams {
  projectRootPath?: string | null;
  messages: Message[];
  setChatMessages: Dispatch<SetStateAction<Message[]>>;
}

interface CreationTaskSubmittedPayload {
  task_id?: string;
  task_type?: string;
  task_family?: string;
  status?: string;
  path?: string;
  absolute_path?: string;
}

interface TrackedTranscriptionTask {
  taskId: string;
  taskFilePath?: string | null;
  artifactPath?: string | null;
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
): string | null {
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
  return null;
}

function readBoolean(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): boolean | null {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === "boolean") {
        return value;
      }
    }
  }
  return null;
}

function normalizePreviewStatus(status: string | undefined | null) {
  switch ((status || "").trim().toLowerCase()) {
    case "succeeded":
    case "completed":
    case "success":
      return "complete" as const;
    case "partial":
      return "partial" as const;
    case "failed":
    case "error":
      return "failed" as const;
    case "cancelled":
    case "canceled":
      return "cancelled" as const;
    case "running":
    case "processing":
    case "queued":
    case "pending":
    case "pending_submit":
    default:
      return "running" as const;
  }
}

function resolveTranscriptionFailureStatusMessage(
  errorCode?: string | null,
  errorMessage?: string | null,
): string {
  switch ((errorCode || "").trim()) {
    case "transcription_provider_unconfigured":
      return "转写 Provider 未配置，请先在转写设置中选择可用 Provider；任务保留在 transcription_generate，不会回退 frontend ASR。";
    case "transcription_provider_model_unconfigured":
      return "转写模型未配置，请先为 audio_transcription 设置默认模型；任务保留在 transcription_generate，不会回退 generic_file transcript。";
    case "transcription_provider_resolver_unavailable":
      return "当前无法解析 API Key Provider 凭证，转写任务已显式失败，没有伪造 transcript_path。";
    case "transcription_provider_resolution_failed":
      return "解析转写 Provider 凭证失败，请检查 API Key Provider 配置后重试。";
    case "transcription_provider_client_missing":
      return "当前 Provider 还没有 OpenAI-compatible ASR adapter，转写任务不会回退前端直连 ASR。";
    case "transcription_provider_request_failed":
      return "调用转写 Provider 失败，请检查额度、网络或模型配置后重试。";
    case "transcription_provider_response_read_failed":
      return "读取转写 Provider 响应失败，请稍后重试或检查 Provider 网关。";
    case "transcription_provider_empty_response":
      return "转写 Provider 返回了空 transcript，已阻止写入空转写结果。";
    case "transcription_source_unavailable":
      return "音频来源文件不可读，请检查 source_path 是否仍在工作区内。";
    case "transcription_source_download_failed":
      return "下载音频来源失败，请检查 source_url、网络或访问权限后重试。";
    case "transcription_source_empty":
      return "音频来源为空，已阻止调用转写 Provider。";
    case "transcription_source_mime_invalid":
      return "音频来源 MIME 类型不可用于转写，请换用支持的音频或视频文件。";
    case "transcript_output_write_failed":
      return "转写结果已返回但写入工作区失败，请检查项目目录权限后重试。";
    case "invalid_transcription_task_payload":
      return "转写任务缺少 source_path/source_url，已阻止调用转写 Provider。";
    case "audio_transcription_task_type_mismatch":
    case "audio_transcription_contract_mismatch":
    case "audio_transcription_capability_gap":
    case "audio_transcription_routing_slot_mismatch":
      return "转写任务运行合同不匹配，已阻止执行器误跑到非 audio_transcription 主链。";
    default:
      return (
        errorMessage?.trim() ||
        "转写失败，请检查音频来源、模型或 Provider 配置后重试。"
      );
  }
}

function resolveStatusMessage(preview: MessageGenericTaskPreview): string {
  if (preview.status === "complete" || preview.status === "partial") {
    return preview.transcriptText?.trim()
      ? "转写结果已同步，工作区已载入 transcript 文本，可直接复制校对。"
      : preview.transcriptPath?.trim()
        ? "转写结果已同步，工作区已从 transcript 读取可校对文本。"
        : "转写任务已完成，正在等待 transcript 输出路径。";
  }
  if (preview.status === "failed") {
    return resolveTranscriptionFailureStatusMessage(
      preview.errorCode,
      preview.errorMessage,
    );
  }
  if (preview.status === "cancelled") {
    return "转写任务已经取消，当前不会继续生成 transcript。";
  }
  return "转写任务已写入统一 transcription_generate/transcript 协议，工作区会继续同步结果。";
}

function shouldLoadTranscriptText(preview: MessageGenericTaskPreview): boolean {
  if (preview.kind !== "transcription_generate") {
    return false;
  }
  if (preview.status !== "complete" && preview.status !== "partial") {
    return false;
  }
  return (
    Boolean(preview.transcriptPath?.trim()) && !preview.transcriptText?.trim()
  );
}

async function loadTranscriptText(params: {
  projectRootPath?: string | null;
  transcriptPath?: string | null;
}): Promise<LoadedTranscriptPreview> {
  const absolutePath = resolveAbsoluteWorkspacePath(
    params.projectRootPath,
    params.transcriptPath,
  );
  if (!absolutePath) {
    return { text: null, segments: [] };
  }
  try {
    const preview = await readFilePreview(
      absolutePath,
      TRANSCRIPTION_TEXT_PREVIEW_MAX_SIZE,
    );
    if (
      preview.error ||
      preview.isBinary ||
      typeof preview.content !== "string"
    ) {
      return { text: null, segments: [] };
    }
    return parseTranscriptContent(preview.content);
  } catch (error) {
    console.warn(
      "[TranscriptionTaskPreviewRuntime] 读取 transcript 文本失败:",
      error,
    );
    return { text: null, segments: [] };
  }
}

async function loadTranscriptTextsFromIndex(params: {
  projectRootPath?: string | null;
  snapshotsByTaskId: Map<string, MediaTaskModalityRuntimeContractIndexEntry>;
}): Promise<Map<string, LoadedTranscriptPreview>> {
  const loaded = new Map<string, LoadedTranscriptPreview>();
  await Promise.all(
    Array.from(params.snapshotsByTaskId.values()).map(async (snapshot) => {
      const status = normalizePreviewStatus(
        snapshot.transcript_status || snapshot.normalized_status,
      );
      if (status !== "complete" && status !== "partial") {
        return;
      }
      const transcriptPreview = await loadTranscriptText({
        projectRootPath: params.projectRootPath,
        transcriptPath: snapshot.transcript_path,
      });
      if (
        transcriptPreview.text ||
        (transcriptPreview.segments && transcriptPreview.segments.length > 0)
      ) {
        loaded.set(snapshot.task_id, transcriptPreview);
      }
    }),
  );
  return loaded;
}

function resolveTranscriptPathFromArtifact(
  artifact: MediaTaskArtifactOutput,
): string | null {
  const payload = asRecord(artifact.record?.payload);
  const result = asRecord(artifact.record?.result);
  const transcript =
    asRecord(payload?.transcript) || asRecord(result?.transcript);
  return readString(
    [transcript, result, payload],
    ["transcript_path", "transcriptPath", "path"],
  );
}

function buildTranscriptionPreviewFromArtifact(
  artifact: MediaTaskArtifactOutput,
  currentPreview: MessageGenericTaskPreview,
  loadedTranscript?: LoadedTranscriptPreview | null,
): MessageGenericTaskPreview | null {
  if (artifact.task_type !== "transcription_generate") {
    return null;
  }

  const payload = asRecord(artifact.record?.payload);
  const result = asRecord(artifact.record?.result);
  const lastError = asRecord(artifact.record?.last_error);
  const progress = asRecord(artifact.record?.progress);
  const transcript =
    asRecord(payload?.transcript) || asRecord(result?.transcript);
  const candidates = [transcript, result, payload];
  const errorCandidates = [transcript, lastError, progress, result, payload];
  const sourcePath =
    readString(candidates, ["source_path", "sourcePath"]) ||
    currentPreview.sourcePath ||
    null;
  const sourceUrl =
    readString(candidates, ["source_url", "sourceUrl"]) ||
    currentPreview.sourceUrl ||
    null;
  const transcriptStatus = readString([transcript], ["status"]);
  const nextStatus = normalizePreviewStatus(
    transcriptStatus ||
      artifact.normalized_status ||
      artifact.status ||
      artifact.record?.status,
  );
  const indexedTranscriptPath = readString(candidates, [
    "transcript_path",
    "transcriptPath",
    "path",
  ]);
  const transcriptPath =
    nextStatus === "failed"
      ? indexedTranscriptPath
      : indexedTranscriptPath || currentPreview.transcriptPath || null;
  const errorCode =
    nextStatus === "failed"
      ? readString(errorCandidates, [
          "error_code",
          "errorCode",
          "failure_code",
          "failureCode",
          "code",
        ]) ||
        currentPreview.errorCode ||
        null
      : null;
  const errorMessage =
    nextStatus === "failed"
      ? readString(errorCandidates, [
          "error_message",
          "errorMessage",
          "message",
          "detail",
        ]) ||
        currentPreview.errorMessage ||
        null
      : null;
  const retryable =
    nextStatus === "failed"
      ? (readBoolean(errorCandidates, ["retryable"]) ??
        currentPreview.retryable)
      : currentPreview.retryable;
  const payloadSegments = normalizeTranscriptSegments([
    ...extractTranscriptSegmentsFromRecords(candidates),
    ...extractTranscriptSegmentsFromRecords(errorCandidates),
  ]);
  const nextSegments =
    nextStatus === "failed"
      ? []
      : loadedTranscript?.segments && loadedTranscript.segments.length > 0
        ? loadedTranscript.segments
        : payloadSegments.length > 0
          ? payloadSegments
          : currentPreview.transcriptSegments || [];
  const prompt =
    currentPreview.prompt || sourcePath || sourceUrl || "内容转写任务";
  const nextPreview: MessageGenericTaskPreview = {
    ...currentPreview,
    kind: "transcription_generate",
    taskType: "transcription_generate",
    taskId: artifact.task_id || currentPreview.taskId,
    prompt,
    status: nextStatus,
    projectId:
      readString(candidates, ["project_id", "projectId"]) ??
      currentPreview.projectId ??
      null,
    contentId:
      readString(candidates, ["content_id", "contentId"]) ??
      currentPreview.contentId ??
      null,
    taskFilePath:
      currentPreview.taskFilePath ||
      artifact.artifact_path ||
      artifact.path ||
      null,
    providerId:
      readString(candidates, ["provider_id", "providerId", "provider"]) ??
      currentPreview.providerId ??
      null,
    model: readString(candidates, ["model"]) ?? currentPreview.model ?? null,
    phase: readString([progress], ["phase"]) ?? currentPreview.phase ?? null,
    transcriptPath,
    sourcePath,
    sourceUrl,
    language:
      readString(candidates, [
        "language",
        "target_language",
        "targetLanguage",
      ]) ??
      currentPreview.language ??
      null,
    outputFormat:
      readString(candidates, ["output_format", "outputFormat", "format"]) ??
      currentPreview.outputFormat ??
      null,
    transcriptText:
      nextStatus === "failed"
        ? null
        : loadedTranscript?.text || currentPreview.transcriptText || null,
    transcriptSegments: nextSegments,
    errorCode,
    errorMessage,
    retryable,
  };
  return {
    ...nextPreview,
    statusMessage: resolveStatusMessage(nextPreview),
  };
}

function hasUsableTranscriptIndex(
  entry: MediaTaskModalityRuntimeContractIndexEntry,
): boolean {
  if (entry.task_type !== "transcription_generate") {
    return false;
  }
  return Boolean(entry.transcript_status);
}

function buildTranscriptionPreviewFromIndexEntry(
  entry: MediaTaskModalityRuntimeContractIndexEntry,
  currentPreview: MessageGenericTaskPreview,
  loadedTranscript?: LoadedTranscriptPreview | null,
): MessageGenericTaskPreview | null {
  if (!hasUsableTranscriptIndex(entry)) {
    return null;
  }

  const nextStatus = normalizePreviewStatus(
    entry.transcript_status || entry.normalized_status,
  );
  const indexedTranscriptPath = entry.transcript_path?.trim() || null;
  const transcriptPath =
    nextStatus === "failed"
      ? indexedTranscriptPath
      : indexedTranscriptPath || currentPreview.transcriptPath || null;
  const errorCode =
    nextStatus === "failed"
      ? entry.transcript_error_code?.trim() || currentPreview.errorCode || null
      : null;
  const errorMessage =
    nextStatus === "failed" && errorCode === currentPreview.errorCode
      ? currentPreview.errorMessage || null
      : null;
  const retryable =
    nextStatus === "failed"
      ? (entry.transcript_retryable ?? currentPreview.retryable)
      : currentPreview.retryable;
  const nextSegments =
    nextStatus === "failed"
      ? []
      : loadedTranscript?.segments && loadedTranscript.segments.length > 0
        ? loadedTranscript.segments
        : currentPreview.transcriptSegments || [];
  const nextPreview: MessageGenericTaskPreview = {
    ...currentPreview,
    kind: "transcription_generate",
    taskType: "transcription_generate",
    taskId: entry.task_id || currentPreview.taskId,
    status: nextStatus,
    providerId: entry.provider_id?.trim() || currentPreview.providerId || null,
    model: entry.model?.trim() || currentPreview.model || null,
    transcriptPath,
    sourcePath:
      entry.transcript_source_path?.trim() || currentPreview.sourcePath || null,
    sourceUrl:
      entry.transcript_source_url?.trim() || currentPreview.sourceUrl || null,
    language:
      entry.transcript_language?.trim() || currentPreview.language || null,
    outputFormat:
      entry.transcript_output_format?.trim() ||
      currentPreview.outputFormat ||
      null,
    transcriptText:
      nextStatus === "failed"
        ? null
        : loadedTranscript?.text || currentPreview.transcriptText || null,
    transcriptSegments: nextSegments,
    errorCode,
    errorMessage,
    retryable,
  };
  return {
    ...nextPreview,
    statusMessage: resolveStatusMessage(nextPreview),
  };
}

function areTranscriptionPreviewsEqual(
  left: MessageGenericTaskPreview,
  right: MessageGenericTaskPreview,
): boolean {
  const leftSegments = left.transcriptSegments || [];
  const rightSegments = right.transcriptSegments || [];
  return (
    left.status === right.status &&
    left.transcriptPath === right.transcriptPath &&
    left.sourcePath === right.sourcePath &&
    left.sourceUrl === right.sourceUrl &&
    left.language === right.language &&
    left.outputFormat === right.outputFormat &&
    left.transcriptText === right.transcriptText &&
    JSON.stringify(leftSegments) === JSON.stringify(rightSegments) &&
    left.providerId === right.providerId &&
    left.model === right.model &&
    left.phase === right.phase &&
    left.statusMessage === right.statusMessage &&
    left.errorCode === right.errorCode &&
    left.errorMessage === right.errorMessage &&
    left.retryable === right.retryable
  );
}

function findTranscriptionTaskViewerArtifact(
  message: Message,
  preview: MessageGenericTaskPreview,
) {
  const artifacts = message.artifacts || [];
  const artifactPath = preview.artifactPath?.trim();
  return artifacts.find((artifact) => {
    const meta = artifact.meta || {};
    if (
      typeof meta.taskId === "string" &&
      meta.taskId === preview.taskId &&
      meta.taskType === "transcription_generate"
    ) {
      return true;
    }
    return artifactPath
      ? doesWorkspaceFileCandidateMatch(
          resolveArtifactProtocolFilePath(artifact),
          artifactPath,
        )
      : false;
  });
}

function syncTranscriptionTaskViewerArtifact(
  message: Message,
  preview: MessageGenericTaskPreview,
): Message {
  const artifactPath = preview.artifactPath?.trim();
  if (!artifactPath) {
    return message;
  }

  const artifactDocument = buildTranscriptionTaskArtifactDocument(preview);
  const existingArtifact = findTranscriptionTaskViewerArtifact(
    message,
    preview,
  );
  const nextArtifact = buildArtifactFromWrite({
    filePath: artifactPath,
    content: JSON.stringify(artifactDocument, null, 2),
    context: {
      artifact: existingArtifact,
      artifactId:
        existingArtifact?.id || `artifact:${message.id}:${artifactPath}`,
      source: "tool_result",
      sourceMessageId: message.id,
      status:
        preview.status === "failed"
          ? "error"
          : preview.status === "running"
            ? "streaming"
            : "complete",
      metadata: {
        artifactDocument,
        artifact_type: "document",
        previewText: preview.statusMessage || "转写任务已写入统一任务产物协议",
        taskId: preview.taskId,
        taskType: "transcription_generate",
        taskFilePath: preview.taskFilePath || null,
        transcriptPath: preview.transcriptPath || null,
        transcriptText: preview.transcriptText || null,
        transcriptSegments: preview.transcriptSegments || [],
        transcriptCorrectionEnabled: Boolean(
          preview.transcriptText ||
          (preview.transcriptSegments || []).length > 0,
        ),
        transcriptCorrectionStatus:
          preview.transcriptText ||
          (preview.transcriptSegments || []).length > 0
            ? "available"
            : "waiting_transcript",
        transcriptCorrectionSource: "artifact_document_version",
        transcriptCorrectionPatchKind: "artifact_document_version",
        transcriptCorrectionOriginalImmutable: true,
        sourcePath: preview.sourcePath || null,
        sourceUrl: preview.sourceUrl || null,
        language: preview.language || null,
        outputFormat: preview.outputFormat || null,
        providerId: preview.providerId || null,
        model: preview.model || null,
        errorCode: preview.errorCode || null,
        errorMessage: preview.errorMessage || null,
        modalityContractKey: AUDIO_TRANSCRIPTION_CONTRACT_KEY,
      },
    },
  });

  return upsertMessageArtifact(message, nextArtifact);
}

function shouldTrackTranscriptionPreview(
  preview: MessageGenericTaskPreview,
): boolean {
  if (preview.kind !== "transcription_generate") {
    return false;
  }
  if (preview.status === "running") {
    return true;
  }
  return (
    (preview.status === "complete" || preview.status === "partial") &&
    (!preview.transcriptPath?.trim() || shouldLoadTranscriptText(preview))
  );
}

function collectTrackedTranscriptionTasks(
  messages: Message[],
): TrackedTranscriptionTask[] {
  const tasks = new Map<string, TrackedTranscriptionTask>();
  messages.forEach((message) => {
    const preview = message.taskPreview;
    if (!preview || preview.kind !== "transcription_generate") {
      return;
    }
    if (!shouldTrackTranscriptionPreview(preview)) {
      return;
    }
    const taskId = preview.taskId.trim();
    if (!taskId || tasks.has(taskId)) {
      return;
    }
    tasks.set(taskId, {
      taskId,
      taskFilePath: preview.taskFilePath,
      artifactPath: preview.artifactPath,
    });
  });
  return Array.from(tasks.values());
}

function buildLookupRequest(params: {
  task: TrackedTranscriptionTask;
  projectRootPath?: string | null;
}): MediaTaskLookupRequest | null {
  return buildImageTaskLookupRequest({
    taskId: params.task.taskId,
    taskFilePath: params.task.taskFilePath,
    artifactPath: params.task.artifactPath,
    projectRootPath: params.projectRootPath,
  });
}

function updateTranscriptionPreviewMessages(params: {
  previous: Message[];
  artifact: MediaTaskArtifactOutput;
  transcriptPreviewsByTaskId?: Map<string, LoadedTranscriptPreview>;
}): Message[] {
  let changed = false;
  const nextMessages = params.previous.map((message) => {
    const currentPreview = message.taskPreview;
    if (
      !currentPreview ||
      currentPreview.kind !== "transcription_generate" ||
      currentPreview.taskId !== params.artifact.task_id
    ) {
      return message;
    }
    const nextPreview = buildTranscriptionPreviewFromArtifact(
      params.artifact,
      currentPreview,
      params.transcriptPreviewsByTaskId?.get(params.artifact.task_id),
    );
    if (
      !nextPreview ||
      areTranscriptionPreviewsEqual(currentPreview, nextPreview)
    ) {
      return message;
    }
    changed = true;
    return syncTranscriptionTaskViewerArtifact(
      {
        ...message,
        taskPreview: nextPreview,
      },
      nextPreview,
    );
  });
  return changed ? nextMessages : params.previous;
}

function updateTranscriptionPreviewMessagesFromIndex(params: {
  previous: Message[];
  snapshotsByTaskId: Map<string, MediaTaskModalityRuntimeContractIndexEntry>;
  transcriptPreviewsByTaskId?: Map<string, LoadedTranscriptPreview>;
}): Message[] {
  let changed = false;
  const nextMessages = params.previous.map((message) => {
    const currentPreview = message.taskPreview;
    if (!currentPreview || currentPreview.kind !== "transcription_generate") {
      return message;
    }
    const snapshot = params.snapshotsByTaskId.get(currentPreview.taskId);
    if (!snapshot) {
      return message;
    }
    const nextPreview = buildTranscriptionPreviewFromIndexEntry(
      snapshot,
      currentPreview,
      params.transcriptPreviewsByTaskId?.get(currentPreview.taskId),
    );
    if (
      !nextPreview ||
      areTranscriptionPreviewsEqual(currentPreview, nextPreview)
    ) {
      return message;
    }
    changed = true;
    return syncTranscriptionTaskViewerArtifact(
      {
        ...message,
        taskPreview: nextPreview,
      },
      nextPreview,
    );
  });
  return changed ? nextMessages : params.previous;
}

export function useWorkspaceTranscriptionTaskPreviewRuntime({
  projectRootPath,
  messages,
  setChatMessages,
}: UseWorkspaceTranscriptionTaskPreviewRuntimeParams) {
  const contextRef = useRef({ projectRootPath, messages });

  useEffect(() => {
    contextRef.current = { projectRootPath, messages };
  }, [projectRootPath, messages]);

  useEffect(() => {
    let disposed = false;
    let polling = false;

    const syncFromTaskIndex = async (
      tasks: TrackedTranscriptionTask[],
    ): Promise<Set<string>> => {
      const workspaceRoot = contextRef.current.projectRootPath?.trim();
      if (!workspaceRoot || tasks.length === 0) {
        return new Set();
      }
      let output: ListMediaTaskArtifactsOutput;
      try {
        output = await listMediaTaskArtifacts({
          projectRootPath: workspaceRoot,
          taskFamily: "audio",
          taskType: "transcription_generate",
          modalityContractKey: AUDIO_TRANSCRIPTION_CONTRACT_KEY,
          limit: Math.max(TRANSCRIPTION_TASK_INDEX_RESTORE_LIMIT, tasks.length),
        });
      } catch (error) {
        console.warn(
          "[TranscriptionTaskPreviewRuntime] 读取转写任务索引失败，回退 task artifact:",
          error,
        );
        return new Set();
      }
      if (disposed) {
        return new Set();
      }
      const trackedTaskIds = new Set(tasks.map((task) => task.taskId));
      const snapshotsByTaskId = new Map<
        string,
        MediaTaskModalityRuntimeContractIndexEntry
      >();
      output.modality_runtime_contracts.snapshots.forEach((snapshot) => {
        if (
          trackedTaskIds.has(snapshot.task_id) &&
          hasUsableTranscriptIndex(snapshot)
        ) {
          snapshotsByTaskId.set(snapshot.task_id, snapshot);
        }
      });
      if (snapshotsByTaskId.size === 0) {
        return new Set();
      }
      const transcriptPreviewsByTaskId = await loadTranscriptTextsFromIndex({
        projectRootPath: workspaceRoot,
        snapshotsByTaskId,
      });
      if (disposed) {
        return new Set();
      }
      setChatMessages((previous) =>
        updateTranscriptionPreviewMessagesFromIndex({
          previous,
          snapshotsByTaskId,
          transcriptPreviewsByTaskId,
        }),
      );
      return new Set(snapshotsByTaskId.keys());
    };

    const syncTask = async (task: TrackedTranscriptionTask) => {
      const request = buildLookupRequest({
        task,
        projectRootPath: contextRef.current.projectRootPath,
      });
      if (!request) {
        return;
      }
      const artifact = await getMediaTaskArtifact(request);
      if (disposed || artifact.task_type !== "transcription_generate") {
        return;
      }
      const transcriptPath = resolveTranscriptPathFromArtifact(artifact);
      const transcriptPreview = await loadTranscriptText({
        projectRootPath: contextRef.current.projectRootPath,
        transcriptPath,
      });
      if (disposed) {
        return;
      }
      const transcriptPreviewsByTaskId = new Map<
        string,
        LoadedTranscriptPreview
      >();
      if (
        transcriptPreview.text ||
        (transcriptPreview.segments && transcriptPreview.segments.length > 0)
      ) {
        transcriptPreviewsByTaskId.set(artifact.task_id, transcriptPreview);
      }
      setChatMessages((previous) =>
        updateTranscriptionPreviewMessages({
          previous,
          artifact,
          transcriptPreviewsByTaskId,
        }),
      );
    };

    const syncOnce = async () => {
      if (disposed || polling) {
        return;
      }
      const tasks = collectTrackedTranscriptionTasks(
        contextRef.current.messages,
      );
      if (tasks.length === 0) {
        return;
      }
      polling = true;
      try {
        const indexedTaskIds = await syncFromTaskIndex(tasks);
        await Promise.all(
          tasks
            .filter((task) => !indexedTaskIds.has(task.taskId))
            .map((task) => syncTask(task)),
        );
      } catch (error) {
        console.warn(
          "[TranscriptionTaskPreviewRuntime] 同步转写任务状态失败:",
          error,
        );
      } finally {
        polling = false;
      }
    };

    void syncOnce();
    const timerId = window.setInterval(() => {
      void syncOnce();
    }, TRANSCRIPTION_TASK_POLL_INTERVAL_MS);

    let unlisten: (() => void) | null = null;
    safeListen<CreationTaskSubmittedPayload>(
      TRANSCRIPTION_TASK_EVENT_NAME,
      (event) => {
        if (disposed) {
          return;
        }
        const payload = event.payload || {};
        const taskId = payload.task_id?.trim();
        const taskType = payload.task_type?.trim();
        const taskFamily = payload.task_family?.trim();
        const taskPath = `${payload.absolute_path || ""} ${payload.path || ""}`;
        const isTranscriptionEvent =
          taskType === "transcription_generate" ||
          taskPath.includes("transcription_generate") ||
          taskFamily === "audio";
        if (!taskId || !isTranscriptionEvent) {
          return;
        }
        const tracked = collectTrackedTranscriptionTasks(
          contextRef.current.messages,
        ).find((task) => task.taskId === taskId);
        if (!tracked) {
          return;
        }
        void syncTask({
          ...tracked,
          taskFilePath:
            payload.absolute_path?.trim() ||
            payload.path?.trim() ||
            tracked.taskFilePath,
        });
      },
    )
      .then((dispose) => {
        if (disposed) {
          void dispose();
          return;
        }
        unlisten = dispose;
      })
      .catch((error) => {
        console.warn(
          "[TranscriptionTaskPreviewRuntime] 监听转写任务事件失败:",
          error,
        );
      });

    return () => {
      disposed = true;
      window.clearInterval(timerId);
      if (unlisten) {
        unlisten();
      }
    };
  }, [setChatMessages]);
}
