import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import { readBrowserAnnotationImages } from "./browserAnnotationImages";
import {
  readBrowserDesignChange,
  readBrowserDesignSnapshot,
} from "./browserDesign";
import type {
  BrowserAnnotationActivateEvent,
  BrowserAnnotationCaptureResult,
  BrowserAnnotationCancelledEvent,
  BrowserAnnotationKind,
  BrowserAnnotationIdentity,
  BrowserAnnotationInputState,
  BrowserAnnotationSelectionEvent,
  BrowserAnnotationSession,
} from "./browserAnnotationTypes";
import type {
  BrowserAnnotationEditorEvent,
  BrowserAnnotationEditorPresentation,
} from "./browserAnnotationEditorTypes";
import type { BrowserTabEventIdentity } from "./browserTab";

export type BrowserAnnotationEditorNativeEvent = BrowserAnnotationEditorEvent &
  BrowserTabEventIdentity & { viewId: string };
export interface BrowserAnnotationEditorReceipt {
  editorId: string;
  generation: number;
  visible: boolean;
}

export async function beginBrowserAnnotation(
  tabId: string,
  kind: BrowserAnnotationKind,
): Promise<BrowserAnnotationSession> {
  const session = await safeInvoke<BrowserAnnotationSession>(
    "browser_tab_begin_annotation",
    { tabId, kind },
  );
  assertAnnotationIdentity(session);
  if (
    session.tabId !== tabId ||
    session.kind !== kind ||
    session.scope !== "page"
  )
    throw new Error("Invalid browser annotation session");
  return session;
}

export async function cancelBrowserAnnotation(
  tabId: string,
  annotationId: string,
): Promise<void> {
  await safeInvoke("browser_tab_cancel_annotation", { tabId, annotationId });
}

export async function setBrowserAnnotationMarkers(
  tabId: string,
  visible: boolean,
): Promise<{ tabId: string; visible: boolean }> {
  const result = await safeInvoke<{ tabId: string; visible: boolean }>(
    "browser_tab_set_annotation_markers",
    { tabId, visible },
  );
  if (result?.tabId !== tabId || result.visible !== visible)
    throw new Error("Invalid Browser marker visibility receipt");
  return result;
}

export async function setBrowserAnnotationOriginal(
  tab: BrowserAnnotationIdentity,
  gestureId: string,
  original: boolean,
): Promise<void> {
  const identity = Object.fromEntries(
    [
      "browserSessionId",
      "threadId",
      "tabId",
      "viewId",
      "ownerWebContentsId",
      "webContentsId",
      "windowId",
      "pageRevision",
    ].map((key) => [key, tab[key as keyof BrowserAnnotationIdentity]]),
  ) as unknown as BrowserAnnotationIdentity;
  assertPageIdentity(identity);
  if (
    typeof gestureId !== "string" ||
    !/^[a-zA-Z0-9._:-]{1,100}$/u.test(gestureId) ||
    typeof original !== "boolean"
  )
    throw new Error("Invalid Browser original page request");
  const result = await safeInvoke<
    BrowserAnnotationIdentity & { gestureId: string; original: boolean }
  >("browser_tab_set_annotation_original", {
    tabId: identity.tabId,
    identity,
    gestureId,
    original,
  });
  if (
    !result ||
    Object.keys(result).length !== Object.keys(identity).length + 2 ||
    result.gestureId !== gestureId ||
    result.original !== original ||
    Object.entries(identity).some(
      ([key, value]) =>
        result[key as keyof BrowserAnnotationIdentity] !== value,
    )
  )
    throw new Error("Invalid Browser original page receipt");
}

