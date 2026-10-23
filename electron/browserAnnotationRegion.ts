/// <reference lib="dom" />
import type {
  BrowserAnnotationPoint,
  BrowserAnnotationRect,
} from "../src/lib/api/browserAnnotationTypes";
import {
  annotationFrameCurrent,
  annotationFramePoint,
  annotationFrameRect,
  type AnnotationFrameContext,
} from "./browserAnnotationFrames";
import { clipAnnotationOverflow } from "./browserAnnotationAnchorGeometry";
import {
  annotationElementAt,
  annotationParent,
  annotationUnrotated,
} from "./browserAnnotationTextLocator";

interface RegionScroll {
  element: Element;
  x: number;
  y: number;
}

/** Private presentation state; never replace the captured selection with this geometry. */
export interface AnnotationRegion {
  frame: AnnotationFrameContext;
  element: Element | null;
  rect: BrowserAnnotationRect;
  scroll: BrowserAnnotationPoint;
  containers: RegionScroll[];
}

export function beginAnnotationRegion(
  frame: AnnotationFrameContext,
  rect: BrowserAnnotationRect,
  end: BrowserAnnotationPoint,
): AnnotationRegion | null {
  const origin = annotationFramePoint(frame, rect);
  const corner = annotationFramePoint(frame, {
    x: rect.x + rect.width,
    y: rect.y + rect.height,
  });
  const point = annotationFramePoint(frame, end);
  const win = frame.document.defaultView;
  if (!origin || !corner || !point || !win) return null;
  const element = annotationElementAt(point, frame.document);
  const containers: RegionScroll[] = [];
  for (
    let node = element;
    node &&
    node !== frame.document.body &&
    node !== frame.document.documentElement;
    node = annotationParent(node)
  ) {
    const style = win.getComputedStyle(node);
    if (
      [style.overflowX, style.overflowY, style.overflow].some((value) =>
        /^(auto|scroll|hidden|clip)$/u.test(value),
      )
    )
      containers.push({ element: node, x: node.scrollLeft, y: node.scrollTop });
  }
  return {
    frame,
    element,
    rect: {
      ...origin,
      width: corner.x - origin.x,
      height: corner.y - origin.y,
    },
    scroll: { x: win.scrollX, y: win.scrollY },
    containers,
  };
}

/** Regions follow document/container scroll even when the pixels cover a fixed element. */
export function readAnnotationRegion(
  region: AnnotationRegion,
): BrowserAnnotationRect | null {
  if (!annotationFrameCurrent(region.frame)) return null;
  const win = region.frame.document.defaultView!;
  let x = region.rect.x + region.scroll.x - win.scrollX,
    y = region.rect.y + region.scroll.y - win.scrollY;
  for (const saved of region.containers) {
    const node = saved.element;
    if (!node.isConnected || !annotationUnrotated(node)) return null;
    const bounds = node.getBoundingClientRect();
    const sx =
        bounds.width / ((node as HTMLElement).offsetWidth || bounds.width),
      sy =
        bounds.height / ((node as HTMLElement).offsetHeight || bounds.height);
    if (![sx, sy].every((scale) => Number.isFinite(scale) && scale > 0))
      return null;
    x -= (node.scrollLeft - saved.x) * sx;
    y -= (node.scrollTop - saved.y) * sy;
  }
  let rect: BrowserAnnotationRect | null = { ...region.rect, x, y };
  for (const saved of region.containers) {
    rect = clipAnnotationOverflow(rect, saved.element);
    if (!rect) return null;
  }
  return annotationFrameRect(region.frame, rect);
}
