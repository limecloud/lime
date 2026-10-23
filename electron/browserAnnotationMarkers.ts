/// <reference lib="dom" />
import type {
  BrowserAnnotationKind,
  BrowserAnnotationSelection,
} from "../src/lib/api/browserAnnotationTypes";
import type { BrowserAnnotationAnchorLayer } from "./browserAnnotationAnchorLayer";
import { clipAnnotationRect } from "./browserAnnotationAnchorGeometry";
import {
  readAnnotationText,
  type AnnotationTextGesture,
} from "./browserAnnotationText";
import {
  readAnnotationRegion,
  type AnnotationRegion,
} from "./browserAnnotationRegion";
import {
  annotationFrameCurrent,
  annotationFrameRect,
  type AnnotationFrameContext,
} from "./browserAnnotationFrames";

export interface PageAnnotation {
  annotationId: string;
  token: string;
  pageRevision: number;
  kind: BrowserAnnotationKind;
  element: Element | null;
  selection: BrowserAnnotationSelection | null;
  requestId: string | null;
  text: AnnotationTextGesture | null;
  region: AnnotationRegion | null;
  frame: AnnotationFrameContext;
}

/** Retained geometry is presentation only and never starts or recaptures a picker. */
export function retainAnnotationMarker(
  entry: PageAnnotation,
  anchors: BrowserAnnotationAnchorLayer,
  send: (entry: PageAnnotation, payload: Record<string, unknown>) => void,
): void {
  const captured = entry.selection!;
  const textNode =
    entry.text?.kind === "dom"
      ? entry.text.range?.commonAncestorContainer
      : null;
  const element =
    entry.element ??
    entry.region?.element ??
    (entry.text?.kind === "form-control"
      ? entry.text.element
      : textNode?.nodeType === 1
        ? (textNode as Element)
        : (textNode?.parentElement ?? null));
  anchors.add({
    id: entry.annotationId,
    documents: [
      entry.frame.root,
      ...entry.frame.frames.map((step) => step.document),
    ],
    element,
    read: () => {
      if (!annotationFrameCurrent(entry.frame)) return null;
      if (entry.kind === "region") {
        const rect = entry.region && readAnnotationRegion(entry.region);
        return rect ? { targetRect: rect } : null;
      }
      if (!element?.isConnected) return null;
      if (entry.kind === "element") {
        const local = clipAnnotationRect(
          element.getBoundingClientRect(),
          element,
        );
        const targetRect = local && annotationFrameRect(entry.frame, local);
        return targetRect ? { targetRect } : null;
      }
      const text = entry.text ? readAnnotationText(entry.text) : null;
      if (!text || text.targetText !== captured.targetText) return null;
      const selectionRects = text.selectionRects.flatMap((rect) => {
        const clipped = clipAnnotationRect(rect, element);
        const mapped = clipped && annotationFrameRect(entry.frame, clipped);
        return mapped ? [mapped] : [];
      });
      if (!selectionRects.length) return null;
      const x = Math.min(...selectionRects.map((rect) => rect.x)),
        y = Math.min(...selectionRects.map((rect) => rect.y));
      const right = Math.max(
          ...selectionRects.map((rect) => rect.x + rect.width),
        ),
        bottom = Math.max(
          ...selectionRects.map((rect) => rect.y + rect.height),
        );
      return {
        targetRect: { x, y, width: right - x, height: bottom - y },
        selectionRects,
      };
    },
    update: (anchor) => send(entry, { type: "anchor", anchor }),
    activate: () => send(entry, { type: "activate" }),
  });
}
