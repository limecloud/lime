import { afterEach, describe, expect, it, vi } from "vitest";
import { copyUserMessageFullText } from "./user-message-collapse.mjs";
import { collapseTextIdentity } from "./user-message-collapse-evidence.mjs";
import { installClipboardWriteObservationDom } from "./user-message-collapse-clipboard-observation.mjs";

const FULL = "完整正文😀\n第二行";
const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
function fixture({
  readFailureAt,
  invalidReadAt,
  writeFailureAt,
  stale = false,
  silentRestore = false,
  clickThrows = false,
  clickError = new Error("controlled click failure"),
  original = "original clipboard",
  nativeError,
} = {}) {
  let clipboard = original;
  let reads = 0;
  const writes = [];
  let clicks = 0;
  const readError = new Error("controlled host read failure");
  const writeError = new Error("controlled host write failure");
  const nativeWrite = vi.fn(async function writeText(text) {
    if (nativeError) throw nativeError;
    clipboard = text;
  });
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: nativeWrite },
    configurable: true,
  });
  const page = {
    evaluate: vi.fn((callback, argument) => {
      // Renderer evaluation is restricted to the passive observer lifecycle.
      if (callback !== installClipboardWriteObservationDom && !argument?.runId)
        throw new Error("renderer fallback forbidden");
      return callback(argument);
    }),
  };
  const args = {
    page,
    expectedText: FULL,
    phase: "collapsed",
    timeoutMs: 100,
    readClipboardText: async () => {
      reads += 1;
      if (reads === readFailureAt) throw readError;
      if (reads === invalidReadAt) return { privateText: FULL };
      return clipboard;
    },
    writeClipboardText: async (text) => {
      writes.push(text);
      if (writes.length === writeFailureAt) throw writeError;
      if (
        (stale && writes.length === 1) ||
        (silentRestore && writes.length === 2)
      )
        return;
      clipboard = text;
    },
    copyButton: {
      count: async () => 1,
      click: async () => {
        clicks += 1;
        if (clickThrows) throw clickError;
        await navigator.clipboard.writeText(FULL).catch(() => undefined);
      },
    },
  };
  return {
    args,
    page,
    readError,
    writeError,
    clickError,
    nativeWrite,
    state: () => ({ clipboard, reads, writes, clicks }),
  };
}
afterEach(() => {
  window.__limeClipboardWriteObservation?.stop();
  if (clipboardDescriptor)
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else delete navigator.clipboard;
  vi.restoreAllMocks();
});

