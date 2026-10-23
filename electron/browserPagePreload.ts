/// <reference lib="dom" />
/* global process */
import { ipcRenderer } from "electron";
import { BrowserDesignPreview } from "./browserDesignPreview";
import {
  BROWSER_ANNOTATION_PAGE_COMMAND,
  BROWSER_ANNOTATION_PAGE_EVENT,
} from "./browserAnnotationModel";
import {
  beginAnnotationText,
  moveAnnotationText,
  readAnnotationText,
} from "./browserAnnotationText";
import { annotationSelector } from "./browserAnnotationTextLocator";
import { BrowserAnnotationAnchorLayer } from "./browserAnnotationAnchorLayer";
import {
  retainAnnotationMarker,
  type PageAnnotation,
} from "./browserAnnotationMarkers";
import { beginAnnotationRegion } from "./browserAnnotationRegion";
import {
  annotationSpacePressed,
  watchAnnotationKeyboard,
} from "./browserAnnotationKeyboard";
import {
  annotationFormTextUnchanged,
  isAnnotationTextMirrorMutation,
} from "./browserAnnotationFormText";
import {
  annotationFrameAt,
  annotationFrameCurrent,
  annotationFramePath,
  annotationFramePoint,
  annotationFrameRect,
  annotationRootFrame,
} from "./browserAnnotationFrames";
import type {
  BrowserAnnotationRect,
  BrowserAnnotationSelection,
} from "../src/lib/api/browserAnnotationTypes";

