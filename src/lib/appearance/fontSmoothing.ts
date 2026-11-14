import { useSyncExternalStore } from "react";

/**
 * Codex exposes font smoothing only on macOS.  Lime keeps the same preference
 * shape and applies native anti-aliasing through CSS when enabled.
 */
const STORAGE_KEY = "lime.appearance.font-smoothing.v1";
const DEFAULT_ENABLED = true;
let current = read();
const listeners = new Set<() => void>();

function read(): boolean {
  if (typeof window === "undefined") return DEFAULT_ENABLED;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === null ? DEFAULT_ENABLED : value === "true";
  } catch {
    return DEFAULT_ENABLED;
  }
}

function publish() {
  for (const listener of listeners) listener();
}

export function getFontSmoothingEnabled(): boolean {
  return current;
}

export function setFontSmoothingEnabled(enabled: boolean) {
  current = enabled;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // Preference stays in memory.
    }
  }
  publish();
}

export function subscribeFontSmoothing(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFontSmoothingEnabled(): boolean {
  return useSyncExternalStore(
    subscribeFontSmoothing,
    getFontSmoothingEnabled,
    getFontSmoothingEnabled,
  );
}

export function isMacOSPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac/i.test(`${navigator.platform} ${navigator.userAgent}`);
}

export function resetFontSmoothingForTest() {
  setFontSmoothingEnabled(DEFAULT_ENABLED);
}
