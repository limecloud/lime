import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale, getLimeI18n } from "@/i18n/createI18n";
import type { BrowserHistoryPage as HistoryPage } from "@/lib/api/browserHistory";
import {
  createBrowserComponentHarness,
  deferred,
} from "@/components/agent/chat/workspace/right-surface/browser/browserWorkspace.testFixtures";
import { BrowserHistoryPage } from "./BrowserHistoryPage";
import { BrowserHistoryNavigationContext } from "@/contexts/BrowserHistoryNavigationContext";

const history = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("@/lib/api/browserHistory", () => ({
  listBrowserHistory: history.list,
  removeBrowserHistory: history.remove,
  clearBrowserHistory: history.clear,
  listenBrowserHistoryChanged: history.listen,
}));
let harness: ReturnType<typeof createBrowserComponentHarness>;
let receive: (revision: number) => void;
const unsubscribe = vi.fn();
const onBack = vi.fn();
const openAddress = vi.fn();
function page(
  title = "Example",
  revision = 1,
  nextCursor: string | null = null,
): HistoryPage {
  return {
    entries: [
      {
        id: title.toLowerCase(),
        title,
        url: `https://${title.toLowerCase()}.example.com/`,
        visitCount: 1,
        firstVisitedAt: 1700000000000,
        lastVisitedAt: 1700000000000,
      },
    ],
    total: 1,
    revision,
    nextCursor,
  };
}
const flush = (milliseconds = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
const root = () => harness.query("browser-history-page");
const search = () =>
  root().querySelector<HTMLInputElement>("input[type=search]")!;
function button(label: string, scope: HTMLElement = root()): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) =>
      item.textContent?.trim() === label ||
      item.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`Missing history button: ${label}`);
  return found;
}
const click = (target: HTMLButtonElement) =>
  act(async () => {
    target.click();
  });
const render = (navigation = true) =>
  harness.render(
    <BrowserHistoryNavigationContext.Provider
      value={navigation ? openAddress : null}
    >
      <BrowserHistoryPage onBack={onBack} />
    </BrowserHistoryNavigationContext.Provider>,
  );
const clearDialog = () =>
  root().querySelector<HTMLElement>("[role=alertdialog]")!;

