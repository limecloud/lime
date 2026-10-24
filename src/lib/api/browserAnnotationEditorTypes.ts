import type {
  BrowserAnnotationSelection,
  BrowserAnnotationCaptureResult,
} from "./browserAnnotationTypes";
import type { BrowserAnnotationImage } from "./browserAnnotationImages";
import type {
  BrowserDesignChange,
  BrowserDesignLabels,
  BrowserDesignSnapshot,
} from "./browserDesign";

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
  text: string;
  captureFailed: string;
  sending: string;
  sendFailed: string;
  imageAttachment: string;
  removeImage: string;
  previewImage: string;
  closePreview: string;
  attachmentFailed: string;
  attachmentLoading: string;
  design?: BrowserDesignLabels;
}

export interface BrowserAnnotationEditorPresentation {
  editorId: string;
  annotationId: string;
  draftId: string;
  body: string;
  attachedImages: readonly BrowserAnnotationImage[];
  revision: number;
  selection: BrowserAnnotationSelection;
  screenshotStatus: "captured" | "failed" | "stale" | "timeout";
  labels: BrowserAnnotationEditorLabels;
  appearance: "light" | "dark";
  designSnapshot?: BrowserDesignSnapshot;
  designChange?: BrowserDesignChange | null;
}

export interface BrowserAnnotationEditorUpdate {
  presentation: BrowserAnnotationEditorPresentation;
  layout: BrowserAnnotationEditorLayout;
  generation: number;
  pending: boolean;
  error: boolean;
}

export interface BrowserAnnotationEditorLayout {
  width: number;
  maxHeight: number;
}

export function isBrowserAnnotationEditorHeight(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= 20_000
  );
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
  resize(height: number): void;
  act(
    action: BrowserAnnotationEditorAction,
    body: string,
    revision: number,
    attachedImages: readonly BrowserAnnotationImage[],
    designChange?: BrowserDesignChange | null,
  ): void;
}

export interface BrowserAnnotationEditorEvent {
  editorId: string;
  annotationId: string;
  draftId: string;
  generation: number;
  action: BrowserAnnotationEditorAction;
  body: string;
  attachedImages: readonly BrowserAnnotationImage[];
  revision: number;
  designChange?: BrowserDesignChange | null;
  /** Host-only result for the exact first Design commit revision. */
  capture?: BrowserAnnotationCaptureResult;
}
