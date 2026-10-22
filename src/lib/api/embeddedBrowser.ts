import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import {
  getElectronHostBridge,
  isElectronDevBridgeFallbackAvailable,
  isElectronHostCommandAvailable,
} from "@/lib/electron-host";

export interface EmbeddedBrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EmbeddedBrowserViewState {
  viewId: string;
  url: string;
  title: string;
  faviconUrl?: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  loadProgress?: number;
  zoomFactor?: number;
  find?: EmbeddedBrowserFindState;
  audioMuted?: boolean;
  audible?: boolean;
  device?: EmbeddedBrowserDeviceState | null;
}

export interface EmbeddedBrowserDeviceState {
  width: number;
  height: number;
  deviceScaleFactor: number;
  scale: number;
  mobile: boolean;
}

export interface BrowserScreenshot {
  dataUrl: string;
  width: number;
  height: number;
  copiedToClipboard: boolean;
}

export interface BrowserPrintResult {
  printed: boolean;
  failureReason: string | null;
}

export interface EmbeddedBrowserFindState {
  text: string;
  activeMatchOrdinal: number;
  matches: number;
  finalUpdate: boolean;
}

export type EmbeddedBrowserLoadFailureCategory =
  | "dns"
  | "tls"
  | "blocked"
  | "aborted"
  | "load_failed";

export interface EmbeddedBrowserViewLoadFailedEvent extends EmbeddedBrowserViewState {
  errorCode: number | null;
  errorDescription: string;
  failureCategory: EmbeddedBrowserLoadFailureCategory;
}

export type EmbeddedBrowserDownloadState =
  | "started"
  | "progressing"
  | "completed"
  | "cancelled"
  | "interrupted";

export interface EmbeddedBrowserDownloadEvent {
  viewId: string;
  downloadId: string;
  url: string;
  filename: string;
  mimeType: string | null;
  state: EmbeddedBrowserDownloadState;
  receivedBytes: number;
  totalBytes: number | null;
  canResume: boolean;
}

export type EmbeddedBrowserPermissionDecision = "blocked" | "pending";

export interface EmbeddedBrowserPermissionRequestEvent {
  viewId: string;
  requestId: string;
  permission: string;
  url: string;
  requestingUrl: string | null;
  embeddingOrigin: string | null;
  decision: EmbeddedBrowserPermissionDecision;
}

interface EmbeddedBrowserCommandParams extends Record<string, unknown> {
  viewId: string;
  leaseId?: string;
  url?: string;
  bounds?: EmbeddedBrowserBounds;
  visible?: boolean;
}

export interface EmbeddedBrowserHtmlParams
  extends
    Record<string, unknown>,
    Pick<EmbeddedBrowserCommandParams, "viewId"> {
  html: string;
  csp?: {
    baseUriDomains?: string[];
    connectDomains?: string[];
    frameDomains?: string[];
    resourceDomains?: string[];
  };
  source: "mcpApp";
  sourceUri: string;
}

const EMBEDDED_BROWSER_REQUIRED_COMMANDS = [
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

export function isEmbeddedBrowserHostAvailable(): boolean {
  return (
    Boolean(getElectronHostBridge()) &&
    !isElectronDevBridgeFallbackAvailable() &&
    EMBEDDED_BROWSER_REQUIRED_COMMANDS.every((command) =>
      isElectronHostCommandAvailable(command),
    )
  );
}

function assertEmbeddedBrowserViewState(
  value: unknown,
): asserts value is EmbeddedBrowserViewState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("embedded browser 未返回有效状态。");
  }
  const record = value as Partial<EmbeddedBrowserViewState>;
  if (
    typeof record.viewId !== "string" ||
    typeof record.url !== "string" ||
    typeof record.title !== "string" ||
    typeof record.canGoBack !== "boolean" ||
    typeof record.canGoForward !== "boolean" ||
    typeof record.isLoading !== "boolean"
  ) {
    throw new Error("embedded browser 状态字段不完整。");
  }
}

async function invokeEmbeddedBrowser(
  command: string,
  params: EmbeddedBrowserCommandParams,
): Promise<EmbeddedBrowserViewState> {
  const result = await safeInvoke<unknown>(command, params);
  assertEmbeddedBrowserViewState(result);
  return result;
}

export async function mountEmbeddedBrowserView(
  params: EmbeddedBrowserCommandParams,
): Promise<EmbeddedBrowserViewState> {
  return invokeEmbeddedBrowser("embedded_browser_view_mount", params);
}

export async function setEmbeddedBrowserViewBounds(
  params: EmbeddedBrowserCommandParams,
): Promise<EmbeddedBrowserViewState> {
  return invokeEmbeddedBrowser("embedded_browser_view_set_bounds", params);
}

