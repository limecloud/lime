// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserDownloadsHost } from "./browserDownloadsHost";
import { BrowserDownloadsStore } from "./browserDownloadsStore";
import { assertBrowserDownloadsPage } from "../src/lib/api/browserDownloadsTypes";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "download-recovery-host-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
function fixture(recover = vi.fn(async () => {})) {
  const host = new BrowserDownloadsHost(() => {}, {
    createStore: () => new BrowserDownloadsStore(root),
    recover,
  });
  const list = async () => {
    const page = await host.invoke("browser_downloads_list");
    assertBrowserDownloadsPage(page);
    return page;
  };
  const file = path.join(root, "partial.bin");
  const item = {
    isPaused: () => false,
    canResume: () => false,
    pause: vi.fn(),
    getSavePath: () => file,
    getURLChain: () => ["https://example.test/file"],
    getETag: () => '"v1"',
    getLastModifiedTime: () => "",
    getStartTime: () => 1,
  };
  const event = {
    viewId: "original-view",
    downloadId: "original-download",
    url: "https://example.test/file",
    filename: "partial.bin",
    mimeType: "application/octet-stream",
    state: "progressing" as const,
    receivedBytes: 4,
    totalBytes: 10,
    canResume: false,
  };
  const action = (action: string, extra = {}) =>
    host.invoke("browser_downloads_action", {
      id: event.downloadId,
      action,
      ...extra,
    });
  return { host, list, file, item, event, action, recover };
}
describe("download history after native process restart", () => {
  it("changes progress and terminal state only when the recreated native item reports them", async () => {
    const original = fixture();
    await writeFile(original.file, "part");
    original.host.observe(original.item as never, original.event, false, true);
    await original.host.prepareShutdown();
    await rm(original.file);
    let restored: ReturnType<typeof fixture>;
    const recover = vi.fn(async () => {
      restored.host.observe(
        restored.item as never,
        restored.event,
        false,
        true,
      );
    });
    restored = fixture(recover);
    await restored.action("resume");
    expect((await restored.list()).entries).toEqual([
      expect.objectContaining({
        id: original.event.downloadId,
        state: "progressing",
        canPause: true,
        canCancel: true,
      }),
    ]);
    await writeFile(restored.file, "0123456789");
    restored.host.observe(
      restored.item as never,
      { ...restored.event, state: "completed" },
      true,
      true,
    );
    expect((await restored.list()).entries[0]).toMatchObject({
      state: "completed",
      canResume: false,
      fileExists: true,
    });
    await expect(restored.action("resume")).rejects.toThrow("unavailable");
  });
  it("migrates the previous record format without inventing missing recovery facts", async () => {
    const original = fixture();
    await writeFile(original.file, "part");
    original.host.observe(original.item as never, original.event, false, true);
    await original.list();
    const file = path.join(root, "browser", "downloads.json");
    const previous = JSON.parse(await readFile(file, "utf8"));
    previous.schemaVersion = 1;
    for (const entry of previous.entries) delete entry.resume;
    await writeFile(file, JSON.stringify(previous));
    const restored = fixture();
    expect((await restored.list()).entries[0]).toMatchObject({
      state: "interrupted",
      canResume: false,
    });
    await expect(restored.action("resume")).rejects.toThrow("unavailable");
    expect(restored.recover).not.toHaveBeenCalled();
  });
  it("checkpoints before shutdown, restores the original controlled id, and keeps private native facts out of projections", async () => {
    const original = fixture();
    await writeFile(original.file, "part");
    original.host.observe(original.item as never, original.event, false, true);
    await original.host.prepareShutdown();
    expect(original.item.pause).toHaveBeenCalled();
    await expect(original.list()).rejects.toThrow("shutting down");
    await rm(original.file);
    const restored = fixture();
    const page = await restored.list();
    expect(page.entries[0]).toMatchObject({
      id: original.event.downloadId,
      state: "interrupted",
      canResume: true,
      canCancel: true,
    });
    expect(JSON.stringify(page)).not.toMatch(
      /savePath|urlChain|lastModified|eTag|viewId|partials/u,
    );
    await restored.action("resume");
    expect(restored.recover).toHaveBeenCalledWith(
      expect.objectContaining({
        id: original.event.downloadId,
        path: original.file,
        offset: 4,
        length: 10,
        urlChain: [original.event.url],
      }),
    );
    expect(await readFile(original.file, "utf8")).toBe("part");
  });
  it("retains resumable interrupted rows during clear and prevents removing them as terminal history", async () => {
    const original = fixture();
    await writeFile(original.file, "part");
    original.host.observe(original.item as never, original.event, false, true);
    await original.host.prepareShutdown();
    await rm(original.file);
    const restored = fixture();
    await restored.host.invoke("browser_downloads_clear");
    expect((await restored.list()).total).toBe(1);
    await expect(restored.action("remove")).rejects.toThrow("Active");
    await restored.action("resume");
    expect(restored.recover).toHaveBeenCalledOnce();
  });
  it("cancels a restored download without creating a native item or deleting a user file", async () => {
    const original = fixture();
    await writeFile(original.file, "part");
    original.host.observe(original.item as never, original.event, false, true);
    await original.host.prepareShutdown();
    await rm(original.file);
    const restored = fixture();
    expect((await restored.list()).entries[0].canCancel).toBe(true);
    await writeFile(original.file, "keep");
    await restored.action("cancel");
    expect(restored.recover).not.toHaveBeenCalled();
    expect((await restored.list()).entries[0]).toMatchObject({
      id: original.event.downloadId,
      state: "cancelled",
      canResume: false,
      canCancel: false,
    });
    expect(await readFile(original.file, "utf8")).toBe("keep");
    expect(await readdir(path.join(root, "browser", "partials"))).toEqual([]);
    const cold = fixture();
    expect((await cold.list()).entries[0].state).toBe("cancelled");
    await expect(cold.action("resume")).rejects.toThrow("unavailable");
    await cold.host.invoke("browser_downloads_clear");
    expect((await cold.list()).total).toBe(0);
    expect(await readFile(original.file, "utf8")).toBe("keep");
  });
  it("retains the record and checkpoint when recovery fails so an explicit retry remains possible", async () => {
    const original = fixture();
    await writeFile(original.file, "part");
    original.host.observe(original.item as never, original.event, false, true);
    await original.host.prepareShutdown();
    await rm(original.file);
    const recover = vi.fn(async (): Promise<void> => {
      throw Error("policy denied");
    });
    const restored = fixture(recover);
    await expect(restored.action("resume")).rejects.toThrow("policy denied");
    expect((await restored.list()).entries[0]).toMatchObject({
      state: "interrupted",
      canResume: true,
    });
    recover.mockResolvedValueOnce(undefined);
    await restored.action("resume");
    expect(recover).toHaveBeenCalledTimes(2);
  });
  it("does not offer recovery without native metadata or a valid partial file and rejects renderer recovery arguments", async () => {
    const original = fixture();
    original.host.observe(original.item as never, original.event, false, true);
    await original.list();
    const restored = fixture();
    expect((await restored.list()).entries[0].canResume).toBe(false);
    await expect(restored.action("resume")).rejects.toThrow("unavailable");
    await expect(
      restored.action("resume", { path: original.file, offset: 0 }),
    ).rejects.toThrow("Unexpected");
    expect(restored.recover).not.toHaveBeenCalled();
  });
});
