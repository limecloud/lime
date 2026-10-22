import type {
  BrowserAnnotationKind,
  BrowserAnnotationRect,
  BrowserAnnotationSelection,
} from "../src/lib/api/browserAnnotationTypes";

export const BROWSER_ANNOTATION_PAGE_COMMAND =
  "browser-annotation-page-command";
export const BROWSER_ANNOTATION_PAGE_EVENT = "browser-annotation-page-event";
export const BROWSER_ANNOTATION_COMMANDS = [
  "browser_tab_begin_annotation",
  "browser_tab_cancel_annotation",
  "browser_tab_capture_annotation",
] as const;
export type BrowserAnnotationCommand =
  (typeof BROWSER_ANNOTATION_COMMANDS)[number];

export function annotationRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Browser annotation object");
  return value as Record<string, unknown>;
}

export function annotationString(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 8192)
    throw new Error("Invalid Browser annotation string");
  return value;
}

export function annotationKind(value: unknown): BrowserAnnotationKind {
  if (value !== "element" && value !== "region")
    throw new Error("Invalid Browser annotation kind");
  return value;
}

/** Page coordinates are data, never capabilities; reject invalid/outside geometry. */
export function readAnnotationSelection(
  value: unknown,
  kind: BrowserAnnotationKind,
  pageUrl: string,
  pageTitle: string,
): BrowserAnnotationSelection {
  const source = annotationRecord(value);
  if (source.kind !== kind || source.framePath !== "main")
    throw new Error("Browser annotation frame or kind mismatch");
  const finite = (value: unknown, minimum: number, maximum: number): number => {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < minimum ||
      value > maximum
    )
      throw new Error("Invalid Browser annotation geometry");
    return value;
  };
  const viewport = annotationRecord(source.viewportSize);
  const width = finite(viewport.width, 1, 20000);
  const height = finite(viewport.height, 1, 20000);
  const rect = annotationRecord(source.targetRect);
  const targetRect = {
    x: finite(rect.x, 0, width),
    y: finite(rect.y, 0, height),
    width: finite(rect.width, 0.1, width),
    height: finite(rect.height, 0.1, height),
  };
  if (
    targetRect.x + targetRect.width > width + 0.01 ||
    targetRect.y + targetRect.height > height + 0.01
  )
    throw new Error("Browser annotation is outside the viewport");
  const marker = annotationRecord(source.markerViewportPoint);
  const scroll = annotationRecord(source.scrollPosition);
  const text = (value: unknown, maximum = 4096): string | null => {
    if (value === null) return null;
    if (typeof value !== "string" || value.length > maximum)
      throw new Error("Invalid Browser annotation text");
    return value;
  };
  return {
    kind,
    pageUrl,
    pageTitle,
    frameUrl: pageUrl,
    framePath: "main",
    targetRect,
    viewportSize: { width, height },
    scrollPosition: {
      x: finite(scroll.x, -1e8, 1e8),
      y: finite(scroll.y, -1e8, 1e8),
    },
    devicePixelRatio: finite(source.devicePixelRatio, 0.1, 16),
    markerViewportPoint: {
      x: finite(marker.x, 0, width),
      y: finite(marker.y, 0, height),
    },
    targetSelector: text(source.targetSelector),
    targetPath: text(source.targetPath),
    targetRole: text(source.targetRole, 256),
    targetText: text(source.targetText, 8192),
  };
}

/** Convert CSS viewport coordinates using the actual captured image, not a guessed DPR. */
export function annotationCrop(
  selection: BrowserAnnotationSelection,
  image: { width: number; height: number },
  mode: "always" | "necessary",
): { pixels: BrowserAnnotationRect; viewport: BrowserAnnotationRect } | null {
  if (mode !== "necessary" || selection.kind === "element") return null;
  const {
    targetRect: rect,
    viewportSize,
    markerViewportPoint: marker,
  } = selection;
  const scaleX = image.width / viewportSize.width;
  const scaleY = image.height / viewportSize.height;
  const left = Math.max(
    0,
    Math.floor(Math.min(rect.x, marker.x - 12) * scaleX) - 32,
  );
  const top = Math.max(
    0,
    Math.floor(Math.min(rect.y, marker.y - 12) * scaleY) - 32,
  );
  const right = Math.min(
    image.width,
    Math.ceil(Math.max(rect.x + rect.width, marker.x + 12) * scaleX) + 32,
  );
  const bottom = Math.min(
    image.height,
    Math.ceil(Math.max(rect.y + rect.height, marker.y + 12) * scaleY) + 32,
  );
  return {
    pixels: { x: left, y: top, width: right - left, height: bottom - top },
    viewport: {
      x: left / scaleX,
      y: top / scaleY,
      width: (right - left) / scaleX,
      height: (bottom - top) / scaleY,
    },
  };
}
