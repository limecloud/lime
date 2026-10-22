import type {
  BrowserWindow,
  Rectangle,
  WebContentsView,
} from "./electronRuntime";
import type {
  EmbeddedBrowserEntry,
  EmbeddedBrowserFindState,
  EmbeddedBrowserViewState,
  EmbeddedBrowserLoadFailureCategory,
} from "./embeddedBrowserHost";
type HostArgs = Record<string, unknown> | null | undefined;

export function readState(
  entry: EmbeddedBrowserEntry,
): EmbeddedBrowserViewState {
  const webContents = entry.view.webContents;
  return {
    viewId: entry.viewId,
    url: entry.pendingUrl || entry.sourceUri || webContents.getURL(),
    title: webContents.getTitle(),
    faviconUrl: entry.faviconUrl,
    canGoBack: webContents.navigationHistory.canGoBack(),
    canGoForward: webContents.navigationHistory.canGoForward(),
    isLoading: webContents.isLoading() || Boolean(entry.pendingUrl),
    loadProgress: normalizeLoadProgress(entry),
    zoomFactor: normalizeZoomFactor(webContents.getZoomFactor()),
    find: entry.find,
    audioMuted:
      typeof webContents.isAudioMuted === "function" &&
      webContents.isAudioMuted(),
    audible:
      typeof webContents.isCurrentlyAudible === "function" &&
      webContents.isCurrentlyAudible(),
    device: entry.device,
  };
}

export function createEmptyFindState(): EmbeddedBrowserFindState {
  return {
    text: "",
    activeMatchOrdinal: 0,
    matches: 0,
    finalUpdate: true,
  };
}

export function readFindResult(
  value: unknown,
  fallbackText: string,
): EmbeddedBrowserFindState & { requestId: number | null } {
  const record = readRecord(value);
  return {
    text: fallbackText,
    requestId: readInteger(record?.requestId),
    activeMatchOrdinal: Math.max(
      0,
      readInteger(record?.activeMatchOrdinal) ?? 0,
    ),
    matches: Math.max(0, readInteger(record?.matches) ?? 0),
    finalUpdate:
      typeof record?.finalUpdate === "boolean" ? record.finalUpdate : false,
  };
}

export function normalizeLoadProgress(entry: EmbeddedBrowserEntry): number {
  const loading =
    entry.view.webContents.isLoading() || Boolean(entry.pendingUrl);
  if (!loading) {
    return 1;
  }
  return clampNumber(entry.loadProgress, 0.05, 0.95);
}

export function normalizeZoomFactor(value: number): number {
  return Math.round(clampNumber(value, 0.5, 3) * 100) / 100;
}

export function readViewId(args?: HostArgs): string {
  const value = readString(args, "viewId");
  if (!value) {
    throw new Error("embedded browser viewId 不能为空。");
  }
  return value;
}

export function readUrl(args?: HostArgs): string {
  const value = readOptionalUrl(args);
  if (!value) {
    throw new Error("embedded browser url 不能为空。");
  }
  return value;
}

export function readOptionalUrl(args?: HostArgs): string | null {
  const value = readString(args, "url");
  if (!value) {
    return null;
  }
  const normalized = normalizeHttpUrl(value);
  if (!normalized) {
    throw new Error("内嵌浏览器只支持 http/https 地址。");
  }
  return normalized;
}

export function readBounds(args?: HostArgs): Rectangle {
  const bounds = readOptionalBounds(args);
  if (!bounds) {
    throw new Error("embedded browser bounds 不能为空。");
  }
  return bounds;
}

export function readOptionalBounds(args?: HostArgs): Rectangle | null {
  const source = readRecord(args)?.bounds;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }
  const record = source as Record<string, unknown>;
  const x = readInteger(record.x);
  const y = readInteger(record.y);
  const width = readInteger(record.width);
  const height = readInteger(record.height);
  if (x === null || y === null || width === null || height === null) {
    throw new Error("embedded browser bounds 必须包含整数 x/y/width/height。");
  }
  return {
    x: Math.max(0, x),
    y: Math.max(0, y),
    width: Math.max(0, width),
    height: Math.max(0, height),
  };
}

