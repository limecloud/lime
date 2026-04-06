import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import {
  videoGenerationApi,
  type VideoGenerationTask,
} from "@/lib/api/videoGeneration";
import type { Message, MessageVideoTaskPreview } from "../types";

const VIDEO_TASK_POLL_INTERVAL_MS = 3000;

interface UseWorkspaceVideoTaskPreviewRuntimeParams {
  messages: Message[];
  setChatMessages: Dispatch<SetStateAction<Message[]>>;
}

function clampProgress(value?: number | null): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function resolvePreviewStatus(
  status: VideoGenerationTask["status"],
): MessageVideoTaskPreview["status"] {
  switch (status) {
    case "success":
      return "complete";
    case "error":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "pending":
    case "processing":
    default:
      return "running";
  }
}

function resolvePreviewPhase(
  status: VideoGenerationTask["status"],
): MessageVideoTaskPreview["phase"] {
  if (status === "pending") {
    return "queued";
  }
  if (status === "processing") {
    return "running";
  }
  return null;
}

function resolveStatusMessage(
  task: VideoGenerationTask,
  previewStatus: MessageVideoTaskPreview["status"],
  progress: number | null,
): string {
  if (previewStatus === "complete") {
    return task.resultUrl
      ? "视频结果已同步，打开查看即可继续预览。"
      : "视频已经生成完成，工作区正在同步最终结果。";
  }
  if (previewStatus === "failed") {
    return task.errorMessage?.trim() || "视频生成失败，请稍后重试。";
  }
  if (previewStatus === "cancelled") {
    return "视频任务已取消，当前不会继续生成新的结果。";
  }
  if (typeof progress === "number" && progress > 0) {
    return `视频正在生成中，当前进度约 ${progress}%。`;
  }
  if (task.status === "pending") {
    return "视频任务已进入排队队列，稍后会自动开始生成。";
  }
  return "视频任务正在生成中，工作区会继续同步最新状态。";
}

function buildPreviewFromTask(
  task: VideoGenerationTask,
  currentPreview: MessageVideoTaskPreview,
): MessageVideoTaskPreview {
  const nextStatus = resolvePreviewStatus(task.status);
  const progress = clampProgress(task.progress);

  return {
    ...currentPreview,
    kind: "video_generate",
    taskId: task.id,
    taskType: "video_generate",
    prompt: task.prompt?.trim() || currentPreview.prompt,
    status: nextStatus,
    projectId: task.projectId || currentPreview.projectId || null,
    videoUrl: task.resultUrl || currentPreview.videoUrl || null,
    providerId: task.providerId || currentPreview.providerId || null,
    model: task.model || currentPreview.model || null,
    progress,
    phase: resolvePreviewPhase(task.status),
    statusMessage: resolveStatusMessage(task, nextStatus, progress),
  };
}

function areVideoPreviewsEqual(
  previous: MessageVideoTaskPreview,
  next: MessageVideoTaskPreview,
): boolean {
  return (
    previous.prompt === next.prompt &&
    previous.status === next.status &&
    previous.projectId === next.projectId &&
    previous.videoUrl === next.videoUrl &&
    previous.providerId === next.providerId &&
    previous.model === next.model &&
    previous.progress === next.progress &&
    previous.phase === next.phase &&
    previous.statusMessage === next.statusMessage
  );
}

function collectTrackedTaskIds(messages: Message[]): string[] {
  const taskIds = new Set<string>();
  messages.forEach((message) => {
    if (
      message.taskPreview?.kind !== "video_generate" ||
      message.taskPreview.status !== "running"
    ) {
      return;
    }
    const taskId = message.taskPreview.taskId.trim();
    if (taskId) {
      taskIds.add(taskId);
    }
  });
  return Array.from(taskIds);
}

export function useWorkspaceVideoTaskPreviewRuntime({
  messages,
  setChatMessages,
}: UseWorkspaceVideoTaskPreviewRuntimeParams) {
  const messagesRef = useRef(messages);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    let disposed = false;
    let polling = false;

    const syncOnce = async () => {
      if (disposed || polling) {
        return;
      }

      const taskIds = collectTrackedTaskIds(messagesRef.current);
      if (taskIds.length === 0) {
        return;
      }

      polling = true;
      try {
        const tasks = await Promise.all(
          taskIds.map((taskId) =>
            videoGenerationApi.getTask(taskId, { refreshStatus: true }),
          ),
        );
        if (disposed) {
          return;
        }

        tasks.forEach((task) => {
          if (!task) {
            return;
          }

          setChatMessages((previous) => {
            let changed = false;
            const nextMessages = previous.map((message) => {
              const currentPreview = message.taskPreview;
              if (
                currentPreview?.kind !== "video_generate" ||
                currentPreview.taskId !== task.id
              ) {
                return message;
              }

              const nextPreview = buildPreviewFromTask(task, currentPreview);
              if (areVideoPreviewsEqual(currentPreview, nextPreview)) {
                return message;
              }

              changed = true;
              return {
                ...message,
                taskPreview: nextPreview,
              };
            });

            return changed ? nextMessages : previous;
          });
        });
      } catch (error) {
        console.warn("[VideoTaskPreviewRuntime] 同步视频任务状态失败:", error);
      } finally {
        polling = false;
      }
    };

    void syncOnce();
    const timerId = window.setInterval(() => {
      void syncOnce();
    }, VIDEO_TASK_POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(timerId);
    };
  }, [setChatMessages]);
}