describe("BrowserHistoryPage", () => {
  beforeEach(async () => {
    await changeLimeLocale("en-US");
    vi.useFakeTimers();
    vi.setSystemTime(1700100000000);
    vi.clearAllMocks();
    openAddress.mockReset().mockResolvedValue(undefined);
    harness = createBrowserComponentHarness();
    history.list.mockResolvedValue(page());
    history.remove.mockResolvedValue({
      removedEntries: 1,
      removedVisits: 1,
      revision: 2,
    });
    history.clear.mockResolvedValue({
      removedEntries: 1,
      removedVisits: 1,
      revision: 2,
    });
    history.listen.mockImplementation(async (handler) => {
      receive = handler;
      return unsubscribe;
    });
  });
  afterEach(async () => {
    await harness.unmount();
    vi.useRealTimers();
    vi.restoreAllMocks();
    await changeLimeLocale("zh-CN");
  });

  it("loads user history and focuses its search; back returns to Browser settings", async () => {
    await render();
    await flush();
    expect(history.list).toHaveBeenCalledExactlyOnceWith({
      query: "",
      limit: 50,
    });
    expect(root().textContent).toContain("Example");
    expect(document.activeElement).toBe(search());
    await click(button("Back to Browser settings"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("opens the complete recorded URL through canonical workspace navigation without mutating history", async () => {
    const result = page();
    result.entries[0].url = "https://example.com/path?q=history#section";
    history.list.mockResolvedValue(result);
    await render();
    await flush();
    const entry = button("Open Example");
    entry.focus();
    expect(document.activeElement).toBe(entry);
    expect(entry.type).toBe("button");
    await click(entry);
    expect(openAddress).toHaveBeenCalledExactlyOnceWith(result.entries[0].url);
    expect(history.remove).not.toHaveBeenCalled();
    expect(history.clear).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("disables opening and explains the unavailable workspace without a navigation context", async () => {
    await render(false);
    await flush();
    const entry = button("Open Example");
    expect(entry.disabled).toBe(true);
    expect(root().textContent).toContain(
      "Open a conversation workspace to revisit this page",
    );
    await click(entry);
    expect(openAddress).not.toHaveBeenCalled();
    await click(button("Delete Example"));
    expect(history.remove).toHaveBeenCalledExactlyOnceWith(["example"]);
  });

  it("dispatches one pending open and keeps destructive actions unavailable until it finishes", async () => {
    const pending = deferred<void>();
    openAddress.mockReturnValue(pending.promise);
    await render();
    await flush();
    const entry = button("Open Example");
    await click(entry);
    await click(entry);
    expect(openAddress).toHaveBeenCalledTimes(1);
    expect(entry.disabled).toBe(true);
    expect(entry.getAttribute("aria-busy")).toBe("true");
    expect(button("Delete Example").disabled).toBe(true);
    expect(button("Delete browsing history").disabled).toBe(true);
    await act(async () => pending.resolve());
    expect(entry.disabled).toBe(false);
    expect(entry.getAttribute("aria-busy")).toBe("false");
    expect(button("Delete Example").disabled).toBe(false);
  });

  it("does not allow an already expanded clear confirmation to mutate history while a page is opening", async () => {
    const pending = deferred<void>();
    openAddress.mockReturnValue(pending.promise);
    await render();
    await flush();
    await click(button("Delete browsing history"));
    const dialog = clearDialog();
    const clear = button("Delete browsing history", dialog);
    expect(clear.disabled).toBe(false);
    await act(async () => {
      button("Open Example").click();
      clear.click();
    });
    expect(clear.disabled).toBe(true);
    expect(dialog.querySelector<HTMLSelectElement>("select")?.disabled).toBe(
      true,
    );
    await click(clear);
    expect(history.clear).not.toHaveBeenCalled();
    expect(history.remove).not.toHaveBeenCalled();
    await act(async () => pending.resolve());
    expect(clear.disabled).toBe(false);
    await click(clear);
    expect(history.clear).toHaveBeenCalledExactlyOnceWith({});
  });

  it("keeps the record after a failed open and retries the same URL without clearing or refreshing it", async () => {
    openAddress.mockRejectedValueOnce(new Error("workspace unavailable"));
    await render();
    await flush();
    await click(button("Open Example"));
    expect(root().querySelector("[role=alert]")?.textContent).toBe(
      "Could not open this page in the workspace browser. Try again.",
    );
    expect(root().textContent).toContain("https://example.example.com/");
    expect(history.list).toHaveBeenCalledTimes(1);
    await click(button("Open Example"));
    expect(openAddress).toHaveBeenCalledTimes(2);
    expect(openAddress).toHaveBeenNthCalledWith(
      2,
      "https://example.example.com/",
    );
    expect(root().querySelector("[role=alert]")).toBeNull();
    expect(history.remove).not.toHaveBeenCalled();
    expect(history.clear).not.toHaveBeenCalled();
  });

  it("does not open the record when its separate delete control is activated", async () => {
    await render();
    await flush();
    await click(button("Delete Example"));
    expect(openAddress).not.toHaveBeenCalled();
    expect(history.remove).toHaveBeenCalledExactlyOnceWith(["example"]);
  });

  it("ignores a late failed open after leaving the history page", async () => {
    const pending = deferred<void>();
    openAddress.mockReturnValue(pending.promise);
    await render();
    await flush();
    await click(button("Open Example"));
    await harness.render(<div>Different settings</div>);
    await act(async () => pending.reject(new Error("late navigation failure")));
    expect(document.body.textContent).toBe("Different settings");
    expect(openAddress).toHaveBeenCalledTimes(1);
    expect(history.list).toHaveBeenCalledTimes(1);
  });

  it("does not let a slower previous query replace the latest search results", async () => {
    const previous = deferred<HistoryPage>();
    const latest = deferred<HistoryPage>();
    history.list.mockImplementation(({ query }) =>
      query === "old"
        ? previous.promise
        : query === "new"
          ? latest.promise
          : Promise.resolve(page()),
    );
    await render();
    await flush();
    await harness.change(search(), "old");
    await flush(150);
    await harness.change(search(), "new");
    await flush(150);
    await act(async () => latest.resolve(page("Latest", 3)));
    expect(root().textContent).toContain("Latest");
    await act(async () => previous.resolve(page("Old", 2)));
    expect(root().textContent).toContain("Latest");
    expect(root().textContent).not.toContain("Old");
  });

  it("refreshes on a new committed revision and ignores an unchanged revision", async () => {
    await render();
    await flush();
    await act(async () => receive(1));
    await flush();
    expect(history.list).toHaveBeenCalledTimes(1);
    history.list.mockResolvedValue(page("Refreshed", 2));
    await act(async () => receive(2));
    await flush();
    expect(history.list).toHaveBeenCalledTimes(2);
    expect(root().textContent).toContain("Refreshed");
  });

  it("appends a matching next page and restarts at the first page after a stale cursor rejection", async () => {
    history.list
      .mockResolvedValueOnce(page("First", 1, "cursor-one"))
      .mockResolvedValueOnce(page("Second", 1, "cursor-two"))
      .mockRejectedValueOnce(new Error("Browser history cursor is stale"))
      .mockResolvedValueOnce(page("Fresh", 2));
    await render();
    await flush();
    await click(button("Load more"));
    expect(history.list).toHaveBeenNthCalledWith(2, {
      query: "",
      cursor: "cursor-one",
      limit: 50,
    });
    expect(root().textContent).toContain("First");
    expect(root().textContent).toContain("Second");
    await click(button("Load more"));
    await flush();
    expect(history.list).toHaveBeenLastCalledWith({ query: "", limit: 50 });
    expect(root().textContent).toContain("Fresh");
    expect(root().textContent).not.toContain("First");
    expect(root().textContent).not.toContain("Second");
  });

  it("keeps history visible after a failed deletion and retries the same actual record", async () => {
    history.remove.mockRejectedValueOnce(new Error("disk unavailable"));
    await render();
    await flush();
    await click(button("Delete Example"));
    expect(history.remove).toHaveBeenCalledExactlyOnceWith(["example"]);
    expect(root().querySelector("[role=alert]")?.textContent).toContain(
      "Could not load or update",
    );
    expect(root().textContent).toContain("Example");
    history.list.mockResolvedValue({
      entries: [],
      nextCursor: null,
      total: 0,
      revision: 2,
    });
    await click(button("Delete Example"));
    await flush();
    expect(history.remove).toHaveBeenCalledTimes(2);
    expect(root().querySelector("[role=alert]")).toBeNull();
    expect(root().textContent).toContain("No browsing history");
  });

  it("requires a separate explicit confirmation and cancellation never clears history", async () => {
    await render();
    await flush();
    await click(button("Delete browsing history"));
    expect(clearDialog()).not.toBeNull();
    expect(history.clear).not.toHaveBeenCalled();
    await click(button("Cancel", clearDialog()));
    expect(root().querySelector("[role=alertdialog]")).toBeNull();
    expect(history.clear).not.toHaveBeenCalled();
  });

  it.each([
    ["hour", 3600000],
    ["day", 86400000],
    ["week", 604800000],
    ["all", 0],
  ] as const)(
    "uses the exact %s time range and prevents duplicate pending clear requests",
    async (period, duration) => {
      const clearing = deferred<unknown>();
      history.clear.mockReturnValue(clearing.promise);
      await render();
      await flush();
      await click(button("Delete browsing history"));
      const select = clearDialog().querySelector<HTMLSelectElement>("select")!;
      await act(async () => {
        select.value = period;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      const confirm = button("Delete browsing history", clearDialog());
      await click(confirm);
      await click(confirm);
      expect(history.clear).toHaveBeenCalledExactlyOnceWith(
        period === "all" ? {} : { since: Date.now() - duration },
      );
      expect(confirm.disabled).toBe(true);
      expect(button("Cancel", clearDialog()).disabled).toBe(true);
      await act(async () =>
        clearing.resolve({ removedEntries: 1, removedVisits: 1, revision: 2 }),
      );
      await flush();
      expect(root().querySelector("[role=alertdialog]")).toBeNull();
    },
  );

  it("cleans its subscription and ignores a late list response after leaving the page", async () => {
    const pending = deferred<HistoryPage>();
    history.list.mockReturnValue(pending.promise);
    await render();
    await flush();
    await harness.render(<div>Different settings</div>);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(page("Late"));
      receive(2);
    });
    await flush();
    expect(document.body.textContent).toBe("Different settings");
    expect(history.list).toHaveBeenCalledTimes(1);
  });

  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
    "renders the history and confirmation controls without unresolved keys in %s",
    async (locale) => {
      await changeLimeLocale(locale);
      await render();
      await flush();
      const t = getLimeI18n().getFixedT(locale, "settings");
      const openLabel = t("browserHistory.open", { title: "Example" });
      expect(button(openLabel).disabled).toBe(false);
      openAddress.mockRejectedValueOnce(new Error("fixture open failure"));
      await click(button(openLabel));
      expect(root().querySelector("[role=alert]")?.textContent).toBe(
        t("browserHistory.openError"),
      );
      await click(button(t("browserHistory.clear")));
      expect(root().textContent).not.toContain("browserHistory.");
      expect(search().placeholder).toBe(t("browserHistory.search"));
      expect(clearDialog().getAttribute("aria-labelledby")).toBe(
        "browser-history-confirm",
      );
      expect(clearDialog().querySelectorAll("option")).toHaveLength(4);
    },
  );
});
