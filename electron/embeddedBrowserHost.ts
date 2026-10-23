import process from "node:process";
import { randomUUID } from "node:crypto";
import {
  effectiveBrowserSettings,
  type BrowserSettings,
} from "../src/lib/api/browserSettingsTypes";
import {
  applyBrowserDevice,
  browserCommandForInput,
  captureBrowserPage,
  printBrowserPage,
  readBrowserDevice,
  type EmbeddedBrowserDeviceState,
} from "./embeddedBrowserPageActions";
import {
  readState,
  createEmptyFindState,
  readFindResult,
  readViewId,
  readUrl,
  readOptionalUrl,
  readBounds,
  readOptionalBounds,
  applyBounds,
  attachEntryToWindow,
  detachEntryFromWindow,
  closeEntryView,
  readOptionalBoolean,
  readString,
  readZoomFactor,
  readStopFindAction,
  normalizeHttpUrl,
  sanitizeDownloadFilename,
  classifyLoadFailure,
} from "./embeddedBrowserState";
import {
  app,
  session,
  WebContentsView,
  type BrowserWindow,
} from "./electronRuntime";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { installEmbeddedBrowserContextMenu } from "./embeddedBrowserContextMenu";
import {
  installEmbeddedBrowserDownloadHandling,
  type EmbeddedBrowserDownloadController,
} from "./embeddedBrowserDownloads";
import type { BrowserDownloadRecoveryRequest } from "./browserDownloadResume";
import { installEmbeddedBrowserPermissionHandling } from "./embeddedBrowserPermissions";
import { BrowserPermissionRequests } from "./browserPermissionRequests";
import {
  buildEmbeddedBrowserHtmlDataUrl,
  readEmbeddedBrowserHtmlPayload,
} from "./embeddedBrowserHtml";
import type {
  Session as ElectronSession,
  WebContents as ElectronWebContents,
  WebPreferences,
} from "electron";

type HostArgs = Record<string, unknown> | null | undefined;
type HostEventEmitter = (event: string, payload?: unknown) => void;
type EmbeddedBrowserDestroyReason =
  | "renderer-cleanup"
  | "renderer-navigation"
  | "window-closed"
  | "webcontents-destroyed"
  | "host-dispose";

export const EMBEDDED_BROWSER_COMMANDS = [
  "embedded_browser_view_mount",
  "embedded_browser_view_set_bounds",
  "embedded_browser_view_navigate",
  "embedded_browser_view_load_html",
  "embedded_browser_view_reload",
  "embedded_browser_view_stop",
  "embedded_browser_view_find_in_page",
  "embedded_browser_view_stop_find_in_page",
  "embedded_browser_view_set_zoom",
  "embedded_browser_view_go_back",
  "embedded_browser_view_go_forward",
  "embedded_browser_view_destroy",
  "embedded_browser_view_print",
  "embedded_browser_view_capture_screenshot",
  "embedded_browser_view_set_audio_muted",
  "embedded_browser_view_set_device",
] as const;

export type EmbeddedBrowserCommand = (typeof EMBEDDED_BROWSER_COMMANDS)[number];

export interface EmbeddedBrowserViewState {
  viewId: string;
  url: string;
  title: string;
  faviconUrl: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  loadProgress: number;
  zoomFactor: number;
  find: EmbeddedBrowserFindState;
  audioMuted: boolean;
  audible: boolean;
  device: EmbeddedBrowserDeviceState | null;
}

export type EmbeddedBrowserLoadFailureCategory =
  | "dns"
  | "tls"
  | "blocked"
  | "aborted"
  | "load_failed";

export interface EmbeddedBrowserFindState {
  text: string;
  activeMatchOrdinal: number;
  matches: number;
  finalUpdate: boolean;
}

