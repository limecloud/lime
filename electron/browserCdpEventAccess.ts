import type { CdpEvent } from "./browserNativePipeProtocol";

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const sameOrigin = (left: string, right: string): boolean => {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
};

const requestEvents = new Set([
  "Network.requestWillBeSentExtraInfo",
  "Network.responseReceived",
  "Network.responseReceivedExtraInfo",
  "Network.requestServedFromCache",
  "Network.dataReceived",
  "Network.loadingFinished",
  "Network.loadingFailed",
  "Network.resourceChangedPriority",
]);
const frameEvents = new Set([
  "Page.frameNavigated",
  "Page.frameStartedLoading",
  "Page.frameStoppedLoading",
  "Page.lifecycleEvent",
  "Page.navigatedWithinDocument",
]);
const pageEvents = new Set([
  "Page.loadEventFired",
  "Page.domContentEventFired",
  "Page.javascriptDialogOpening",
  "Page.javascriptDialogClosed",
  "DOM.documentUpdated",
]);
const webSocketEvents = new Set([
  "Network.webSocketWillSendHandshakeRequest",
  "Network.webSocketHandshakeResponseReceived",
  "Network.webSocketFrameSent",
  "Network.webSocketFrameReceived",
  "Network.webSocketFrameError",
  "Network.webSocketClosed",
]);

type WebSocketRecord = {
  frameId: string;
  frameUrl: string;
  sourceUrl: string;
  url: string;
  allowed: boolean;
};

/** Origin facts come exclusively from native CDP frames/contexts, never from the subscriber. */
export class BrowserCdpEventAccess {
  readonly #frames = new Map<string, string>();
  readonly #contexts = new Map<string, { url: string; frameId: string }>();
  readonly #requests = new Map<
    string,
    { frameId: string; frameUrl: string; urls: string[]; allowed: boolean }
  >();
  readonly #webSockets = new Map<string, WebSocketRecord>();
  #dialogAllowed = false;

  constructor(readonly allows: (url: string) => boolean) {}

  readFrameTree(value: unknown): void {
    this.#frames.clear();
    const visit = (tree: unknown, depth = 0) => {
      if (depth > 64)
        throw new Error("Browser CDP frame tree exceeds the depth limit");
      const data = object(tree);
      const frame = object(data?.frame);
      if (typeof frame?.id === "string" && typeof frame.url === "string")
        this.#frames.set(frame.id, frame.url);
      if (Array.isArray(data?.childFrames))
        for (const child of data.childFrames) visit(child, depth + 1);
    };
    visit(object(value)?.frameTree);
  }

  setSourceFrame(frameId: string, url: string): void {
    this.#frames.set(frameId, url);
  }

