import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listBrowserHistory,
  listBrowserHistoryVisits,
  removeBrowserHistoryVisits,
} from "./browserHistory";
import {
  assertBrowserHistoryVisitsPage,
  parseBrowserHistoryVisitsQuery,
} from "./browserHistoryVisits";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: invoke,
  safeListen: vi.fn(),
}));
const row = {
  id: "entry-1",
  url: "https://example.com/",
  title: "Example",
  visitTime: new Date(2026, 9, 24, 12).getTime(),
  isActorVisit: true,
};
const page = { entries: [row], total: 1, nextCursor: null, revision: 2 };
beforeEach(() => {
  invoke.mockReset();
});
describe("history visit IPC contract", () => {
  it("uses the same history owner for validated URL summaries and rejects malformed results", async () => {
    const summary = {
      entries: [
        {
          id: "summary-1",
          url: row.url,
          title: row.title,
          visitCount: 2,
          firstVisitedAt: 1,
          lastVisitedAt: 2,
        },
      ],
      total: 1,
      nextCursor: null,
      revision: 3,
    };
    invoke.mockResolvedValue(summary);
    expect(await listBrowserHistory({ query: " EXAMPLE ", limit: 50 })).toBe(
      summary,
    );
    expect(invoke).toHaveBeenCalledExactlyOnceWith("browser_history_list", {
      query: "example",
      cursor: null,
      limit: 50,
    });
    invoke.mockResolvedValue({
      ...summary,
      entries: [{ ...summary.entries[0], url: "file:///private" }],
    });
    await expect(listBrowserHistory()).rejects.toThrow();
    invoke.mockClear();
    await expect(
      listBrowserHistory({ query: "x".repeat(257) }),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("uses the existing list command with an explicit native visit view and normalized query", async () => {
    invoke.mockResolvedValue(page);
    expect(
      await listBrowserHistoryVisits({ query: " EXAMPLE ", source: "agent" }),
    ).toBe(page);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("browser_history_list", {
      view: "visits",
      query: "example",
      source: "agent",
      cursor: null,
      limit: 50,
    });
  });
  it("deduplicates removal by URL/local day and rejects a malformed entire batch before IPC", async () => {
    invoke.mockResolvedValue({
      removedEntries: 0,
      removedVisits: 2,
      revision: 3,
    });
    await removeBrowserHistoryVisits([
      { url: row.url, visitTime: row.visitTime },
      { url: row.url, visitTime: row.visitTime + 1000 },
    ]);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("browser_history_remove", {
      entries: [{ url: row.url, visitTime: row.visitTime + 1000 }],
    });
    invoke.mockClear();
    await expect(
      removeBrowserHistoryVisits([
        { url: row.url, visitTime: row.visitTime },
        { url: "file:///private", visitTime: row.visitTime },
      ]),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("validates visit identities, source metadata, calendar timestamps and duplicate day/source rows", () => {
    assertBrowserHistoryVisitsPage(page);
    for (const value of [
      { ...page, entries: [{ ...row, isActorVisit: "agent" }] },
      { ...page, entries: [{ ...row, visitTime: Number.MAX_SAFE_INTEGER }] },
      {
        ...page,
        entries: [row, { ...row, visitTime: row.visitTime + 1 }],
        total: 2,
      },
      { ...page, entries: [{ ...row, path: "/private" }] },
    ])
      expect(() => assertBrowserHistoryVisitsPage(value)).toThrow();
    expect(() =>
      parseBrowserHistoryVisitsQuery({ source: "unknown" }),
    ).toThrow();
    expect(() =>
      parseBrowserHistoryVisitsQuery({ source: "all", path: "/private" }),
    ).toThrow();
  });
  it("rejects a malformed native result and propagates native mutation failure", async () => {
    invoke.mockResolvedValue({
      ...page,
      entries: [{ ...row, url: "file:///private" }],
    });
    await expect(listBrowserHistoryVisits()).rejects.toThrow();
    invoke.mockRejectedValue(new Error("disk unavailable"));
    await expect(
      removeBrowserHistoryVisits([{ url: row.url, visitTime: row.visitTime }]),
    ).rejects.toThrow("disk unavailable");
  });
});
