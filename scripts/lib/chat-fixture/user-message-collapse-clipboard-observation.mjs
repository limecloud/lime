import { randomUUID } from "node:crypto";

// Fixture-only: serialized into the renderer for one exact-copy interval.
export function installClipboardWriteObservationDom({ runId, expectedText }) {
  const slot = "__limeClipboardWriteObservation";
  const stopSlot = `__limeClipboardWriteObservationStop_${runId}`;
  if (window[slot]) throw new Error("clipboard observation already installed");
  if (typeof expectedText !== "string" || !expectedText.length)
    throw new Error("clipboard observation requires expected text");
  const clipboard = navigator.clipboard;
  if (!clipboard) throw new Error("native clipboard is unavailable");
  const ownDescriptor = Object.getOwnPropertyDescriptor(clipboard, "writeText");
  let holder = clipboard;
  let descriptor;
  while (holder && !descriptor) {
    descriptor = Object.getOwnPropertyDescriptor(holder, "writeText");
    holder = Object.getPrototypeOf(holder);
  }
  if (
    typeof descriptor?.value !== "function" ||
    ownDescriptor?.configurable === false ||
    (!ownDescriptor && !Object.isExtensible(clipboard))
  )
    throw new Error("clipboard write method cannot be observed reversibly");
  const native = descriptor.value;
  const nativeThen = Promise.prototype.then;
  const calls = [];
  let observationErrorCount = 0;
  let active = true;
  let owner;
  const rejection = (error) => {
    let name;
    try {
      name = error?.name;
    } catch {
      observationErrorCount += 1;
    }
    let errorKind = "unknown";
    if (name === "NotAllowedError") {
      try {
        const message = error?.message;
        if (
          typeof message === "string" &&
          /^Document is not focused\.?$/i.test(message)
        )
          errorKind = "document-not-focused";
        else if (
          typeof message === "string" &&
          /^(?:Write|Clipboard write) permission denied\.?$/i.test(message)
        )
          errorKind = "permission-denied";
      } catch {
        observationErrorCount += 1;
      }
    }
    const allowed = [
      "NotAllowedError",
      "SecurityError",
      "NotSupportedError",
      "InvalidStateError",
      "AbortError",
      "DataError",
      "NotReadableError",
      "OperationError",
      "QuotaExceededError",
      "TypeError",
      "Error",
    ];
    return {
      rejectionName: allowed.includes(name) ? name : "UnknownError",
      // Read a native message transiently, export only an exact mapped enum.
      errorKind,
    };
  };
  const focus = () => {
    try {
      const tag = document.activeElement?.tagName;
      const visibility = document.visibilityState;
      return {
        documentFocused: document.hasFocus(),
        activeTag: ["BUTTON", "INPUT", "TEXTAREA", "BODY"].includes(tag)
          ? tag
          : "OTHER",
        visibility: ["visible", "hidden", "prerender"].includes(visibility)
          ? visibility
          : "unknown",
        userActivationActive: navigator.userActivation?.isActive === true,
        userActivationSeen: navigator.userActivation?.hasBeenActive === true,
      };
    } catch {
      observationErrorCount += 1;
      return {
        documentFocused: null,
        activeTag: "unknown",
        visibility: "unknown",
        userActivationActive: false,
        userActivationSeen: false,
      };
    }
  };
  const wrapper = function writeText(text) {
    const record = {
      sequence: calls.length + 1,
      argumentCount: arguments.length,
      argumentType: typeof text,
      textUtf16Length: typeof text === "string" ? text.length : null,
      expectedTextEqual: typeof text === "string" && text === expectedText,
      nativeReceiverMatches: this === clipboard,
      ...focus(),
      outcome: "pending",
      rejectionName: null,
      errorKind: null,
    };
    calls.push(record);
    let result;
    try {
      result = Reflect.apply(native, this, arguments);
    } catch (error) {
      record.outcome = "sync-throw";
      Object.assign(record, rejection(error));
      throw error;
    }
    try {
      // Return `result` itself. The independent side chain always handles its
      // own diagnostics and cannot turn a native rejection into fulfillment.
      // This adds a Promise reaction and marks a rejection as handled. It is
      // fixture observation, with no claim of neutral microtask timing.
      Reflect.apply(nativeThen, result, [
        () => {
          record.outcome = "fulfilled";
        },
        (error) => {
          try {
            record.outcome = "rejected";
            Object.assign(record, rejection(error));
          } catch {
            observationErrorCount += 1;
          }
        },
      ]);
    } catch {
      observationErrorCount += 1;
      record.outcome = "unobservable-return";
      record.errorKind = "unknown";
    }
    return result;
  };
  const hooksIntact = () =>
    active &&
    Object.getOwnPropertyDescriptor(window, slot)?.value === owner &&
    Object.getOwnPropertyDescriptor(window, stopSlot)?.value === owner &&
    Object.getOwnPropertyDescriptor(clipboard, "writeText")?.value === wrapper;
  const capture = () => ({
    schemaVersion: 1,
    mode: "passive-native-write",
    runId,
    expectedTextUtf16Length: expectedText.length,
    activeAtCapture: active,
    hooksIntact: hooksIntact(),
    totalCalls: calls.length,
    pendingCount: calls.filter((call) => call.outcome === "pending").length,
    observationErrorCount,
    calls: calls.map((call) => ({ ...call })),
  });
  const restore = () => {
    try {
      if (
        Object.getOwnPropertyDescriptor(clipboard, "writeText")?.value ===
        wrapper
      ) {
        if (ownDescriptor)
          Object.defineProperty(clipboard, "writeText", ownDescriptor);
        else delete clipboard.writeText;
      }
    } catch {
      observationErrorCount += 1;
    }
    active = false;
    if (Object.getOwnPropertyDescriptor(window, slot)?.value === owner)
      delete window[slot];
    if (Object.getOwnPropertyDescriptor(window, stopSlot)?.value === owner)
      delete window[stopSlot];
    let currentHolder = clipboard;
    let currentDescriptor;
    while (currentHolder && !currentDescriptor) {
      currentDescriptor = Object.getOwnPropertyDescriptor(
        currentHolder,
        "writeText",
      );
      currentHolder = Object.getPrototypeOf(currentHolder);
    }
    return (
      currentDescriptor?.value === native &&
      !!ownDescriptor === Object.hasOwn(clipboard, "writeText")
    );
  };
  const stop = () => {
    const snapshot = capture();
    const nativeRestored = restore();
    return {
      ...snapshot,
      stopped: true,
      nativeRestored,
      observationErrorCount,
    };
  };
  try {
    Object.defineProperty(clipboard, "writeText", {
      ...descriptor,
      value: wrapper,
      configurable: true,
    });
    owner = Object.freeze({ runId, capture, stop });
    Object.defineProperty(window, stopSlot, {
      value: owner,
      configurable: true,
    });
    window[slot] = owner;
  } catch (error) {
    restore();
    throw error;
  }
  return { runId };
}

