import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clickNativeMenuItem } from "./browser-runtime-gate-a.mjs";
import {
  readHistoryLayout,
  sameHistoryLayout,
  waitForHistoryAnimations,
} from "./browser-runtime-history-layout.mjs";
import {
  assert,
  sanitizeText,
  sleep,
} from "../lib/chat-fixture/utils.mjs";

/** Test-only history, written before launch and only inside a fresh temporary profile. */
export async function prepareBrowserHistoryManagementSeed(userDataDir) {
  assert(
    path.isAbsolute(userDataDir),
    "History seed requires an absolute profile",
  );
  const relative = path.relative(
    await fs.realpath(os.tmpdir()),
    await fs.realpath(userDataDir),
  );
  assert(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    "History seed requires an isolated temporary profile",
  );
  const time = (days, hour) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    date.setHours(hour, 0, 0, 0);
    return date.getTime();
  };
  const seed = {
    a: {
      id: "management-a",
      url: "https://history-a.invalid/",
      title: "History management A",
      visits: [
        { visitedAt: time(2, 9), isActorVisit: false },
        { visitedAt: time(1, 10), isActorVisit: true },
        { visitedAt: time(0, 9), isActorVisit: true },
        { visitedAt: time(0, 10), isActorVisit: false },
      ],
    },
    b: {
      id: "management-b",
      url: "https://history-b.invalid/",
      title: "History management B",
      visits: [{ visitedAt: time(1, 11), isActorVisit: false }],
    },
    c: {
      id: "management-c",
      url: "https://history-c.invalid/",
      title: "History management C",
      visits: [{ visitedAt: time(0, 11), isActorVisit: true }],
    },
  };
  const file = path.join(userDataDir, "browser", "history.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    `${JSON.stringify({ schemaVersion: 2, revision: 1, entries: Object.values(seed) })}\n`,
    { flag: "wx" },
  );
  return { file, ...seed };
}

