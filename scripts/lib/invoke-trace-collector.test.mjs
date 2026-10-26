import fs from "node:fs";
import { webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INVOKE_TRACE_COLLECTOR_KEY as KEY,
  INVOKE_TRACE_COLLECTOR_LIMIT as LIMIT,
  captureInvokeTraceCollector,
  installInvokeTraceCollector,
  installInvokeTraceCollectorDom,
  stopInvokeTraceCollector,
  validateInvokeTraceCollectorCapture,
  withInvokeTraceCollector,
} from "./invoke-trace-collector.mjs";
import { parseJsonRpcRequestsFromInvokeTrace } from "../electron/lib/mcp-config-fixture-evidence.mjs";
import {
  captureCollapseTraceBoundary,
  captureContinuousTraceBoundary,
  summarizeCollapseInputBoundary,
} from "./chat-fixture/user-message-collapse-evidence.mjs";

const page = { evaluate: async (callback, argument) => callback(argument) };
let originalDescriptors;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  originalDescriptors = Object.fromEntries(
    ["setItem", "removeItem", "clear", "getItem"].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(Storage.prototype, name),
    ]),
  );
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("TextEncoder", TextEncoder);
});
afterEach(async () => {
  try {
    await window.__limeInvokeTraceCollector?.stop?.();
  } finally {
    for (const [name, descriptor] of Object.entries(originalDescriptors))
      Object.defineProperty(Storage.prototype, name, descriptor);
    delete window.__limeInvokeTraceCollector;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  }
});

function entry(index, method) {
  return {
    timestamp: new Date(1_800_000_000_000 + index).toISOString(),
    command: method
      ? "app_server_handle_json_lines"
      : "report_frontend_debug_log",
    transport: "electron-ipc",
    status: "success",
    duration_ms: 1,
    ...(method
      ? {
          args_preview: {
            request: {
              lines: [
                JSON.stringify({
                  id: index,
                  method,
                  params: {
                    threadId: "thread-fixture",
                    clientUserMessageId: "client-fixture",
                    input: [
                      { type: "text", text: "collector private fixture body" },
                    ],
                  },
                }),
              ],
            },
          },
        }
      : {}),
  };
}
function append(value) {
  const old = JSON.parse(localStorage.getItem(KEY) ?? "[]");
  return localStorage.setItem(
    KEY,
    JSON.stringify([...old, value].slice(-LIMIT)),
  );
}
function boundary(capture, handle) {
  return captureContinuousTraceBoundary(
    capture,
    handle,
    parseJsonRpcRequestsFromInvokeTrace,
  );
}
async function observed() {
  const handle = await installInvokeTraceCollector(page);
  append(entry(1, "turn/start"));
  append(entry(2, "thread/read"));
  return { handle, capture: await captureInvokeTraceCollector(page, handle) };
}

