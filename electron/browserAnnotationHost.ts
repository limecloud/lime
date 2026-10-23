import {
  readAnnotationAnchor,
  type BrowserAnnotationAnchor,
} from "./browserAnnotationAnchor";
import { randomUUID } from "node:crypto";
import { annotationScreenshot } from "./browserAnnotationScreenshot";
import { BrowserAnnotationPresentation } from "./browserAnnotationPresentation";
import {
  BrowserAnnotationDesignHost,
  type BrowserAnnotationDesignEvent,
} from "./browserAnnotationDesignHost";
import { isDeepStrictEqual } from "node:util";
import type {
  IpcMainEvent,
  Rectangle,
  WebContents,
  WebContentsView,
} from "electron";
import type { BrowserWindow } from "./electronRuntime";
import { ipcMain } from "./electronRuntime";
import {
  annotationKind,
  annotationRecord,
  annotationString,
  BROWSER_ANNOTATION_PAGE_COMMAND,
  BROWSER_ANNOTATION_PAGE_EVENT,
  readAnnotationSelection,
  readAnnotationArgs,
  type BrowserAnnotationCommand,
} from "./browserAnnotationModel";
import type {
  BrowserAnnotationCaptureResult,
  BrowserAnnotationIdentity,
  BrowserAnnotationSelection,
  BrowserAnnotationSession,
} from "../src/lib/api/browserAnnotationTypes";

export interface BrowserAnnotationTarget {
  identity: BrowserAnnotationIdentity;
  selected: boolean;
  annotationAllowed: boolean;
  view: WebContentsView;
  window: BrowserWindow;
}

interface AnnotationEntry {
  session: BrowserAnnotationSession;
  target: BrowserAnnotationTarget;
  token: string;
  presentationRevision: number;
  markerRevision: number;
  documentToken: string | null;
  frame: WebContents["mainFrame"];
  url: string;
  bounds: Rectangle;
  selection: BrowserAnnotationSelection | null;
  cleanup: () => void;
  pending: {
    requestId: string;
    resolve: (value: Record<string, unknown>) => void;
  } | null;
  capturing: boolean;
  retained: boolean;
  paused: boolean;
  anchor: BrowserAnnotationAnchor | null;
  startup: ReturnType<typeof setTimeout> | null;
}

