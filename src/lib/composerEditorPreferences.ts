import { useSyncExternalStore } from "react";

export type FollowUpMode = "queue" | "steer";

export interface ComposerEditorPreferences {
  plainTextEditor: boolean;
  followUpMode: FollowUpMode;
  defaultStandaloneChat: boolean;
  showContextWindowUsage: boolean;
}

const STORAGE_KEY = "lime.composer.editor-preferences.v1";
const DEFAULTS: ComposerEditorPreferences = {
  plainTextEditor: false,
  followUpMode: "queue",
  defaultStandaloneChat: true,
  showContextWindowUsage: true,
};
let current = read();
const listeners = new Set<() => void>();

function read(): ComposerEditorPreferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    return {
      plainTextEditor:
        typeof parsed?.plainTextEditor === "boolean"
          ? parsed.plainTextEditor
          : DEFAULTS.plainTextEditor,
      followUpMode:
        parsed?.followUpMode === "queue" || parsed?.followUpMode === "steer"
          ? parsed.followUpMode
          : DEFAULTS.followUpMode,
      defaultStandaloneChat:
        typeof parsed?.defaultStandaloneChat === "boolean"
          ? parsed.defaultStandaloneChat
          : DEFAULTS.defaultStandaloneChat,
      showContextWindowUsage:
        typeof parsed?.showContextWindowUsage === "boolean"
          ? parsed.showContextWindowUsage
          : DEFAULTS.showContextWindowUsage,
    };
  } catch {
    return DEFAULTS;
  }
}

function publish() {
  for (const listener of listeners) listener();
}

export function getComposerEditorPreferences() {
  return current;
}

export function setComposerEditorPreferences(
  next: Partial<ComposerEditorPreferences>,
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

export function subscribeComposerEditorPreferences(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useComposerEditorPreferences() {
  return useSyncExternalStore(
    subscribeComposerEditorPreferences,
    getComposerEditorPreferences,
    getComposerEditorPreferences,
  );
}

export function resetComposerEditorPreferencesForTest() {
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
