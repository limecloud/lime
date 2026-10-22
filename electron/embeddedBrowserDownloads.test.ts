import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { installEmbeddedBrowserDownloadHandling } from "./embeddedBrowserDownloads";

function downloadHarness(allowed: () => boolean | Promise<boolean>) {
  const browserSession = new EventEmitter();
  const item = Object.assign(new EventEmitter(), {
    getFilename: () => "report.pdf",
    getURL: () => "https://example.com/report.pdf",
    getMimeType: () => "application/pdf",
    getReceivedBytes: () => 0,
    getTotalBytes: () => 42,
    canResume: () => false,
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    setSavePath: vi.fn(),
    setSaveDialogOptions: vi.fn(),
  });
  const webContents = {};
  const emitted: unknown[] = [];
  installEmbeddedBrowserDownloadHandling(
    browserSession as never,
    {
      findEntryByWebContents: () => ({
        viewId: "view-1",
        webContents: webContents as never,
      }),
      resolveSavePath: () => null,
      resolveSaveDialogOptions: () => ({
        defaultPath: "/isolated/downloads/report.pdf",
      }),
      canDownload: allowed,
    },
    (_event, payload) => emitted.push(payload),
  );
  browserSession.emit("will-download", {}, item, webContents);
  return { item, emitted };
}

describe("native Browser download policy", () => {
  it("pauses bytes until fresh authoritative Agent settings grant download", async () => {
    let resolvePolicy!: (allowed: boolean) => void;
    const policy = new Promise<boolean>((resolve) => {
      resolvePolicy = resolve;
    });
    const { item } = downloadHarness(() => policy);
    expect(item.pause).toHaveBeenCalledOnce();
    expect(item.resume).not.toHaveBeenCalled();
    expect(item.setSavePath).not.toHaveBeenCalled();
    expect(item.setSaveDialogOptions).toHaveBeenCalledWith({
      defaultPath: "/isolated/downloads/report.pdf",
    });
    resolvePolicy(true);
    await policy;
    expect(item.resume).toHaveBeenCalledOnce();
    expect(item.cancel).not.toHaveBeenCalled();
  });

  it("cancels when authority is unavailable instead of falling back to cached allow", async () => {
    const { item } = downloadHarness(async () => {
      throw new Error("App Server unavailable");
    });
    await vi.waitFor(() => expect(item.cancel).toHaveBeenCalledOnce());
    expect(item.resume).not.toHaveBeenCalled();
  });

  it("cancels a denied site and still emits the real download terminal event", () => {
    const { item, emitted } = downloadHarness(() => false);
    expect(item.cancel).toHaveBeenCalledOnce();
    item.emit("done", {}, "cancelled");
    expect(emitted).toMatchObject([
      { state: "started", viewId: "view-1" },
      { state: "cancelled", viewId: "view-1" },
    ]);
  });
  it("does not resume a download cancelled while the settings read was pending", async () => {
    let resolvePolicy!: (allowed: boolean) => void;
    const policy = new Promise<boolean>(resolve => { resolvePolicy = resolve; });
    const { item } = downloadHarness(() => policy);
    item.emit("done", {}, "cancelled");
    resolvePolicy(true);
    await policy;
    expect(item.resume).not.toHaveBeenCalled();
  });

});
