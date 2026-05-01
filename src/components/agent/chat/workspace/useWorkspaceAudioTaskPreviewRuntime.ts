import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import {
  getMediaTaskArtifact,
  listMediaTaskArtifacts,
  type ListMediaTaskArtifactsOutput,
  type MediaTaskModalityRuntimeContractIndexEntry,
  type MediaTaskArtifactOutput,
  type MediaTaskLookupRequest,
} from "@/lib/api/mediaTasks";
import { resolveArtifactProtocolFilePath } from "@/lib/artifact-protocol";
import { safeListen } from "@/lib/dev-bridge";
import type { Message, MessageGenericTaskPreview } from "../types";
import {
  buildArtifactFromWrite,
  upsertMessageArtifact,
} from "../utils/messageArtifacts";
import { buildAudioTaskArtifactDocument } from "../utils/taskPreviewFromToolResult";
import { buildImageTaskLookupRequest } from "./imageTaskLocator";
import {
  areTaskMetaItemsEqual,
  mergeMediaTaskPolicyEvaluationMetaItems,
} from "./mediaTaskPolicyEvaluation";
import { doesWorkspaceFileCandidateMatch } from "./workspaceFilePathMatch";

const AUDIO_TASK_EVENT_NAME = "lime://creation_task_submitted";
const AUDIO_TASK_POLL_INTERVAL_MS = 3000;
const AUDIO_TASK_INDEX_RESTORE_LIMIT = 24;
const VOICE_GENERATION_CONTRACT_KEY = "voice_generation";

