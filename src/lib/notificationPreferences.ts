import { useSyncExternalStore } from "react";

export type TurnNotificationMode = "unfocused" | "always" | "never";
export type NotificationSound =
  | "default"
  | "classic"
  | "none"
  | "Basso"
  | "Glass"
  | "Ping"
  | "Pop"
  | "Purr"
  | "Tink";
export type NotificationSoundChoice = NotificationSound | "custom";
export const NOTIFICATION_SOUNDS: readonly NotificationSound[] = [
  "default",
  "classic",
  "none",
  "Basso",
  "Glass",
  "Ping",
  "Pop",
  "Purr",
  "Tink",
];

export interface NotificationPreferences {
  turnComplete: TurnNotificationMode;
  permissions: boolean;
  questions: boolean;
  sound: NotificationSoundChoice;
}

const STORAGE_KEY = "lime.notifications.preferences.v1";
const DEFAULTS: NotificationPreferences = {
  turnComplete: "unfocused",
  permissions: true,
  questions: true,
  sound: "default",
};

function readSound(value: unknown): NotificationSoundChoice {
  // 旧版本把提示音存为布尔值，读取时迁移到 default / none。
  if (typeof value === "boolean") return value ? "default" : "none";
  if (value === "custom") return "custom";
  return typeof value === "string" &&
    (NOTIFICATION_SOUNDS as readonly string[]).includes(value)
    ? (value as NotificationSound)
    : DEFAULTS.sound;
}

export function notificationSoundRequest(sound: NotificationSoundChoice): {
  silent?: boolean;
  sound?: string;
} {
  if (sound === "none") return { silent: true };
  // 自定义/经典提示音由渲染端播放，系统通知保持静音。
  if (sound === "custom" || sound === "classic") return { silent: true };
  if (sound === "default") return {};
  return { sound };
}
let current = read();
const listeners = new Set<() => void>();

function read(): NotificationPreferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "null",
    );
    if (!parsed || typeof parsed !== "object") return DEFAULTS;
    return {
      turnComplete: ["unfocused", "always", "never"].includes(
        parsed.turnComplete,
      )
        ? parsed.turnComplete
        : DEFAULTS.turnComplete,
      permissions:
        typeof parsed.permissions === "boolean"
          ? parsed.permissions
          : DEFAULTS.permissions,
      questions:
        typeof parsed.questions === "boolean"
          ? parsed.questions
          : DEFAULTS.questions,
      sound: readSound(parsed.sound),
    };
  } catch {
    return DEFAULTS;
  }
}

function publish() {
  for (const listener of listeners) listener();
}

export function getNotificationPreferences(): NotificationPreferences {
  return current;
}

export function setNotificationPreferences(
  next: Partial<NotificationPreferences>,
) {
  current = { ...current, ...next };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // Preferences stay in memory if storage is unavailable.
    }
  }
  publish();
}

export function subscribeNotificationPreferences(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNotificationPreferences(): NotificationPreferences {
  return useSyncExternalStore(
    subscribeNotificationPreferences,
    getNotificationPreferences,
    getNotificationPreferences,
  );
}

export function resetNotificationPreferencesForTest() {
  current = DEFAULTS;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  publish();
}
