// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserDownloadRecoveryRequest } from "./browserDownloadResume";
import { BrowserDownloadRecovery } from "./browserDownloadRecovery";
import { installEmbeddedBrowserDownloadHandling } from "./embeddedBrowserDownloads";

const request: BrowserDownloadRecoveryRequest = {
  id: "original-download",
  viewId: "original-view",
  path: "/tmp/download.bin",
  urlChain: ["https://example.test/file"],
  offset: 4,
  length: 10,
  eTag: '"v1"',
  lastModified: "",
  startTime: 1,
  mimeType: null,
};
function item(overrides: Record<string, unknown> = {}) {
  const native = Object.assign(new EventEmitter(), {
    getSavePath: () => request.path,
    getURL: () => request.urlChain[0],
    getURLChain: () => request.urlChain,
    getState: () => "interrupted",
    getReceivedBytes: () => 4,
    getTotalBytes: () => 10,
    getFilename: () => "download.bin",
    getMimeType: () => "",
    canResume: () => true,
    isPaused: () => true,
    setSavePath: vi.fn(),
    setSaveDialogOptions: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
  });
  native.cancel.mockImplementation(() => {
    native.emit("done", {}, "cancelled");
  });
  return Object.assign(native, overrides);
}
afterEach(() => vi.useRealTimers());
describe("native interrupted download association", () => {
  it("accepts only its native item without WebContents and preserves the original controlled id", async () => {
    const session = Object.assign(new EventEmitter(), {
      createInterruptedDownload: vi.fn(),
    });
    const native = item();
    const observed = vi.fn();
    const emit = vi.fn();
    const findEntryByWebContents = vi.fn(() => null);
    const resolveSavePath = vi.fn(() => "/different/current-setting");
    const canDownload = vi.fn(async () => true);
    const handling = installEmbeddedBrowserDownloadHandling(
      session as never,
      {
        findEntryByWebContents,
        resolveSavePath,
        canDownload,
        onDownload: observed,
      },
      emit,
    );
    session.createInterruptedDownload.mockImplementation(() =>
      session.emit("will-download", {}, native, null),
    );
    await handling.resume(request);
    expect(native.resume).toHaveBeenCalledOnce();
    expect(canDownload).toHaveBeenCalledWith(
      request.viewId,
      request.urlChain[0],
      true,
      expect.any(AbortSignal),
    );
    expect(findEntryByWebContents).not.toHaveBeenCalled();
    expect(resolveSavePath).not.toHaveBeenCalled();
    expect(native.setSavePath).not.toHaveBeenCalled();
    expect(observed.mock.calls.at(-1)?.slice(1)).toEqual([
      expect.objectContaining({
        downloadId: request.id,
        viewId: request.viewId,
      }),
      false,
      true,
    ]);
    handling.dispose();
    expect(session.listenerCount("will-download")).toBe(0);
  });
  it("keeps rejected recovery interrupted and never resumes while permission is denied", async () => {
    const session = Object.assign(new EventEmitter(), {
      createInterruptedDownload: vi.fn(),
    });
    const native = item();
    const observed = vi.fn();
    const handling = installEmbeddedBrowserDownloadHandling(
      session as never,
      {
        findEntryByWebContents: () => null,
        canDownload: async () => false,
        onDownload: observed,
      },
      () => {},
    );
    session.createInterruptedDownload.mockImplementation(() =>
      session.emit("will-download", {}, native, null),
    );
    await expect(handling.resume(request)).rejects.toThrow("permission denied");
    expect(native.resume).not.toHaveBeenCalled();
    expect(
      observed.mock.calls.some(
        ([, event, finished]) =>
          event.state === "interrupted" && finished === true,
      ),
    ).toBe(true);
    expect(
      observed.mock.calls.some(([, event]) => event.state === "cancelled"),
    ).toBe(false);
    handling.dispose();
  });
  it("ignores unrelated downloads, rejects mismatched native facts, and survives synchronous creation failure", async () => {
    const session = { createInterruptedDownload: vi.fn() };
    const attach = vi.fn(async () => {});
    const recovery = new BrowserDownloadRecovery(session as never, attach);
    expect(recovery.accept(item() as never, {} as never)).toBe(false);
    expect(recovery.accept(item() as never, null)).toBe(false);
    const pending = recovery.resume(request);
    const malformed = item({ getReceivedBytes: () => 3 });
    expect(recovery.accept(malformed as never, null)).toBe(true);
    await expect(pending).rejects.toThrow("identity mismatch");
    expect(malformed.cancel).toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
    session.createInterruptedDownload.mockImplementation(() => {
      throw Error("native failure");
    });
    await expect(recovery.resume(request)).rejects.toThrow("native failure");
    recovery.dispose();
  });
  it("rejects duplicate pending paths and timed-out creation without retrying the native API", async () => {
    vi.useFakeTimers();
    const session = { createInterruptedDownload: vi.fn() };
    const recovery = new BrowserDownloadRecovery(
      session as never,
      async () => {},
    );
    const pending = recovery.resume(request);
    const rejected = expect(pending).rejects.toThrow("did not create");
    await expect(recovery.resume(request)).rejects.toThrow("unavailable");
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(session.createInterruptedDownload).toHaveBeenCalledOnce();
    recovery.dispose();
  });
  it("revokes a pending permission continuation on disposal", async () => {
    let allow!: (value: boolean) => void;
    const permission = new Promise<boolean>((resolve) => {
      allow = resolve;
    });
    const native = item();
    const session = Object.assign(new EventEmitter(), {
      createInterruptedDownload: vi.fn(() => {}),
    });
    const handling = installEmbeddedBrowserDownloadHandling(
      session as never,
      { findEntryByWebContents: () => null, canDownload: () => permission },
      () => {},
    );
    session.createInterruptedDownload.mockImplementation(() =>
      session.emit("will-download", {}, native, null),
    );
    const pending = handling.resume(request);
    const rejected = expect(pending).rejects.toThrow("owner closed");
    await Promise.resolve();
    handling.dispose();
    allow(true);
    await rejected;
    await Promise.resolve();
    expect(native.resume).not.toHaveBeenCalled();
  });
  it("stops new downloads and late normal permission continuations before shutdown checkpoints", async () => {
    let allow!: (value: boolean) => void;
    const permission = new Promise<boolean>((resolve) => {
      allow = resolve;
    });
    const native = item();
    const session = Object.assign(new EventEmitter(), {
      createInterruptedDownload: vi.fn(),
    });
    const handling = installEmbeddedBrowserDownloadHandling(
      session as never,
      {
        findEntryByWebContents: () => ({ viewId: "view-1" }),
        canDownload: () => permission,
      },
      () => {},
    );
    session.emit("will-download", {}, native, {});
    handling.prepareShutdown();
    allow(true);
    await Promise.resolve();
    expect(native.resume).not.toHaveBeenCalled();
    expect(native.cancel).toHaveBeenCalled();
    await expect(handling.resume(request)).rejects.toThrow("shutting down");
    const late = item();
    session.emit("will-download", {}, late, {});
    expect(late.cancel).toHaveBeenCalledOnce();
    handling.dispose();
  });
});
