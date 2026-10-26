import type { OnBeforeRequestListenerDetails, Session } from "electron";
import { ApplicationNetworkRefresh } from "./applicationNetworkRefresh";

type Resolver = (webContentsId: number) => string | null;
type Registration = {
  owners: Set<BrowserPermissionRequests>;
  refresh: ApplicationNetworkRefresh;
  managed: boolean;
  webSocketsMayBeActive: boolean;
  imageHeadersInstalled: boolean;
};
const registrations = new WeakMap<Session, Registration>();

/** Stock Session.closeAllConnections does not terminate established WebSockets. */
export function assertApplicationNetworkRevocationSupported(
  session: Session,
): void {
  if (registrations.get(session)?.webSocketsMayBeActive) {
    throw new Error(
      "Browser application network policy changes after WebSocket use require a fresh native Session",
    );
  }
}

/** One listener per Session; application destinations precede per-turn navigation approval. */
export class BrowserPermissionRequests {
  readonly #viewId: Resolver;
  readonly #allows: (viewId: string, url: string) => boolean;
  readonly #blocked: (viewId: string, url: string, reason: string) => void;
  readonly #networkAllows: (url: string) => boolean;
  readonly #resourceAllows: (
    details: OnBeforeRequestListenerDetails,
  ) => boolean;
  readonly #imageAllows: ((documentUrl: string) => boolean) | undefined;
  readonly #refreshNetwork: (() => Promise<void>) | undefined;
  readonly #managed: boolean;
  readonly #sessions = new Set<Session>();
  readonly #failures = new Map<string, string>();

  constructor(options: {
    viewId: Resolver;
    allows: (viewId: string, url: string) => boolean;
    blocked: (viewId: string, url: string, reason: string) => void;
    networkAllows?: (url: string) => boolean;
    refreshNetwork?: () => Promise<void>;
    resourceAllows?: (details: OnBeforeRequestListenerDetails) => boolean;
    imageAllows?: (documentUrl: string) => boolean;
  }) {
    this.#viewId = options.viewId;
    this.#allows = options.allows;
    this.#blocked = options.blocked;
    this.#networkAllows = options.networkAllows ?? (() => true);
    this.#refreshNetwork = options.refreshNetwork;
    this.#resourceAllows = options.resourceAllows ?? (() => true);
    this.#imageAllows = options.imageAllows;
    this.#managed = options.networkAllows !== undefined;
  }

  install(session: Session): void {
    if (this.#sessions.has(session)) return;
    let registration = registrations.get(session);
    if (!registration) {
      registration = {
        owners: new Set(),
        refresh: new ApplicationNetworkRefresh(),
        managed: false,
        webSocketsMayBeActive: false,
        imageHeadersInstalled: false,
      };
      registrations.set(session, registration);
      const current = registration;
      session.webRequest.onBeforeRequest(
        { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
        (details, callback) => {
          const frame = details.frame;
          let frameUrl: string | undefined;
          let frameOrigin: string | undefined;
          try {
            frameUrl = frame?.url;
            frameOrigin = frame?.origin;
          } catch {
            callback({ cancel: true });
            return;
          }
          const complete = (allowed: boolean) => {
            if (allowed && /^wss?:/i.test(details.url))
              current.webSocketsMayBeActive = true;
            callback({ cancel: !allowed });
          };
          if (!current.owners.size) {
            complete(!current.managed);
            return;
          }
          const decide = () => {
            // A refresh can yield while the native requesting document navigates.
            if (
              frame &&
              (frame.detached ||
                frame.url !== frameUrl ||
                frame.origin !== frameOrigin)
            )
              return false;
            for (const owner of current.owners) {
              if (!owner.#allowsNetwork(details)) return false;
              if (!owner.#resourceAllows(details)) return false;
            }
            // Agent approval still applies only to main-frame navigation.
            if (details.resourceType !== "mainFrame") return true;
            for (const owner of current.owners) {
              const decision = owner.decide(details);
              if (decision !== null) return decision;
            }
            return true;
          };
          const refresh = [...current.owners].filter(
            (owner) => owner.#refreshNetwork,
          );
          if (!refresh.length) {
            let allowed = false;
            try {
              allowed = decide();
            } catch {
              /* Never leave a native callback unresolved. */
            }
            complete(allowed);
            return;
          }
          current.refresh.authorize(
            async () => {
              await Promise.all(
                refresh.map((owner) => owner.#refreshNetwork!()),
              );
            },
            () => {
              if (
                !current.owners.size ||
                refresh.some((owner) => !current.owners.has(owner)) ||
                [...current.owners].some(
                  (owner) => owner.#refreshNetwork && !refresh.includes(owner),
                )
              ) {
                return false;
              }
              return decide();
            },
            complete,
          );
        },
      );
    }
    registration.managed ||= this.#managed;
    if (this.#imageAllows && !registration.imageHeadersInstalled) {
      const current = registration;
      session.webRequest.onHeadersReceived(
        { urls: ["http://*/*", "https://*/*"] },
        (details, callback) => {
          if (!["mainFrame", "subFrame"].includes(details.resourceType)) {
            callback({});
            return;
          }
          let blocked = !current.owners.size && current.managed;
          try {
            for (const owner of current.owners)
              if (owner.#imageAllows?.(details.url) === false) blocked = true;
          } catch {
            blocked = true;
          }
          if (!blocked) {
            callback({});
            return;
          }
          // An additional policy intersects with the site's policies. It also
          // covers data/blob images and inherited about:blank/srcdoc documents.
          const headers = { ...details.responseHeaders };
          const key =
            Object.keys(headers).find(
              (name) => name.toLowerCase() === "content-security-policy",
            ) ?? "Content-Security-Policy";
          headers[key] = [...(headers[key] ?? []), "img-src 'none'"];
          callback({ responseHeaders: headers });
        },
      );
      registration.imageHeadersInstalled = true;
    }
    registration.refresh.invalidate();
    registration.owners.add(this);
    this.#sessions.add(session);
  }

  #allowsNetwork(
    details: Pick<
      OnBeforeRequestListenerDetails,
      "resourceType" | "webContentsId" | "url"
    >,
  ): boolean {
    let allowed = false;
    try {
      allowed = this.#networkAllows(details.url);
    } catch {
      /* Keep unavailable authority closed. */
    }
    if (
      !allowed &&
      details.resourceType === "mainFrame" &&
      details.webContentsId !== undefined
    ) {
      const viewId = this.#viewId(details.webContentsId);
      if (viewId) {
        const reason =
          "Browser destination is blocked by managed application network policy";
        this.#failures.set(viewId, reason);
        this.#blocked(viewId, details.url, reason);
      }
    }
    return allowed;
  }

  decide(
    details: Pick<
      OnBeforeRequestListenerDetails,
      "resourceType" | "webContentsId" | "url"
    >,
  ): boolean | null {
    if (
      details.resourceType !== "mainFrame" ||
      details.webContentsId === undefined
    )
      return null;
    const viewId = this.#viewId(details.webContentsId);
    if (!viewId) return null;
    let allowed = false;
    try {
      allowed = this.#allows(viewId, details.url);
    } catch {
      /* Resolver failures remain fail-closed for an owned navigation. */
    }
    if (!allowed) {
      const reason = `Browser Agent navigation to ${new URL(details.url).origin} is blocked without a turn browsing grant; retry goto to request access`;
      this.#failures.set(viewId, reason);
      this.#blocked(viewId, details.url, reason);
    }
    return allowed;
  }

  takeFailure(viewId: string): string | null {
    const failure = this.#failures.get(viewId) ?? null;
    this.#failures.delete(viewId);
    return failure;
  }

  forget(viewId: string): void {
    this.#failures.delete(viewId);
  }

  dispose(): void {
    for (const session of this.#sessions) {
      const registration = registrations.get(session);
      registration?.owners.delete(this);
      registration?.refresh.invalidate();
      // A worker can outlive every view. Retain a closed gate until the next network owner.
      if (registration?.owners.size === 0 && !registration.managed) {
        session.webRequest.onBeforeRequest(null);
        if (registration.imageHeadersInstalled)
          session.webRequest.onHeadersReceived(null);
        registrations.delete(session);
      }
    }
    this.#sessions.clear();
    this.#failures.clear();
  }
}
