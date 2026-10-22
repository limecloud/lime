/// <reference lib="dom" />
/* global process */
import { ipcRenderer } from "electron";
import {
  BROWSER_ANNOTATION_PAGE_COMMAND,
  BROWSER_ANNOTATION_PAGE_EVENT,
} from "./browserAnnotationModel";
import type {
  BrowserAnnotationKind,
  BrowserAnnotationRect,
  BrowserAnnotationSelection,
} from "../src/lib/api/browserAnnotationTypes";

interface PageAnnotation {
  annotationId: string;
  token: string;
  pageRevision: number;
  kind: BrowserAnnotationKind;
  element: Element | null;
  selection: BrowserAnnotationSelection | null;
  requestId: string | null;
}

/** Isolated-world page input only. No capability is exposed to the page's main world. */
export function installBrowserPageAnnotations(): () => void {
  const documentToken = Array.from(
    crypto.getRandomValues(new Uint32Array(4)),
    (value) => value.toString(16),
  ).join("-");
  let current: PageAnnotation | null = null;
  let root: HTMLDivElement | null = null;
  let highlight: HTMLDivElement | null = null;
  let marker: HTMLDivElement | null = null;
  let start: { x: number; y: number } | null = null;
  let hover: Element | null = null;
  let observer: MutationObserver | null = null;

  const send = (entry: PageAnnotation, payload: Record<string, unknown>) => {
    ipcRenderer.send(BROWSER_ANNOTATION_PAGE_EVENT, {
      ...payload,
      annotationId: entry.annotationId,
      token: entry.token,
      pageRevision: entry.pageRevision,
      documentToken,
    });
  };
  const stop = () => {
    observer?.disconnect();
    observer = null;
    current = null;
    start = null;
    hover = null;
    root?.remove();
    root = null;
    highlight = null;
    marker = null;
  };
  const cancel = (reason: string) => {
    if (current) send(current, { type: "cancel", reason });
    stop();
  };
  const visibleRect = (
    rect: BrowserAnnotationRect,
  ): BrowserAnnotationRect | null => {
    const x = Math.max(0, rect.x),
      y = Math.max(0, rect.y);
    const right = Math.min(innerWidth, rect.x + rect.width),
      bottom = Math.min(innerHeight, rect.y + rect.height);
    return right > x && bottom > y
      ? { x, y, width: right - x, height: bottom - y }
      : null;
  };
  const draw = (rect: BrowserAnnotationRect, withMarker = false) => {
    if (!root || !highlight || !marker) return;
    root.style.display = "block";
    Object.assign(highlight.style, {
      display: "block",
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    marker.style.display = withMarker ? "grid" : "none";
    Object.assign(marker.style, {
      left: `${Math.min(innerWidth - 12, Math.max(12, rect.x)) - 11}px`,
      top: `${Math.min(innerHeight - 12, Math.max(12, rect.y)) - 11}px`,
    });
  };
  const selector = (element: Element): string => {
    const escape = (text: string) =>
      text.replace(
        /[^a-zA-Z0-9_-]/gu,
        (character) => `\\${character.codePointAt(0)!.toString(16)} `,
      );
    if (element.id) return `#${escape(element.id)}`;
    const parts: string[] = [];
    let node: Element | null = element;
    for (
      let depth = 0;
      node && depth < 8;
      depth += 1, node = node.parentElement
    ) {
      const tag = node.localName;
      const siblings: Element[] = node.parentElement
        ? Array.from(node.parentElement.children).filter(
            (child) => child.localName === tag,
          )
        : [node];
      parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(node) + 1})`);
    }
    return parts.join(" > ");
  };
  const selection = (
    entry: PageAnnotation,
    rect: BrowserAnnotationRect,
  ): BrowserAnnotationSelection => ({
    kind: entry.kind,
    pageUrl: location.href,
    pageTitle: document.title,
    frameUrl: location.href,
    framePath: "main",
    targetRect: rect,
    viewportSize: { width: innerWidth, height: innerHeight },
    scrollPosition: { x: scrollX, y: scrollY },
    devicePixelRatio,
    targetSelector: entry.element ? selector(entry.element) : null,
    targetPath: entry.element ? selector(entry.element) : null,
    targetRole:
      entry.element?.getAttribute("role") ?? entry.element?.localName ?? null,
    targetText: entry.element
      ? (
          entry.element.getAttribute("aria-label") ??
          entry.element.textContent ??
          ""
        )
          .trim()
          .slice(0, 8192)
      : null,
    markerViewportPoint: {
      x: Math.min(innerWidth - 12, Math.max(12, rect.x)),
      y: Math.min(innerHeight - 12, Math.max(12, rect.y)),
    },
  });
  const liveSelection = (
    entry: PageAnnotation,
  ): BrowserAnnotationSelection | null => {
    const rect =
      entry.kind === "element"
        ? entry.element?.isConnected
          ? visibleRect(entry.element.getBoundingClientRect())
          : null
        : entry.selection?.targetRect;
    return rect ? selection(entry, rect) : null;
  };
  const commit = (entry: PageAnnotation, rect: BrowserAnnotationRect) => {
    entry.selection = selection(entry, rect);
    draw(rect, true);
    start = null;
    observer = new MutationObserver((records) => {
      if (
        entry.kind === "element" &&
        current === entry &&
        records.some(
          (record) => record.target !== root && !root?.contains(record.target),
        ) &&
        JSON.stringify(liveSelection(entry)) !== JSON.stringify(entry.selection)
      )
        cancel("document-changed");
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    send(entry, { type: "selection", selection: entry.selection });
  };
  const point = (event: PointerEvent) => ({
    x: Math.max(0, Math.min(innerWidth, event.clientX)),
    y: Math.max(0, Math.min(innerHeight, event.clientY)),
  });
  const region = (event: PointerEvent): BrowserAnnotationRect | null => {
    if (!start) return null;
    const end = point(event);
    return visibleRect({
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    });
  };
  const suppress = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const pick = (event: PointerEvent): Element | null => {
    // The input shield also covers child frames; select only their main-frame container.
    if (root) root.style.pointerEvents = "none";
    try {
      return document.elementFromPoint(event.clientX, event.clientY);
    } finally {
      if (root) root.style.pointerEvents = "auto";
    }
  };
  const move = (event: PointerEvent) => {
    const entry = current;
    if (!entry || entry.selection) return;
    if (start) {
      suppress(event);
      const rect = region(event);
      if (rect) draw(rect);
    } else {
      hover = pick(event);
      const rect = hover ? visibleRect(hover.getBoundingClientRect()) : null;
      if (rect) draw(rect);
    }
  };
  const down = (event: PointerEvent) => {
    const entry = current;
    if (!entry || entry.selection || event.button !== 0) return;
    suppress(event);
    start = point(event);
    if (entry.kind === "element") {
      entry.element = pick(event);
    }
  };
  const up = (event: PointerEvent) => {
    const entry = current;
    if (!entry || entry.selection || !start || event.button !== 0) return;
    suppress(event);
    const rect = region(event);
    const dragged =
      Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 4;
    if (
      rect &&
      rect.width >= 2 &&
      rect.height >= 2 &&
      (entry.kind === "region" || dragged)
    ) {
      entry.kind = "region";
      entry.element = null;
      commit(entry, rect);
    } else if (entry.kind === "element" && !dragged && entry.element) {
      const elementRect = visibleRect(entry.element.getBoundingClientRect());
      if (elementRect) commit(entry, elementRect);
      else start = null;
    } else {
      start = null;
      if (highlight) highlight.style.display = "none";
    }
  };
  const click = (event: MouseEvent) => {
    if (current) suppress(event);
  };
  const key = (event: KeyboardEvent) => {
    if (current && event.key === "Escape") {
      suppress(event);
      cancel("escape");
    }
  };
  const viewport = () => {
    if (current) cancel("viewport-changed");
  };
  const command = (_event: unknown, value: unknown) => {
    if (!value || typeof value !== "object") return;
    const message = value as Record<string, unknown>;
    if (message.type === "begin") {
      if (
        typeof message.annotationId !== "string" ||
        typeof message.token !== "string" ||
        !Number.isSafeInteger(message.pageRevision) ||
        (message.kind !== "element" && message.kind !== "region")
      )
        return;
      stop();
      current = {
        annotationId: message.annotationId,
        token: message.token,
        pageRevision: message.pageRevision as number,
        kind: message.kind,
        element: null,
        selection: null,
        requestId: null,
      };
      root = document.createElement("div");
      Object.assign(root.style, {
        all: "initial",
        position: "fixed",
        inset: "0",
        zIndex: "2147483647",
        pointerEvents: "auto",
        cursor: "crosshair",
        display: "block",
      });
      const shadow = root.attachShadow({ mode: "closed" });
      highlight = document.createElement("div");
      Object.assign(highlight.style, {
        position: "absolute",
        boxSizing: "border-box",
        border: "2px solid #8b5cf6",
        background: "rgba(139,92,246,0.12)",
        pointerEvents: "none",
        display: "none",
      });
      marker = document.createElement("div");
      marker.textContent = "1";
      Object.assign(marker.style, {
        position: "absolute",
        width: "22px",
        height: "22px",
        borderRadius: "50%",
        background: "#8b5cf6",
        color: "white",
        font: "bold 12px system-ui",
        placeItems: "center",
        display: "none",
        pointerEvents: "none",
      });
      shadow.append(highlight, marker);
      document.documentElement.append(root);
      send(current, { type: "began" });
      return;
    }
    const entry = current;
    if (
      !entry ||
      message.annotationId !== entry.annotationId ||
      message.token !== entry.token ||
      message.pageRevision !== entry.pageRevision
    )
      return;
    if (message.type === "cancel") {
      stop();
      return;
    }
    if (message.documentToken !== documentToken) return;
    if (message.type === "clear") {
      if (entry.requestId === message.requestId) {
        entry.requestId = null;
        if (highlight) highlight.style.display = "none";
        if (marker) marker.style.display = "none";
      }
      return;
    }
    if (
      message.type !== "prepare" ||
      typeof message.requestId !== "string" ||
      !entry.selection
    )
      return;
    entry.requestId = message.requestId;
    const live = liveSelection(entry);
    if (!live || JSON.stringify(live) !== JSON.stringify(entry.selection)) {
      send(entry, {
        type: "ready",
        requestId: message.requestId,
        status: "stale",
      });
      return;
    }
    draw(live.targetRect, true);
    const requestId = message.requestId;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (current === entry && entry.requestId === requestId) {
          const stillCurrent =
            JSON.stringify(liveSelection(entry)) ===
            JSON.stringify(entry.selection);
          send(entry, {
            type: "ready",
            requestId,
            status: stillCurrent ? "ready" : "stale",
            selection: live,
          });
        }
      }),
    );
  };
  ipcRenderer.on(BROWSER_ANNOTATION_PAGE_COMMAND, command);
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerdown", down, true);
  window.addEventListener("pointerup", up, true);
  window.addEventListener("click", click, true);
  window.addEventListener("keydown", key, true);
  window.addEventListener("scroll", viewport, true);
  window.addEventListener("resize", viewport, true);
  window.addEventListener("pagehide", viewport, true);
  return () => {
    stop();
    ipcRenderer.off(BROWSER_ANNOTATION_PAGE_COMMAND, command);
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerdown", down, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("click", click, true);
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("scroll", viewport, true);
    window.removeEventListener("resize", viewport, true);
    window.removeEventListener("pagehide", viewport, true);
  };
}

if (process.isMainFrame) installBrowserPageAnnotations();
