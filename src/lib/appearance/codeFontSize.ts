import { useSyncExternalStore } from "react";

/**
 * Codex's `codeFontSize` setting: integer px, 8..24, default 12.  It controls
 * code blocks and diffs, not the surrounding chat content.
 */
export const CODE_FONT_SIZE_MIN = 8;
export const CODE_FONT_SIZE_MAX = 24;
export const CODE_FONT_SIZE_DEFAULT = 12;
export const CODE_FONT_SIZES: readonly number[] = Array.from(
  { length: CODE_FONT_SIZE_MAX - CODE_FONT_SIZE_MIN + 1 },
  (_, index) => CODE_FONT_SIZE_MIN + index,
);

const STORAGE_KEY = "lime.appearance.code-font-size.v1";
let current = read();
const listeners = new Set<() => void>();

export function isCodeFontSize(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= CODE_FONT_SIZE_MIN &&
    value <= CODE_FONT_SIZE_MAX
  );
}

function read(): number {
  if (typeof window === "undefined") return CODE_FONT_SIZE_DEFAULT;
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY));
    return isCodeFontSize(value) ? value : CODE_FONT_SIZE_DEFAULT;
  } catch {
    return CODE_FONT_SIZE_DEFAULT;
  }
}

function publish() {
  for (const listener of listeners) listener();
}

export function getCodeFontSize(): number {
  return current;
}

export function setCodeFontSize(size: number) {
  if (!isCodeFontSize(size)) return;
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

export function subscribeCodeFontSize(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCodeFontSize(): number {
  return useSyncExternalStore(
    subscribeCodeFontSize,
    getCodeFontSize,
    getCodeFontSize,
  );
}

export function resetCodeFontSizeForTest() {
  setCodeFontSize(CODE_FONT_SIZE_DEFAULT);
}
