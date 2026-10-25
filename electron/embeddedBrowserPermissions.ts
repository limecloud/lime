import type { Session, WebContents } from "electron";
import {
  EmbeddedBrowserPermissionGrants,
  permissionSource,
} from "./embeddedBrowserPermissionGrants";
import type {
  BrowserSitePermission,
  BrowserSitePermissionSetting,
} from "../src/lib/api/browserSiteSettingsTypes";
import { BROWSER_SITE_PERMISSIONS } from "../src/lib/api/browserSiteSettingsTypes";
import { createAutomaticDownloadRequest } from "./embeddedBrowserAutomaticDownloads";

type HostEventEmitter = (event: string, payload?: unknown) => void;
type PermissionRequestDetails = Parameters<
  NonNullable<Parameters<Session["setPermissionRequestHandler"]>[0]>
>[3];

export type EmbeddedBrowserPermissionDecision = "blocked" | "pending";

export interface EmbeddedBrowserPermissionRequestEvent {
  viewId: string;
  requestId: string;
  permission: string;
  url: string;
  requestingUrl: string | null;
  embeddingOrigin: string | null;
  decision: EmbeddedBrowserPermissionDecision;
  isMainFrame: boolean;
  mediaTypes?: string[];
}

export interface EmbeddedBrowserPermissionEntry {
  viewId: string;
  webContents: WebContents;
}

interface EmbeddedBrowserPermissionController {
  findEntryByWebContents(
    webContents: WebContents,
  ): EmbeddedBrowserPermissionEntry | null;
  deferPermissionRequest?: boolean;
  canUseSavedPermissions?: (viewId: string) => boolean;
  sitePermissionDecision?: (
    origin: string,
    permission: BrowserSitePermission,
  ) => BrowserSitePermissionSetting;
  resolveSitePermissionDecision?: (
    origin: string,
    permission: BrowserSitePermission,
  ) => Promise<BrowserSitePermissionSetting>;
  onPendingPermission?: (
    requestId: string,
    viewId: string,
    callback: (allowed: boolean) => boolean,
  ) => void;
  onPermissionCancelled?: (requestId: string, viewId: string) => void;
}

export function installEmbeddedBrowserPermissionHandling(
  browserSession: Session,
  controller: EmbeddedBrowserPermissionController,
  emit: HostEventEmitter,
) {
  const grants = new EmbeddedBrowserPermissionGrants();
  browserSession.setPermissionCheckHandler(
    (webContents, permission, origin, details) => {
      const entry =
        webContents && controller.findEntryByWebContents(webContents);
      const source =
        entry && permissionSource(entry.webContents, details, origin);
      const sitePermission = source
        ? sitePermissionForCheck(permission, details.mediaType)
        : null;
      const savedDecision =
        source && sitePermission
          ? controller.sitePermissionDecision?.(source.origin, sitePermission)
          : undefined;
      const siteDecision =
        savedDecision === "allow" &&
        entry &&
        controller.canUseSavedPermissions?.(entry.viewId) === false
          ? "ask"
          : savedDecision;
      return (
        !!entry &&
        !!source &&
        siteDecision !== "block" &&
        (siteDecision === "allow" ||
          grants.allows(entry.viewId, source, permission, details.mediaType))
      );
    },
  );
  const requestPermission = (
    webContents: WebContents,
    permission: string,
    respond: (allowed: boolean) => void,
    details: PermissionRequestDetails,
    signal?: AbortSignal,
  ) => {
    const entry = controller.findEntryByWebContents(webContents);
    if (!entry) {
      respond(false);
      return;
    }
    const requestId = createPermissionRequestId();
    let settled = false;
    const callback = (allowed: boolean) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      respond(allowed && !signal?.aborted);
    };
    const abort = () => {
      controller.onPermissionCancelled?.(requestId, entry.viewId);
      callback(false);
      emitPermissionEvent(
        emit,
        webContents,
        details,
        entry.viewId,
        requestId,
        permission,
        undefined,
        "blocked",
      );
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    const source = permissionSource(webContents, details);
    const mediaTypes = "mediaTypes" in details ? details.mediaTypes : undefined;
    const deferred =
      controller.deferPermissionRequest === true &&
      !!controller.onPendingPermission &&
      !!source;
    const requestedSitePermissions =
      source && controller.resolveSitePermissionDecision
        ? sitePermissionsForRequest(permission, mediaTypes)
        : null;
    // Capture the original document revision before any asynchronous rule read.
    const captured = source
      ? grants.capture(entry.viewId, source, permission, mediaTypes)
      : null;
    const grant = captured
      ? Object.assign(
          (allowed: boolean) => captured(allowed && !signal?.aborted),
          { isCurrent: () => !signal?.aborted && captured.isCurrent() },
        )
      : null;
    if (requestedSitePermissions?.length) {
      void Promise.all(
        requestedSitePermissions.map((key) =>
          controller.resolveSitePermissionDecision!(source!.origin, key),
        ),
      )
        .then((decisions) => {
          if (!grant?.isCurrent()) {
            callback(false);
            return;
          }
          if (controller.canUseSavedPermissions?.(entry.viewId) === false)
            decisions = decisions.map((decision) =>
              decision === "allow" ? "ask" : decision,
            );
          if (decisions.includes("block")) {
            callback(false);
            emitPermissionEvent(
              emit,
              webContents,
              details,
              entry.viewId,
              requestId,
              permission,
              mediaTypes,
              "blocked",
            );
            return;
          }
          if (
            !decisions.includes("ask") ||
            (permission === "automatic-downloads" &&
              grants.allows(entry.viewId, source!, permission))
          ) {
            callback(grant(true));
            return;
          }
          if (!deferred) {
            callback(false);
            emitPermissionEvent(
              emit,
              webContents,
              details,
              entry.viewId,
              requestId,
              permission,
              mediaTypes,
              "blocked",
            );
            return;
          }
          capturePendingPermission(
            grant,
            controller,
            entry.viewId,
            requestId,
            callback,
          );
          emitPermissionEvent(
            emit,
            webContents,
            details,
            entry.viewId,
            requestId,
            permission,
            mediaTypes,
            "pending",
          );
        })
        .catch(() => callback(false));
      return;
    }
    if (deferred && grant) {
      capturePendingPermission(
        grant,
        controller,
        entry.viewId,
        requestId,
        callback,
      );
    } else {
      callback(false);
    }
    emitPermissionEvent(
      emit,
      webContents,
      details,
      entry.viewId,
      requestId,
      permission,
      mediaTypes,
      deferred ? "pending" : "blocked",
    );
  };
  browserSession.setPermissionRequestHandler(requestPermission);
  const automaticDownload = createAutomaticDownloadRequest(
    grants,
    (contents, callback, signal) =>
      requestPermission(
        contents,
        "automatic-downloads",
        callback,
        { isMainFrame: true, requestingUrl: contents.getURL() },
        signal,
      ),
  );
  return Object.assign(grants, {
    requestAutomaticDownload: (
      webContents: WebContents,
      signal?: AbortSignal,
    ): Promise<boolean> => {
      const entry = controller.findEntryByWebContents(webContents);
      return entry
        ? automaticDownload(entry.viewId, webContents, signal)
        : Promise.resolve(false);
    },
  });
}

