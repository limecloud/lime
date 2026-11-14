import { useSyncExternalStore } from "react";

export interface AppSnapshotPreferences {
  soundEnabled: boolean;
  hotkeyEnabled: boolean;
}

const STORAGE_KEY = "lime.app-snapshots.preferences.v1";
const DEFAULTS: AppSnapshotPreferences = {
  soundEnabled: true,
  hotkeyEnabled: false,
};
let current = read();
const listeners = new Set<() => void>();

function read(): AppSnapshotPreferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "null",
    );
    return {
      soundEnabled:
        typeof parsed?.soundEnabled === "boolean"
          ? parsed.soundEnabled
          : DEFAULTS.soundEnabled,
      hotkeyEnabled:
        typeof parsed?.hotkeyEnabled === "boolean"
          ? parsed.hotkeyEnabled
          : DEFAULTS.hotkeyEnabled,
    };
  } catch {
    return DEFAULTS;
  }
}

function publish() {
  for (const listener of listeners) listener();
}

export function getAppSnapshotPreferences(): AppSnapshotPreferences {
  return current;
}

export function setAppSnapshotPreferences(
  next: Partial<AppSnapshotPreferences>,
): void {
  current = { ...current, ...next };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // ignore
    }
  }
  publish();
}

export function useAppSnapshotPreferences(): AppSnapshotPreferences {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getAppSnapshotPreferences,
    getAppSnapshotPreferences,
  );
}

export function resetAppSnapshotPreferencesForTest(): void {
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
