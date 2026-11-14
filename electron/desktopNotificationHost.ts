import { Notification } from "./electronRuntime";
import type { NotificationConstructorOptions } from "./electronRuntime";

type HostArgs = Record<string, unknown> | null | undefined;

export type DesktopNotificationStatus = "failed" | "sent" | "unsupported";

export interface DesktopNotificationResult {
  reason?: string;
  status: DesktopNotificationStatus;
}

const DESKTOP_NOTIFICATION_ALLOWED_FIELDS = new Set([
  "body",
  "silent",
  "sound",
  "tag",
  "title",
]);
const DESKTOP_NOTIFICATION_SOUNDS = new Set([
  "Basso",
  "Glass",
  "Ping",
  "Pop",
  "Purr",
  "Tink",
]);
const DESKTOP_NOTIFICATION_TITLE_LIMIT = 120;
const DESKTOP_NOTIFICATION_BODY_LIMIT = 320;
const DESKTOP_NOTIFICATION_TAG_LIMIT = 120;

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readRequest(value: unknown): Record<string, unknown> {
  const record = toRecord(value);
  const request = toRecord(record?.request);
  return request ?? record ?? {};
}

function normalizeText(value: unknown, field: string, limit: number): string {
  if (typeof value !== "string") {
    throw new Error(`桌面通知缺少 ${field}`);
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    throw new Error(`桌面通知缺少 ${field}`);
  }
  return normalized.slice(0, limit);
}

function normalizeTag(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value
    .replace(/[^a-zA-Z0-9:_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, DESKTOP_NOTIFICATION_TAG_LIMIT);
  return normalized || undefined;
}

function normalizeSilent(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function normalizeSound(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (!DESKTOP_NOTIFICATION_SOUNDS.has(value)) {
    throw new Error(`桌面通知包含不支持的提示音: ${value}`);
  }
  return value;
}

function assertAllowedFields(request: Record<string, unknown>): void {
  const extraFields = Object.keys(request).filter(
    (key) => !DESKTOP_NOTIFICATION_ALLOWED_FIELDS.has(key),
  );
  if (extraFields.length > 0) {
    throw new Error(
      `桌面通知请求包含不支持字段: ${extraFields.sort().join(", ")}`,
    );
  }
}

function normalizeDesktopNotificationOptions(
  args: HostArgs,
): NotificationConstructorOptions {
  const request = readRequest(args);
  assertAllowedFields(request);
  const title = normalizeText(
    request.title,
    "title",
    DESKTOP_NOTIFICATION_TITLE_LIMIT,
  );
  const body = normalizeText(
    request.body,
    "body",
    DESKTOP_NOTIFICATION_BODY_LIMIT,
  );
  const id = normalizeTag(request.tag);
  const sound = normalizeSound(request.sound);
  return {
    body,
    ...(id ? { id } : {}),
    silent: normalizeSilent(request.silent),
    ...(sound ? { sound } : {}),
    title,
  };
}

export function showDesktopNotification(
  args: HostArgs,
): DesktopNotificationResult {
  if (!Notification.isSupported()) {
    return {
      reason: "electron_notification_unsupported",
      status: "unsupported",
    };
  }

  const options = normalizeDesktopNotificationOptions(args);
  try {
    new Notification(options).show();
    return { status: "sent" };
  } catch (error) {
    return {
      reason: error instanceof Error ? error.message : String(error),
      status: "failed",
    };
  }
}
