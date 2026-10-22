import type { OnBeforeRequestListenerDetails, Session } from "electron";

type Resolver = (webContentsId: number) => string | null;
const registrations = new WeakMap<Session, Set<BrowserPermissionRequests>>();

/** One listener per Session; top-level navigation only. Subframes need their own read/action policy. */
export class BrowserPermissionRequests {
  readonly #viewId: Resolver;
  readonly #allows: (viewId: string, url: string) => boolean;
  readonly #blocked: (viewId: string, url: string, reason: string) => void;
  readonly #sessions = new Set<Session>();
  readonly #failures = new Map<string, string>();

  constructor(options: { viewId: Resolver; allows: (viewId: string, url: string) => boolean; blocked: (viewId: string, url: string, reason: string) => void }) {
    this.#viewId = options.viewId;
    this.#allows = options.allows;
    this.#blocked = options.blocked;
  }

  install(session: Session): void {
    if (this.#sessions.has(session)) return;
    let owners = registrations.get(session);
    if (!owners) {
      owners = new Set();
      registrations.set(session, owners);
      const sessionOwners = owners;
      session.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
        // Async approval outside a running tool needs a canonical App Server entry; until then cancel, never replay.
        if (details.resourceType !== "mainFrame") { callback({ cancel: false }); return; }
        for (const owner of sessionOwners) {
          const decision = owner.decide(details);
          if (decision !== null) { callback({ cancel: !decision }); return; }
        }
        callback({ cancel: false });
      });
    }
    owners.add(this);
    this.#sessions.add(session);
  }

  decide(details: Pick<OnBeforeRequestListenerDetails, "resourceType" | "webContentsId" | "url">): boolean | null {
    if (details.resourceType !== "mainFrame" || details.webContentsId === undefined) return null;
    const viewId = this.#viewId(details.webContentsId);
    if (!viewId) return null;
    let allowed = false;
    try { allowed = this.#allows(viewId, details.url); }
    catch { /* Resolver failures remain fail-closed for an owned navigation. */ }
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

  forget(viewId: string): void { this.#failures.delete(viewId); }

  dispose(): void {
    for (const session of this.#sessions) {
      const owners = registrations.get(session);
      owners?.delete(this);
      if (owners?.size === 0) {
        session.webRequest.onBeforeRequest(null);
        registrations.delete(session);
      }
    }
    this.#sessions.clear();
    this.#failures.clear();
  }
}
