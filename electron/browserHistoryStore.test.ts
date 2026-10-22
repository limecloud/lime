import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  mkdir,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BrowserHistoryStore } from "./browserHistoryStore";
import { persistedAtomFileIO } from "./persistedAtomFile";
import {
  assertBrowserHistoryPage,
  assertBrowserHistoryMutationResult,
  parseBrowserHistoryQuery,
} from "../src/lib/api/browserHistoryTypes";

let directory: string;
let store: BrowserHistoryStore;
const file = () => path.join(directory, "browser", "history.json");
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "browser-history-"));
  store = new BrowserHistoryStore(directory, { now: () => 100 });
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("BrowserHistoryStore", () => {
  it("starts empty without creating a file on a read", async () => {
    const page = await store.list();
    assertBrowserHistoryPage(page);
    expect(page).toEqual({
      entries: [],
      nextCursor: null,
      total: 0,
      revision: 0,
    });
    expect(await readdir(directory)).toEqual([]);
  });

  it("deduplicates canonical committed URLs, updates counts and title, and survives a fresh owner", async () => {
    const first = await store.recordVisit({
      url: "HTTPS://EXAMPLE.COM:443/app?q=1#section",
      title: "First",
      visitedAt: 10,
    });
    const second = await store.recordVisit({
      url: "https://example.com/app?q=1#section",
      title: "Updated\n title",
      visitedAt: 30,
    });
    expect(second).toEqual({
      ...first,
      title: "Updated title",
      visitCount: 2,
      lastVisitedAt: 30,
    });
    await store.recordVisit({
      url: "https://example.com/app?q=1#other",
      title: "Deep link",
      visitedAt: 20,
    });
    await store.updateTitle(
      "https://example.com/app?q=1#section",
      "Loaded title",
    );
    const restored = await new BrowserHistoryStore(directory).list();
    expect(restored.total).toBe(2);
    expect(restored.entries[0]).toMatchObject({
      id: first!.id,
      title: "Loaded title",
      firstVisitedAt: 10,
      lastVisitedAt: 30,
      visitCount: 2,
    });
    expect(restored.revision).toBe(4);
    const bytes = await readFile(file(), "utf8");
    expect(JSON.parse(bytes).schemaVersion).toBe(1);
    expect(await readdir(path.dirname(file()))).toEqual(["history.json"]);
  });

  it.each([
    "about:blank",
    "file:///private/data",
    "javascript:alert(1)",
    "https://user:secret@example.com",
    "https://user%40name@example.com",
    "not a URL",
    "https://example.com/\nsecret",
  ])("excludes forbidden or credential-bearing URLs: %s", async (url) => {
    expect(await store.recordVisit({ url, title: "ignored" })).toBeNull();
    expect(await store.getRevision()).toBe(0);
    expect(await readdir(directory)).toEqual([]);
  });

  it("serializes concurrent mutations and reads without losing visits or title updates", async () => {
    const operations = Array.from({ length: 30 }, (_, index) =>
      store.recordVisit({ url: "https://example.com", visitedAt: index }),
    );
    operations.push(store.updateTitle("https://example.com", "Final"));
    const reading = store.list();
    await Promise.all(operations);
    const page = await reading;
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]).toMatchObject({
      visitCount: 30,
      firstVisitedAt: 0,
      lastVisitedAt: 29,
      title: "Final",
    });
    expect(page.revision).toBe(31);
    expect((await new BrowserHistoryStore(directory).list()).entries).toEqual(
      page.entries,
    );
  });

  it("paginates a search consistently and rejects a stale or different-query cursor", async () => {
    await store.recordVisit({
      url: "https://a.example.com",
      title: "Project Docs",
      visitedAt: 1,
    });
    await store.recordVisit({
      url: "https://b.example.com",
      title: "Project API",
      visitedAt: 2,
    });
    await store.recordVisit({
      url: "https://c.example.com",
      title: "Unrelated",
      visitedAt: 3,
    });
    const first = await store.list({ query: "  PROJECT  ", limit: 1 });
    expect(first.total).toBe(2);
    expect(first.entries[0].title).toBe("Project API");
    const second = await store.list({
      query: "project",
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second.entries[0].title).toBe("Project Docs");
    expect(second.nextCursor).toBeNull();
    await expect(
      store.list({ query: "different", cursor: first.nextCursor }),
    ).rejects.toThrow("cursor");
    await store.recordVisit({ url: "https://d.example.com", visitedAt: 4 });
    await expect(
      store.list({ query: "project", cursor: first.nextCursor }),
    ).rejects.toThrow("stale");
  });

  it("range clearing removes recent visits while retaining earlier visits to the same URL", async () => {
    const entry = await store.recordVisit({
      url: "https://example.com",
      visitedAt: 10,
    });
    await store.recordVisit({ url: "https://example.com", visitedAt: 20 });
    await store.recordVisit({ url: "https://example.com", visitedAt: 30 });
    await store.recordVisit({
      url: "https://recent.example.com",
      visitedAt: 40,
    });
    expect(await store.clear({ since: 20 })).toMatchObject({
      removedEntries: 1,
      removedVisits: 3,
    });
    expect((await store.list()).entries).toEqual([{ ...entry, visitCount: 1 }]);
    const revision = await store.getRevision();
    expect(await store.clear({ since: 100 })).toMatchObject({
      removedEntries: 0,
      removedVisits: 0,
      revision,
    });
    expect(await store.remove([entry!.id, entry!.id, "missing"])).toMatchObject(
      { removedEntries: 1, removedVisits: 1 },
    );
    expect((await new BrowserHistoryStore(directory).list()).total).toBe(0);
  });

  it("evicts the oldest retained visits and then oldest URLs within explicit budgets", async () => {
    store = new BrowserHistoryStore(directory, { maxEntries: 2, maxVisits: 3 });
    await store.recordVisit({ url: "https://a.example.com", visitedAt: 1 });
    await store.recordVisit({ url: "https://a.example.com", visitedAt: 2 });
    await store.recordVisit({ url: "https://b.example.com", visitedAt: 3 });
    await store.recordVisit({ url: "https://b.example.com", visitedAt: 4 });
    expect(
      (await store.list()).entries.map((entry) => [
        entry.url,
        entry.visitCount,
        entry.firstVisitedAt,
      ]),
    ).toEqual([
      ["https://b.example.com/", 2, 3],
      ["https://a.example.com/", 1, 2],
    ]);
    await store.recordVisit({ url: "https://c.example.com", visitedAt: 5 });
    expect((await store.list()).entries.map((entry) => entry.url)).toEqual([
      "https://c.example.com/",
      "https://b.example.com/",
    ]);
  });

  it.each([
    "{broken",
    JSON.stringify({ schemaVersion: 99, revision: 1, entries: [] }),
    JSON.stringify({
      schemaVersion: 1,
      revision: 0,
      entries: [
        {
          id: "x",
          url: "https://user:secret@example.com",
          title: "",
          visits: [1],
        },
      ],
    }),
  ])("refuses to overwrite corrupt existing history: %s", async (contents) => {
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file(), contents);
    await expect(store.list()).rejects.toThrow("corrupt");
    await expect(
      store.recordVisit({ url: "https://example.com" }),
    ).rejects.toThrow("corrupt");
    await expect(store.clear()).rejects.toThrow("corrupt");
    expect(await readFile(file(), "utf8")).toBe(contents);
  });

  it("keeps disk and memory revision unchanged after failed atomic replacement and allows retry", async () => {
    await store.recordVisit({ url: "https://example.com", visitedAt: 1 });
    const original = await readFile(file(), "utf8");
    let fail = true;
    const rename = vi.fn(async (from: string, to: string) => {
      if (fail) throw Object.assign(new Error("fixture I/O"), { code: "EIO" });
      return persistedAtomFileIO.rename(from, to);
    });
    store = new BrowserHistoryStore(directory, {
      io: { ...persistedAtomFileIO, rename },
    });
    await expect(
      store.recordVisit({ url: "https://other.example.com", visitedAt: 2 }),
    ).rejects.toThrow("could not be saved");
    expect(await readFile(file(), "utf8")).toBe(original);
    expect(await store.getRevision()).toBe(1);
    expect((await store.list()).total).toBe(1);
    expect(await readdir(path.dirname(file()))).toEqual(["history.json"]);
    fail = false;
    await store.recordVisit({ url: "https://other.example.com", visitedAt: 2 });
    expect(await store.getRevision()).toBe(2);
    expect((await new BrowserHistoryStore(directory).list()).total).toBe(2);
  });

  it("retries a transient Windows replacement failure without deleting the existing file", async () => {
    const rename = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("busy"), { code: "EPERM" }),
      )
      .mockImplementation(persistedAtomFileIO.rename);
    const wait = vi.fn().mockResolvedValue(undefined);
    store = new BrowserHistoryStore(directory, {
      platform: "win32",
      wait,
      io: { ...persistedAtomFileIO, rename },
    });
    await store.recordVisit({ url: "https://example.com" });
    expect(rename).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledExactlyOnceWith(50);
    expect((await new BrowserHistoryStore(directory).list()).total).toBe(1);
  });

  it("does not count title-only events as visits or expose mutable store records", async () => {
    await store.recordVisit({ url: "https://example.com" });
    const entry = await store.updateTitle(
      "https://example.com",
      "Actual title",
    );
    expect(entry!.visitCount).toBe(1);
    entry!.title = "mutated caller copy";
    expect((await store.list()).entries[0].title).toBe("Actual title");
    const revision = await store.getRevision();
    await store.updateTitle("https://example.com", "Actual title");
    await store.updateTitle("https://missing.example.com", "Missing");
    expect(await store.getRevision()).toBe(revision);
  });

  it.each([
    { limit: 0 },
    { limit: 201 },
    { limit: 1.5 },
    { query: "x".repeat(257) },
    { cursor: 3 },
    { since: 1 },
    { query: null },
    { limit: null },
  ])("validates history query boundary %j", (input) => {
    expect(() => parseBrowserHistoryQuery(input)).toThrow();
  });

  it("validates public history projections before a renderer consumes them", async () => {
    await store.recordVisit({ url: "https://example.com" });
    const page = await store.list();
    assertBrowserHistoryPage(page);
    expect(() =>
      assertBrowserHistoryPage({
        ...page,
        entries: [{ ...page.entries[0], url: "file:///secret" }],
      }),
    ).toThrow();
    expect(() =>
      assertBrowserHistoryPage({
        ...page,
        entries: [{ ...page.entries[0], lastVisitedAt: -1 }],
      }),
    ).toThrow();
    assertBrowserHistoryMutationResult(await store.clear());
    expect(() =>
      assertBrowserHistoryMutationResult({
        removedEntries: 0,
        removedVisits: "1",
        revision: 1,
      }),
    ).toThrow();
  });

  it("fails closed on invalid UTF-8 and inaccessible history files", async () => {
    for (const readFile of [
      vi.fn().mockResolvedValue(Buffer.from([0xc3, 0x28])),
      vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("denied"), { code: "EACCES" }),
        ),
    ]) {
      const write = vi.fn(persistedAtomFileIO.writeFile);
      const owner = new BrowserHistoryStore(directory, {
        io: { ...persistedAtomFileIO, readFile, writeFile: write },
      });
      await expect(
        owner.recordVisit({ url: "https://example.com" }),
      ).rejects.toThrow("Browser history file");
      await expect(owner.clear()).rejects.toThrow("Browser history file");
      expect(write).not.toHaveBeenCalled();
    }
  });
});
