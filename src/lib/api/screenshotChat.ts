import { safeInvoke } from "@/lib/dev-bridge";

export interface SendScreenshotChatParams {
  message: string;
  imagePath?: string | null;
}

export async function sendScreenshotChat(
  params: SendScreenshotChatParams,
): Promise<void> {
  await safeInvoke(
    "send_screenshot_chat",
    params as unknown as Record<string, unknown>,
  );
}

export async function closeScreenshotChatWindow(): Promise<void> {
  await safeInvoke("close_screenshot_chat_window");
}
