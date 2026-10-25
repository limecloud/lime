import { Buffer } from "node:buffer";
import net from "node:net";
import {
  NATIVE_PIPE_PROTOCOL_VERSION,
  NativePipeFrames,
  nativePipeFrame,
  type CdpEvent,
  type NativePipeConnection,
} from "./browserNativePipeProtocol";

export async function connect(
  connection: NativePipeConnection,
  listeners: {
    onCDPEvent?: (event: CdpEvent) => void;
    onCDPDetach?: (event: { tabId: string }) => void;
  } = {},
) {
  if (connection.protocolVersion !== NATIVE_PIPE_PROTOCOL_VERSION)
    throw new Error("Unsupported Browser native pipe protocol");
  const socket = net.createConnection(connection.pipePath);
  const frames = new NativePipeFrames();
  const events = new Set<(event: CdpEvent) => void>();
  const detaches = new Set<(event: { tabId: string }) => void>();
  if (listeners.onCDPEvent) events.add(listeners.onCDPEvent);
  if (listeners.onCDPDetach) detaches.add(listeners.onCDPDetach);
  let authorized = false;
  let disconnected = false;
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const ready = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const closed = new Promise<void>((yes) => socket.once("close", () => yes()));
  const timer = setTimeout(
    () =>
      socket.destroy(new Error("Browser native pipe authorization timed out")),
    5000,
  );
  timer.unref();
  socket.on("error", reject);
  socket.on("close", () => {
    clearTimeout(timer);
    disconnected = true;
    if (!authorized)
      reject(new Error("Browser native pipe closed before authorization"));
    events.clear();
    detaches.clear();
  });
  socket.on("connect", () =>
    socket.write(
      nativePipeFrame({
        jsonrpc: "2.0",
        id: 1,
        method: "authorize",
        params: { token: connection.token },
      }),
    ),
  );
  socket.on("data", (chunk: Buffer) => {
    try {
      for (const message of frames.read(chunk)) {
        if (!authorized) {
          if (
            message.id !== 1 ||
            (message.result as { protocolVersion?: unknown } | null)
              ?.protocolVersion !== NATIVE_PIPE_PROTOCOL_VERSION
          )
            throw new Error(
              "Invalid Browser native pipe authorization response",
            );
          authorized = true;
          clearTimeout(timer);
          resolve();
          continue;
        }
        if (message.method === "onCDPEvent")
          for (const listener of events) listener(message.params as CdpEvent);
        else if (message.method === "onCDPDetach")
          for (const listener of detaches)
            listener(message.params as { tabId: string });
        else throw new Error("Unknown Browser native pipe notification");
      }
    } catch (error) {
      socket.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  });
  await ready;
  return {
    closed,
    addCdpEventListener(listener: (event: CdpEvent) => void) {
      if (disconnected) throw new Error("Browser native pipe is disconnected");
      events.add(listener);
      return () => {
        events.delete(listener);
      };
    },
    addCdpDetachListener(listener: (event: { tabId: string }) => void) {
      if (disconnected) throw new Error("Browser native pipe is disconnected");
      detaches.add(listener);
      return () => {
        detaches.delete(listener);
      };
    },
    dispose() {
      socket.destroy();
      return closed;
    },
  };
}
