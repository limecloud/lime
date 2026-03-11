import { safeInvoke } from "@/lib/dev-bridge";

export interface ShowNotificationRequest {
  title: string;
  body: string;
  icon?: string;
}

export async function showSystemNotification(
  request: ShowNotificationRequest,
): Promise<void> {
  await safeInvoke("show_notification", request);
}
