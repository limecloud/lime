/// <reference lib="dom" />
import type { BrowserAnnotationRect } from "../src/lib/api/browserAnnotationTypes";
import { annotationParent } from "./browserAnnotationTextLocator";

export function intersectAnnotationRect(
  a: BrowserAnnotationRect,
  b: BrowserAnnotationRect,
): BrowserAnnotationRect | null {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width),
    bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

/** Clip one container's padding box in viewport pixels, including positive CSS scale. */
export function clipAnnotationOverflow(
  rect: BrowserAnnotationRect,
  element: Element,
): BrowserAnnotationRect | null {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style || style.display === "none" || style.visibility === "hidden")
    return null;
  const clips = (value: string) => /^(auto|scroll|hidden|clip)$/u.test(value);
  const x = clips(style.overflowX || style.overflow),
    y = clips(style.overflowY || style.overflow);
  if (!x && !y) return rect;
  const box = element.getBoundingClientRect();
  const scaleX = element.clientWidth
    ? box.width / ((element as HTMLElement).offsetWidth || box.width)
    : 1;
  const scaleY = element.clientHeight
    ? box.height / ((element as HTMLElement).offsetHeight || box.height)
    : 1;
  return intersectAnnotationRect(rect, {
    x: x ? box.x + element.clientLeft * scaleX : rect.x,
    y: y ? box.y + element.clientTop * scaleY : rect.y,
    width: x ? element.clientWidth * scaleX : rect.width,
    height: y ? element.clientHeight * scaleY : rect.height,
  });
}

/** Clip against composed overflow ancestors, including hosts outside an open shadow root. */
export function clipAnnotationRect(
  rect: BrowserAnnotationRect,
  element: Element,
): BrowserAnnotationRect | null {
  let result: BrowserAnnotationRect | null = rect;
  for (
    let node: Element | null = element;
    node && result;
    node = annotationParent(node)
  ) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (!style || style.display === "none" || style.visibility === "hidden")
      return null;
    if (node === element) continue;
    result = clipAnnotationOverflow(result, node);
  }
  return result;
}
