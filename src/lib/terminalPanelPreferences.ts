import { useSyncExternalStore } from "react";

export type TerminalLocation = "right" | "bottom";

export interface TerminalPanelPreferences {
  location: TerminalLocation;
  showControl: boolean;
}

const STORAGE_KEY = "lime.terminal.panel.v1";
const DEFAULTS: TerminalPanelPreferences = {
  location: "right",
  showControl: true,
};
let current = read();
const listeners = new Set<() => void>();

function read(): TerminalPanelPreferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    return {
      location: parsed?.location === "bottom" ? "bottom" : "right",
      showControl:
        typeof parsed?.showControl === "boolean"
          ? parsed.showControl
          : DEFAULTS.showControl,
    };
  } catch {
    return DEFAULTS;
  }
}

function publish() {
  for (const listener of listeners) listener();
}

export function getTerminalPanelPreferences(): TerminalPanelPreferences {
  return current;
}

export function setTerminalPanelPreferences(
  next: Partial<TerminalPanelPreferences>,
) {
  current = { ...current, ...next };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // Preference stays in memory.
    }
  }
  publish();
}

export function subscribeTerminalPanelPreferences(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTerminalPanelPreferences(): TerminalPanelPreferences {
  return useSyncExternalStore(
    subscribeTerminalPanelPreferences,
    getTerminalPanelPreferences,
    getTerminalPanelPreferences,
  );
}

export function resetTerminalPanelPreferencesForTest() {
  current = DEFAULTS;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  publish();
}
