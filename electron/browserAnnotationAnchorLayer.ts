/// <reference lib="dom" />
import type { BrowserAnnotationRect } from "../src/lib/api/browserAnnotationTypes";
import type { BrowserAnnotationAnchor } from "./browserAnnotationAnchor";
import { annotationParent } from "./browserAnnotationTextLocator";
import { isAnnotationTextMirrorMutation } from "./browserAnnotationFormText";

interface AnchorSource {
  id: string;
  documents: Document[];
  element: Element | null;
  read: () => {
    targetRect: BrowserAnnotationRect;
    selectionRects?: BrowserAnnotationRect[];
  } | null;
  update: (anchor: BrowserAnnotationAnchor) => void;
  activate: () => void;
}
interface AnchorEntry {
  source: AnchorSource;
  highlight: HTMLDivElement;
  marker: HTMLButtonElement;
  previous: string | null;
  visible: boolean;
  cleanup: () => void;
}

/** Saved markers never install a page-sized input shield or a main-world capability. */
export class BrowserAnnotationAnchorLayer {
  readonly #entries = new Map<string, AnchorEntry>();
  #root: HTMLDivElement | null = null;
  #shadow: ShadowRoot | null = null;
  #frame: number | null = null;
  #disposed = false;

  add(source: AnchorSource): void {
    if (this.#disposed) return;
    this.remove(source.id);
    if (!this.#root) {
      this.#root = document.createElement("div");
      Object.assign(this.#root.style, {
        all: "initial",
        position: "fixed",
        inset: "0",
        zIndex: "2147483646",
        pointerEvents: "none",
      });
      this.#shadow = this.#root.attachShadow({ mode: "closed" });
      document.documentElement.append(this.#root);
    }
    const highlight = document.createElement("div");
    const marker = document.createElement("button");
    marker.type = "button";
    Object.assign(marker.style, {
      all: "initial",
      position: "absolute",
      width: "22px",
      height: "22px",
      borderRadius: "50%",
      background: "#8b5cf6",
      color: "white",
      font: "bold 12px system-ui",
      display: "grid",
      placeItems: "center",
      cursor: "pointer",
      pointerEvents: "auto",
    });
    marker.addEventListener("click", (event) => {
      if (
        !event.isTrusted ||
        this.#entries.get(source.id)?.marker !== marker ||
        !this.#entries.get(source.id)?.visible
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      source.activate();
    });
    this.#shadow!.append(highlight, marker);
    const cleanups: Array<() => void> = [];
    const schedule = () => this.#schedule();
    const observer = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            record.target !== this.#root &&
            !this.#root?.contains(record.target) &&
            !isAnnotationTextMirrorMutation(record),
        )
      )
        schedule();
    });
    const roots = new Set<Node>(source.documents);
    for (
      let element = source.element;
      element;
      element = annotationParent(element)
    )
      roots.add(element.getRootNode());
    roots.forEach((root) =>
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      }),
    );
    cleanups.push(() => observer.disconnect());
    for (const doc of new Set(source.documents)) {
      const win = doc.defaultView;
      if (!win) continue;
      for (const type of [
        "scroll",
        "resize",
        "transitionend",
        "animationend",
        "input",
        "change",
        "load",
      ]) {
        doc.addEventListener(type, schedule, true);
        win.addEventListener(type, schedule, true);
        cleanups.push(() => {
          doc.removeEventListener(type, schedule, true);
          win.removeEventListener(type, schedule, true);
        });
      }
      win.visualViewport?.addEventListener("scroll", schedule);
      win.visualViewport?.addEventListener("resize", schedule);
      cleanups.push(() => {
        win.visualViewport?.removeEventListener("scroll", schedule);
        win.visualViewport?.removeEventListener("resize", schedule);
      });
    }
    this.#entries.set(source.id, {
      source,
      highlight,
      marker,
      previous: null,
      visible: true,
      cleanup: () => cleanups.forEach((stop) => stop()),
    });
    this.#numberMarkers();
    this.refresh(source.id);
  }

  withoutMarkers<T>(read: () => T): T {
    const root = this.#root;
    if (root) root.style.display = "none";
    try {
      return read();
    } finally {
      if (root) root.style.display = "block";
    }
  }

  ownsEvent(event: Event): boolean {
    return this.#root !== null && event.composedPath().includes(this.#root);
  }

  setVisible(id: string, visible: boolean): void {
    const entry = this.#entries.get(id);
    if (!entry || entry.visible === visible) return;
    entry.visible = visible;
    entry.previous = null;
    entry.highlight.style.display = visible ? "block" : "none";
    entry.marker.style.display = "none";
    if (visible) this.refresh(id);
  }

  refresh(id?: string): void {
    if (this.#disposed) return;
    for (const entry of this.#entries.values()) {
      if (id && entry.source.id !== id) continue;
      if (!entry.visible) continue;
      let live: ReturnType<AnchorSource["read"]> = null;
      try {
        live = entry.source.read();
      } catch {
        /* A retired frame is a missing presentation target. */
      }
      const anchor: BrowserAnnotationAnchor = {
        viewportSize: { width: innerWidth, height: innerHeight },
        targetRect: live?.targetRect ?? null,
      };
      const serialized = JSON.stringify({
        anchor,
        lines: live?.selectionRects,
      });
      if (entry.previous === serialized) continue;
      entry.previous = serialized;
      entry.highlight.replaceChildren(
        ...(live ? (live.selectionRects ?? [live.targetRect]) : []).map(
          (rect) => {
            const block = document.createElement("div");
            Object.assign(block.style, {
              position: "absolute",
              boxSizing: "border-box",
              left: `${rect.x}px`,
              top: `${rect.y}px`,
              width: `${rect.width}px`,
              height: `${rect.height}px`,
              background: "rgba(139,92,246,0.18)",
              border: live?.selectionRects ? "none" : "2px solid #8b5cf6",
              borderRadius: "2px",
              pointerEvents: "none",
            });
            return block;
          },
        ),
      );
      entry.marker.style.display = live ? "grid" : "none";
      if (live)
        Object.assign(entry.marker.style, {
          left: `${Math.min(innerWidth - 12, Math.max(12, live.targetRect.x)) - 11}px`,
          top: `${Math.min(innerHeight - 12, Math.max(12, live.targetRect.y)) - 11}px`,
        });
      entry.source.update(anchor);
    }
  }

  #schedule(): void {
    if (this.#frame !== null || this.#disposed) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null;
      this.refresh();
    });
  }

  remove(id: string): boolean {
    const entry = this.#entries.get(id);
    if (!entry) return false;
    this.#entries.delete(id);
    entry.cleanup();
    entry.highlight.remove();
    entry.marker.remove();
    this.#numberMarkers();
    if (!this.#entries.size) {
      if (this.#frame !== null) cancelAnimationFrame(this.#frame);
      this.#frame = null;
      this.#root?.remove();
      this.#root = null;
      this.#shadow = null;
    }
    return true;
  }

  #numberMarkers(): void {
    let number = 0;
    for (const entry of this.#entries.values())
      entry.marker.textContent = String(++number);
  }

  dispose(): void {
    this.#disposed = true;
    for (const id of [...this.#entries.keys()]) this.remove(id);
  }
}
