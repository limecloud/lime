const VIDEO_WORKBENCH_TASK_ACTION_EVENT =
  "lime:video-workbench-task-action";

export type VideoWorkbenchTaskAction = "retry" | "cancel";

export interface VideoWorkbenchTaskActionDetail {
  action: VideoWorkbenchTaskAction;
  taskId: string;
  projectId?: string | null;
  contentId?: string | null;
}

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

export function emitVideoWorkbenchTaskAction(
  detail: VideoWorkbenchTaskActionDetail,
): void {
  if (!hasWindow()) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<VideoWorkbenchTaskActionDetail>(
      VIDEO_WORKBENCH_TASK_ACTION_EVENT,
      {
        detail,
      },
    ),
  );
}

export function onVideoWorkbenchTaskAction(
  listener: (detail: VideoWorkbenchTaskActionDetail) => void,
): () => void {
  if (!hasWindow()) {
    return () => undefined;
  }

  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) {
      return;
    }

    const detail = (event as CustomEvent<VideoWorkbenchTaskActionDetail>)
      .detail;
    if (
      !detail ||
      (detail.action !== "retry" && detail.action !== "cancel") ||
      typeof detail.taskId !== "string"
    ) {
      return;
    }
    listener(detail);
  };

  window.addEventListener(VIDEO_WORKBENCH_TASK_ACTION_EVENT, handler);
  return () => {
    window.removeEventListener(VIDEO_WORKBENCH_TASK_ACTION_EVENT, handler);
  };
}
