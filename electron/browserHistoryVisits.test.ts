// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserHistoryStore } from "./browserHistoryStore";

let directory: string;
let store: BrowserHistoryStore;
const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).getTime();
const url = "https://example.com/docs?q=history#section";
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "browser-history-visits-"));
  store = new BrowserHistoryStore(directory);
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("history visit management in the canonical store", () => {
  it("retains separate days and sources while the Agent reads the same URL summary", async () => {
    await store.recordVisit({ url, visitedAt: at(22), title: "Docs" });
    await store.recordVisit({ url, visitedAt: at(23, 9) });
    await store.recordVisit({ url, visitedAt: at(23, 10) });
    await store.recordVisit({ url, visitedAt: at(23, 11), isActorVisit: true });
    const visits = await store.listVisits();
    expect(
      visits.entries.map(({ visitTime, isActorVisit }) => [
        visitTime,
        isActorVisit,
      ]),
    ).toEqual([
      [at(23, 11), true],
      [at(23, 10), false],
      [at(22), false],
    ]);
    expect(visits.total).toBe(3);
    expect((await store.list()).entries).toEqual([
      expect.objectContaining({
        url,
        visitCount: 4,
        firstVisitedAt: at(22),
        lastVisitedAt: at(23, 11),
      }),
    ]);
  });

  it("filters before paging and binds cursors to the source, query, view and revision", async () => {
    await store.recordVisit({
      url,
      title: "Docs",
      visitedAt: at(22),
      isActorVisit: true,
    });
    await store.recordVisit({ url, visitedAt: at(23), isActorVisit: true });
    await store.recordVisit({
      url: "https://other.example/",
      visitedAt: at(24),
    });
    const first = await store.listVisits({
      source: "agent",
      query: "DOCS",
      limit: 1,
    });
    expect(first.total).toBe(2);
    const second = await store.listVisits({
      source: "agent",
      query: "docs",
      cursor: first.nextCursor,
      limit: 1,
    });
    expect(second.entries[0].visitTime).toBe(at(22));
    expect(second.nextCursor).toBeNull();
    await expect(
      store.listVisits({
        source: "other",
        query: "docs",
        cursor: first.nextCursor,
      }),
    ).rejects.toThrow("cursor");
    await expect(
      store.listVisits({
        source: "agent",
        query: "other",
        cursor: first.nextCursor,
      }),
    ).rejects.toThrow("cursor");
    await expect(
      store.list({ query: "docs", cursor: first.nextCursor }),
    ).rejects.toThrow("cursor");
    await store.recordVisit({ url, visitedAt: at(24), isActorVisit: true });
    await expect(
      store.listVisits({
        source: "agent",
        query: "docs",
        cursor: first.nextCursor,
      }),
    ).rejects.toThrow("stale");
  });

  it("removes the selected URL/day across sources once and retains other days and URLs after restart", async () => {
    await store.recordVisit({ url, visitedAt: at(22) });
    await store.recordVisit({ url, visitedAt: at(23, 0), isActorVisit: true });
    await store.recordVisit({ url, visitedAt: at(23, 23) });
    await store.recordVisit({ url, visitedAt: at(24, 0) });
    await store.recordVisit({
      url: "https://other.example/",
      visitedAt: at(23),
    });
    const result = await store.removeVisits([
      { url, visitTime: at(23, 0) },
      { url, visitTime: at(23, 23) },
    ]);
    expect(result).toMatchObject({ removedEntries: 0, removedVisits: 2 });
    const restored = new BrowserHistoryStore(directory);
    expect(
      (await restored.listVisits()).entries.map((entry) => [
        entry.url,
        entry.visitTime,
      ]),
    ).toEqual([
      [url, at(24, 0)],
      ["https://other.example/", at(23)],
      [url, at(22)],
    ]);
    expect(
      (await restored.list()).entries.find((entry) => entry.url === url)
        ?.visitCount,
    ).toBe(2);
  });

  it("validates the entire removal batch before deleting and rejects malformed source queries", async () => {
    await store.recordVisit({ url, visitedAt: at(23) });
    const before = await store.list();
    await expect(
      store.removeVisits([
        { url, visitTime: at(23) },
        { url: "file:///private", visitTime: at(23) },
      ]),
    ).rejects.toThrow();
    await expect(
      store.removeVisits([{ url, visitTime: Number.MAX_SAFE_INTEGER }]),
    ).rejects.toThrow();
    await expect(
      store.listVisits({ source: "forged" as never }),
    ).rejects.toThrow();
    expect(await store.list()).toEqual(before);
  });

  it("persists native attribution, and title changes neither invent visits nor alter source", async () => {
    await store.recordVisit({ url, visitedAt: at(23), isActorVisit: true });
    await store.updateTitle(url, "Loaded title");
    const restored = new BrowserHistoryStore(directory);
    expect((await restored.listVisits({ source: "agent" })).entries).toEqual([
      expect.objectContaining({
        title: "Loaded title",
        visitTime: at(23),
        isActorVisit: true,
      }),
    ]);
    expect((await restored.listVisits({ source: "other" })).total).toBe(0);
    expect((await restored.list()).entries[0].visitCount).toBe(1);
    const disk = JSON.parse(
      await readFile(path.join(directory, "browser/history.json"), "utf8"),
    );
    expect(disk.schemaVersion).toBe(2);
    expect(disk.entries[0].visits).toEqual([
      { visitedAt: at(23), isActorVisit: true },
    ]);
  });

  it("keeps attribution attached to each visit during budget eviction and range clearing", async () => {
    store = new BrowserHistoryStore(directory, { maxVisits: 2 });
    await store.recordVisit({ url, visitedAt: at(22), isActorVisit: true });
    await store.recordVisit({ url, visitedAt: at(23) });
    await store.recordVisit({ url, visitedAt: at(24), isActorVisit: true });
    expect(
      (await store.listVisits({ source: "agent" })).entries.map(
        (entry) => entry.visitTime,
      ),
    ).toEqual([at(24)]);
    await store.clear({ since: at(24, 0) });
    expect(
      (await new BrowserHistoryStore(directory).listVisits()).entries,
    ).toEqual([
      expect.objectContaining({ visitTime: at(23), isActorVisit: false }),
    ]);
  });

  it("rejects forged source metadata before persisting a visit", async () => {
    await expect(
      store.recordVisit({ url, isActorVisit: "agent" as never }),
    ).rejects.toThrow();
    expect((await store.list()).revision).toBe(0);
  });
});
