import type { Session, WebContents } from "electron";
import {
  EmbeddedBrowserPermissionGrants,
  permissionSource,
} from "./embeddedBrowserPermissionGrants";

type HostEventEmitter = (event: string, payload?: unknown) => void;

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
  onPendingPermission?: (
    requestId: string,
    viewId: string,
    callback: (allowed: boolean) => boolean,
  ) => void;
}

export function installEmbeddedBrowserPermissionHandling(
  browserSession: Session,
  controller: EmbeddedBrowserPermissionController,
  emit: HostEventEmitter,
): EmbeddedBrowserPermissionGrants {
  const grants = new EmbeddedBrowserPermissionGrants();
  browserSession.setPermissionCheckHandler(
    (webContents, permission, origin, details) => {
      const entry =
        webContents && controller.findEntryByWebContents(webContents);
      const source =
        entry && permissionSource(entry.webContents, details, origin);
      return (
        !!entry &&
        !!source &&
        grants.allows(entry.viewId, source, permission, details.mediaType)
      );
    },
  );
  browserSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const entry = controller.findEntryByWebContents(webContents);
      if (!entry) {
        callback(false);
        return;
      }
      const requestId = createPermissionRequestId();
      const source = permissionSource(webContents, details);
      const mediaTypes =
        "mediaTypes" in details ? details.mediaTypes : undefined;
      const deferred =
        controller.deferPermissionRequest === true &&
        !!controller.onPendingPermission &&
        !!source;
      if (deferred) {
        const grant = grants.capture(
          entry.viewId,
          source!,
          permission,
          mediaTypes,
        );
        let settled = false;
        controller.onPendingPermission!(requestId, entry.viewId, (allowed) => {
          if (settled) return false;
          settled = true;
          const granted = grant(allowed);
          callback(granted);
          return granted;
        });
      } else {
        callback(false);
      }
      emit("embedded-browser-view-permission-request", {
        viewId: entry.viewId,
        requestId,
        permission: normalizePermission(permission),
        url: normalizeUrl(webContents.getURL()) ?? "",
        requestingUrl: normalizeUrl(details.requestingUrl),
        embeddingOrigin: normalizeUrl(readEmbeddingOrigin(details)),
        isMainFrame: details.isMainFrame,
        ...(mediaTypes ? { mediaTypes } : {}),
        decision: deferred ? "pending" : "blocked",
      } satisfies EmbeddedBrowserPermissionRequestEvent);
    },
  );
  return grants;
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