/** Isolated-world page input only. No capability is exposed to the page's main world. */
export function installBrowserPageAnnotations(): () => void {
  const documentToken = Array.from(
    crypto.getRandomValues(new Uint32Array(4)),
    (value) => value.toString(16),
  ).join("-");
  let current: PageAnnotation | null = null;
  let root: HTMLDivElement | null = null;
  let highlight: HTMLDivElement | null = null;
  let textHighlights: HTMLDivElement | null = null;
  let marker: HTMLDivElement | null = null;
  let start: { x: number; y: number; pointerId: number } | null = null;
  let hover: Element | null = null;
  let observer: MutationObserver | null = null;
  let formValueTimer: ReturnType<typeof setInterval> | null = null;
  let releaseFrames: (() => void) | null = null;
  let releaseKeyboard: (() => void) | null = null;
  let suspended = false;
  let addModifierPressed = false;
  const retained = new Map<string, PageAnnotation>();
  const anchors = new BrowserAnnotationAnchorLayer();
  const designs = new BrowserDesignPreview();

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
    if (current && !retained.has(current.annotationId))
      designs.remove(current.annotationId);
    releaseKeyboard?.();
    releaseKeyboard = null;
    suspended = false;
    addModifierPressed = false;
    releaseFrames?.();
    releaseFrames = null;
    if (formValueTimer !== null) clearInterval(formValueTimer);
    formValueTimer = null;
    observer?.disconnect();
    observer = null;
    current = null;
    start = null;
    hover = null;
    root?.remove();
    root = null;
    highlight = null;
    textHighlights = null;
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
  const draw = (
    rect: BrowserAnnotationRect,
    withMarker = false,
    lines?: BrowserAnnotationRect[],
  ) => {
    if (!root || !highlight || !marker) return;
    root.style.display = "block";
    Object.assign(highlight.style, {
      display: lines ? "none" : "block",
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    textHighlights?.replaceChildren(
      ...(lines ?? []).map((line) => {
        const block = document.createElement("div");
        Object.assign(block.style, {
          position: "absolute",
          left: `${line.x}px`,
          top: `${line.y}px`,
          width: `${line.width}px`,
          height: `${line.height}px`,
          background: "rgba(139,92,246,0.24)",
          borderRadius: "2px",
        });
        return block;
      }),
    );
    marker.style.display = withMarker ? "grid" : "none";
    Object.assign(marker.style, {
      left: `${Math.min(innerWidth - 12, Math.max(12, rect.x)) - 11}px`,
      top: `${Math.min(innerHeight - 12, Math.max(12, rect.y)) - 11}px`,
    });
  };
  const selection = (
    entry: PageAnnotation,
    rect: BrowserAnnotationRect,
  ): BrowserAnnotationSelection => ({
    kind: entry.kind,
    pageUrl: location.href,
    pageTitle: document.title,
    frameUrl: entry.frame.document.location.href,
    framePath: annotationFramePath(entry.frame),
    targetRect: rect,
    viewportSize: { width: innerWidth, height: innerHeight },
    scrollPosition: { x: scrollX, y: scrollY },
    devicePixelRatio,
    targetSelector: entry.element ? annotationSelector(entry.element) : null,
    targetPath: entry.element ? annotationSelector(entry.element) : null,
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
  const textSelection = (entry: PageAnnotation) => {
    const text = entry.text ? readAnnotationText(entry.text) : null;
    if (!text) return null;
    const selectionRects = text.selectionRects.flatMap((rect) => {
      const mapped = annotationFrameRect(entry.frame, rect);
      return mapped ? [mapped] : [];
    });
    if (!selectionRects.length) return null;
    const x = Math.min(...selectionRects.map((rect) => rect.x));
    const y = Math.min(...selectionRects.map((rect) => rect.y));
    const right = Math.max(
      ...selectionRects.map((rect) => rect.x + rect.width),
    );
    const bottom = Math.max(
      ...selectionRects.map((rect) => rect.y + rect.height),
    );
    return {
      ...text,
      selectionRects,
      targetRect: { x, y, width: right - x, height: bottom - y },
    };
  };
  const liveSelection = (
    entry: PageAnnotation,
  ): BrowserAnnotationSelection | null => {
    if (!annotationFrameCurrent(entry.frame)) return null;
    if (entry.kind === "text") {
      const text = textSelection(entry);
      return text
        ? {
            ...selection(entry, text.targetRect),
            ...text,
            targetSelector: text.textLocator.selector,
            targetPath: text.textLocator.selector,
            targetRole: "text",
          }
        : null;
    }
    const rect =
      entry.kind === "element"
        ? entry.element?.isConnected
          ? annotationFrameRect(
              entry.frame,
              entry.element.getBoundingClientRect(),
            )
          : null
        : entry.selection?.targetRect;
    return rect ? selection(entry, rect) : null;
  };
  const commit = (entry: PageAnnotation, rect: BrowserAnnotationRect) => {
    entry.selection =
      entry.kind === "text" ? liveSelection(entry) : selection(entry, rect);
    if (!entry.selection) return;
    draw(rect, true, entry.selection.selectionRects);
    start = null;
    observer = new MutationObserver((records) => {
      if (
        entry.kind !== "region" &&
        current === entry &&
        records.some(
          (record) =>
            record.target !== root &&
            !root?.contains(record.target) &&
            !isAnnotationTextMirrorMutation(record),
        ) &&
        JSON.stringify(liveSelection(entry)) !== JSON.stringify(entry.selection)
      )
        cancel("document-changed");
    });
    for (const doc of [
      entry.frame.root,
      ...entry.frame.frames.map((step) => step.document),
    ]) {
      observer.observe(doc.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    }
    if (entry.text?.kind === "form-control" || entry.frame.frames.length) {
      // Programmatic value writes do not produce a DOM mutation or an input event.
      const gesture = entry.text;
      formValueTimer = setInterval(() => {
        if (
          current === entry &&
          (!annotationFrameCurrent(entry.frame) ||
            (gesture?.kind === "form-control" &&
              !annotationFormTextUnchanged(gesture)))
        )
          cancel("document-changed");
      }, 100);
    }
    const designSnapshot =
      entry.kind === "element" && entry.element
        ? designs.capture(entry.annotationId, entry.element, () =>
            annotationFrameCurrent(entry.frame),
          )
        : null;
    send(entry, {
      type: "selection",
      selection: entry.selection,
      ...(designSnapshot ? { designSnapshot } : {}),
    });
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
  const pick = (event: PointerEvent) => {
    if (root) root.style.pointerEvents = "none";
    try {
      return anchors.withoutMarkers(() => annotationFrameAt(point(event)));
    } finally {
      if (root) root.style.pointerEvents = "auto";
    }
  };
  const withoutShield = <T>(read: () => T): T => {
    if (root) root.style.pointerEvents = "none";
    try {
      return anchors.withoutMarkers(read);
    } finally {
      if (root) root.style.pointerEvents = "auto";
    }
  };
  const watchFrames = (entry: PageAnnotation) => {
    releaseFrames?.();
    const frame = entry.frame;
    const cancelFrame = () => {
      if (current === entry) cancel("frame-changed");
    };
    for (const step of frame.frames) {
      for (const type of ["scroll", "resize", "pagehide"])
        step.document.defaultView?.addEventListener(type, cancelFrame, true);
      step.element.addEventListener("load", cancelFrame);
    }
    releaseFrames = () => {
      for (const step of frame.frames) {
        for (const type of ["scroll", "resize", "pagehide"])
          step.document.defaultView?.removeEventListener(
            type,
            cancelFrame,
            true,
          );
        step.element.removeEventListener("load", cancelFrame);
      }
    };
  };
  const moveText = (entry: PageAnnotation, value: { x: number; y: number }) =>
    withoutShield(() => {
      const local = annotationFramePoint(entry.frame, value);
      return local && entry.text && moveAnnotationText(entry.text, local)
        ? textSelection(entry)
        : null;
    });
  const move = (event: PointerEvent) => {
    const entry = current;
    if (
      !entry ||
      entry.selection ||
      suspended ||
      (!start && anchors.ownsEvent(event))
    )
      return;
    if (start) {
      if (event.pointerId !== start.pointerId) return;
      suppress(event);
      if (entry.text) {
        const text = moveText(entry, point(event));
        if (text) draw(text.targetRect, false, text.selectionRects);
        else {
          if (highlight) highlight.style.display = "none";
          textHighlights?.replaceChildren();
        }
      } else {
        const rect = region(event);
        if (rect) draw(rect);
      }
    } else {
      const hit = pick(event);
      hover = hit.element;
      const rect = hover
        ? annotationFrameRect(hit.context, hover.getBoundingClientRect())
        : null;
      if (root)
        root.style.cursor =
          entry.kind !== "region" &&
          withoutShield(() =>
            beginAnnotationText(hit.point, hit.context.document),
          )
            ? "text"
            : "crosshair";
      if (rect) draw(rect);
    }
  };
  const down = (event: PointerEvent) => {
    const entry = current;
    if (
      !entry ||
      entry.selection ||
      suspended ||
      event.button !== 0 ||
      anchors.ownsEvent(event)
    )
      return;
    suppress(event);
    start = { ...point(event), pointerId: event.pointerId };
    const hit = pick(event);
    entry.frame = hit.context;
    watchFrames(entry);
    entry.text =
      entry.kind !== "region"
        ? withoutShield(() =>
            beginAnnotationText(hit.point, entry.frame.document),
          )
        : null;
    if (entry.kind === "element") {
      entry.element = hit.element;
    }
  };
  const up = (event: PointerEvent) => {
    const entry = current;
    if (
      !entry ||
      entry.selection ||
      suspended ||
      !start ||
      event.button !== 0 ||
      event.pointerId !== start.pointerId
    )
      return;
    suppress(event);
    const rect = region(event);
    const dragged =
      Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 4;
    if (entry.text && dragged) {
      const text = moveText(entry, point(event));
      if (text) {
        entry.kind = "text";
        entry.element = null;
        commit(entry, text.targetRect);
      } else {
        start = null;
        if (highlight) highlight.style.display = "none";
        textHighlights?.replaceChildren();
      }
    } else if (
      rect &&
      rect.width >= 2 &&
      rect.height >= 2 &&
      (entry.kind === "region" || dragged)
    ) {
      entry.kind = "region";
      entry.element = null;
      entry.region = withoutShield(() =>
        beginAnnotationRegion(entry.frame, rect, point(event)),
      );
      if (!entry.region) {
        start = null;
        return;
      }
      commit(entry, rect);
    } else if (entry.kind === "element" && !dragged && entry.element) {
      const elementRect = annotationFrameRect(
        entry.frame,
        entry.element.getBoundingClientRect(),
      );
      if (elementRect) commit(entry, elementRect);
      else start = null;
    } else {
      start = null;
      if (highlight) highlight.style.display = "none";
    }
  };
  const click = (event: MouseEvent) => {
    if (current && !suspended && !anchors.ownsEvent(event)) suppress(event);
  };
  const publishInputState = () => {
    if (current && !current.selection)
      send(current, { type: "input-state", suspended, addModifierPressed });
  };
  const suspend = (value: boolean) => {
    if (!current || current.selection || suspended === value) return;
    suspended = value;
    start = null;
    hover = null;
    current.text = null;
    current.element = null;
    releaseFrames?.();
    releaseFrames = null;
    current.frame = annotationRootFrame();
    if (root) {
      root.style.pointerEvents = value ? "none" : "auto";
      root.style.display = value ? "none" : "block";
    }
    if (highlight) highlight.style.display = "none";
    if (marker) marker.style.display = "none";
    textHighlights?.replaceChildren();
    publishInputState();
  };
  const key = (event: KeyboardEvent) => {
    if (!current) return;
    if (
      event.isTrusted &&
      (event.type === "keydown" || event.type === "keyup")
    ) {
      const pressed = /Mac|iPhone|iPad|iPod/.test(navigator.platform)
        ? event.metaKey
        : event.ctrlKey;
      if (pressed !== addModifierPressed) {
        addModifierPressed = pressed;
        publishInputState();
      }
    }
    const pressed = current.selection
      ? undefined
      : annotationSpacePressed(event, suspended);
    if (pressed !== undefined) suspend(pressed);
    if (current && event.key === "Escape") {
      suppress(event);
      cancel("escape");
    }
  };
  const viewport = (event: Event) => {
    if (event.type === "scroll" && suspended && current && !current.selection)
      return;
    if (current) cancel("viewport-changed");
  };
  const blur = () => {
    if (!document.hasFocus()) resumeInput();
  };
  const resumeInput = () => {
    addModifierPressed = false;
    suspend(false);
    publishInputState();
  };
  const retain = (entry: PageAnnotation, visible: boolean) => {
    retained.set(entry.annotationId, entry);
    stop();
    retainAnnotationMarker(entry, anchors, send);
    anchors.setVisible(entry.annotationId, visible);
    designs.setVisible(entry.annotationId, true);
  };
  const command = (_event: unknown, value: unknown) => {
    if (!value || typeof value !== "object") return;
    const message = value as Record<string, unknown>;
    if (message.type === "begin") {
      if (
        typeof message.annotationId !== "string" ||
        typeof message.token !== "string" ||
        !Number.isSafeInteger(message.pageRevision) ||
        (message.kind !== "element" &&
          message.kind !== "region" &&
          message.kind !== "text")
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
        text: null,
        region: null,
        frame: annotationRootFrame(),
      };
      root = document.createElement("div");
      Object.assign(root.style, {
        all: "initial",
        position: "fixed",
        inset: "0",
        zIndex: "2147483645",
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
      textHighlights = document.createElement("div");
      Object.assign(textHighlights.style, {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
      });
      shadow.append(highlight, textHighlights, marker);
      document.documentElement.append(root);
      releaseKeyboard = watchAnnotationKeyboard(key, blur);
      send(current, { type: "began" });
      return;
    }
    const saved =
      typeof message.annotationId === "string"
        ? retained.get(message.annotationId)
        : null;
    if (
      saved &&
      message.token === saved.token &&
      message.pageRevision === saved.pageRevision &&
      message.documentToken === documentToken
    ) {
      if (message.type === "cancel") {
        designs.remove(saved.annotationId);
        retained.delete(saved.annotationId);
        anchors.remove(saved.annotationId);
      } else if (
        message.type === "hide-marker" &&
        typeof message.nextToken === "string" &&
        message.nextToken.length > 0
      ) {
        saved.token = message.nextToken;
        designs.setVisible(saved.annotationId, false);
        designs.setOriginal(saved.annotationId, false);
        anchors.setVisible(saved.annotationId, false);
      } else if (
        message.type === "restore-marker" &&
        typeof message.markersVisible === "boolean" &&
        Number.isSafeInteger(message.nextPageRevision) &&
        (message.nextPageRevision as number) >= saved.pageRevision
      ) {
        saved.pageRevision = message.nextPageRevision as number;
        send(saved, { type: "marker-restored" });
        anchors.setVisible(saved.annotationId, message.markersVisible);
        designs.setOriginal(saved.annotationId, message.original === true);
        designs.setVisible(saved.annotationId, true);
      } else if (
        message.type === "set-marker-visibility" &&
        typeof message.visible === "boolean"
      ) {
        anchors.setVisible(saved.annotationId, message.visible);
      } else if (
        message.type === "design-original" &&
        typeof message.original === "boolean"
      ) {
        designs.setOriginal(saved.annotationId, message.original);
      } else if (message.type === "design-preview") {
        try {
          designs.update(saved.annotationId, message.change);
        } catch {
          /* Invalid CSS leaves the last valid preview unchanged. */
        }
      } else if (message.type === "refresh")
        anchors.refresh(saved.annotationId);
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
    if (
      message.type === "retain" &&
      typeof message.markersVisible === "boolean" &&
      entry.selection &&
      entry.requestId === message.requestId
    ) {
      retain(entry, message.markersVisible);
      designs.setOriginal(entry.annotationId, message.original === true);
      return;
    }
    if (message.type === "resume") {
      resumeInput();
      return;
    }
    if (message.type === "clear") {
      if (entry.requestId === message.requestId) {
        entry.requestId = null;
        if (highlight) highlight.style.display = "none";
        if (marker) marker.style.display = "none";
        textHighlights?.replaceChildren();
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
    draw(live.targetRect, true, live.selectionRects);
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
  window.addEventListener("scroll", viewport, true);
  window.addEventListener("resize", viewport, true);
  window.addEventListener("pagehide", viewport, true);
  window.addEventListener("pointercancel", viewport, true);
  return () => {
    stop();
    anchors.dispose();
    designs.dispose();
    retained.clear();
    ipcRenderer.off(BROWSER_ANNOTATION_PAGE_COMMAND, command);
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerdown", down, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("click", click, true);
    window.removeEventListener("scroll", viewport, true);
    window.removeEventListener("resize", viewport, true);
    window.removeEventListener("pagehide", viewport, true);
    window.removeEventListener("pointercancel", viewport, true);
  };
}

if (process.isMainFrame) installBrowserPageAnnotations();
