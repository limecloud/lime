import { randomUUID } from "node:crypto";
import { BrowserWindow } from "./electronRuntime";
import type {
  BrowserRoute,
  BrowserTabState,
  BrowserToolCall,
} from "./browserTabHost";
import type { ElectronEmbeddedBrowserHost } from "./embeddedBrowserHost";
import { browserToolCallKey, readHttpUrl } from "./browserTabState";

export interface BrowserToolWorkspaceInput {
  ownerWebContentsId: number;
  threadId: string;
  assertCurrent: () => void;
}
export interface BrowserToolWorkspaceIdentity {
  browserSessionId: string;
  tabId: string;
}
export interface BrowserToolWorkspaceHandler {
  open(input: BrowserToolWorkspaceInput): Promise<BrowserToolWorkspaceIdentity>;
  reveal(
    input: BrowserToolWorkspaceInput & BrowserToolWorkspaceIdentity,
  ): Promise<void>;
}

/** Bootstrap a real approval anchor; destination navigation stays in the browse approval flow. */
export class BrowserToolWorkspace {
  #handler: BrowserToolWorkspaceHandler | null = null;
  #epoch = 0;
  readonly #closedTurns = new Set<string>();
  readonly #pending = new Map<string, Promise<void>>();
  readonly #blank = new Map<string, BrowserRoute>();

  constructor(
    readonly deps: {
      embeddedHost: ElectronEmbeddedBrowserHost;
      findRoute: (call: BrowserToolCall) => BrowserRoute | undefined;
      hasRoute: (route: BrowserRoute) => boolean;
      register: (route: BrowserRoute) => void;
      observe: (route: BrowserRoute) => void;
      emit: (route: BrowserRoute) => BrowserTabState;
      close: (route: BrowserRoute) => void;
      resolveWindow?: (owner: number) => BrowserWindow | undefined;
    },
  ) {}

  setHandler(handler: BrowserToolWorkspaceHandler | null): void {
    this.#handler = handler;
  }

  checkpoint(call: BrowserToolCall): () => void {
    const epoch = this.#epoch;
    return () => {
      if (
        epoch !== this.#epoch ||
        this.#closedTurns.has(JSON.stringify([call.threadId, call.turnId]))
      )
        throw new Error(
          "Browser tool workspace is stale after turn completion or disconnect",
        );
    };
  }

  turnEnded(threadId: string, turnId: string): void {
    this.#closedTurns.add(JSON.stringify([threadId, turnId]));
    for (const [key, route] of this.#blank) {
      if (route.threadId === threadId && route.activeTurnId === turnId)
        this.#blank.delete(key);
    }
  }

  reset(): void {
    this.#epoch += 1;
    this.#pending.clear();
    this.#blank.clear();
    this.#closedTurns.clear();
  }

  async prepare(
    call: BrowserToolCall,
    assertCurrent: () => void,
  ): Promise<void> {
    readHttpUrl(call.arguments.url);
    const key = JSON.stringify([call.ownerWebContentsId, call.threadId]);
    const previous = this.#pending.get(key);
    const pending = (previous?.catch(() => {}) ?? Promise.resolve()).then(() =>
      this.#prepare(call, assertCurrent),
    );
    this.#pending.set(key, pending);
    try {
      await pending;
    } finally {
      if (this.#pending.get(key) === pending) this.#pending.delete(key);
    }
  }

  async #prepare(
    call: BrowserToolCall,
    assertCurrent: () => void,
  ): Promise<void> {
    assertCurrent();
    const handler = this.#handler;
    let route = this.deps.findRoute(call);
    if (route?.activeTurnId && route.activeTurnId !== call.turnId)
      throw new Error("Browser tab is controlled by another active turn");
    // Existing native-only hosts need no bootstrap. The desktop bridge also reveals folded panes.
    if (!handler) {
      if (route) return;
      throw new Error(
        "Browser tool workspace requires the current App Server owner",
      );
    }
    const resolveWindow = () =>
      this.deps.resolveWindow
        ? this.deps.resolveWindow(call.ownerWebContentsId)
        : BrowserWindow.getAllWindows().find(
            (window) =>
              !window.isDestroyed() &&
              window.webContents.id === call.ownerWebContentsId,
          );
    const window = resolveWindow();
    const current = () => {
      assertCurrent();
      if (
        !window ||
        window.isDestroyed() ||
        resolveWindow() !== window ||
        window.webContents.id !== call.ownerWebContentsId
      )
        throw new Error("Browser tool owner window is unavailable");
      if (
        route &&
        (!this.deps.hasRoute(route) ||
          (route.activeTurnId !== null && route.activeTurnId !== call.turnId))
      )
        throw new Error("Browser tool workspace route is stale");
    };
    current();
    const input = {
      ownerWebContentsId: call.ownerWebContentsId,
      threadId: call.threadId,
      assertCurrent: current,
    };
    let created = false;
    try {
      if (!route) {
        const identity = await handler.open(input);
        current();
        // No renderer intent is published until this blank view is registered.
        route = {
          ...identity,
          activeTurnId: call.turnId,
          controlOwner: "agent",
          humanReason: null,
          origin: "agent",
          mark: null,
          ownerWebContentsId: call.ownerWebContentsId,
          threadId: call.threadId,
          windowId: window!.id,
          viewId: `browser_view_${randomUUID()}`,
          selected: true,
          pageRevision: 0,
          latestSnapshotId: null,
          latestSnapshotNodeIds: new Set(),
          lastPageStateKey: null,
        };
        this.deps.register(route);
        created = true;
        await this.deps.embeddedHost.invoke(
          window!,
          "embedded_browser_view_mount",
          {
            viewId: route.viewId,
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            visible: false,
          },
        );
        current();
        this.deps.observe(route);
        this.deps.emit(route);
        this.#blank.set(browserToolCallKey(call), route);
      }
      await handler.reveal({
        ...input,
        browserSessionId: route.browserSessionId,
        tabId: route.tabId,
      });
      current();
    } catch (error) {
      if (created && route) {
        this.#blank.delete(browserToolCallKey(call));
        if (this.deps.hasRoute(route)) this.deps.close(route);
      }
      throw error;
    }
  }

  async navigateBlank(
    call: BrowserToolCall,
    route: BrowserRoute,
  ): Promise<BrowserTabState | null> {
    const key = browserToolCallKey(call);
    if (this.#blank.get(key) !== route) return null;
    const current = this.checkpoint(call);
    current();
    if (
      !this.deps.hasRoute(route) ||
      route.controlOwner !== "agent" ||
      route.activeTurnId !== call.turnId
    )
      throw new Error("Browser first-open approval anchor is stale");
    const native = this.deps.embeddedHost.resolveNativeView(route.viewId);
    if (!native)
      throw new Error("Browser first-open native view is unavailable");
    await this.deps.embeddedHost.invoke(
      native.window,
      "embedded_browser_view_navigate",
      {
        viewId: route.viewId,
        url: readHttpUrl(call.arguments.url),
      },
    );
    current();
    this.#blank.delete(key);
    return this.deps.emit(route);
  }
}
