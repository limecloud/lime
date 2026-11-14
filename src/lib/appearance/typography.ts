import { useSyncExternalStore } from "react";

// Codex Pages content font size: integer px, 12..24, default 15.
export const CONTENT_FONT_SIZES = [
  12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
] as const;
export type ContentFontSize = (typeof CONTENT_FONT_SIZES)[number];

const STORAGE_KEY = "lime.appearance.content-font-size.v1";
let current = read();
const listeners = new Set<() => void>();

function read(): ContentFontSize {
  if (typeof window === "undefined") return 15;
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY));
    return CONTENT_FONT_SIZES.includes(value as ContentFontSize)
      ? (value as ContentFontSize)
      : 15;
  } catch {
    return 15;
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
  setContentFontSize(15);
}
