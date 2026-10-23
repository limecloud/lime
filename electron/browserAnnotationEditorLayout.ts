import type { Rectangle } from "electron";
import type { BrowserAnnotationAnchor } from "./browserAnnotationAnchor";
import type {
  BrowserAnnotationEditorLayout,
  BrowserAnnotationEditorPresentation,
} from "../src/lib/api/browserAnnotationEditorTypes";

export function annotationEditorConstraints(
  window: Rectangle,
): BrowserAnnotationEditorLayout {
  return {
    width: Math.max(1, Math.min(360, Math.floor(window.width) - 16)),
    maxHeight: Math.max(1, Math.min(20_000, Math.floor(window.height) - 16)),
  };
}

export function annotationEditorBounds(
  window: Rectangle,
  page: Rectangle,
  presentation: BrowserAnnotationEditorPresentation | BrowserAnnotationAnchor,
  requestedHeight = 264,
): Rectangle {
  if (
    ![
      page.x,
      page.y,
      page.width,
      page.height,
      window.width,
      window.height,
    ].every(Number.isFinite) ||
    page.x < 0 ||
    page.y < 0 ||
    page.width <= 0 ||
    page.height <= 0 ||
    window.width <= 0 ||
    window.height <= 0 ||
    page.x + page.width > window.width + 1 ||
    page.y + page.height > window.height + 1
  )
    throw new Error("Browser annotation editor page bounds are invalid");
  const { width, maxHeight } = annotationEditorConstraints(window);
  const height = Math.max(1, Math.min(maxHeight, requestedHeight));
  const { targetRect: target, viewportSize } =
    "selection" in presentation ? presentation.selection : presentation;
  if (!target)
    return {
      x: Math.round(Math.min(page.x + 8, window.width - width)),
      y: Math.round(Math.min(page.y + 8, window.height - height)),
      width,
      height,
    };
  const left = page.x + (target.x * page.width) / viewportSize.width;
  const top = page.y + (target.y * page.height) / viewportSize.height;
  let x = left + (target.width * page.width) / viewportSize.width + 12;
  if (x + width > window.width - 8) x = left - width - 12;
  return {
    x: Math.round(Math.max(0, Math.min(window.width - width, x))),
    y: Math.round(Math.max(0, Math.min(window.height - height, top))),
    width,
    height,
  };
}
