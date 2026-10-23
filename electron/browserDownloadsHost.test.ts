// @vitest-environment node
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserDownloadsHost } from "./browserDownloadsHost";
import { BrowserDownloadsStore } from "./browserDownloadsStore";
import { installEmbeddedBrowserDownloadHandling } from "./embeddedBrowserDownloads";
import { assertBrowserDownloadsPage } from "../src/lib/api/browserDownloadsTypes";
import { persistedAtomFileIO } from "./persistedAtomFile";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "browser-downloads-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
function fixture(options: { store?: BrowserDownloadsStore } = {}) {
  const changed = vi.fn();
  const open = vi.fn(async () => "");
  const reveal = vi.fn();
  const host = new BrowserDownloadsHost(changed, {
    createStore: () => options.store ?? new BrowserDownloadsStore(root),
    open,
    reveal,
  });
  const list = async (query: unknown = {}) => {
    const result = await host.invoke("browser_downloads_list", query);
    assertBrowserDownloadsPage(result);
    return result;
  };
  const action = (
    id: string,
    action: string,
    extra: Record<string, unknown> = {},
  ) => host.invoke("browser_downloads_action", { id, action, ...extra });
  function start(id = "download-1", controllable = true) {
    let paused = false;
    const item = Object.assign(new EventEmitter(), {
      isPaused: () => paused,
      canResume: () => paused,
      getSavePath: () => path.join(root, `${id}.txt`),
      pause: vi.fn(() => {
        paused = true;
      }),
      resume: vi.fn(() => {
        paused = false;
      }),
      cancel: vi.fn(),
    });
    const event = {
      viewId: "view-1",
      downloadId: id,
      url: `https://example.com/${id}.txt`,
      filename: `${id}.txt`,
      mimeType: "text/plain",
      state: "progressing" as const,
      receivedBytes: 3,
      totalBytes: 10,
      canResume: false,
    };
    const observe = (
      state:
        | "progressing"
        | "interrupted"
        | "completed"
        | "cancelled" = "progressing",
      finished = false,
      granted = controllable,
    ) => host.observe(item as never, { ...event, state }, finished, granted);
    observe();
    return { item, event, observe, file: item.getSavePath(), id };
  }
  return { host, list, action, start, open, reveal, changed };
}
describe("native Browser download management", () => {
  it("advances durable progress without invalidating history offsets and emits only public deltas", async () => {
    const f = fixture();
    const download = f.start();
    const first = await f.list();
    f.changed.mockClear();
    f.host.observe(
      download.item as never,
      { ...download.event, receivedBytes: 6 },
      false,
      true,
    );
    const progressed = await f.list();
    expect(progressed.revision).toBeGreaterThan(first.revision);
    expect(progressed.historyRevision).toBe(first.historyRevision);
    expect(f.changed).toHaveBeenCalledExactlyOnceWith({
      kind: "updated",
      revision: progressed.revision,
      historyRevision: first.historyRevision,
      entries: progressed.entries,
      removedIds: [],
    });
    expect(JSON.stringify(f.changed.mock.calls)).not.toContain(root);
    await f.action(download.id, "pause");
    const paused = await f.list();
    expect(paused.historyRevision).toBeGreaterThan(progressed.historyRevision);
    download.observe("cancelled", true);
    const cancelled = await f.list();
    expect(cancelled.historyRevision).toBeGreaterThan(paused.historyRevision);
    f.changed.mockClear();
    await f.action(download.id, "remove");
    expect(f.changed).toHaveBeenCalledExactlyOnceWith({
      kind: "updated",
      revision: cancelled.revision + 1,
      historyRevision: cancelled.revision + 1,
      entries: [],
      removedIds: [download.id],
    });
  });
  it("persists native facts and queries filename or URL with bounded pages, without exposing file paths", async () => {
    const f = fixture();
    f.start("alpha");
    f.start("beta");
    const all = await f.list({ limit: 1 });
    expect(all).toMatchObject({ total: 2, nextOffset: 1 });
    expect((await f.list({ offset: 1 })).entries).toHaveLength(1);
    expect(
      (await f.list({ query: "ALPHA example.com" })).entries[0].filename,
    ).toBe("alpha.txt");
    expect((await f.list({ query: "unmatched" })).total).toBe(0);
    expect(JSON.stringify(all)).not.toContain(root);
    expect(JSON.stringify(all)).not.toContain("savePath");
    const disk = JSON.parse(
      await readFile(path.join(root, "browser/downloads.json"), "utf8"),
    );
    expect(disk.entries).toHaveLength(2);
    expect(disk.revision).toBe(all.revision);
  });
  it("pauses and resumes the actual native item, then rejects unavailable actions", async () => {
    const f = fixture();
    const download = f.start();
    expect((await f.list()).entries[0]).toMatchObject({
      canPause: true,
      canResume: false,
      canCancel: true,
    });
    await f.action(download.id, "pause");
    expect(download.item.pause).toHaveBeenCalledOnce();
    expect((await f.list()).entries[0]).toMatchObject({
      state: "paused",
      canPause: false,
      canResume: true,
    });
    await expect(f.action(download.id, "pause")).rejects.toThrow("unavailable");
    await f.action(download.id, "resume");
    expect(download.item.resume).toHaveBeenCalledOnce();
    expect((await f.list()).entries[0].state).toBe("progressing");
    await expect(f.action(download.id, "resume")).rejects.toThrow(
      "unavailable",
    );
    await f.action(download.id, "cancel");
    expect(download.item.cancel).toHaveBeenCalledOnce();
    // The command cannot synthesize a terminal state before DownloadItem reports it.
    expect((await f.list()).entries[0].state).toBe("progressing");
    download.observe("cancelled", true);
    expect((await f.list()).entries[0]).toMatchObject({
      state: "cancelled",
      canCancel: false,
    });
  });
  it("keeps approval-pending downloads inaccessible until the native permission resolver grants them", async () => {
    const f = fixture();
    const download = f.start("pending", false);
    expect((await f.list()).entries[0]).toMatchObject({
      canPause: false,
      canResume: false,
      canCancel: false,
    });
    for (const action of [
      "pause",
      "resume",
      "cancel",
      "remove",
      "open",
      "reveal",
    ])
      await expect(f.action(download.id, action)).rejects.toThrow();
    expect(download.item.resume).not.toHaveBeenCalled();
    download.observe("progressing", false, true);
    await f.action(download.id, "pause");
    expect(download.item.pause).toHaveBeenCalledOnce();
  });
  it("opens and reveals only completed native files and reports shell failure and missing files", async () => {
    const f = fixture();
    const download = f.start();
    await writeFile(download.file, "native bytes");
    await expect(f.action(download.id, "open")).rejects.toThrow();
    download.observe("completed", true);
    expect((await f.list()).entries[0].fileExists).toBe(true);
    await f.action(download.id, "open");
    await f.action(download.id, "reveal");
    expect(f.open).toHaveBeenCalledWith(download.file);
    expect(f.reveal).toHaveBeenCalledWith(download.file);
    f.open.mockResolvedValueOnce("OS could not open the file");
    await expect(f.action(download.id, "open")).rejects.toThrow(
      "could not be opened",
    );
    await rm(download.file);
    expect((await f.list()).entries[0].fileExists).toBe(false);
    await expect(f.action(download.id, "reveal")).rejects.toThrow(
      "unavailable",
    );
  });
  it("removes records and clears terminal history while retaining active items and real file bytes", async () => {
    const f = fixture();
    const complete = f.start("complete");
    const active = f.start("active");
    const cancelled = f.start("cancelled");
    await writeFile(complete.file, "keep this file");
    complete.observe("completed", true);
    cancelled.observe("cancelled", true);
    await expect(f.action(active.id, "remove")).rejects.toThrow("Active");
    await f.action(cancelled.id, "remove");
    expect((await f.list()).total).toBe(2);
    await f.host.invoke("browser_downloads_clear");
    expect((await f.list()).entries.map((entry) => entry.id)).toEqual([
      active.id,
    ]);
    expect(await readFile(complete.file, "utf8")).toBe("keep this file");
    await f.action(active.id, "pause");
    expect(active.item.pause).toHaveBeenCalledOnce();
  });
  it("restores completed files after restart, marks abandoned items interrupted, and never fabricates native resume", async () => {
    const f = fixture();
    const complete = f.start("complete");
    f.start("abandoned");
    await writeFile(complete.file, "persisted");
    complete.observe("completed", true);
    await f.list();
    const restored = fixture();
    const page = await restored.list();
    expect(
      page.entries.find((entry) => entry.id === complete.id),
    ).toMatchObject({ state: "completed", fileExists: true });
    expect(
      page.entries.find((entry) => entry.id === "abandoned"),
    ).toMatchObject({
      state: "interrupted",
      canResume: false,
      canCancel: false,
    });
    await expect(restored.action("abandoned", "resume")).rejects.toThrow(
      "unavailable",
    );
    await restored.action(complete.id, "open");
    expect(restored.open).toHaveBeenCalledWith(complete.file);
  });
  it("rejects arbitrary paths and forged command fields without affecting later valid reads", async () => {
    const f = fixture();
    f.start();
    for (const input of [
      { query: "", path: "/private" },
      { offset: -1 },
      { limit: 1001 },
      { query: [] },
    ])
      await expect(f.list(input)).rejects.toThrow();
    await expect(
      f.action("download-1", "open", { path: "/private" }),
    ).rejects.toThrow();
    await expect(f.action("forged", "cancel")).rejects.toThrow();
    await expect(f.action("download-1", "execute")).rejects.toThrow();
    await expect(
      f.host.invoke("browser_downloads_clear", { all: true }),
    ).rejects.toThrow();
    expect((await f.list()).total).toBe(1);
  });
  it("does not overwrite a corrupt history file with incoming download events", async () => {
    await mkdir(path.join(root, "browser"));
    const file = path.join(root, "browser/downloads.json");
    await writeFile(file, "corrupt");
    const f = fixture();
    f.start();
    await expect(f.list()).rejects.toThrow("corrupt");
    expect(await readFile(file, "utf8")).toBe("corrupt");
  });
  it("retains unsaved native facts and retries after an atomic write failure", async () => {
    let fail = true;
    const io = {
      ...persistedAtomFileIO,
      rename: vi.fn(async (from: string, to: string) => {
        if (fail) throw new Error("disk unavailable");
        await persistedAtomFileIO.rename(from, to);
      }),
    };
    const f = fixture({ store: new BrowserDownloadsStore(root, io) });
    const download = f.start();
    await expect(f.list()).rejects.toThrow("disk unavailable");
    fail = false;
    expect((await f.list()).entries[0].id).toBe(download.id);
    expect(io.rename).toHaveBeenCalledTimes(2);
    expect(f.changed).toHaveBeenCalledOnce();
  });
  it("records only events from native browser entries and keeps stable download identity through permission and done", async () => {
    const f = fixture();
    const session = new EventEmitter();
    let grant!: (value: boolean) => void;
    const permission = new Promise<boolean>((resolve) => {
      grant = resolve;
    });
    let paused = false;
    const item = Object.assign(new EventEmitter(), {
      getFilename: () => "real.txt",
      getURL: () => "https://example.com/real.txt",
      getMimeType: () => "text/plain",
      getReceivedBytes: () => 5,
      getTotalBytes: () => 10,
      getSavePath: () => path.join(root, "real.txt"),
      isPaused: () => paused,
      canResume: () => paused,
      pause: vi.fn(() => {
        paused = true;
      }),
      resume: vi.fn(() => {
        paused = false;
      }),
      cancel: vi.fn(),
    });
    const source = {};
    installEmbeddedBrowserDownloadHandling(
      session as never,
      {
        findEntryByWebContents: (contents) =>
          contents === source
            ? { viewId: "view-1", webContents: source as never }
            : null,
        canDownload: () => permission,
        onDownload: (...args) => f.host.observe(...args),
      },
      () => undefined,
    );
    session.emit("will-download", {}, item, {});
    expect((await f.list()).total).toBe(0);
    session.emit("will-download", {}, item, source);
    const pending = (await f.list()).entries[0];
    expect(pending.canCancel).toBe(false);
    grant(true);
    await permission;
    const allowed = (await f.list()).entries[0];
    expect(allowed).toMatchObject({ id: pending.id, canCancel: true });
    await writeFile(item.getSavePath(), "native");
    item.emit("done", {}, "completed");
    const done = (await f.list()).entries[0];
    expect(done).toMatchObject({
      id: pending.id,
      state: "completed",
      fileExists: true,
      canResume: false,
    });
  });
});