export async function focusBrowserAnnotationComposer(
  tab: BrowserAnnotationIdentity,
): Promise<void> {
  const identity: BrowserAnnotationIdentity = {
    browserSessionId: tab.browserSessionId,
    threadId: tab.threadId,
    tabId: tab.tabId,
    viewId: tab.viewId,
    ownerWebContentsId: tab.ownerWebContentsId,
    webContentsId: tab.webContentsId,
    windowId: tab.windowId,
    pageRevision: tab.pageRevision,
  };
  const result = await safeInvoke<
    BrowserAnnotationIdentity & { focused: boolean }
  >("browser_tab_focus_annotation_composer", { tabId: tab.tabId, identity });
  if (
    result?.focused !== true ||
    Object.entries(identity).some(
      ([key, value]) =>
        result[key as keyof BrowserAnnotationIdentity] !== value,
    )
  )
    throw new Error("Invalid Browser annotation composer focus receipt");
}

export function listenBrowserAnnotationInputState(
  handler: (event: BrowserAnnotationInputState) => void,
): Promise<() => void> {
  return safeListen<BrowserAnnotationInputState>(
    "browser-tab-annotation-input-state",
    ({ payload }) => {
      assertAnnotationIdentity(payload);
      if (
        payload.scope !== "page" ||
        !["element", "region", "text"].includes(payload.kind) ||
        typeof payload.suspended !== "boolean" ||
        typeof payload.addModifierPressed !== "boolean"
      )
        throw new Error("Invalid Browser annotation input state");
      handler(payload);
    },
  );
}

export async function captureBrowserAnnotation(
  tabId: string,
  annotationId: string,
): Promise<BrowserAnnotationCaptureResult> {
  const result = await safeInvoke<BrowserAnnotationCaptureResult>(
    "browser_tab_capture_annotation",
    { tabId, annotationId },
  );
  if (
    !result ||
    result.annotationId !== annotationId ||
    !result.selection ||
    !["captured", "failed", "stale", "timeout"].includes(
      result.screenshotStatus,
    )
  )
    throw new Error("Invalid browser annotation capture result");
  if ((result.screenshotStatus === "captured") !== Boolean(result.screenshot))
    throw new Error("Invalid browser annotation screenshot status");
  const shot = result.screenshot;
  if (
    shot &&
    (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/u.test(shot.dataUrl) ||
      !Number.isSafeInteger(shot.width) ||
      shot.width < 1 ||
      !Number.isSafeInteger(shot.height) ||
      shot.height < 1 ||
      !["viewport", "crop"].includes(shot.kind))
  )
    throw new Error("Invalid browser annotation screenshot");
  return result;
}

export function listenBrowserAnnotationSelection(
  handler: (event: BrowserAnnotationSelectionEvent) => void,
): Promise<() => void> {
  return safeListen<BrowserAnnotationSelectionEvent>(
    "browser-tab-annotation-selection",
    ({ payload }) => {
      assertAnnotationIdentity(payload);
      if (
        !payload.selection ||
        payload.selection.kind !== payload.kind ||
        !Array.isArray(payload.selection.framePath) ||
        payload.selection.framePath.length > 32 ||
        payload.selection.framePath.some(
          (frame) =>
            !frame ||
            typeof frame.selector !== "string" ||
            !frame.selector.trim() ||
            !Array.isArray(frame.shadowHosts) ||
            frame.shadowHosts.length > 32 ||
            frame.shadowHosts.some(
              (host) => typeof host !== "string" || !host.trim(),
            ),
        )
      )
        throw new Error("Invalid browser annotation selection");
      handler({
        ...payload,
        ...(payload.designSnapshot === undefined
          ? {}
          : {
              designSnapshot: readBrowserDesignSnapshot(payload.designSnapshot),
            }),
      });
    },
  );
}

export function listenBrowserAnnotationCancelled(
  handler: (event: BrowserAnnotationCancelledEvent) => void,
): Promise<() => void> {
  return safeListen<BrowserAnnotationCancelledEvent>(
    "browser-tab-annotation-cancelled",
    ({ payload }) => {
      assertAnnotationIdentity(payload);
      if (typeof payload.reason !== "string")
        throw new Error("Invalid browser annotation cancellation");
      handler(payload);
    },
  );
}

