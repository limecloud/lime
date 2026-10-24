import type { BrowserAnnotationCaptureResult } from "./browserAnnotationTypes";

/** Shared strict event/command validation before a screenshot reaches the draft store. */
export function readAnnotationCapture(
  value: unknown,
  annotationId: string,
): BrowserAnnotationCaptureResult {
  const result = value as BrowserAnnotationCaptureResult;
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
  if (typeof result.failureReason !== "string" && result.failureReason !== null)
    throw new Error("Invalid browser annotation capture failure");
  if (shot) {
    const size = shot.viewportSize;
    if (
      !size ||
      ![size.width, size.height].every(
        (n) => typeof n === "number" && Number.isFinite(n) && n > 0,
      )
    )
      throw new Error("Invalid browser annotation screenshot viewport");
    if (shot.kind === "crop") {
      const rect = shot.cropRect;
      if (
        !rect ||
        ![rect.x, rect.y, rect.width, rect.height].every(
          (n) => typeof n === "number" && Number.isFinite(n),
        ) ||
        rect.x < 0 ||
        rect.y < 0 ||
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.x + rect.width > size.width ||
        rect.y + rect.height > size.height
      )
        throw new Error("Invalid browser annotation screenshot crop");
    } else if (shot.cropRect !== undefined)
      throw new Error("Unexpected browser annotation screenshot crop");
  }
  return result;
}
