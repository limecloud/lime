import { useSyncExternalStore } from "react";

/**
 * Codex exposes a monospace-only code font in its advanced appearance theme.
 * Lime cannot enumerate installed desktop fonts yet, so it offers the stable
 * monospace stacks that exist across macOS and Windows; "System" keeps the
 * platform default that previous Lime versions used.
 */
export type CodeFontFamily =
  | "system"
  | "sf-mono"
  | "menlo"
  | "consolas"
  | "courier";

export const CODE_FONT_FAMILIES: readonly CodeFontFamily[] = [
  "system",
  "sf-mono",
  "menlo",
  "consolas",
  "courier",
];
const STORAGE_KEY = "lime.appearance.code-font-family.v1";
let current = read();
const listeners = new Set<() => void>();

function read(): CodeFontFamily {
  if (typeof window === "undefined") return "system";
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return CODE_FONT_FAMILIES.includes(value as CodeFontFamily)
      ? (value as CodeFontFamily)
      : "system";
  } catch {
    return "system";
  }
}

function publish() {
  for (const listener of listeners) listener();
}

export function getCodeFontFamily(): CodeFontFamily {
  return current;
}

export function setCodeFontFamily(family: CodeFontFamily) {
  if (!CODE_FONT_FAMILIES.includes(family)) return;
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

export function subscribeCodeFontFamily(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCodeFontFamily(): CodeFontFamily {
  return useSyncExternalStore(
    subscribeCodeFontFamily,
    getCodeFontFamily,
    getCodeFontFamily,
  );
}

export function resolveCodeFontFamily(family: CodeFontFamily): string {
  switch (family) {
    case "sf-mono":
      return '"SF Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    case "menlo":
      return 'Menlo, Monaco, Consolas, "Liberation Mono", monospace';
    case "consolas":
      return 'Consolas, "Cascadia Mono", Menlo, Monaco, monospace';
    case "courier":
      return '"Courier New", Courier, monospace';
    default:
      return 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
  }
}

export function resetCodeFontFamilyForTest() {
  setCodeFontFamily("system");
}
