import { atom } from "jotai/vanilla";
import type { BrowserTabState } from "@/lib/api/browserTab";

/** Only UI intent survives a pane remount; page authority is always freshly acquired. */
export function browserAnnotationModeKey(
  sessionId: string | undefined,
  threadId: string | undefined,
  tab: BrowserTabState | null,
): string | null {
  return sessionId && threadId && tab?.threadId === threadId
    ? JSON.stringify([
        sessionId,
        threadId,
        tab.browserSessionId,
        tab.tabId,
        tab.viewId,
        tab.webContentsId,
        tab.ownerWebContentsId,
        tab.windowId,
      ])
    : null;
}

export class BrowserAnnotationModeStore {
  #snapshot = new Set<string>();
  readonly #listeners = new Set<() => void>();
  getSnapshot = () => this.#snapshot;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  set(key: string, enabled: boolean): void {
    if (this.#snapshot.has(key) === enabled) return;
    this.#snapshot = new Set(this.#snapshot);
    if (enabled) this.#snapshot.add(key);
    else this.#snapshot.delete(key);
    for (const listener of this.#listeners) listener();
  }
}

export const browserAnnotationModesAtom = atom(
  new BrowserAnnotationModeStore(),
);