/** Owns page IPC and authoritative geometry; it never accepts a renderer crop rectangle. */
export class BrowserAnnotationHost {
  readonly #design = new BrowserAnnotationDesignHost();
  readonly #entries = new Map<string, AnnotationEntry>();
  readonly #presentation = new BrowserAnnotationPresentation(
    (viewId, message) => {
      for (const entry of this.#entries.values())
        if (
          entry.session.viewId === viewId &&
          entry.retained &&
          this.#current(entry)
        )
          this.#send(entry, message);
    },
  );
  readonly #watchers = new Map<string, () => void>();
  readonly #resolve: (tabId: string) => BrowserAnnotationTarget | null;
  readonly #emit: (event: string, payload: unknown) => void;
  readonly #mode: () => "always" | "necessary";
  readonly #timeout: number;
  readonly #onActivate: (session: BrowserAnnotationSession) => void;
  readonly #onAnchor: (
    session: BrowserAnnotationSession,
    anchor: BrowserAnnotationAnchor,
    bounds: Rectangle,
  ) => void;
  #listening = false;
  readonly #listener = (event: IpcMainEvent, payload: unknown) =>
    this.#receive(event, payload);

  constructor(options: {
    resolveTarget: (tabId: string) => BrowserAnnotationTarget | null;
    emit: (event: string, payload: unknown) => void;
    screenshotMode: () => "always" | "necessary";
    timeoutMs?: number;
    onActivate?: (session: BrowserAnnotationSession) => void;
    onAnchor?: (
      session: BrowserAnnotationSession,
      anchor: BrowserAnnotationAnchor,
      bounds: Rectangle,
    ) => void;
  }) {
    this.#onAnchor = options.onAnchor ?? (() => undefined);
    this.#onActivate = options.onActivate ?? (() => undefined);
    this.#resolve = options.resolveTarget;
    this.#emit = options.emit;
    this.#mode = options.screenshotMode;
    this.#timeout = options.timeoutMs ?? 1000;
  }

  async invoke(
    window: BrowserWindow,
    command: BrowserAnnotationCommand,
    args: unknown,
  ): Promise<unknown> {
    const record = readAnnotationArgs(command, args);
    const tabId = annotationString(record.tabId);
    const target = this.#resolve(tabId);
    if (
      !target ||
      target.window !== window ||
      target.identity.windowId !== window.id ||
      target.identity.ownerWebContentsId !== window.webContents.id
    )
      throw new Error("Browser annotation owner mismatch");
    if (command === "browser_tab_focus_annotation_composer") {
      if (
        !isDeepStrictEqual(record.identity, target.identity) ||
        !target.selected ||
        window.isDestroyed() ||
        window.webContents.isDestroyed() ||
        target.view.webContents.isDestroyed() ||
        target.view.webContents.id !== target.identity.webContentsId ||
        !target.view.getVisible() ||
        !window.contentView.children.includes(target.view)
      )
        throw new Error("Browser annotation composer target changed");
      window.webContents.focus();
      return { ...target.identity, focused: true };
    }
    if (command === "browser_tab_begin_annotation")
      return this.#begin(target, annotationKind(record.kind));
    if (command === "browser_tab_set_annotation_markers")
      return this.#presentation.setMarkers(target, record.visible);
    if (command === "browser_tab_set_annotation_original")
      return this.#presentation.setOriginal(
        target,
        record,
        this.#available(target),
      );
    const annotationId = annotationString(record.annotationId);
    const entry = this.#entries.get(annotationId);
    if (command === "browser_tab_cancel_annotation") {
      const cancelled = entry?.session.viewId === target.identity.viewId;
      if (cancelled) this.#cancel(entry!, "cancelled");
      return { annotationId, cancelled };
    }
    if (
      !entry ||
      entry.session.annotationId !== annotationId ||
      !entry.selection ||
      entry.retained ||
      entry.session.viewId !== target.identity.viewId
    )
      throw new Error("Browser annotation selection is unavailable");
    return this.#capture(entry);
  }

  #cancel(entry: AnnotationEntry, reason: string): void {
    if (this.#entries.get(entry.session.annotationId) !== entry) return;
    this.#entries.delete(entry.session.annotationId);
    this.#presentation.clearOriginal(entry.session.viewId);
    this.#design.remove(entry.session.annotationId);
    entry.pending?.resolve({ status: "stale" });
    entry.cleanup();
    this.#send(entry, { type: "cancel" });
    this.#emit("browser-tab-annotation-cancelled", {
      ...entry.session,
      reason,
    });
  }

  cancelView(viewId: string, reason: string): void {
    this.#presentation.clearOriginal(viewId);
    if (reason === "owner") this.#presentation.forget(viewId);
    for (const entry of [...this.#entries.values()])
      if (entry.session.viewId === viewId) this.#cancel(entry, reason);
  }

  previewDesign(event: BrowserAnnotationDesignEvent): void {
    const entry = this.#entries.get(event.annotationId);
    if (
      !entry?.retained ||
      !this.#current(entry) ||
      Object.entries({
        ...this.#identity(entry.session),
        pageRevision: entry.presentationRevision,
      }).some(
        ([key, value]) =>
          event[key as keyof BrowserAnnotationIdentity] !== value,
      )
    )
      return;
    try {
      this.#design.receive(event, (change) =>
        this.#send(entry, { type: "design-preview", change }),
      );
    } catch {
      /* A stale/invalid design cannot mutate the captured page. */
    }
  }

  refresh(viewId: string, annotationId: string): void {
    const entry = this.#entries.get(annotationId);
    if (
      !entry?.retained ||
      entry.session.viewId !== viewId ||
      !this.#current(entry)
    )
      return;
    if (entry.anchor)
      this.#onAnchor(
        { ...entry.session, pageRevision: entry.presentationRevision },
        entry.anchor,
        entry.target.view.getBounds(),
      );
    this.#send(entry, { type: "refresh" });
  }

  cancelWindow(windowId: number, reason: string): void {
    this.#presentation.clearWindow(windowId);
    for (const entry of [...this.#entries.values()])
      if (entry.session.windowId === windowId) {
        if (entry.retained && reason === "tab-switch") this.#pause(entry);
        else this.#cancel(entry, reason);
      }
  }

  revalidateView(viewId: string): void {
    for (const entry of [...this.#entries.values()]) {
      if (entry.session.viewId !== viewId) continue;
      const target = this.#samePage(entry);
      if (!target) this.#cancel(entry, "page-changed");
      else if (entry.retained && !this.#available(target)) this.#pause(entry);
      else if (entry.paused) this.#restore(entry);
      else if (!this.#current(entry)) this.#cancel(entry, "page-changed");
      else if (entry.retained) this.refresh(viewId, entry.session.annotationId);
    }
  }

  /** Only the owning Host may advance presentation after invalidating its snapshot. */
  advanceView(viewId: string, previousRevision: number): void {
    for (const entry of [...this.#entries.values()]) {
      if (entry.session.viewId !== viewId) continue;
      const nextRevision = previousRevision + 1;
      if (
        !entry.retained ||
        entry.presentationRevision !== previousRevision ||
        !this.#samePage(entry, nextRevision)
      ) {
        this.#cancel(entry, "page-changed");
        continue;
      }
      this.#pause(entry);
      entry.presentationRevision = nextRevision;
    }
  }

  #pause(entry: AnnotationEntry): void {
    if (entry.paused && !entry.startup) return;
    this.#presentation.clearOriginal(entry.session.viewId);
    const nextToken = randomUUID();
    this.#send(entry, { type: "hide-marker", nextToken });
    entry.paused = true;
    entry.token = nextToken;
    if (entry.startup) clearTimeout(entry.startup);
    entry.startup = null;
  }

  #restore(entry: AnnotationEntry): void {
    const target = this.#samePage(entry);
    if (!target || !this.#available(target) || entry.startup) return;
    entry.startup = setTimeout(() => {
      entry.startup = null;
      if (entry.paused) this.#cancel(entry, "marker-restore-timeout");
    }, this.#timeout);
    if (
      !this.#send(entry, {
        type: "restore-marker",
        nextPageRevision: entry.presentationRevision,
        markersVisible: this.#presentation.markersVisible(entry.session.viewId),
        original: this.#presentation.original(entry.session.viewId),
      })
    )
      this.#cancel(entry, "marker-restore-failed");
    else entry.markerRevision = entry.presentationRevision;
  }

  dispose(): void {
    for (const entry of [...this.#entries.values()])
      this.#cancel(entry, "host-dispose");
    this.#presentation.dispose();
    if (this.#listening) {
      ipcMain.off(BROWSER_ANNOTATION_PAGE_EVENT, this.#listener);
      this.#listening = false;
    }
  }

  #available(target: BrowserAnnotationTarget): boolean {
    const { view, window, identity } = target;
    const bounds = view.getBounds();
    return (
      target.selected &&
      target.annotationAllowed &&
      !window.isDestroyed() &&
      !view.webContents.isDestroyed() &&
      view.webContents.id === identity.webContentsId &&
      window.id === identity.windowId &&
      window.webContents.id === identity.ownerWebContentsId &&
      view.getVisible() &&
      window.contentView.children.includes(view) &&
      bounds.width > 0 &&
      bounds.height > 0 &&
      !view.webContents.isLoading()
    );
  }

  #current(entry: AnnotationEntry): boolean {
    const next = this.#samePage(entry);
    return Boolean(
      !entry.paused &&
      next &&
      this.#available(next) &&
      (entry.retained ||
        isDeepStrictEqual(next.view.getBounds(), entry.bounds)),
    );
  }

  #samePage(
    entry: AnnotationEntry,
    pageRevision = entry.presentationRevision,
  ): BrowserAnnotationTarget | null {
    try {
      const next = this.#resolve(entry.session.tabId);
      return this.#entries.get(entry.session.annotationId) === entry &&
        next !== null &&
        next.view === entry.target.view &&
        next.window === entry.target.window &&
        isDeepStrictEqual(next.identity, {
          ...this.#identity(entry.session),
          pageRevision,
        }) &&
        !next.window.isDestroyed() &&
        !next.view.webContents.isDestroyed() &&
        next.view.webContents.mainFrame === entry.frame &&
        next.view.webContents.getURL() === entry.url
        ? next
        : null;
    } catch {
      return null;
    }
  }

  #identity(session: BrowserAnnotationSession): BrowserAnnotationIdentity {
    const {
      annotationId: _id,
      kind: _kind,
      scope: _scope,
      ...identity
    } = session;
    return identity;
  }

  #begin(
    target: BrowserAnnotationTarget,
    kind: BrowserAnnotationSession["kind"],
  ): BrowserAnnotationSession {
    if (!this.#available(target))
      throw new Error(
        "Browser annotation requires a visible attached selected page",
      );
    if (!this.#listening) {
      ipcMain.on(BROWSER_ANNOTATION_PAGE_EVENT, this.#listener);
      this.#listening = true;
    }
    for (const entry of [...this.#entries.values()])
      if (entry.session.windowId === target.window.id && !entry.retained)
        this.#cancel(entry, "replaced");
    const webContents = target.view.webContents;
    const session: BrowserAnnotationSession = {
      ...target.identity,
      annotationId: randomUUID(),
      kind,
      scope: "page",
    };
    const entry: AnnotationEntry = {
      session,
      target,
      token: randomUUID(),
      presentationRevision: session.pageRevision,
      markerRevision: session.pageRevision,
      documentToken: null,
      frame: webContents.mainFrame,
      url: webContents.getURL(),
      bounds: target.view.getBounds(),
      selection: null,
      cleanup: () => undefined,
      pending: null,
      capturing: false,
      retained: false,
      paused: false,
      anchor: null,
      startup: null,
    };
    entry.cleanup = () => {
      if (entry.startup) clearTimeout(entry.startup);
      if (
        ![...this.#entries.values()].some(
          (item) => item.session.viewId === session.viewId,
        )
      ) {
        this.#watchers.get(session.viewId)?.();
        this.#watchers.delete(session.viewId);
      }
    };
    this.#entries.set(session.annotationId, entry);
    this.#watch(target);
    entry.startup = setTimeout(() => {
      if (
        this.#entries.get(session.annotationId) === entry &&
        !entry.documentToken
      )
        this.cancelView(session.viewId, "page-preload-timeout");
    }, this.#timeout);
    try {
      if (!this.#send(entry, { type: "begin", kind }))
        throw new Error("Browser annotation page preload is unavailable");
      webContents.focus();
    } catch (error) {
      this.cancelView(session.viewId, "begin-failed");
      throw error;
    }
    return { ...session };
  }

  #watch(target: BrowserAnnotationTarget): void {
    const viewId = target.identity.viewId;
    if (this.#watchers.has(viewId)) return;
    const webContents = target.view.webContents;
    const active = () => this.#watchers.get(viewId) === cleanup;
    const cancel = () => {
      if (active()) this.cancelView(viewId, "owner-unavailable");
    };
    const navigation = (
      _event: unknown,
      _url: string,
      _inPlace: boolean,
      mainFrame: boolean,
    ) => {
      if (active() && mainFrame) this.cancelView(viewId, "navigation");
    };
    const pageNavigation = (
      _event: unknown,
      _url: string,
      mainFrame: boolean,
    ) => {
      if (active() && mainFrame) this.cancelView(viewId, "navigation");
    };
    const viewport = () => {
      if (!active()) return;
      for (const entry of [...this.#entries.values()]) {
        if (entry.session.viewId !== viewId) continue;
        if (entry.paused) continue;
        if (entry.retained) this.#send(entry, { type: "refresh" });
        else this.#cancel(entry, "viewport-changed");
      }
    };
    const resume = () => {
      if (!active()) return;
      for (const entry of this.#entries.values()) {
        if (
          entry.session.viewId === viewId &&
          !entry.retained &&
          entry.documentToken &&
          this.#current(entry)
        ) {
          if (!entry.selection && !entry.capturing)
            this.#emit("browser-tab-annotation-input-state", {
              ...entry.session,
              suspended: false,
              addModifierPressed: false,
            });
          this.#send(entry, { type: "resume" });
        }
      }
    };
    const cleanup = () => {
      webContents.off("did-start-navigation", navigation);
      webContents.off("did-navigate-in-page", pageNavigation);
      webContents.off("destroyed", cancel);
      webContents.off("render-process-gone", cancel);
      webContents.off("blur", resume);
      target.window.off("closed", cancel);
      target.window.off("resize", viewport);
      target.window.off("blur", resume);
      target.window.webContents.off("did-start-navigation", cancel);
      target.window.webContents.off("destroyed", cancel);
    };
    this.#watchers.set(viewId, cleanup);
    webContents.on("blur", resume);
    webContents.on("did-start-navigation", navigation);
    webContents.on("did-navigate-in-page", pageNavigation);
    webContents.on("destroyed", cancel);
    webContents.on("render-process-gone", cancel);
    target.window.on("closed", cancel);
    target.window.on("resize", viewport);
    target.window.on("blur", resume);
    target.window.webContents.on("did-start-navigation", cancel);
    target.window.webContents.on("destroyed", cancel);
  }

  #send(entry: AnnotationEntry, payload: Record<string, unknown>): boolean {
    if (entry.target.view.webContents.isDestroyed()) return false;
    try {
      entry.frame.send(BROWSER_ANNOTATION_PAGE_COMMAND, {
        ...payload,
        annotationId: entry.session.annotationId,
        token: entry.token,
        pageRevision: entry.markerRevision,
        documentToken: entry.documentToken,
      });
      return true;
    } catch {
      /* Navigation/destruction can retire the frame before cleanup. */
      return false;
    }
  }

  #receive(event: IpcMainEvent, payload: unknown): void {
    try {
      const record = annotationRecord(payload);
      const entry = [...this.#entries.values()].find(
        (item) =>
          item.target.view.webContents === event.sender &&
          item.session.annotationId === record.annotationId,
      );
      if (
        !entry ||
        event.senderFrame !== entry.frame ||
        event.senderFrame !== event.sender.mainFrame ||
        record.annotationId !== entry.session.annotationId ||
        record.token !== entry.token ||
        record.pageRevision !== entry.presentationRevision
      )
        return;
      if (entry.paused) {
        const target = this.#samePage(entry);
        if (
          record.type === "marker-restored" &&
          entry.startup !== null &&
          record.documentToken === entry.documentToken &&
          target &&
          this.#available(target)
        ) {
          if (entry.startup) clearTimeout(entry.startup);
          entry.startup = null;
          entry.paused = false;
          this.#send(entry, {
            type: "set-marker-visibility",
            visible: this.#presentation.markersVisible(entry.session.viewId),
          });
          if (this.#presentation.original(entry.session.viewId))
            this.#send(entry, { type: "design-original", original: true });
          this.#send(entry, { type: "refresh" });
        }
        return;
      }
      if (!this.#current(entry)) {
        if (entry.retained) this.revalidateView(entry.session.viewId);
        else this.cancelView(entry.session.viewId, "stale");
        return;
      }
      const documentToken = annotationString(record.documentToken);
      if (record.type === "began") {
        if (entry.documentToken === null) {
          entry.documentToken = documentToken;
          if (entry.startup) clearTimeout(entry.startup);
          entry.startup = null;
        }
        return;
      }
      if (documentToken !== entry.documentToken) return;
      if (entry.retained) {
        if (record.type === "anchor") {
          entry.anchor = readAnnotationAnchor(record.anchor);
          this.#onAnchor(
            { ...entry.session, pageRevision: entry.presentationRevision },
            entry.anchor,
            entry.target.view.getBounds(),
          );
        } else if (
          record.type === "activate" &&
          this.#presentation.markersVisible(entry.session.viewId)
        ) {
          this.#onActivate({
            ...entry.session,
            pageRevision: entry.presentationRevision,
          });
          this.#emit("browser-tab-annotation-activate", {
            ...entry.session,
            presentationPageRevision: entry.presentationRevision,
          });
        }
        return;
      }
      if (
        record.type === "input-state" &&
        !entry.selection &&
        !entry.capturing
      ) {
        if (
          typeof record.suspended !== "boolean" ||
          typeof record.addModifierPressed !== "boolean"
        )
          return;
        this.#emit("browser-tab-annotation-input-state", {
          ...entry.session,
          suspended: record.suspended,
          addModifierPressed: record.addModifierPressed,
        });
      } else if (record.type === "cancel") {
        this.#cancel(
          entry,
          typeof record.reason === "string"
            ? record.reason.slice(0, 100)
            : "page-cancelled",
        );
      } else if (record.type === "selection" && !entry.selection) {
        const kind =
          entry.session.kind === "element"
            ? annotationKind(annotationRecord(record.selection).kind)
            : entry.session.kind;
        const selected = readAnnotationSelection(
          record.selection,
          kind,
          entry.url,
          event.sender.getTitle(),
        );
        const designSnapshot =
          kind === "element"
            ? this.#design.register(
                entry.session.annotationId,
                record.designSnapshot,
              )
            : undefined;
        entry.session.kind = kind;
        entry.selection = selected;
        this.#emit("browser-tab-annotation-selection", {
          ...entry.session,
          selection: structuredClone(entry.selection),
          ...(designSnapshot ? { designSnapshot } : {}),
        });
      } else if (
        record.type === "ready" &&
        record.requestId === entry.pending?.requestId
      ) {
        entry.pending?.resolve(record);
      }
    } catch {
      /* Malformed or stale untrusted page messages have no authority. */
    }
  }

  async #capture(
    entry: AnnotationEntry,
  ): Promise<BrowserAnnotationCaptureResult> {
    if (entry.capturing)
      throw new Error("Browser annotation capture is already pending");
    const selection = structuredClone(entry.selection!);
    const result: BrowserAnnotationCaptureResult = {
      annotationId: entry.session.annotationId,
      selection,
      screenshot: null,
      screenshotStatus: "failed",
      failureReason: "capture-failed",
    };
    const requestId = randomUUID();
    let timer: ReturnType<typeof setTimeout> | undefined;
    entry.capturing = true;
    try {
      if (!this.#current(entry)) {
        result.screenshotStatus = "stale";
        result.failureReason = "page-changed";
        return result;
      }
      const ready = new Promise<Record<string, unknown>>((resolve) => {
        entry.pending = { requestId, resolve };
        timer = setTimeout(() => resolve({ status: "timeout" }), this.#timeout);
      });
      this.#send(entry, { type: "prepare", requestId });
      const prepared = await ready;
      if (timer) clearTimeout(timer);
      if (!this.#current(entry) || prepared.status === "stale") {
        result.screenshotStatus = "stale";
        result.failureReason = "page-changed";
        return result;
      }
      if (prepared.status === "timeout") {
        result.screenshotStatus = "timeout";
        result.failureReason = "page-ready-timeout";
        return result;
      }
      if (
        prepared.status !== "ready" ||
        !isDeepStrictEqual(
          readAnnotationSelection(
            prepared.selection,
            entry.session.kind,
            entry.url,
            entry.target.view.webContents.getTitle(),
          ),
          selection,
        )
      ) {
        result.screenshotStatus = "stale";
        result.failureReason = "selection-changed";
        return result;
      }
      const image = await Promise.race([
        entry.target.view.webContents.capturePage(),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), this.#timeout * 5);
        }),
      ]);
      if (!this.#current(entry)) {
        result.screenshotStatus = "stale";
        result.failureReason = "page-changed";
        return result;
      }
      if (image === null) {
        result.screenshotStatus = "timeout";
        result.failureReason = "capture-timeout";
        return result;
      }
      result.screenshot = annotationScreenshot(image, selection, this.#mode());
      result.screenshotStatus = "captured";
      result.failureReason = null;
      return result;
    } catch {
      return result;
    } finally {
      if (timer) clearTimeout(timer);
      entry.pending = null;
      entry.capturing = false;
      if (this.#current(entry) && result.screenshotStatus !== "stale") {
        entry.retained = true;
        this.#send(entry, {
          type: "retain",
          requestId,
          markersVisible: this.#presentation.markersVisible(
            entry.session.viewId,
          ),
          original: this.#presentation.original(entry.session.viewId),
        });
      } else this.#send(entry, { type: "clear", requestId });
      if (
        this.#entries.get(entry.session.annotationId) === entry &&
        !this.#current(entry)
      )
        this.cancelView(entry.session.viewId, "stale");
    }
  }
}
