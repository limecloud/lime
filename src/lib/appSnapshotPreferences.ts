import { useSyncExternalStore } from "react";

export type AppSnapshotDestination = "automatic" | "lastChat" | "newChat";

export interface AppSnapshotPreferences {
  enabled: boolean;
  soundEnabled: boolean;
  hotkeyEnabled: boolean;
  destination: AppSnapshotDestination;
}

const DESTINATIONS: readonly AppSnapshotDestination[] = [
  "automatic",
  "lastChat",
  "newChat",
];

const STORAGE_KEY = "lime.app-snapshots.preferences.v1";
const DEFAULTS: AppSnapshotPreferences = {
  enabled: false,
  soundEnabled: true,
  hotkeyEnabled: false,
  destination: "automatic",
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
      enabled:
        typeof parsed?.enabled === "boolean"
          ? parsed.enabled
          : DEFAULTS.enabled,
      soundEnabled:
        typeof parsed?.soundEnabled === "boolean"
          ? parsed.soundEnabled
          : DEFAULTS.soundEnabled,
      hotkeyEnabled:
        typeof parsed?.hotkeyEnabled === "boolean"
          ? parsed.hotkeyEnabled
          : DEFAULTS.hotkeyEnabled,
      destination: DESTINATIONS.includes(parsed?.destination)
        ? parsed.destination
        : DEFAULTS.destination,
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
