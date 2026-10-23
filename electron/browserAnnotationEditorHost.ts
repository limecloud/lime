import { randomUUID } from "node:crypto";
import {
  readBrowserDesignChange,
  sameBrowserDesignChange,
} from "../src/lib/api/browserDesign";
import {
  readAnnotationEditorPresentation,
  readAnnotationEditorIdentity,
  annotationEditorKeys,
} from "./browserAnnotationEditorModel";
import {
  annotationEditorBounds,
  annotationEditorConstraints,
} from "./browserAnnotationEditorLayout";
import { isDeepStrictEqual } from "node:util";
import {
  readBrowserAnnotationImages,
  sameBrowserAnnotationImages,
} from "../src/lib/api/browserAnnotationImages";
import type { BrowserAnnotationAnchor } from "./browserAnnotationAnchor";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IpcMainEvent, Rectangle, WebContents } from "electron";
import {
  ipcMain,
  WebContentsView,
  type BrowserWindow,
} from "./electronRuntime";
import { annotationRecord } from "./browserAnnotationModel";
import type { BrowserOverlayCloseReason } from "./browserOverlayModel";
import type { BrowserAnnotationIdentity } from "../src/lib/api/browserAnnotationTypes";
import {
  BROWSER_ANNOTATION_EDITOR_CHANNEL,
  BROWSER_ANNOTATION_EDITOR_UPDATE,
  isBrowserAnnotationEditorHeight,
  type BrowserAnnotationEditorAction,
  type BrowserAnnotationEditorEvent,
  type BrowserAnnotationEditorPresentation,
  type BrowserAnnotationEditorLayout,
} from "../src/lib/api/browserAnnotationEditorTypes";

export interface BrowserAnnotationEditorHostEvent
  extends BrowserAnnotationEditorEvent, BrowserAnnotationIdentity {}
export interface BrowserAnnotationEditorVisibility {
  editorId: string;
  generation: number;
  visible: boolean;
}
export interface BrowserAnnotationEditorState {
  editorId: string;
  generation: number;
  pending: boolean;
  error: boolean;
}

interface EditorEntry {
  window: BrowserWindow;
  view: WebContentsView;
  viewId: string;
  restoreFocus: WebContents;
  url: string;
  token: string;
  generation: number;
  presentation: BrowserAnnotationEditorPresentation;
  layout: BrowserAnnotationEditorLayout;
  pageBounds: Rectangle;
  anchor: BrowserAnnotationEditorPresentation | BrowserAnnotationAnchor;
  height: number;
  identity: BrowserAnnotationIdentity;
  ready: boolean;
  pending: boolean;
  error: boolean;
  sentRevision: number | null;
  finished: boolean;
  cleanup: () => void;
}
interface ClosingEditor {
  entry: EditorEntry;
  flushId: string;
  timer: ReturnType<typeof setTimeout>;
}

/** This child is composed only by BrowserOverlayHost, the window's presentation owner. */
export class BrowserAnnotationEditorHost {
  readonly #entries = new Map<number, EditorEntry>();
  readonly #closing = new Map<number, ClosingEditor>();
  readonly #emit: (event: BrowserAnnotationEditorHostEvent) => void;
  readonly #preload: string;
  #generation = 0;
  #listening = false;
  #disposed = false;

