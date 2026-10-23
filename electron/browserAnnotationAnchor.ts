import type {
  BrowserAnnotationRect,
  BrowserAnnotationSize,
} from "../src/lib/api/browserAnnotationTypes";
import { annotationRecord } from "./browserAnnotationModel";

/** Live layout is presentation only; captured context and screenshot stay immutable. */
export interface BrowserAnnotationAnchor {
  viewportSize: BrowserAnnotationSize;
  targetRect: BrowserAnnotationRect | null;
}

export function readAnnotationAnchor(value: unknown): BrowserAnnotationAnchor {
  const source = annotationRecord(value);
  const viewport = annotationRecord(source.viewportSize);
  const finite = (value: unknown, min: number, max: number): number => {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < min ||
      value > max
    )
      throw new Error("Invalid Browser annotation anchor geometry");
    return value;
  };
  const width = finite(viewport.width, 1, 20000),
    height = finite(viewport.height, 1, 20000);
  let targetRect: BrowserAnnotationRect | null = null;
  if (source.targetRect !== null) {
    const rect = annotationRecord(source.targetRect);
    targetRect = {
      x: finite(rect.x, 0, width),
      y: finite(rect.y, 0, height),
      width: finite(rect.width, 0.1, width),
      height: finite(rect.height, 0.1, height),
    };
    if (
      targetRect.x + targetRect.width > width + 0.01 ||
      targetRect.y + targetRect.height > height + 0.01
    )
      throw new Error("Browser annotation anchor is outside the viewport");
  }
  return { viewportSize: { width, height }, targetRect };
}
