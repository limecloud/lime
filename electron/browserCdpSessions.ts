import type { WebContents } from "electron";

export interface BrowserCdpTarget {
  targetId?: string;
  sessionId?: string;
}

export interface BrowserCdpTargetSession {
  targetId: string;
  sessionId: string;
}

export function readCdpTarget(value: unknown): BrowserCdpTarget | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Browser CDP target must be an object");
  const fields = Object.entries(value);
  if (
    fields.some(
      ([key, id]) =>
        !["targetId", "sessionId"].includes(key) ||
        typeof id !== "string" ||
        !id ||
        id.length > 512 ||
        /\s/u.test(id),
    )
  )
    throw new Error(
      "Browser CDP target contains an invalid target/session selection",
    );
  return { ...value };
}

interface DebuggerListener {
  contents: WebContents;
  sessions: Map<string, string>;
  targets: Map<string, string>;
  parents: Map<string, string>;
  listener: (
    event: unknown,
    method: string,
    params: unknown,
    sessionId?: string,
  ) => void;
  detached: () => void;
  destroyed: () => void;
  changed: () => void;
}

/** Ephemeral debugger state; tab ownership and approval remain in BrowserTabHost. */
export class BrowserCdpSessions {
  readonly #listeners = new Map<string, DebuggerListener>();

