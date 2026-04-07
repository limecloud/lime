import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { videoGenerationApi } from "@/lib/api/videoGeneration";
import type { Message, MessageVideoTaskPreview } from "../types";
import {
  areVideoPreviewsEqual,
  buildVideoPreviewFromTask,
} from "./videoTaskPreviewState";

const VIDEO_TASK_POLL_INTERVAL_MS = 3000;

interface UseWorkspaceVideoTaskPreviewRuntimeParams {
  messages: Message[];
  setChatMessages: Dispatch<SetStateAction<Message[]>>;
}

function shouldTrackVideoPreview(preview?: MessageVideoTaskPreview): boolean {
  if (!preview) {
    return false;
  }

  if (preview.status === "running") {
    return true;
  }

  return (
    (preview.status === "complete" || preview.status === "partial") &&
    !preview.videoUrl?.trim()
  );
}

function collectTrackedTaskIds(messages: Message[]): string[] {
  const taskIds = new Set<string>();
  messages.forEach((message) => {
    if (message.taskPreview?.kind !== "video_generate") {
      return;
    }
    if (!shouldTrackVideoPreview(message.taskPreview)) {
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

              const nextPreview = buildVideoPreviewFromTask(
                task,
                currentPreview,
              );
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