export interface EmbeddedBrowserEntry {
  viewId: string;
  view: WebContentsView;
  window: BrowserWindow;
  closeListener: () => void;
  rendererNavigationListener: (
    event: unknown,
    url: string,
    isInPlace: boolean,
    isMainFrame: boolean,
  ) => void;
  webContentsDestroyedListener: () => void;
  webContentsGoneListener: () => void;
  leaseIds: Set<string>;
  pendingUrl?: string;
  sourceUri?: string;
  navigationToken: number;
  faviconUrl: string | null;
  loadProgress: number;
  find: EmbeddedBrowserFindState;
  findRequestId: number | null;
  device: EmbeddedBrowserDeviceState | null;
  openerViewId?: string;
}

type PendingPermission = {
  viewId: string;
  callback: (allowed: boolean) => void;
};

export interface EmbeddedBrowserPopupRequest {
  openerViewId: string;
  viewId: string;
  url: string;
  background: boolean;
}

export interface EmbeddedBrowserNativeView {
  state: EmbeddedBrowserViewState;
  view: WebContentsView;
  window: BrowserWindow;
}

const EMBEDDED_BROWSER_PARTITION = "persist:embedded-browser";
const EMBEDDED_BROWSER_ACCEPT_LANGUAGES = "zh-CN,zh,en-US,en";

export function isEmbeddedBrowserCommand(
  command: string,
): command is EmbeddedBrowserCommand {
  return EMBEDDED_BROWSER_COMMANDS.includes(command as EmbeddedBrowserCommand);
}

