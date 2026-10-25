import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { setImmediate } from "node:timers";
import type { Input, IpcMainEvent, Rectangle, WebContents } from "electron";
import {
  ipcMain,
  WebContentsView,
  type BrowserWindow,
} from "./electronRuntime";
import { browserOverlayDocument } from "./browserOverlayDocument";
import { browserAddressBounds } from "./browserAddressBounds";
import {
  BrowserAnnotationEditorHost,
  type BrowserAnnotationEditorHostEvent,
  type BrowserAnnotationEditorState,
} from "./browserAnnotationEditorHost";
import type { BrowserAnnotationEditorPresentation } from "../src/lib/api/browserAnnotationEditorTypes";
import type { BrowserAnnotationIdentity } from "../src/lib/api/browserAnnotationTypes";
import type { BrowserAnnotationAnchor } from "./browserAnnotationAnchor";
import {
  browserCommandForInput,
  type EmbeddedBrowserPageCommand,
} from "./embeddedBrowserPageActions";
import {
  BROWSER_OVERLAY_ACTION_CHANNEL,
  BROWSER_OVERLAY_UPDATE_CHANNEL,
  browserMenuActionIds,
  browserMenuPersistentActionIds,
  readBrowserMenuPresentation,
  type BrowserMenuItem,
  type BrowserMenuPresentation,
  type BrowserOverlayCloseReason,
} from "./browserOverlayModel";

interface BrowserOverlayEntry {
  viewId: string;
  view: WebContentsView;
  window: BrowserWindow;
  token: string;
  presentation: BrowserMenuPresentation;
  actionIds: Set<string>;
  persistentActionIds: Set<string>;
  generation: number;
  ready: boolean;
  restoreFocus: WebContents;
  cleanup: () => void;
}

export interface BrowserOverlayEvent {
  viewId: string;
  menuId: string;
  generation: number;
  itemId?: string;
  reason: BrowserOverlayCloseReason;
}

/** A trusted native child view stays above the untrusted page without hiding it. */
export class BrowserOverlayHost {
  readonly #entries = new Map<number, BrowserOverlayEntry>();
  readonly #emit: (event: BrowserOverlayEvent) => void;
  readonly #preload: string | undefined;
  readonly #onCommand:
    | ((viewId: string, command: EmbeddedBrowserPageCommand) => void)
    | undefined;
  readonly #editor: BrowserAnnotationEditorHost;
  #listening = false;
  #generation = 0;

