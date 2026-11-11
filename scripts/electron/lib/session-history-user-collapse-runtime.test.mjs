import { webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INVOKE_TRACE_COLLECTOR_KEY as TRACE_KEY,
  INVOKE_TRACE_COLLECTOR_LIMIT as TRACE_LIMIT,
} from "../../lib/invoke-trace-collector.mjs";
import {
  THREAD_READ_LONG_LIST,
  THREAD_READ_LONG_LIST_USER_COLLAPSE,
} from "./session-history-long-list-fixture.mjs";
import { extractLongListCollapseFailure } from "./session-history-user-collapse-geometry.mjs";

const gate = vi.hoisted(() => vi.fn());
vi.mock("./session-history-user-collapse-gate.mjs", async (importOriginal) => ({
  ...(await importOriginal()),
  runCanonicalLongListCollapseGate: gate,
}));
vi.mock("./session-history-user-collapse-input.mjs", () => ({
  withLongListCollapseInputObservation: (_page, _probe, _phase, run) => run(),
}));
vi.mock("node:timers/promises", async (importOriginal) => {
  const original = await importOriginal();
  const timers = {
    ...original.default,
    setTimeout: async (milliseconds) => {
      vi.advanceTimersByTime(milliseconds);
    },
  };
  return { ...original, ...timers, default: timers };
});
import { runSessionHistoryUserCollapsePhase } from "./session-history-user-collapse-runtime.mjs";

const page = { evaluate: async (callback, argument) => callback(argument) };
const handle = { page };
let sequence;
let descriptors;
let previousFixtureIdentity;
const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);

function appendTrace(method, params = {}) {
  const index = ++sequence;
  const entry = {
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
                  params,
                }),
              ],
            },
          },
        }
      : {}),
  };
  const ring = JSON.parse(localStorage.getItem(TRACE_KEY) ?? "[]");
  localStorage.setItem(
    TRACE_KEY,
    JSON.stringify([...ring, entry].slice(-TRACE_LIMIT)),
  );
}

beforeEach(() => {
  sequence = 0;
  localStorage.clear();
  descriptors = Object.fromEntries(
    ["setItem", "removeItem", "clear"].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(Storage.prototype, name),
    ]),
  );
  previousFixtureIdentity = {
    sessionId: THREAD_READ_LONG_LIST.sessionId,
    threadId: THREAD_READ_LONG_LIST.threadId,
  };
  Object.assign(THREAD_READ_LONG_LIST, {
    sessionId: "runtime-collapse-session",
    threadId: "runtime-collapse-thread",
  });
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("TextEncoder", TextEncoder);
  vi.stubGlobal("__LIME_ELECTRON__", true);
  vi.stubGlobal("electronAPI", {
    devBridgeFallback: false,
    invoke: async (_command, { request }) => {
      const rpc = JSON.parse(request.lines[0]);
      appendTrace(rpc.method, rpc.params);
      const probe = THREAD_READ_LONG_LIST_USER_COLLAPSE;
      return {
        lines: [
          JSON.stringify({
            id: rpc.id,
            result: {
              thread: {
                id: THREAD_READ_LONG_LIST.threadId,
                turns: [
                  {
                    id: probe.turnId,
                    items: [
                      {
                        type: "userMessage",
                        id: probe.itemId,
                        clientId: probe.clientId,
                        content: [{ type: "text", text: probe.text }],
                      },
                    ],
                  },
                ],
              },
            },
          }),
        ],
      };
    },
  });
});

afterEach(async () => {
  try {
    window.__limeClipboardWriteObservation?.stop();
    if (clipboardDescriptor)
      Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    else delete navigator.clipboard;
    await window.__limeInvokeTraceCollector?.stop();
    for (const [name, descriptor] of Object.entries(descriptors))
      Object.defineProperty(Storage.prototype, name, descriptor);
    delete window.__limeInvokeTraceCollector;
    Object.assign(THREAD_READ_LONG_LIST, previousFixtureIdentity);
    vi.unstubAllGlobals();
    gate.mockReset();
    localStorage.clear();
  } finally {
    vi.useRealTimers();
  }
});

function expectRestored() {
  expect(window.__limeInvokeTraceCollector).toBeUndefined();
  for (const [name, descriptor] of Object.entries(descriptors))
    expect(Storage.prototype[name]).toBe(descriptor.value);
}

