import { notificationService } from "@/lib/notificationService";

export interface ShowNotificationRequest {
  title: string;
  body: string;
  icon?: string;
}

export async function showSystemNotification(
  request: ShowNotificationRequest,
): Promise<void> {
  await notificationService.notify({
    title: request.title,
    body: request.body,
    type: "info",
  });
}
