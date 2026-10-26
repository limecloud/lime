import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installClipboardWriteObservationDom,
  startClipboardWriteObservation,
  stopClipboardWriteObservation,
  summarizeClipboardWriteObservation,
  summarizeClipboardCopyProof,
  extractClipboardCopyEvidence,
} from "./user-message-collapse-clipboard-observation.mjs";

const FULL = "PRIVATE FULL MARKDOWN 😀\n[tail](https://fixture.invalid)";
const RUN = "6bd1b447-6761-484e-86ae-bf49d52f11aa";
const SLOT = "__limeClipboardWriteObservation";
const STOP = `__limeClipboardWriteObservationStop_${RUN}`;
const previousClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
let observer;

function clipboardWith(native, descriptor = {}) {
  const clipboard = {};
  Object.defineProperty(clipboard, "writeText", {
    value: native,
    writable: true,
    enumerable: false,
    configurable: true,
    ...descriptor,
  });
  Object.defineProperty(navigator, "clipboard", {
    value: clipboard,
    configurable: true,
  });
  return clipboard;
}

function install() {
  const handle = installClipboardWriteObservationDom({
    runId: RUN,
    expectedText: FULL,
  });
  observer = window[SLOT];
  return handle;
}

function stop() {
  return summarizeClipboardWriteObservation(observer.stop(), { runId: RUN });
}

