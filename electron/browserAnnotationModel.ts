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
  "browser_tab_set_annotation_markers",
  "browser_tab_set_annotation_original",
  "browser_tab_focus_annotation_composer",
] as const;
export type BrowserAnnotationCommand =
  (typeof BROWSER_ANNOTATION_COMMANDS)[number];

export function readAnnotationArgs(
  command: BrowserAnnotationCommand,
  args: unknown,
) {
  const record = annotationRecord(args);
  const keys =
    command === "browser_tab_begin_annotation"
      ? ["tabId", "kind"]
      : command === "browser_tab_set_annotation_markers"
        ? ["tabId", "visible"]
        : command === "browser_tab_set_annotation_original"
          ? ["tabId", "identity", "gestureId", "original"]
          : command === "browser_tab_focus_annotation_composer"
            ? ["tabId", "identity"]
            : ["tabId", "annotationId"];
  if (Object.keys(record).some((key) => !keys.includes(key)))
    throw new Error("Unknown Browser annotation argument");
  return record;
}

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
  if (value !== "element" && value !== "region" && value !== "text")
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
  if (
    source.kind !== kind ||
    !Array.isArray(source.framePath) ||
    source.framePath.length > 32
  )
    throw new Error("Browser annotation frame or kind mismatch");
  const framePath = source.framePath.map((value) => {
    const frame = annotationRecord(value);
    if (!Array.isArray(frame.shadowHosts) || frame.shadowHosts.length > 32)
      throw new Error("Invalid Browser annotation frame path");
    return {
      selector: annotationString(frame.selector),
      shadowHosts: frame.shadowHosts.map(annotationString),
    };
  });
  const frameUrl = framePath.length
    ? annotationString(source.frameUrl)
    : pageUrl;
  const parsedFrameUrl = new URL(frameUrl);
  if (
    framePath.length &&
    parsedFrameUrl.origin !== new URL(pageUrl).origin &&
    !(
      parsedFrameUrl.protocol === "about:" &&
      ["blank", "srcdoc"].includes(parsedFrameUrl.pathname)
    )
  )
    throw new Error("Browser annotation frame is not same-origin");
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
  const readRect = (value: unknown): BrowserAnnotationRect => {
    const rect = annotationRecord(value);
    const result = {
      x: finite(rect.x, 0, width),
      y: finite(rect.y, 0, height),
      width: finite(rect.width, 0.1, width),
      height: finite(rect.height, 0.1, height),
    };
    if (
      result.x + result.width > width + 0.01 ||
      result.y + result.height > height + 0.01
    )
      throw new Error("Browser annotation is outside the viewport");
    return result;
  };
  const targetRect = readRect(source.targetRect);
  const marker = annotationRecord(source.markerViewportPoint);
  const scroll = annotationRecord(source.scrollPosition);
  const text = (value: unknown, maximum = 4096): string | null => {
    if (value === null) return null;
    if (typeof value !== "string" || value.length > maximum)
      throw new Error("Invalid Browser annotation text");
    return value;
  };
  const selected: BrowserAnnotationSelection = {
    kind,
    pageUrl,
    pageTitle,
    frameUrl,
    framePath,
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
    targetText: text(source.targetText, kind === "text" ? 20000 : 8192),
  };
  if (kind === "text") {
    const locator = annotationRecord(source.textLocator);
    const offset = (value: unknown) => {
      const result = finite(value, 0, 1e8);
      if (!Number.isSafeInteger(result))
        throw new Error("Invalid Browser annotation text offset");
      return result;
    };
    const startOffset = offset(locator.startOffset),
      endOffset = offset(locator.endOffset);
    if (
      (locator.kind !== "dom" && locator.kind !== "form-control") ||
      (locator.direction !== "forward" && locator.direction !== "backward") ||
      !selected.targetText?.trim() ||
      (locator.kind === "dom" && locator.rangeText !== selected.targetText) ||
      (locator.kind === "form-control" && locator.rangeText !== undefined) ||
      endOffset - startOffset !== selected.targetText.length ||
      !Array.isArray(locator.shadowHosts) ||
      locator.shadowHosts.length > 32 ||
      !Array.isArray(source.selectionRects) ||
      !source.selectionRects.length ||
      source.selectionRects.length > 1000
    ) {
      throw new Error("Invalid Browser annotation text selection");
    }
    selected.textLocator = {
      ...(locator.kind === "dom"
        ? { kind: "dom" as const, rangeText: selected.targetText }
        : { kind: "form-control" as const }),
      selector: annotationString(locator.selector),
      shadowHosts: locator.shadowHosts.map(annotationString),
      direction: locator.direction,
      startOffset,
      endOffset,
    };
    selected.selectionRects = source.selectionRects.map(readRect);
    if (
      selected.selectionRects.some(
        (rect) =>
          rect.x < targetRect.x - 0.01 ||
          rect.y < targetRect.y - 0.01 ||
          rect.x + rect.width > targetRect.x + targetRect.width + 0.01 ||
          rect.y + rect.height > targetRect.y + targetRect.height + 0.01,
      )
    ) {
      throw new Error("Browser annotation text is outside its target");
    }
  }
  return selected;
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
