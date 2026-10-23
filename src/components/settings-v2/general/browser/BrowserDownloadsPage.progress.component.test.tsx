import { act } from "react";
import { describe, expect, it } from "vitest";
import type { BrowserDownloadsPage } from "@/lib/api/browserDownloads";
import { deferred } from "@/components/agent/chat/workspace/right-surface/browser/browserWorkspace.testFixtures";
import {
  service,
  now,
  receive,
  entry,
  page,
  row,
  button,
  click,
  flush,
  render,
  harness,
  search,
  setupBrowserDownloadsPageTests,
} from "./browserDownloadsPage.testFixtures";

setupBrowserDownloadsPageTests();
const active = (bytes: number) =>
  entry("live", {
    state: "progressing",
    receivedBytes: bytes,
    totalBytes: 100,
    canPause: true,
    canCancel: true,
    fileExists: false,
    updatedAt: now + bytes,
  });
const changed = (
  revision: number,
  receivedBytes: number,
  historyRevision = 1,
) => ({
  kind: "updated" as const,
  revision,
  historyRevision,
  entries: [active(receivedBytes)],
  removedIds: [],
});
const progress = () => row("live").querySelector("progress")?.value;

describe("download progress during history pagination", () => {
  it("keeps the pending second page and applies live bytes without rereading history", async () => {
    const pending = deferred<BrowserDownloadsPage>();
    service.list
      .mockResolvedValueOnce(page([active(10)], 100))
      .mockReturnValueOnce(pending.promise);
    await render();
    await flush();
    await click(button("Load more"));
    await act(async () => {
      receive(changed(2, 20));
      receive(changed(3, 30));
    });
    expect(service.list).toHaveBeenCalledTimes(2);
    expect(progress()).toBe(30);
    await act(async () => pending.resolve(page([entry("second")], null, 2, 1)));
    expect(row("second")).not.toBeNull();
    expect(progress()).toBe(30);
    expect(service.list).toHaveBeenCalledTimes(2);
  });

  it("overlays progress received between pages of a full refresh", async () => {
    const pending = deferred<BrowserDownloadsPage>();
    service.list
      .mockResolvedValueOnce(page([active(10)], 100))
      .mockResolvedValueOnce(page([entry("second")]))
      .mockResolvedValueOnce(page([active(10)], 100))
      .mockReturnValueOnce(pending.promise);
    await render();
    await flush();
    await click(button("Load more"));
    await act(async () => receive());
    await act(async () => receive(changed(2, 40)));
    await act(async () => pending.resolve(page([entry("second")], null, 3, 1)));
    expect(row("second")).not.toBeNull();
    expect(progress()).toBe(40);
    expect(service.list).toHaveBeenCalledTimes(4);
  });

  it("ignores out-of-order deltas and refreshes for a status or membership change", async () => {
    const paused = {
      ...active(50),
      state: "paused" as const,
      canPause: false,
      canResume: true,
    };
    service.list
      .mockResolvedValueOnce(page([active(10)]))
      .mockResolvedValueOnce(page([paused], null, 4));
    await render();
    await flush();
    await act(async () => {
      receive(changed(3, 50));
      receive(changed(2, 20));
    });
    expect(progress()).toBe(50);
    expect(service.list).toHaveBeenCalledOnce();
    await act(async () => receive({ ...changed(4, 50, 4), entries: [paused] }));
    expect(service.list).toHaveBeenCalledTimes(2);
    expect(button("Resume live.pdf")).not.toBeNull();
    service.list.mockResolvedValueOnce(page([], null, 5));
    await act(async () =>
      receive({
        kind: "updated",
        revision: 5,
        historyRevision: 5,
        entries: [],
        removedIds: ["live"],
      }),
    );
    expect(row("live")).toBeNull();
    expect(service.list).toHaveBeenCalledTimes(3);
  });

  it("preserves historical file availability and excludes unrelated live ids from search", async () => {
    service.list
      .mockResolvedValueOnce(page([entry("report", { fileExists: false })]))
      .mockResolvedValue(
        page([entry("report", { fileExists: false })], null, 2, 1),
      );
    await render();
    await flush();
    await act(async () =>
      receive({
        ...changed(2, 10),
        entries: [entry("report", { receivedBytes: 4096, updatedAt: now + 1 })],
      }),
    );
    expect(row("report").textContent).toContain("File deleted");
    await harness.change(search(), "report");
    await flush(200);
    const calls = service.list.mock.calls.length;
    await act(async () => receive(changed(3, 30)));
    expect(row("live")).toBeNull();
    expect(service.list).toHaveBeenCalledTimes(calls);
  });
});