export async function navigateEmbeddedBrowserView(
  params: Required<Pick<EmbeddedBrowserCommandParams, "viewId" | "url">>,
): Promise<EmbeddedBrowserViewState> {
  return invokeEmbeddedBrowser("embedded_browser_view_navigate", params);
}

export async function loadEmbeddedBrowserViewHtml(
  params: EmbeddedBrowserHtmlParams,
): Promise<EmbeddedBrowserViewState> {
  return invokeEmbeddedBrowser("embedded_browser_view_load_html", params);
}

export async function reloadEmbeddedBrowserView(
  viewId: string,
): Promise<EmbeddedBrowserViewState> {
  return invokeEmbeddedBrowser("embedded_browser_view_reload", { viewId });
}

export async function stopLoadingEmbeddedBrowserView(
  viewId: string,
): Promise<EmbeddedBrowserViewState> {
  return invokeEmbeddedBrowser("embedded_browser_view_stop", { viewId });
}

export async function findInEmbeddedBrowserView(params: {
  viewId: string;
  text: string;
  forward?: boolean;
  findNext?: boolean;
}): Promise<EmbeddedBrowserViewState> {
  return invokeEmbeddedBrowser("embedded_browser_view_find_in_page", params);
}

export async function stopFindInEmbeddedBrowserView(
  viewId: string,
): Promise<EmbeddedBrowserViewState> {
  return invokeEmbeddedBrowser("embedded_browser_view_stop_find_in_page", {
    viewId,
  });
}

export async function setEmbeddedBrowserViewZoom(
  viewId: string,
  zoomFactor: number,
): Promise<EmbeddedBrowserViewState> {
  return invokeEmbeddedBrowser("embedded_browser_view_set_zoom", {
    viewId,
    zoomFactor,
  });
}

export async function goBackEmbeddedBrowserView(
  viewId: string,
): Promise<EmbeddedBrowserViewState> {
  return invokeEmbeddedBrowser("embedded_browser_view_go_back", { viewId });
}

export async function printEmbeddedBrowserView(
  viewId: string,
): Promise<BrowserPrintResult> {
  const result = await safeInvoke<unknown>("embedded_browser_view_print", {
    viewId,
  });
  assertBrowserPrintResult(result);
  return result;
}

export async function captureEmbeddedBrowserView(
  viewId: string,
  copyToClipboard = false,
): Promise<BrowserScreenshot> {
  const result = await safeInvoke<unknown>(
    "embedded_browser_view_capture_screenshot",
    { viewId, copyToClipboard },
  );
  assertBrowserScreenshot(result);
  return result;
}

export async function setEmbeddedBrowserViewAudioMuted(
  viewId: string,
  muted: boolean,
): Promise<EmbeddedBrowserViewState> {
  return invokeEmbeddedBrowser("embedded_browser_view_set_audio_muted", {
    viewId,
    muted,
  });
}

export async function setEmbeddedBrowserViewDevice(
  viewId: string,
  device: EmbeddedBrowserDeviceState | null,
): Promise<EmbeddedBrowserViewState> {
  return invokeEmbeddedBrowser("embedded_browser_view_set_device", {
    viewId,
    device,
  });
}

export function assertBrowserPrintResult(
  value: unknown,
): asserts value is BrowserPrintResult {
  const result = value as Partial<BrowserPrintResult> | null;
  if (
    !result ||
    typeof result.printed !== "boolean" ||
    (result.failureReason !== null && typeof result.failureReason !== "string")
  ) {
    throw new Error("Browser print returned an invalid result");
  }
}

export function assertBrowserScreenshot(
  value: unknown,
): asserts value is BrowserScreenshot {
  const result = value as Partial<BrowserScreenshot> | null;
  if (
    !result ||
    typeof result.dataUrl !== "string" ||
    !result.dataUrl.startsWith("data:image/png;base64,") ||
    !Number.isInteger(result.width) ||
    Number(result.width) <= 0 ||
    !Number.isInteger(result.height) ||
    Number(result.height) <= 0 ||
    typeof result.copiedToClipboard !== "boolean"
  ) {
    throw new Error("Browser capture returned an invalid PNG screenshot");
  }
}

export async function goForwardEmbeddedBrowserView(
  viewId: string,
): Promise<EmbeddedBrowserViewState> {
  return invokeEmbeddedBrowser("embedded_browser_view_go_forward", { viewId });
}

export async function destroyEmbeddedBrowserView(
  viewId: string,
  leaseId?: string,
): Promise<void> {
  await safeInvoke("embedded_browser_view_destroy", {
    viewId,
    ...(leaseId ? { leaseId } : {}),
  });
}