  async attachDebugger(
    tabId: string,
    contents: WebContents,
    onDetached: () => void,
    onTargetChanged: () => void,
  ): Promise<void> {
    this.registerDebuggerListener(tabId, contents, onDetached, onTargetChanged);
    const entry = this.#listeners.get(tabId)!;
    const assertCurrent = () => {
      if (this.#require(tabId) !== entry)
        throw new Error("Browser CDP attachment is no longer active");
    };
    try {
      if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
      await contents.debugger.sendCommand("Page.enable");
      assertCurrent();
      await contents.debugger.sendCommand("DOM.enable");
      assertCurrent();
    } catch (error) {
      // A late initialization failure must not detach a newer attachment.
      if (this.#listeners.get(tabId) === entry) {
        this.unregisterDebuggerListener(tabId);
        if (!contents.isDestroyed() && contents.debugger.isAttached())
          contents.debugger.detach();
      }
      throw error;
    }
  }

  registerDebuggerListener(
    tabId: string,
    contents: WebContents,
    onDetached: () => void,
    onTargetChanged: () => void,
  ): void {
    const existing = this.#listeners.get(tabId);
    if (existing?.contents === contents) return;
    this.unregisterDebuggerListener(tabId);
    const entry: DebuggerListener = {
      contents,
      sessions: new Map(),
      targets: new Map(),
      parents: new Map(),
      changed: onTargetChanged,
      listener: (_event, method, params, sessionId) => {
        if (this.#listeners.get(tabId) === entry)
          this.recordDebuggerTargetEvent(tabId, method, params, sessionId);
      },
      detached: () => {
        if (this.#listeners.get(tabId) !== entry) return;
        this.unregisterDebuggerListener(tabId);
        onDetached();
      },
      destroyed: () => {
        if (this.#listeners.get(tabId) === entry)
          this.unregisterDebuggerListener(tabId);
      },
    };
    this.#listeners.set(tabId, entry);
    contents.debugger.on("message", entry.listener);
    contents.debugger.on("detach", entry.detached);
    contents.on("destroyed", entry.destroyed);
    contents.on("render-process-gone", entry.detached);
  }

  unregisterDebuggerListener(tabId: string): void {
    const entry = this.#listeners.get(tabId);
    if (!entry) return;
    this.#listeners.delete(tabId);
    this.forgetDebuggerTargetSessionsForTab(entry);
    if (!entry.contents.isDestroyed()) {
      entry.contents.debugger.removeListener("message", entry.listener);
      entry.contents.debugger.removeListener("detach", entry.detached);
    }
    entry.contents.removeListener("destroyed", entry.destroyed);
    entry.contents.removeListener("render-process-gone", entry.detached);
  }

  recordDebuggerTargetEvent(
    tabId: string,
    method: string,
    value: unknown,
    sourceSessionId?: string,
  ): void {
    const entry = this.#listeners.get(tabId);
    if (!entry || !value || typeof value !== "object") return;
    const params = value as Record<string, unknown>;
    if (typeof params.sessionId !== "string" || !params.sessionId) return;
    const source = sourceSessionId || undefined;
    if (source && !entry.targets.has(source)) return;
    if (method === "Target.detachedFromTarget") {
      if (source && entry.parents.get(params.sessionId) !== source) return;
      this.forgetDebuggerTargetSession(entry, params.sessionId);
    } else if (method === "Target.attachedToTarget") {
      const info = params.targetInfo as Record<string, unknown> | null;
      if (info && typeof info.targetId === "string" && info.targetId)
        this.rememberDebuggerTargetSession(
          entry,
          info.targetId,
          params.sessionId,
          source,
        );
    }
  }

  debuggerSessionIdForTarget(tabId: string, targetId: string): string | null {
    return this.#listeners.get(tabId)?.sessions.get(targetId) ?? null;
  }

  resolveTarget(
    tabId: string,
    target: BrowserCdpTarget,
  ): BrowserCdpTargetSession {
    const entry = this.#require(tabId);
    const id =
      target.sessionId === undefined
        ? target.targetId
        : entry.targets.get(target.sessionId);
    if (
      !id ||
      !entry.sessions.has(id) ||
      (target.targetId !== undefined && target.targetId !== id)
    )
      throw new Error(
        "No matching in-app browser debugger session is attached for target",
      );
    return { targetId: id, sessionId: entry.sessions.get(id)! };
  }

  async attachDebuggerTarget(
    tabId: string,
    targetId: string,
    assertActive: () => void,
  ): Promise<{ targetId: string; sessionId: string }> {
    const entry = this.#require(tabId);
    const current = this.debuggerSessionIdForTarget(tabId, targetId);
    if (current) return { targetId, sessionId: current };
    const result = await entry.contents.debugger.sendCommand(
      "Target.attachToTarget",
      { flatten: true, targetId },
    );
    assertActive();
    if (this.#listeners.get(tabId) !== entry)
      throw new Error("Browser CDP attachment is no longer active");
    if (typeof result?.sessionId !== "string" || !result.sessionId)
      throw new Error("Target.attachToTarget did not return a sessionId");
    this.rememberDebuggerTargetSession(entry, targetId, result.sessionId);
    return { targetId, sessionId: result.sessionId };
  }

  async detachDebuggerTarget(tabId: string, targetId: string): Promise<void> {
    const entry = this.#require(tabId);
    const sessionId = entry.sessions.get(targetId);
    if (!sessionId) return;
    try {
      await entry.contents.debugger.sendCommand("Target.detachFromTarget", {
        sessionId,
      });
    } finally {
      this.forgetDebuggerTargetSession(entry, sessionId);
    }
  }

  sendDebuggerCommand(
    tabId: string,
    method: string,
    params: Record<string, unknown>,
    target?: BrowserCdpTarget,
  ): Promise<unknown> {
    const entry = this.#require(tabId);
    if (
      !target ||
      (target.targetId === undefined && target.sessionId === undefined)
    )
      return entry.contents.debugger.sendCommand(method, params);
    const resolved = this.resolveTarget(tabId, target);
    return entry.contents.debugger.sendCommand(
      method,
      params,
      resolved.sessionId,
    );
  }

  private rememberDebuggerTargetSession(
    entry: DebuggerListener,
    targetId: string,
    sessionId: string,
    parentSessionId?: string,
  ): void {
    const previous = entry.sessions.get(targetId);
    // Flattened events identify their parent in the debugger's fourth argument.
    // Reparenting an ancestor beneath its descendant cannot create a live tree.
    for (
      let parent = parentSessionId;
      parent;
      parent = entry.parents.get(parent)
    )
      if (parent === sessionId || parent === previous) return;
    if (
      entry.sessions.get(targetId) === sessionId &&
      entry.targets.get(sessionId) === targetId &&
      entry.parents.get(sessionId) === parentSessionId
    )
      return;
    if (previous) this.forgetDebuggerTargetSession(entry, previous);
    this.forgetDebuggerTargetSession(entry, sessionId);
    entry.sessions.set(targetId, sessionId);
    entry.targets.set(sessionId, targetId);
    if (parentSessionId) entry.parents.set(sessionId, parentSessionId);
    entry.changed();
  }

  private forgetDebuggerTargetSession(
    entry: DebuggerListener,
    sessionId: string,
  ): void {
    if (!entry.targets.has(sessionId)) return;
    const children = new Map<string, string[]>();
    for (const [child, parent] of entry.parents) {
      const siblings = children.get(parent) ?? [];
      siblings.push(child);
      children.set(parent, siblings);
    }
    const pending = [sessionId];
    let changed = false;
    for (const current of pending) {
      pending.push(...(children.get(current) ?? []));
      const targetId = entry.targets.get(current);
      entry.targets.delete(current);
      entry.parents.delete(current);
      if (targetId && entry.sessions.get(targetId) === current) {
        entry.sessions.delete(targetId);
        changed = true;
      }
    }
    if (changed) entry.changed();
  }

  private forgetDebuggerTargetSessionsForTab(entry: DebuggerListener): void {
    entry.sessions.clear();
    entry.targets.clear();
    entry.parents.clear();
  }

  #require(tabId: string): DebuggerListener {
    const entry = this.#listeners.get(tabId);
    if (
      !entry ||
      entry.contents.isDestroyed() ||
      !entry.contents.debugger.isAttached()
    )
      throw new Error("Browser CDP debugger session is not attached");
    return entry;
  }
}
