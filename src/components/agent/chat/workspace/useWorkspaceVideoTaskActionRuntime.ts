import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import {
  type CreateVideoGenerationRequest,
  videoGenerationApi,
} from "@/lib/api/videoGeneration";
import { onVideoWorkbenchTaskAction } from "@/lib/videoWorkbenchEvents";
import type { Message, MessageVideoTaskPreview } from "../types";
import {
  buildVideoPreviewFromTask,
  clampVideoTaskProgress,
  resolveVideoPreviewPhase,
  resolveVideoPreviewStatus,
} from "./videoTaskPreviewState";

interface UseWorkspaceVideoTaskActionRuntimeParams {
  projectId?: string | null;
  contentId?: string | null;
  setChatMessages: Dispatch<SetStateAction<Message[]>>;
}

function parseTaskRequestPayload(
  requestPayload?: string | null,
): Partial<CreateVideoGenerationRequest> | null {
  const normalizedPayload = requestPayload?.trim();
  if (!normalizedPayload) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalizedPayload) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Partial<CreateVideoGenerationRequest>;
  } catch {
    return null;
  }
}

function buildRetryRequest(
  task: Awaited<ReturnType<typeof videoGenerationApi.getTask>>,
  preview?: MessageVideoTaskPreview,
): CreateVideoGenerationRequest | null {
  if (!task) {
    return null;
  }

  const payload = parseTaskRequestPayload(task.requestPayload);
  const projectId = payload?.projectId || task.projectId;
  const providerId = payload?.providerId || task.providerId;
  const model = payload?.model || task.model;
  const prompt = payload?.prompt || task.prompt;

  if (!projectId || !providerId || !model || !prompt?.trim()) {
    return null;
  }

  return {
    projectId,
    providerId,
    model,
    prompt: prompt.trim(),
    aspectRatio: payload?.aspectRatio || preview?.aspectRatio,
    resolution: payload?.resolution || preview?.resolution,
    duration: payload?.duration || preview?.durationSeconds,
    imageUrl: payload?.imageUrl,
    endImageUrl: payload?.endImageUrl,
    seed: payload?.seed,
    generateAudio: payload?.generateAudio,
    cameraFixed: payload?.cameraFixed,
  };
}

function matchesTaskActionContext(params: {
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

function updateVideoPreviewByTaskId(
  previous: Message[],
  taskId: string,
  updater: (preview: MessageVideoTaskPreview) => MessageVideoTaskPreview,
): Message[] {
  let changed = false;
  const nextMessages = previous.map((message) => {
    const preview = message.taskPreview;
    if (preview?.kind !== "video_generate" || preview.taskId !== taskId) {
      return message;
    }

    changed = true;
    return {
      ...message,
      taskPreview: updater(preview),
    };
  });

  return changed ? nextMessages : previous;
}

export function useWorkspaceVideoTaskActionRuntime({
  projectId,
  contentId,
  setChatMessages,
}: UseWorkspaceVideoTaskActionRuntimeParams) {
  const handleRetryVideoTask = useCallback(
    async (taskId: string) => {
      const normalizedTaskId = taskId.trim();
      if (!normalizedTaskId) {
        toast.error("缺少视频任务 ID，暂时无法重新生成");
        return false;
      }

      const originalTask = await videoGenerationApi.getTask(normalizedTaskId, {
        refreshStatus: false,
      });
      if (!originalTask) {
        toast.error("未找到原视频任务，暂时无法重新生成");
        return false;
      }

      let sourcePreview: MessageVideoTaskPreview | null = null;
      setChatMessages((previous) => {
        previous.some((message) => {
          if (
            message.taskPreview?.kind === "video_generate" &&
            message.taskPreview.taskId === normalizedTaskId
          ) {
            sourcePreview = message.taskPreview;
            return true;
          }
          return false;
        });
        return previous;
      });

      const retryRequest = buildRetryRequest(
        originalTask,
        sourcePreview || undefined,
      );
      if (!retryRequest) {
        toast.error("原视频任务缺少必要参数，暂时无法重新生成");
        return false;
      }

      try {
        const created = await videoGenerationApi.createTask(retryRequest);
        setChatMessages((previous) =>
          updateVideoPreviewByTaskId(previous, normalizedTaskId, (preview) => ({
            ...preview,
            taskId: created.id,
            prompt: created.prompt?.trim() || preview.prompt,
            status: resolveVideoPreviewStatus(created.status),
            projectId: created.projectId || preview.projectId || null,
            videoUrl: null,
            thumbnailUrl: null,
            providerId: created.providerId || preview.providerId || null,
            model: created.model || preview.model || null,
            progress: clampVideoTaskProgress(created.progress),
            phase: resolveVideoPreviewPhase(created.status),
            statusMessage: "视频任务已重新提交，工作区会继续同步最新状态。",
          })),
        );
        toast.success("已重新提交视频任务");
        return true;
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "重新提交视频任务失败",
        );
        return false;
      }
    },
    [setChatMessages],
  );

  const handleCancelVideoTask = useCallback(
    async (taskId: string) => {
      const normalizedTaskId = taskId.trim();
      if (!normalizedTaskId) {
        toast.error("缺少视频任务 ID，暂时无法取消");
        return false;
      }

      try {
        const cancelledTask = await videoGenerationApi.cancelTask(
          normalizedTaskId,
        );
        if (cancelledTask) {
          setChatMessages((previous) =>
            updateVideoPreviewByTaskId(previous, normalizedTaskId, (preview) =>
              buildVideoPreviewFromTask(cancelledTask, preview),
            ),
          );
        }
        toast.success("已提交取消请求");
        return true;
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "取消视频任务失败",
        );
        return false;
      }
    },
    [setChatMessages],
  );

  useEffect(() => {
    return onVideoWorkbenchTaskAction((detail) => {
      if (
        !matchesTaskActionContext({
          detailProjectId: detail.projectId,
          detailContentId: detail.contentId,
          projectId,
          contentId,
        })
      ) {
        return;
      }

      if (detail.action === "retry") {
        void handleRetryVideoTask(detail.taskId);
        return;
      }

      void handleCancelVideoTask(detail.taskId);
    });
  }, [contentId, handleCancelVideoTask, handleRetryVideoTask, projectId]);
}
