import { safeInvoke } from "@/lib/dev-bridge";

export interface VersionInfo {
  current: string;
  latest?: string;
  hasUpdate: boolean;
  downloadUrl?: string;
  releaseNotes?: string;
  pubDate?: string;
  error?: string;
}

export interface DownloadUpdateResult {
  success: boolean;
  message: string;
  filePath?: string;
}

export interface UpdateCheckConfig {
  enabled: boolean;
  check_interval_hours: number;
  show_notification: boolean;
  last_check_timestamp: number;
  skipped_version: string | null;
  remind_later_until: number | null;
}

export interface UpdateNotificationMetrics {
  shown_count: number;
  update_now_count: number;
  remind_later_count: number;
  skip_version_count: number;
  dismiss_count: number;
  update_now_rate: number;
  remind_later_rate: number;
  skip_version_rate: number;
  dismiss_rate: number;
}

export async function checkForUpdates(): Promise<VersionInfo> {
  return safeInvoke<VersionInfo>("check_for_updates");
}

export async function downloadUpdate(): Promise<DownloadUpdateResult> {
  return safeInvoke<DownloadUpdateResult>("download_update");
}

export async function getUpdateCheckSettings(): Promise<UpdateCheckConfig> {
  return safeInvoke<UpdateCheckConfig>("get_update_check_settings");
}

export async function setUpdateCheckSettings(
  settings: UpdateCheckConfig,
): Promise<void> {
  await safeInvoke("set_update_check_settings", { settings });
}

export async function getUpdateNotificationMetrics(): Promise<UpdateNotificationMetrics> {
  return safeInvoke<UpdateNotificationMetrics>(
    "get_update_notification_metrics",
  );
}

export async function testUpdateWindow(): Promise<void> {
  await safeInvoke("test_update_window");
}

export async function closeUpdateWindow(): Promise<void> {
  await safeInvoke("close_update_window");
}

export async function dismissUpdateNotification(
  version?: string | null,
): Promise<number> {
  return safeInvoke<number>("dismiss_update_notification", {
    version: version ?? null,
  });
}

export async function recordUpdateNotificationAction(
  action: string,
): Promise<void> {
  await safeInvoke("record_update_notification_action", { action });
}

export async function remindUpdateLater(hours: number): Promise<number> {
  return safeInvoke<number>("remind_update_later", { hours });
}

export async function skipUpdateVersion(version: string): Promise<void> {
  await safeInvoke("skip_update_version", { version });
}