export function listenEmbeddedBrowserViewState(
  handler: (state: EmbeddedBrowserViewState) => void,
): Promise<() => void> {
  return safeListen<EmbeddedBrowserViewState>(
    "embedded-browser-view-state",
    (event) => {
      if (event.payload && typeof event.payload === "object") {
        const payload = event.payload;
        assertEmbeddedBrowserViewState(payload);
        handler(payload);
      }
    },
  );
}

function assertEmbeddedBrowserViewLoadFailedEvent(
  value: unknown,
): asserts value is EmbeddedBrowserViewLoadFailedEvent {
  assertEmbeddedBrowserViewState(value);
  const record = value as Partial<EmbeddedBrowserViewLoadFailedEvent>;
  if (
    !(typeof record.errorCode === "number" || record.errorCode === null) ||
    typeof record.errorDescription !== "string"
  ) {
    throw new Error("embedded browser 加载失败事件字段不完整。");
  }
  if (!isEmbeddedBrowserLoadFailureCategory(record.failureCategory)) {
    throw new Error("embedded browser 加载失败分类字段不完整。");
  }
}

function isEmbeddedBrowserLoadFailureCategory(
  value: unknown,
): value is EmbeddedBrowserLoadFailureCategory {
  return (
    value === "dns" ||
    value === "tls" ||
    value === "blocked" ||
    value === "aborted" ||
    value === "load_failed"
  );
}

export function listenEmbeddedBrowserViewLoadFailed(
  handler: (event: EmbeddedBrowserViewLoadFailedEvent) => void,
): Promise<() => void> {
  return safeListen<EmbeddedBrowserViewLoadFailedEvent>(
    "embedded-browser-view-load-failed",
    (event) => {
      if (event.payload && typeof event.payload === "object") {
        const payload = event.payload;
        assertEmbeddedBrowserViewLoadFailedEvent(payload);
        handler(payload);
      }
    },
  );
}

function assertEmbeddedBrowserDownloadEvent(
  value: unknown,
): asserts value is EmbeddedBrowserDownloadEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("embedded browser 下载事件字段不完整。");
  }
  const record = value as Partial<EmbeddedBrowserDownloadEvent>;
  if (
    typeof record.viewId !== "string" ||
    typeof record.downloadId !== "string" ||
    typeof record.url !== "string" ||
    typeof record.filename !== "string" ||
    typeof record.receivedBytes !== "number" ||
    !(typeof record.totalBytes === "number" || record.totalBytes === null) ||
    typeof record.canResume !== "boolean" ||
    !isEmbeddedBrowserDownloadState(record.state)
  ) {
    throw new Error("embedded browser 下载事件字段不完整。");
  }
  if (!(typeof record.mimeType === "string" || record.mimeType === null)) {
    throw new Error("embedded browser 下载事件字段不完整。");
  }
}

function isEmbeddedBrowserDownloadState(
  value: unknown,
): value is EmbeddedBrowserDownloadState {
  return (
    value === "started" ||
    value === "progressing" ||
    value === "completed" ||
    value === "cancelled" ||
    value === "interrupted"
  );
}

export function listenEmbeddedBrowserDownload(
  handler: (event: EmbeddedBrowserDownloadEvent) => void,
): Promise<() => void> {
  return safeListen<EmbeddedBrowserDownloadEvent>(
    "embedded-browser-view-download",
    (event) => {
      if (event.payload && typeof event.payload === "object") {
        const payload = event.payload;
        assertEmbeddedBrowserDownloadEvent(payload);
        handler(payload);
      }
    },
  );
}

function assertEmbeddedBrowserPermissionRequestEvent(
  value: unknown,
): asserts value is EmbeddedBrowserPermissionRequestEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("embedded browser 权限事件字段不完整。");
  }
  const record = value as Partial<EmbeddedBrowserPermissionRequestEvent>;
  if (
    typeof record.viewId !== "string" ||
    typeof record.requestId !== "string" ||
    typeof record.permission !== "string" ||
    typeof record.url !== "string" ||
    !(
      typeof record.requestingUrl === "string" || record.requestingUrl === null
    ) ||
    !(
      typeof record.embeddingOrigin === "string" ||
      record.embeddingOrigin === null
    ) ||
    !(record.decision === "blocked" || record.decision === "pending")
  ) {
    throw new Error("embedded browser 权限事件字段不完整。");
  }
}

export function listenEmbeddedBrowserPermissionRequest(
  handler: (event: EmbeddedBrowserPermissionRequestEvent) => void,
): Promise<() => void> {
  return safeListen<EmbeddedBrowserPermissionRequestEvent>(
    "embedded-browser-view-permission-request",
    (event) => {
      if (event.payload && typeof event.payload === "object") {
        const payload = event.payload;
        assertEmbeddedBrowserPermissionRequestEvent(payload);
        handler(payload);
      }
    },
  );
}
