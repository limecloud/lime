import { useSyncExternalStore } from "react";
import type { AccentColor } from "./accent";

export interface SeparateAccentPreferences {
  enabled: boolean;
  light: AccentColor;
  dark: AccentColor;
}
const STORAGE_KEY = "lime.appearance.separate-accent.v1";
const DEFAULTS: SeparateAccentPreferences = {
  enabled: false,
  light: "default",
  dark: "default",
};
let current = read();
const listeners = new Set<() => void>();

function read(): SeparateAccentPreferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    return {
      enabled: parsed?.enabled === true,
      light: parsed?.light ?? "default",
      dark: parsed?.dark ?? "default",
    };
  } catch {
    return DEFAULTS;
  }
}
function publish() {
  for (const listener of listeners) listener();
}
export function getSeparateAccentPreferences() {
  return current;
}
export function setSeparateAccentPreferences(
  next: Partial<SeparateAccentPreferences>,
) {
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
export function subscribeSeparateAccent(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function useSeparateAccentPreferences() {
  return useSyncExternalStore(
    subscribeSeparateAccent,
    getSeparateAccentPreferences,
    getSeparateAccentPreferences,
  );
}
export function resetSeparateAccentForTest() {
  setSeparateAccentPreferences(DEFAULTS);
}
