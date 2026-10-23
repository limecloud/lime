/// <reference lib="dom" />
import type {
  BrowserAnnotationPoint,
  BrowserAnnotationRect,
  BrowserAnnotationTextLocator,
} from "../src/lib/api/browserAnnotationTypes";

import {
  annotationParent,
  annotationSelector,
  annotationShadowHosts,
} from "./browserAnnotationTextLocator";
import {
  beginAnnotationFormText,
  moveAnnotationFormText,
  readAnnotationFormText,
  type AnnotationFormTextGesture,
} from "./browserAnnotationFormText";

interface TextCaret {
  node: Text;
  offset: number;
}
interface AnnotationDomTextGesture {
  kind: "dom";
  anchor: TextCaret;
  range: Range | null;
  direction: "forward" | "backward";
}
export type AnnotationTextGesture =
  | AnnotationDomTextGesture
  | AnnotationFormTextGesture;

export interface AnnotationTextSelection {
  targetText: string;
  targetRect: BrowserAnnotationRect;
  selectionRects: BrowserAnnotationRect[];
  textLocator: BrowserAnnotationTextLocator;
}

function selectable(node: Text): boolean {
  if (!node.isConnected || !node.ownerDocument.defaultView) return false;
  for (
    let element: Element | null = node.parentElement;
    element;
    element = annotationParent(element)
  ) {
    if (
      element.matches(
        "input, textarea, button, select, option, audio, video, script, style, [hidden], [inert]",
      )
    )
      return false;
    const style = element.ownerDocument.defaultView!.getComputedStyle(element);
    if (
      style.userSelect === "none" ||
      style.visibility === "hidden" ||
      style.display === "none"
    )
      return false;
    const security = style.getPropertyValue("-webkit-text-security");
    if (security && security !== "none") return false;
  }
  return true;
}

function caretAt(
  point: BrowserAnnotationPoint,
  owner: Document,
): TextCaret | null {
  const shadows: ShadowRoot[] = [];
  let root: Document | ShadowRoot = owner;
  let hit: Element | null = root.elementFromPoint(point.x, point.y);
  while (hit?.shadowRoot) {
    root = hit.shadowRoot;
    shadows.push(root);
    hit = root.elementFromPoint(point.x, point.y);
  }
  const doc = owner as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
      options: { shadowRoots: ShadowRoot[] },
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = doc.caretPositionFromPoint?.(point.x, point.y, {
    shadowRoots: shadows,
  });
  const range = position ? null : doc.caretRangeFromPoint?.(point.x, point.y);
  const node = position?.offsetNode ?? range?.startContainer;
  const offset = position?.offset ?? range?.startOffset;
  return node?.nodeType === 3 &&
    offset !== undefined &&
    selectable(node as Text)
    ? { node: node as Text, offset }
    : null;
}

/** Caret hit testing alone snaps whitespace to nearby text; require an actual glyph hit. */
export function beginAnnotationText(
  point: BrowserAnnotationPoint,
  doc: Document = document,
): AnnotationTextGesture | null {
  const form = beginAnnotationFormText(point, doc);
  if (form) return form;
  const caret = caretAt(point, doc);
  if (!caret) return null;
  const glyph = doc.createRange();
  for (const offset of [caret.offset - 1, caret.offset]) {
    if (offset < 0 || offset >= caret.node.length) continue;
    glyph.setStart(caret.node, offset);
    glyph.setEnd(caret.node, offset + 1);
    if (
      Array.from(glyph.getClientRects()).some(
        (rect) =>
          point.x >= rect.left &&
          point.x <= rect.right &&
          point.y >= rect.top &&
          point.y <= rect.bottom,
      )
    ) {
      return { kind: "dom", anchor: caret, range: null, direction: "forward" };
    }
  }
  return null;
}

