import { safeInvoke } from "@/lib/dev-bridge";
import { assertNotDiagnosticFacade } from "./diagnosticFacade";

export type DesktopNotificationStatus = "failed" | "sent" | "unsupported";

export interface DesktopNotificationRequest {
  body: string;
  silent?: boolean;
  sound?: string;
  tag?: string;
  title: string;
}

export interface DesktopNotificationResult {
  reason?: string;
  status: DesktopNotificationStatus;
}

function isDesktopNotificationResult(
  value: unknown,
): value is DesktopNotificationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const status = (value as { status?: unknown }).status;
  const reason = (value as { reason?: unknown }).reason;
  return (
    (status === "failed" || status === "sent" || status === "unsupported") &&
    (reason === undefined || typeof reason === "string")
  );
}

export async function showDesktopNotification(
  request: DesktopNotificationRequest,
): Promise<DesktopNotificationResult> {
  const result = await safeInvoke<unknown>("show_desktop_notification", {
    request,
  });
  assertNotDiagnosticFacade(
    "show_desktop_notification",
    result,
    "真实桌面通知 Electron Host current 通道",
  );
  if (!isDesktopNotificationResult(result)) {
    throw new Error(
      "show_desktop_notification did not return desktop notification result",
    );
  }
  return result;
}
