import { useSyncExternalStore } from "react";

export const UI_FONT_SIZES = [12, 13, 14, 15, 16] as const;
export type UiFontSize = (typeof UI_FONT_SIZES)[number];

const STORAGE_KEY = "lime.appearance.ui-font-size.v1";
let current = read();
const listeners = new Set<() => void>();

function read(): UiFontSize {
  if (typeof window === "undefined") return 14;
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY));
    return UI_FONT_SIZES.includes(value as UiFontSize)
      ? (value as UiFontSize)
      : 14;
  } catch {
    return 14;
  }
}

function publish() {
  for (const listener of listeners) listener();
}

export function getUiFontSize(): UiFontSize {
  return current;
}

export function setUiFontSize(size: UiFontSize) {
  current = size;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(size));
    } catch {
      // Preference stays in memory.
    }
  }
  publish();
}

export function subscribeUiFontSize(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUiFontSize(): UiFontSize {
  return useSyncExternalStore(subscribeUiFontSize, getUiFontSize, getUiFontSize);
}

export function resetUiFontSizeForTest() {
  setUiFontSize(14);
}
