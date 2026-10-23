import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  BrowserDownloadEntry,
  BrowserDownloadsPage as DownloadsPage,
} from "@/lib/api/browserDownloads";
import { deferred } from "@/components/agent/chat/workspace/right-surface/browser/browserWorkspace.testFixtures";
import {
  service,
  now,
  harness,
  receive,
  stop,
  onBack,
  entry,
  page,
  root,
  search,
  row,
  button,
  click,
  flush,
  render,
  setupBrowserDownloadsPageTests,
} from "./browserDownloadsPage.testFixtures";

setupBrowserDownloadsPageTests();

describe("BrowserDownloadsPage", () => {
  it("loads a 100-record page, focuses search, and returns to Browser settings", async () => {
    const pending = deferred<DownloadsPage>();
    service.list.mockReturnValue(pending.promise);
    await render();
    expect(root().textContent).toContain("Loading downloads…");
    expect(document.activeElement).toBe(search());
    await flush();
    expect(service.list).toHaveBeenCalledExactlyOnceWith({
      query: "",
      offset: 0,
      limit: 100,
    });
    await act(async () => pending.resolve(page()));
    expect(row("report").querySelector("time")?.dateTime).toBe(
      new Date(now).toISOString(),
    );
    expect(row("report").textContent).not.toContain(entry().url);
    await click(button("Back to Browser settings"));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("shows a distinct empty state and search-with-no-results state", async () => {
    service.list.mockResolvedValue(page([]));
    await render();
    await flush();
    expect(root().textContent).toContain("No downloads yet");
    expect(root().textContent).toContain(
      "Files downloaded from the built-in browser will appear here",
    );
    expect(button("Clear all").disabled).toBe(true);
    await harness.change(search(), "missing");
    await flush(199);
    expect(service.list).toHaveBeenCalledOnce();
    await flush(1);
    expect(service.list).toHaveBeenNthCalledWith(2, {
      query: "missing",
      offset: 0,
      limit: 100,
    });
    expect(root().textContent).toContain("No matching downloads");
    expect(root().textContent).toContain(
      "Try searching for a different filename or address",
    );
  });

  it("debounces every edited query for 200ms and rejects a slower previous result", async () => {
    const old = deferred<DownloadsPage>();
    const latest = deferred<DownloadsPage>();
    service.list.mockImplementation(({ query }) =>
      query === "old"
        ? old.promise
        : query === "new"
          ? latest.promise
          : Promise.resolve(page()),
    );
    await render();
    await flush();
    await harness.change(search(), "o");
    await flush(100);
    await harness.change(search(), "old");
    await flush(199);
    expect(service.list).toHaveBeenCalledOnce();
    await flush(1);
    await harness.change(search(), "new");
    await flush(200);
    await act(async () => latest.resolve(page([entry("new")], null, 3)));
    await act(async () => old.resolve(page([entry("old")], null, 2)));
    expect(row("new")).not.toBeNull();
    expect(row("old")).toBeNull();
    await harness.change(search(), "");
    await flush(199);
    expect(service.list).toHaveBeenCalledTimes(5);
    await flush(1);
    expect(service.list).toHaveBeenLastCalledWith({
      query: "",
      offset: 0,
      limit: 100,
    });
  });

  it("does not let an in-flight query overwrite a newer live download snapshot", async () => {
    const stale = deferred<DownloadsPage>();
    let reads = 0;
    service.list.mockImplementation(({ query }) => {
      if (!query) return Promise.resolve(page());
      if (++reads === 1) return stale.promise;
      return Promise.resolve(
        page(
          [
            entry("live", {
              state: "progressing",
              receivedBytes: 1024,
              canPause: true,
              canCancel: true,
            }),
          ],
          null,
          3,
        ),
      );
    });
    await render();
    await flush();
    await harness.change(search(), "live");
    await flush(200);
    await act(async () => {
      receive();
      stale.resolve(page([entry("stale")], null, 2));
    });
    expect(service.list).toHaveBeenCalledWith({
      query: "live",
      offset: 0,
      limit: 100,
    });
    expect(row("live").textContent).toContain("Downloading");
    expect(row("stale")).toBeNull();
    expect(row("live").querySelector("progress")?.value).toBe(50);
    expect(row("live").querySelector("progress")?.max).toBe(100);
    expect(
      row("live").querySelector("progress")?.getAttribute("aria-label"),
    ).toBe("Download progress for live.pdf");
  });

  it("uses the latest query during a debounced live update and never refetches an old query", async () => {
    await render();
    await flush();
    await harness.change(search(), "latest");
    await act(async () => receive());
    await flush(199);
    expect(service.list).toHaveBeenCalledOnce();
    await flush(1);
    expect(service.list).toHaveBeenCalledWith({
      query: "latest",
      offset: 0,
      limit: 100,
    });
  });

  it("groups records by local day, sorts newest first, and expands only the first group by default", async () => {
    const yesterday = new Date(2026, 9, 21, 20).getTime();
    const earlyToday = new Date(2026, 9, 22, 1).getTime();
    service.list.mockResolvedValue(
      page([
        entry("yesterday", { startedAt: yesterday }),
        entry("early", { startedAt: earlyToday }),
        entry("latest"),
      ]),
    );
    await render();
    await flush();
    const groups = [
      ...root().querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
    ];
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.getAttribute("aria-expanded"))).toEqual([
      "true",
      "false",
    ]);
    expect(groups[0].textContent).toContain(
      new Intl.DateTimeFormat("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(now),
    );
    expect(
      [...root().querySelectorAll("[data-download-id]")].map((item) =>
        item.getAttribute("data-download-id"),
      ),
    ).toEqual(["latest", "early", "yesterday"]);
    expect(row("yesterday").closest("ul")?.hidden).toBe(true);
    await click(groups[1]);
    expect(row("yesterday").closest("ul")?.hidden).toBe(false);
    await click(groups[0]);
    expect(row("latest").closest("ul")?.hidden).toBe(true);
  });

  it("scopes date-group choices to their search and preserves them during live refresh", async () => {
    const older = entry("yesterday", { startedAt: now - 86400000 });
    let newer: BrowserDownloadEntry[] = [];
    service.list.mockImplementation(({ query }) =>
      Promise.resolve(page(query ? [...newer, entry()] : [entry(), older])),
    );
    await render();
    await flush();
    const groups = () => [
      ...root().querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
    ];
    await click(groups()[0]);
    await click(groups()[1]);
    expect(row("report").closest("ul")?.hidden).toBe(true);
    await harness.change(search(), "report");
    await flush(200);
    expect(row("report").closest("ul")?.hidden).toBe(false);
    await click(groups()[0]);
    await act(async () => receive());
    expect(row("report").closest("ul")?.hidden).toBe(true);
    newer = [entry("report-next", { startedAt: now + 86400000 })];
    await act(async () => receive());
    expect(row("report-next").closest("ul")?.hidden).toBe(true);
    await harness.change(search(), "");
    await flush(200);
    expect(
      groups().map((group) => group.getAttribute("aria-expanded")),
    ).toEqual(["true", "false"]);
    expect(row("report").closest("ul")?.hidden).toBe(false);
    expect(row("yesterday").closest("ul")?.hidden).toBe(true);
  });

  it("loads the next 100-record page and retains current rows when more fails before retry", async () => {
    service.list
      .mockResolvedValueOnce(page([entry("first")], 100))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(
        page([entry("second", { startedAt: now - 1000 })]),
      );
    await render();
    await flush();
    await click(button("Load more"));
    expect(row("first")).not.toBeNull();
    expect(root().textContent).toContain("Could not load more downloads");
    await click(button("Retry loading more"));
    expect(service.list).toHaveBeenNthCalledWith(3, {
      query: "",
      offset: 100,
      limit: 100,
    });
    expect(row("first")).not.toBeNull();
    expect(row("second")).not.toBeNull();
    expect(root().querySelector("[role=alert]")).toBeNull();
  });

  it("loads on scroll intersection, prevents duplicate reads, and pauses automatic pagination after failure", async () => {
    let notify: (
      entries: IntersectionObserverEntry[],
      observer: IntersectionObserver,
    ) => void;
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof notify) {
          notify = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const pending = deferred<DownloadsPage>();
    service.list
      .mockResolvedValueOnce(page([entry("first")], 100))
      .mockReturnValueOnce(pending.promise);
    await render();
    await flush();
    expect(observe).toHaveBeenCalledWith(
      harness.query("browser-downloads-more"),
    );
    const intersect = () =>
      notify(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    await act(async () => {
      intersect();
      intersect();
    });
    expect(service.list).toHaveBeenCalledTimes(2);
    expect(disconnect).toHaveBeenCalledOnce();
    await act(async () => pending.reject(new Error("page read failed")));
    await act(async () => intersect());
    expect(service.list).toHaveBeenCalledTimes(2);
    expect(row("first")).not.toBeNull();
    service.list.mockResolvedValueOnce(page([entry("second")]));
    await click(button("Retry loading more"));
    expect(row("second")).not.toBeNull();
    expect(root().querySelector("[role=alert]")).toBeNull();
  });

  it("refreshes every loaded page on change and preserves a collapsed date group", async () => {
    const first = Array.from({ length: 100 }, (_, index) =>
      entry(`first-${index}`, { startedAt: now - index }),
    );
    const second = entry("second", { startedAt: now - 86400000 });
    service.list
      .mockResolvedValueOnce(page(first, 100))
      .mockResolvedValueOnce(page([second]));
    await render();
    await flush();
    await click(button("Load more"));
    const firstGroup = root().querySelector<HTMLButtonElement>(
      "button[aria-expanded]",
    )!;
    await click(firstGroup);
    service.list
      .mockResolvedValueOnce(
        page(
          first.map((item) => ({ ...item, receivedBytes: 4096 })),
          100,
          2,
        ),
      )
      .mockResolvedValueOnce(page([second], null, 2));
    await act(async () => receive());
    expect(service.list).toHaveBeenNthCalledWith(3, {
      query: "",
      offset: 0,
      limit: 100,
    });
    expect(service.list).toHaveBeenNthCalledWith(4, {
      query: "",
      offset: 100,
      limit: 100,
    });
    expect(root().querySelectorAll("[data-download-id]")).toHaveLength(101);
    expect(
      root()
        .querySelector("button[aria-expanded]")
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("rejects an old pagination response after search changes", async () => {
    const pending = deferred<DownloadsPage>();
    service.list
      .mockResolvedValueOnce(page([entry("first")], 100))
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(page([entry("searched")], null, 2));
    await render();
    await flush();
    await click(button("Load more"));
    await harness.change(search(), "searched");
    await flush(200);
    await act(async () => pending.resolve(page([entry("old-page")])));
    expect(row("searched")).not.toBeNull();
    expect(row("old-page")).toBeNull();
    expect(row("first")).toBeNull();
  });

  it("shows an initial load error without pretending the download list is empty, then retries", async () => {
    service.list
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockResolvedValueOnce(page());
    await render();
    await flush();
    expect(root().textContent).toContain("Could not load downloads");
    expect(root().textContent).not.toContain("No downloads yet");
    await click(button("Retry"));
    expect(row("report")).not.toBeNull();
    expect(root().querySelector("[role=alert]")).toBeNull();
  });

  it("keeps the current list on failed or regressing live refresh and permits retry", async () => {
    service.list
      .mockResolvedValueOnce(page([entry("latest")], null, 5))
      .mockRejectedValueOnce(new Error("read failed"))
      .mockResolvedValueOnce(page([entry("stale")], null, 4))
      .mockResolvedValueOnce(page([entry("fresh")], null, 6));
    await render();
    await flush();
    await act(async () => receive());
    expect(row("latest")).not.toBeNull();
    await click(button("Retry"));
    expect(row("latest")).not.toBeNull();
    expect(row("stale")).toBeNull();
    await click(button("Retry"));
    expect(row("fresh")).not.toBeNull();
    expect(row("latest")).toBeNull();
  });

  it("only exposes actions allowed by download capabilities and completed file existence", async () => {
    service.list.mockResolvedValue(
      page([
        entry("active", {
          state: "progressing",
          canPause: true,
          canCancel: true,
        }),
        entry("paused", { state: "paused", canResume: true, canCancel: true }),
        entry("missing", { fileExists: false }),
        entry("cancelled", { state: "cancelled" }),
        entry("report"),
      ]),
    );
    await render();
    await flush();
    expect(button("Pause active.pdf").disabled).toBe(false);
    expect(button("Cancel active.pdf").disabled).toBe(false);
    expect(button("Resume paused.pdf").disabled).toBe(false);
    expect(
      row("active").querySelector('[aria-label="Open active.pdf"]'),
    ).toBeNull();
    expect(row("active").querySelector('[aria-label^="Show "]')).toBeNull();
    expect(row("active").querySelector('[aria-label^="Remove "]')).toBeNull();
    expect(
      row("missing").querySelector('[aria-label="Open missing.pdf"]'),
    ).toBeNull();
    expect(
      row("missing").querySelector('[title="missing.pdf"]')?.className,
    ).toContain("line-through");
    expect(row("missing").textContent).toContain("File deleted");
    expect(row("missing").querySelector('[aria-label^="Show "]')).toBeNull();
    expect(button("Remove missing.pdf from history")).not.toBeNull();
    expect(
      row("cancelled").querySelector('[aria-label="Open cancelled.pdf"]'),
    ).toBeNull();
    expect(row("cancelled").querySelector('[aria-label^="Show "]')).toBeNull();
    expect(button("Open report.pdf").disabled).toBe(false);
    expect(button("Show report.pdf in folder").disabled).toBe(false);
  });

  it("reconnects a failed live subscription without hiding a successfully loaded list", async () => {
    service.listen.mockRejectedValueOnce(new Error("listen failed"));
    await render();
    await flush();
    expect(row("report")).not.toBeNull();
    expect(root().textContent).toContain(
      "Live download updates are unavailable",
    );
    await click(button("Retry"));
    expect(service.listen).toHaveBeenCalledTimes(2);
    expect(root().querySelector("[role=alert]")).toBeNull();
  });

  it("unsubscribes and ignores late lists and notifications after leaving the page", async () => {
    const pending = deferred<DownloadsPage>();
    service.list.mockReturnValue(pending.promise);
    await render();
    await flush();
    await harness.render(<p>Other settings</p>);
    expect(stop).toHaveBeenCalledOnce();
    await act(async () => {
      receive();
      pending.resolve(page());
    });
    expect(document.body.textContent).toBe("Other settings");
    expect(service.list).toHaveBeenCalledOnce();
  });

  it("discards a pagination snapshot from another revision and refreshes the visible range", async () => {
    service.list
      .mockResolvedValueOnce(page([entry("old")], 100, 1))
      .mockResolvedValueOnce(page([entry("different-page")], null, 2))
      .mockResolvedValueOnce(page([entry("fresh")], null, 2));
    await render();
    await flush();
    await click(button("Load more"));
    expect(service.list).toHaveBeenLastCalledWith({
      query: "",
      offset: 0,
      limit: 100,
    });
    expect(row("fresh")).not.toBeNull();
    expect(row("old")).toBeNull();
    expect(row("different-page")).toBeNull();
    expect(root().querySelector("[role=alert]")).toBeNull();
  });
});
