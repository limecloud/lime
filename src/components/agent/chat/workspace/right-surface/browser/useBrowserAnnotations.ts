import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import {
  beginBrowserAnnotation,
  cancelBrowserAnnotation,
  captureBrowserAnnotation,
  listenBrowserAnnotationSelection,
  listenBrowserAnnotationCancelled,
  listenBrowserAnnotationEditor,
  showBrowserAnnotationEditor,
  updateBrowserAnnotationEditor,
  closeBrowserAnnotationEditor,
  type BrowserAnnotationEditorNativeEvent,
} from "@/lib/api/browserAnnotation";
import type { BrowserTabState } from "@/lib/api/browserTab";
import type { BrowserAnnotationSelectionEvent } from "@/lib/api/browserAnnotationTypes";
import type { BrowserAnnotationEditorLabels } from "@/lib/api/browserAnnotationEditorTypes";
import { isRuntimeSubmissionAccepted } from "../../../hooks/agentSendResult";
import { matchesBrowserTabEvent } from "./browserTabEventIdentity";
import {
  browserAnnotationDraftsAtom,
  type BrowserAnnotationDraft,
} from "./browserAnnotationDrafts";
import { useBrowserAnnotationRuntime } from "./BrowserAnnotationContext";

interface EditorSession {
  id: string;
  draft: BrowserAnnotationDraft;
  tab: BrowserTabState;
  generation: number | null;
  queued: BrowserAnnotationEditorNativeEvent[];
  pending: boolean;
  closed: boolean;
  closing: boolean;
  epoch: number;
}

