import { useMemo, useSyncExternalStore } from "react";
import { useAtomValue } from "jotai";
import {
  browserAnnotationDraftsAtom,
  hasBrowserAnnotationContent,
  type BrowserAnnotationDraft,
} from "./browserAnnotationDrafts";

export function useBrowserAnnotationDrafts(
  sessionId?: string | null,
  threadId?: string | null,
) {
  const store = useAtomValue(browserAnnotationDraftsAtom);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const drafts = useMemo<readonly BrowserAnnotationDraft[]>(
    () =>
      snapshot.filter(
        (draft) =>
          Boolean(sessionId && threadId) &&
          draft.sessionId === sessionId &&
          draft.event.threadId === threadId &&
          hasBrowserAnnotationContent(draft),
      ),
    [sessionId, snapshot, threadId],
  );
  return {
    store,
    drafts,
    hasContent: drafts.length > 0,
    pending: drafts.some((draft) => draft.pending),
  };
}