function capturePendingPermission(
  grant: ReturnType<EmbeddedBrowserPermissionGrants["capture"]>,
  controller: EmbeddedBrowserPermissionController,
  viewId: string,
  requestId: string,
  callback: (allowed: boolean) => void,
): void {
  let settled = false;
  controller.onPendingPermission!(requestId, viewId, (allowed) => {
    if (settled) return false;
    settled = true;
    const granted = grant(allowed);
    callback(granted);
    return granted;
  });
}

function emitPermissionEvent(
  emit: HostEventEmitter,
  webContents: WebContents,
  details: PermissionRequestDetails,
  viewId: string,
  requestId: string,
  permission: string,
  mediaTypes: string[] | undefined,
  decision: EmbeddedBrowserPermissionDecision,
): void {
  emit("embedded-browser-view-permission-request", {
    viewId,
    requestId,
    permission: normalizePermission(permission),
    url: normalizeUrl(webContents.getURL()) ?? "",
    requestingUrl: normalizeUrl(details.requestingUrl),
    embeddingOrigin: normalizeUrl(readEmbeddingOrigin(details)),
    isMainFrame: details.isMainFrame === true,
    ...(mediaTypes ? { mediaTypes } : {}),
    decision,
  } satisfies EmbeddedBrowserPermissionRequestEvent);
}

function sitePermissionsForRequest(
  permission: string,
  mediaTypes: string[] | undefined,
): BrowserSitePermission[] | null {
  if (isClipboardPermission(permission)) return ["clipboard"];
  if (permission === "mediaKeySystem") return ["protectedContent"];
  if (permission === "automatic-downloads") return ["automaticDownloads"];
  if (BROWSER_SITE_PERMISSIONS.includes(permission as BrowserSitePermission))
    return [permission as BrowserSitePermission];
  if (permission !== "media" || !mediaTypes?.length) return null;
  const permissions: BrowserSitePermission[] = [];
  for (const type of mediaTypes) {
    if (type === "video") permissions.push("camera");
    else if (type === "audio") permissions.push("microphone");
    else return null;
  }
  return [...new Set(permissions)];
}

function sitePermissionForCheck(
  permission: string,
  mediaType?: string,
): BrowserSitePermission | null {
  if (isClipboardPermission(permission)) return "clipboard";
  if (permission === "mediaKeySystem") return "protectedContent";
  if (BROWSER_SITE_PERMISSIONS.includes(permission as BrowserSitePermission))
    return permission as BrowserSitePermission;
  if (permission !== "media") return null;
  if (mediaType === "video") return "camera";
  if (mediaType === "audio") return "microphone";
  return null;
}

function isClipboardPermission(permission: string): boolean {
  return (
    permission === "clipboard-read" ||
    permission === "clipboard-sanitized-write"
  );
}

function createPermissionRequestId(): string {
  return `embedded-permission-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function normalizePermission(value: string): string {
  return value.trim() || "unknown";
}

function readEmbeddingOrigin(details: object): string | undefined {
  if (!("embeddingOrigin" in details)) {
    return undefined;
  }
  const value = details.embeddingOrigin;
  return typeof value === "string" ? value : undefined;
}

function normalizeUrl(value: string | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
