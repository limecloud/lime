import { useSyncExternalStore } from "react";

export type AutoArchiveDays = 0 | 7 | 30 | 90;

export interface AutoArchivePreference {
  days: AutoArchiveDays;
  lastRunAt: number | null;
}

const STORAGE_KEY = "lime.chat.auto-archive.v1";
const DEFAULTS: AutoArchivePreference = { days: 0, lastRunAt: null };
let current = read();
const listeners = new Set<() => void>();

function read(): AutoArchivePreference {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return DEFAULTS;
    return {
      days: [0, 7, 30, 90].includes(parsed.days) ? parsed.days : 0,
      lastRunAt:
        typeof parsed.lastRunAt === "number" && Number.isFinite(parsed.lastRunAt)
          ? parsed.lastRunAt
          : null,
    };
  } catch {
    return DEFAULTS;
  }
}

function publish() {
  for (const listener of listeners) listener();
}

export function getAutoArchivePreference(): AutoArchivePreference {
  return current;
}

export function setAutoArchivePreference(next: Partial<AutoArchivePreference>) {
  current = { ...current, ...next };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // Preference stays in memory if storage is unavailable.
    }
  }
  publish();
}

export function subscribeAutoArchivePreference(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAutoArchivePreference(): AutoArchivePreference {
  return useSyncExternalStore(
    subscribeAutoArchivePreference,
    getAutoArchivePreference,
    getAutoArchivePreference,
  );
}

export function resetAutoArchivePreferenceForTest() {
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
