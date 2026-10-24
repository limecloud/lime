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
  listenBrowserAnnotationActivate,
  listenBrowserAnnotationInputState,
  focusBrowserAnnotationComposer,
  listenBrowserAnnotationEditor,
  showBrowserAnnotationEditor,
  updateBrowserAnnotationEditor,
  closeBrowserAnnotationEditor,
  type BrowserAnnotationEditorNativeEvent,
} from "@/lib/api/browserAnnotation";
import type { BrowserTabState } from "@/lib/api/browserTab";
import type {
  BrowserAnnotationSelectionEvent,
  BrowserAnnotationInputState,
} from "@/lib/api/browserAnnotationTypes";
import type { BrowserAnnotationEditorLabels } from "@/lib/api/browserAnnotationEditorTypes";
import { isRuntimeSubmissionAccepted } from "../../../hooks/agentSendResult";
import { matchesBrowserTabEvent } from "./browserTabEventIdentity";
import {
  browserAnnotationDraftsAtom,
  hasBrowserAnnotationContent,
  type BrowserAnnotationDraft,
} from "./browserAnnotationDrafts";
import { useBrowserAnnotationRuntime } from "./BrowserAnnotationContext";
import {
  browserAnnotationModeKey,
  browserAnnotationModesAtom,
} from "./browserAnnotationMode";

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
  const modes = useAtomValue(browserAnnotationModesAtom);
  const modeSnapshot = useSyncExternalStore(
    modes.subscribe,
    modes.getSnapshot,
    modes.getSnapshot,
  );
  const modeKey = browserAnnotationModeKey(sessionId, threadId, selected);
  const current = useRef({ selected, active, runtime, onError, t });
  current.current = { selected, active, runtime, onError, t };
  const selecting = Boolean(modeKey && modeSnapshot.has(modeKey));
  const [pickerVersion, wakePicker] = useState(0);
  const [inputState, setInputState] =
    useState<BrowserAnnotationInputState | null>(null);
  const capturePending = useRef<number | null>(null);
  const lastAttempt = useRef<string | null>(null);
  const focus = useSyncExternalStore(
    store.subscribe,
    store.getFocusSnapshot,
    store.getFocusSnapshot,
  );
  const picker = useRef<{
    tab: BrowserTabState;
    annotationId: string | null;
    epoch: number;
    input: Map<string, BrowserAnnotationInputState>;
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
    lastAttempt.current = null;
    if (mounted.current) wakePicker((version) => version + 1);
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
        tab.controlOwner === "agent" ||
        tab.controlOwner === "human_takeover" ||
        !state.runtime ||
        state.runtime.sessionId !== draft.sessionId ||
        state.runtime.threadId !== draft.event.threadId ||
        !matchesBrowserTabEvent(tab, draft.event)
      )
        return;
      if (
        [...editors.current.values()].some(
          (editor) =>
            editor.draft.id === draft.id &&
            !editor.closed &&
            !editor.closing &&
            editor.epoch === lifetime.current,
        )
      )
        return;
      const pendingPicker = picker.current;
      picker.current = null;
      if (pendingPicker?.annotationId)
        void cancelBrowserAnnotation(
          pendingPicker.tab.tabId,
          pendingPicker.annotationId,
        ).catch(() => undefined);
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
      wakePicker((version) => version + 1);
      const labels: BrowserAnnotationEditorLabels = {
        title: String(state.t("browserAnnotation.title" as never)),
        placeholder: String(state.t("browserAnnotation.placeholder" as never)),
        save: String(state.t("browserAnnotation.save" as never)),
        send: String(state.t("browserAnnotation.send" as never)),
        close: String(state.t("browserAnnotation.close" as never)),
        element: String(state.t("browserAnnotation.element" as never)),
        region: String(state.t("browserAnnotation.region" as never)),
        text: String(state.t("browserAnnotation.text" as never)),
        captureFailed: String(
          state.t("browserAnnotation.captureFailed" as never),
        ),
        sending: String(state.t("browserAnnotation.sending" as never)),
        sendFailed: String(state.t("browserAnnotation.sendFailed" as never)),
        imageAttachment: String(
          state.t("browserAnnotation.imageAttachment" as never),
        ),
        removeImage: String(state.t("browserAnnotation.removeImage" as never)),
        previewImage: String(
          state.t("browserAnnotation.previewImage" as never),
        ),
        closePreview: String(
          state.t("browserAnnotation.closePreview" as never),
        ),
        attachmentFailed: String(
          state.t("browserAnnotation.attachmentFailed" as never),
        ),
        attachmentLoading: String(
          state.t("browserAnnotation.attachmentLoading" as never),
        ),
        design: {
          title: String(state.t("browserAnnotation.designTitle" as never)),
          text: String(state.t("browserAnnotation.designText" as never)),
          reset: String(state.t("browserAnnotation.designReset" as never)),
          invalid: String(state.t("browserAnnotation.designInvalid" as never)),
        },
      };
      try {
        const receipt = await showBrowserAnnotationEditor(tab.tabId, {
          editorId: editor.id,
          annotationId: draft.event.annotationId,
          draftId: draft.id,
          body: draft.body,
          attachedImages: draft.attachedImages,
          revision: draft.revision,
          selection: draft.event.selection,
          screenshotStatus: draft.capture.screenshotStatus,
          ...(draft.event.designSnapshot
            ? {
                designSnapshot: draft.event.designSnapshot,
                designChange: draft.designChange ?? null,
              }
            : {}),
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
    if (
      !store.update(
        event.draftId,
        event.body,
        event.revision,
        event.attachedImages,
        event.designChange,
        event.capture,
      )
    )
      return;
    if (event.capture?.screenshotStatus === "stale") {
      if (event.action === "send")
        void updateBrowserAnnotationEditor(
          editor.tab.tabId,
          editor.id,
          editor.generation!,
          false,
          true,
        ).catch(current.current.onError);
      return;
    }
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
    lastAttempt.current = null;
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
      setInputState(null);
      capturePending.current = epoch;
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
        ) {
          await cancelBrowserAnnotation(event.tabId, event.annotationId);
          return;
        }
        const draft = store.create(capturedRuntime.sessionId, event, capture);
        await openDraft(draft);
      } catch (error) {
        void cancelBrowserAnnotation(event.tabId, event.annotationId).catch(
          () => undefined,
        );
        if (!disposed) current.current.onError(error);
      } finally {
        if (capturePending.current === epoch) capturePending.current = null;
        lastAttempt.current = null;
        if (!disposed) wakePicker((version) => version + 1);
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
          const pendingTab = picker.current.tab;
          picker.current = null;
          if (event.reason === "escape") {
            const key = browserAnnotationModeKey(
              sessionId,
              threadId,
              pendingTab,
            );
            if (key) modes.set(key, false);
          }
          lastAttempt.current = null;
          if (!disposed) wakePicker((version) => version + 1);
        }
      });
      if (disposed) cancelledStop();
      else stops.push(cancelledStop);
      const inputStop = await listenBrowserAnnotationInputState((event) => {
        const pending = picker.current;
        const state = current.current;
        if (
          disposed ||
          pending?.epoch !== epoch ||
          !state.active ||
          !state.selected?.selected ||
          state.runtime?.sessionId !== sessionId ||
          state.runtime?.threadId !== event.threadId ||
          state.selected?.controlOwner === "agent" ||
          state.selected?.controlOwner === "human_takeover" ||
          !matchesBrowserTabEvent(state.selected, event) ||
          !matchesBrowserTabEvent(pending.tab, event) ||
          state.selected?.pageRevision !== event.pageRevision ||
          pending.tab.pageRevision !== event.pageRevision
        )
          return;
        if (pending.annotationId === event.annotationId) setInputState(event);
        else if (!pending.annotationId) {
          if (pending.input.size >= 4) pending.input.clear();
          pending.input.set(event.annotationId, event);
        }
      });
      if (disposed) inputStop();
      else stops.push(inputStop);
      const activateStop = await listenBrowserAnnotationActivate((event) => {
        const state = current.current;
        const draft = store.get(event.annotationId);
        if (
          disposed ||
          !state.active ||
          state.selected?.controlOwner === "agent" ||
          state.selected?.controlOwner === "human_takeover" ||
          !draft ||
          draft.pending ||
          draft.sessionId !== sessionId ||
          draft.event.threadId !== threadId ||
          event.pageRevision !== draft.event.pageRevision ||
          event.presentationPageRevision !== state.selected?.pageRevision ||
          !matchesBrowserTabEvent(state.selected, event) ||
          !matchesBrowserTabEvent(state.selected, draft.event)
        )
          return;
        store.focus(draft.id);
      });
      if (disposed) activateStop();
      else stops.push(activateStop);
      stopEditor = await listenBrowserAnnotationEditor((event) => {
        if (editors.current.get(event.editorId)?.epoch === epoch)
          receiveEditor.current(event);
        drain();
      });
      drain();
      if (!disposed) wakePicker((version) => version + 1);
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
  }, [openDraft, closeEditor, store, modes, sessionId, threadId]);

  useEffect(() => {
    for (const editor of editors.current.values())
      if (
        !editor.closing &&
        (!active ||
          selected?.controlOwner === "agent" ||
          selected?.controlOwner === "human_takeover" ||
          !matchesBrowserTabEvent(selected, editor.tab) ||
          selected?.pageRevision !== editor.tab.pageRevision)
      )
        void closeEditor(editor);
    const pending = picker.current;
    if (
      pending &&
      (!active ||
        selected?.isLoading ||
        selected?.controlOwner === "agent" ||
        selected?.controlOwner === "human_takeover" ||
        !matchesBrowserTabEvent(selected, pending.tab) ||
        selected?.pageRevision !== pending.tab.pageRevision)
    ) {
      picker.current = null;
      lastAttempt.current = null;
      if (pending.annotationId)
        void cancelBrowserAnnotation(
          pending.tab.tabId,
          pending.annotationId,
        ).catch(onError);
    }
  }, [active, selected, onError, closeEditor]);

  useEffect(() => {
    const state = current.current;
    const key = browserAnnotationModeKey(
      state.runtime?.sessionId,
      state.runtime?.threadId,
      state.selected,
    );
    if (
      !key ||
      !modes.getSnapshot().has(key) ||
      !mounted.current ||
      !state.active ||
      !state.selected ||
      !state.selected.selected ||
      state.selected.isLoading ||
      state.selected.controlOwner === "agent" ||
      state.selected.controlOwner === "human_takeover" ||
      capturePending.current === lifetime.current ||
      picker.current ||
      [...editors.current.values()].some((editor) => !editor.closed)
    )
      return;
    const attempt = JSON.stringify([key, state.selected.pageRevision]);
    if (lastAttempt.current === attempt) return;
    lastAttempt.current = attempt;
    const pending = {
      tab: state.selected,
      annotationId: null as string | null,
      epoch: lifetime.current,
      input: new Map<string, BrowserAnnotationInputState>(),
    };
    setInputState(null);
    picker.current = pending;
    void (async () => {
      try {
        await ready.current;
        if (picker.current !== pending || !mounted.current) return;
        const session = await beginBrowserAnnotation(
          pending.tab.tabId,
          "element",
        );
        if (picker.current === pending && mounted.current) {
          pending.annotationId = session.annotationId;
          setInputState(pending.input.get(session.annotationId) ?? null);
          pending.input.clear();
        } else
          await cancelBrowserAnnotation(session.tabId, session.annotationId);
      } catch (error) {
        if (picker.current === pending) {
          picker.current = null;
        }
        if (mounted.current) current.current.onError(error);
      }
    })();
  }, [active, selected, modeSnapshot, pickerVersion, modes]);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      const state = current.current;
      const key = browserAnnotationModeKey(
        state.runtime?.sessionId,
        state.runtime?.threadId,
        state.selected,
      );
      if (!key || !state.active || !mounted.current) return;
      modes.set(key, enabled);
      lastAttempt.current = null;
      const pending = picker.current;
      picker.current = null;
      if (pending?.annotationId)
        await cancelBrowserAnnotation(pending.tab.tabId, pending.annotationId);
      if (!enabled)
        await Promise.all(
          [...editors.current.values()]
            .filter(
              (editor) => !editor.closed && editor.epoch === lifetime.current,
            )
            .map(closeEditor),
        );
      if (enabled) wakePicker((version) => version + 1);
    },
    [modes, closeEditor],
  );
  const begin = useCallback(
    () => setEnabled(!selecting),
    [setEnabled, selecting],
  );
  const exit = useCallback(() => setEnabled(false), [setEnabled]);
  const adding = useRef(false);
  const addToComposer = useCallback(async () => {
    const state = current.current;
    const tab = state.selected;
    const runtime = state.runtime;
    const epoch = lifetime.current;
    if (adding.current || !mounted.current || !state.active || !tab || !runtime)
      return;
    const hasDraft = () =>
      store
        .getSnapshot()
        .some(
          (draft) =>
            draft.sessionId === runtime.sessionId &&
            draft.event.threadId === runtime.threadId &&
            matchesBrowserTabEvent(tab, draft.event) &&
            hasBrowserAnnotationContent(draft) &&
            !draft.pending,
        );
    const isCurrent = () =>
      mounted.current &&
      current.current.active &&
      lifetime.current === epoch &&
      current.current.runtime?.sessionId === runtime.sessionId &&
      current.current.runtime?.threadId === runtime.threadId &&
      matchesBrowserTabEvent(current.current.selected, tab) &&
      current.current.selected?.pageRevision === tab.pageRevision;
    if (!hasDraft()) return;
    adding.current = true;
    try {
      await exit();
      if (!isCurrent() || !hasDraft()) return;
      await focusBrowserAnnotationComposer(tab);
      if (isCurrent() && hasDraft())
        store.focusComposer(runtime.sessionId, runtime.threadId);
    } finally {
      adding.current = false;
    }
  }, [exit, store]);
  const acceptsInput =
    selecting &&
    active &&
    selected &&
    selected.selected &&
    selected.controlOwner !== "agent" &&
    selected.controlOwner !== "human_takeover" &&
    inputState &&
    picker.current?.annotationId === inputState.annotationId &&
    matchesBrowserTabEvent(selected, inputState) &&
    selected.pageRevision === inputState.pageRevision;
  return {
    begin,
    exit,
    addToComposer,
    suspended: Boolean(acceptsInput && inputState.suspended),
    addModifierPressed: Boolean(acceptsInput && inputState.addModifierPressed),
    selecting,
    available: Boolean(
      runtime &&
      selected &&
      runtime.threadId === selected.threadId &&
      (!selected.isLoading || selecting),
    ),
    openDraft,
  };
}
