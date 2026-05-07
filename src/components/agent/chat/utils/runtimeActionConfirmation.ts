import type { ActionRequired, AgentThreadItem } from "../types";

export const RUNTIME_PERMISSION_CONFIRMATION_REQUEST_PREFIX =
  "runtime_permission_confirmation:";

export const RUNTIME_USER_LOCK_CAPABILITY_REQUEST_PREFIX =
  "runtime_user_lock_capability:";

export function isRuntimeActionConfirmationRequestId(
  requestId?: string | null,
): boolean {
  const normalized = requestId?.trim();
  if (!normalized) {
    return false;
  }

  return (
    normalized.startsWith(RUNTIME_PERMISSION_CONFIRMATION_REQUEST_PREFIX) ||
    normalized.startsWith(RUNTIME_USER_LOCK_CAPABILITY_REQUEST_PREFIX)
  );
}

export function isRuntimeActionConfirmationThreadItem(
  item: AgentThreadItem,
): item is Extract<
  AgentThreadItem,
  { type: "approval_request" | "request_user_input" }
> {
  return (
    (item.type === "approval_request" || item.type === "request_user_input") &&
    isRuntimeActionConfirmationRequestId(item.request_id)
  );
}

export function isRuntimePermissionConfirmationWaitMessage(
  message?: string | null,
): boolean {
  if (!message) {
    return false;
  }

  return (
    message.includes("运行时权限声明需要真实确认") &&
    message.includes("已创建真实权限确认请求")
  );
}

export function isPendingRuntimeActionConfirmation(
  request: Pick<ActionRequired, "requestId" | "status"> | null | undefined,
): boolean {
  return (
    isRuntimeActionConfirmationRequestId(request?.requestId) &&
    request?.status !== "submitted"
  );
}

export function isPendingRuntimeActionConfirmationThreadItem(
  item: AgentThreadItem,
): item is Extract<
  AgentThreadItem,
  { type: "approval_request" | "request_user_input" }
> {
  return (
    isRuntimeActionConfirmationThreadItem(item) && item.status !== "completed"
  );
}

export function isSubmittedRuntimeActionConfirmation(
  request: Pick<ActionRequired, "requestId" | "status"> | null | undefined,
): boolean {
  return (
    isRuntimeActionConfirmationRequestId(request?.requestId) &&
    request?.status === "submitted"
  );
}

export function isSubmittedRuntimeActionConfirmationThreadItem(
  item: AgentThreadItem,
): item is Extract<
  AgentThreadItem,
  { type: "approval_request" | "request_user_input" }
> {
  return (
    isRuntimeActionConfirmationThreadItem(item) && item.status === "completed"
  );
}
