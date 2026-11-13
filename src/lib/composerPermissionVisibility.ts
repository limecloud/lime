import { useSyncExternalStore } from "react";

export interface ComposerPermissionVisibility {
  defaultPermission: boolean;
  fullAccess: boolean;
}

const STORAGE_KEY = "lime.composer.permission-visibility.v1";
const DEFAULT_VISIBILITY: ComposerPermissionVisibility = {
  defaultPermission: true,
  fullAccess: true,
};
let current = read();
const listeners = new Set<() => void>();

function read(): ComposerPermissionVisibility {
  if (typeof window === "undefined") return DEFAULT_VISIBILITY;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return DEFAULT_VISIBILITY;
    return {
      defaultPermission:
        typeof parsed.defaultPermission === "boolean"
          ? parsed.defaultPermission
          : true,
      fullAccess:
        typeof parsed.fullAccess === "boolean" ? parsed.fullAccess : true,
    };
  } catch {
    return DEFAULT_VISIBILITY;
  }
}

function publish() {
  for (const listener of listeners) listener();
}

export function getComposerPermissionVisibility(): ComposerPermissionVisibility {
  return current;
}

export function setComposerPermissionVisibility(
  next: Partial<ComposerPermissionVisibility>,
) {
  current = { ...current, ...next };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // Layout preference only; storage failure keeps the in-memory value.
    }
  }
  publish();
}

export function subscribeComposerPermissionVisibility(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useComposerPermissionVisibility(): ComposerPermissionVisibility {
  return useSyncExternalStore(
    subscribeComposerPermissionVisibility,
    getComposerPermissionVisibility,
    getComposerPermissionVisibility,
  );
}

export function resetComposerPermissionVisibilityForTest() {
  current = DEFAULT_VISIBILITY;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  publish();
}
