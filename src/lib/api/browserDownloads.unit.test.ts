import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearBrowserDownloads,
  listBrowserDownloads,
  manageBrowserDownload,
  listenBrowserDownloadsChanged,
} from "./browserDownloads";
import {
  assertBrowserDownloadsPage,
  assertBrowserDownloadsChange,
  parseBrowserDownloadsQuery,
} from "./browserDownloadsTypes";
const { invoke, listen } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("@/lib/dev-bridge", () => ({ safeInvoke: invoke, safeListen: listen }));
beforeEach(() => vi.clearAllMocks());
const entry = {
  id: "download",
  url: "https://example.com/file",
  filename: "file.txt",
  mimeType: "text/plain",
  state: "completed",
  receivedBytes: 10,
  totalBytes: 10,
  startedAt: 100,
  updatedAt: 200,
  canPause: false,
  canResume: false,
  canCancel: false,
  fileExists: true,
};
const page = () => ({
  entries: [{ ...entry }],
  total: 1,
  nextOffset: null,
  revision: 1,
  historyRevision: 1,
});
describe("Browser download typed gateway", () => {
  it("normalizes queries and uses the actual Desktop Host list boundary", async () => {
    invoke.mockResolvedValue(page());
    expect(
      (await listBrowserDownloads({ query: "  ＦＩＬＥ  " })).entries[0],
    ).toEqual(entry);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("browser_downloads_list", {
      query: "file",
      offset: 0,
      limit: 100,
    });
  });
  it("sends only controlled id/actions and treats false or missing acknowledgements as failures", async () => {
    invoke.mockResolvedValue({ ok: true });
    await manageBrowserDownload("download", "open");
    await clearBrowserDownloads();
    expect(invoke.mock.calls).toEqual([
      ["browser_downloads_action", { id: "download", action: "open" }],
      ["browser_downloads_clear", {}],
    ]);
    for (const result of [
      { ok: false },
      null,
      true,
      { ok: true, path: "/private" },
    ]) {
      invoke.mockResolvedValue(result);
      await expect(manageBrowserDownload("download", "open")).rejects.toThrow();
    }
  });
  it("fails closed on missing transport and delegates live event disposal", async () => {
    invoke.mockRejectedValue(new Error("No Desktop Host"));
    await expect(listBrowserDownloads()).rejects.toThrow("No Desktop Host");
    const handler = vi.fn();
    const stop = vi.fn();
    listen.mockResolvedValue(stop);
    expect(await listenBrowserDownloadsChanged(handler)).toBe(stop);
    expect(listen).toHaveBeenCalledWith(
      "browser-downloads-changed",
      expect.any(Function),
    );
    const receive = listen.mock.calls[0][1];
    const change = {
      kind: "updated",
      revision: 2,
      historyRevision: 1,
      entries: [entry],
      removedIds: [],
    };
    receive({ payload: change });
    expect(handler).toHaveBeenLastCalledWith(change);
    receive({ payload: { ...change, savePath: "/private" } });
    expect(handler).toHaveBeenLastCalledWith({ kind: "invalidated" });
  });
  it.each([
    { query: [] },
    { limit: 0 },
    { offset: -1 },
    { limit: 1001 },
    { path: "/private" },
  ])("rejects malformed query %j before any IPC", (input) => {
    expect(() => parseBrowserDownloadsQuery(input)).toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("rejects duplicate identities, private paths, invalid capabilities and pagination metadata", () => {
    assertBrowserDownloadsPage(page());
    for (const invalid of [
      { ...page(), entries: [entry, entry], total: 2 },
      { ...page(), entries: [{ ...entry, savePath: "/private" }] },
      { ...page(), entries: [{ ...entry, canResume: "yes" }] },
      { ...page(), entries: [{ ...entry, updatedAt: 99 }] },
      { ...page(), nextOffset: 1 },
      { ...page(), revision: -1 },
      { ...page(), historyRevision: undefined },
      { ...page(), historyRevision: 2 },
    ])
      expect(() => assertBrowserDownloadsPage(invalid)).toThrow();
  });
  it("rejects malformed or private deltas and overlapping identities", () => {
    const change = {
      kind: "updated",
      revision: 2,
      historyRevision: 1,
      entries: [entry],
      removedIds: [],
    };
    assertBrowserDownloadsChange(change);
    assertBrowserDownloadsChange({ kind: "invalidated" });
    for (const invalid of [
      undefined,
      { kind: "invalidated", revision: 1 },
      { ...change, historyRevision: 3 },
      { ...change, entries: [{ ...entry, resume: {} }] },
      { ...change, entries: [entry, entry] },
      { ...change, removedIds: [entry.id] },
      { ...change, removedIds: ["removed", "removed"] },
      { ...change, removedIds: [null] },
    ])
      expect(() => assertBrowserDownloadsChange(invalid)).toThrow();
  });
});