export class ElectronEmbeddedBrowserHost {
  #entries = new Map<string, EmbeddedBrowserEntry>();
  #downloadPaths = new Map<string, string>();
  #downloadObserver: EmbeddedBrowserDownloadController["onDownload"];
  #downloadHandling: ReturnType<typeof installEmbeddedBrowserDownloadHandling> | null = null;
  #pendingPermissions = new Map<string, PendingPermission>();
  #deferPermissions = false;
  #emit: HostEventEmitter;
  #sessionHandlersInstalled = false;
  readonly #downloadDirectory: string;
  #settings = effectiveBrowserSettings();
  #downloadPermission:
    | ((viewId: string, url: string) => Promise<boolean>)
    | null = null;
  #popupHandler:
    | ((request: EmbeddedBrowserPopupRequest) => Promise<void>)
    | null = null;
  #agentPermission:
    | ((viewId: string, url: string, action: "browse" | "download") => boolean)
    | null = null;
  readonly #requestPermissions = new BrowserPermissionRequests({
    viewId: (webContentsId) =>
      [...this.#entries.values()].find(
        (entry) => entry.view.webContents.id === webContentsId,
      )?.viewId ?? null,
    allows: (viewId, url) =>
      this.#agentPermission?.(viewId, url, "browse") !== false,
    blocked: (viewId, url, reason) => {
      const entry = this.#entries.get(viewId);
      if (entry) this.#emitLoadFailed(entry, -20, reason, url);
    },
  });

  constructor(
    emit: HostEventEmitter = () => undefined,
    options: { deferPermissions?: boolean } = {},
  ) {
    this.#emit = emit;
    this.#deferPermissions = options.deferPermissions === true;
    const downloadRoot =
      typeof app.getPath === "function"
        ? app.getPath("downloads")
        : process.env.TMPDIR || process.cwd();
    this.#downloadDirectory = downloadRoot;
    mkdirSync(this.#downloadDirectory, { recursive: true });
  }

  setSettings(settings: BrowserSettings): void {
    if (
      settings.download_directory &&
      !path.isAbsolute(settings.download_directory)
    ) {
      throw new Error("Browser download directory must be an absolute path");
    }
    this.#settings = effectiveBrowserSettings(settings);
  }

  setPopupHandler(
    handler: ((request: EmbeddedBrowserPopupRequest) => Promise<void>) | null,
  ): void {
    this.#popupHandler = handler;
  }

  setAgentPermissionResolver(
    handler: (
      viewId: string,
      url: string,
      action: "browse" | "download",
    ) => boolean,
  ): void {
    this.#agentPermission = handler;
  }

  setDownloadPermissionResolver(
    handler: (viewId: string, url: string) => Promise<boolean>,
  ): void {
    this.#downloadPermission = handler;
  }

  async invoke(
    window: BrowserWindow | null,
    command: EmbeddedBrowserCommand,
    args?: HostArgs,
  ): Promise<unknown> {
    if (command === "embedded_browser_view_destroy") {
      return this.#destroy(args, "renderer-cleanup");
    }

    if (!window || window.isDestroyed()) {
      throw new Error("当前窗口不可用，无法显示内嵌浏览器。");
    }

    switch (command) {
      case "embedded_browser_view_mount":
        return await this.#mount(window, args);
      case "embedded_browser_view_set_bounds":
        return this.#setBounds(window, args);
      case "embedded_browser_view_navigate":
        return await this.#navigate(window, args);
      case "embedded_browser_view_load_html":
        return await this.#loadHtml(window, args);
      case "embedded_browser_view_reload":
        return this.#reload(window, args);
      case "embedded_browser_view_stop":
        return this.#stop(window, args);
      case "embedded_browser_view_find_in_page":
        return this.#findInPage(window, args);
      case "embedded_browser_view_stop_find_in_page":
        return this.#stopFindInPage(window, args);
      case "embedded_browser_view_set_zoom":
        return this.#setZoom(window, args);
      case "embedded_browser_view_go_back":
        return this.#goBack(window, args);
      case "embedded_browser_view_go_forward":
        return this.#goForward(window, args);
      case "embedded_browser_view_print":
        return printBrowserPage(
          this.#requireEntry(window, args).view.webContents,
        );
      case "embedded_browser_view_capture_screenshot":
        return captureBrowserPage(
          this.#requireEntry(window, args).view.webContents,
          args?.copyToClipboard === true,
        );
      case "embedded_browser_view_set_audio_muted": {
        const entry = this.#requireEntry(window, args);
        if (typeof args?.muted !== "boolean")
          throw new Error("Browser muted must be a boolean");
        entry.view.webContents.setAudioMuted(args.muted);
        return this.#emitState(entry);
      }
      case "embedded_browser_view_set_device": {
        const entry = this.#requireEntry(window, args);
        const device = readBrowserDevice(args?.device);
        applyBrowserDevice(entry.view.webContents, device);
        entry.device = device;
        return this.#emitState(entry);
      }
      default:
        throw new Error(`Unsupported embedded browser command: ${command}`);
    }
  }

  dispose(): void {
    this.#downloadHandling?.dispose();
    for (const viewId of [...this.#entries.keys()]) {
      this.#destroy({ viewId }, "host-dispose");
    }
    this.#requestPermissions.dispose();
  }

  takeBlockedNavigation(viewId: string): string | null {
    return this.#requestPermissions.takeFailure(viewId);
  }

  resolveNativeView(viewId: string): EmbeddedBrowserNativeView | null {
    const entry = this.#entries.get(viewId);
    if (
      !entry ||
      entry.window.isDestroyed() ||
      entry.view.webContents.isDestroyed()
    ) {
      return null;
    }
    return {
      state: readState(entry),
      view: entry.view,
      window: entry.window,
    };
  }

  resolvePopupOpener(viewId: string): string | null {
    return this.#entries.get(viewId)?.openerViewId ?? null;
  }

  /** 仅供 Browser Host 以受控 downloadId 解析完成下载，不暴露给 Renderer。 */
  resolveDownloadPath(downloadId: string): string | null {
    return this.#downloadPaths.get(downloadId) ?? null;
  }

  setDownloadObserver(
    observer: EmbeddedBrowserDownloadController["onDownload"],
  ): void {
    this.#downloadObserver = observer;
  }

  resumeDownload(request: BrowserDownloadRecoveryRequest): Promise<void> {
    const { embeddedSession } = configureEmbeddedBrowserSession();
    this.#installSessionHandlers(embeddedSession);
    return this.#downloadHandling!.resume(request);
  }

  prepareDownloadShutdown(): void {
    this.#downloadHandling?.prepareShutdown();
  }

  resolvePermission(
    requestId: string,
    allowed: boolean,
    expectedViewId?: string,
  ): boolean {
    const pending = this.#pendingPermissions.get(requestId);
    if (!pending || (expectedViewId && pending.viewId !== expectedViewId)) {
      return false;
    }
    this.#pendingPermissions.delete(requestId);
    pending.callback(allowed);
    return true;
  }

  clearPendingPermission(requestId: string, expectedViewId?: string): boolean {
    const pending = this.#pendingPermissions.get(requestId);
    if (!pending || (expectedViewId && pending.viewId !== expectedViewId)) {
      return false;
    }
    this.#pendingPermissions.delete(requestId);
    pending.callback(false);
    return true;
  }

  clearPendingPermissions(viewId?: string): void {
    for (const [requestId, pending] of this.#pendingPermissions) {
      if (viewId && pending.viewId !== viewId) {
        continue;
      }
      this.#pendingPermissions.delete(requestId);
      pending.callback(false);
    }
  }

  pendingPermissionViewId(requestId: string): string | null {
    return this.#pendingPermissions.get(requestId)?.viewId ?? null;
  }

  async #mount(
    window: BrowserWindow,
    args?: HostArgs,
  ): Promise<EmbeddedBrowserViewState> {
    const viewId = readViewId(args);
    const url = readOptionalUrl(args);
    const bounds = readOptionalBounds(args);
    const visible = readOptionalBoolean(args, "visible") ?? true;
    const entry = this.#ensureEntry(window, viewId);
    const leaseId = readString(args, "leaseId");
    if (leaseId) {
      entry.leaseIds.add(leaseId);
    }

    if (bounds) {
      applyBounds(entry.view, bounds, visible);
    } else {
      entry.view.setVisible(visible);
    }

    if (url) {
      this.#startNavigation(entry, url);
    }

    return this.#emitState(entry);
  }

  #setBounds(window: BrowserWindow, args?: HostArgs): EmbeddedBrowserViewState {
    const entry = this.#ensureEntry(window, readViewId(args));
    const bounds = readBounds(args);
    const visible = readOptionalBoolean(args, "visible") ?? true;
    applyBounds(entry.view, bounds, visible);
    return this.#emitState(entry);
  }

  async #navigate(
    window: BrowserWindow,
    args?: HostArgs,
  ): Promise<EmbeddedBrowserViewState> {
    const entry = this.#ensureEntry(window, readViewId(args));
    this.#startNavigation(entry, readUrl(args));
    return this.#emitState(entry);
  }

  async #loadHtml(
    window: BrowserWindow,
    args?: HostArgs,
  ): Promise<EmbeddedBrowserViewState> {
    const entry = this.#ensureEntry(window, readViewId(args));
    const payload = readEmbeddedBrowserHtmlPayload(args);
    entry.sourceUri = payload.sourceUri;
    this.#startNavigation(
      entry,
      payload.sourceUri,
      buildEmbeddedBrowserHtmlDataUrl(payload),
    );
    return this.#emitState(entry);
  }

  #reload(window: BrowserWindow, args?: HostArgs): EmbeddedBrowserViewState {
    const entry = this.#ensureEntry(window, readViewId(args));
    entry.loadProgress = 0.1;
    entry.view.webContents.reload();
    return this.#emitState(entry);
  }

  #stop(window: BrowserWindow, args?: HostArgs): EmbeddedBrowserViewState {
    const entry = this.#ensureEntry(window, readViewId(args));
    entry.pendingUrl = undefined;
    if (entry.view.webContents.isLoading()) {
      entry.view.webContents.stop();
    }
    entry.loadProgress = 1;
    return this.#emitState(entry);
  }

  #findInPage(
    window: BrowserWindow,
    args?: HostArgs,
  ): EmbeddedBrowserViewState {
    const entry = this.#ensureEntry(window, readViewId(args));
    const text = readString(args, "text") ?? "";
    if (!text) {
      return this.#stopFindInPage(window, args);
    }

    entry.find = {
      text,
      activeMatchOrdinal: 0,
      matches: 0,
      finalUpdate: false,
    };
    entry.findRequestId = entry.view.webContents.findInPage(text, {
      forward: readOptionalBoolean(args, "forward") ?? true,
      findNext: readOptionalBoolean(args, "findNext") ?? false,
    });
    return this.#emitState(entry);
  }

  #stopFindInPage(
    window: BrowserWindow,
    args?: HostArgs,
  ): EmbeddedBrowserViewState {
    const entry = this.#ensureEntry(window, readViewId(args));
    entry.findRequestId = null;
    entry.find = createEmptyFindState();
    entry.view.webContents.stopFindInPage(readStopFindAction(args));
    return this.#emitState(entry);
  }

  #setZoom(window: BrowserWindow, args?: HostArgs): EmbeddedBrowserViewState {
    const entry = this.#ensureEntry(window, readViewId(args));
    const zoomFactor = readZoomFactor(args);
    entry.view.webContents.setZoomFactor(zoomFactor);
    return this.#emitState(entry);
  }

  #goBack(window: BrowserWindow, args?: HostArgs): EmbeddedBrowserViewState {
    const entry = this.#ensureEntry(window, readViewId(args));
    if (entry.view.webContents.navigationHistory.canGoBack()) {
      entry.view.webContents.navigationHistory.goBack();
    }
    return this.#emitState(entry);
  }

  #goForward(window: BrowserWindow, args?: HostArgs): EmbeddedBrowserViewState {
    const entry = this.#ensureEntry(window, readViewId(args));
    if (entry.view.webContents.navigationHistory.canGoForward()) {
      entry.view.webContents.navigationHistory.goForward();
    }
    return this.#emitState(entry);
  }

  #destroy(
    args: HostArgs,
    reason: EmbeddedBrowserDestroyReason,
  ): Record<string, never> {
    const viewId = readViewId(args);
    const entry = this.#entries.get(viewId);
    if (!entry) {
      return {};
    }
    const leaseId = readString(args, "leaseId");
    if (leaseId) {
      if (!entry.leaseIds.delete(leaseId) || entry.leaseIds.size > 0) {
        return {};
      }
    }

    this.#entries.delete(viewId);
    this.#requestPermissions.forget(viewId);
    for (const [requestId, pending] of this.#pendingPermissions) {
      if (pending.viewId === viewId) {
        pending.callback(false);
        this.#pendingPermissions.delete(requestId);
      }
    }
    detachEntryFromWindow(entry);
    closeEntryView(entry);
    this.#emit("embedded-browser-view-destroyed", {
      viewId,
      reason,
      requestedLeaseId: leaseId,
      remainingLeaseCount: entry.leaseIds.size,
    });
    return {};
  }

  #requireEntry(window: BrowserWindow, args?: HostArgs): EmbeddedBrowserEntry {
    const entry = this.#entries.get(readViewId(args));
    if (
      !entry ||
      entry.window !== window ||
      entry.view.webContents.isDestroyed()
    ) {
      throw new Error(
        "Browser native view is stale or owned by another window",
      );
    }
    return entry;
  }

  #ensureEntry(
    window: BrowserWindow,
    viewId: string,
    webPreferences?: WebPreferences,
  ): EmbeddedBrowserEntry {
    const existing = this.#entries.get(viewId);
    if (existing) {
      if (existing.window !== window) {
        detachEntryFromWindow(existing);
        existing.window = window;
        existing.closeListener = () =>
          this.#destroy({ viewId }, "window-closed");
        existing.rendererNavigationListener =
          this.#createRendererNavigationListener(viewId);
        attachEntryToWindow(existing, window);
        return existing;
      }
      window.contentView.addChildView(existing.view);
      return existing;
    }

    const { embeddedSession, userAgent: embeddedBrowserUserAgent } =
      configureEmbeddedBrowserSession();
    this.#installSessionHandlers(embeddedSession);
    const view = new WebContentsView({
      webPreferences: {
        ...webPreferences,
        session: embeddedSession,
        contextIsolation: true,
        javascript: true,
        nodeIntegration: false,
        partition: EMBEDDED_BROWSER_PARTITION,
        sandbox: true,
        webSecurity: true,
        preload: path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "../preload/browserPage.cjs",
        ),
        nodeIntegrationInSubFrames: false,
      },
    });
    view.setBackgroundColor("#ffffff");
    view.webContents.setUserAgent(embeddedBrowserUserAgent);
    const entry: EmbeddedBrowserEntry = {
      viewId,
      view,
      window,
      closeListener: () => this.#destroy({ viewId }, "window-closed"),
      rendererNavigationListener:
        this.#createRendererNavigationListener(viewId),
      webContentsDestroyedListener: () =>
        this.#destroy({ viewId }, "webcontents-destroyed"),
      webContentsGoneListener: () =>
        this.#destroy({ viewId }, "webcontents-destroyed"),
      leaseIds: new Set<string>(),
      navigationToken: 0,
      faviconUrl: null,
      loadProgress: 1,
      find: createEmptyFindState(),
      findRequestId: null,
      device: null,
    };
    view.webContents.setWindowOpenHandler(({ url, disposition }) => {
      const popupHandler = this.#popupHandler;
      const normalizedUrl =
        url === "" || url === "about:blank"
          ? "about:blank"
          : normalizeHttpUrl(url);
      const permissionUrl =
        normalizedUrl === "about:blank"
          ? entry.view.webContents.getURL()
          : normalizedUrl;
      if (
        entry.sourceUri ||
        !popupHandler ||
        !normalizedUrl ||
        this.#agentPermission?.(entry.viewId, permissionUrl || "", "browse") ===
          false
      ) {
        if (
          normalizedUrl &&
          this.#agentPermission?.(
            entry.viewId,
            permissionUrl || "",
            "browse",
          ) === false
        )
          this.#emitLoadFailed(
            entry,
            -20,
            `Browser Agent popup to ${permissionUrl} is blocked without a turn browsing grant; retry newTab to request access`,
            permissionUrl || undefined,
          );
        return { action: "deny" };
      }
      return {
        action: "allow",
        createWindow: (options) => {
          const popupId = `browser_popup_${randomUUID()}`;
          const popup = this.#ensureEntry(
            entry.window,
            popupId,
            options.webPreferences,
          );
          popup.openerViewId = entry.viewId;
          popup.view.setVisible(false);
          void popupHandler({
            openerViewId: entry.viewId,
            viewId: popupId,
            url: normalizedUrl,
            background: disposition === "background-tab",
          }).catch((error) => {
            this.#destroy({ viewId: popupId }, "renderer-cleanup");
            this.#emit("embedded-browser-view-popup-failed", {
              viewId: entry.viewId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
          return popup.view.webContents;
        },
      };
    });
    view.webContents.on("before-input-event", (event, input) => {
      const command = browserCommandForInput(input, process.platform);
      if (!command || entry.sourceUri) return;
      event.preventDefault();
      entry.window.webContents.focus();
      this.#emit("embedded-browser-view-command", { viewId, command });
    });
    view.webContents.on("audio-state-changed", () => this.#emitState(entry));
    view.webContents.on("will-navigate", (event, url) => {
      if (entry.sourceUri && normalizeHttpUrl(url)) {
        event.preventDefault();
      }
    });
    installEmbeddedBrowserContextMenu({
      view,
      window,
      navigate: (url) => this.#startNavigation(entry, url),
      emitState: () => {
        this.#emitState(entry);
      },
    });
    attachEntryToWindow(entry, window);
    this.#entries.set(viewId, entry);
    view.webContents.on(
      "did-start-navigation",
      (_event, url, _isInPlace, isMainFrame) => {
        if (isMainFrame)
          this.#emit("embedded-browser-view-navigation-started", {
            viewId,
            url,
          });
      },
    );
    view.webContents.on("did-navigate", (_event, url) => {
      this.#clearPendingNavigation(entry, url);
      entry.loadProgress = Math.max(entry.loadProgress, 0.7);
      this.#emitState(entry);
      this.#emit("embedded-browser-view-navigation-committed", {
        viewId,
        url,
        title: view.webContents.getTitle(),
      });
    });
    view.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (!isMainFrame) return;
      this.#clearPendingNavigation(entry, url);
      this.#emitState(entry);
      this.#emit("embedded-browser-view-navigation-committed", {
        viewId,
        url,
        title: view.webContents.getTitle(),
      });
    });
    view.webContents.on("did-start-loading", () => {
      entry.loadProgress = 0.35;
      this.#emitState(entry);
    });
    view.webContents.on("did-stop-loading", () => {
      this.#clearPendingNavigation(entry, entry.view.webContents.getURL());
      entry.loadProgress = 1;
      this.#emitState(entry);
    });
    view.webContents.on("page-title-updated", () => {
      this.#emitState(entry);
      this.#emit("embedded-browser-view-title-updated", {
        viewId,
        url: view.webContents.getURL(),
        title: view.webContents.getTitle(),
      });
    });
    view.webContents.on("page-favicon-updated", (_event, favicons) => {
      entry.faviconUrl = Array.isArray(favicons)
        ? (favicons.find((item) => typeof item === "string" && item.trim()) ??
          null)
        : null;
      this.#emitState(entry);
    });
    view.webContents.on("found-in-page", (_event, result) => {
      const nextFind = readFindResult(result, entry.find.text);
      if (entry.findRequestId !== null && nextFind.requestId !== null) {
        if (nextFind.requestId !== entry.findRequestId) {
          return;
        }
      }
      entry.find = {
        text: nextFind.text,
        activeMatchOrdinal: nextFind.activeMatchOrdinal,
        matches: nextFind.matches,
        finalUpdate: nextFind.finalUpdate,
      };
      this.#emitState(entry);
    });
    view.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedUrl) => {
        if (!this.#isCurrentNavigationEvent(entry, validatedUrl)) {
          return;
        }
        this.#clearPendingNavigation(entry, validatedUrl);
        entry.loadProgress = 1;
        this.#emitLoadFailed(
          entry,
          errorCode,
          errorDescription,
          typeof validatedUrl === "string" ? validatedUrl : undefined,
        );
      },
    );
    return entry;
  }

  #createRendererNavigationListener(
    viewId: string,
  ): EmbeddedBrowserEntry["rendererNavigationListener"] {
    return (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) {
        this.#destroy({ viewId }, "renderer-navigation");
      }
    };
  }

  #installSessionHandlers(embeddedSession: ElectronSession): void {
    if (this.#sessionHandlersInstalled) {
      return;
    }
    this.#sessionHandlersInstalled = true;
    this.#requestPermissions.install(embeddedSession);
    const controller = {
      findEntryByWebContents: (webContents: ElectronWebContents) =>
        this.#findEntryByWebContents(webContents),
      onCompletedDownload: (downloadId: string, savePath: string) => {
        this.#downloadPaths.set(downloadId, savePath);
      },
      onDownload: this.#downloadObserver
        ? (
            ...args: Parameters<
              NonNullable<EmbeddedBrowserDownloadController["onDownload"]>
            >
          ) => this.#downloadObserver?.(...args)
        : undefined,
      resolveSavePath: (filename: string) => {
        if (this.#settings.ask_download_location) return null;
        const directory =
          this.#settings.download_directory || this.#downloadDirectory;
        mkdirSync(directory, { recursive: true });
        return path.join(directory, sanitizeDownloadFilename(filename));
      },
      resolveSaveDialogOptions: (filename: string) =>
        this.#settings.ask_download_location
          ? {
              defaultPath: path.join(
                this.#settings.download_directory || this.#downloadDirectory,
                sanitizeDownloadFilename(filename),
              ),
            }
          : null,
      canDownload: (viewId: string, url: string) =>
        this.#downloadPermission
          ? this.#downloadPermission(viewId, url)
          : this.#agentPermission?.(viewId, url, "download") !== false,
      deferPermissionRequest: this.#deferPermissions,
      onPendingPermission: (
        requestId: string,
        viewId: string,
        callback: (allowed: boolean) => void,
      ) => {
        this.#pendingPermissions.set(requestId, {
          viewId,
          callback,
        });
      },
    };
    this.#downloadHandling = installEmbeddedBrowserDownloadHandling(
      embeddedSession,
      controller,
      this.#emit,
    );
    installEmbeddedBrowserPermissionHandling(
      embeddedSession,
      controller,
      this.#emit,
    );
  }

  #findEntryByWebContents(webContents: ElectronWebContents) {
    for (const entry of this.#entries.values()) {
      if (entry.view.webContents === webContents) {
        return {
          viewId: entry.viewId,
          webContents: entry.view.webContents,
        };
      }
    }
    return null;
  }

  #startNavigation(
    entry: EmbeddedBrowserEntry,
    url: string,
    loadUrl = url,
  ): void {
    if (loadUrl === url) {
      entry.sourceUri = undefined;
    }
    entry.pendingUrl = url;
    entry.loadProgress = 0.1;
    const navigationToken = entry.navigationToken + 1;
    entry.navigationToken = navigationToken;

    let loadPromise: Promise<void>;
    try {
      loadPromise = entry.view.webContents.loadURL(loadUrl);
    } catch (error) {
      this.#clearPendingNavigation(entry);
      this.#emitLoadFailed(
        entry,
        null,
        error instanceof Error ? error.message : String(error),
        url,
      );
      return;
    }

    void loadPromise
      .then(() => {
        if (
          this.#entries.get(entry.viewId) !== entry ||
          entry.navigationToken !== navigationToken ||
          entry.pendingUrl !== url
        ) {
          return;
        }
        this.#clearPendingNavigation(entry);
        entry.loadProgress = 1;
        this.#emitState(entry);
      })
      .catch((error) => {
        if (
          this.#entries.get(entry.viewId) !== entry ||
          entry.navigationToken !== navigationToken ||
          entry.pendingUrl !== url
        ) {
          return;
        }
        this.#clearPendingNavigation(entry);
        entry.loadProgress = 1;
        this.#emitLoadFailed(
          entry,
          null,
          error instanceof Error ? error.message : String(error),
          url,
        );
      });
  }

  #clearPendingNavigation(entry: EmbeddedBrowserEntry, url?: unknown): void {
    if (!this.#isCurrentNavigationEvent(entry, url)) {
      return;
    }
    entry.pendingUrl = undefined;
  }

  #isCurrentNavigationEvent(
    entry: EmbeddedBrowserEntry,
    url?: unknown,
  ): boolean {
    return !(
      typeof url === "string" &&
      entry.pendingUrl &&
      url !== entry.pendingUrl
    );
  }

  #emitLoadFailed(
    entry: EmbeddedBrowserEntry,
    errorCode: number | null,
    errorDescription: string,
    url?: string,
  ): void {
    this.#emit("embedded-browser-view-load-failed", {
      ...readState(entry),
      ...(url ? { url } : {}),
      errorCode,
      errorDescription,
      failureCategory: classifyLoadFailure(errorCode, errorDescription),
    });
  }

  #emitState(entry: EmbeddedBrowserEntry): EmbeddedBrowserViewState {
    const state = readState(entry);
    this.#emit("embedded-browser-view-state", state);
    return state;
  }
}

function configureEmbeddedBrowserSession(): {
  embeddedSession: ElectronSession;
  userAgent: string;
} {
  const embeddedSession = session.fromPartition(EMBEDDED_BROWSER_PARTITION, {
    cache: true,
  });
  const userAgent = normalizeEmbeddedBrowserUserAgent(
    embeddedSession.getUserAgent(),
  );
  embeddedSession.setUserAgent(userAgent, EMBEDDED_BROWSER_ACCEPT_LANGUAGES);
  return { embeddedSession, userAgent };
}

function normalizeEmbeddedBrowserUserAgent(value: string): string {
  const normalized = value
    .replace(/\sElectron\/[^\s]+/gi, "")
    .replace(/\sLime\/[^\s]+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || value;
}
