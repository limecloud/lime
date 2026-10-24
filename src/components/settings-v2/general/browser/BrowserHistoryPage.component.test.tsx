import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale, getLimeI18n } from "@/i18n/createI18n";
import type {
  BrowserHistoryVisitsPage,
  BrowserHistoryVisitRow,
} from "@/lib/api/browserHistoryVisits";
import {
  createBrowserComponentHarness,
  deferred,
} from "@/components/agent/chat/workspace/right-surface/browser/browserWorkspace.testFixtures";
import { BrowserHistoryPage } from "./BrowserHistoryPage";
import { BrowserHistoryNavigationContext } from "@/contexts/BrowserHistoryNavigationContext";
const api = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
  listen: vi.fn(),
  settings: vi.fn(),
  summary: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("@/lib/api/browserHistory", () => ({
  listBrowserHistoryVisits: api.list,
  removeBrowserHistoryVisits: api.remove,
  listenBrowserHistoryChanged: api.listen,
}));
vi.mock("@/lib/api/browserData", () => ({
  getBrowsingDataSettings: api.settings,
  getBrowsingDataSummary: api.summary,
  clearBrowsingData: api.clear,
}));
let harness: ReturnType<typeof createBrowserComponentHarness>;
let receive: (revision: number) => void;
const unsubscribe = vi.fn();
const onBack = vi.fn();
const openAddress = vi.fn();
const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).getTime();
function row(
  title = "Example",
  day = 24,
  actor = false,
): BrowserHistoryVisitRow {
  return {
    id: title.toLowerCase(),
    title,
    url: `https://${title.toLowerCase()}.example.com/path?q=history#section`,
    visitTime: at(day),
    isActorVisit: actor,
  };
}
function page(
  entries = [row()],
  revision = 1,
  nextCursor: string | null = null,
): BrowserHistoryVisitsPage {
  return { entries, total: entries.length, revision, nextCursor };
}
const flush = (milliseconds = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
const root = () => harness.query("browser-history-page");
const search = () =>
  root().querySelector<HTMLInputElement>("input[type=search]")!;
function find<T extends HTMLElement = HTMLButtonElement>(
  label: string,
  scope: HTMLElement | typeof document = document,
  selector = "button",
): T {
  const value = [...scope.querySelectorAll<T>(selector)].find(
    (node) =>
      node.textContent?.trim() === label ||
      node.getAttribute("aria-label") === label,
  );
  if (!value) throw new Error(`Missing ${selector}: ${label}`);
  return value;
}
const button = (label: string) => find<HTMLButtonElement>(label);
const link = (title: string) =>
  find<HTMLAnchorElement>(`Open ${title}`, root(), "a");
const checkbox = (title: string) =>
  find<HTMLButtonElement>(`Select ${title}`, root(), "[role=checkbox]");
const click = (target: HTMLElement) =>
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
async function menu(label: string) {
  await act(async () => {
    const trigger = button(label);
    trigger.focus();
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
  await flush();
}
async function source(value: "All" | "Agent" | "Other") {
  await menu(
    ["Filter history", "Filter history: Agent", "Filter history: Other"].find(
      (label) =>
        [...root().querySelectorAll("button")].some(
          (node) => node.getAttribute("aria-label") === label,
        ),
    )!,
  );
  await click(find(value, document, "[role=menuitemradio]"));
  await flush();
}
describe("BrowserHistoryPage visit management", () => {
  beforeEach(async () => {
    await changeLimeLocale("en-US");
    vi.useFakeTimers();
    vi.clearAllMocks();
    harness = createBrowserComponentHarness();
    openAddress.mockReset().mockResolvedValue(undefined);
    api.list.mockReset().mockResolvedValue(page());
    api.remove
      .mockReset()
      .mockResolvedValue({ removedEntries: 1, removedVisits: 1, revision: 2 });
    api.listen.mockImplementation(async (handler) => {
      receive = handler;
      return unsubscribe;
    });
    api.settings.mockReset().mockResolvedValue({
      dataRemovalPermitted: {
        history: true,
        siteData: true,
        cache: true,
        downloads: true,
        formData: false,
        siteSettings: true,
      },
    });
    api.summary.mockReset().mockResolvedValue({
      history: { firstSite: null, siteCount: 0 },
      siteData: null,
      cache: null,
      downloads: null,
    });
    api.clear.mockReset();
  });
  afterEach(async () => {
    await harness.unmount();
    vi.useRealTimers();
    vi.restoreAllMocks();
    await changeLimeLocale("zh-CN");
  });

  it("loads visit projection, focuses search and returns via the shared header", async () => {
    await render();
    await flush();
    expect(api.list).toHaveBeenCalledExactlyOnceWith({
      query: "",
      source: "all",
      limit: 100,
    });
    expect(document.activeElement).toBe(search());
    expect(root().textContent).toContain("All-time history");
    await click(button("Back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
  it("groups dates, initially expands only the newest and keeps a user collapse after pagination", async () => {
    api.list
      .mockResolvedValueOnce(page([row("Newest"), row("Older", 23)], 1, "next"))
      .mockResolvedValueOnce(page([row("Oldest", 22)], 1));
    await render();
    await flush();
    const groups = root().querySelectorAll(
      '[data-testid="browser-history-date-group"]',
    );
    expect(groups).toHaveLength(2);
    expect(
      groups[0].querySelector("button")?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      groups[1].querySelector("button")?.getAttribute("aria-expanded"),
    ).toBe("false");
    await click(groups[0].querySelector("button")!);
    await click(button("Load more"));
    expect(
      root().querySelectorAll('[data-testid="browser-history-date-group"]'),
    ).toHaveLength(3);
    expect(
      root().querySelector("h3 button")?.getAttribute("aria-expanded"),
    ).toBe("false");
  });
  it("selects distinct visits and sends one deduplicated URL/day batch, blocking duplicate requests", async () => {
    const other = row("Example", 24),
      agent = { ...other, isActorVisit: true, visitTime: at(24, 13) };
    const pending = deferred<unknown>();
    api.list.mockResolvedValue(page([agent, other]));
    api.remove.mockReturnValue(pending.promise);
    await render();
    await flush();
    const boxes = root().querySelectorAll<HTMLElement>('[role="checkbox"]');
    await click(boxes[0]);
    await click(boxes[1]);
    const remove = button("Remove selected");
    await act(async () => {
      remove.click();
      remove.click();
    });
    expect(api.remove).toHaveBeenCalledExactlyOnceWith([
      { url: other.url, visitTime: other.visitTime },
    ]);
    expect(remove.disabled).toBe(true);
    expect(search().disabled).toBe(true);
    await act(async () =>
      pending.resolve({ removedEntries: 1, removedVisits: 2, revision: 2 }),
    );
    await flush();
    expect(root().textContent).not.toContain("Remove selected");
  });
  it("retains selection on failed removal and retries the same scope", async () => {
    api.remove.mockRejectedValueOnce(new Error("disk unavailable"));
    await render();
    await flush();
    await click(checkbox("Example"));
    await click(button("Remove selected"));
    expect(checkbox("Example").getAttribute("aria-checked")).toBe("true");
    expect(root().querySelector('[role="alert"]')?.textContent).toContain(
      "Could not load or update",
    );
    await click(button("Remove selected"));
    expect(api.remove).toHaveBeenCalledTimes(2);
  });
  it("resets selection and expanded groups when switching source, and requests native source filtering", async () => {
    api.list.mockResolvedValue(page([row("Example"), row("Older", 23)]));
    await render();
    await flush();
    await click(checkbox("Example"));
    await click(root().querySelectorAll<HTMLElement>("h3 button")[1]);
    await source("Agent");
    expect(api.list).toHaveBeenLastCalledWith({
      query: "",
      source: "agent",
      limit: 100,
    });
    expect(root().textContent).not.toContain("Remove selected");
    expect(
      root().querySelectorAll("h3 button")[1]?.getAttribute("aria-expanded"),
    ).toBe("false");
  });
  it("debounces query and ignores a late previous-scope response", async () => {
    const old = deferred<BrowserHistoryVisitsPage>();
    api.list
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(page([row("Fresh")]));
    await render();
    await flush();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(search(), "fresh");
      search().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush(199);
    expect(api.list).toHaveBeenCalledTimes(1);
    await flush(1);
    expect(root().textContent).toContain("Fresh");
    await act(async () => old.resolve(page([row("Stale")])));
    expect(root().textContent).not.toContain("Stale");
  });
  it("preserves loaded rows and selection after page failure and retries that cursor", async () => {
    api.list
      .mockResolvedValueOnce(page([row()], 1, "cursor"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(page([row("Next")]));
    await render();
    await flush();
    await click(checkbox("Example"));
    await click(button("Load more"));
    expect(link("Example")).toBeTruthy();
    expect(checkbox("Example").getAttribute("aria-checked")).toBe("true");
    expect(root().textContent).toContain(
      "Unable to load more browsing history",
    );
    await click(button("Try again"));
    expect(api.list).toHaveBeenLastCalledWith({
      query: "",
      source: "all",
      cursor: "cursor",
      limit: 100,
    });
    expect(link("Next")).toBeTruthy();
  });
  it("opens the full recorded URL exactly once and prevents mutations while pending", async () => {
    const pending = deferred<void>();
    openAddress.mockReturnValue(pending.promise);
    await render();
    await flush();
    await click(checkbox("Example"));
    await act(async () => {
      link("Example").click();
      link("Example").click();
      button("Remove selected").click();
    });
    expect(openAddress).toHaveBeenCalledExactlyOnceWith(row().url);
    expect(api.remove).not.toHaveBeenCalled();
    expect(link("Example").getAttribute("aria-disabled")).toBe("true");
    expect(button("Clear browsing data").disabled).toBe(true);
    await act(async () => pending.resolve());
    expect(link("Example").getAttribute("aria-disabled")).toBe("false");
  });
  it("shows a failed open and permits retry without changing or reloading history", async () => {
    openAddress.mockRejectedValueOnce(new Error("navigation unavailable"));
    await render();
    await flush();
    await click(link("Example"));
    expect(root().querySelector('[role="alert"]')?.textContent).toContain(
      "Could not open this page",
    );
    await click(link("Example"));
    expect(openAddress).toHaveBeenCalledTimes(2);
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(api.remove).not.toHaveBeenCalled();
  });
  it("exposes per-row open/remove menu actions with keyboard activation", async () => {
    await render();
    await flush();
    await menu("Actions for Example");
    await click(find("Remove from history", document, '[role="menuitem"]'));
    expect(api.remove).toHaveBeenCalledExactlyOnceWith([
      { url: row().url, visitTime: row().visitTime },
    ]);
  });
  it("permits management without a conversation and honors native removal restrictions", async () => {
    api.settings.mockResolvedValue({
      dataRemovalPermitted: { history: false },
    });
    await render(false);
    await flush();
    expect(link("Example").getAttribute("aria-disabled")).toBe("true");
    expect(checkbox("Example").disabled).toBe(true);
    expect(root().textContent).toContain("Open a conversation workspace");
    await click(link("Example"));
    expect(openAddress).not.toHaveBeenCalled();
  });
  it("reuses the shared six-category/five-range clear dialog and restores its trigger on cancel", async () => {
    await render();
    await flush();
    const trigger = button("Clear browsing data");
    await click(trigger);
    await flush();
    const dialog = document.querySelector(
      '[data-testid="browser-clear-browsing-data-dialog"]',
    )!;
    expect(dialog.querySelectorAll('[role="checkbox"]')).toHaveLength(6);
    expect(dialog.querySelectorAll("[aria-pressed]")).toHaveLength(5);
    await click(find("Cancel", dialog));
    await flush();
    expect(api.clear).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });
  it("refreshes a changed native revision, prunes removed selections and ignores duplicate revision events", async () => {
    await render();
    await flush();
    await click(checkbox("Example"));
    api.list.mockResolvedValue(page([row("Updated")], 2));
    await act(async () => receive(2));
    await flush();
    expect(root().textContent).toContain("Updated");
    expect(root().textContent).not.toContain("Remove selected");
    await act(async () => receive(2));
    await flush();
    expect(api.list).toHaveBeenCalledTimes(2);
  });
  it("unsubscribes even when the subscription arrives after unmount", async () => {
    const subscription = deferred<() => void>();
    api.listen.mockReturnValue(subscription.promise);
    await render();
    await harness.unmount();
    await act(async () => subscription.resolve(unsubscribe));
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "renders real %s source/selection labels and date/time semantics",
    async (locale) => {
      await changeLimeLocale(locale as "en-US");
      api.list.mockResolvedValue(page([row("Example", 24, true)]));
      await render();
      await flush();
      const t = getLimeI18n().getFixedT(locale, "settings");
      expect(root().querySelector("h1")?.textContent).toBe(
        t("browserHistory.title"),
      );
      expect(root().textContent).toContain(t("browserHistory.allTime"));
      expect(button(t("browserHistory.filter.all"))).toBeTruthy();
      expect(
        find(
          t("browserHistory.select", { title: "Example" }),
          root(),
          '[role="checkbox"]',
        ),
      ).toBeTruthy();
      expect(root().querySelector("time")?.getAttribute("datetime")).toBe(
        new Date(at(24)).toISOString(),
      );
    },
  );
});
