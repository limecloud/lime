import type { JsonRpcMessage } from "@limecloud/app-server-client";

/** Native resource projection of canonical Thread/Turn activity; owns no runtime state. */
export class PowerSaveHost {
  #enabled = false;
  #disposed = false;
  #activeThreads = new Set<string>();
  #observedThreads = new Set<string>();
  #activeTurns = new Map<string, string>();
  #terminalTurns = new Set<string>();
  #powerSaveBlockerId: number | null = null;

  constructor(
    readonly options: {
      platform: string;
      start(type: "prevent-app-suspension"): number;
      stop(id: number): void;
    },
  ) {}

  setPreventSleepWhileRunning(enabled: boolean): void {
    if (this.#disposed) return;
    this.#enabled = enabled;
    this.syncPowerSaveBlocker();
  }

  observeServerMessage(message: JsonRpcMessage): void {
    if (this.#disposed || !("method" in message)) return;
    const params = record(message.params);
    if (message.method === "thread/status/changed") {
      this.#markObserved(params?.threadId);
      this.updatePowerSaveBlocker(params?.threadId, params?.status);
    } else if (message.method === "thread/started") {
      const thread = record(params?.thread);
      this.#markObserved(thread?.id);
      this.updatePowerSaveBlocker(thread?.id, thread?.status);
    } else if (message.method === "thread/closed") {
      this.#markObserved(params?.threadId);
      this.updatePowerSaveBlocker(params?.threadId, { type: "notLoaded" });
    } else if (
      message.method === "turn/started" ||
      message.method === "turn/completed"
    ) {
      this.#observeTurn(
        params?.threadId,
        params?.turn,
        message.method === "turn/completed",
      );
    }
  }

  observeResult(method: string, result: unknown, params?: unknown): void {
    if (this.#disposed) return;
    if (method === "turn/start") {
      const turn = record(record(result)?.turn);
      this.#observeTurn(
        record(params)?.threadId,
        turn,
        turn?.status !== "inProgress",
      );
    }
    if (
      ["thread/start", "thread/resume", "thread/read", "thread/fork"].includes(
        method,
      )
    ) {
      const thread = record(record(result)?.thread);
      if (
        typeof thread?.id === "string" &&
        !this.#observedThreads.has(thread.id)
      )
        this.updatePowerSaveBlocker(thread.id, thread.status);
    }
  }

  updatePowerSaveBlocker(threadId: unknown, status: unknown): void {
    if (this.#disposed || typeof threadId !== "string" || !threadId) return;
    const type = record(status)?.type;
    if (type === "active") this.#activeThreads.add(threadId);
    else if (["idle", "systemError", "notLoaded"].includes(String(type))) {
      this.#activeThreads.delete(threadId);
      const turnId = this.#activeTurns.get(threadId);
      if (turnId) this.#terminalTurns.add(JSON.stringify([threadId, turnId]));
      this.#activeTurns.delete(threadId);
    } else return;
    this.syncPowerSaveBlocker();
  }

  syncPowerSaveBlocker(): void {
    const shouldBlock =
      !this.#disposed &&
      this.options.platform !== "win32" &&
      this.#enabled &&
      this.#activeThreads.size > 0;
    if (shouldBlock && this.#powerSaveBlockerId === null) {
      this.#powerSaveBlockerId = this.options.start("prevent-app-suspension");
    } else if (!shouldBlock && this.#powerSaveBlockerId !== null) {
      this.options.stop(this.#powerSaveBlockerId);
      this.#powerSaveBlockerId = null;
    }
  }

  connectionLost(): void {
    this.#activeThreads.clear();
    this.#observedThreads.clear();
    this.#activeTurns.clear();
    this.#terminalTurns.clear();
    this.syncPowerSaveBlocker();
  }

  dispose(): void {
    this.#disposed = true;
    this.connectionLost();
  }

  #markObserved(threadId: unknown): void {
    if (typeof threadId === "string" && threadId)
      this.#observedThreads.add(threadId);
  }

  #observeTurn(threadId: unknown, value: unknown, terminal: boolean): void {
    const turn = record(value);
    if (
      typeof threadId !== "string" ||
      !threadId ||
      typeof turn?.id !== "string" ||
      !turn.id
    )
      return;
    const key = JSON.stringify([threadId, turn.id]);
    if (terminal) {
      if (!["completed", "failed", "interrupted"].includes(String(turn.status)))
        return;
      this.#markObserved(threadId);
      this.#terminalTurns.add(key);
      const active = this.#activeTurns.get(threadId);
      if (active != null && active !== turn.id) return;
      this.#activeTurns.delete(threadId);
      this.#activeThreads.delete(threadId);
    } else {
      if (turn.status !== "inProgress" || this.#terminalTurns.has(key)) return;
      this.#markObserved(threadId);
      this.#activeTurns.set(threadId, turn.id);
      this.#activeThreads.add(threadId);
    }
    this.syncPowerSaveBlocker();
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
