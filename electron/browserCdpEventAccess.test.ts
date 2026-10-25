import { expect, it } from "vitest";
import { BrowserCdpEventAccess } from "./browserCdpEventAccess";
import type { CdpEvent } from "./browserNativePipeProtocol";

const event = (
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string,
): CdpEvent => ({
  source: { tabId: "tab-1", ...(sessionId ? { sessionId } : {}) },
  method,
  params,
});
function access() {
  const value = new BrowserCdpEventAccess((url) => {
    try {
      return new URL(url).origin === "https://allowed.test";
    } catch {
      return false;
    }
  });
  value.readFrameTree({
    frameTree: {
      frame: { id: "root", url: "https://allowed.test/" },
      childFrames: [{ frame: { id: "child", url: "https://denied.test/" } }],
    },
  });
  return value;
}
const context = (
  id: number,
  frameId: string,
  origin = "https://allowed.test",
  sessionId?: string,
) =>
  event(
    "Runtime.executionContextCreated",
    { context: { id, origin, auxData: { frameId } } },
    sessionId,
  );

it("delivers only native contexts joined to an allowed current frame", () => {
  const a = access();
  expect(a.accepts(context(1, "root"))).toBe(true);
  expect(
    a.accepts(event("Runtime.consoleAPICalled", { executionContextId: 1 })),
  ).toBe(true);
  expect(a.accepts(context(2, "child", "https://denied.test"))).toBe(false);
  expect(
    a.accepts(event("Runtime.consoleAPICalled", { executionContextId: 2 })),
  ).toBe(false);
  expect(a.accepts(context(3, "unknown"))).toBe(false);
});

it("does not remember a rejected context even when its frame ID was previously allowed", () => {
  const a = access();
  expect(a.accepts(context(1, "root", "https://denied.test"))).toBe(false);
  expect(
    a.accepts(event("Runtime.consoleAPICalled", { executionContextId: 1 })),
  ).toBe(false);
});

it("does not reuse context IDs across debugger sessions", () => {
  const a = access();
  expect(a.accepts(context(1, "root", undefined, "session-1"))).toBe(true);
  expect(
    a.accepts(
      event("Runtime.consoleAPICalled", { executionContextId: 1 }, "session-2"),
    ),
  ).toBe(false);
});

it("rechecks frame URLs and context destruction before later content", () => {
  const a = access();
  a.accepts(context(1, "root"));
  a.accepts(
    event("Runtime.executionContextDestroyed", { executionContextId: 1 }),
  );
  expect(
    a.accepts(event("Runtime.consoleAPICalled", { executionContextId: 1 })),
  ).toBe(false);
  a.accepts(context(2, "root"));
  a.readFrameTree({
    frameTree: { frame: { id: "root", url: "https://denied.test/" } },
  });
  expect(
    a.accepts(event("Runtime.consoleAPICalled", { executionContextId: 2 })),
  ).toBe(false);
});

it.each([
  {
    request: {
      url: "https://denied.test/request",
      headers: { authorization: "secret" },
    },
  },
  { response: { url: "https://denied.test/response" } },
  { nested: [{ url: "blob:https://denied.test/image" }] },
  { url: "wss://denied.test/socket" },
])(
  "suppresses an event containing a URL outside the approved origins: %j",
  (params) => {
    expect(access().accepts(event("Network.requestWillBeSent", params))).toBe(
      false,
    );
  },
);

it("permits allowed network URLs but rejects unknown frame attribution", () => {
  const a = access();
  expect(
    a.accepts(
      event("Network.requestWillBeSent", {
        requestId: "request-1",
        frameId: "root",
        request: { url: "https://allowed.test/data" },
      }),
    ),
  ).toBe(true);
  expect(
    a.accepts(
      event("Network.requestWillBeSent", {
        requestId: "request-2",
        frameId: "unknown",
        request: { url: "https://allowed.test/data" },
      }),
    ),
  ).toBe(false);
});

it("rejects unattributed content and domains without an explicit event contract", () => {
  const a = access();
  for (const method of [
    "Runtime.consoleAPICalled",
    "Runtime.exceptionThrown",
    "DOM.setChildNodes",
    "Unknown.content",
  ]) {
    expect(a.accepts(event(method, { value: "private content" }))).toBe(false);
  }
  expect(
    a.accepts(event("Log.entryAdded", { entry: { text: "private" } })),
  ).toBe(false);
});

it("does not expose a denied frame's dialog result or unattributed script log", () => {
  const a = access();
  expect(
    a.accepts(event("Page.javascriptDialogClosed", { userInput: "private" })),
  ).toBe(false);
  expect(
    a.accepts(
      event("Page.javascriptDialogOpening", { url: "https://denied.test/" }),
    ),
  ).toBe(false);
  expect(
    a.accepts(event("Page.javascriptDialogClosed", { userInput: "private" })),
  ).toBe(false);
  expect(
    a.accepts(
      event("Page.javascriptDialogOpening", { url: "https://allowed.test/" }),
    ),
  ).toBe(true);
  expect(
    a.accepts(event("Page.javascriptDialogClosed", { userInput: "allowed" })),
  ).toBe(true);
  expect(
    a.accepts(event("Page.javascriptDialogClosed", { userInput: "late" })),
  ).toBe(false);
  expect(
    a.accepts(
      event("Log.entryAdded", {
        entry: {
          url: "https://allowed.test/shared-script.js",
          text: "private iframe",
        },
      }),
    ),
  ).toBe(false);
});

