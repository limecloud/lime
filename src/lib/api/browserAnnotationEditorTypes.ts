import type { BrowserAnnotationSelection } from "./browserAnnotationTypes";

export const BROWSER_ANNOTATION_EDITOR_CHANNEL =
  "lime:browser-annotation-editor";
export const BROWSER_ANNOTATION_EDITOR_UPDATE =
  "lime:browser-annotation-editor-update";

export interface BrowserAnnotationEditorLabels {
  title: string;
  placeholder: string;
  save: string;
  send: string;
  close: string;
  element: string;
  region: string;
  captureFailed: string;
  sending: string;
  sendFailed: string;
}

export interface BrowserAnnotationEditorPresentation {
  editorId: string;
  annotationId: string;
  draftId: string;
  body: string;
  revision: number;
  selection: BrowserAnnotationSelection;
  screenshotStatus: "captured" | "failed" | "stale" | "timeout";
  labels: BrowserAnnotationEditorLabels;
  appearance: "light" | "dark";
}

export interface BrowserAnnotationEditorUpdate {
  presentation: BrowserAnnotationEditorPresentation;
  generation: number;
  pending: boolean;
  error: boolean;
}

export type BrowserAnnotationEditorAction =
  | "change"
  | "save"
  | "send"
  | "close";

/** Only the trusted editor's narrow preload exposes this capability. */
export interface BrowserAnnotationEditorBridge {
  onUpdate(
    callback: (update: BrowserAnnotationEditorUpdate) => void,
  ): () => void;
  ready(): void;
  act(
    action: BrowserAnnotationEditorAction,
    body: string,
    revision: number,
  ): void;
}

export interface BrowserAnnotationEditorEvent {
  editorId: string;
  annotationId: string;
  draftId: string;
  generation: number;
  action: BrowserAnnotationEditorAction;
  body: string;
  revision: number;
}
