import { randomUUID } from "node:crypto";
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
  annotationCrop,
  annotationKind,
  annotationRecord,
  annotationString,
  BROWSER_ANNOTATION_PAGE_COMMAND,
  BROWSER_ANNOTATION_PAGE_EVENT,
  readAnnotationSelection,
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
  view: WebContentsView;
  window: BrowserWindow;
}

interface AnnotationEntry {
  session: BrowserAnnotationSession;
  target: BrowserAnnotationTarget;
  token: string;
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
  startup: ReturnType<typeof setTimeout> | null;
}

/** Owns page IPC and authoritative geometry; it never accepts a renderer crop rectangle. */
export class BrowserAnnotationHost {
  readonly #entries = new Map<string, AnnotationEntry>();
  readonly #resolve: (tabId: string) => BrowserAnnotationTarget | null;
  readonly #emit: (event: string, payload: unknown) => void;
  readonly #mode: () => "always" | "necessary";
  readonly #timeout: number;
  #listening = false;
  readonly #listener = (event: IpcMainEvent, payload: unknown) =>
    this.#receive(event, payload);

  constructor(options: {
    resolveTarget: (tabId: string) => BrowserAnnotationTarget | null;
    emit: (event: string, payload: unknown) => void;
    screenshotMode: () => "always" | "necessary";
    timeoutMs?: number;
  }) {
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
    const record = annotationRecord(args);
    const allowed =
      command === "browser_tab_begin_annotation"
        ? ["tabId", "kind"]
        : ["tabId", "annotationId"];
    if (Object.keys(record).some((key) => !allowed.includes(key)))
      throw new Error("Unknown Browser annotation argument");
    const tabId = annotationString(record.tabId);
    const target = this.#resolve(tabId);
    if (
      !target ||
      target.window !== window ||
      target.identity.windowId !== window.id ||
      target.identity.ownerWebContentsId !== window.webContents.id
    )
      throw new Error("Browser annotation owner mismatch");
    if (command === "browser_tab_begin_annotation")
      return this.#begin(target, annotationKind(record.kind));
    const annotationId = annotationString(record.annotationId);
    const entry = this.#entries.get(target.identity.viewId);
    if (command === "browser_tab_cancel_annotation") {
      const cancelled = entry?.session.annotationId === annotationId;
      if (cancelled) this.cancelView(target.identity.viewId, "cancelled");
      return { annotationId, cancelled };
    }
    if (
      !entry ||
      entry.session.annotationId !== annotationId ||
      !entry.selection
    )
      throw new Error("Browser annotation selection is unavailable");
    return this.#capture(entry);
  }

