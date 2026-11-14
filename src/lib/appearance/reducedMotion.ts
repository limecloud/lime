import { useSyncExternalStore } from "react";

/**
 * Codex stores `reduced-motion-preference` as `system | on | off` and writes
 * the resolved value to `data-reduced-motion` on the document element.  An
 * absent attribute means "follow the operating system".
 */
export type ReducedMotionPreference = "system" | "on" | "off";

export const REDUCED_MOTION_PREFERENCES: readonly ReducedMotionPreference[] = [
  "system",
  "on",
  "off",
];

const STORAGE_KEY = "lime.appearance.reduced-motion.v1";
const DEFAULT_PREFERENCE: ReducedMotionPreference = "system";
let current = read();
const listeners = new Set<() => void>();

function read(): ReducedMotionPreference {
  if (typeof window === "undefined") return DEFAULT_PREFERENCE;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return REDUCED_MOTION_PREFERENCES.includes(value as ReducedMotionPreference)
      ? (value as ReducedMotionPreference)
      : DEFAULT_PREFERENCE;
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

function publish() {
  for (const listener of listeners) listener();
}

export function getReducedMotionPreference(): ReducedMotionPreference {
  return current;
}

export function setReducedMotionPreference(
  preference: ReducedMotionPreference,
) {
  if (!REDUCED_MOTION_PREFERENCES.includes(preference)) return;
  current = preference;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Preference stays in memory.
    }
  }
  publish();
}

export function subscribeReducedMotion(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReducedMotionPreference(): ReducedMotionPreference {
  return useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionPreference,
    getReducedMotionPreference,
  );
}

export function resetReducedMotionForTest() {
  setReducedMotionPreference(DEFAULT_PREFERENCE);
}

/**
 * Resolve a preference to the boolean stored in `data-reduced-motion`.
 * `system` intentionally has no attribute so CSS media queries and native
 * system settings keep ownership.
 */
export function resolveReducedMotionAttribute(
  preference: ReducedMotionPreference,
): "true" | "false" | null {
  if (preference === "on") return "true";
  if (preference === "off") return "false";
  return null;
}

export function isReducedMotionPreferred(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  const preference = getReducedMotionPreference();
  if (preference === "on") return true;
  if (preference === "off") return false;
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
}
