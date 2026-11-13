import { useSyncExternalStore } from "react";

export type TurnNotificationMode = "unfocused" | "always" | "never";

export interface NotificationPreferences {
  turnComplete: TurnNotificationMode;
  permissions: boolean;
  questions: boolean;
  sound: boolean;
}

const STORAGE_KEY = "lime.notifications.preferences.v1";
const DEFAULTS: NotificationPreferences = {
  turnComplete: "unfocused",
  permissions: true,
  questions: true,
  sound: true,
};
let current = read();
const listeners = new Set<() => void>();

function read(): NotificationPreferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
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
      sound:
        typeof parsed.sound === "boolean" ? parsed.sound : DEFAULTS.sound,
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
