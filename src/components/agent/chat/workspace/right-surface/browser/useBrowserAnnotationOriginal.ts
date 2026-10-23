import { useCallback, useEffect, useRef, useState } from "react";
import { setBrowserAnnotationOriginal } from "@/lib/api/browserAnnotation";
import type { BrowserTabState } from "@/lib/api/browserTab";

export function useBrowserAnnotationOriginal(
  selected: BrowserTabState | null,
  enabled: boolean,
  onError: (error: unknown) => void,
) {
  const [pressed, setPressed] = useState(false);
  const [failure, setFailure] = useState(false);
  const scope = selected
    ? JSON.stringify([
        selected.browserSessionId,
        selected.threadId,
        selected.tabId,
        selected.viewId,
        selected.ownerWebContentsId,
        selected.webContentsId,
        selected.windowId,
        selected.pageRevision,
        selected.controlOwner,
      ])
    : null;
  const current = useRef({ scope, enabled, onError, mounted: true });
  Object.assign(current.current, { scope, enabled, onError });
  const queue = useRef(Promise.resolve());
  const enqueue = useCallback(
    (tab: BrowserTabState, id: string, original: boolean) => {
      const request = queue.current.then(() =>
        setBrowserAnnotationOriginal(tab, id, original),
      );
      queue.current = request.catch(() => undefined);
      return request;
    },
    [],
  );
  const gesture = useRef<{
    id: string;
    tab: BrowserTabState;
    scope: string;
    failed: boolean;
  } | null>(null);
  const latest = useRef<object | null>(null);
  const stop = useCallback(() => {
    const held = gesture.current;
    if (!held) return;
    gesture.current = null;
    setPressed(false);
    // Start/release pairs stay ordered even across very fast consecutive gestures.
    void enqueue(held.tab, held.id, false).catch((error: unknown) => {
      if (
        !held.failed &&
        latest.current === held &&
        current.current.mounted &&
        current.current.scope === held.scope &&
        current.current.enabled
      ) {
        setFailure(true);
        current.current.onError(error);
      }
    });
  }, [enqueue]);
  useEffect(() => {
    const lifetime = current.current;
    lifetime.mounted = true;
    setPressed(false);
    setFailure(false);
    const hidden = () => {
      if (document.visibilityState === "hidden") stop();
    };
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      lifetime.mounted = false;
      stop();
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [scope, enabled, stop]);
  const start = () => {
    if (!enabled || !selected || !scope || gesture.current) return;
    const held = {
      id: Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-"),
      tab: selected,
      scope,
      failed: false,
    };
    gesture.current = held;
    latest.current = held;
    setPressed(true);
    setFailure(false);
    void enqueue(selected, held.id, true).catch((error: unknown) => {
      held.failed = true;
      if (gesture.current === held) {
        stop();
        if (current.current.mounted && current.current.scope === held.scope) {
          setFailure(true);
          current.current.onError(error);
        }
      }
    });
  };
  return { pressed, failure, start, stop };
}
