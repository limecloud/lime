import { afterEach, expect, it, vi } from "vitest";
import net from "node:net";
import os from "node:os";
import { access, stat } from "node:fs/promises";
import { BrowserNativePipe } from "./browserNativePipe";
import { connect } from "./browserNativePipeClient";
import {
  MAX_NATIVE_PIPE_FRAME_BYTES,
  NativePipeFrames,
  nativePipeFrame,
  type CdpEvent,
} from "./browserNativePipeProtocol";

const pipes = new Set<BrowserNativePipe>();
const clients = new Set<Awaited<ReturnType<typeof connect>>>();
const event: CdpEvent = {
  source: { tabId: "tab-1" },
  method: "Runtime.consoleAPICalled",
  params: { type: "log", args: [{ value: "真实事件 🟢" }] },
};
async function listen(
  overrides: Partial<Parameters<typeof BrowserNativePipe.listen>[0]> = {},
) {
  const options = {
    tabId: "tab-1",
    tempDirectory: os.tmpdir(),
    assertCurrent: vi.fn(),
    onDisconnected: vi.fn(),
    ...overrides,
  };
  const pipe = await BrowserNativePipe.listen(options);
  pipes.add(pipe);
  return { pipe, options };
}
async function client(pipe: BrowserNativePipe) {
  const value = await connect(pipe.connection);
  clients.add(value);
  return value;
}
afterEach(async () => {
  await Promise.all([...clients].map((client) => client.dispose()));
  await Promise.all([...pipes].map((pipe) => pipe.dispose()));
  clients.clear();
  pipes.clear();
});

it("decodes fragmented UTF-8 and multiple complete JSON-RPC notifications without polling", () => {
  const frame = nativePipeFrame({
    jsonrpc: "2.0",
    method: "onCDPEvent",
    params: event,
  });
  const frames = new NativePipeFrames();
  const messages = [];
  for (const byte of Buffer.concat([frame, frame]))
    messages.push(...frames.read(Buffer.from([byte])));
  expect(messages).toEqual([
    { jsonrpc: "2.0", method: "onCDPEvent", params: event },
    { jsonrpc: "2.0", method: "onCDPEvent", params: event },
  ]);
});

it("rejects oversized incoming frames before buffering their bodies", () => {
  const frames = new NativePipeFrames(10);
  frames.read(Buffer.from("12345"));
  expect(() => frames.read(Buffer.from("678901"))).toThrow("size limit");
});

it("delivers native-shaped events only after a valid one-use handshake", async () => {
  const { pipe } = await listen();
  const peer = await client(pipe);
  const received = vi.fn();
  const remove = peer.addCdpEventListener(received);
  pipe.sendCdpEvent(event);
  await vi.waitFor(() =>
    expect(received).toHaveBeenCalledExactlyOnceWith(event),
  );
  remove();
  pipe.sendCdpEvent(event);
  await new Promise((resolve) => setImmediate(resolve));
  expect(received).toHaveBeenCalledOnce();
});

it("rejects a token from a different subscription and preserves the authorized subscriber", async () => {
  const { pipe } = await listen();
  const other = await listen({ tabId: "tab-2" });
  await expect(
    connect({ ...pipe.connection, token: other.pipe.connection.token }),
  ).rejects.toThrow();
  const peer = await client(pipe);
  const received = vi.fn();
  peer.addCdpEventListener(received);
  pipe.sendCdpEvent(event);
  await vi.waitFor(() => expect(received).toHaveBeenCalledOnce());
});

it("cannot replay the capability or create a second authenticated consumer", async () => {
  const { pipe } = await listen();
  const connection = pipe.connection;
  await client(pipe);
  await expect(connect(connection)).rejects.toThrow();
});

it("sends no content to a peer which has not authorized", async () => {
  const { pipe } = await listen();
  const socket = net.createConnection(pipe.connection.pipePath);
  await new Promise<void>((resolve) => socket.once("connect", resolve));
  const received = vi.fn();
  socket.on("data", received);
  pipe.sendCdpEvent(event);
  await new Promise((resolve) => setImmediate(resolve));
  socket.destroy();
  expect(received).not.toHaveBeenCalled();
});

it("revokes on policy failure before serializing the next event and emits only terminal detach", async () => {
  let current = true;
  const { pipe, options } = await listen({
    assertCurrent: () => {
      if (!current) throw new Error("revoked");
    },
  });
  const peer = await client(pipe);
  const received = vi.fn();
  const detached = vi.fn();
  peer.addCdpEventListener(received);
  peer.addCdpDetachListener(detached);
  current = false;
  pipe.sendCdpEvent(event);
  await peer.closed;
  expect(received).not.toHaveBeenCalled();
  expect(detached).toHaveBeenCalledExactlyOnceWith({ tabId: "tab-1" });
  expect(options.onDisconnected).toHaveBeenCalledOnce();
});

it("rejects a source from another tab without exposing its content", async () => {
  const { pipe } = await listen();
  const peer = await client(pipe);
  const received = vi.fn();
  peer.addCdpEventListener(received);
  pipe.sendCdpEvent({ ...event, source: { tabId: "tab-2" } });
  await peer.closed;
  expect(received).not.toHaveBeenCalled();
});

it("skips an oversized native event while continuing with later valid events", async () => {
  const onOversizedEvent = vi.fn();
  const { pipe } = await listen({ onOversizedEvent });
  const peer = await client(pipe);
  const received = vi.fn();
  peer.addCdpEventListener(received);
  pipe.sendCdpEvent({
    ...event,
    params: { text: "x".repeat(MAX_NATIVE_PIPE_FRAME_BYTES) },
  });
  pipe.sendCdpEvent(event);
  await vi.waitFor(() =>
    expect(received).toHaveBeenCalledExactlyOnceWith(event),
  );
  expect(onOversizedEvent).toHaveBeenCalledExactlyOnceWith(event.method);
});

it("closes and removes the private endpoint when the subscriber disconnects", async () => {
  const { pipe, options } = await listen();
  const endpoint = pipe.connection.pipePath;
  if (process.platform !== "win32")
    expect((await stat(endpoint)).mode & 0o777).toBe(0o600);
  const peer = await client(pipe);
  await peer.dispose();
  await pipe.dispose();
  expect(() => pipe.connection).toThrow("no longer active");
  expect(options.onDisconnected).toHaveBeenCalledOnce();
  if (process.platform !== "win32")
    await expect(access(endpoint)).rejects.toThrow();
});
import { Buffer } from "node:buffer";
import process from "node:process";
import { setImmediate } from "node:timers";