  constructor(
    emit: (event: BrowserAnnotationEditorHostEvent) => void,
    options: { preloadPath?: string } = {},
  ) {
    this.#emit = emit;
    this.#preload =
      options.preloadPath ??
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../preload/browserAnnotationEditor.cjs",
      );
  }

  async show(
    window: BrowserWindow,
    viewId: string,
    presentation: BrowserAnnotationEditorPresentation,
    restoreFocus: WebContents,
    pageBounds: Rectangle,
    identity: BrowserAnnotationIdentity,
  ): Promise<BrowserAnnotationEditorVisibility> {
    if (
      this.#disposed ||
      window.isDestroyed() ||
      window.webContents.isDestroyed() ||
      restoreFocus.isDestroyed()
    )
      throw new Error("Browser annotation editor owner is unavailable");
    const normalized = readAnnotationEditorPresentation(presentation);
    const capturedIdentity = readAnnotationEditorIdentity(
      identity,
      window,
      viewId,
      restoreFocus,
    );
    const url = browserAnnotationEditorUrl(window.webContents.getURL());
    const bounds = annotationEditorBounds(
      window.getContentBounds(),
      pageBounds,
      normalized,
    );
    this.hideWindow(window.id, "replaced");
    if (!this.#listening) {
      ipcMain.on(BROWSER_ANNOTATION_EDITOR_CHANNEL, this.#handleMessage);
      this.#listening = true;
    }
    const token = randomUUID();
    const generation = ++this.#generation;
    const view = new WebContentsView({
      webPreferences: {
        preload: this.#preload,
        additionalArguments: [
          `--browser-annotation-token=${token}`,
          `--browser-annotation-id=${normalized.editorId}`,
          `--browser-annotation-generation=${generation}`,
        ],
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        webviewTag: false,
      },
    });
    view.setBackgroundColor("#00000000");
    view.setBounds(bounds);
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const prevent = (event: { preventDefault(): void }) =>
      event.preventDefault();
    const close = (reason: BrowserOverlayCloseReason) => {
      if (this.#entries.get(window.id) === entry)
        this.hideWindow(window.id, reason);
    };
    const ownerGone = () => close("owner");
    const outside = () => close("outside");
    const navigation = (
      _event: unknown,
      _url: string,
      _inPlace: boolean,
      mainFrame: boolean,
    ) => {
      if (mainFrame !== false) close("navigation");
    };
    const editorNavigation = (
      _event: unknown,
      destination: string,
      _inPlace: boolean,
      mainFrame: boolean,
    ) => {
      if (mainFrame === false || destination !== url) close("owner");
    };
    const frame = (
      _event: unknown,
      details: { frame: { parent: unknown } | null },
    ) => {
      if (details.frame && details.frame.parent !== null) close("owner");
    };
    window.once("closed", ownerGone);
    window.on("blur", outside);
    window.webContents.once("destroyed", ownerGone);
    window.webContents.on("did-start-navigation", navigation);
    if (restoreFocus !== window.webContents) {
      restoreFocus.once("destroyed", ownerGone);
      restoreFocus.on("did-start-navigation", navigation);
    }
    view.webContents.on("will-navigate", prevent);
    view.webContents.on("will-frame-navigate", prevent);
    view.webContents.on("will-redirect", prevent);
    view.webContents.on("will-attach-webview", prevent);
    view.webContents.on("did-start-navigation", editorNavigation);
    view.webContents.on("frame-created", frame);
    view.webContents.once("render-process-gone", ownerGone);
    view.webContents.once("destroyed", ownerGone);
    const entry: EditorEntry = {
      window,
      view,
      viewId,
      restoreFocus,
      url,
      token,
      generation,
      presentation: normalized,
      layout: annotationEditorConstraints(window.getContentBounds()),
      pageBounds: { ...pageBounds },
      anchor: normalized,
      height: bounds.height,
      identity: capturedIdentity,
      ready: false,
      pending: false,
      error: false,
      sentRevision: null,
      finished: false,
      cleanup: () => {
        window.off("closed", ownerGone);
        window.off("blur", outside);
        window.webContents.off("destroyed", ownerGone);
        window.webContents.off("did-start-navigation", navigation);
        if (restoreFocus !== window.webContents) {
          restoreFocus.off("destroyed", ownerGone);
          restoreFocus.off("did-start-navigation", navigation);
        }
        view.webContents.off("will-navigate", prevent);
        view.webContents.off("will-frame-navigate", prevent);
        view.webContents.off("will-redirect", prevent);
        view.webContents.off("will-attach-webview", prevent);
        view.webContents.off("did-start-navigation", editorNavigation);
        view.webContents.off("frame-created", frame);
        view.webContents.off("render-process-gone", ownerGone);
        view.webContents.off("destroyed", ownerGone);
      },
    };
    this.#entries.set(window.id, entry);
    window.contentView.addChildView(view);
    try {
      await view.webContents.loadURL(url);
      if (this.#entries.get(window.id) === entry && !window.isDestroyed()) {
        entry.ready = true;
        this.#sendUpdate(entry);
        view.webContents.focus();
      }
      return this.#visibility(entry);
    } catch (error) {
      if (this.#entries.get(window.id) === entry)
        this.hideWindow(window.id, "owner");
      throw error;
    }
  }

  update(
    viewId: string,
    update: BrowserAnnotationEditorState,
  ): BrowserAnnotationEditorVisibility {
    const source = annotationRecord(update);
    annotationEditorKeys(source, [
      "editorId",
      "generation",
      "pending",
      "error",
    ]);
    const entry = [...this.#entries.values()].find(
      (item) => item.viewId === viewId,
    );
    if (
      !entry ||
      source.editorId !== entry.presentation.editorId ||
      source.generation !== entry.generation
    )
      throw new Error("Browser annotation editor identity is stale");
    if (
      typeof source.pending !== "boolean" ||
      typeof source.error !== "boolean"
    )
      throw new Error("Browser annotation editor state is invalid");
    entry.pending = source.pending;
    entry.error = source.error;
    if (!entry.pending && entry.error) entry.sentRevision = null;
    this.#sendUpdate(entry);
    return this.#visibility(entry);
  }

  position(
    identity: BrowserAnnotationIdentity,
    annotationId: string,
    anchor: BrowserAnnotationAnchor,
    pageBounds: Rectangle,
  ): void {
    const entry = this.#entries.get(identity.windowId);
    if (
      !entry ||
      !isDeepStrictEqual(entry.identity, identity) ||
      entry.presentation.annotationId !== annotationId ||
      entry.window.isDestroyed() ||
      entry.view.webContents.isDestroyed()
    )
      return;
    try {
      const layout = annotationEditorConstraints(
        entry.window.getContentBounds(),
      );
      entry.view.setBounds(
        annotationEditorBounds(
          entry.window.getContentBounds(),
          pageBounds,
          anchor,
          entry.height,
        ),
      );
      entry.pageBounds = { ...pageBounds };
      entry.anchor = anchor;
      if (
        layout.width !== entry.layout.width ||
        layout.maxHeight !== entry.layout.maxHeight
      ) {
        entry.layout = layout;
        this.#sendUpdate(entry);
      }
    } catch {
      /* Bounds can be transient while the owner lays out a native resize. */
    }
  }

  focus(identity: BrowserAnnotationIdentity, annotationId: string): void {
    const entry = this.#entries.get(identity.windowId);
    if (
      entry &&
      isDeepStrictEqual(entry.identity, identity) &&
      entry.presentation.annotationId === annotationId &&
      !entry.view.webContents.isDestroyed()
    )
      entry.view.webContents.focus();
  }

  close(
    viewId: string,
    identity: { editorId: string; generation: number },
  ): boolean {
    const entry = [...this.#entries.values()].find(
      (item) => item.viewId === viewId,
    );
    if (
      !entry ||
      !identity ||
      identity.editorId !== entry.presentation.editorId ||
      identity.generation !== entry.generation
    )
      return false;
    this.hideWindow(entry.window.id, "hidden");
    return true;
  }

  hide(viewId: string, reason: BrowserOverlayCloseReason = "hidden"): void {
    for (const [windowId, entry] of this.#entries)
      if (entry.viewId === viewId) this.hideWindow(windowId, reason);
  }

  hideWindow(windowId: number, reason: BrowserOverlayCloseReason): void {
    const entry = this.#entries.get(windowId);
    if (!entry) return;
    // Revoke action authority and remove the view before requesting a final draft snapshot.
    this.#entries.delete(windowId);
    entry.cleanup();
    if (!entry.window.isDestroyed())
      entry.window.contentView.removeChildView(entry.view);
    if (
      reason !== "owner" &&
      reason !== "replaced" &&
      !entry.window.isDestroyed() &&
      entry.window.isFocused() &&
      !entry.restoreFocus.isDestroyed()
    )
      entry.restoreFocus.focus();
    if (
      !entry.ready ||
      entry.view.webContents.isDestroyed() ||
      entry.view.webContents.getURL() !== entry.url
    ) {
      this.#finish(entry);
      return;
    }
    const flushId = randomUUID();
    const timer = setTimeout(() => this.#finish(entry), 250);
    this.#closing.set(entry.view.webContents.id, { entry, flushId, timer });
    entry.view.webContents.send(BROWSER_ANNOTATION_EDITOR_UPDATE, {
      kind: "flush",
      token: entry.token,
      editorId: entry.presentation.editorId,
      generation: entry.generation,
      flushId,
    });
  }

  restack(windowId: number): void {
    const entry = this.#entries.get(windowId);
    if (entry && !entry.window.isDestroyed())
      entry.window.contentView.addChildView(entry.view);
  }

  dispose(): void {
    this.#disposed = true;
    for (const windowId of [...this.#entries.keys()])
      this.hideWindow(windowId, "owner");
    this.#stopListening();
  }

  #visibility(entry: EditorEntry): BrowserAnnotationEditorVisibility {
    return {
      editorId: entry.presentation.editorId,
      generation: entry.generation,
      visible: this.#entries.get(entry.window.id) === entry,
    };
  }

  #sendUpdate(entry: EditorEntry): void {
    if (entry.ready && !entry.view.webContents.isDestroyed())
      entry.view.webContents.send(BROWSER_ANNOTATION_EDITOR_UPDATE, {
        kind: "update",
        token: entry.token,
        editorId: entry.presentation.editorId,
        generation: entry.generation,
        presentation: entry.presentation,
        layout: entry.layout,
        pending: entry.pending,
        error: entry.error,
      });
  }

  #event(entry: EditorEntry, action: BrowserAnnotationEditorAction): void {
    const { editorId, annotationId, draftId, body, attachedImages, revision } =
      entry.presentation;
    this.#emit({
      ...entry.identity,
      editorId,
      annotationId,
      draftId,
      generation: entry.generation,
      action,
      body,
      attachedImages,
      revision,
      ...(entry.presentation.designSnapshot
        ? { designChange: entry.presentation.designChange ?? null }
        : {}),
    });
  }

  #finish(entry: EditorEntry): void {
    if (entry.finished) return;
    entry.finished = true;
    const closing = this.#closing.get(entry.view.webContents.id);
    if (closing) {
      clearTimeout(closing.timer);
      this.#closing.delete(entry.view.webContents.id);
    }
    try {
      this.#event(entry, "close");
    } finally {
      if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
      this.#stopListening();
    }
  }

  #stopListening(): void {
    if (this.#disposed && !this.#closing.size && this.#listening) {
      ipcMain.off(BROWSER_ANNOTATION_EDITOR_CHANNEL, this.#handleMessage);
      this.#listening = false;
    }
  }

  #trusted(
    event: IpcMainEvent,
    source: Record<string, unknown>,
    entry: EditorEntry,
  ): boolean {
    const contents = entry.view.webContents;
    return (
      !contents.isDestroyed() &&
      event.sender === contents &&
      event.senderFrame === contents.mainFrame &&
      contents.getURL() === entry.url &&
      source.token === entry.token &&
      source.editorId === entry.presentation.editorId &&
      source.generation === entry.generation
    );
  }

  #acceptBody(entry: EditorEntry, source: Record<string, unknown>): boolean {
    let attachedImages;
    let designChange;
    try {
      attachedImages = readBrowserAnnotationImages(source.attachedImages);
      designChange = readBrowserDesignChange(
        source.designChange,
        entry.presentation.designSnapshot,
      );
      if (designChange && !entry.presentation.designSnapshot) return false;
    } catch {
      return false;
    }
    if (
      typeof source.body !== "string" ||
      source.body.length > 100_000 ||
      typeof source.revision !== "number" ||
      !Number.isSafeInteger(source.revision) ||
      source.revision < entry.presentation.revision ||
      (source.revision === entry.presentation.revision &&
        (source.body !== entry.presentation.body ||
          !sameBrowserDesignChange(
            designChange,
            entry.presentation.designChange,
          ) ||
          !sameBrowserAnnotationImages(
            attachedImages,
            entry.presentation.attachedImages,
          )))
    )
      return false;
    entry.presentation = {
      ...entry.presentation,
      body: source.body,
      attachedImages,
      revision: source.revision,
      ...(entry.presentation.designSnapshot ? { designChange } : {}),
    };
    return true;
  }

  readonly #handleMessage = (event: IpcMainEvent, value: unknown): void => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const source = value as Record<string, unknown>;
    const allowed =
      source.kind === "ready"
        ? ["kind", "token", "editorId", "generation"]
        : source.kind === "resize"
          ? ["kind", "token", "editorId", "generation", "height"]
          : source.kind === "action"
            ? [
                "kind",
                "token",
                "editorId",
                "generation",
                "action",
                "body",
                "attachedImages",
                "revision",
                "designChange",
              ]
            : source.kind === "flushed"
              ? [
                  "kind",
                  "token",
                  "editorId",
                  "generation",
                  "flushId",
                  "body",
                  "attachedImages",
                  "revision",
                  "designChange",
                ]
              : [];
    if (
      !allowed.length ||
      Object.keys(source).some((key) => !allowed.includes(key))
    )
      return;
    const closing = this.#closing.get(event.sender.id);
    if (closing && this.#trusted(event, source, closing.entry)) {
      if (
        source.kind === "flushed" &&
        source.flushId === closing.flushId &&
        this.#acceptBody(closing.entry, source)
      )
        this.#finish(closing.entry);
      return;
    }
    const entry = [...this.#entries.values()].find(
      (item) => item.view.webContents === event.sender,
    );
    if (!entry || !this.#trusted(event, source, entry)) return;
    if (source.kind === "ready") {
      entry.ready = true;
      this.#sendUpdate(entry);
      if (entry.presentation.designSnapshot) this.#event(entry, "change");
      return;
    }
    if (!entry.ready) return;
    if (source.kind === "resize") {
      if (!isBrowserAnnotationEditorHeight(source.height)) return;
      try {
        const bounds = annotationEditorBounds(
          entry.window.getContentBounds(),
          entry.pageBounds,
          entry.anchor,
          source.height,
        );
        entry.view.setBounds(bounds);
        entry.height = source.height;
      } catch {
        /* A resize cannot outlive its owner's current native layout. */
      }
      return;
    }
    if (
      source.kind !== "action" ||
      !["change", "save", "send", "close"].includes(source.action as string)
    )
      return;
    const action = source.action as BrowserAnnotationEditorAction;
    if (entry.pending && action !== "change") return;
    if (
      action === "send" &&
      (source.revision === entry.sentRevision ||
        typeof source.body !== "string" ||
        (!source.body.trim() && !source.designChange))
    )
      return;
    const unchanged = source.revision === entry.presentation.revision;
    if (!this.#acceptBody(entry, source)) return;
    if (action === "close") {
      this.hideWindow(entry.window.id, "hidden");
      return;
    }
    if (action === "change" && unchanged) return;
    if (action === "send") {
      entry.pending = true;
      entry.error = false;
      entry.sentRevision = entry.presentation.revision;
      this.#sendUpdate(entry);
    }
    this.#event(entry, action);
    if (action === "save" && this.#entries.get(entry.window.id) === entry)
      this.hideWindow(entry.window.id, "hidden");
  };
}

/** Derive a fixed local entry from the owner; callers cannot supply an editor URL. */
export function browserAnnotationEditorUrl(ownerUrl: string): string {
  const owner = new URL(ownerUrl);
  if (owner.username || owner.password)
    throw new Error("Browser annotation editor origin is invalid");
  if (
    owner.protocol === "file:" &&
    (!owner.hostname || owner.hostname === "localhost")
  )
    return new URL("./browser-annotation.html", owner).href;
  if (
    ["http:", "https:"].includes(owner.protocol) &&
    ["localhost", "127.0.0.1", "[::1]"].includes(owner.hostname)
  )
    return new URL("/browser-annotation.html", owner.origin).href;
  throw new Error("Browser annotation editor requires a local owner origin");
}
