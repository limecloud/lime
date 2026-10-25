import { randomUUID } from "node:crypto";
import type { EmbeddedBrowserNativeView } from "./embeddedBrowserHost";
import type {
  BrowserOverlayHost,
  BrowserOverlayEvent,
} from "./browserOverlayHost";
import {
  permissionOrigin,
  permissionSource,
  permissionSourceCurrent,
  type PermissionSource,
} from "./embeddedBrowserPermissionGrants";
import { sitePermissionText } from "./browserSitePermissionText";

export interface BrowserSitePermissionTarget extends EmbeddedBrowserNativeView {
  selected: boolean;
  controlOwner: string;
  activeTurnId: string | null;
  pageRevision: number;
}

interface PendingPrompt {
  requestId: string;
  viewId: string;
  menuId: string;
  generation?: number;
  target: BrowserSitePermissionTarget;
  source: PermissionSource;
  cleanup: () => void;
}

/** Human site permissions never mint or consume an Agent turn approval. */
export class BrowserSitePermissionPrompt {
  readonly #pending = new Map<string, PendingPrompt>();
  #locale = "en-US";

  constructor(
    readonly options: {
      overlay: Pick<BrowserOverlayHost, "show" | "hideMenu">;
      target: (viewId: string) => BrowserSitePermissionTarget | null;
      resolve: (requestId: string, allowed: boolean, viewId: string) => boolean;
    },
  ) {}

  setLocale(locale: string): void {
    this.#locale = locale;
  }

  request(viewId: string, record: Record<string, unknown>): boolean {
    const requestId =
      typeof record.requestId === "string" ? record.requestId : "";
    const target = this.#target(viewId);
    const mediaTypes =
      Array.isArray(record.mediaTypes) &&
      record.mediaTypes.every((type) => typeof type === "string")
        ? (record.mediaTypes as string[])
        : undefined;
    const copy = sitePermissionText(
      this.#locale,
      String(record.permission),
      mediaTypes,
    );
    const source =
      target &&
      permissionSource(target.view.webContents, {
        isMainFrame:
          typeof record.isMainFrame === "boolean"
            ? record.isMainFrame
            : undefined,
        requestingUrl:
          typeof record.requestingUrl === "string"
            ? record.requestingUrl
            : undefined,
      });
    if (
      !requestId ||
      !target ||
      !copy ||
      !source ||
      record.url !== source.topUrl ||
      (record.embeddingOrigin != null &&
        permissionOrigin(record.embeddingOrigin) !==
          permissionOrigin(source.topUrl))
    ) {
      if (requestId) this.options.resolve(requestId, false, viewId);
      return false;
    }
    this.cancelView(viewId);
    const menuId = `site-permission-${randomUUID()}`;
    const pending: PendingPrompt = {
      requestId,
      viewId,
      menuId,
      target: { ...target },
      source,
      cleanup: () => {},
    };
    const retire = () => this.#finish(pending, false);
    const webContents = target.view.webContents;
    webContents.on("did-start-navigation", retire);
    webContents.on("did-frame-navigate", retire);
    webContents.on("frame-created", retire);
    webContents.on("render-process-gone", retire);
    webContents.on("destroyed", retire);
    pending.cleanup = () => {
      webContents.off("did-start-navigation", retire);
      webContents.off("did-frame-navigate", retire);
      webContents.off("frame-created", retire);
      webContents.off("render-process-gone", retire);
      webContents.off("destroyed", retire);
    };
    this.#pending.set(menuId, pending);
    void this.options.overlay
      .show(
        target.window,
        viewId,
        {
          menuId,
          anchor: { x: 0, y: 0, width: 0, height: 0 },
          confirmation: {
            title: copy.title,
            description: `${copy.permission}\n${copy.site}: ${source.origin}\n${copy.top}: ${permissionOrigin(source.topUrl)}\n${copy.scope}`,
          },
          items: [
            { id: "cancel", label: copy.deny },
            { id: "confirm", label: copy.allow },
          ],
        },
        webContents,
      )
      .then((receipt) => {
        if (this.#pending.get(menuId) !== pending) {
          this.options.overlay.hideMenu(viewId, {
            menuId,
            generation: receipt.generation,
          });
          return;
        }
        pending.generation = receipt.generation;
        if (!receipt.visible || !this.#current(pending))
          this.#finish(pending, false);
      })
      .catch(() => this.#finish(pending, false));
    return true;
  }

  handle(event: BrowserOverlayEvent): boolean {
    if (!event.menuId.startsWith("site-permission-")) return false;
    const pending = this.#pending.get(event.menuId);
    if (
      !pending ||
      event.viewId !== pending.viewId ||
      (pending.generation !== undefined &&
        event.generation !== pending.generation)
    )
      return true;
    pending.generation = event.generation;
    this.#finish(
      pending,
      event.reason === "action" &&
        event.itemId === "confirm" &&
        this.#current(pending),
      false,
    );
    return true;
  }

  cancelView(viewId?: string): void {
    for (const pending of this.#pending.values()) {
      if (!viewId || pending.viewId === viewId) this.#finish(pending, false);
    }
  }

  cancelRequest(requestId: string): void {
    for (const pending of this.#pending.values())
      if (pending.requestId === requestId) this.#finish(pending, false);
  }

  #target(viewId: string): BrowserSitePermissionTarget | null {
    try {
      const target = this.options.target(viewId);
      return target &&
        (target.controlOwner === "user" ||
          target.controlOwner === "released") &&
        target.activeTurnId === null &&
        target.selected &&
        !target.window.isDestroyed() &&
        !target.view.webContents.isDestroyed() &&
        target.view.getVisible() &&
        target.window.contentView.children.includes(target.view)
        ? target
        : null;
    } catch {
      return null;
    }
  }

  #current(pending: PendingPrompt): boolean {
    const current = this.#target(pending.viewId);
    return (
      !!current &&
      current.window === pending.target.window &&
      current.view === pending.target.view &&
      current.pageRevision === pending.target.pageRevision &&
      permissionSourceCurrent(pending.source)
    );
  }

  #finish(pending: PendingPrompt, allowed: boolean, hide = true): void {
    if (this.#pending.get(pending.menuId) !== pending) return;
    this.#pending.delete(pending.menuId);
    pending.cleanup();
    if (hide)
      this.options.overlay.hideMenu(pending.viewId, {
        menuId: pending.menuId,
        generation: pending.generation,
      });
    this.options.resolve(pending.requestId, allowed, pending.viewId);
  }
}