export function useBrowserAnnotations({
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
  const sessionId = runtime?.sessionId;
  const threadId = runtime?.threadId;
  const store = useAtomValue(browserAnnotationDraftsAtom);
  const current = useRef({ selected, active, runtime, onError, t });
  current.current = { selected, active, runtime, onError, t };
  const [selecting, setSelecting] = useState(false);
  const focus = useSyncExternalStore(
    store.subscribe,
    store.getFocusSnapshot,
    store.getFocusSnapshot,
  );
  const picker = useRef<{
    tab: BrowserTabState;
    annotationId: string | null;
    epoch: number;
  } | null>(null);
  const lifetime = useRef(0);
  const mounted = useRef(false);
  const ready = useRef<Promise<void> | null>(null);
  const editors = useRef(new Map<string, EditorSession>());
  const drainScopes = useRef(new Map<number, () => void>());
  const receiveEditor = useRef<
    (event: BrowserAnnotationEditorNativeEvent) => void
  >(() => undefined);

  const forgetEditor = useCallback((editor: EditorSession) => {
    editors.current.delete(editor.id);
    drainScopes.current.get(editor.epoch)?.();
  }, []);
  const closeEditor = useCallback(async (editor: EditorSession) => {
    editor.closing = true;
    if (editor.generation === null) return;
    // Lifecycle removal may revoke the route before its final trusted flush arrives.
    await closeBrowserAnnotationEditor(
      editor.tab.tabId,
      editor.id,
      editor.generation,
    ).catch(() => undefined);
  }, []);

  const openDraft = useCallback(
    async (draft: BrowserAnnotationDraft) => {
      const state = current.current;
      const tab = state.selected;
      if (
        !mounted.current ||
        !state.active ||
        !tab ||
        !state.runtime ||
        state.runtime.sessionId !== draft.sessionId ||
        state.runtime.threadId !== draft.event.threadId ||
        !matchesBrowserTabEvent(tab, draft.event)
      )
        return;
      const editor: EditorSession = {
        id: crypto.randomUUID(),
        draft,
        tab,
        generation: null,
        queued: [],
        pending: false,
        closed: false,
        closing: false,
        epoch: lifetime.current,
      };
      editors.current.set(editor.id, editor);
      const labels: BrowserAnnotationEditorLabels = {
        title: state.t("browserAnnotation.title"),
        placeholder: state.t("browserAnnotation.placeholder"),
        save: state.t("browserAnnotation.save"),
        send: state.t("browserAnnotation.send"),
        close: state.t("browserAnnotation.close"),
        element: state.t("browserAnnotation.element"),
        region: state.t("browserAnnotation.region"),
        captureFailed: state.t("browserAnnotation.captureFailed"),
        sending: state.t("browserAnnotation.sending"),
        sendFailed: state.t("browserAnnotation.sendFailed"),
      };
      try {
        const receipt = await showBrowserAnnotationEditor(tab.tabId, {
          editorId: editor.id,
          annotationId: draft.event.annotationId,
          draftId: draft.id,
          body: draft.body,
          revision: draft.revision,
          selection: draft.event.selection,
          screenshotStatus: draft.capture.screenshotStatus,
          labels,
          appearance: document.documentElement.classList.contains("dark")
            ? "dark"
            : "light",
        });
        editor.generation = receipt.generation;
        if (!receipt.visible) forgetEditor(editor);
        else {
          for (const event of editor.queued.splice(0))
            receiveEditor.current(event);
          if (
            editor.closing ||
            editor.epoch !== lifetime.current ||
            !mounted.current ||
            !current.current.active ||
            current.current.runtime?.sessionId !== draft.sessionId ||
            !matchesBrowserTabEvent(current.current.selected, tab)
          )
            await closeEditor(editor);
        }
      } catch (error) {
        forgetEditor(editor);
        if (mounted.current && editor.epoch === lifetime.current)
          current.current.onError(error);
      }
    },
    [closeEditor, forgetEditor],
  );

  useEffect(() => {
    if (!focus || !active || !selected || !runtime) return;
    const draft = store.get(focus.id);
    if (
      !draft ||
      draft.sessionId !== runtime.sessionId ||
      draft.event.threadId !== runtime.threadId ||
      !matchesBrowserTabEvent(selected, draft.event)
    )
      return;
    store.consumeFocus(focus.request);
    void openDraft(draft);
  }, [focus, active, selected, runtime, store, openDraft]);

  receiveEditor.current = (event) => {
    const editor = editors.current.get(event.editorId);
    if (
      !editor ||
      editor.draft.id !== event.draftId ||
      editor.draft.event.annotationId !== event.annotationId ||
      !matchesBrowserTabEvent(editor.tab, event)
    )
      return;
    if (editor.generation === null) {
      editor.queued.push(event);
      return;
    }
    if (editor.generation !== event.generation) return;
    if (event.action === "close") {
      editor.closed = true;
      forgetEditor(editor);
    }
    if (!store.update(event.draftId, event.body, event.revision)) return;
    if (event.action === "change") return;
    if (event.action === "save" || event.action === "close") {
      if (!editor.pending) {
        if (event.action === "save") void closeEditor(editor);
      }
      return;
    }
    const state = current.current;
    if (
      editor.pending ||
      editor.closing ||
      editor.epoch !== lifetime.current ||
      !mounted.current ||
      !state.active ||
      !state.runtime ||
      state.runtime.sessionId !== editor.draft.sessionId ||
      state.runtime.threadId !== editor.draft.event.threadId ||
      !matchesBrowserTabEvent(state.selected, editor.tab)
    )
      return;
    editor.pending = true;
    void (async () => {
      try {
        await updateBrowserAnnotationEditor(
          editor.tab.tabId,
          editor.id,
          editor.generation!,
          true,
          false,
        );
        if (
          editor.closing ||
          editor.epoch !== lifetime.current ||
          !mounted.current ||
          !current.current.active ||
          current.current.runtime?.sessionId !== state.runtime!.sessionId ||
          current.current.runtime.threadId !== state.runtime!.threadId ||
          !matchesBrowserTabEvent(current.current.selected, editor.tab)
        ) {
          await closeEditor(editor);
          return;
        }
        const result = await state.runtime!.send({
          browserAnnotationIds: [editor.draft.id],
          sendOptions: {
            targetSessionId: editor.draft.sessionId,
            composerTarget: state.runtime!.isSending ? "queue" : "start",
            skipSceneCommandRouting: true,
            skipWorkspaceCommandRouting: true,
            skipSessionRestore: true,
          },
        });
        if (
          isRuntimeSubmissionAccepted(result) &&
          result.receipt.sessionId === editor.draft.sessionId &&
          result.receipt.threadId === editor.draft.event.threadId
        ) {
          await closeEditor(editor);
        } else if (!editor.closed)
          await updateBrowserAnnotationEditor(
            editor.tab.tabId,
            editor.id,
            editor.generation!,
            false,
            true,
          );
      } catch (error) {
        if (!editor.closed)
          await updateBrowserAnnotationEditor(
            editor.tab.tabId,
            editor.id,
            editor.generation!,
            false,
            true,
          ).catch(() => undefined);
        if (mounted.current) current.current.onError(error);
      } finally {
        editor.pending = false;
      }
    })();
  };

  useEffect(() => {
    if (!sessionId || !threadId) return;
    mounted.current = true;
    setSelecting(false);
    const epoch = ++lifetime.current;
    const scopeEditors = editors.current;
    const stops: Array<() => void> = [];
    let stopEditor: (() => void) | undefined;
    let disposed = false;
    const drain = () => {
      if (
        disposed &&
        stopEditor &&
        ![...editors.current.values()].some((editor) => editor.epoch === epoch)
      ) {
        stopEditor();
        stopEditor = undefined;
        drainScopes.current.delete(epoch);
      }
    };
    drainScopes.current.set(epoch, drain);
    const receive = async (event: BrowserAnnotationSelectionEvent) => {
      const pending = picker.current;
      const state = current.current;
      if (
        disposed ||
        pending?.epoch !== epoch ||
        !state.active ||
        !state.runtime ||
        !matchesBrowserTabEvent(state.selected, event) ||
        !matchesBrowserTabEvent(pending.tab, event) ||
        event.pageRevision !== state.selected?.pageRevision ||
        (pending.annotationId && pending.annotationId !== event.annotationId) ||
        state.runtime.threadId !== event.threadId
      )
        return;
      const capturedRuntime = state.runtime;
      picker.current = null;
      setSelecting(false);
      try {
        const capture = await captureBrowserAnnotation(
          event.tabId,
          event.annotationId,
        );
        if (
          disposed ||
          !current.current.active ||
          current.current.runtime?.sessionId !== capturedRuntime.sessionId ||
          !matchesBrowserTabEvent(current.current.selected, event) ||
          current.current.selected?.pageRevision !== event.pageRevision ||
          capture.screenshotStatus === "stale"
        )
          return;
        const draft = store.create(capturedRuntime.sessionId, event, capture);
        await cancelBrowserAnnotation(event.tabId, event.annotationId);
        await openDraft(draft);
      } catch (error) {
        if (!disposed) current.current.onError(error);
      }
    };
    ready.current = (async () => {
      const selectionStop = await listenBrowserAnnotationSelection((event) => {
        void receive(event);
      });
      if (disposed) selectionStop();
      else stops.push(selectionStop);
      const cancelledStop = await listenBrowserAnnotationCancelled((event) => {
        if (
          picker.current &&
          matchesBrowserTabEvent(picker.current.tab, event) &&
          (!picker.current.annotationId ||
            picker.current.annotationId === event.annotationId)
        ) {
          picker.current = null;
          if (!disposed) setSelecting(false);
        }
      });
      if (disposed) cancelledStop();
      else stops.push(cancelledStop);
      stopEditor = await listenBrowserAnnotationEditor((event) => {
        if (editors.current.get(event.editorId)?.epoch === epoch)
          receiveEditor.current(event);
        drain();
      });
      drain();
    })();
    void ready.current.catch((error) => {
      if (!disposed) current.current.onError(error);
    });
    return () => {
      disposed = true;
      mounted.current = false;
      stops.forEach((stop) => stop());
      const pending = picker.current;
      picker.current = null;
      if (pending?.annotationId)
        void cancelBrowserAnnotation(
          pending.tab.tabId,
          pending.annotationId,
        ).catch(() => undefined);
      for (const editor of scopeEditors.values())
        if (editor.epoch === epoch) void closeEditor(editor);
      drain();
    };
  }, [openDraft, closeEditor, store, sessionId, threadId]);

  useEffect(() => {
    for (const editor of editors.current.values())
      if (
        !editor.closing &&
        (!active || !matchesBrowserTabEvent(selected, editor.tab))
      )
        void closeEditor(editor);
    const pending = picker.current;
    if (
      pending &&
      (!active ||
        !matchesBrowserTabEvent(selected, pending.tab) ||
        selected?.pageRevision !== pending.tab.pageRevision)
    ) {
      picker.current = null;
      setSelecting(false);
      if (pending.annotationId)
        void cancelBrowserAnnotation(
          pending.tab.tabId,
          pending.annotationId,
        ).catch(onError);
    }
  }, [active, selected, onError, closeEditor]);

  const begin = useCallback(async () => {
    await ready.current;
    const state = current.current;
    if (
      !mounted.current ||
      !state.active ||
      !state.selected ||
      state.runtime?.threadId !== state.selected.threadId
    )
      return;
    const existing = picker.current;
    if (existing) {
      picker.current = null;
      setSelecting(false);
      if (existing.annotationId)
        await cancelBrowserAnnotation(
          existing.tab.tabId,
          existing.annotationId,
        );
      return;
    }
    const pending = {
      tab: state.selected,
      annotationId: null as string | null,
      epoch: lifetime.current,
    };
    picker.current = pending;
    setSelecting(true);
    try {
      const session = await beginBrowserAnnotation(
        pending.tab.tabId,
        "element",
      );
      if (picker.current === pending && mounted.current)
        pending.annotationId = session.annotationId;
      else await cancelBrowserAnnotation(session.tabId, session.annotationId);
    } catch (error) {
      if (picker.current === pending) {
        picker.current = null;
        setSelecting(false);
      }
      if (mounted.current) current.current.onError(error);
    }
  }, []);
  return {
    begin,
    selecting,
    available: Boolean(
      runtime && selected && runtime.threadId === selected.threadId,
    ),
    openDraft,
  };
}
