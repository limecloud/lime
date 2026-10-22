import type { WebContents } from "electron";
import type { BrowserWindow, Rectangle } from "./electronRuntime";
import type {
  BrowserRoute,
  BrowserTabState,
  BrowserToolCall,
} from "./browserTabHost";
import type { EmbeddedBrowserViewState } from "./embeddedBrowserHost";
type HostArgs = Record<string, unknown> | null | undefined;
const NAVIGATION_TIMEOUT_MS = 30_000;

export function browserToolCallKey(call: BrowserToolCall): string {
  return [call.threadId, call.turnId, call.callId].join("\u0000");
}

export const BROWSER_EMBEDDED_EVENT_MAP: Record<string, string> = {
  "embedded-browser-view-command": "browser-tab-command",
  "embedded-browser-view-download": "browser-tab-download",
  "embedded-browser-view-load-failed": "browser-tab-load-failed",
  "embedded-browser-view-permission-request": "browser-tab-permission-request",
};

export function readMountIdentity(
  args: HostArgs,
  window: BrowserWindow,
  viewId: string,
): BrowserRoute {
  const requestedOrigin = readString(args, "origin");
  if (requestedOrigin && requestedOrigin !== "user") {
    throw new Error("Renderer may only mount user Browser tabs");
  }
  const origin = "user";
  return {
    activeTurnId: null,
    browserSessionId: readRequiredString(args, "browserSessionId"),
    controlOwner: origin === "user" ? "user" : "released",
    humanReason: null,
    mark: null,
    origin,
    ownerWebContentsId: window.webContents.id,
    pageRevision: 0,
    latestSnapshotId: null,
    latestSnapshotNodeIds: new Set(),
    lastPageStateKey: null,
    selected: readOptionalBoolean(args, "selected") ?? true,
    tabId: readRequiredString(args, "tabId"),
    threadId: readRequiredString(args, "threadId"),
    viewId,
    windowId: window.id,
  };
}

export function assertSameRoute(route: BrowserRoute, next: BrowserRoute): void {
  for (const key of [
    "browserSessionId",
    "ownerWebContentsId",
    "tabId",
    "threadId",
    "viewId",
    "windowId",
  ] as const) {
    if (route[key] !== next[key]) {
      throw new Error(`Browser route identity mismatch: ${key}`);
    }
  }
}

export function enrichState(
  route: BrowserRoute,
  state: EmbeddedBrowserViewState,
  webContentsId: number,
): BrowserTabState {
  return {
    ...state,
    activeTurnId: route.activeTurnId,
    browserSessionId: route.browserSessionId,
    controlOwner: route.controlOwner,
    humanReason: route.humanReason,
    mark: route.mark,
    origin: route.origin,
    ownerWebContentsId: route.ownerWebContentsId,
    pageRevision: route.pageRevision,
    selected: route.selected,
    tabId: route.tabId,
    threadId: route.threadId,
    webContentsId,
    windowId: route.windowId,
  };
}

export function browserPageStateKey(value: unknown): string {
  const record = asRecord(value);
  return JSON.stringify([
    record?.url ?? "",
    record?.title ?? "",
    record?.isLoading === true,
  ]);
}

export function waitForNavigation(webContents: WebContents): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timeout);
      webContents.off("did-stop-loading", finish);
      webContents.off("did-fail-load", fail);
      resolve();
    };
    const fail = (
      _event: unknown,
      errorCode: number,
      errorDescription: string,
    ) => {
      clearTimeout(timeout);
      webContents.off("did-stop-loading", finish);
      webContents.off("did-fail-load", fail);
      reject(
        new Error(
          `Browser navigation failed (${errorCode}): ${errorDescription}`,
        ),
      );
    };
    const timeout = setTimeout(() => {
      webContents.off("did-stop-loading", finish);
      webContents.off("did-fail-load", fail);
      reject(new Error("Browser navigation timed out"));
    }, NAVIGATION_TIMEOUT_MS);
    webContents.once("did-stop-loading", finish);
    webContents.once("did-fail-load", fail);
  });
}

export function assertEmbeddedState(
  value: unknown,
): asserts value is EmbeddedBrowserViewState {
  const record = asRecord(value);
  if (
    !record ||
    typeof record.viewId !== "string" ||
    typeof record.url !== "string" ||
    typeof record.title !== "string"
  ) {
    throw new Error("Browser native host returned invalid state");
  }
}

export function readRequiredString(value: unknown, key: string): string {
  const result = readString(value, key);
  if (!result) {
    throw new Error(`Browser ${key} must be a non-empty string`);
  }
  return result;
}

export function readString(value: unknown, key: string): string | null {
  return readStringValue(asRecord(value)?.[key]);
}

export function readOptionalString(value: unknown, key: string): string | null {
  const candidate = asRecord(value)?.[key];
  return typeof candidate === "string" ? candidate.trim() : null;
}

export function readStringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function readPositiveInteger(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error("Browser backendNodeId must be a positive integer");
  }
  return Number(value);
}

export function readNonNegativeInteger(value: unknown, key: string): number {
  const candidate = asRecord(value)?.[key];
  if (!Number.isInteger(candidate) || Number(candidate) < 0) {
    throw new Error(`Browser ${key} must be a non-negative integer`);
  }
  return Number(candidate);
}

export function readOptionalBoolean(
  value: unknown,
  key: string,
): boolean | null {
  const candidate = asRecord(value)?.[key];
  return typeof candidate === "boolean" ? candidate : null;
}

interface ArtifactWriteReceipt {
  persistedAt: string;
  relativePath: string;
  bytes: number;
  sha256: string;
  contentStatus: string;
}

export function readArtifactWriteResponse(
  value: unknown,
  expectedArtifactRef: string,
): ArtifactWriteReceipt {
  const record = asRecord(value);
  const sidecar = asRecord(record?.sidecar);
  const artifactRef = readStringValue(record?.artifactRef);
  const persistedAt = readStringValue(record?.persistedAt);
  const relativePath = readStringValue(sidecar?.relativePath);
  const sha256 = readStringValue(sidecar?.sha256);
  const contentStatus = readStringValue(sidecar?.contentStatus);
  const bytes = sidecar?.bytes;
  if (
    artifactRef !== expectedArtifactRef ||
    !persistedAt ||
    !relativePath ||
    relativePath.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(relativePath) ||
    relativePath.split(/[\\/]+/).includes("..") ||
    !Number.isInteger(bytes) ||
    Number(bytes) < 0 ||
    !sha256 ||
    !contentStatus
  ) {
    throw new Error("Browser artifact persistence receipt is invalid");
  }
  return {
    persistedAt,
    relativePath,
    bytes: Number(bytes),
    sha256,
    contentStatus,
  };
}

export function readBounds(value: unknown): Rectangle | null {
  const record = asRecord(asRecord(value)?.bounds);
  const x = record?.x;
  const y = record?.y;
  const width = record?.width;
  const height = record?.height;
  if ([x, y, width, height].every(Number.isFinite)) {
    return {
      x: Math.max(0, Math.round(Number(x))),
      y: Math.max(0, Math.round(Number(y))),
      width: Math.max(0, Math.round(Number(width))),
      height: Math.max(0, Math.round(Number(height))),
    };
  }
  return null;
}

export function readHttpUrl(value: unknown): string {
  const url = readOptionalHttpUrl(value);
  if (!url) {
    throw new Error("Browser url must use http or https");
  }
  return url;
}

export function readOptionalHttpUrl(value: unknown): string | null {
  const raw = readStringValue(value);
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