function copyHarness({ copiedText, clickError, nativeError } = {}) {
  // Only polling advances time; host scheduling must not exhaust the 1ms budget.
  vi.useFakeTimers({ toFake: ["Date"] });
  const original = "PRIVATE ORIGINAL CLIPBOARD 😀";
  let clipboardText = original;
  const clipboard = {
    readText: vi.fn(() => clipboardText),
    writeText: vi.fn((value) => {
      clipboardText = value;
    }),
  };
  const app = {
    evaluate: vi.fn(async (callback, value) => callback({ clipboard }, value)),
  };
  const nativeWrite = vi.fn(async function writeText(text) {
    if (nativeError) throw nativeError;
    clipboardText = text;
  });
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: nativeWrite },
    configurable: true,
  });
  const copyButton = {
    count: async () => 1,
    boundingBox: async () => ({ y: 20, height: 20 }),
    click: vi.fn(async () => {
      if (clickError) throw clickError;
      // Like the product handler, a native clipboard rejection is caught here.
      await navigator.clipboard
        .writeText(copiedText ?? THREAD_READ_LONG_LIST_USER_COLLAPSE.text)
        .catch(() => undefined);
    }),
  };
  const footer = { locator: () => footer, getByRole: () => copyButton };
  const scroll = {
    hover: async () => undefined,
    boundingBox: async () => ({ y: 0, height: 600 }),
  };
  const copyPage = {
    ...page,
    locator: (selector) =>
      selector === '[data-testid="message-list-scroll-container"]'
        ? scroll
        : footer,
  };
  return {
    handle: { page: copyPage, app },
    clipboard,
    nativeWrite,
    copyButton,
    original,
    readCurrent: () => clipboardText,
  };
}

describe("long-list host clipboard callback wiring", () => {
  it.each(["collapsed", "expanded"])(
    "sets only a main sentinel and restores main clipboard after the %s product copy",
    async (state) => {
      const fixture = copyHarness();
      gate.mockImplementation(async (_page, probe, hooks) => ({
        copy: await hooks.verifyExactCopy({
          probe,
          state,
          bubbleSelector: "canonical-fixture-bubble",
        }),
      }));
      const result = await runSessionHistoryUserCollapsePhase(fixture.handle, {
        timeoutMs: 100,
      });
      expect(result.copy).toMatchObject({
        match: true,
        sha256: THREAD_READ_LONG_LIST_USER_COLLAPSE.sha256,
        textUtf16Length: THREAD_READ_LONG_LIST_USER_COLLAPSE.textUtf16Length,
        readSource: "electron-main-clipboard",
      });
      expect(fixture.copyButton.click).toHaveBeenCalledOnce();
      expect(fixture.nativeWrite).toHaveBeenCalledExactlyOnceWith(
        THREAD_READ_LONG_LIST_USER_COLLAPSE.text,
      );
      expect(
        result.copy.clipboardCopyEvidence.clipboardWriteObservation,
      ).toMatchObject({
        intervalComplete: true,
        nativeRestored: true,
        totalCalls: 1,
        calls: [{ expectedTextEqual: true, outcome: "fulfilled" }],
      });
      expect(fixture.clipboard.writeText).toHaveBeenCalledTimes(2);
      const writes = fixture.clipboard.writeText.mock.calls.map(
        ([value]) => value,
      );
      expect(writes[0]).toContain(
        `lime-user-message-collapse-canonical-long-list-${state}-`,
      );
      expect(writes[1]).toBe(fixture.original);
      expect(writes).not.toContain(THREAD_READ_LONG_LIST_USER_COLLAPSE.text);
      expect(fixture.clipboard.readText).toHaveBeenCalledTimes(4);
      expect(fixture.readCurrent()).toBe(fixture.original);
      expect(JSON.stringify(result)).not.toContain(fixture.original);
      expect(JSON.stringify(result)).not.toContain(
        THREAD_READ_LONG_LIST_USER_COLLAPSE.text,
      );
      expectRestored();
    },
  );

  it("preserves hash rejection when the real button delivers incomplete body text", async () => {
    const fixture = copyHarness({ copiedText: "PRIVATE INCOMPLETE COPY" });
    gate.mockImplementation(async (_page, probe, hooks) => ({
      copy: await hooks.verifyExactCopy({
        probe,
        state: "collapsed",
        bubbleSelector: "canonical-fixture-bubble",
      }),
    }));
    const result = await runSessionHistoryUserCollapsePhase(fixture.handle, {
      timeoutMs: 1,
    });
    expect(result.copy.match).toBe(false);
    expect(result.copy.sha256).not.toBe(
      THREAD_READ_LONG_LIST_USER_COLLAPSE.sha256,
    );
    expect(fixture.readCurrent()).toBe(fixture.original);
    expect(JSON.stringify(result)).not.toContain("PRIVATE INCOMPLETE COPY");
    expectRestored();
  });

  it("restores through the main writer while preserving an actual button failure", async () => {
    const failure = new Error("actual copy button failed");
    const fixture = copyHarness({ clickError: failure });
    gate.mockImplementation(async (_page, probe, hooks) =>
      hooks.verifyExactCopy({
        probe,
        state: "collapsed",
        bubbleSelector: "canonical-fixture-bubble",
      }),
    );
    await expect(
      runSessionHistoryUserCollapsePhase(fixture.handle, { timeoutMs: 100 }),
    ).rejects.toBe(failure);
    expect(fixture.copyButton.click).toHaveBeenCalledOnce();
    expect(fixture.readCurrent()).toBe(fixture.original);
    expect(fixture.clipboard.writeText).toHaveBeenLastCalledWith(
      fixture.original,
    );
    expectRestored();
  });

  it("attaches safe native rejection evidence when the copy oracle fails after the product catches it", async () => {
    const fixture = copyHarness({
      nativeError: new DOMException(
        "Write permission denied.",
        "NotAllowedError",
      ),
    });
    const failure = new Error("exact copy mismatch");
    gate.mockImplementation(async (_page, probe, hooks) => {
      const proof = await hooks.verifyExactCopy({
        probe,
        state: "collapsed",
        bubbleSelector: "canonical-fixture-bubble",
      });
      expect(proof.match).toBe(false);
      throw failure;
    });
    await expect(
      runSessionHistoryUserCollapsePhase(fixture.handle, { timeoutMs: 1 }),
    ).rejects.toBe(failure);
    const evidence = extractLongListCollapseFailure(failure);
    expect(evidence.clipboardCopyEvidence).toMatchObject({
      actualReadObserved: true,
      actualEqualsExpected: false,
      actualEqualsSentinel: true,
      clipboardWriteObservation: {
        intervalComplete: true,
        nativeRestored: true,
        calls: [
          {
            expectedTextEqual: true,
            textUtf16Length: THREAD_READ_LONG_LIST_USER_COLLAPSE.text.length,
            outcome: "rejected",
            rejectionName: "NotAllowedError",
            errorKind: "permission-denied",
          },
        ],
      },
    });
    expect(fixture.readCurrent()).toBe(fixture.original);
    expect(JSON.stringify(evidence)).not.toContain(fixture.original);
    expect(JSON.stringify(evidence)).not.toContain(
      THREAD_READ_LONG_LIST_USER_COLLAPSE.text,
    );
    expect(JSON.stringify(evidence)).not.toContain("Write permission denied.");
    expectRestored();
  });
});

