import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import type {
  BrowserAnnotationCaptureResult,
  BrowserAnnotationCancelledEvent,
  BrowserAnnotationKind,
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
    session.scope !== "main-frame"
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
        payload.selection.framePath !== "main"
      )
        throw new Error("Invalid browser annotation selection");
      handler(payload);
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
      handler(event);
    },
  );
}

function assertAnnotationIdentity(session: BrowserAnnotationSession): void {
  if (
    !session ||
    [
      session.annotationId,
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