it("correlates the full WebSocket lifecycle with its native frame and session", () => {
  const a = access();
  const created = event(
    "Network.webSocketCreated",
    {
      requestId: "socket-1",
      url: "wss://allowed.test/socket",
      frameId: "root",
    },
    "session-1",
  );
  expect(a.accepts(created, "https://allowed.test/")).toBe(true);
  expect(
    a.accepts(
      event(
        "Network.webSocketFrameReceived",
        {
          requestId: "socket-1",
          response: { opcode: 1, payloadData: "hello" },
        },
        "session-1",
      ),
      "https://allowed.test/",
    ),
  ).toBe(true);
  expect(
    a.accepts(
      event(
        "Network.webSocketFrameError",
        { requestId: "socket-1" },
        "session-2",
      ),
      "https://allowed.test/",
    ),
  ).toBe(false);
  expect(
    a.accepts(
      event("Network.webSocketClosed", { requestId: "socket-1" }, "session-1"),
      "https://allowed.test/",
    ),
  ).toBe(true);
  expect(
    a.accepts(
      event("Network.webSocketFrameReceived", {
        requestId: "socket-1",
        response: { opcode: 1, payloadData: "late" },
      }),
      "https://allowed.test/",
    ),
  ).toBe(false);
});

it("uses the current native target URL when a WebSocket event has no frameId", () => {
  const a = access();
  expect(
    a.accepts(
      event("Network.webSocketCreated", {
        requestId: "socket-initiator",
        url: "wss://allowed.test/socket",
      }),
      "https://allowed.test/",
    ),
  ).toBe(true);
  expect(
    a.accepts(
      event("Network.webSocketHandshakeResponseReceived", {
        requestId: "socket-initiator",
        response: { status: 101 },
      }),
      "https://allowed.test/",
    ),
  ).toBe(true);
  expect(
    a.accepts(
      event("Network.webSocketFrameReceived", {
        requestId: "socket-initiator",
        response: { opcode: 1, payloadData: "same origin" },
      }),
      "https://allowed.test/route",
    ),
  ).toBe(true);
  expect(
    a.accepts(
      event("Network.webSocketFrameReceived", {
        requestId: "socket-initiator",
        response: { opcode: 1, payloadData: "late" },
      }),
      "https://other.test/",
    ),
  ).toBe(false);
});

it("rejects WebSockets without an allowed target or destination", () => {
  const a = access();
  expect(
    a.accepts(
      event("Network.webSocketCreated", {
        requestId: "socket-no-source",
        url: "wss://allowed.test/socket",
      }),
    ),
  ).toBe(false);
  expect(
    a.accepts(
      event("Network.webSocketCreated", {
        requestId: "socket-denied-destination",
        url: "wss://denied.test/socket",
      }),
      "https://allowed.test/",
    ),
  ).toBe(false);
});

it("revokes WebSocket events when the frame navigates to a denied origin", () => {
  const a = access();
  expect(
    a.accepts(
      event("Network.webSocketCreated", {
        requestId: "socket-navigation",
        url: "wss://allowed.test/socket",
        frameId: "root",
      }),
      "https://allowed.test/",
    ),
  ).toBe(true);
  a.readFrameTree({
    frameTree: { frame: { id: "root", url: "https://denied.test/" } },
  });
  expect(
    a.accepts(
      event("Network.webSocketFrameSent", {
        requestId: "socket-navigation",
        response: { opcode: 1, payloadData: "private" },
      }),
      "https://allowed.test/",
    ),
  ).toBe(false);
});

it("correlates URL-less network payloads with a permitted request in the same native session", () => {
  const a = access();
  const request = event(
    "Network.requestWillBeSent",
    {
      requestId: "request-1",
      frameId: "root",
      request: { url: "https://allowed.test/data" },
    },
    "session-1",
  );
  const headers = (sessionId = "session-1") =>
    event(
      "Network.responseReceivedExtraInfo",
      {
        requestId: "request-1",
        headers: { authorization: "private" },
      },
      sessionId,
    );
  expect(a.accepts(headers())).toBe(false);
  expect(a.accepts(request)).toBe(true);
  expect(a.accepts(headers())).toBe(true);
  expect(a.accepts(headers("session-2"))).toBe(false);
  a.readFrameTree({
    frameTree: { frame: { id: "root", url: "https://denied.test/" } },
  });
  expect(a.accepts(headers())).toBe(false);
});

it("revokes a request after a denied redirect without accepting later URL-less events", () => {
  const a = access();
  const request = (url: string) =>
    event("Network.requestWillBeSent", {
      requestId: "request-1",
      frameId: "root",
      request: { url },
    });
  expect(a.accepts(request("https://allowed.test/start"))).toBe(true);
  expect(a.accepts(request("https://denied.test/redirect"))).toBe(false);
  expect(
    a.accepts(
      event("Network.dataReceived", {
        requestId: "request-1",
        data: "private",
      }),
    ),
  ).toBe(false);
  expect(a.accepts(request("https://allowed.test/return"))).toBe(false);
});
