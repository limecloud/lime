/// <reference lib="dom" />
import type {
  BrowserAnnotationPoint,
  BrowserAnnotationRect,
} from "../src/lib/api/browserAnnotationTypes";
import type { AnnotationTextSelection } from "./browserAnnotationText";
import {
  annotationElementAt,
  annotationParent,
  annotationSelector,
  annotationShadowHosts,
  annotationUnrotated,
} from "./browserAnnotationTextLocator";

type TextControl = HTMLInputElement | HTMLTextAreaElement;
export interface AnnotationFormTextGesture {
  kind: "form-control";
  element: TextControl;
  value: string;
  anchor: number;
  focus: number;
}

const inputTypes = new Set(["email", "search", "tel", "text", "url"]);
const mirrorNodes = new WeakSet<Node>();
const properties =
  "borderBottomStyle.borderBottomWidth.borderLeftStyle.borderLeftWidth.borderRightStyle.borderRightWidth.borderTopStyle.borderTopWidth.direction.fontFamily.fontFeatureSettings.fontKerning.fontSize.fontStretch.fontStyle.fontVariant.fontWeight.letterSpacing.lineHeight.paddingBottom.paddingLeft.paddingRight.paddingTop.tabSize.textAlign.textIndent.textTransform.wordBreak.wordSpacing".split(
    ".",
  ) as (keyof CSSStyleDeclaration)[];

function allowed(element: Element): element is TextControl {
  if (
    !element.isConnected ||
    element.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
    !(
      element.localName === "textarea" ||
      (element.localName === "input" &&
        inputTypes.has((element as HTMLInputElement).type))
    ) ||
    !annotationUnrotated(element)
  )
    return false;
  for (
    let node: Element | null = element;
    node;
    node = annotationParent(node)
  ) {
    const style = node.ownerDocument.defaultView!.getComputedStyle(node);
    const security = style.getPropertyValue("-webkit-text-security");
    if (
      node.matches("[hidden], [inert]") ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.userSelect === "none" ||
      (security && security !== "none")
    )
      return false;
  }
  return true;
}

