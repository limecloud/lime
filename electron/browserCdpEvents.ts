import { Buffer } from "node:buffer";
import { BrowserNativePipe } from "./browserNativePipe";
import { BrowserCdpEventAccess } from "./browserCdpEventAccess";
import {
  MAX_NATIVE_PIPE_FRAME_BYTES,
  type CdpEvent,
  type NativePipeConnection,
} from "./browserNativePipeProtocol";
import type { BrowserCdpSessions } from "./browserCdpSessions";

interface EventSubscription {
  tabId: string;
  tempDirectory: string;
  sessions: BrowserCdpSessions;
  assertCurrent: () => void;
  allows: (url: string) => boolean;
  readFrameTree: () => Promise<unknown>;
  sourceUrl: (event: CdpEvent) => Promise<string | null>;
  onDisconnected: () => void;
}

/** Bounded delivery on the existing attachment; no browser execution or approval authority. */
export class BrowserCdpEvents {
  readonly #subscriptions = new Map<string, { close: () => Promise<void> }>();

  revoke(tabId: string): void {
    void this.#subscriptions.get(tabId)?.close();
  }

  async subscribe(input: EventSubscription): Promise<NativePipeConnection> {
    if (this.#subscriptions.has(input.tabId))
      throw new Error("Browser tab already has an event subscriber");
    const access = new BrowserCdpEventAccess(input.allows);
    const queue: Array<{ event: CdpEvent; bytes: number }> = [];
    let bytes = 0;
    let pumping = false;
    let active = true;
    let pipe: BrowserNativePipe | undefined;
    const controller = new AbortController();
    const remove: Array<() => void> = [];
    const close = () => {
      if (active) {
        active = false;
        controller.abort();
        for (const unsubscribe of remove) unsubscribe();
        queue.length = 0;
        bytes = 0;
        if (this.#subscriptions.get(input.tabId) === entry)
          this.#subscriptions.delete(input.tabId);
      }
      return pipe?.dispose() ?? Promise.resolve();
    };
    const disconnect = () => {
      const notify = active;
      const pending = close();
      if (notify) input.onDisconnected();
      return pending;
    };
    const entry = { close };
    this.#subscriptions.set(input.tabId, entry);
    const assertCurrent = () => {
      if (!active || this.#subscriptions.get(input.tabId) !== entry)
        throw new Error("Browser event subscription is no longer active");
      input.assertCurrent();
    };
    const readNative = async <T>(read: () => Promise<T>): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const signal = controller.signal;
      let cancel = () => {};
      try {
        return await new Promise<T>((resolve, reject) => {
          cancel = () =>
            reject(new Error("Browser event subscription is no longer active"));
          signal.addEventListener("abort", cancel, { once: true });
          timer = setTimeout(
            () => reject(new Error("Browser CDP event source read timed out")),
            10_000,
          );
          Promise.resolve()
            .then(() => {
              assertCurrent();
              return read();
            })
            .then(resolve, reject);
        });
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
      }
    };
    const pump = async () => {
      if (pumping) return;
      pumping = true;
      try {
        while (active && queue.length) {
          const item = queue.shift()!;
          bytes -= item.bytes;
          assertCurrent();
          access.readFrameTree(await readNative(input.readFrameTree));
          assertCurrent();
          const sourceUrl = await readNative(() => input.sourceUrl(item.event));
          assertCurrent();
          if (!sourceUrl || !input.allows(sourceUrl)) continue;
          if (item.event.source.targetId)
            access.setSourceFrame(item.event.source.targetId, sourceUrl);
          if (access.accepts(item.event, sourceUrl))
            pipe?.sendCdpEvent(item.event);
        }
      } catch {
        await disconnect();
      } finally {
        pumping = false;
      }
    };
    try {
      input.assertCurrent();
      remove.push(
        input.sessions.addCdpDetachListener(input.tabId, () => {
          void close();
        }),
      );
      access.readFrameTree(await readNative(input.readFrameTree));
      assertCurrent();
      pipe = await BrowserNativePipe.listen({
        tabId: input.tabId,
        tempDirectory: input.tempDirectory,
        assertCurrent,
        onDisconnected: () => {
          void disconnect();
        },
      });
      assertCurrent();
      remove.push(
        input.sessions.addCdpEventListener(input.tabId, (event) => {
          if (!active) return;
          let size: number;
          try {
            size = Buffer.byteLength(JSON.stringify(event), "utf8");
          } catch {
            void disconnect();
            return;
          }
          if (size > MAX_NATIVE_PIPE_FRAME_BYTES) return;
          if (
            queue.length >= 128 ||
            bytes + size > 4 * MAX_NATIVE_PIPE_FRAME_BYTES
          ) {
            void disconnect();
            return;
          }
          queue.push({ event, bytes: size });
          bytes += size;
          void pump();
        }),
      );
      return pipe.connection;
    } catch (error) {
      await close();
      throw error;
    }
  }
}