describe("host clipboard preparation and exact real-action readback contract", () => {
  it("writes only sentinel and restoration through the host and accepts full Unicode readback after the copy action", async () => {
    const controlled = fixture();
    const result = await copyUserMessageFullText(controlled.args);
    expect(result).toMatchObject({
      sentinelObserved: true,
      buttonClicked: true,
      fullTextMatched: true,
      textIdentity: collapseTextIdentity(FULL),
    });
    expect(controlled.state()).toMatchObject({
      clipboard: "original clipboard",
      reads: 4,
      clicks: 1,
    });
    expect(controlled.state().writes).toHaveLength(2);
    expect(controlled.state().writes[0]).toMatch(
      /^lime-user-message-collapse-collapsed-\d+$/,
    );
    expect(controlled.state().writes[1]).toBe("original clipboard");
    expect(controlled.state().writes).not.toContain(FULL);
    expect(controlled.page.evaluate).toHaveBeenCalledTimes(2);
    expect(controlled.nativeWrite).toHaveBeenCalledExactlyOnceWith(FULL);
    expect(result.clipboardWriteObservation).toMatchObject({
      intervalComplete: true,
      nativeRestored: true,
      totalCalls: 1,
      calls: [{ expectedTextEqual: true, outcome: "fulfilled" }],
    });
    expect(JSON.stringify(result)).not.toContain(FULL);
  });

  it.each(["readClipboardText", "writeClipboardText", "page"])(
    "fails closed without %s and never invokes renderer fallback",
    async (key) => {
      const controlled = fixture();
      delete controlled.args[key];
      await expect(copyUserMessageFullText(controlled.args)).rejects.toThrow(
        "invalid exact UserMessage clipboard contract",
      );
      expect(controlled.state()).toMatchObject({
        reads: 0,
        writes: [],
        clicks: 0,
      });
      expect(controlled.page.evaluate).not.toHaveBeenCalled();
    },
  );

  it("rejects a stale full-text clipboard when host sentinel delivery did not occur", async () => {
    const controlled = fixture({ original: FULL, stale: true });
    await expect(copyUserMessageFullText(controlled.args)).rejects.toThrow(
      "sentinel was not delivered",
    );
    expect(controlled.state()).toMatchObject({ clipboard: FULL, clicks: 0 });
    expect(controlled.state().writes).toHaveLength(2);
  });

  it("preserves an initial host reader exception without modifying an unknown clipboard", async () => {
    const controlled = fixture({ readFailureAt: 1 });
    await expect(copyUserMessageFullText(controlled.args)).rejects.toBe(
      controlled.readError,
    );
    expect(controlled.state()).toMatchObject({ writes: [], clicks: 0 });
  });

  it.each([2, 3])(
    "restores the clipboard and preserves host reader failure at observation %i",
    async (readFailureAt) => {
      const controlled = fixture({ readFailureAt });
      await expect(copyUserMessageFullText(controlled.args)).rejects.toBe(
        controlled.readError,
      );
      expect(controlled.state().clipboard).toBe("original clipboard");
      expect(controlled.state().writes).toHaveLength(2);
    },
  );

  it.each([1, 2, 3, 4])(
    "rejects non-text host readback at observation %i",
    async (invalidReadAt) => {
      const controlled = fixture({ invalidReadAt });
      await expect(copyUserMessageFullText(controlled.args)).rejects.toThrow(
        "readback did not return text",
      );
      expect(controlled.state().writes).toHaveLength(
        invalidReadAt === 1 ? 0 : 2,
      );
      expect(controlled.state().clipboard).toBe("original clipboard");
    },
  );

  it("attempts host restoration after a sentinel write throws and preserves the exact write exception", async () => {
    const controlled = fixture({ writeFailureAt: 1 });
    await expect(copyUserMessageFullText(controlled.args)).rejects.toBe(
      controlled.writeError,
    );
    expect(controlled.state()).toMatchObject({
      clipboard: "original clipboard",
      clicks: 0,
    });
    expect(controlled.state().writes).toHaveLength(2);
  });

  it("rejects successful product readback when host restoration throws", async () => {
    const controlled = fixture({ writeFailureAt: 2 });
    await expect(copyUserMessageFullText(controlled.args)).rejects.toBe(
      controlled.writeError,
    );
    expect(controlled.state()).toMatchObject({ clipboard: FULL, clicks: 1 });
  });

  it("rejects a resolved host write that did not restore the original clipboard", async () => {
    const controlled = fixture({ silentRestore: true });
    await expect(copyUserMessageFullText(controlled.args)).rejects.toThrow(
      "restoration did not match",
    );
    expect(controlled.state()).toMatchObject({
      clipboard: FULL,
      clicks: 1,
      reads: 4,
    });
  });

  it("rejects restoration when its host readback fails", async () => {
    const controlled = fixture({ readFailureAt: 4 });
    await expect(copyUserMessageFullText(controlled.args)).rejects.toBe(
      controlled.readError,
    );
    expect(controlled.state()).toMatchObject({
      clipboard: "original clipboard",
      clicks: 1,
    });
  });

  it("preserves the original click failure when restoration also fails", async () => {
    const controlled = fixture({ clickThrows: true, writeFailureAt: 2 });
    await expect(copyUserMessageFullText(controlled.args)).rejects.toBe(
      controlled.clickError,
    );
    expect(controlled.clickError.clipboardRestoreFailed).toBe(true);
    expect(controlled.state().clicks).toBe(1);
  });

  it.each([
    undefined,
    null,
    "primitive primary",
    Object.freeze(new Error("frozen primary")),
  ])(
    "does not replace an immutable or primitive primary exception: %s",
    async (clickError) => {
      const controlled = fixture({
        clickThrows: true,
        clickError,
        writeFailureAt: 2,
      });
      // An explicit undefined primary must survive the fixture default as well.
      controlled.args.copyButton.click = async () => {
        throw clickError;
      };
      let rejected = false;
      try {
        await copyUserMessageFullText(controlled.args);
      } catch (error) {
        rejected = true;
        expect(error).toBe(clickError);
      }
      expect(rejected).toBe(true);
    },
  );

  it("restores the host clipboard after an exact-action visibility check fails", async () => {
    const controlled = fixture();
    const original = new Error("controlled visibility failure");
    controlled.args.ensureVisible = async () => {
      throw original;
    };
    await expect(copyUserMessageFullText(controlled.args)).rejects.toBe(
      original,
    );
    expect(controlled.state()).toMatchObject({
      clipboard: "original clipboard",
      clicks: 0,
    });
  });

  it("records a caught native permission rejection and sentinel readback without leaking text", async () => {
    const controlled = fixture({
      nativeError: new DOMException(
        "Write permission denied.",
        "NotAllowedError",
      ),
    });
    controlled.args.timeoutMs = 1;
    const result = await copyUserMessageFullText(controlled.args);
    expect(result).toMatchObject({
      sentinelObserved: true,
      buttonClicked: true,
      fullTextMatched: false,
      actualReadObserved: true,
      actualEqualsExpected: false,
      actualEqualsSentinel: true,
      clipboardWriteObservation: {
        intervalComplete: true,
        nativeRestored: true,
        totalCalls: 1,
        calls: [
          {
            expectedTextEqual: true,
            textUtf16Length: FULL.length,
            outcome: "rejected",
            rejectionName: "NotAllowedError",
            errorKind: "permission-denied",
          },
        ],
      },
    });
    expect(controlled.state().clipboard).toBe("original clipboard");
    expect(JSON.stringify(result)).not.toContain(FULL);
    expect(JSON.stringify(result)).not.toContain("Write permission denied.");
  });

  it("fails closed on observer cleanup while independently restoring through main", async () => {
    const controlled = fixture();
    const failure = new Error("observer cleanup failed");
    controlled.page.evaluate
      .mockImplementationOnce((callback, argument) => callback(argument))
      .mockRejectedValueOnce(failure);
    await expect(copyUserMessageFullText(controlled.args)).rejects.toBe(
      failure,
    );
    expect(failure.clipboardObservationCleanupFailed).toBe(true);
    expect(failure.clipboardRestoreFailed).toBeUndefined();
    expect(failure.clipboardCopyEvidence).toMatchObject({
      actualEqualsExpected: true,
    });
    expect(controlled.state().clipboard).toBe("original clipboard");
  });

  it("keeps a primary click exception when observer cleanup also fails", async () => {
    const controlled = fixture({ clickThrows: true });
    controlled.page.evaluate
      .mockImplementationOnce((callback, argument) => callback(argument))
      .mockRejectedValueOnce(new Error("observer cleanup failed"));
    await expect(copyUserMessageFullText(controlled.args)).rejects.toBe(
      controlled.clickError,
    );
    expect(controlled.clickError.clipboardObservationCleanupFailed).toBe(true);
    expect(controlled.clickError.clipboardRestoreFailed).toBeUndefined();
    expect(controlled.state().clipboard).toBe("original clipboard");
  });
});