  cancelView(viewId: string, reason: string): void {
    const entry = this.#entries.get(viewId);
    if (!entry) return;
    this.#entries.delete(viewId);
    entry.pending?.resolve({ status: "stale" });
    entry.cleanup();
    this.#send(entry, { type: "cancel" });
    this.#emit("browser-tab-annotation-cancelled", {
      ...entry.session,
      reason,
    });
  }

  cancelWindow(windowId: number, reason: string): void {
    for (const entry of [...this.#entries.values()])
      if (entry.session.windowId === windowId)
        this.cancelView(entry.session.viewId, reason);
  }

  revalidateView(viewId: string): void {
    const entry = this.#entries.get(viewId);
    if (entry && !this.#current(entry)) this.cancelView(viewId, "page-changed");
  }

  dispose(): void {
    for (const viewId of [...this.#entries.keys()])
      this.cancelView(viewId, "host-dispose");
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
    try {
      const next = this.#resolve(entry.session.tabId);
      return (
        this.#entries.get(entry.session.viewId) === entry &&
        next !== null &&
        this.#available(next) &&
        next.view === entry.target.view &&
        next.window === entry.target.window &&
        isDeepStrictEqual(next.identity, this.#identity(entry.session)) &&
        isDeepStrictEqual(next.view.getBounds(), entry.bounds) &&
        next.view.webContents.mainFrame === entry.frame &&
        next.view.webContents.getURL() === entry.url
      );
    } catch {
      return false;
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
    this.cancelWindow(target.window.id, "replaced");
    const webContents = target.view.webContents;
    const session: BrowserAnnotationSession = {
      ...target.identity,
      annotationId: randomUUID(),
      kind,
      scope: "main-frame",
    };
    const entry: AnnotationEntry = {
      session,
      target,
      token: randomUUID(),
      documentToken: null,
      frame: webContents.mainFrame,
      url: webContents.getURL(),
      bounds: target.view.getBounds(),
      selection: null,
      cleanup: () => undefined,
      pending: null,
      capturing: false,
      startup: null,
    };
    const cancel = () => this.cancelView(session.viewId, "owner-unavailable");
    const navigation = (
      _event: unknown,
      _url: string,
      _inPlace: boolean,
      mainFrame: boolean,
    ) => {
      if (mainFrame) this.cancelView(session.viewId, "navigation");
    };
    const pageNavigation = (
      _event: unknown,
      _url: string,
      mainFrame: boolean,
    ) => {
      if (mainFrame) this.cancelView(session.viewId, "navigation");
    };
    const viewport = () => this.cancelView(session.viewId, "viewport-changed");
    webContents.on("did-start-navigation", navigation);
    webContents.on("did-navigate-in-page", pageNavigation);
    webContents.on("destroyed", cancel);
    webContents.on("render-process-gone", cancel);
    target.window.on("closed", cancel);
    target.window.on("resize", viewport);
    target.window.webContents.on("did-start-navigation", cancel);
    target.window.webContents.on("destroyed", cancel);
    entry.cleanup = () => {
      if (entry.startup) clearTimeout(entry.startup);
      webContents.off("did-start-navigation", navigation);
      webContents.off("did-navigate-in-page", pageNavigation);
      webContents.off("destroyed", cancel);
      webContents.off("render-process-gone", cancel);
      target.window.off("closed", cancel);
      target.window.off("resize", viewport);
      target.window.webContents.off("did-start-navigation", cancel);
      target.window.webContents.off("destroyed", cancel);
    };
    this.#entries.set(session.viewId, entry);
    entry.startup = setTimeout(() => {
      if (this.#entries.get(session.viewId) === entry && !entry.documentToken)
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

  #send(entry: AnnotationEntry, payload: Record<string, unknown>): boolean {
    if (entry.target.view.webContents.isDestroyed()) return false;
    try {
      entry.frame.send(BROWSER_ANNOTATION_PAGE_COMMAND, {
        ...payload,
        annotationId: entry.session.annotationId,
        token: entry.token,
        pageRevision: entry.session.pageRevision,
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
        (item) => item.target.view.webContents === event.sender,
      );
      if (
        !entry ||
        event.senderFrame !== entry.frame ||
        event.senderFrame !== event.sender.mainFrame ||
        record.annotationId !== entry.session.annotationId ||
        record.token !== entry.token ||
        record.pageRevision !== entry.session.pageRevision
      )
        return;
      if (!this.#current(entry)) {
        this.cancelView(entry.session.viewId, "stale");
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
      if (record.type === "cancel") {
        this.cancelView(
          entry.session.viewId,
          typeof record.reason === "string"
            ? record.reason.slice(0, 100)
            : "page-cancelled",
        );
      } else if (record.type === "selection" && !entry.selection) {
        const kind =
          entry.session.kind === "element" &&
          annotationRecord(record.selection).kind === "region"
            ? "region"
            : entry.session.kind;
        const selected = readAnnotationSelection(
          record.selection,
          kind,
          entry.url,
          event.sender.getTitle(),
        );
        entry.session.kind = kind;
        entry.selection = selected;
        this.#emit("browser-tab-annotation-selection", {
          ...entry.session,
          selection: structuredClone(entry.selection),
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
      if (image.isEmpty())
        throw new Error("Empty Browser annotation screenshot");
      const size = image.getSize();
      const crop = annotationCrop(selection, size, this.#mode());
      let output = crop ? image.crop(crop.pixels) : image;
      const limit = crop ? 1024 : 1280;
      const outputSize = output.getSize();
      const scale = Math.min(
        1,
        limit / Math.max(outputSize.width, outputSize.height),
      );
      if (scale < 1)
        output = output.resize({
          width: Math.max(1, Math.round(outputSize.width * scale)),
          height: Math.max(1, Math.round(outputSize.height * scale)),
          quality: "best",
        });
      if (output.isEmpty()) throw new Error("Empty Browser annotation crop");
      result.screenshot = {
        dataUrl: output.toDataURL(),
        ...output.getSize(),
        kind: crop ? "crop" : "viewport",
        viewportSize: selection.viewportSize,
        ...(crop ? { cropRect: crop.viewport } : {}),
      };
      result.screenshotStatus = "captured";
      result.failureReason = null;
      return result;
    } catch {
      return result;
    } finally {
      if (timer) clearTimeout(timer);
      entry.pending = null;
      entry.capturing = false;
      this.#send(entry, { type: "clear", requestId });
      if (
        this.#entries.get(entry.session.viewId) === entry &&
        !this.#current(entry)
      )
        this.cancelView(entry.session.viewId, "stale");
    }
  }
}