/** Mirrors never receive input and are removed synchronously, including failed hit tests. */
function withMirror<T>(
  element: TextControl,
  hitTest: boolean,
  read: (mirror: HTMLDivElement, bounds: DOMRect) => T,
): T | null {
  const doc = element.ownerDocument;
  if (!allowed(element) || !doc.body || element.value.length > 1e6) return null;
  const bounds = element.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const scaleX =
    element.offsetWidth > 0 ? bounds.width / element.offsetWidth : 1;
  const scaleY =
    element.offsetHeight > 0 ? bounds.height / element.offsetHeight : 1;
  const style = doc.defaultView!.getComputedStyle(element);
  const mirror = doc.createElement("div");
  mirrorNodes.add(mirror);
  mirror.setAttribute("data-browser-comment-text-selection-mirror", "");
  Object.assign(mirror.style, {
    all: "initial",
    display: "block",
    position: "fixed",
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${bounds.width / scaleX}px`,
    height: `${bounds.height / scaleY}px`,
    overflow: "auto",
    visibility: hitTest ? "visible" : "hidden",
    opacity: "0",
    pointerEvents: hitTest ? "auto" : "none",
    zIndex: "2147483647",
    whiteSpace: element.localName === "textarea" ? "pre-wrap" : "pre",
    overflowWrap: element.localName === "textarea" ? "break-word" : "normal",
    transform: `scale(${scaleX}, ${scaleY})`,
    transformOrigin: "top left",
  });
  for (const property of properties) {
    // Copy only the known layout properties; CSSStyleDeclaration has non-style members too.
    (mirror.style as unknown as Record<string, unknown>)[property] =
      style[property];
  }
  mirror.style.boxSizing = "border-box";
  try {
    return read(mirror, bounds);
  } finally {
    mirror.remove();
  }
}

function mount(mirror: HTMLDivElement, element: TextControl) {
  element.ownerDocument.body.append(mirror);
  mirror.scrollLeft = element.scrollLeft;
  mirror.scrollTop = element.scrollTop;
}

function offsetAt(
  element: TextControl,
  point: BrowserAnnotationPoint,
): number | null {
  return withMirror(element, true, (mirror, bounds) => {
    const text = element.ownerDocument.createTextNode(element.value);
    mirror.append(text);
    mount(mirror, element);
    const doc = element.ownerDocument as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const x = Math.max(
      bounds.left + 0.1,
      Math.min(bounds.right - 0.1, point.x),
    );
    const y = Math.max(
      bounds.top + 0.1,
      Math.min(bounds.bottom - 0.1, point.y),
    );
    const position = doc.caretPositionFromPoint?.(x, y);
    const range = position ? null : doc.caretRangeFromPoint?.(x, y);
    const node = position?.offsetNode ?? range?.startContainer;
    const offset = position?.offset ?? range?.startOffset;
    if (
      node !== text ||
      offset === undefined ||
      offset < 0 ||
      offset > text.length
    )
      return null;
    // The control is already hit-tested. Native form selection snaps through line leading
    // and padding; requiring glyph pixels would turn scrolled text into region drags.
    return offset;
  });
}

export function beginAnnotationFormText(
  point: BrowserAnnotationPoint,
  doc: Document = document,
): AnnotationFormTextGesture | null {
  const element = annotationElementAt(point, doc);
  if (!element || !allowed(element)) return null;
  const anchor = offsetAt(element, point);
  return anchor === null
    ? null
    : {
        kind: "form-control",
        element,
        value: element.value,
        anchor,
        focus: anchor,
      };
}

export function annotationFormTextUnchanged(
  gesture: AnnotationFormTextGesture,
): boolean {
  return allowed(gesture.element) && gesture.element.value === gesture.value;
}

export function moveAnnotationFormText(
  gesture: AnnotationFormTextGesture,
  point: BrowserAnnotationPoint,
): AnnotationTextSelection | null {
  if (!annotationFormTextUnchanged(gesture)) return null;
  const focus = offsetAt(gesture.element, point);
  if (focus === null) return null;
  gesture.focus = focus;
  return readAnnotationFormText(gesture);
}

export function readAnnotationFormText(
  gesture: AnnotationFormTextGesture,
): AnnotationTextSelection | null {
  if (!annotationFormTextUnchanged(gesture)) return null;
  const startOffset = Math.min(gesture.anchor, gesture.focus),
    endOffset = Math.max(gesture.anchor, gesture.focus);
  const targetText = gesture.value.slice(startOffset, endOffset);
  if (!targetText.trim() || targetText.length > 20000) return null;
  const selectionRects = withMirror(
    gesture.element,
    false,
    (mirror, bounds) => {
      const doc = gesture.element.ownerDocument;
      const selected = doc.createElement("span");
      selected.textContent = targetText;
      mirror.append(
        gesture.value.slice(0, startOffset),
        selected,
        gesture.value.slice(endOffset),
      );
      mount(mirror, gesture.element);
      const result: BrowserAnnotationRect[] = [];
      const rects = selected.getClientRects();
      if (rects.length > 1000) return result;
      for (const rect of Array.from(rects)) {
        const x = Math.max(0, bounds.left, rect.left),
          y = Math.max(0, bounds.top, rect.top);
        const right = Math.min(
            doc.defaultView!.innerWidth,
            bounds.right,
            rect.right,
          ),
          bottom = Math.min(
            doc.defaultView!.innerHeight,
            bounds.bottom,
            rect.bottom,
          );
        if (right > x && bottom > y)
          result.push({ x, y, width: right - x, height: bottom - y });
      }
      return result;
    },
  );
  if (!selectionRects?.length) return null;
  const x = Math.min(...selectionRects.map((rect) => rect.x)),
    y = Math.min(...selectionRects.map((rect) => rect.y));
  const right = Math.max(...selectionRects.map((rect) => rect.x + rect.width)),
    bottom = Math.max(...selectionRects.map((rect) => rect.y + rect.height));
  return {
    targetText,
    targetRect: { x, y, width: right - x, height: bottom - y },
    selectionRects,
    textLocator: {
      kind: "form-control",
      selector: annotationSelector(gesture.element),
      shadowHosts: annotationShadowHosts(gesture.element),
      direction: gesture.anchor <= gesture.focus ? "forward" : "backward",
      startOffset,
      endOffset,
    },
  };
}

/** Use object identity so a page cannot disguise its mutations with our marker attribute. */
export function isAnnotationTextMirrorMutation(
  record: MutationRecord,
): boolean {
  const nodes = [
    ...Array.from(record.addedNodes),
    ...Array.from(record.removedNodes),
  ];
  return (
    record.type === "childList" &&
    nodes.length > 0 &&
    nodes.every((node) => mirrorNodes.has(node))
  );
}
