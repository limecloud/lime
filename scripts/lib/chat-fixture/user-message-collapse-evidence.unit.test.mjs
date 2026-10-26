import { describe, expect, it } from "vitest";
import { request as currentRequest } from "../../../packages/app-server-client/src/protocol.ts";
import { parseJsonRpcRequestsFromInvokeTrace } from "../../electron/lib/mcp-config-fixture-evidence.mjs";
import {
  captureCollapseTraceBoundary,
  summarizeCollapseInputBoundary,
} from "./user-message-collapse-evidence.mjs";

function traceEntry(method = "thread/read", params = {}) {
  return {
    timestamp: "2026-10-14T00:00:00.000Z",
    command: "app_server_handle_json_lines",
    transport: "electron-ipc",
    status: "success",
    duration_ms: 1,
    args_preview: {
      request: {
        lines: [
          JSON.stringify({
            jsonrpc: "2.0",
            id: "fixture-read",
            method,
            params,
          }),
        ],
      },
    },
  };
}

function boundary(entries) {
  return captureCollapseTraceBoundary(
    JSON.stringify(entries),
    parseJsonRpcRequestsFromInvokeTrace,
  );
}

describe("complete UserMessage input trace window", () => {
  function entryFor(request) {
    const entry = traceEntry();
    entry.args_preview.request.lines = [JSON.stringify(request)];
    return entry;
  }

  it("accepts the current sender's request with no jsonrpc version field", () => {
    const request = currentRequest(1, "turn/start", {
      threadId: "thread-current",
      clientUserMessageId: "client-current",
      input: [],
    });
    expect(Object.hasOwn(request, "jsonrpc")).toBe(false);
    const observed = boundary([entryFor(request)]);
    expect(observed.complete).toBe(true);
    expect(observed.inputs).toMatchObject([
      {
        method: "turn/start",
        id: 1,
        threadId: "thread-current",
        clientId: "client-current",
      },
    ]);
  });

  it.each([0, -1, 42, "fixture-read"])(
    "accepts valid current request id %s",
    (id) => {
      expect(
        boundary([entryFor(currentRequest(id, "thread/read"))]).complete,
      ).toBe(true);
    },
  );

  it("continues to accept an explicit 2.0 version", () => {
    expect(boundary([traceEntry()]).complete).toBe(true);
  });

  it.each([null, true, false, 2, "1.0", "2", "", {}, []])(
    "rejects an incorrect explicit version %j",
    (jsonrpc) => {
      expect(
        boundary([entryFor({ id: 1, method: "thread/read", jsonrpc })])
          .complete,
      ).toBe(false);
    },
  );

  it.each([
    null,
    true,
    false,
    0,
    1,
    "request",
    [],
    [{ id: 1, method: "thread/read" }],
  ])("rejects non-object request envelope %j", (request) => {
    expect(boundary([entryFor(request)]).complete).toBe(false);
  });

  it.each([null, true, false, 1.5, "", {}, [], Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid request id %j",
    (id) => {
      expect(boundary([entryFor({ id, method: "thread/read" })]).complete).toBe(
        false,
      );
    },
  );

  it("rejects a request with a missing id", () => {
    expect(boundary([entryFor({ method: "thread/read" })]).complete).toBe(
      false,
    );
  });

  it.each([null, true, 1, "", " \t\n", {}, []])(
    "rejects invalid method %j",
    (method) => {
      expect(boundary([entryFor({ id: 1, method })]).complete).toBe(false);
    },
  );

  it("rejects a request with a missing method", () => {
    expect(boundary([entryFor({ id: 1 })]).complete).toBe(false);
  });

  it.each([null, [], {}, "request", [null], [1], [""], [" "]])(
    "rejects invalid request lines %j",
    (lines) => {
      const entry = traceEntry();
      entry.args_preview.request.lines = lines;
      expect(boundary([entry]).complete).toBe(false);
    },
  );

  it("rejects parser projections with missing fields, even with the correct count", () => {
    const raw = JSON.stringify([traceEntry()]);
    expect(captureCollapseTraceBoundary(raw, () => [{}]).complete).toBe(false);
    expect(
      captureCollapseTraceBoundary(raw, (value) =>
        parseJsonRpcRequestsFromInvokeTrace(value).map((request) => ({
          ...request,
          id: "wrong-id",
        })),
      ).complete,
    ).toBe(false);
  });

  it.each([null, "broken", "{}", "[]"])("fails closed for %s", (raw) => {
    expect(
      captureCollapseTraceBoundary(raw, parseJsonRpcRequestsFromInvokeTrace)
        .complete,
    ).toBe(false);
  });
  it("fails closed when the ring is saturated", () => {
    expect(
      boundary(Array.from({ length: 240 }, () => traceEntry())).complete,
    ).toBe(false);
  });
  it("rejects truncated or missing current request lines", () => {
    const entry = traceEntry();
    entry.args_preview.request.lines = ["{truncated"];
    expect(boundary([entry]).complete).toBe(false);
    delete entry.args_preview;
    expect(boundary([entry]).complete).toBe(false);
  });
  it("rejects partial transport parsing", () => {
    expect(
      captureCollapseTraceBoundary(JSON.stringify([traceEntry()]), () => [])
        .complete,
    ).toBe(false);
  });
  it("allows readonly queue/list without treating it as a submission", () => {
    const before = boundary([traceEntry()]);
    const after = boundary([traceEntry(), traceEntry("thread/queue/list")]);
    expect(
      summarizeCollapseInputBoundary({
        traceBefore: before,
        traceAfter: after,
      }),
    ).toEqual({
      completeInputBoundary: true,
      noAdditionalInput: true,
      acceptedSubmissionBoundary: true,
    });
  });
});