describe("continuous trace collector source and interval", () => {
  it("fixes the same key and limit as the current production trace owner", () => {
    const source = fs.readFileSync("src/lib/dev-bridge/safeInvoke.ts", "utf8");
    expect(
      Number(source.match(/const INVOKE_TRACE_BUFFER_LIMIT = (\d+);/)?.[1]),
    ).toBe(LIMIT);
    expect(
      source.match(/const INVOKE_TRACE_BUFFER_KEY = "([^"]+)";/)?.[1],
    ).toBe(KEY);
    expect(LIMIT).toBe(240);
  });

  it("starts an empty append ledger and restores original native methods", async () => {
    const handle = await installInvokeTraceCollector(page);
    const capture = await captureInvokeTraceCollector(page, handle);
    expect(capture.ledgerEntries).toEqual([]);
    expect(validateInvokeTraceCollectorCapture(capture, handle).complete).toBe(
      true,
    );
    expect(boundary(capture, handle).complete).toBe(true);
    const stopped = await stopInvokeTraceCollector(page, handle);
    expect(stopped.nativeRestored).toBe(true);
    expect(validateInvokeTraceCollectorCapture(stopped, handle).complete).toBe(
      true,
    );
    expect(window.__limeInvokeTraceCollector).toBeUndefined();
    for (const name of ["setItem", "removeItem", "clear"])
      expect(Storage.prototype[name]).toBe(originalDescriptors[name].value);
  });

  it("validates more than 240 new appends while retaining the native 240-entry ring", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify(Array.from({ length: LIMIT }, (_, index) => entry(index))),
    );
    const handle = await installInvokeTraceCollector(page);
    append(entry(1_000, "turn/start"));
    for (let index = 1_001; index <= 1_300; index += 1) append(entry(index));
    const baseline = boundary(
      await captureInvokeTraceCollector(page, handle),
      handle,
    );
    append(entry(1_301, "thread/read"));
    const final = boundary(
      await captureInvokeTraceCollector(page, handle),
      handle,
    );
    expect(baseline.provenance.appendCount).toBe(301);
    expect(final.provenance.appendCount).toBe(302);
    expect(final.provenance.currentRingCount).toBe(240);
    expect(final.entryDigests).toHaveLength(302);
    expect(
      summarizeCollapseInputBoundary({
        traceBefore: baseline,
        traceAfter: final,
        expected: {
          requireAcceptedSubmission: true,
          threadId: "thread-fixture",
          clientId: "client-fixture",
        },
      }),
    ).toEqual({
      completeInputBoundary: true,
      noAdditionalInput: true,
      acceptedSubmissionBoundary: true,
    });
    expect(
      captureCollapseTraceBoundary(
        localStorage.getItem(KEY),
        parseJsonRpcRequestsFromInvokeTrace,
      ).complete,
    ).toBe(false);
    expect(JSON.stringify(final)).not.toContain(
      "collector private fixture body",
    );
    expect(final).not.toHaveProperty("ledgerEntries");
    expect(final).not.toHaveProperty("seedEntries");
  });

  it("never promotes accepted input from the initial seed into observed input", async () => {
    localStorage.setItem(KEY, JSON.stringify([entry(1, "turn/start")]));
    const handle = await installInvokeTraceCollector(page);
    append(entry(2, "thread/read"));
    const baseline = boundary(
      await captureInvokeTraceCollector(page, handle),
      handle,
    );
    append(entry(3));
    const final = boundary(
      await captureInvokeTraceCollector(page, handle),
      handle,
    );
    expect(baseline.inputs).toEqual([]);
    expect(
      summarizeCollapseInputBoundary({
        traceBefore: baseline,
        traceAfter: final,
        expected: {
          requireAcceptedSubmission: true,
          threadId: "thread-fixture",
          clientId: "client-fixture",
        },
      }).acceptedSubmissionBoundary,
    ).toBe(false);
  });

  it.each([
    "turn/start",
    "turn/steer",
    "thread/queue/add",
    "thread/queue/update",
    "thread/queue/delete",
    "thread/queue/reorder",
    "thread/queue/start",
  ])("detects new %s after a valid continuous baseline", async (method) => {
    const { handle, capture } = await observed();
    const before = boundary(capture, handle);
    append(entry(3, method));
    const after = boundary(
      await captureInvokeTraceCollector(page, handle),
      handle,
    );
    expect(
      summarizeCollapseInputBoundary({ traceBefore: before, traceAfter: after })
        .noAdditionalInput,
    ).toBe(false);
  });

  it("serializes its browser implementation without Node imports or closed-over helpers", async () => {
    const install = new Function(
      `return (${installInvokeTraceCollectorDom.toString()});`,
    )();
    const handle = install({
      runId: "serialized-fixture",
      startedAt: "2026-10-14T00:00:00.000Z",
    });
    append(entry(1));
    const capture = await captureInvokeTraceCollector(page, handle);
    expect(validateInvokeTraceCollectorCapture(capture, handle).complete).toBe(
      true,
    );
  });
});

