import { useSyncExternalStore } from "react";

const STORAGE_KEY = "lime.appearance.smart-punctuation.v1";
let current = read();
const listeners = new Set<() => void>();

function read(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function publish() {
  for (const listener of listeners) listener();
}

export function getSmartPunctuationEnabled(): boolean {
  return current;
}

export function setSmartPunctuationEnabled(enabled: boolean) {
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

export function subscribeSmartPunctuation(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSmartPunctuationEnabled(): boolean {
  return useSyncExternalStore(
    subscribeSmartPunctuation,
    getSmartPunctuationEnabled,
    getSmartPunctuationEnabled,
  );
}

export function applySmartPunctuation(text: string): string {
  return text
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/\.\.\./g, "…")
    .replace(/(\d)\s*x\s*(\d)/g, "$1 × $2")
    .replace(/(\d)\s*-\s*(\d)/g, "$1 – $2")
    .replace(/"([^"\n]+)"/g, "“$1”")
    .replace(/'([^'\n]+)'/g, "‘$1’")
    .replace(/<->/g, "↔")
    .replace(/->/g, "→")
    .replace(/<-/g, "←");
}

export function resetSmartPunctuationForTest() {
  setSmartPunctuationEnabled(false);
}
