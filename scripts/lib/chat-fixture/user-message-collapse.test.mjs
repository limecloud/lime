import { afterEach, describe, expect, it, vi } from "vitest";
import { copyUserMessageFullText } from "./user-message-collapse.mjs";
import { collapseTextIdentity } from "./user-message-collapse-evidence.mjs";

describe("UserMessage clipboard delivery helper with controlled callbacks", () => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  afterEach(() => {
    window.__limeClipboardWriteObservation?.stop();
    if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
    else delete navigator.clipboard;
  });
  function clipboardFixture({
    delivered = "完整正文😀",
    clickFailure = false,
    stale = false,
    count = 1,
  } = {}) {
    let clipboard = "original clipboard";
    let clicks = 0;
    let writes = 0;
    const expectedText = "完整正文😀";
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text) => {
          clipboard = text;
        },
      },
      configurable: true,
    });
    const args = {
      page: { evaluate: async (callback, argument) => callback(argument) },
      expectedText,
      phase: "collapsed",
      timeoutMs: 1,
      readClipboardText: async () => clipboard,
      writeClipboardText: async (value) => {
        writes += 1;
        if (!stale || writes > 1) clipboard = value;
      },
      copyButton: {
        count: async () => count,
        click: async () => {
          clicks += 1;
          if (clickFailure) throw new Error("controlled click failure");
          await navigator.clipboard.writeText(delivered);
        },
      },
    };
    return { args, state: () => ({ clipboard, clicks, writes }) };
  }

  it("requires a fresh sentinel before accepting precise Unicode delivery and restores the clipboard", async () => {
    const fixture = clipboardFixture();
    const result = await copyUserMessageFullText(fixture.args);
    expect(result).toMatchObject({
      sentinelObserved: true,
      buttonClicked: true,
      fullTextMatched: true,
      textIdentity: collapseTextIdentity(fixture.args.expectedText),
    });
    expect(fixture.state()).toEqual({
      clipboard: "original clipboard",
      clicks: 1,
      writes: 2,
    });
    expect(result).not.toHaveProperty("text");
  });

  it("does not accept an old clipboard when sentinel delivery fails", async () => {
    const fixture = clipboardFixture({ stale: true });
    await expect(copyUserMessageFullText(fixture.args)).rejects.toThrow(
      "sentinel",
    );
    expect(fixture.state()).toEqual({
      clipboard: "original clipboard",
      clicks: 0,
      writes: 2,
    });
  });

  it("restores the previous clipboard when a real-action callback fails", async () => {
    const fixture = clipboardFixture({ clickFailure: true });
    await expect(copyUserMessageFullText(fixture.args)).rejects.toThrow(
      "controlled click failure",
    );
    expect(fixture.state()).toEqual({
      clipboard: "original clipboard",
      clicks: 1,
      writes: 2,
    });
  });

  it("reports prefix delivery as a failure and restores the clipboard", async () => {
    const fixture = clipboardFixture({ delivered: "完整" });
    const result = await copyUserMessageFullText(fixture.args);
    expect(result.fullTextMatched).toBe(false);
    expect(result.textIdentity).toEqual(collapseTextIdentity("完整"));
    expect(fixture.state().clipboard).toBe("original clipboard");
  });

  it("rejects duplicate copy controls before modifying the clipboard", async () => {
    const fixture = clipboardFixture({ count: 2 });
    await expect(copyUserMessageFullText(fixture.args)).rejects.toThrow(
      "exact UserMessage",
    );
    expect(fixture.state()).toEqual({
      clipboard: "original clipboard",
      clicks: 0,
      writes: 0,
    });
  });

  it("fails closed without a host clipboard reader", async () => {
    const fixture = clipboardFixture();
    delete fixture.args.readClipboardText;
    await expect(copyUserMessageFullText(fixture.args)).rejects.toThrow(
      "exact UserMessage",
    );
    expect(fixture.state().writes).toBe(0);
  });
});
