import { useLayoutEffect, useRef } from "react";
import type {
  BrowserAnnotationEditorBridge,
  BrowserAnnotationEditorLayout,
} from "@/lib/api/browserAnnotationEditorTypes";

/** Only reports local content height; native bounds and placement stay host-owned. */
export function useBrowserAnnotationLayout(
  bridge: BrowserAnnotationEditorBridge,
  layout: BrowserAnnotationEditorLayout,
  previewOpen: boolean,
) {
  const surface = useRef<HTMLElement>(null);
  const lastReport = useRef<{
    bridge: BrowserAnnotationEditorBridge;
    height: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  useLayoutEffect(() => {
    const node = surface.current;
    if (!node) return;
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const contentHeight = node.getBoundingClientRect().height;
      if (!previewOpen && contentHeight <= 0) return;
      const height = Math.max(
        1,
        Math.min(
          layout.maxHeight,
          previewOpen ? layout.maxHeight : Math.ceil(contentHeight + 16),
        ),
      );
      if (
        height === lastReport.current?.height &&
        bridge === lastReport.current.bridge &&
        layout.width === lastReport.current.width &&
        layout.maxHeight === lastReport.current.maxHeight
      )
        return;
      try {
        bridge.resize(height);
        lastReport.current = {
          bridge,
          height,
          width: layout.width,
          maxHeight: layout.maxHeight,
        };
      } catch {
        /* A closing renderer may lose its private transport before observer cleanup. */
      }
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(node);
    return () => {
      disposed = true;
      observer?.disconnect();
    };
  }, [bridge, layout.width, layout.maxHeight, previewOpen]);
  return surface;
}