export function moveAnnotationText(
  gesture: AnnotationTextGesture,
  point: BrowserAnnotationPoint,
): AnnotationTextSelection | null {
  if (gesture.kind === "form-control")
    return moveAnnotationFormText(gesture, point);
  gesture.range = null;
  const doc = gesture.anchor.node.ownerDocument;
  const focus = caretAt(point, doc);
  if (
    !focus ||
    !selectable(gesture.anchor.node) ||
    focus.node.getRootNode() !== gesture.anchor.node.getRootNode()
  )
    return null;
  const anchor = doc.createRange();
  anchor.setStart(gesture.anchor.node, gesture.anchor.offset);
  anchor.collapse(true);
  const endpoint = doc.createRange();
  endpoint.setStart(focus.node, focus.offset);
  endpoint.collapse(true);
  const forward =
    anchor.compareBoundaryPoints(Range.START_TO_START, endpoint) <= 0;
  const range = doc.createRange();
  range.setStart(
    forward ? gesture.anchor.node : focus.node,
    forward ? gesture.anchor.offset : focus.offset,
  );
  range.setEnd(
    forward ? focus.node : gesture.anchor.node,
    forward ? focus.offset : gesture.anchor.offset,
  );
  gesture.range = range;
  gesture.direction = forward ? "forward" : "backward";
  return readAnnotationText(gesture);
}

export function readAnnotationText(
  gesture: AnnotationTextGesture,
): AnnotationTextSelection | null {
  if (gesture.kind === "form-control") return readAnnotationFormText(gesture);
  const range = gesture.range;
  if (
    !range ||
    range.collapsed ||
    !range.startContainer.isConnected ||
    !range.endContainer.isConnected
  )
    return null;
  const targetText = range.toString();
  if (!targetText.trim() || targetText.length > 20000) return null;
  const container =
    range.commonAncestorContainer.nodeType === 1
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement;
  if (!container) return null;
  const doc = container.ownerDocument;
  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  let offset = 0,
    startOffset = -1,
    endOffset = -1,
    count = 0;
  while ((node = walker.nextNode())) {
    if (++count > 20000) return null;
    const includesText =
      (node !== range.startContainer ||
        range.startOffset < (node as Text).length) &&
      (node !== range.endContainer || range.endOffset > 0);
    if (includesText && range.intersectsNode(node) && !selectable(node as Text))
      return null;
    if (node === range.startContainer) startOffset = offset + range.startOffset;
    if (node === range.endContainer) endOffset = offset + range.endOffset;
    offset += (node as Text).length;
  }
  if (startOffset < 0 || endOffset <= startOffset) return null;
  const selectionRects: BrowserAnnotationRect[] = [];
  const rectangles = new Set<string>();
  for (const rect of Array.from(range.getClientRects())) {
    const x = Math.max(0, rect.x),
      y = Math.max(0, rect.y);
    const right = Math.min(doc.defaultView!.innerWidth, rect.right),
      bottom = Math.min(doc.defaultView!.innerHeight, rect.bottom);
    const key = [x, y, right, bottom].join(":");
    if (right > x && bottom > y && !rectangles.has(key)) {
      selectionRects.push({ x, y, width: right - x, height: bottom - y });
      rectangles.add(key);
    }
    if (selectionRects.length > 1000) return null;
  }
  if (!selectionRects.length) return null;
  const x = Math.min(...selectionRects.map((rect) => rect.x)),
    y = Math.min(...selectionRects.map((rect) => rect.y));
  const right = Math.max(...selectionRects.map((rect) => rect.x + rect.width)),
    bottom = Math.max(...selectionRects.map((rect) => rect.y + rect.height));
  const shadowHosts = annotationShadowHosts(container);
  return {
    targetText,
    targetRect: { x, y, width: right - x, height: bottom - y },
    selectionRects,
    textLocator: {
      kind: "dom",
      selector: annotationSelector(container),
      shadowHosts,
      direction: gesture.direction,
      rangeText: targetText,
      startOffset,
      endOffset,
    },
  };
}
