import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { atom, useAtom, useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { setBrowserAnnotationMarkers } from "@/lib/api/browserAnnotation";
import type { BrowserTabState } from "@/lib/api/browserTab";
import { isRuntimeSubmissionAccepted } from "../../../hooks/agentSendResult";
import { useBrowserAnnotationRuntime } from "./BrowserAnnotationContext";
import {
  browserAnnotationDraftsAtom,
  hasBrowserAnnotationContent,
  type BrowserAnnotationDraft,
} from "./browserAnnotationDrafts";
import { browserAnnotationModeKey } from "./browserAnnotationMode";
import { matchesBrowserTabEvent } from "./browserTabEventIdentity";
import { useBrowserNativeMenu } from "./useBrowserNativeMenu";

const markerPreferencesAtom = atom<
  Readonly<Record<string, { visible: boolean; request: object | null }>>
>({});

export function useBrowserAnnotationToolbar({
  selected,
  active,
  onError,
}: {
  selected: BrowserTabState | null;
  active: boolean;
  onError: (error: unknown) => void;
}) {
  const { t } = useTranslation("agent");
  const runtime = useBrowserAnnotationRuntime();
  const store = useAtomValue(browserAnnotationDraftsAtom);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const key = browserAnnotationModeKey(
    runtime?.sessionId,
    runtime?.threadId,
    selected,
  );
  const [preferences, setPreferences] = useAtom(markerPreferencesAtom);
  const drafts = useMemo(
    () =>
      snapshot.filter(
        (draft) =>
          draft.sessionId === runtime?.sessionId &&
          draft.event.threadId === runtime?.threadId &&
          matchesBrowserTabEvent(selected, draft.event),
      ),
    [snapshot, runtime?.sessionId, runtime?.threadId, selected],
  );
  const sendable = drafts.filter(hasBrowserAnnotationContent);
  const [operation, setOperation] = useState<"send" | "visibility" | null>(
    null,
  );
  const [failure, setFailure] = useState<
    "sendFailed" | "markersFailed" | "discardChanged" | null
  >(null);
  const inFlight = useRef<object | null>(null);
  const confirmation = useRef<{
    key: string;
    drafts: readonly BrowserAnnotationDraft[];
  } | null>(null);
  const current = useRef({ key, active, runtime, selected });
  current.current = { key, active, runtime, selected };
  const pending = drafts.some((draft) => draft.pending);
  const native = useBrowserNativeMenu({
    selected,
    active,
    onError,
    onAction: (id) => {
      const captured = confirmation.current;
      confirmation.current = null;
      if (
        id !== "discard" ||
        !captured ||
        captured.key !== current.current.key ||
        !current.current.active
      )
        return;
      if (!store.discard(captured.drafts)) setFailure("discardChanged");
    },
  });
  useEffect(() => {
    inFlight.current = null;
    confirmation.current = null;
    setOperation(null);
    setFailure(null);
    return () => {
      inFlight.current = null;
    };
  }, [key, active]);

  const markersVisible = !key || preferences[key]?.visible !== false;
  const markersPending = Boolean(key && preferences[key]?.request);
  const toggleMarkers = async () => {
    if (!key || !selected || !active || inFlight.current || markersPending)
      return;
    const capturedKey = key;
    const token = {};
    inFlight.current = token;
    setPreferences((previous) => ({
      ...previous,
      [capturedKey]: { visible: markersVisible, request: token },
    }));
    setOperation("visibility");
    setFailure(null);
    try {
      const result = await setBrowserAnnotationMarkers(
        selected.tabId,
        !markersVisible,
      );
      setPreferences((previous) =>
        previous[capturedKey]?.request === token
          ? {
              ...previous,
              [capturedKey]: { visible: result.visible, request: null },
            }
          : previous,
      );
    } catch {
      setPreferences((previous) =>
        previous[capturedKey]?.request === token
          ? {
              ...previous,
              [capturedKey]: { visible: markersVisible, request: null },
            }
          : previous,
      );
      if (inFlight.current === token) setFailure("markersFailed");
    } finally {
      if (inFlight.current === token) {
        inFlight.current = null;
        setOperation(null);
      }
    }
  };
  const discard = async (element: HTMLElement) => {
    if (!key || !active || pending || !drafts.length || inFlight.current)
      return;
    confirmation.current = { key, drafts };
    setFailure(null);
    await native.show(
      element,
      [
        { id: "cancel", label: String(t("browserAnnotation.cancel" as never)) },
        {
          id: "discard",
          label: String(t("browserAnnotation.discard" as never)),
        },
      ],
      {
        title: String(t("browserAnnotation.discardTitle" as never)),
        description: String(t("browserAnnotation.discardDescription" as never)),
      },
    );
  };
  const send = async () => {
    if (
      !key ||
      !runtime ||
      !active ||
      pending ||
      !sendable.length ||
      inFlight.current
    )
      return;
    const token = {};
    inFlight.current = token;
    setOperation("send");
    setFailure(null);
    try {
      const result = await runtime.send({
        browserAnnotationIds: sendable.map((draft) => draft.id),
        sendOptions: {
          composerTarget: runtime.isSending ? "queue" : "start",
          skipSceneCommandRouting: true,
          skipWorkspaceCommandRouting: true,
          skipSessionRestore: true,
          targetSessionId: runtime.sessionId,
        },
      });
      if (
        inFlight.current === token &&
        (!isRuntimeSubmissionAccepted(result) ||
          result.receipt.sessionId !== runtime.sessionId ||
          result.receipt.threadId !== runtime.threadId)
      )
        setFailure("sendFailed");
    } catch {
      if (inFlight.current === token) setFailure("sendFailed");
    } finally {
      if (inFlight.current === token) {
        inFlight.current = null;
        setOperation(null);
      }
    }
  };
  return {
    count: sendable.length,
    hasDrafts: Boolean(drafts.length),
    hasDesign: drafts.some((draft) => Boolean(draft.designChange)),
    pending,
    operation: operation ?? (markersPending ? "visibility" : null),
    failure,
    markersVisible,
    confirming: native.open,
    toggleMarkers,
    discard,
    send,
  };
}