export async function startClipboardWriteObservation(page, expectedText) {
  return page.evaluate(installClipboardWriteObservationDom, {
    runId: randomUUID(),
    expectedText,
  });
}

export async function stopClipboardWriteObservation(page, handle) {
  return page.evaluate(({ runId }) => {
    const owner = Object.getOwnPropertyDescriptor(
      window,
      `__limeClipboardWriteObservationStop_${runId}`,
    )?.value;
    if (owner?.runId !== runId)
      throw new Error("clipboard observation identity lost");
    return owner.stop();
  }, handle);
}

// This is a diagnostic allowlist, never a replacement for the exact-copy oracle.
export function summarizeClipboardWriteObservation(
  capture,
  handle = { runId: capture?.runId },
) {
  const count = (value) =>
    Number.isSafeInteger(value) && value >= 0 ? value : null;
  const choose = (value, choices) =>
    choices.includes(value) ? value : "unknown";
  const calls = Array.isArray(capture?.calls)
    ? capture.calls.map((call) => ({
        sequence: count(call?.sequence),
        argumentCount: count(call?.argumentCount),
        argumentType: choose(call?.argumentType, [
          "string",
          "undefined",
          "object",
          "number",
          "boolean",
          "bigint",
          "symbol",
          "function",
        ]),
        textUtf16Length: count(call?.textUtf16Length),
        expectedTextEqual: call?.expectedTextEqual === true,
        nativeReceiverMatches: call?.nativeReceiverMatches === true,
        documentFocused:
          typeof call?.documentFocused === "boolean"
            ? call.documentFocused
            : null,
        activeTag: choose(call?.activeTag, [
          "BUTTON",
          "INPUT",
          "TEXTAREA",
          "BODY",
          "OTHER",
        ]),
        visibility: choose(call?.visibility, [
          "visible",
          "hidden",
          "prerender",
        ]),
        userActivationActive: call?.userActivationActive === true,
        userActivationSeen: call?.userActivationSeen === true,
        outcome: choose(call?.outcome, [
          "pending",
          "fulfilled",
          "rejected",
          "sync-throw",
          "unobservable-return",
        ]),
        rejectionName: choose(call?.rejectionName, [
          "NotAllowedError",
          "SecurityError",
          "NotSupportedError",
          "InvalidStateError",
          "AbortError",
          "DataError",
          "NotReadableError",
          "OperationError",
          "QuotaExceededError",
          "TypeError",
          "Error",
          "UnknownError",
        ]),
        errorKind: choose(call?.errorKind, [
          "permission-denied",
          "document-not-focused",
          "unknown",
        ]),
      }))
    : [];
  const validRunId =
    typeof capture?.runId === "string" &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(capture.runId);
  const identityMatches =
    validRunId &&
    capture?.identityMatches !== false &&
    !!handle &&
    capture.runId === handle.runId;
  return {
    schemaVersion: 1,
    mode: "passive-native-write",
    runId: validRunId ? capture.runId : null,
    identityMatches,
    activeAtCapture: capture?.activeAtCapture === true,
    stopped: capture?.stopped === true,
    expectedTextUtf16Length: count(capture?.expectedTextUtf16Length),
    totalCalls: count(capture?.totalCalls),
    pendingCount: count(capture?.pendingCount),
    observationErrorCount: count(capture?.observationErrorCount),
    hooksIntact: capture?.hooksIntact === true,
    nativeRestored: capture?.nativeRestored === true,
    intervalComplete:
      identityMatches &&
      capture?.schemaVersion === 1 &&
      capture?.mode === "passive-native-write" &&
      capture?.activeAtCapture === true &&
      capture?.hooksIntact === true &&
      capture?.stopped === true &&
      capture?.nativeRestored === true &&
      capture?.observationErrorCount === 0 &&
      capture?.totalCalls === calls.length &&
      capture?.pendingCount ===
        calls.filter((call) => call.outcome === "pending").length &&
      calls.every((call, i) => call.sequence === i + 1),
    calls,
  };
}

export function summarizeClipboardCopyProof(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const length = (number) =>
    Number.isSafeInteger(number) && number >= 0 ? number : null;
  const textIdentity = value.textIdentity;
  return {
    sentinelObserved: value.sentinelObserved === true,
    buttonClicked: value.buttonClicked === true,
    fullTextMatched: value.fullTextMatched === true,
    actualReadObserved: value.actualReadObserved === true,
    actualEqualsExpected: value.actualEqualsExpected === true,
    actualEqualsSentinel: value.actualEqualsSentinel === true,
    actualTextUtf16Length: length(value.actualTextUtf16Length),
    textIdentity:
      length(textIdentity?.length) !== null &&
      typeof textIdentity?.sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(textIdentity.sha256)
        ? { length: textIdentity.length, sha256: textIdentity.sha256 }
        : null,
    clipboardWriteObservation: value.clipboardWriteObservation
      ? summarizeClipboardWriteObservation(value.clipboardWriteObservation)
      : null,
  };
}

export function extractClipboardCopyEvidence(error) {
  try {
    return error && Object.hasOwn(error, "clipboardCopyEvidence")
      ? summarizeClipboardCopyProof(error.clipboardCopyEvidence)
      : null;
  } catch {
    return null;
  }
}
