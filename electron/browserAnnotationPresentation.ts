import { isDeepStrictEqual } from "node:util";
import type { BrowserAnnotationTarget } from "./browserAnnotationHost";
import type { BrowserAnnotationIdentity } from "../src/lib/api/browserAnnotationTypes";

type PagePresentation =
  | { type: "set-marker-visibility"; visible: boolean }
  | { type: "design-original"; original: boolean };

/** Temporary presentation only; annotation/page authority remains in Annotation Host. */
export class BrowserAnnotationPresentation {
  readonly #markers = new Map<string, boolean>();
  readonly #holds = new Map<
    string,
    {
      gestureId: string;
      identity: BrowserAnnotationIdentity;
      cleanup: () => void;
    }
  >();
  constructor(
    readonly publish: (viewId: string, message: PagePresentation) => void,
  ) {}

  markersVisible(viewId: string): boolean {
    return this.#markers.get(viewId) !== false;
  }
  original(viewId: string): boolean {
    return this.#holds.has(viewId);
  }

  setMarkers(target: BrowserAnnotationTarget, visible: unknown) {
    if (typeof visible !== "boolean")
      throw new Error("Invalid Browser marker visibility");
    this.#markers.set(target.identity.viewId, visible);
    this.publish(target.identity.viewId, {
      type: "set-marker-visibility",
      visible,
    });
    return { tabId: target.identity.tabId, visible };
  }

  setOriginal(
    target: BrowserAnnotationTarget,
    args: Record<string, unknown>,
    available: boolean,
  ) {
    const { gestureId, original, identity } = args;
    if (
      typeof gestureId !== "string" ||
      !/^[a-zA-Z0-9._:-]{1,100}$/u.test(gestureId) ||
      typeof original !== "boolean" ||
      !isDeepStrictEqual(identity, target.identity)
    )
      throw new Error("Invalid Browser original page identity");
    const viewId = target.identity.viewId;
    const held = this.#holds.get(viewId);
    if (!original) {
      if (
        held?.gestureId === gestureId &&
        isDeepStrictEqual(held.identity, identity)
      )
        this.clearOriginal(viewId);
    } else {
      if (!available) throw new Error("Browser original page is unavailable");
      if (
        held &&
        (held.gestureId !== gestureId ||
          !isDeepStrictEqual(held.identity, identity))
      )
        throw new Error("Browser original page is already held");
      if (!held) {
        const release = () => this.clearOriginal(viewId);
        const { window, view } = target;
        window.on("blur", release);
        window.webContents.on("render-process-gone", release);
        window.webContents.on("destroyed", release);
        view.webContents.on("destroyed", release);
        this.#holds.set(viewId, {
          gestureId,
          identity: structuredClone(target.identity),
          cleanup: () => {
            window.off("blur", release);
            window.webContents.off("render-process-gone", release);
            window.webContents.off("destroyed", release);
            view.webContents.off("destroyed", release);
          },
        });
        this.publish(viewId, { type: "design-original", original: true });
      }
    }
    return { ...target.identity, gestureId, original };
  }

  clearOriginal(viewId: string): void {
    const held = this.#holds.get(viewId);
    if (!held) return;
    this.#holds.delete(viewId);
    held.cleanup();
    this.publish(viewId, { type: "design-original", original: false });
  }
  clearWindow(windowId: number): void {
    for (const [id, held] of this.#holds)
      if (held.identity.windowId === windowId) this.clearOriginal(id);
  }
  forget(viewId: string): void {
    this.clearOriginal(viewId);
    this.#markers.delete(viewId);
  }
  dispose(): void {
    for (const id of this.#holds.keys()) this.clearOriginal(id);
    this.#markers.clear();
  }
}