export function listenBrowserAnnotationActivate(
  handler: (event: BrowserAnnotationActivateEvent) => void,
): Promise<() => void> {
  return safeListen<BrowserAnnotationActivateEvent>(
    "browser-tab-annotation-activate",
    ({ payload }) => {
      assertAnnotationIdentity(payload);
      if (
        !Number.isSafeInteger(payload.presentationPageRevision) ||
        payload.presentationPageRevision < payload.pageRevision
      )
        throw new Error("Invalid browser annotation presentation revision");
      handler(payload);
    },
  );
}

export async function showBrowserAnnotationEditor(
  tabId: string,
  presentation: BrowserAnnotationEditorPresentation,
): Promise<BrowserAnnotationEditorReceipt> {
  const receipt = await safeInvoke<BrowserAnnotationEditorReceipt>(
    "browser_tab_show_annotation_editor",
    { tabId, presentation },
  );
  if (
    !receipt ||
    receipt.editorId !== presentation.editorId ||
    !Number.isSafeInteger(receipt.generation) ||
    receipt.generation < 1 ||
    typeof receipt.visible !== "boolean"
  )
    throw new Error("Invalid browser annotation editor receipt");
  return receipt;
}

export async function updateBrowserAnnotationEditor(
  tabId: string,
  editorId: string,
  generation: number,
  pending: boolean,
  error: boolean,
): Promise<void> {
  await safeInvoke("browser_tab_update_annotation_editor", {
    tabId,
    editorId,
    generation,
    pending,
    error,
  });
}

export async function closeBrowserAnnotationEditor(
  tabId: string,
  editorId: string,
  generation: number,
): Promise<void> {
  await safeInvoke("browser_tab_close_annotation_editor", {
    tabId,
    editorId,
    generation,
  });
}

export function listenBrowserAnnotationEditor(
  handler: (event: BrowserAnnotationEditorNativeEvent) => void,
): Promise<() => void> {
  return safeListen<BrowserAnnotationEditorNativeEvent>(
    "browser-tab-annotation-editor",
    ({ payload }) => {
      const event = payload;
      if (
        !event ||
        [
          event.editorId,
          event.annotationId,
          event.draftId,
          event.tabId,
          event.threadId,
          event.browserSessionId,
          event.viewId,
        ].some((value) => typeof value !== "string" || !value.trim()) ||
        [
          event.generation,
          event.ownerWebContentsId,
          event.webContentsId,
          event.windowId,
        ].some(
          (value) =>
            typeof value !== "number" ||
            !Number.isSafeInteger(value) ||
            value < 1,
        ) ||
        !Number.isSafeInteger(event.revision) ||
        event.revision < 0 ||
        typeof event.body !== "string" ||
        event.body.length > 100_000 ||
        !["change", "save", "send", "close"].includes(event.action)
      )
        throw new Error("Invalid browser annotation editor event");
      handler({
        ...event,
        attachedImages: readBrowserAnnotationImages(event.attachedImages),
        ...(event.designChange === undefined
          ? {}
          : { designChange: readBrowserDesignChange(event.designChange) }),
      });
    },
  );
}

function assertAnnotationIdentity(session: BrowserAnnotationSession): void {
  assertPageIdentity(session);
  if (typeof session.annotationId !== "string" || !session.annotationId.trim())
    throw new Error("Invalid browser annotation identity");
}

function assertPageIdentity(session: BrowserAnnotationIdentity): void {
  if (
    !session ||
    [
      session.tabId,
      session.threadId,
      session.browserSessionId,
      session.viewId,
    ].some((value) => typeof value !== "string" || !value.trim()) ||
    [session.ownerWebContentsId, session.webContentsId, session.windowId].some(
      (value) => !Number.isSafeInteger(value) || value < 1,
    ) ||
    !Number.isSafeInteger(session.pageRevision) ||
    session.pageRevision < 0
  )
    throw new Error("Invalid browser annotation identity");
}
