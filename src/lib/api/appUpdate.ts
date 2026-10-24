import type { UnlistenFn } from "@/lib/desktop-host/event";
import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import { assertNotDiagnosticFacade } from "./diagnosticFacade";

export const UPDATE_INSTALL_SESSION_EVENT = "app-update://session";

export interface VersionInfo {
  current: string;
  latest?: string;
  hasUpdate: boolean;
  downloadUrl?: string;
  releaseNotes?: string;
  releaseNotesUrl?: string;
  pubDate?: string;
  error?: string;
}

export interface CheckForUpdatesOptions {
  automatic?: boolean;
}

export interface DownloadUpdateResult {
  success: boolean;
  message: string;
  filePath?: string;
}

export type UpdateInstallStage =
  | "idle"
  | "checking"
  | "downloading"
  | "installing"
  | "restarting"
  | "completed"
  | "failed"
  | "up_to_date";

export interface UpdateInstallSession {
  sessionId: string;
  stage: UpdateInstallStage;
  currentVersion: string;
  latestVersion?: string | null;
  downloadUrl?: string | null;
  downloadedBytes: number;
  totalBytes?: number | null;
  percent: number;
  message: string;
  error?: string | null;
  startedAt: number;
  updatedAt: number;
  completedAt?: number | null;
  canCloseWindow: boolean;
  isActive: boolean;
}

export interface UpdateCheckConfig {
  enabled: boolean;
  check_interval_hours: number;
  show_notification: boolean;
  last_check_timestamp: number;
  skipped_version: string | null;
  remind_later_until: number | null;
}

export interface UpdateNotificationAnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function checkForUpdates(
  options?: CheckForUpdatesOptions,
): Promise<VersionInfo> {
  return invokeUpdateCommand<VersionInfo>(
    "check_for_updates",
    options?.automatic ? { automatic: true } : undefined,
    assertVersionInfo,
  );
}

export async function downloadUpdate(): Promise<DownloadUpdateResult> {
  return invokeUpdateCommand<DownloadUpdateResult>(
    "download_update",
    undefined,
    assertDownloadUpdateResult,
  );
}

export async function startUpdateInstallSession(): Promise<UpdateInstallSession> {
  return invokeUpdateCommand<UpdateInstallSession>(
    "start_update_install_session",
    undefined,
    assertUpdateInstallSession,
  );
}

export async function getUpdateInstallSession(): Promise<UpdateInstallSession> {
  return invokeUpdateCommand<UpdateInstallSession>(
    "get_update_install_session",
    undefined,
    assertUpdateInstallSession,
  );
}

export async function listenUpdateInstallSession(
  handler: (session: UpdateInstallSession) => void,
): Promise<UnlistenFn> {
  return safeListen<UpdateInstallSession>(
    UPDATE_INSTALL_SESSION_EVENT,
    ({ payload }) => handler(payload),
  );
}

export function isUpdateInstallSessionActive(
  session: Pick<UpdateInstallSession, "stage" | "isActive"> | null | undefined,
): boolean {
  if (!session?.isActive) {
    return false;
  }

  return (
    session.stage === "checking" ||
    session.stage === "downloading" ||
    session.stage === "installing" ||
    session.stage === "restarting"
  );
}

export async function getUpdateCheckSettings(): Promise<UpdateCheckConfig> {
  return invokeUpdateCommand<UpdateCheckConfig>(
    "get_update_check_settings",
    undefined,
    assertUpdateCheckConfig,
  );
}

export async function openUpdateWindow(
  anchorRect?: UpdateNotificationAnchorRect | null,
): Promise<void> {
  const request = normalizeUpdateNotificationAnchorRect(anchorRect);
  if (!request) {
    await invokeUpdateCommand("open_update_window");
    return;
  }

  await invokeUpdateCommand("open_update_window", { anchorRect: request });
}

export async function closeUpdateWindow(): Promise<void> {
  await invokeUpdateCommand("close_update_window");
}

