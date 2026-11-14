import { useSyncExternalStore } from "react";

export type UiFontFamily = "system" | "sans" | "serif" | "mono";
export const UI_FONT_FAMILIES: readonly UiFontFamily[] = [
  "system",
  "sans",
  "serif",
  "mono",
];
const STORAGE_KEY = "lime.appearance.ui-font-family.v1";
let current = read();
const listeners = new Set<() => void>();

function read(): UiFontFamily {
  if (typeof window === "undefined") return "system";
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return UI_FONT_FAMILIES.includes(value as UiFontFamily)
      ? (value as UiFontFamily)
      : "system";
  } catch {
    return "system";
  }
}

function publish() {
  for (const listener of listeners) listener();
}

export function getUiFontFamily(): UiFontFamily {
  return current;
}

export function setUiFontFamily(family: UiFontFamily) {
  current = family;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, family);
    } catch {
      // Preference stays in memory.
    }
  }
  publish();
}

export function subscribeUiFontFamily(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUiFontFamily(): UiFontFamily {
  return useSyncExternalStore(
    subscribeUiFontFamily,
    getUiFontFamily,
    getUiFontFamily,
  );
}

export function resolveUiFontFamily(family: UiFontFamily): string {
  switch (family) {
    case "sans":
      return 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
    case "serif":
      return 'ui-serif, Georgia, Cambria, "Times New Roman", serif';
    case "mono":
      return "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    default:
      return 'system-ui, -apple-system, "Segoe UI", sans-serif';
  }
}

export function resetUiFontFamilyForTest() {
  setUiFontFamily("system");
}
