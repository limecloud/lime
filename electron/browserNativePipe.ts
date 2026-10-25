import { Buffer } from "node:buffer";
import process from "node:process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import net, { type Socket } from "node:net";
import path from "node:path";
import {
  MAX_NATIVE_PIPE_FRAME_BYTES,
  NATIVE_PIPE_PROTOCOL_VERSION,
  NativePipeFrames,
  nativePipeFrame,
  type CdpEvent,
  type NativePipeConnection,
  type NativePipeMessage,
} from "./browserNativePipeProtocol";

interface NativePipeOptions {
  tabId: string;
  tempDirectory: string;
  assertCurrent: () => void;
  onDisconnected: () => void;
  onOversizedEvent?: (method: string) => void;
}

/** A one-use, read-only capability. CDP execution stays in canonical dynamic tools. */
export class BrowserNativePipe {
  readonly #server = net.createServer((socket) => this.#accept(socket));
  readonly #token = randomBytes(32).toString("hex");
  readonly #sockets = new Set<Socket>();
  #client: Socket | null = null;
  #directory: string | null = null;
  #path = "";
  #used = false;
  #disposed = false;
  #cleanup: Promise<void> | null = null;
  #connectTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor(readonly options: NativePipeOptions) {
    this.#server.on("error", () => void this.dispose());
  }

  static async listen(options: NativePipeOptions): Promise<BrowserNativePipe> {
    options.assertCurrent();
    const pipe = new BrowserNativePipe(options);
    try {
      if (process.platform === "win32") {
        pipe.#path = `\\\\.\\pipe\\browser-${randomBytes(24).toString("hex")}`;
      } else {
        pipe.#directory = await mkdtemp(
          path.join(options.tempDirectory, "browser-"),
        );
        await chmod(pipe.#directory, 0o700);
        pipe.#path = path.join(pipe.#directory, "events");
      }
      await new Promise<void>((resolve, reject) => {
        pipe.#server.once("error", reject);
        pipe.#server.listen(pipe.#path, () => {
          pipe.#server.removeListener("error", reject);
          resolve();
        });
      });
      if (process.platform !== "win32") await chmod(pipe.#path, 0o600);
      options.assertCurrent();
      pipe.#connectTimer = setTimeout(() => void pipe.dispose(), 30_000);
      pipe.#connectTimer.unref();
      return pipe;
    } catch (error) {
      await pipe.dispose();
      throw error;
    }
  }

  get connection(): NativePipeConnection {
    if (this.#disposed)
      throw new Error("Browser event capability is no longer active");
    return {
      pipePath: this.#path,
      token: this.#token,
      protocolVersion: NATIVE_PIPE_PROTOCOL_VERSION,
    };
  }

  sendCdpEvent(event: CdpEvent): void {
    if (event.source.tabId !== this.options.tabId) {
      void this.dispose();
      return;
    }
    this.#send(
      { jsonrpc: "2.0", method: "onCDPEvent", params: event },
      event.method,
    );
  }

  sendCdpDetach(): void {
    void this.dispose();
  }

  #send(message: NativePipeMessage, cdpMethod?: string): void {
    if (this.#disposed || !this.#client) return;
    try {
      this.options.assertCurrent();
      let frame: Buffer;
      try {
        frame = nativePipeFrame(message);
      } catch (error) {
        if (!cdpMethod) throw error;
        this.options.onOversizedEvent?.(cdpMethod);
        return;
      }
      if (
        this.#client.writableLength + frame.length >
        4 * MAX_NATIVE_PIPE_FRAME_BYTES
      )
        throw new Error("Browser native pipe consumer is too slow");
      this.#client.write(frame);
    } catch {
      void this.dispose();
    }
  }

  #accept(socket: Socket): void {
    if (this.#disposed || this.#used || this.#sockets.size >= 4) {
      socket.destroy();
      return;
    }
    this.#sockets.add(socket);
    const frames = new NativePipeFrames(4096);
    const timer = setTimeout(() => socket.destroy(), 3000);
    timer.unref();
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      clearTimeout(timer);
      this.#sockets.delete(socket);
      if (this.#client === socket) void this.dispose();
    });
    socket.on("data", (chunk: Buffer) => {
      try {
        for (const message of frames.read(chunk)) {
          this.options.assertCurrent();
          const params = message.params as Record<string, unknown> | null;
          const candidate =
            typeof params?.token === "string"
              ? Buffer.from(params.token)
              : Buffer.alloc(0);
          const expected = Buffer.from(this.#token);
          if (
            this.#used ||
            message.method !== "authorize" ||
            message.id !== 1 ||
            candidate.length !== expected.length ||
            !timingSafeEqual(candidate, expected)
          ) {
            socket.destroy();
            return;
          }
          this.#used = true;
          this.#client = socket;
          clearTimeout(timer);
          if (this.#connectTimer) clearTimeout(this.#connectTimer);
          this.#connectTimer = null;
          socket.write(
            nativePipeFrame({
              jsonrpc: "2.0",
              id: 1,
              result: { protocolVersion: NATIVE_PIPE_PROTOCOL_VERSION },
            }),
          );
          for (const peer of this.#sockets) if (peer !== socket) peer.destroy();
        }
      } catch {
        socket.destroy();
      }
    });
  }

  dispose(): Promise<void> {
    if (this.#cleanup) return this.#cleanup;
    this.#disposed = true;
    if (this.#connectTimer) clearTimeout(this.#connectTimer);
    this.#connectTimer = null;
    this.#cleanup = (async () => {
      const client = this.#client;
      const closed =
        client && !client.destroyed
          ? new Promise<void>((resolve) => {
              const timer = setTimeout(() => client.destroy(), 1000);
              timer.unref();
              client.once("close", () => {
                clearTimeout(timer);
                resolve();
              });
              client.end(
                nativePipeFrame({
                  jsonrpc: "2.0",
                  method: "onCDPDetach",
                  params: { tabId: this.options.tabId },
                }),
              );
            })
          : Promise.resolve();
      for (const socket of this.#sockets)
        if (socket !== client) socket.destroy();
      await closed;
      this.#sockets.clear();
      this.#client = null;
      await new Promise<void>((resolve) => this.#server.close(() => resolve()));
      if (this.#directory)
        await rm(this.#directory, { recursive: true, force: true });
    })();
    // Socket callbacks cannot leave a rejected cleanup promise unobserved.
    void this.#cleanup.catch(() => undefined);
    this.options.onDisconnected();
    return this.#cleanup;
  }
}