  accepts(event: CdpEvent, sourceUrl?: string | null): boolean {
    const p = event.params ?? {};
    const scope = event.source.sessionId ?? "";
    const key = (id: unknown) => `${scope}\u0000${String(id)}`;
    if (event.method === "Network.requestWillBeSent") {
      if (typeof p.requestId !== "string") return false;
      const id = key(p.requestId);
      const previous = this.#requests.get(id);
      const frameId = typeof p.frameId === "string" ? p.frameId : "";
      const frameUrl = this.#frames.get(frameId) ?? "";
      const url = object(p.request)?.url;
      const urls = [
        ...(previous?.urls ?? []),
        ...(typeof url === "string" ? [url] : []),
      ].slice(0, 65);
      const allowed =
        previous?.allowed !== false &&
        urls.length <= 64 &&
        Boolean(frameUrl) &&
        this.allows(frameUrl) &&
        typeof url === "string" &&
        this.allows(url) &&
        this.#urlsAllowed(p);
      // Retain denial across redirects; later header/data events have no URL.
      this.#requests.set(id, { frameId, frameUrl, urls, allowed });
      if (this.#requests.size > 4096)
        this.#requests.delete(this.#requests.keys().next().value!);
      return allowed;
    }
    if (event.method === "Network.webSocketCreated") {
      if (typeof p.requestId !== "string" || typeof p.url !== "string")
        return false;
      const frameId = typeof p.frameId === "string" ? p.frameId : "";
      const frameUrl =
        (frameId && this.#frames.get(frameId)) ||
        (typeof sourceUrl === "string" ? sourceUrl : "");
      const url = p.url;
      const allowed =
        Boolean(frameUrl) &&
        this.allows(frameUrl) &&
        this.#allowsNetworkUrl(url) &&
        this.#urlsAllowed(p);
      this.#webSockets.set(key(p.requestId), {
        frameId,
        frameUrl,
        sourceUrl: sourceUrl ?? frameUrl,
        url,
        allowed,
      });
      if (this.#webSockets.size > 4096)
        this.#webSockets.delete(this.#webSockets.keys().next().value!);
      return allowed;
    }
    if (webSocketEvents.has(event.method)) {
      const requestId = p.requestId;
      const socket =
        typeof requestId === "string"
          ? this.#webSockets.get(key(requestId))
          : undefined;
      const frameStillMatches =
        socket?.frameId === "" ||
        this.#frames.get(socket?.frameId ?? "") === socket?.frameUrl;
      const allowed = Boolean(
        socket?.allowed &&
        frameStillMatches &&
        typeof sourceUrl === "string" &&
        sameOrigin(sourceUrl, socket.sourceUrl) &&
        this.allows(socket.frameUrl) &&
        this.#allowsNetworkUrl(socket.url) &&
        this.#urlsAllowed(p),
      );
      if (socket && !allowed) socket.allowed = false;
      if (event.method === "Network.webSocketClosed" && requestId !== undefined)
        this.#webSockets.delete(key(requestId));
      return allowed;
    }
    if (requestEvents.has(event.method)) {
      const request =
        typeof p.requestId === "string"
          ? this.#requests.get(key(p.requestId))
          : undefined;
      if (
        !request?.allowed ||
        this.#frames.get(request.frameId) !== request.frameUrl ||
        !this.allows(request.frameUrl) ||
        !request.urls.every((url) => this.allows(url)) ||
        !this.#urlsAllowed(p)
      ) {
        if (request) request.allowed = false;
        return false;
      }
      return true;
    }
    if (event.method === "Log.entryAdded") {
      const entry = object(p.entry);
      if (
        typeof entry?.url !== "string" ||
        !this.allows(entry.url) ||
        entry.networkRequestId === undefined
      )
        return false;
      if (entry.networkRequestId !== undefined) {
        const request = this.#requests.get(key(entry.networkRequestId));
        if (
          !request?.allowed ||
          this.#frames.get(request.frameId) !== request.frameUrl ||
          !this.allows(request.frameUrl) ||
          !request.urls.every((url) => this.allows(url))
        )
          return false;
      }
      return this.#urlsAllowed(p);
    }
    if (event.method === "Page.frameNavigated") {
      const frame = object(p.frame);
      if (typeof frame?.id !== "string" || typeof frame.url !== "string")
        return false;
      if (this.#frames.get(frame.id) !== frame.url) return false;
    } else if (
      event.method === "Page.frameDetached" &&
      typeof p.frameId === "string"
    ) {
      this.#frames.delete(p.frameId);
      return false;
    } else if (event.method === "Runtime.executionContextsCleared") {
      for (const id of this.#contexts.keys())
        if (id.startsWith(`${scope}\u0000`)) this.#contexts.delete(id);
    } else if (event.method === "Runtime.executionContextDestroyed") {
      this.#contexts.delete(key(p.executionContextId));
      return false;
    } else if (event.method === "Runtime.executionContextCreated") {
      const context = object(p.context);
      const aux = object(context?.auxData);
      const origin =
        typeof aux?.frameId === "string"
          ? this.#frames.get(aux.frameId)
          : undefined;
      if (context?.id != null) this.#contexts.delete(key(context.id));
      if (
        !origin ||
        !this.allows(origin) ||
        context?.id == null ||
        !this.#urlsAllowed(p)
      )
        return false;
      this.#contexts.set(key(context.id), {
        url: origin,
        frameId: aux!.frameId as string,
      });
      if (this.#contexts.size > 4096)
        this.#contexts.delete(this.#contexts.keys().next().value!);
    } else if (
      event.method === "Runtime.consoleAPICalled" ||
      event.method === "Runtime.exceptionThrown" ||
      event.method === "Runtime.bindingCalled"
    ) {
      if (
        p.executionContextId === undefined &&
        object(p.exceptionDetails)?.executionContextId === undefined
      )
        return false;
    } else if (
      !frameEvents.has(event.method) &&
      !pageEvents.has(event.method)
    ) {
      // Unknown domains and DOM payloads need their own native provenance contract.
      return false;
    }
    if (
      frameEvents.has(event.method) &&
      event.method !== "Page.frameNavigated" &&
      typeof p.frameId !== "string"
    )
      return false;
    if (event.method === "Page.javascriptDialogOpening") {
      this.#dialogAllowed =
        typeof p.url === "string" && this.allows(p.url) && this.#urlsAllowed(p);
      return this.#dialogAllowed;
    }
    if (event.method === "Page.javascriptDialogClosed") {
      const allowed = this.#dialogAllowed;
      this.#dialogAllowed = false;
      return allowed && this.#urlsAllowed(p);
    }
    if (typeof p.frameId === "string") {
      const url = this.#frames.get(p.frameId);
      if (!url || !this.allows(url)) return false;
    }
    const contextId =
      p.executionContextId ?? object(p.exceptionDetails)?.executionContextId;
    if (contextId !== undefined) {
      const context = this.#contexts.get(key(contextId));
      if (
        !context ||
        this.#frames.get(context.frameId) !== context.url ||
        !this.allows(context.url)
      )
        return false;
    }
    return this.#urlsAllowed(p);
  }

  #urlsAllowed(value: unknown, depth = 0, count = { nodes: 0 }): boolean {
    if (++count.nodes > 20_000 || depth > 64) return false;
    if (typeof value === "string") {
      if (/^(https?|wss?|blob):/iu.test(value)) {
        let url: URL;
        try {
          url = new URL(value);
        } catch {
          return false;
        }
        if (url.protocol === "blob:") return this.allows(url.origin);
        if (url.protocol === "ws:") url.protocol = "http:";
        if (url.protocol === "wss:") url.protocol = "https:";
        return this.allows(url.href);
      }
      return true;
    }
    if (Array.isArray(value))
      return value.every((item) => this.#urlsAllowed(item, depth + 1, count));
    if (value && typeof value === "object")
      return Object.values(value).every((item) =>
        this.#urlsAllowed(item, depth + 1, count),
      );
    return true;
  }

  #allowsNetworkUrl(value: string): boolean {
    try {
      const url = new URL(value);
      if (url.protocol === "ws:") url.protocol = "http:";
      if (url.protocol === "wss:") url.protocol = "https:";
      return this.allows(url.href);
    } catch {
      return false;
    }
  }
}