export function applyBounds(
  view: WebContentsView,
  bounds: Rectangle,
  visible: boolean,
): void {
  view.setBounds(bounds);
  view.setVisible(visible && bounds.width > 0 && bounds.height > 0);
}

export function attachEntryToWindow(
  entry: EmbeddedBrowserEntry,
  window: BrowserWindow,
): void {
  window.on("closed", entry.closeListener);
  window.webContents.on(
    "did-start-navigation",
    entry.rendererNavigationListener,
  );
  entry.view.webContents.on("destroyed", entry.webContentsDestroyedListener);
  entry.view.webContents.on(
    "render-process-gone",
    entry.webContentsGoneListener,
  );
  window.contentView.addChildView(entry.view);
}

export function detachEntryFromWindow(entry: EmbeddedBrowserEntry): void {
  try {
    if (!entry.window.isDestroyed()) {
      entry.window.off("closed", entry.closeListener);
      entry.window.webContents.off(
        "did-start-navigation",
        entry.rendererNavigationListener,
      );
      entry.window.contentView.removeChildView(entry.view);
    }
    entry.view.webContents.off("destroyed", entry.webContentsDestroyedListener);
    entry.view.webContents.off(
      "render-process-gone",
      entry.webContentsGoneListener,
    );
  } catch (error) {
    ignoreElectronDestroyedObject(error);
  }
}

export function closeEntryView(entry: EmbeddedBrowserEntry): void {
  try {
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.webContents.close();
    }
  } catch (error) {
    ignoreElectronDestroyedObject(error);
  }
}

export function ignoreElectronDestroyedObject(error: unknown): void {
  if (
    error instanceof Error &&
    /Object has been destroyed/i.test(error.message)
  ) {
    return;
  }
  throw error;
}

export function readOptionalBoolean(
  args: HostArgs,
  key: string,
): boolean | null {
  const value = readRecord(args)?.[key];
  return typeof value === "boolean" ? value : null;
}

export function readString(args: HostArgs, key: string): string | null {
  const value = readRecord(args)?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function readRecord(args: unknown): Record<string, unknown> | null {
  return args && typeof args === "object" && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : null;
}

export function readInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : null;
}

export function readNumber(args: HostArgs, key: string): number | null {
  const value = readRecord(args)?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readZoomFactor(args: HostArgs): number {
  const value = readNumber(args, "zoomFactor");
  if (value === null) {
    throw new Error("embedded browser zoomFactor 必须是有效数字。");
  }
  return normalizeZoomFactor(value);
}

export function readStopFindAction(
  args: HostArgs,
): "clearSelection" | "keepSelection" | "activateSelection" {
  const value = readString(args, "action");
  if (
    value === "clearSelection" ||
    value === "keepSelection" ||
    value === "activateSelection"
  ) {
    return value;
  }
  return "clearSelection";
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function sanitizeDownloadFilename(value: string): string {
  const normalized = Array.from(value.trim(), (character) => character.charCodeAt(0) < 32 ? "_" : character)
    .join("")
    .replace(/[\\/<>:"|?*]/g, "_")
    .replace(/[. ]+$/g, "");
  if (!normalized || normalized === "." || normalized === "..")
    return "download";
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(normalized)
    ? `_${normalized}`
    : normalized;
}

export function classifyLoadFailure(
  errorCode: number | null,
  errorDescription: string,
): EmbeddedBrowserLoadFailureCategory {
  const description = errorDescription.toUpperCase();
  if (errorCode === -3 || description.includes("ABORTED")) {
    return "aborted";
  }
  if (
    errorCode === -105 ||
    errorCode === -137 ||
    description.includes("NAME_NOT_RESOLVED") ||
    description.includes("DNS") ||
    description.includes("HOST_RESOLVER")
  ) {
    return "dns";
  }
  if (
    (typeof errorCode === "number" && errorCode <= -200 && errorCode >= -299) ||
    description.includes("CERT") ||
    description.includes("SSL") ||
    description.includes("TLS")
  ) {
    return "tls";
  }
  if (
    errorCode === -20 ||
    errorCode === -27 ||
    errorCode === -30 ||
    description.includes("BLOCKED") ||
    description.includes("CSP") ||
    description.includes("POLICY")
  ) {
    return "blocked";
  }
  return "load_failed";
}
