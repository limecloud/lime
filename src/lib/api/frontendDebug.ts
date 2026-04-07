import { isDevBridgeAvailable, safeInvoke } from "@/lib/dev-bridge";

export interface FrontendDebugLogReport {
  message: string;
  level?: "debug" | "info" | "warn" | "error";
  category?: string;
  context?: unknown;
}

export async function reportFrontendDebugLog(
  report: FrontendDebugLogReport,
): Promise<void> {
  // 浏览器 dev shell 仅保留本地 console 调试，不再占用 DevBridge 主链。
  if (isDevBridgeAvailable()) {
    return;
  }
  await safeInvoke("report_frontend_debug_log", { report });
}