/** Native IPC/store plus actual settings interactions, without an Agent turn. */
export async function runBrowserHistoryManagementScenario({
  app,
  page,
  options,
  guiBeforeTurn,
  historyManagementSeed: seed,
  readBrowserWorkspaceState,
  readInvokeTrace,
}) {
  const assertions = {};
  const screenshots = [];
  const observations = {};
  const check = (name, value) => {
    assertions[name] = Boolean(value);
    console.log(`[browser-history-management] ${name}=${Boolean(value)}`);
    assert(value, name);
  };
  const locale = options.locale || "zh-CN";
  const translations = JSON.parse(
    await fs.readFile(
      new URL(
        `../../src/i18n/resources/${locale}/browserHistory.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const label = (key, title) =>
    translations[`browserHistory.${key}`].replace("{{title}}", title || "");
  const history = page.getByTestId("browser-history-page");
  const groups = history.getByTestId("browser-history-date-group");
  const rows = history.getByTestId("browser-history-row");
  const capture = async (name) => {
    const file = path.join(
      path.dirname(options.output),
      `${locale}-${name}.png`,
    );
    if (!name.endsWith("failure")) await waitForHistoryAnimations(page);
    await page.screenshot({ path: file });
    screenshots.push(file);
  };
  const query = (args) =>
    page.evaluate(
      (args) =>
        window.electronAPI.invoke("browser_history_list", {
          view: "visits",
          ...args,
        }),
      args,
    );
  const waitRows = (count) =>
    page.waitForFunction(
      (count) =>
        document.querySelectorAll('[data-testid="browser-history-row"]')
          .length === count,
      count,
      { timeout: Math.min(options.timeoutMs, 20000) },
    );
  const changeSource = async (source) => {
    await history
      .getByRole("button", { name: new RegExp(`^${label("filter.all")}`) })
      .click();
    await page
      .getByRole("menuitemradio", {
        name: label(`source.${source}`),
        exact: true,
      })
      .click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="browser-history-page"] [aria-busy]')
          ?.getAttribute("aria-busy") === "false",
      undefined,
      { timeout: options.timeoutMs },
    );
  };
  try {
    check(
      "isolated-profile-matches-prelaunch-seed",
      await app.evaluate(
        ({ app }, file) =>
          process.env.LIME_ELECTRON_E2E === "1" &&
          app.getPath("userData") === process.env.ELECTRON_E2E_USER_DATA_DIR &&
          file === `${app.getPath("userData")}/browser/history.json`,
        seed.file,
      ),
    );
    const initial = await query({ source: "all" });
    observations.initial = { total: initial.total, revision: initial.revision };
    const nativeUrl = await app.evaluate(
      ({ webContents }, id) => webContents.fromId(id)?.getURL(),
      guiBeforeTurn.webContentsId,
    );
    const initialGui = await readBrowserWorkspaceState(page);
    observations.initial.nativeUrl = nativeUrl;
    check("initial-native-url-matches-gui", initialGui.address === nativeUrl);
    check(
      "native-visit-projection-has-separate-days-and-sources",
      initial.entries.filter((entry) => entry.url === seed.a.url).length === 4,
    );
    check(
      "real-initial-native-navigation-is-other",
      initial.entries.some(
        (entry) => entry.url === nativeUrl && entry.isActorVisit === false,
      ),
    );
    await page.getByTestId("browser-workspace-options").click();
    await clickNativeMenuItem(app, "history");
    await history.waitFor({ state: "visible", timeout: options.timeoutMs });
    await waitRows(4);
    check("three-local-date-groups", (await groups.count()) === 3);
    check(
      "only-first-date-expanded",
      JSON.stringify(
        await groups
          .locator("h3 button")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("aria-expanded")),
          ),
      ) === JSON.stringify(["true", "false", "false"]),
    );
    check(
      "today-shows-both-sources-for-one-url",
      (await rows.filter({ hasText: seed.a.title }).count()) === 2,
    );
    observations.layout = { populated: await readHistoryLayout(page) };
    await capture("history-dates-and-sources");
    await rows
      .filter({ hasText: seed.a.title })
      .first()
      .getByRole("checkbox")
      .click();
    await changeSource("agent");
    await waitRows(2);
    check(
      "agent-filter-clears-selection-and-shows-agent-rows",
      (await history
        .getByRole("button", { name: label("removeSelected"), exact: true })
        .count()) === 0 &&
        (await rows.filter({ hasText: label("agentBadge") }).count()) === 2,
    );
    await groups.nth(1).locator("h3 button").click();
    await waitRows(3);
    check(
      "agent-filter-keeps-yesterday-separate",
      (await rows.filter({ hasText: seed.a.title }).count()) === 2,
    );
    await changeSource("other");
    await waitRows(2);
    check(
      "other-filter-has-no-agent-badges",
      (await rows.getByText(label("agentBadge"), { exact: true }).count()) ===
        0,
    );
    check(
      "source-change-resets-expanded-dates",
      (await groups
        .nth(1)
        .locator("h3 button")
        .getAttribute("aria-expanded")) === "false",
    );
    await changeSource("all");
    await waitRows(4);
    const selectedRows = rows.filter({ hasText: seed.a.title });
    await selectedRows.nth(0).getByRole("checkbox").click();
    await selectedRows.nth(1).getByRole("checkbox").click();
    await history
      .getByRole("button", { name: label("removeSelected"), exact: true })
      .click();
    await page.waitForFunction(
      (title) =>
        ![
          ...document.querySelectorAll('[data-testid="browser-history-row"]'),
        ].some((node) => node.textContent.includes(title)),
      seed.a.title,
      { timeout: options.timeoutMs },
    );
    const afterBatch = JSON.parse(await fs.readFile(seed.file, "utf8"));
    check(
      "batch-removes-today-across-sources-and-preserves-other-days-on-disk",
      JSON.stringify(
        afterBatch.entries.find((entry) => entry.url === seed.a.url)?.visits,
      ) === JSON.stringify(seed.a.visits.slice(0, 2)),
    );
    check(
      "batch-does-not-delete-other-urls",
      afterBatch.entries.some((entry) => entry.url === seed.b.url) &&
        afterBatch.entries.some((entry) => entry.url === seed.c.url),
    );
    const c = rows.filter({ hasText: seed.c.title });
    await c
      .getByRole("button", {
        name: label("actions", seed.c.title),
        exact: true,
      })
      .click();
    await page
      .getByRole("menuitem", { name: label("removePage"), exact: true })
      .click();
    await c.waitFor({ state: "detached", timeout: options.timeoutMs });
    check(
      "row-menu-deletes-only-target",
      !(await query({ source: "all" })).entries.some(
        (entry) => entry.url === seed.c.url,
      ) &&
        JSON.parse(await fs.readFile(seed.file, "utf8")).entries.some(
          (entry) => entry.url === seed.b.url,
        ),
    );
    const search = history.getByRole("searchbox");
    await search.fill("no-match-history-management-fixture");
    await history.getByText(label("noResults"), { exact: true }).waitFor();
    check(
      "empty-search-has-recovery-description",
      await history
        .getByText(label("noResultsDescription"), { exact: true })
        .isVisible(),
    );
    observations.layout.noResults = await readHistoryLayout(page);
    check(
      "empty-search-preserves-page-header-and-search-layout",
      sameHistoryLayout(
        observations.layout.populated,
        observations.layout.noResults,
      ),
    );
    await search.fill(new URL(seed.a.url).hostname);
    await waitRows(1);
    check(
      "search-recovers-retained-older-history",
      (await groups.count()) === 2 &&
        (await rows.first().getByRole("link").getAttribute("href")) ===
          seed.a.url,
    );
    await groups.nth(1).locator("h3 button").click();
    await waitRows(2);
    observations.layout.restored = await readHistoryLayout(page);
    check(
      "restored-search-preserves-page-header-and-search-layout",
      sameHistoryLayout(
        observations.layout.populated,
        observations.layout.restored,
      ),
    );
    await capture("history-retained-days");
    const final = await query({ source: "all" });
    observations.final = { total: final.total, revision: final.revision };
    await page
      .getByTestId("browser-management-header")
      .locator("nav button")
      .nth(1)
      .click();
    await page.locator("#browser-history button").waitFor();
    await page.getByTestId("settings-back-button").click();
    await page.getByTestId("browser-workspace-options").waitFor();
    await page.waitForFunction(
      (initial) =>
        [
          ...document.querySelectorAll('[data-testid="browser-workspace"]'),
        ].some(
          (node) =>
            node.checkVisibility() &&
            node.getAttribute("data-browser-thread-id") === initial.threadId &&
            node.getAttribute("data-browser-session-id") ===
              initial.sessionId &&
            node.getAttribute("data-browser-tab-id") === initial.tabId &&
            Number(node.getAttribute("data-browser-web-contents-id")) ===
              initial.webContentsId,
        ),
      guiBeforeTurn,
      { timeout: options.timeoutMs },
    );
    const returned = await readBrowserWorkspaceState(page);
    check(
      "returns-to-original-thread-session-and-native-page",
      returned.threadId === guiBeforeTurn.threadId &&
        returned.sessionId === guiBeforeTurn.sessionId &&
        returned.tabId === guiBeforeTurn.tabId &&
        returned.webContentsId === guiBeforeTurn.webContentsId,
    );
    check(
      "same-persistent-native-session",
      await app.evaluate(
        ({ webContents, session }, id) =>
          webContents.fromId(id)?.session ===
          session.fromPartition("persist:embedded-browser"),
        guiBeforeTurn.webContentsId,
      ),
    );
    const deadline = Date.now() + Math.min(options.timeoutMs, 20000);
    while (
      readInvokeTrace().filter(
        (item) =>
          item.command === "browser_history_remove" &&
          item.status === "success",
      ).length < 2 &&
      Date.now() < deadline
    )
      await sleep(100);
    const trace = readInvokeTrace();
    check(
      "real-app-server-and-history-ipc",
      trace.some(
        (item) =>
          item.command === "app_server_handle_json_lines" &&
          item.transport === "electron-ipc" &&
          item.status === "success",
      ) &&
        trace.some(
          (item) =>
            item.command === "browser_history_list" &&
            item.transport === "electron-ipc" &&
            item.status === "success",
        ),
    );
    const removes = trace.filter(
      (item) =>
        item.command === "browser_history_remove" &&
        item.status === "success" &&
        item.transport === "electron-ipc",
    );
    observations.removals = removes.map((item) => ({
      command: item.command,
      transport: item.transport,
      status: item.status,
      args_preview: item.args_preview,
    }));
    check(
      "one-deduplicated-batch-plus-one-row-native-removal",
      removes.length === 2 &&
        removes.every((item) => item.args_preview?.entries?.length === 1),
    );
    check(
      "no-mock-fallback",
      !trace.some(
        (item) => item.transport === "mock" || item.fallback === true,
      ),
    );
    const host = await app.evaluate(
      () => globalThis.__browserDesignHostEvidence ?? null,
    );
    check(
      "hidden-native-host-without-preload-errors",
      host?.visibilityOnly === true &&
        host.visible === false &&
        host.preloadErrors.length === 0,
    );
    return {
      scenario: "history-management",
      assertions,
      failedAssertions: Object.keys(assertions).filter(
        (key) => !assertions[key],
      ),
      screenshots,
      observations,
      diagnostics: {
        host,
        claimBoundary:
          "Seeded visits are test-only; actual UI/IPC/store mutations and original WCV identity are observed. No Agent turn, live provider, physical input or reference pixel claim.",
      },
    };
  } catch (error) {
    await capture("history-management-failure").catch(() => undefined);
    await fs.writeFile(
      path.join(
        path.dirname(options.output),
        "history-management-failure.json",
      ),
      `${JSON.stringify({ assertions, observations, screenshots, error: sanitizeText(error?.stack || error), text: await page.evaluate(() => document.querySelector('[data-testid="browser-history-page"]')?.textContent || "").catch(() => "") }, null, 2)}\n`,
    );
    throw error;
  }
}