describe("continuous trace invalidation", () => {
  it.each([
    ["clear", () => localStorage.clear()],
    ["remove", () => localStorage.removeItem(KEY)],
    ["empty reset", () => localStorage.setItem(KEY, "[]")],
    ["null", () => localStorage.setItem(KEY, "null")],
    ["object", () => localStorage.setItem(KEY, "{}")],
    ["malformed JSON", () => localStorage.setItem(KEY, "broken")],
    [
      "same-value write",
      () => localStorage.setItem(KEY, localStorage.getItem(KEY)),
    ],
    [
      "replace history",
      () => localStorage.setItem(KEY, JSON.stringify([entry(99)])),
    ],
    [
      "batch append",
      () =>
        localStorage.setItem(
          KEY,
          JSON.stringify([
            ...JSON.parse(localStorage.getItem(KEY)),
            entry(3),
            entry(4),
          ]),
        ),
    ],
    [
      "coerced trace key",
      () =>
        localStorage.setItem(
          { toString: () => KEY },
          localStorage.getItem(KEY),
        ),
    ],
  ])("fails closed on %s and still restores hooks", async (_name, mutate) => {
    const { handle } = await observed();
    mutate();
    const capture = await captureInvokeTraceCollector(page, handle);
    expect(capture.invalidations.length).toBeGreaterThan(0);
    expect(boundary(capture, handle).complete).toBe(false);
    expect((await stopInvokeTraceCollector(page, handle)).nativeRestored).toBe(
      true,
    );
  });

  it("detects a write that bypassed the collector before the next capture", async () => {
    const { handle } = await observed();
    const current = JSON.parse(localStorage.getItem(KEY));
    Reflect.apply(originalDescriptors.setItem.value, localStorage, [
      KEY,
      JSON.stringify([...current, entry(3)]),
    ]);
    const capture = await captureInvokeTraceCollector(page, handle);
    expect(boundary(capture, handle).complete).toBe(false);
  });

  it("detects a lost observation before the next intercepted append", async () => {
    const { handle } = await observed();
    const current = JSON.parse(localStorage.getItem(KEY));
    Reflect.apply(originalDescriptors.setItem.value, localStorage, [
      KEY,
      JSON.stringify([...current, entry(3)]),
    ]);
    append(entry(4));
    const capture = await captureInvokeTraceCollector(page, handle);
    expect(
      capture.invalidations.some(
        (failure) => failure.reason === "lost-observation-window",
      ),
    ).toBe(true);
    expect(boundary(capture, handle).complete).toBe(false);
  });

  it("invalidates a replaced hook without overwriting the replacement on stop", async () => {
    const { handle } = await observed();
    const replacement = function setItem() {};
    Storage.prototype.setItem = replacement;
    const capture = await captureInvokeTraceCollector(page, handle);
    expect(boundary(capture, handle).complete).toBe(false);
    const stopped = await stopInvokeTraceCollector(page, handle);
    expect(stopped.nativeRestored).toBe(false);
    expect(Storage.prototype.setItem).toBe(replacement);
    expect(Storage.prototype.removeItem).toBe(
      originalDescriptors.removeItem.value,
    );
  });

  it("rejects a capture from a different installation identity", async () => {
    const { handle } = await observed();
    await expect(
      captureInvokeTraceCollector(page, { ...handle, runId: "other" }),
    ).rejects.toThrow("identity");
    expect(window.__limeInvokeTraceCollector.runId).toBe(handle.runId);
  });

  it("rejects a second collector without replacing the first", async () => {
    const handle = await installInvokeTraceCollector(page);
    await expect(installInvokeTraceCollector(page)).rejects.toThrow(
      "already installed",
    );
    expect(window.__limeInvokeTraceCollector.runId).toBe(handle.runId);
  });

  it("rejects invalid initial rings before any native hook is replaced", async () => {
    localStorage.setItem(KEY, "{}");
    await expect(installInvokeTraceCollector(page)).rejects.toThrow(
      "invalid trace ring",
    );
    expect(Storage.prototype.setItem).toBe(originalDescriptors.setItem.value);
  });
});