export async function dismissUpdateNotification(
  version?: string | null,
): Promise<number> {
  return invokeUpdateCommand<number>(
    "dismiss_update_notification",
    {
      version: version ?? null,
    },
    assertNumberResult,
  );
}

export async function recordUpdateNotificationAction(
  action: string,
): Promise<void> {
  await invokeUpdateCommand("record_update_notification_action", { action });
}

export async function remindUpdateLater(hours: number): Promise<number> {
  return invokeUpdateCommand<number>(
    "remind_update_later",
    { hours },
    assertNumberResult,
  );
}

export async function skipUpdateVersion(version: string): Promise<void> {
  await invokeUpdateCommand("skip_update_version", { version });
}

async function invokeUpdateCommand<T = void>(
  command: string,
  args?: Record<string, unknown>,
  validate?: (command: string, value: unknown) => void,
): Promise<T> {
  const result =
    args === undefined
      ? await safeInvoke<unknown>(command)
      : await safeInvoke<unknown>(command, args);
  assertNotDiagnosticFacade(command, result, "真实 updater current 通道");
  if (validate) {
    validate(command, result);
  } else {
    assertVoidResult(command, result);
  }
  return result as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertVersionInfo(
  command: string,
  value: unknown,
): asserts value is VersionInfo {
  if (
    !isRecord(value) ||
    typeof value.current !== "string" ||
    typeof value.hasUpdate !== "boolean"
  ) {
    throw new Error(`${command} did not return version info`);
  }
}

function assertDownloadUpdateResult(
  command: string,
  value: unknown,
): asserts value is DownloadUpdateResult {
  if (
    !isRecord(value) ||
    typeof value.success !== "boolean" ||
    typeof value.message !== "string"
  ) {
    throw new Error(`${command} did not return a download result`);
  }
}

function assertUpdateInstallSession(
  command: string,
  value: unknown,
): asserts value is UpdateInstallSession {
  if (
    !isRecord(value) ||
    typeof value.sessionId !== "string" ||
    typeof value.stage !== "string" ||
    typeof value.currentVersion !== "string" ||
    typeof value.downloadedBytes !== "number" ||
    typeof value.percent !== "number" ||
    typeof value.message !== "string" ||
    typeof value.startedAt !== "number" ||
    typeof value.updatedAt !== "number" ||
    typeof value.canCloseWindow !== "boolean" ||
    typeof value.isActive !== "boolean"
  ) {
    throw new Error(`${command} did not return an update install session`);
  }
}

function assertUpdateCheckConfig(
  command: string,
  value: unknown,
): asserts value is UpdateCheckConfig {
  if (
    !isRecord(value) ||
    typeof value.enabled !== "boolean" ||
    typeof value.check_interval_hours !== "number" ||
    typeof value.show_notification !== "boolean" ||
    typeof value.last_check_timestamp !== "number"
  ) {
    throw new Error(`${command} did not return update check settings`);
  }
}

function assertNumberResult(
  command: string,
  value: unknown,
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${command} did not return a finite number`);
  }
}

function assertVoidResult(command: string, value: unknown): void {
  if (value !== null && value !== undefined) {
    throw new Error(`${command} did not return void result`);
  }
}

function normalizeUpdateNotificationAnchorRect(
  anchorRect: UpdateNotificationAnchorRect | null | undefined,
): UpdateNotificationAnchorRect | null {
  if (
    !anchorRect ||
    !Number.isFinite(anchorRect.x) ||
    !Number.isFinite(anchorRect.y) ||
    !Number.isFinite(anchorRect.width) ||
    !Number.isFinite(anchorRect.height) ||
    anchorRect.width <= 0 ||
    anchorRect.height <= 0
  ) {
    return null;
  }

  return {
    x: Math.round(anchorRect.x),
    y: Math.round(anchorRect.y),
    width: Math.round(anchorRect.width),
    height: Math.round(anchorRect.height),
  };
}
