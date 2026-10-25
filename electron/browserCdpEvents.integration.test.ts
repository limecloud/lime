import { setImmediate } from "node:timers";
import { afterEach, expect, it, vi } from "vitest";
import os from "node:os";
import type { WebContents } from "electron";
import { BrowserCdpSessions } from "./browserCdpSessions";
import { BrowserCdpEvents } from "./browserCdpEvents";
import { connect } from "./browserNativePipeClient";
import { createHarness, mount } from "./browserTabHost.testHarness";

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.useRealTimers();
});
async function setup() {
  const h = createHarness();
  const state = (await mount(h)) as { viewId: string };
  const native = h.views.get(state.viewId)!
    .webContents as unknown as WebContents;
  const sessions = new BrowserCdpSessions();
  await sessions.attachDebugger("tab-1", native, vi.fn(), vi.fn());
  const events = new BrowserCdpEvents();
  cleanup.push(() => sessions.unregisterDebuggerListener("tab-1"));
  const options = {
    tabId: "tab-1",
    tempDirectory: os.tmpdir(),
    sessions,
    assertCurrent: vi.fn(),
    allows: (url: string) => url.startsWith("https://example.com/"),
    readFrameTree: vi.fn(async () => ({
      frameTree: { frame: { id: "root", url: "https://example.com/" } },
    })),
    sourceUrl: vi.fn(async () => "https://example.com/" as string | null),
    onDisconnected: vi.fn(),
  };
  const emit = (
    method: string,
    params: Record<string, unknown>,
    sessionId?: string,
  ) => native.debugger.emit("message", {}, method, params, sessionId);
  return { sessions, events, native, options, emit };
}
async function subscriber(h: Awaited<ReturnType<typeof setup>>) {
  const connection = await h.events.subscribe(h.options);
  const peer = await connect(connection);
  cleanup.push(() => peer.dispose());
  const received = vi.fn();
  const detached = vi.fn();
  peer.addCdpEventListener(received);
  peer.addCdpDetachListener(detached);
  return { peer, received, detached, connection };
}

it("streams native messages into a real Node client and stops at native detach", async () => {
  const h = await setup();
  const s = await subscriber(h);
  h.emit("Runtime.executionContextCreated", {
    context: {
      id: 1,
      origin: "https://example.com",
      auxData: { frameId: "root" },
    },
  });
  h.emit("Runtime.consoleAPICalled", {
    executionContextId: 1,
    args: [{ value: "same native tab" }],
  });
  await vi.waitFor(() => expect(s.received).toHaveBeenCalledTimes(2));
  expect(s.received.mock.calls[1][0]).toMatchObject({
    source: { tabId: "tab-1" },
    method: "Runtime.consoleAPICalled",
  });
  h.sessions.unregisterDebuggerListener("tab-1");
  await s.peer.closed;
  expect(s.detached).toHaveBeenCalledExactlyOnceWith({ tabId: "tab-1" });
  h.emit("Runtime.consoleAPICalled", {
    executionContextId: 1,
    args: [{ value: "late" }],
  });
  expect(s.received).toHaveBeenCalledTimes(2);
});

it("streams only WebSocket lifecycle events tied to the current native target origin", async () => {
  const h = await setup();
  const s = await subscriber(h);
  h.emit("Network.webSocketCreated", {
    requestId: "socket-1",
    url: "wss://example.com/socket",
  });
  await vi.waitFor(() => expect(s.received).toHaveBeenCalledOnce());
  expect(s.received.mock.calls[0][0].method).toBe("Network.webSocketCreated");

  h.options.sourceUrl.mockResolvedValueOnce("https://example.com/route");
  h.emit("Network.webSocketFrameReceived", {
    requestId: "socket-1",
    response: { opcode: 1, payloadData: "allowed" },
  });
  await vi.waitFor(() => expect(s.received).toHaveBeenCalledTimes(2));

  h.options.sourceUrl.mockResolvedValueOnce("https://denied.test/");
  h.emit("Network.webSocketFrameReceived", {
    requestId: "socket-1",
    response: { opcode: 1, payloadData: "private" },
  });
  h.emit("Page.loadEventFired", { timestamp: 1 });
  await vi.waitFor(() => expect(s.received).toHaveBeenCalledTimes(3));
  expect(s.received.mock.calls[2][0].method).toBe("Page.loadEventFired");
});

