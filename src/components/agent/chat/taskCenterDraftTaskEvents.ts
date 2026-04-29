export const TASK_CENTER_CREATE_DRAFT_TASK_EVENT =
  "lime:task-center:create-draft-task";
export const TASK_CENTER_OPEN_TASK_EVENT = "lime:task-center:open-task";

export interface TaskCenterCreateDraftTaskDetail {
  source?: "sidebar" | "conversation_shelf" | "tab_strip";
}

export interface TaskCenterOpenTaskDetail {
  sessionId: string;
  workspaceId?: string | null;
  source?: "sidebar" | "conversation_shelf" | "tab_strip";
}

export function requestTaskCenterDraftTask(
  detail: TaskCenterCreateDraftTaskDetail = {},
): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const event = new CustomEvent<TaskCenterCreateDraftTaskDetail>(
    TASK_CENTER_CREATE_DRAFT_TASK_EVENT,
    { cancelable: true, detail },
  );
  return !window.dispatchEvent(event);
}

export function subscribeTaskCenterDraftTaskRequests(
  handler: (detail: TaskCenterCreateDraftTaskDetail) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const listener = (event: Event) => {
    const detail =
      event instanceof CustomEvent
        ? (event.detail as TaskCenterCreateDraftTaskDetail | undefined)
        : undefined;
    handler(detail ?? {});
    event.preventDefault();
  };

  window.addEventListener(TASK_CENTER_CREATE_DRAFT_TASK_EVENT, listener);
  return () => {
    window.removeEventListener(TASK_CENTER_CREATE_DRAFT_TASK_EVENT, listener);
  };
}

export function notifyTaskCenterTaskOpen(
  detail: TaskCenterOpenTaskDetail,
): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const normalizedSessionId = detail.sessionId.trim();
  if (!normalizedSessionId) {
    return false;
  }

  window.dispatchEvent(
    new CustomEvent<TaskCenterOpenTaskDetail>(TASK_CENTER_OPEN_TASK_EVENT, {
      detail: {
        ...detail,
        sessionId: normalizedSessionId,
        workspaceId: detail.workspaceId?.trim() || null,
      },
    }),
  );
  return true;
}

export function subscribeTaskCenterTaskOpenRequests(
  handler: (detail: TaskCenterOpenTaskDetail) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const listener = (event: Event) => {
    const detail =
      event instanceof CustomEvent
        ? (event.detail as TaskCenterOpenTaskDetail | undefined)
        : undefined;
    const sessionId = detail?.sessionId?.trim();
    if (!sessionId) {
      return;
    }

    handler({
      ...detail,
      sessionId,
      workspaceId: detail?.workspaceId?.trim() || null,
    });
  };

  window.addEventListener(TASK_CENTER_OPEN_TASK_EVENT, listener);
  return () => {
    window.removeEventListener(TASK_CENTER_OPEN_TASK_EVENT, listener);
  };
}