describe("native Storage call semantics and cleanup", () => {
  it("preserves non-trace keys, another Storage instance and native undefined returns", async () => {
    const handle = await installInvokeTraceCollector(page);
    expect(localStorage.setItem("other", "value")).toBeUndefined();
    expect(localStorage.getItem("other")).toBe("value");
    expect(localStorage.removeItem("other")).toBeUndefined();
    expect(sessionStorage.setItem(KEY, "separate-storage")).toBeUndefined();
    expect(sessionStorage.getItem(KEY)).toBe("separate-storage");
    expect(sessionStorage.clear()).toBeUndefined();
    expect(
      validateInvokeTraceCollectorCapture(
        await captureInvokeTraceCollector(page, handle),
        handle,
      ).complete,
    ).toBe(true);
  });

  it("preserves the native illegal receiver exception", async () => {
    let nativeError;
    try {
      Reflect.apply(originalDescriptors.setItem.value, {}, [KEY, "[]"]);
    } catch (error) {
      nativeError = error;
    }
    const handle = await installInvokeTraceCollector(page);
    expect(() => Storage.prototype.setItem.call({}, KEY, "[]")).toThrow(
      nativeError.message,
    );
    expect(
      boundary(await captureInvokeTraceCollector(page, handle), handle)
        .complete,
    ).toBe(true);
  });

  it("forwards a native throw unchanged and marks the observation invalid", async () => {
    const failure = new Error("controlled native failure");
    const native = originalDescriptors.setItem.value;
    Storage.prototype.setItem = function setItem(...args) {
      if (this === localStorage) throw failure;
      return Reflect.apply(native, this, args);
    };
    const handle = await installInvokeTraceCollector(page);
    try {
      append(entry(1));
    } catch (error) {
      expect(error).toBe(failure);
    }
    try {
      localStorage.setItem(null, "[]");
    } catch (error) {
      expect(error).toBe(failure);
    }
    const capture = await captureInvokeTraceCollector(page, handle);
    expect(
      capture.invalidations.filter(
        (value) => value.reason === "native-write-threw",
      ),
    ).toHaveLength(2);
    expect(boundary(capture, handle).complete).toBe(false);
    expect((await stopInvokeTraceCollector(page, handle)).nativeRestored).toBe(
      true,
    );
  });

  it("preserves the original return value and exact argument list", async () => {
    const native = originalDescriptors.setItem.value;
    const calls = [];
    Storage.prototype.setItem = function setItem(...args) {
      calls.push({ receiver: this, args });
      Reflect.apply(native, this, args);
      return "controlled original return";
    };
    const handle = await installInvokeTraceCollector(page);
    const value = JSON.stringify([entry(1)]);
    expect(localStorage.setItem(KEY, value, "third-argument")).toBe(
      "controlled original return",
    );
    expect(calls[0]).toEqual({
      receiver: localStorage,
      args: [KEY, value, "third-argument"],
    });
    expect(
      boundary(await captureInvokeTraceCollector(page, handle), handle)
        .complete,
    ).toBe(true);
  });

  it("always releases the observer after a callback failure", async () => {
    const failure = new Error("controlled callback failure");
    await expect(
      withInvokeTraceCollector(page, async () => {
        append(entry(1));
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(window.__limeInvokeTraceCollector).toBeUndefined();
    expect(Storage.prototype.setItem).toBe(originalDescriptors.setItem.value);
  });

  it("does not mask the original failure when provenance also fails", async () => {
    const failure = new Error("controlled primary failure");
    await expect(
      withInvokeTraceCollector(page, async () => {
        localStorage.clear();
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(failure.traceCollectorCleanupFailed).toBe(true);
    expect(window.__limeInvokeTraceCollector).toBeUndefined();
  });

  it.each([
    undefined,
    null,
    "primitive failure",
    Object.freeze(new Error("frozen")),
  ])(
    "preserves non-mutable callback failures during invalid cleanup: %s",
    async (failure) => {
      let rejected = false;
      try {
        await withInvokeTraceCollector(page, async () => {
          localStorage.clear();
          throw failure;
        });
      } catch (error) {
        rejected = true;
        expect(error).toBe(failure);
      }
      expect(rejected).toBe(true);
      expect(window.__limeInvokeTraceCollector).toBeUndefined();
    },
  );

  it("reports only validated safe stop proof after native restoration", async () => {
    let proof;
    let handle;
    const result = await withInvokeTraceCollector(
      page,
      async (collector) => {
        handle = collector;
        append(entry(1, "turn/start"));
        append(entry(2, "thread/read"));
        return "callback-result";
      },
      (value) => {
        expect(window.__limeInvokeTraceCollector).toBeUndefined();
        proof = value;
      },
    );
    expect(result).toBe("callback-result");
    expect(proof).toEqual({
      mode: "continuous-storage-append",
      runId: handle.runId,
      startedAt: handle.startedAt,
      appendCount: 2,
      ringCount: 2,
      complete: true,
      nativeRestored: true,
    });
    expect(Object.isFrozen(proof)).toBe(true);
    expect(JSON.stringify(proof)).not.toContain(
      "collector private fixture body",
    );
    for (const key of ["seedEntries", "ledgerEntries", "observations"])
      expect(proof).not.toHaveProperty(key);
  });

  it("records incomplete cleanup without exposing an unvalidated ledger", async () => {
    let proof;
    await expect(
      withInvokeTraceCollector(
        page,
        async () => {
          append(entry(1));
          localStorage.clear();
        },
        (value) => {
          proof = value;
        },
      ),
    ).rejects.toThrow("invalid provenance");
    expect(proof).toMatchObject({
      appendCount: null,
      ringCount: null,
      complete: false,
      nativeRestored: true,
    });
  });

  it.each(["deleted", "replaced with the same identity"])(
    "fails closed and restores native methods after its public hook is %s",
    async (loss) => {
      let proof;
      let handle;
      await expect(
        withInvokeTraceCollector(
          page,
          async (collector) => {
            handle = collector;
            append(entry(1));
            if (loss === "deleted") delete window.__limeInvokeTraceCollector;
            else
              window.__limeInvokeTraceCollector = {
                runId: collector.runId,
                startedAt: collector.startedAt,
              };
          },
          (value) => {
            proof = value;
          },
        ),
      ).rejects.toThrow("invalid provenance");
      expect(proof).toMatchObject({ complete: false, nativeRestored: true });
      for (const name of ["setItem", "removeItem", "clear"])
        expect(Storage.prototype[name]).toBe(originalDescriptors[name].value);
      expect(
        window[`__limeInvokeTraceCollectorStop_${handle.runId}`],
      ).toBeUndefined();
    },
  );

  it("preserves a primary failure when the safe stop proof callback throws", async () => {
    const failure = new Error("controlled primary failure");
    await expect(
      withInvokeTraceCollector(
        page,
        async () => {
          throw failure;
        },
        () => {
          throw new Error("controlled proof callback failure");
        },
      ),
    ).rejects.toBe(failure);
    expect(failure.traceCollectorCleanupFailed).toBe(true);
    expect(Storage.prototype.setItem).toBe(originalDescriptors.setItem.value);
  });

  it("rejects apparently successful callbacks if the observation window was reset", async () => {
    await expect(
      withInvokeTraceCollector(page, async () => {
        localStorage.clear();
        return { ok: true };
      }),
    ).rejects.toThrow("invalid provenance");
    expect(window.__limeInvokeTraceCollector).toBeUndefined();
  });

  it("returns successful callback values after validated native restoration", async () => {
    const result = await withInvokeTraceCollector(page, async () => {
      append(entry(1));
      return "callback-result";
    });
    expect(result).toBe("callback-result");
    expect(Storage.prototype.setItem).toBe(originalDescriptors.setItem.value);
  });
});

describe("independent provenance oracle", () => {
  it.each([
    [
      "runId",
      (capture) => {
        capture.runId = "other";
      },
    ],
    [
      "start",
      (capture) => {
        capture.startedAt = "2020-01-01T00:00:00.000Z";
      },
    ],
    [
      "limit",
      (capture) => {
        capture.traceLimit = 1_000;
      },
    ],
    [
      "key",
      (capture) => {
        capture.traceKey = "other";
      },
    ],
    [
      "hook",
      (capture) => {
        capture.hooksIntact = false;
      },
    ],
    [
      "inactive",
      (capture) => {
        capture.activeAtCapture = false;
      },
    ],
    [
      "invalidation",
      (capture) => {
        capture.invalidations.push({ reason: "reset" });
      },
    ],
    [
      "seed hash",
      (capture) => {
        capture.seedDigest = "wrong";
      },
    ],
    [
      "count",
      (capture) => {
        capture.captureSequence += 1;
      },
    ],
    [
      "missing observation",
      (capture) => {
        capture.observations.pop();
      },
    ],
    [
      "changed ledger",
      (capture) => {
        capture.ledgerEntries[0].duration_ms += 1;
      },
    ],
    [
      "before hash",
      (capture) => {
        capture.observations[0].beforeDigest = "wrong";
      },
    ],
    [
      "after hash",
      (capture) => {
        capture.observations[0].afterDigest = "wrong";
      },
    ],
    [
      "entry hash",
      (capture) => {
        capture.observations[0].entryDigest = "wrong";
      },
    ],
    [
      "before count",
      (capture) => {
        capture.observations[0].beforeCount += 1;
      },
    ],
    [
      "after count",
      (capture) => {
        capture.observations[0].afterCount += 1;
      },
    ],
    [
      "native failure",
      (capture) => {
        capture.observations[0].nativeSucceeded = false;
      },
    ],
    [
      "nonappend",
      (capture) => {
        capture.observations[0].operation = "reset";
      },
    ],
    [
      "sequence",
      (capture) => {
        capture.observations[0].sequence = 3;
      },
    ],
    [
      "final count",
      (capture) => {
        capture.currentRingCount += 1;
      },
    ],
    [
      "final hash",
      (capture) => {
        capture.currentRingDigest = "wrong";
      },
    ],
  ])(
    "rejects forged %s instead of trusting complete=true",
    async (_name, mutate) => {
      const { handle, capture } = await observed();
      capture.complete = true;
      mutate(capture);
      expect(
        validateInvokeTraceCollectorCapture(capture, handle).complete,
      ).toBe(false);
      expect(boundary(capture, handle).complete).toBe(false);
    },
  );

  it("rejects bare completeness without observations", () => {
    expect(
      validateInvokeTraceCollectorCapture({ complete: true }, { runId: "fake" })
        .complete,
    ).toBe(false);
  });

  it("rejects mismatched baseline/final collector identities", async () => {
    const first = await observed();
    const before = boundary(first.capture, first.handle);
    await stopInvokeTraceCollector(page, first.handle);
    const second = await observed();
    const after = boundary(second.capture, second.handle);
    expect(
      summarizeCollapseInputBoundary({ traceBefore: before, traceAfter: after })
        .completeInputBoundary,
    ).toBe(false);
  });

  it("rejects mixing a native ring boundary with a continuous boundary", async () => {
    const { handle, capture } = await observed();
    const before = captureCollapseTraceBoundary(
      localStorage.getItem(KEY),
      parseJsonRpcRequestsFromInvokeTrace,
    );
    expect(
      summarizeCollapseInputBoundary({
        traceBefore: before,
        traceAfter: boundary(capture, handle),
      }).completeInputBoundary,
    ).toBe(false);
  });
});
