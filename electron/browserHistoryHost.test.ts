// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserHistoryHost } from "./browserHistoryHost";
import { BrowserHistoryStore } from "./browserHistoryStore";
import type { BrowserHistoryPage } from "../src/lib/api/browserHistoryTypes";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "browser-history-host-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
function fixture() {
  const changed = vi.fn();
  const createStore = vi.fn(
    () => new BrowserHistoryStore(directory, { now: () => 100 }),
  );
  const host = new BrowserHistoryHost(changed, { createStore });
  return {
    host,
    changed,
    createStore,
    list: () =>
      host.invoke("browser_history_list") as Promise<BrowserHistoryPage>,
  };
}

describe("browser history native owner", () => {
  it("initializes lazily and records committed visits separately from matching title updates", async () => {
    const f = fixture();
    expect(f.createStore).not.toHaveBeenCalled();
    await f.host.titleUpdated("view-1", "https://example.com/", "Uncommitted");
    await f.host.committed("view-1", { url: "about:blank" });
    expect(f.createStore).not.toHaveBeenCalled();
    const committed = f.host.committed("view-1", {
      url: "https://example.com/",
      title: "Old",
    });
    const title = f.host.titleUpdated(
      "view-1",
      "https://example.com/",
      "Loaded",
    );
    await f.host.titleUpdated(
      "view-1",
      "https://uncommitted.example/",
      "Wrong page",
    );
    await Promise.all([committed, title]);
    const page = await f.list();
    expect(page.entries).toEqual([
      expect.objectContaining({
        url: "https://example.com/",
        title: "Loaded",
        visitCount: 1,
      }),
    ]);
    expect(f.changed.mock.calls).toEqual([[1], [2]]);
    await f.host.titleUpdated("view-1", "https://example.com/", "Loaded");
    expect(f.changed).toHaveBeenCalledTimes(2);
    f.host.forget("view-1");
    await f.host.titleUpdated("view-1", "https://example.com/", "Late");
    expect((await f.list()).entries[0].title).toBe("Loaded");
  });

  it("serializes visits, mutations and reads and emits only finite revision notifications", async () => {
    const f = fixture();
    void f.host.committed("view-1", { url: "https://one.example/" });
    void f.host.committed("view-1", { url: "https://two.example/" });
    const before = await f.list();
    expect(before.entries).toHaveLength(2);
    expect(
      await f.host.invoke("browser_history_remove", {
        entries: [
          {
            url: before.entries[0].url,
            visitTime: before.entries[0].lastVisitedAt,
          },
        ],
      }),
    ).toMatchObject({ removedEntries: 1, removedVisits: 1, revision: 3 });
    expect(
      await f.host.invoke("browser_history_clear", { since: 100 }),
    ).toEqual({ removedEntries: 1, removedVisits: 1, revision: 4 });
    expect((await f.list()).entries).toEqual([]);
    expect(f.changed.mock.calls).toEqual([[1], [2], [3], [4]]);
  });

  it("rejects user paths and malformed command payloads without breaking later reads", async () => {
    const f = fixture();
    await expect(
      f.host.invoke("browser_history_list", { path: "/private" }),
    ).rejects.toThrow();
    await expect(
      f.host.invoke("browser_history_remove", { ids: [], path: "/private" }),
    ).rejects.toThrow();
    await expect(
      f.host.invoke("browser_history_remove", { ids: "all" }),
    ).rejects.toThrow();
    await expect(
      f.host.invoke("browser_history_clear", { since: -1 }),
    ).rejects.toThrow();
    expect((await f.list()).revision).toBe(0);
    expect(f.createStore).toHaveBeenCalledTimes(1);
  });

  it("rejects obsolete and mixed removal payloads and invalid visit views before any mutation", async () => {
    const f = fixture();
    await f.host.committed("view-1", {
      url: "https://example.com/",
      isActorVisit: true,
    });
    const before = await f.list();
    const entries = [
      {
        url: before.entries[0].url,
        visitTime: before.entries[0].lastVisitedAt,
      },
    ];
    for (const args of [
      { ids: [before.entries[0].id] },
      { entries, ids: [] },
      { entries: [...entries, { url: "file:///private", visitTime: 100 }] },
    ]) {
      await expect(
        f.host.invoke("browser_history_remove", args),
      ).rejects.toThrow();
    }
    for (const args of [
      { view: "unknown" },
      { view: "visits", source: "unknown" },
      { source: "agent" },
    ]) {
      await expect(
        f.host.invoke("browser_history_list", args),
      ).rejects.toThrow();
    }
    expect(await f.list()).toEqual(before);
    expect(f.changed.mock.calls).toEqual([[1]]);
    expect(
      await f.host.invoke("browser_history_list", {
        view: "visits",
        source: "agent",
      }),
    ).toMatchObject({
      total: 1,
      entries: [expect.objectContaining({ isActorVisit: true })],
    });
  });
});
