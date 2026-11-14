import { useSyncExternalStore } from "react";

export const CONTENT_FONT_SIZES = [12, 14, 16, 18, 20] as const;
export type ContentFontSize = (typeof CONTENT_FONT_SIZES)[number];

const STORAGE_KEY = "lime.appearance.content-font-size.v1";
let current = read();
const listeners = new Set<() => void>();

function read(): ContentFontSize {
  if (typeof window === "undefined") return 14;
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY));
    return CONTENT_FONT_SIZES.includes(value as ContentFontSize)
      ? (value as ContentFontSize)
      : 14;
  } catch {
    return 14;
  }
}

function publish() {
  for (const listener of listeners) listener();
}

export function getContentFontSize(): ContentFontSize {
  return current;
}

export function setContentFontSize(size: ContentFontSize) {
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

export function subscribeContentFontSize(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useContentFontSize(): ContentFontSize {
  return useSyncExternalStore(
    subscribeContentFontSize,
    getContentFontSize,
    getContentFontSize,
  );
}

export function resetContentFontSizeForTest() {
  setContentFontSize(14);
}
