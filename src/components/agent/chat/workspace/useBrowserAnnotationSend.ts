import { useCallback, useLayoutEffect, useRef } from "react";
import { useAtomValue } from "jotai";
import type { InputbarSendHandler } from "../components/Inputbar/inputbarSendPayload";
import { getInputbarSendOptions } from "../components/Inputbar/inputbarSendPayload";
import { browserAnnotationDraftsAtom } from "./right-surface/browser/browserAnnotationDrafts";
import { submitBrowserAnnotations } from "./right-surface/browser/browserAnnotationSubmission";

export function useBrowserAnnotationSend(
  send: InputbarSendHandler,
  sessionId?: string | null,
  threadId?: string | null,
): InputbarSendHandler {
  const store = useAtomValue(browserAnnotationDraftsAtom);
  const latest = useRef({ send, sessionId, threadId, epoch: 0 });
  useLayoutEffect(() => {
    const previous = latest.current;
    latest.current = {
      send,
      sessionId,
      threadId,
      epoch:
        previous.epoch +
        (previous.sessionId !== sessionId || previous.threadId !== threadId
          ? 1
          : 0),
    };
  }, [send, sessionId, threadId]);
  return useCallback(
    async (payload = {}) => {
      const captured = latest.current;
      const options = getInputbarSendOptions(payload);
      // Other direct submission adapters own their own captured draft batch.
      if (
        !captured.sessionId ||
        !captured.threadId ||
        (options?.skipSceneCommandRouting &&
          payload.browserAnnotationIds === undefined)
      )
        return captured.send(payload);
      return submitBrowserAnnotations({
        store,
        sessionId: captured.sessionId,
        threadId: captured.threadId,
        payload,
        send: captured.send,
        isCurrent: () =>
          latest.current.epoch === captured.epoch &&
          latest.current.sessionId === captured.sessionId &&
          latest.current.threadId === captured.threadId,
      });
    },
    [store],
  );
}
