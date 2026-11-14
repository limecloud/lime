import { useSyncExternalStore } from "react";
import {
  resolveUiFontFamily,
  type UiFontFamily,
} from "./uiFontFamily";

export type ContentFontFamily = UiFontFamily;
export const CONTENT_FONT_FAMILIES: readonly ContentFontFamily[] = [
  "system",
  "sans",
  "serif",
  "mono",
];
const STORAGE_KEY = "lime.appearance.content-font-family.v1";
let current = read();
const listeners = new Set<() => void>();

function read(): ContentFontFamily {
  if (typeof window === "undefined") return "system";
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return CONTENT_FONT_FAMILIES.includes(value as ContentFontFamily)
      ? (value as ContentFontFamily)
      : "system";
  } catch {
    return "system";
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

export function resolveContentFontFamily(family: ContentFontFamily): string {
  return resolveUiFontFamily(family);
}

export function resetContentFontFamilyForTest() {
  setContentFontFamily("system");
}