  constructor(
    emit: (event: BrowserOverlayEvent) => void,
    options: {
      preloadPath?: string;
      onCommand?: (viewId: string, command: EmbeddedBrowserPageCommand) => void;
      annotationPreloadPath?: string;
      onAnnotationEvent?: (event: BrowserAnnotationEditorHostEvent) => void;
    } = {},
  ) {
    this.#emit = emit;
    this.#preload = options.preloadPath;
    this.#onCommand = options.onCommand;
    this.#editor = new BrowserAnnotationEditorHost(
      (event) => options.onAnnotationEvent?.(event),
      { preloadPath: options.annotationPreloadPath },
    );
  }

  async showAnnotation(
    window: BrowserWindow,
    viewId: string,
    presentation: BrowserAnnotationEditorPresentation,
    restoreFocus: WebContents,
    pageBounds: Rectangle,
    identity: BrowserAnnotationIdentity,
  ) {
    this.hideWindow(window.id, "replaced");
    return this.#editor.show(
      window,
      viewId,
      presentation,
      restoreFocus,
      pageBounds,
      identity,
    );
  }

  updateAnnotation(viewId: string, update: BrowserAnnotationEditorState) {
    return this.#editor.update(viewId, update);
  }

  closeAnnotation(
    viewId: string,
    identity: { editorId: string; generation: number },
  ): boolean {
    return this.#editor.close(viewId, identity);
  }

  positionAnnotation(
    identity: BrowserAnnotationIdentity,
    annotationId: string,
    anchor: BrowserAnnotationAnchor,
    pageBounds: Rectangle,
  ): void {
    this.#editor.position(identity, annotationId, anchor, pageBounds);
  }

  focusAnnotation(
    identity: BrowserAnnotationIdentity,
    annotationId: string,
  ): void {
    this.#editor.focus(identity, annotationId);
  }

  async show(
    window: BrowserWindow,
    viewId: string,
    presentation: BrowserMenuPresentation,
    restoreFocus: WebContents,
  ): Promise<{ menuId: string; generation: number; visible: boolean }> {
    const normalized = readBrowserMenuPresentation(presentation);
    if (window.isDestroyed() || restoreFocus.isDestroyed())
      throw new Error("Browser menu owner is unavailable");
    this.hideWindow(window.id, "replaced");
    if (!this.#listening) {
      ipcMain.on(BROWSER_OVERLAY_ACTION_CHANNEL, this.#handleAction);
      this.#listening = true;
    }
    const token = randomUUID();
    const generation = ++this.#generation;
    const view = new WebContentsView({
      webPreferences: {
        preload:
          this.#preload ??
          path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            "../preload/browserOverlay.cjs",
          ),
        additionalArguments: [`--browser-overlay-token=${token}`],
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    view.setBackgroundColor("#00000000");
    const bounds = window.getContentBounds();
    view.setBounds(
      normalized.mode === "address"
        ? browserAddressBounds(normalized, bounds)
        : { x: 0, y: 0, width: bounds.width, height: bounds.height },
    );
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const preventNavigation = (event: { preventDefault(): void }) =>
      event.preventDefault();
    view.webContents.on("will-navigate", preventNavigation);
    view.webContents.on("will-redirect", preventNavigation);
    const closed = () => this.hideWindow(window.id, "owner");
    const ownerGone = () => this.hideWindow(window.id, "owner");
    const navigation = () => this.hideWindow(window.id, "navigation");
    const overlayGone = () => {
      if (this.#entries.get(window.id) === entry)
        this.hideWindow(window.id, "owner");
    };
    const outside = () => this.hideWindow(window.id, "outside");
    const pageFocused = () => {
      setImmediate(() => {
        if (
          this.#entries.get(window.id) === entry &&
          !view.webContents.isDestroyed() &&
          !view.webContents.isFocused()
        )
          this.hideWindow(window.id, "outside");
      });
    };
    const input = (event: { preventDefault(): void }, input: Input) => {
      if (entry.presentation.confirmation) return;
      if (
        !this.#onCommand ||
        this.#entries.get(window.id) !== entry ||
        !entry.ready ||
        window.isDestroyed() ||
        !window.isFocused() ||
        restoreFocus.isDestroyed() ||
        view.webContents.isDestroyed()
      )
        return;
      const command = browserCommandForInput(input, process.platform);
      if (!command) return;
      event.preventDefault();
      this.hideWindow(window.id, "hidden");
      this.#onCommand(viewId, command);
    };
    window.once("closed", closed);
    window.on("resize", outside);
    window.on("blur", outside);
    window.webContents.once("destroyed", ownerGone);
    window.webContents.on("did-start-navigation", navigation);
    if (normalized.mode === "address") {
      restoreFocus.on("blur", pageFocused);
    }
    view.webContents.once("render-process-gone", overlayGone);
    view.webContents.once("destroyed", overlayGone);
    view.webContents.on("before-input-event", input);
    const entry: BrowserOverlayEntry = {
      viewId,
      view,
      window,
      token,
      presentation: normalized,
      actionIds: browserMenuActionIds(normalized.items),
      persistentActionIds: browserMenuPersistentActionIds(normalized.items),
      generation,
      ready: false,
      restoreFocus,
      cleanup: () => {
        window.off("closed", closed);
        window.off("resize", outside);
        window.off("blur", outside);
        window.webContents.off("destroyed", ownerGone);
        window.webContents.off("did-start-navigation", navigation);
        restoreFocus.off("blur", pageFocused);
        view.webContents.off("render-process-gone", overlayGone);
        view.webContents.off("destroyed", overlayGone);
        view.webContents.off("before-input-event", input);
      },
    };
    this.#entries.set(window.id, entry);
    window.contentView.addChildView(view);
    try {
      await view.webContents.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(browserOverlayDocument(normalized))}`,
      );
      if (this.#entries.get(window.id) === entry && !window.isDestroyed()) {
        entry.ready = true;
        this.#sendUpdate(entry);
        if (normalized.mode !== "address") view.webContents.focus();
        else if (window.isFocused() && !restoreFocus.isDestroyed())
          restoreFocus.focus();
      }
      return {
        menuId: normalized.menuId,
        generation,
        visible: this.#entries.get(window.id) === entry,
      };
    } catch (error) {
      if (this.#entries.get(window.id) === entry)
        this.hideWindow(window.id, "owner");
      throw error;
    }
  }

  update(
    viewId: string,
    update: { menuId: string; generation: number; items: BrowserMenuItem[] },
  ): { menuId: string; generation: number; visible: boolean } {
    if (
      !update ||
      typeof update !== "object" ||
      Object.keys(update).some(
        (key) => !["menuId", "generation", "items"].includes(key),
      )
    )
      throw new Error("Browser menu update is invalid");
    const entry = [...this.#entries.values()].find(
      (entry) => entry.viewId === viewId,
    );
    if (
      !entry ||
      update.menuId !== entry.presentation.menuId ||
      update.generation !== entry.generation
    )
      throw new Error("Browser menu identity is stale");
    if (entry.presentation.confirmation)
      throw new Error("Browser confirmation is immutable");
    const presentation = readBrowserMenuPresentation({
      ...entry.presentation,
      items: update.items,
    });
    entry.presentation = presentation;
    if (presentation.mode === "address")
      entry.view.setBounds(
        browserAddressBounds(presentation, entry.window.getContentBounds()),
      );
    entry.actionIds = browserMenuActionIds(presentation.items);
    entry.persistentActionIds = browserMenuPersistentActionIds(
      presentation.items,
    );
    this.#sendUpdate(entry);
    return {
      menuId: presentation.menuId,
      generation: entry.generation,
      visible: true,
    };
  }

  #sendUpdate(entry: BrowserOverlayEntry): void {
    if (entry.ready && !entry.view.webContents.isDestroyed())
      entry.view.webContents.send(BROWSER_OVERLAY_UPDATE_CHANNEL, {
        token: entry.token,
        menuId: entry.presentation.menuId,
        items: entry.presentation.items,
      });
  }

  hideMenu(
    viewId: string,
    identity: { menuId: string; generation?: number },
  ): void {
    const entry = [...this.#entries.values()].find(
      (entry) => entry.viewId === viewId,
    );
    if (
      entry?.presentation.menuId === identity.menuId &&
      (identity.generation === undefined ||
        entry.generation === identity.generation)
    )
      this.hideWindow(entry.window.id, "hidden");
  }

  hide(viewId: string, reason: BrowserOverlayCloseReason = "hidden"): void {
    this.#editor.hide(viewId, reason);
    for (const [windowId, entry] of this.#entries)
      if (entry.viewId === viewId) this.hideWindow(windowId, reason);
  }

  hideWindow(windowId: number, reason: BrowserOverlayCloseReason): void {
    this.#editor.hideWindow(windowId, reason);
    const entry = this.#entries.get(windowId);
    if (!entry) return;
    this.#entries.delete(windowId);
    entry.cleanup();
    if (!entry.window.isDestroyed())
      entry.window.contentView.removeChildView(entry.view);
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
    if (
      reason !== "owner" &&
      reason !== "replaced" &&
      (entry.presentation.mode !== "address" ||
        reason === "action" ||
        reason === "escape") &&
      !entry.window.isDestroyed() &&
      entry.window.isFocused() &&
      !entry.restoreFocus.isDestroyed()
    )
      entry.restoreFocus.focus();
    this.#emit({
      viewId: entry.viewId,
      menuId: entry.presentation.menuId,
      generation: entry.generation,
      reason,
    });
  }

  restack(windowId: number): void {
    this.#editor.restack(windowId);
    const entry = this.#entries.get(windowId);
    if (entry && !entry.window.isDestroyed())
      entry.window.contentView.addChildView(entry.view);
  }

  dispose(): void {
    this.#editor.dispose();
    for (const windowId of [...this.#entries.keys()])
      this.hideWindow(windowId, "owner");
    if (this.#listening)
      ipcMain.off(BROWSER_OVERLAY_ACTION_CHANNEL, this.#handleAction);
    this.#listening = false;
  }

  readonly #handleAction = (event: IpcMainEvent, value: unknown): void => {
    const entry = [...this.#entries.values()].find(
      (item) => item.view.webContents.id === event.sender.id,
    );
    if (
      !entry ||
      event.senderFrame !== entry.view.webContents.mainFrame ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    )
      return;
    const action = value as Record<string, unknown>;
    if (
      action.token !== entry.token ||
      action.menuId !== entry.presentation.menuId
    )
      return;
    if (action.reason === "escape" || action.reason === "outside") {
      this.hideWindow(entry.window.id, action.reason);
      return;
    }
    if (
      typeof action.itemId !== "string" ||
      !entry.actionIds.has(action.itemId)
    )
      return;
    this.#emit({
      viewId: entry.viewId,
      menuId: entry.presentation.menuId,
      generation: entry.generation,
      itemId: action.itemId,
      reason: "action",
    });
    if (
      !entry.persistentActionIds.has(action.itemId) &&
      this.#entries.get(entry.window.id) === entry
    )
      this.hideWindow(entry.window.id, "action");
  };
}
