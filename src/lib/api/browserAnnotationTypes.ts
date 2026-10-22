export type BrowserAnnotationKind = "element" | "region";

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
  scope: "main-frame";
}

/** Rectangles and points are CSS pixels relative to the captured viewport. */
export interface BrowserAnnotationSelection {
  kind: BrowserAnnotationKind;
  pageUrl: string;
  pageTitle: string;
  frameUrl: string;
  framePath: "main";
  targetRect: BrowserAnnotationRect;
  viewportSize: BrowserAnnotationSize;
  scrollPosition: BrowserAnnotationPoint;
  devicePixelRatio: number;
  targetSelector: string | null;
  targetPath: string | null;
  targetRole: string | null;
  targetText: string | null;
  markerViewportPoint: BrowserAnnotationPoint;
}

export interface BrowserAnnotationSelectionEvent extends BrowserAnnotationSession {
  selection: BrowserAnnotationSelection;
}

export interface BrowserAnnotationCancelledEvent extends BrowserAnnotationSession {
  reason: string;
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
