/// <reference lib="dom" />
import { clipAnnotationRect } from "./browserAnnotationAnchorGeometry";
import type {
  BrowserAnnotationFrameLocator,
  BrowserAnnotationPoint,
  BrowserAnnotationRect,
} from "../src/lib/api/browserAnnotationTypes";
import {
  annotationElementAt,
  annotationSelector,
  annotationShadowHosts,
  annotationUnrotated,
} from "./browserAnnotationTextLocator";

interface FrameStep {
  element: HTMLIFrameElement;
  document: Document;
}

/** Document object identity retires a frame after navigation, even when its URL is unchanged. */
export interface AnnotationFrameContext {
  root: Document;
  document: Document;
  frames: FrameStep[];
}

export function annotationRootFrame(
  root: Document = document,
): AnnotationFrameContext {
  return { root, document: root, frames: [] };
}

function intersect(
  a: BrowserAnnotationRect,
  b: BrowserAnnotationRect,
): BrowserAnnotationRect | null {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

function viewport(doc: Document): BrowserAnnotationRect {
  return {
    x: 0,
    y: 0,
    width: doc.defaultView?.innerWidth ?? 0,
    height: doc.defaultView?.innerHeight ?? 0,
  };
}

function geometry(step: FrameStep) {
  const { element, document: doc } = step;
  if (
    !element.isConnected ||
    element.contentDocument !== doc ||
    !doc.defaultView ||
    !annotationUnrotated(element)
  )
    return null;
  const bounds = element.getBoundingClientRect();
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style || style.display === "none" || style.visibility === "hidden")
    return null;
  const padding = (side: string) =>
    Number.parseFloat(style.getPropertyValue(`padding-${side}`)) || 0;
  const left = padding("left"),
    top = padding("top");
  const scaleX = bounds.width / element.offsetWidth,
    scaleY = bounds.height / element.offsetHeight;
  const rect = {
    x: bounds.x + (element.clientLeft + left) * scaleX,
    y: bounds.y + (element.clientTop + top) * scaleY,
    width: (element.clientWidth - left - padding("right")) * scaleX,
    height: (element.clientHeight - top - padding("bottom")) * scaleY,
  };
  const sx = rect.width / doc.defaultView.innerWidth,
    sy = rect.height / doc.defaultView.innerHeight;
  return Object.values(rect).every(Number.isFinite) && sx > 0 && sy > 0
    ? { rect, sx, sy }
    : null;
}

export function annotationFrameCurrent(
  context: AnnotationFrameContext,
): boolean {
  try {
    let doc = context.root;
    if (!doc.defaultView || doc.defaultView.document !== doc) return false;
    for (const step of context.frames) {
      if (step.element.ownerDocument !== doc || !geometry(step)) return false;
      doc = step.document;
    }
    return doc === context.document;
  } catch {
    return false;
  }
}

/** The main-frame shield stays in place while hit testing descends accessible documents. */
export function annotationFrameAt(
  point: BrowserAnnotationPoint,
  root: Document = document,
) {
  const context = annotationRootFrame(root);
  let local = { ...point };
  let element = annotationElementAt(local, context.document);
  while (element?.localName === "iframe" && context.frames.length < 32) {
    let child: Document | null;
    try {
      child = (element as HTMLIFrameElement).contentDocument;
    } catch {
      break;
    }
    if (!child) break;
    const step = { element: element as HTMLIFrameElement, document: child };
    const mapped = geometry(step);
    if (
      !mapped ||
      !intersect({ ...local, width: 0.01, height: 0.01 }, mapped.rect)
    )
      break;
    const next = {
      x: (local.x - mapped.rect.x) / mapped.sx,
      y: (local.y - mapped.rect.y) / mapped.sy,
    };
    const hit = annotationElementAt(next, child);
    if (!hit) break;
    context.frames.push(step);
    context.document = child;
    local = next;
    element = hit;
  }
  return { context, point: local, element };
}

export function annotationFramePoint(
  context: AnnotationFrameContext,
  point: BrowserAnnotationPoint,
): BrowserAnnotationPoint | null {
  if (!annotationFrameCurrent(context)) return null;
  let local = { ...point };
  for (const step of context.frames) {
    const mapped = geometry(step)!;
    local = {
      x: (local.x - mapped.rect.x) / mapped.sx,
      y: (local.y - mapped.rect.y) / mapped.sy,
    };
  }
  return local;
}

/** Capture geometry always belongs to the top-level viewport, including iframe clipping. */
export function annotationFrameRect(
  context: AnnotationFrameContext,
  rect: BrowserAnnotationRect,
): BrowserAnnotationRect | null {
  if (!annotationFrameCurrent(context)) return null;
  let mapped = intersect(rect, viewport(context.document));
  for (
    let index = context.frames.length - 1;
    index >= 0 && mapped;
    index -= 1
  ) {
    const step = context.frames[index],
      frame = geometry(step)!;
    mapped = intersect(
      {
        x: frame.rect.x + mapped.x * frame.sx,
        y: frame.rect.y + mapped.y * frame.sy,
        width: mapped.width * frame.sx,
        height: mapped.height * frame.sy,
      },
      frame.rect,
    );
    if (mapped) mapped = clipAnnotationRect(mapped, step.element);
    if (mapped)
      mapped = intersect(mapped, viewport(step.element.ownerDocument));
  }
  return mapped;
}

export function annotationFramePath(
  context: AnnotationFrameContext,
): BrowserAnnotationFrameLocator[] {
  return context.frames.map(({ element }) => ({
    selector: annotationSelector(element),
    shadowHosts: annotationShadowHosts(element),
  }));
}