interface UseWorkspaceAudioTaskPreviewRuntimeParams {
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

interface TrackedAudioTask {
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

function readPositiveNumber(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): number | null {
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

function resolveAudioFailureStatusMessage(
  errorCode?: string | null,
  errorMessage?: string | null,
): string {
  switch ((errorCode || "").trim()) {
    case "audio_provider_unconfigured":
      return "配音 Provider 未配置，请先在语音生成设置中选择可用 Provider；任务保留在 audio_generate，不会回退 legacy TTS。";
    case "audio_provider_model_unconfigured":
      return "配音模型未配置，请先为语音生成设置默认模型；任务保留在 audio_generate，不会回退 legacy TTS。";
    case "audio_provider_resolver_unavailable":
      return "当前无法解析 API Key Provider 凭证，配音任务已显式失败，没有伪造音频路径。";
    case "audio_provider_resolution_failed":
      return "解析配音 Provider 凭证失败，请检查 API Key Provider 配置后重试。";
    case "audio_provider_client_missing":
      return "当前 Provider 还没有 OpenAI-compatible speech adapter，配音任务不会回退旧 TTS。";
    case "audio_provider_request_failed":
      return "调用配音 Provider 失败，请检查额度、网络或模型配置后重试。";
    case "audio_provider_response_read_failed":
      return "读取配音 Provider 响应失败，请稍后重试或检查 Provider 网关。";
    case "audio_provider_empty_response":
      return "配音 Provider 返回了空音频内容，已阻止写入空 audio_output。";
    case "audio_output_write_failed":
      return "配音音频已返回但写入工作区失败，请检查项目目录权限后重试。";
    case "invalid_audio_task_payload":
      return "配音任务缺少必要文本，已阻止调用音频 Provider。";
    case "voice_generation_contract_mismatch":
    case "voice_generation_capability_gap":
    case "voice_generation_routing_slot_mismatch":
    case "voice_generation_task_type_mismatch":
      return "配音任务运行合同不匹配，已阻止执行器误跑到非 voice_generation 主链。";
    default:
      return (
        errorMessage?.trim() || "配音生成失败，请调整文本、音色或模型后重试。"
      );
  }
}

function resolveStatusMessage(preview: MessageGenericTaskPreview): string {
  if (preview.status === "complete" || preview.status === "partial") {
    return preview.audioUrl?.trim()
      ? "音频结果已同步，工作区已从 audio_output 读取可播放结果。"
      : "配音任务已完成，正在等待 audio_output 音频路径。";
  }
  if (preview.status === "failed") {
    return resolveAudioFailureStatusMessage(
      preview.errorCode,
      preview.errorMessage,
    );
  }
  if (preview.status === "cancelled") {
    return "配音任务已经取消，当前不会继续生成音频。";
  }
  return "配音任务已写入统一 audio_task/audio_output 协议，工作区会继续同步结果。";
}

function buildAudioPreviewFromArtifact(
  artifact: MediaTaskArtifactOutput,
  currentPreview: MessageGenericTaskPreview,
): MessageGenericTaskPreview | null {
  if (artifact.task_type !== "audio_generate") {
    return null;
  }

  const payload = asRecord(artifact.record?.payload);
  const result = asRecord(artifact.record?.result);
  const lastError = asRecord(artifact.record?.last_error);
  const progress = asRecord(artifact.record?.progress);
  const audioOutput =
    asRecord(payload?.audio_output) || asRecord(result?.audio_output);
  const candidates = [audioOutput, result, payload];
  const errorCandidates = [audioOutput, lastError, progress, result, payload];
  const sourceText =
    readString(candidates, ["source_text", "sourceText", "prompt"]) ||
    currentPreview.sourceText ||
    currentPreview.prompt;
  const artifactAudioUrl = readString(candidates, [
    "audio_path",
    "audioPath",
    "audio_url",
    "audioUrl",
    "url",
    "result_url",
    "resultUrl",
  ]);
  const nextStatus = normalizePreviewStatus(
    artifact.normalized_status || artifact.status || artifact.record?.status,
  );
  const audioUrl =
    nextStatus === "failed"
      ? artifactAudioUrl
      : artifactAudioUrl || currentPreview.audioUrl;
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
  const nextPreview: MessageGenericTaskPreview = {
    ...currentPreview,
    kind: "audio_generate",
    taskType: "audio_generate",
    taskId: artifact.task_id || currentPreview.taskId,
    prompt: sourceText,
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
    phase:
      readString([asRecord(artifact.record?.progress)], ["phase"]) ??
      currentPreview.phase ??
      null,
    audioUrl: audioUrl ?? null,
    mimeType:
      readString(candidates, ["mime_type", "mimeType"]) ??
      currentPreview.mimeType ??
      null,
    durationMs:
      readPositiveNumber(candidates, ["duration_ms", "durationMs"]) ??
      currentPreview.durationMs ??
      null,
    sourceText,
    voice: readString(candidates, ["voice"]) ?? currentPreview.voice ?? null,
    errorCode,
    errorMessage,
    retryable,
  };
  return {
    ...nextPreview,
    statusMessage: resolveStatusMessage(nextPreview),
  };
}

function hasUsableAudioOutputIndex(
  entry: MediaTaskModalityRuntimeContractIndexEntry,
): boolean {
  if (entry.task_type !== "audio_generate") {
    return false;
  }
  return Boolean(entry.audio_output_status);
}

function buildAudioPreviewFromIndexEntry(
  entry: MediaTaskModalityRuntimeContractIndexEntry,
  currentPreview: MessageGenericTaskPreview,
): MessageGenericTaskPreview | null {
  if (!hasUsableAudioOutputIndex(entry)) {
    return null;
  }

  const nextStatus = normalizePreviewStatus(
    entry.audio_output_status || entry.normalized_status,
  );
  const indexedAudioPath = entry.audio_output_path?.trim() || null;
  const audioUrl =
    nextStatus === "failed"
      ? indexedAudioPath
      : indexedAudioPath || currentPreview.audioUrl || null;
  const errorCode =
    nextStatus === "failed"
      ? entry.audio_output_error_code?.trim() ||
        currentPreview.errorCode ||
        null
      : null;
  const errorMessage =
    nextStatus === "failed" && errorCode === currentPreview.errorCode
      ? currentPreview.errorMessage || null
      : null;
  const retryable =
    nextStatus === "failed"
      ? (entry.audio_output_retryable ?? currentPreview.retryable)
      : currentPreview.retryable;
  const nextPreview: MessageGenericTaskPreview = {
    ...currentPreview,
    kind: "audio_generate",
    taskType: "audio_generate",
    taskId: entry.task_id || currentPreview.taskId,
    status: nextStatus,
    providerId: entry.provider_id?.trim() || currentPreview.providerId || null,
    model: entry.model?.trim() || currentPreview.model || null,
    audioUrl,
    mimeType:
      entry.audio_output_mime_type?.trim() || currentPreview.mimeType || null,
    durationMs:
      typeof entry.audio_output_duration_ms === "number" &&
      Number.isFinite(entry.audio_output_duration_ms) &&
      entry.audio_output_duration_ms > 0
        ? entry.audio_output_duration_ms
        : currentPreview.durationMs || null,
    metaItems: mergeMediaTaskPolicyEvaluationMetaItems(
      currentPreview.metaItems,
      entry,
    ),
    errorCode,
    errorMessage,
    retryable,
  };
  return {
    ...nextPreview,
    statusMessage: resolveStatusMessage(nextPreview),
  };
}

function areAudioPreviewsEqual(
  left: MessageGenericTaskPreview,
  right: MessageGenericTaskPreview,
): boolean {
  return (
    left.status === right.status &&
    left.audioUrl === right.audioUrl &&
    left.mimeType === right.mimeType &&
    left.durationMs === right.durationMs &&
    left.sourceText === right.sourceText &&
    left.voice === right.voice &&
    left.providerId === right.providerId &&
    left.model === right.model &&
    left.phase === right.phase &&
    left.statusMessage === right.statusMessage &&
    areTaskMetaItemsEqual(left.metaItems, right.metaItems) &&
    left.errorCode === right.errorCode &&
    left.errorMessage === right.errorMessage &&
    left.retryable === right.retryable
  );
}

function findAudioTaskViewerArtifact(
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
      meta.taskType === "audio_generate"
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

function syncAudioTaskViewerArtifact(
  message: Message,
  preview: MessageGenericTaskPreview,
): Message {
  const artifactPath = preview.artifactPath?.trim();
  if (!artifactPath) {
    return message;
  }

  const artifactDocument = buildAudioTaskArtifactDocument(preview);
  const existingArtifact = findAudioTaskViewerArtifact(message, preview);
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
        previewText: preview.statusMessage || "配音任务已写入统一任务产物协议",
        taskId: preview.taskId,
        taskType: "audio_generate",
        taskFilePath: preview.taskFilePath || null,
        audioUrl: preview.audioUrl || null,
        mimeType: preview.mimeType || null,
        durationMs: preview.durationMs || null,
        voice: preview.voice || null,
        providerId: preview.providerId || null,
        model: preview.model || null,
        errorCode: preview.errorCode || null,
        errorMessage: preview.errorMessage || null,
        modalityContractKey: "voice_generation",
      },
    },
  });

