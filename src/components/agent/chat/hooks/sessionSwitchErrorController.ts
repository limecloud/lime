import { isAsterSessionNotFoundError } from "@/lib/asterSessionRecovery";

export type SessionSwitchErrorKind =
  | "session_not_found"
  | "toast_only"
  | "clear_and_toast";

export interface SessionSwitchErrorAction {
  clearCurrentSnapshot: boolean;
  kind: SessionSwitchErrorKind;
  logContext: Record<string, unknown>;
  reloadTopics: boolean;
  showToast: boolean;
  toastMessage: string | null;
}

export function buildSessionSwitchErrorLogContext(params: {
  error: unknown;
  topicId: string;
  workspaceId?: string | null;
}): Record<string, unknown> {
  return {
    error: params.error,
    topicId: params.topicId,
    workspaceId: params.workspaceId,
  };
}

export function buildSessionSwitchErrorToastMessage(error: unknown): string {
  return `加载对话历史失败: ${error instanceof Error ? error.message : String(error)}`;
}

export function resolveSessionSwitchErrorAction(params: {
  error: unknown;
  preserveCurrentSnapshot?: boolean;
  topicId: string;
  workspaceId?: string | null;
}): SessionSwitchErrorAction {
  const logContext = buildSessionSwitchErrorLogContext(params);

  if (isAsterSessionNotFoundError(params.error)) {
    return {
      clearCurrentSnapshot: true,
      kind: "session_not_found",
      logContext,
      reloadTopics: true,
      showToast: false,
      toastMessage: null,
    };
  }

  const clearCurrentSnapshot = !params.preserveCurrentSnapshot;
  return {
    clearCurrentSnapshot,
    kind: clearCurrentSnapshot ? "clear_and_toast" : "toast_only",
    logContext,
    reloadTopics: false,
    showToast: true,
    toastMessage: buildSessionSwitchErrorToastMessage(params.error),
  };
}