beforeEach(() => {
  document.body.innerHTML = '<button id="native-copy">copy</button>';
  document.querySelector("button").focus();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
  observer?.stop();
  observer = undefined;
  for (const key of Object.getOwnPropertyNames(window))
    if (key === SLOT || key.startsWith(`${SLOT}Stop_`)) delete window[key];
  if (previousClipboard)
    Object.defineProperty(navigator, "clipboard", previousClipboard);
  else delete navigator.clipboard;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("fixture-only native clipboard write observation", () => {
  it("preserves native this, all arguments, method shape and exact Promise identity", async () => {
    const original = Promise.resolve("native return");
    const native = vi.fn(function writeText(_text) {
      return original;
    });
    const clipboard = clipboardWith(native);
    install();
    const otherReceiver = {};
    const extra = Symbol("extra");
    expect(clipboard.writeText.name).toBe("writeText");
    expect(clipboard.writeText.length).toBe(1);
    const result = Reflect.apply(clipboard.writeText, otherReceiver, [
      FULL,
      extra,
      42,
    ]);
    expect(result).toBe(original);
    expect(native.mock.contexts[0]).toBe(otherReceiver);
    expect(native.mock.calls).toEqual([[FULL, extra, 42]]);
    await result;
    const proof = stop();
    expect(proof).toMatchObject({
      intervalComplete: true,
      nativeRestored: true,
      totalCalls: 1,
      pendingCount: 0,
      calls: [
        {
          argumentCount: 3,
          argumentType: "string",
          textUtf16Length: FULL.length,
          expectedTextEqual: true,
          nativeReceiverMatches: false,
          outcome: "fulfilled",
        },
      ],
    });
    expect(clipboard.writeText).toBe(native);
    expect(JSON.stringify(proof)).not.toContain(FULL);
  });

  it("observes focus and user activation without saving active element content", async () => {
    const activation = Object.getOwnPropertyDescriptor(
      navigator,
      "userActivation",
    );
    Object.defineProperty(navigator, "userActivation", {
      value: { isActive: true, hasBeenActive: true },
      configurable: true,
    });
    try {
      const clipboard = clipboardWith(function writeText() {
        return Promise.resolve();
      });
      install();
      await clipboard.writeText(FULL);
      expect(stop().calls[0]).toMatchObject({
        documentFocused: true,
        activeTag: "BUTTON",
        userActivationActive: true,
        userActivationSeen: true,
        nativeReceiverMatches: true,
      });
    } finally {
      if (activation)
        Object.defineProperty(navigator, "userActivation", activation);
      else delete navigator.userActivation;
    }
  });

  it.each([
    ["Write permission denied.", "permission-denied"],
    ["Clipboard write permission denied", "permission-denied"],
    ["Document is not focused.", "document-not-focused"],
    ["Write permission denied: PRIVATE BODY", "unknown"],
    [FULL, "unknown"],
  ])(
    "exports only an exact safe rejection category for %s",
    async (message, errorKind) => {
      const error = new DOMException(message, "NotAllowedError");
      const original = Promise.reject(error);
      const clipboard = clipboardWith(function writeText() {
        return original;
      });
      install();
      const result = clipboard.writeText(FULL);
      expect(result).toBe(original);
      await expect(result).rejects.toBe(error);
      const proof = stop();
      expect(proof.calls[0]).toMatchObject({
        outcome: "rejected",
        rejectionName: "NotAllowedError",
        errorKind,
      });
      const serialized = JSON.stringify(proof);
      expect(serialized).not.toContain(message);
      expect(serialized).not.toContain(FULL);
    },
  );

  it("rethrows the same synchronous native error object without saving its message", () => {
    const error = new Error(FULL);
    const clipboard = clipboardWith(function writeText() {
      throw error;
    });
    install();
    let actual;
    try {
      clipboard.writeText(FULL);
    } catch (failure) {
      actual = failure;
    }
    expect(actual).toBe(error);
    const proof = stop();
    expect(proof.calls[0]).toMatchObject({
      outcome: "sync-throw",
      rejectionName: "Error",
      errorKind: "unknown",
    });
    expect(JSON.stringify(proof)).not.toContain(FULL);
  });

  it("does not coerce arguments or inspect a non-Promise native return", () => {
    const toString = vi.fn(() => {
      throw new Error("unexpected coercion");
    });
    const argument = { toString };
    const getter = vi.fn(() => {
      throw new Error("unexpected then inspection");
    });
    const original = Object.defineProperty({}, "then", { get: getter });
    const native = vi.fn(function writeText() {
      return original;
    });
    const clipboard = clipboardWith(native);
    install();
    expect(clipboard.writeText(argument)).toBe(original);
    expect(native).toHaveBeenCalledExactlyOnceWith(argument);
    expect(toString).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
    expect(stop()).toMatchObject({
      intervalComplete: false,
      observationErrorCount: 1,
      calls: [
        {
          argumentType: "object",
          textUtf16Length: null,
          expectedTextEqual: false,
          outcome: "unobservable-return",
        },
      ],
    });
  });

  it("does not replace a native return when a focus getter fails", async () => {
    document.hasFocus.mockImplementation(() => {
      throw new Error(FULL);
    });
    const original = Promise.resolve();
    const clipboard = clipboardWith(function writeText() {
      return original;
    });
    install();
    expect(clipboard.writeText(FULL)).toBe(original);
    await original;
    expect(stop()).toMatchObject({
      intervalComplete: false,
      observationErrorCount: 1,
      calls: [{ documentFocused: null, outcome: "fulfilled" }],
    });
  });

  it("sanitizes error names and handles hostile rejection getters", async () => {
    const error = Object.defineProperty({}, "name", {
      get() {
        throw new Error(FULL);
      },
    });
    const clipboard = clipboardWith(function writeText() {
      return Promise.reject(error);
    });
    install();
    await expect(clipboard.writeText(FULL)).rejects.toBe(error);
    const proof = stop();
    expect(proof).toMatchObject({
      intervalComplete: false,
      observationErrorCount: 1,
      calls: [
        {
          outcome: "rejected",
          rejectionName: "UnknownError",
          errorKind: "unknown",
        },
      ],
    });
    expect(JSON.stringify(proof)).not.toContain(FULL);
  });

  it.each([true, false])(
    "restores the full own descriptor or inherited method (own=%s)",
    async (own) => {
      const native = function writeText() {
        return Promise.resolve();
      };
      const clipboard = own
        ? clipboardWith(native, { writable: false, enumerable: true })
        : Object.create(
            Object.defineProperty({}, "writeText", {
              value: native,
              configurable: true,
            }),
          );
      Object.defineProperty(navigator, "clipboard", {
        value: clipboard,
        configurable: true,
      });
      const before = Object.getOwnPropertyDescriptor(clipboard, "writeText");
      install();
      await clipboard.writeText(FULL);
      expect(stop()).toMatchObject({
        intervalComplete: true,
        nativeRestored: true,
      });
      expect(Object.getOwnPropertyDescriptor(clipboard, "writeText")).toEqual(
        before,
      );
      expect(clipboard.writeText).toBe(native);
    },
  );

  it("restores immediately when the native Promise is still pending", async () => {
    let fulfill;
    const original = new Promise((resolve) => {
      fulfill = resolve;
    });
    const native = function writeText() {
      return original;
    };
    const clipboard = clipboardWith(native);
    install();
    expect(clipboard.writeText(FULL)).toBe(original);
    const proof = stop();
    expect(proof).toMatchObject({
      intervalComplete: true,
      stopped: true,
      nativeRestored: true,
      pendingCount: 1,
      calls: [{ outcome: "pending" }],
    });
    expect(clipboard.writeText).toBe(native);
    fulfill();
    await original;
    expect(proof.calls[0].outcome).toBe("pending");
  });

  it("does not overwrite a replacement native method during cleanup", () => {
    const clipboard = clipboardWith(function writeText() {
      return Promise.resolve();
    });
    install();
    const replacement = function replacement() {};
    clipboard.writeText = replacement;
    expect(stop()).toMatchObject({
      intervalComplete: false,
      hooksIntact: false,
      nativeRestored: false,
    });
    expect(clipboard.writeText).toBe(replacement);
  });

  it("uses its private stop hook to restore native state when the public hook is lost", async () => {
    const native = function writeText() {
      return Promise.resolve();
    };
    const clipboard = clipboardWith(native);
    const handle = install();
    const getter = vi.fn(() => {
      throw new Error(FULL);
    });
    Object.defineProperty(window, SLOT, { get: getter, configurable: true });
    const capture = await stopClipboardWriteObservation(
      { evaluate: async (cb, arg) => cb(arg) },
      handle,
    );
    expect(summarizeClipboardWriteObservation(capture, handle)).toMatchObject({
      intervalComplete: false,
      hooksIntact: false,
      nativeRestored: true,
    });
    expect(clipboard.writeText).toBe(native);
    expect(getter).not.toHaveBeenCalled();
  });

  it.each(["immutable", "non-extensible", "accessor"])(
    "rejects an irreversible %s method without changing native state",
    (kind) => {
      const native = function writeText() {};
      let clipboard = clipboardWith(native);
      if (kind === "immutable")
        Object.defineProperty(clipboard, "writeText", { configurable: false });
      if (kind === "non-extensible") {
        clipboard = Object.preventExtensions(
          Object.create({ writeText: native }),
        );
        Object.defineProperty(navigator, "clipboard", {
          value: clipboard,
          configurable: true,
        });
      }
      if (kind === "accessor")
        Object.defineProperty(clipboard, "writeText", { get: () => native });
      const before = Object.getOwnPropertyDescriptor(clipboard, "writeText");
      expect(install).toThrow("cannot be observed reversibly");
      expect(Object.getOwnPropertyDescriptor(clipboard, "writeText")).toEqual(
        before,
      );
      expect(window[STOP]).toBeUndefined();
    },
  );

  it("allocates an isolated run identity through the page observer entrypoint", async () => {
    clipboardWith(function writeText() {
      return Promise.resolve();
    });
    const page = { evaluate: async (callback, argument) => callback(argument) };
    const handle = await startClipboardWriteObservation(page, FULL);
    observer = window[SLOT];
    const proof = summarizeClipboardWriteObservation(
      await stopClipboardWriteObservation(page, handle),
      handle,
    );
    expect(proof).toMatchObject({
      runId: handle.runId,
      identityMatches: true,
      intervalComplete: true,
    });
    expect(handle.runId).not.toBe(RUN);
  });
});

describe("clipboard diagnostic evidence whitelist", () => {
  function capture() {
    clipboardWith(function writeText() {
      return Promise.resolve();
    });
    install();
    return observer.stop();
  }

  it("does not upgrade a mismatched identity during repeated sanitization", () => {
    const value = capture();
    const wrong = summarizeClipboardWriteObservation(value, {
      runId: "different",
    });
    expect(wrong.intervalComplete).toBe(false);
    expect(summarizeClipboardWriteObservation(wrong).identityMatches).toBe(
      false,
    );
    expect(
      summarizeClipboardCopyProof({ clipboardWriteObservation: wrong })
        .clipboardWriteObservation.intervalComplete,
    ).toBe(false);
  });

  it("rejects a naked complete claim or inconsistent pending count", () => {
    expect(
      summarizeClipboardWriteObservation({ intervalComplete: true })
        .intervalComplete,
    ).toBe(false);
    const value = capture();
    value.pendingCount = 1;
    expect(summarizeClipboardWriteObservation(value).intervalComplete).toBe(
      false,
    );
  });

  it("removes raw error, arguments, body, clipboard and hostile identity fields", () => {
    const value = capture();
    const safe = summarizeClipboardCopyProof({
      raw: FULL,
      clipboard: FULL,
      actualTextUtf16Length: -1,
      textIdentity: { length: FULL.length, sha256: "a".repeat(64), text: FULL },
      clipboardWriteObservation: {
        ...value,
        runId: FULL,
        raw: FULL,
        calls: [
          {
            sequence: 1,
            message: FULL,
            args: [FULL],
            rejectionName: FULL,
            errorKind: FULL,
          },
        ],
      },
    });
    expect(safe.textIdentity).toEqual({
      length: FULL.length,
      sha256: "a".repeat(64),
    });
    expect(safe.actualTextUtf16Length).toBeNull();
    expect(safe.clipboardWriteObservation).toMatchObject({
      runId: null,
      intervalComplete: false,
      calls: [{ rejectionName: "unknown", errorKind: "unknown" }],
    });
    expect(JSON.stringify(safe)).not.toContain(FULL);
  });

  it("extracts only own diagnostic evidence and rejects throwing getters", () => {
    const error = new Error(FULL);
    error.clipboardCopyEvidence = {
      actualReadObserved: true,
      actualEqualsSentinel: true,
      body: FULL,
    };
    expect(extractClipboardCopyEvidence(error)).toMatchObject({
      actualReadObserved: true,
      actualEqualsSentinel: true,
    });
    expect(JSON.stringify(extractClipboardCopyEvidence(error))).not.toContain(
      FULL,
    );
    expect(extractClipboardCopyEvidence(Object.create(error))).toBeNull();
    expect(
      extractClipboardCopyEvidence(
        Object.defineProperty({}, "clipboardCopyEvidence", {
          get() {
            throw error;
          },
        }),
      ),
    ).toBeNull();
  });
});
