import { useSyncExternalStore } from "react";
import {
  getUiFontFamily,
  resolveUiFontFamily,
  type UiFontFamily,
} from "./uiFontFamily";

/**
 * Codex content font: `ui` means "Same as UI font" and follows UI font
 * changes; the remaining values are explicit font stacks.
 */
export type ContentFontFamily = "ui" | UiFontFamily;
export const CONTENT_FONT_FAMILIES: readonly ContentFontFamily[] = [
  "ui",
  "system",
  "sans",
  "serif",
  "mono",
];
const STORAGE_KEY = "lime.appearance.content-font-family.v1";
let current = read();
const listeners = new Set<() => void>();

function read(): ContentFontFamily {
  if (typeof window === "undefined") return "ui";
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return CONTENT_FONT_FAMILIES.includes(value as ContentFontFamily)
      ? (value as ContentFontFamily)
      : "ui";
  } catch {
    return "ui";
  }
}

function publish() {
  for (const listener of listeners) listener();
}

export function getContentFontFamily(): ContentFontFamily {
  return current;
}

export function setContentFontFamily(family: ContentFontFamily) {
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

export function subscribeContentFontFamily(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useContentFontFamily(): ContentFontFamily {
  return useSyncExternalStore(
    subscribeContentFontFamily,
    getContentFontFamily,
    getContentFontFamily,
  );
}

export function resolveContentFontFamily(
  family: ContentFontFamily,
  uiFamily: UiFontFamily = getUiFontFamily(),
): string {
  if (family === "ui") {
    return resolveUiFontFamily(uiFamily);
  }
  return resolveUiFontFamily(family);
}

export function resetContentFontFamilyForTest() {
  setContentFontFamily("ui");
}