describe("long-list runtime shared collector integration", () => {
  it("uses one continuous interval across canonical reads even after ring rollover", async () => {
    gate.mockImplementation(async (_page, probe, hooks) => {
      const checkpoint = await hooks.beginReadOnly(probe);
      for (let index = 0; index < 300; index += 1) appendTrace();
      return { business: await hooks.finishReadOnly({ probe, checkpoint }) };
    });
    const result = await runSessionHistoryUserCollapsePhase(handle, {
      timeoutMs: 1,
    });
    expect(result.business).toMatchObject({
      traceComplete: true,
      canonicalUnchanged: true,
      forbiddenMutationCount: 0,
      inputBoundary: { noAdditionalInput: true },
      traceProvenance: {
        mode: "continuous-storage-append",
        baselineAppendCount: 1,
        finalAppendCount: 302,
        finalRingCount: 240,
      },
    });
    expect(result.traceCollectorCleanup).toMatchObject({
      mode: "continuous-storage-append",
      appendCount: 302,
      ringCount: 240,
      complete: true,
      nativeRestored: true,
    });
    expectRestored();
  });

  it("preserves mutation rejection across ring rollover without filtering another thread", async () => {
    gate.mockImplementation(async (_page, probe, hooks) => {
      const checkpoint = await hooks.beginReadOnly(probe);
      appendTrace("turn/steer", {
        threadId: "another-thread",
        text: "PRIVATE MUTATION",
      });
      for (let index = 0; index < 300; index += 1) appendTrace();
      return { business: await hooks.finishReadOnly({ probe, checkpoint }) };
    });
    const result = await runSessionHistoryUserCollapsePhase(handle, {
      timeoutMs: 1,
    });
    expect(result.business.traceComplete).toBe(true);
    expect(result.business.forbiddenMutationCount).toBeNull();
    expect(result.business.inputBoundary.noAdditionalInput).toBe(false);
    expect(JSON.stringify(result)).not.toContain("PRIVATE MUTATION");
    expectRestored();
  });

  it("keeps the original failure and safe collector diagnostics while restoring native methods", async () => {
    const original = new Error("actual geometry failed");
    gate.mockImplementation(async (_page, probe, hooks) => {
      await hooks.beginReadOnly(probe);
      for (let index = 0; index < 300; index += 1) appendTrace();
      throw original;
    });
    await expect(
      runSessionHistoryUserCollapsePhase(handle, { timeoutMs: 1 }),
    ).rejects.toBe(original);
    const failure = extractLongListCollapseFailure(original);
    expect(failure.trace).toMatchObject({
      complete: true,
      appendCount: 301,
      currentRingCount: 240,
      invalidationCount: 0,
      cleanupFailed: false,
      nativeRestored: true,
      cleanupComplete: true,
    });
    expect(JSON.stringify(failure)).not.toContain(
      THREAD_READ_LONG_LIST_USER_COLLAPSE.text,
    );
    expectRestored();
  });
});