it("rejects concurrent subscriptions and unknown native session sources", async () => {
  const h = await setup();
  const s = await subscriber(h);
  await expect(h.events.subscribe(h.options)).rejects.toThrow("already has");
  h.emit("Page.loadEventFired", { timestamp: 1 }, "unknown-session");
  h.emit("Page.loadEventFired", { timestamp: 2 });
  await vi.waitFor(() => expect(s.received).toHaveBeenCalledOnce());
  expect(s.received.mock.calls[0][0].params.timestamp).toBe(2);
});

it("checks policy again after asynchronous native origin reads", async () => {
  const h = await setup();
  const s = await subscriber(h);
  let finish!: (url: string) => void;
  h.options.sourceUrl.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  h.emit("Page.loadEventFired", { timestamp: 1 });
  await vi.waitFor(() => expect(h.options.sourceUrl).toHaveBeenCalledOnce());
  h.options.assertCurrent.mockImplementation(() => {
    throw new Error("policy revoked");
  });
  finish("https://example.com/");
  await s.peer.closed;
  expect(s.received).not.toHaveBeenCalled();
});

it("cancels startup on detach and does not reserve the tab for a late native response", async () => {
  const h = await setup();
  let finish!: (
    value: Awaited<ReturnType<typeof h.options.readFrameTree>>,
  ) => void;
  const tree = await h.options.readFrameTree();
  h.options.readFrameTree.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = h.events.subscribe(h.options);
  const rejected = expect(pending).rejects.toThrow("no longer active");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  h.sessions.unregisterDebuggerListener("tab-1");
  await rejected;
  await h.sessions.attachDebugger("tab-1", h.native, vi.fn(), vi.fn());
  const replacement = await subscriber(h);
  finish(tree);
  h.emit("Page.loadEventFired", { timestamp: 2 });
  await vi.waitFor(() => expect(replacement.received).toHaveBeenCalledOnce());
  expect(replacement.detached).not.toHaveBeenCalled();
});

it("bounded event queues revoke a stalled subscription rather than accumulating content", async () => {
  const h = await setup();
  const s = await subscriber(h);
  let finish!: (url: string) => void;
  h.options.sourceUrl.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  h.emit("Page.loadEventFired", { timestamp: 0 });
  await vi.waitFor(() => expect(h.options.sourceUrl).toHaveBeenCalledOnce());
  for (let i = 0; i < 130; i++) h.emit("Page.loadEventFired", { timestamp: i });
  await s.peer.closed;
  finish("https://example.com/");
  await new Promise((resolve) => setImmediate(resolve));
  expect(s.received).not.toHaveBeenCalled();
  expect(h.options.onDisconnected).toHaveBeenCalledOnce();
});

it("bounds a hung native startup and releases its tab reservation", async () => {
  const h = await setup();
  vi.useFakeTimers();
  h.options.readFrameTree.mockImplementationOnce(() => new Promise(() => {}));
  const pending = h.events.subscribe(h.options);
  const rejected = expect(pending).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(10_000);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  await subscriber(h);
});

it("distinguishes owner revocation from an external consumer disconnect", async () => {
  const h = await setup();
  const first = await subscriber(h);
  h.events.revoke("tab-1");
  await first.peer.closed;
  expect(h.options.onDisconnected).not.toHaveBeenCalled();
  const second = await subscriber(h);
  await second.peer.dispose();
  await vi.waitFor(() =>
    expect(h.options.onDisconnected).toHaveBeenCalledOnce(),
  );
});
