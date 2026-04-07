import type { VideoGenerationTask } from "@/lib/api/videoGeneration";
import type { MessageVideoTaskPreview } from "../types";

export function clampVideoTaskProgress(value?: number | null): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function resolveVideoPreviewStatus(
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

export function resolveVideoPreviewPhase(
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

export function resolveVideoStatusMessage(
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

export function buildVideoPreviewFromTask(
  task: VideoGenerationTask,
  currentPreview: MessageVideoTaskPreview,
): MessageVideoTaskPreview {
  const nextStatus = resolveVideoPreviewStatus(task.status);
  const progress = clampVideoTaskProgress(task.progress);

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
    phase: resolveVideoPreviewPhase(task.status),
    statusMessage: resolveVideoStatusMessage(task, nextStatus, progress),
  };
}

export function areVideoPreviewsEqual(
  previous: MessageVideoTaskPreview,
  next: MessageVideoTaskPreview,
): boolean {
  return (
    previous.prompt === next.prompt &&
    previous.status === next.status &&
    previous.projectId === next.projectId &&
    previous.videoUrl === next.videoUrl &&
    previous.thumbnailUrl === next.thumbnailUrl &&
    previous.providerId === next.providerId &&
    previous.model === next.model &&
    previous.progress === next.progress &&
    previous.phase === next.phase &&
    previous.statusMessage === next.statusMessage
  );
}
