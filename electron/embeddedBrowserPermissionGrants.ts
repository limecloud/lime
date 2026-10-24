import type { WebContents, WebFrameMain } from "electron";

export function permissionOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

export interface PermissionSource {
  webContents: WebContents;
  frame: WebFrameMain;
  url: string;
  topUrl: string;
  origin: string;
  isMainFrame: boolean;
}

/** Native frame identity, never a page-supplied origin or display name. */
export function permissionSource(
  webContents: WebContents,
  details: {
    isMainFrame?: boolean;
    requestingUrl?: string;
    securityOrigin?: string;
  },
  requestingOrigin?: string,
): PermissionSource | null {
  try {
    if (webContents.isDestroyed() || typeof details.isMainFrame !== "boolean")
      return null;
    const origin = permissionOrigin(requestingOrigin ?? details.requestingUrl);
    if (!origin) return null;
    if (
      details.securityOrigin !== undefined &&
      permissionOrigin(details.securityOrigin) !== origin
    )
      return null;
    const main = webContents.mainFrame;
    const frames = details.isMainFrame
      ? [main]
      : main.framesInSubtree.filter((frame) => frame !== main);
    const candidates = frames.filter(
      (frame) =>
        !frame.detached &&
        permissionOrigin(frame.url) === origin &&
        (!details.requestingUrl || frame.url === details.requestingUrl),
    );
    if (candidates.length !== 1) return null;
    const frame = candidates[0];
    return {
      webContents,
      frame,
      url: frame.url,
      topUrl: webContents.getURL(),
      origin,
      isMainFrame: details.isMainFrame,
    };
  } catch {
    return null;
  }
}

export function permissionSourceCurrent(source: PermissionSource): boolean {
  try {
    const { webContents, frame } = source;
    return (
      !webContents.isDestroyed() &&
      !frame.detached &&
      frame.url === source.url &&
      webContents.getURL() === source.topUrl &&
      webContents.mainFrame.framesInSubtree.includes(frame)
    );
  } catch {
    return false;
  }
}

interface DocumentGrants {
  viewId: string;
  revision: number;
  grants: Map<string, Set<string>>;
}

/** Ephemeral grants belong to one native document; there is no persistent site store. */
export class EmbeddedBrowserPermissionGrants {
  readonly #documents = new Map<WebContents, DocumentGrants>();

  capture(
    viewId: string,
    source: PermissionSource,
    permission: string,
    mediaTypes?: string[],
  ) {
    const document = this.#document(viewId, source.webContents);
    const revision = document.revision;
    const current = () =>
      document.revision === revision && permissionSourceCurrent(source);
    let settled = false;
    return (allowed: boolean): boolean => {
      if (settled) return false;
      settled = true;
      if (!allowed || !current()) return false;
      const key = this.#key(source, permission);
      const types = document.grants.get(key) ?? new Set<string>();
      if (permission === "media")
        for (const type of mediaTypes ?? []) types.add(type);
      document.grants.set(key, types);
      return true;
    };
  }

  allows(
    viewId: string,
    source: PermissionSource,
    permission: string,
    mediaType?: string,
  ): boolean {
    if (!permissionSourceCurrent(source)) return false;
    const document = this.#documents.get(source.webContents);
    if (!document || document.viewId !== viewId) return false;
    const grant = document.grants.get(this.#key(source, permission));
    return (
      !!grant &&
      (permission !== "media" || (!!mediaType && grant.has(mediaType)))
    );
  }

  revoke(viewId?: string): void {
    for (const document of this.#documents.values()) {
      if (viewId && document.viewId !== viewId) continue;
      document.revision++;
      document.grants.clear();
    }
  }

  #key(source: PermissionSource, permission: string): string {
    return JSON.stringify([
      source.frame.processId,
      source.frame.routingId,
      source.origin,
      permission,
    ]);
  }

  #document(viewId: string, webContents: WebContents): DocumentGrants {
    const existing = this.#documents.get(webContents);
    if (existing) return existing;
    const document: DocumentGrants = { viewId, revision: 0, grants: new Map() };
    this.#documents.set(webContents, document);
    const reset = () => {
      document.revision++;
      document.grants.clear();
    };
    webContents.on("did-start-navigation", reset);
    webContents.on("did-frame-navigate", reset);
    webContents.on("frame-created", reset);
    webContents.on("render-process-gone", reset);
    webContents.once("destroyed", () => {
      reset();
      webContents.off("did-start-navigation", reset);
      webContents.off("did-frame-navigate", reset);
      webContents.off("frame-created", reset);
      webContents.off("render-process-gone", reset);
      this.#documents.delete(webContents);
    });
    return document;
  }
}
