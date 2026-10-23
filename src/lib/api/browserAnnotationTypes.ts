import type { BrowserDesignSnapshot } from "./browserDesign";

export type BrowserAnnotationKind = "element" | "region" | "text";

/** UTF-16 offsets within DOM text nodes or the form control's value. */
interface BrowserAnnotationTextRange {
  selector: string;
  shadowHosts: string[];
  direction: "forward" | "backward";
  startOffset: number;
  endOffset: number;
}

export type BrowserAnnotationTextLocator = BrowserAnnotationTextRange &
  ({ kind: "dom"; rangeText: string } | { kind: "form-control" });

export interface BrowserAnnotationFrameLocator {
  selector: string;
  shadowHosts: string[];
}

export interface BrowserAnnotationPoint {
  x: number;
  y: number;
}

export interface BrowserAnnotationRect extends BrowserAnnotationPoint {
  width: number;
  height: number;
}

export interface BrowserAnnotationSize {
  width: number;
  height: number;
}

/** Host-owned identity; the untrusted page cannot choose a thread or tab. */
export interface BrowserAnnotationIdentity {
  browserSessionId: string;
  threadId: string;
  tabId: string;
  viewId: string;
  ownerWebContentsId: number;
  webContentsId: number;
  windowId: number;
  pageRevision: number;
}

export interface BrowserAnnotationSession extends BrowserAnnotationIdentity {
  annotationId: string;
  kind: BrowserAnnotationKind;
  scope: "page";
}

/** Capture identity stays immutable; activation is authorized for the live presentation. */
export interface BrowserAnnotationActivateEvent extends BrowserAnnotationSession {
  presentationPageRevision: number;
}

/** Rectangles and points are CSS pixels relative to the captured viewport. */
export interface BrowserAnnotationSelection {
  kind: BrowserAnnotationKind;
  pageUrl: string;
  pageTitle: string;
  frameUrl: string;
  framePath: BrowserAnnotationFrameLocator[];
  targetRect: BrowserAnnotationRect;
  viewportSize: BrowserAnnotationSize;
  scrollPosition: BrowserAnnotationPoint;
  devicePixelRatio: number;
  targetSelector: string | null;
  targetPath: string | null;
  targetRole: string | null;
  targetText: string | null;
  textLocator?: BrowserAnnotationTextLocator;
  selectionRects?: BrowserAnnotationRect[];
  markerViewportPoint: BrowserAnnotationPoint;
}

export interface BrowserAnnotationSelectionEvent extends BrowserAnnotationSession {
  selection: BrowserAnnotationSelection;
  designSnapshot?: BrowserDesignSnapshot;
}

export interface BrowserAnnotationCancelledEvent extends BrowserAnnotationSession {
  reason: string;
}

/** Transient picker presentation only; this grants no capture or submission authority. */
export interface BrowserAnnotationInputState extends BrowserAnnotationSession {
  suspended: boolean;
  addModifierPressed: boolean;
}

export interface BrowserAnnotationScreenshot {
  dataUrl: string;
  width: number;
  height: number;
  kind: "viewport" | "crop";
  viewportSize: BrowserAnnotationSize;
  cropRect?: BrowserAnnotationRect;
}

export interface BrowserAnnotationCaptureResult {
  annotationId: string;
  selection: BrowserAnnotationSelection;
  screenshot: BrowserAnnotationScreenshot | null;
  screenshotStatus: "captured" | "failed" | "stale" | "timeout";
  failureReason: string | null;
}