  return upsertMessageArtifact(message, nextArtifact);
}

function shouldTrackAudioPreview(preview: MessageGenericTaskPreview): boolean {
  if (preview.kind !== "audio_generate") {
    return false;
  }
  if (preview.status === "running") {
    return true;
  }
  return (
    (preview.status === "complete" || preview.status === "partial") &&
    !preview.audioUrl?.trim()
  );
}

function collectTrackedAudioTasks(messages: Message[]): TrackedAudioTask[] {
  const tasks = new Map<string, TrackedAudioTask>();
  messages.forEach((message) => {
    const preview = message.taskPreview;
    if (!preview || preview.kind !== "audio_generate") {
      return;
    }
    if (!shouldTrackAudioPreview(preview)) {
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
  task: TrackedAudioTask;
  projectRootPath?: string | null;
}): MediaTaskLookupRequest | null {
  return buildImageTaskLookupRequest({
    taskId: params.task.taskId,
    taskFilePath: params.task.taskFilePath,
    artifactPath: params.task.artifactPath,
    projectRootPath: params.projectRootPath,
  });
}

function updateAudioPreviewMessages(params: {
  previous: Message[];
  artifact: MediaTaskArtifactOutput;
}): Message[] {
  let changed = false;
  const nextMessages = params.previous.map((message) => {
    const currentPreview = message.taskPreview;
    if (
      !currentPreview ||
      currentPreview.kind !== "audio_generate" ||
      currentPreview.taskId !== params.artifact.task_id
    ) {
      return message;
    }
    const nextPreview = buildAudioPreviewFromArtifact(
      params.artifact,
      currentPreview,
    );
    if (!nextPreview || areAudioPreviewsEqual(currentPreview, nextPreview)) {
      return message;
    }
    changed = true;
    return syncAudioTaskViewerArtifact(
      {
        ...message,
        taskPreview: nextPreview,
      },
      nextPreview,
    );
  });
  return changed ? nextMessages : params.previous;
}

function updateAudioPreviewMessagesFromIndex(params: {
  previous: Message[];
  snapshotsByTaskId: Map<string, MediaTaskModalityRuntimeContractIndexEntry>;
}): Message[] {
  let changed = false;
  const nextMessages = params.previous.map((message) => {
    const currentPreview = message.taskPreview;
    if (!currentPreview || currentPreview.kind !== "audio_generate") {
      return message;
    }
    const snapshot = params.snapshotsByTaskId.get(currentPreview.taskId);
    if (!snapshot) {
      return message;
    }
    const nextPreview = buildAudioPreviewFromIndexEntry(
      snapshot,
      currentPreview,
    );
    if (!nextPreview || areAudioPreviewsEqual(currentPreview, nextPreview)) {
      return message;
    }
    changed = true;
    return syncAudioTaskViewerArtifact(
      {
        ...message,
        taskPreview: nextPreview,
      },
      nextPreview,
    );
  });
  return changed ? nextMessages : params.previous;
}

export function useWorkspaceAudioTaskPreviewRuntime({
  projectRootPath,
  messages,
  setChatMessages,
}: UseWorkspaceAudioTaskPreviewRuntimeParams) {
  const contextRef = useRef({ projectRootPath, messages });

  useEffect(() => {
    contextRef.current = { projectRootPath, messages };
  }, [projectRootPath, messages]);

  useEffect(() => {
    let disposed = false;
    let polling = false;

    const syncFromTaskIndex = async (
      tasks: TrackedAudioTask[],
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
          taskType: "audio_generate",
          modalityContractKey: VOICE_GENERATION_CONTRACT_KEY,
          limit: Math.max(AUDIO_TASK_INDEX_RESTORE_LIMIT, tasks.length),
        });
      } catch (error) {
        console.warn(
          "[AudioTaskPreviewRuntime] 读取音频任务索引失败，回退 task artifact:",
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
          hasUsableAudioOutputIndex(snapshot)
        ) {
          snapshotsByTaskId.set(snapshot.task_id, snapshot);
        }
      });
      if (snapshotsByTaskId.size === 0) {
        return new Set();
      }
      setChatMessages((previous) =>
        updateAudioPreviewMessagesFromIndex({
          previous,
          snapshotsByTaskId,
        }),
      );
      return new Set(snapshotsByTaskId.keys());
    };

    const syncTask = async (task: TrackedAudioTask) => {
      const request = buildLookupRequest({
        task,
        projectRootPath: contextRef.current.projectRootPath,
      });
      if (!request) {
        return;
      }
      const artifact = await getMediaTaskArtifact(request);
      if (disposed || artifact.task_type !== "audio_generate") {
        return;
      }
      setChatMessages((previous) =>
        updateAudioPreviewMessages({ previous, artifact }),
      );
    };

    const syncOnce = async () => {
      if (disposed || polling) {
        return;
      }
      const tasks = collectTrackedAudioTasks(contextRef.current.messages);
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
        console.warn("[AudioTaskPreviewRuntime] 同步音频任务状态失败:", error);
      } finally {
        polling = false;
      }
    };

    void syncOnce();
    const timerId = window.setInterval(() => {
      void syncOnce();
    }, AUDIO_TASK_POLL_INTERVAL_MS);

    let unlisten: (() => void) | null = null;
    safeListen<CreationTaskSubmittedPayload>(AUDIO_TASK_EVENT_NAME, (event) => {
      if (disposed) {
        return;
      }
      const payload = event.payload || {};
      const taskId = payload.task_id?.trim();
      const taskType = payload.task_type?.trim();
      const taskFamily = payload.task_family?.trim();
      if (
        !taskId ||
        (taskType !== "audio_generate" && taskFamily !== "audio")
      ) {
        return;
      }
      const tracked = collectTrackedAudioTasks(
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
    })
      .then((dispose) => {
        if (disposed) {
          void dispose();
          return;
        }
        unlisten = dispose;
      })
      .catch((error) => {
        console.warn("[AudioTaskPreviewRuntime] 监听音频任务事件失败:", error);
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
