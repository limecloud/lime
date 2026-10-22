import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { clickNativeMenuItem } from "./browser-runtime-gate-a.mjs";
import {
  reopenBrowserHistoryEntry,
  reopenBrowserHistoryFromSettings,
  writeBrowserHistoryFailure,
} from "./browser-runtime-history-navigation.mjs";
import {
  assert,
  sanitizeJson,
  sanitizeText,
  sleep,
} from "./claw-chat-current-fixture-utils.mjs";

async function startHistoryServer() {
  const marker = `history-fixture-${randomUUID()}`;
  const pages = ["alpha", "beta"].map((name) => ({
    pathname: `/${marker}/${name}`,
    title: `${marker} ${name === "alpha" ? "Alpha" : "Beta"}`,
  }));
  const requests = [];
  const server = http.createServer((request, response) => {
    const entry = pages.find((page) => page.pathname === request.url);
    if (!entry || request.method !== "GET") {
      response.writeHead(404);
      response.end();
      return;
    }
    requests.push(entry.pathname);
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'",
    });
    response.end(
      `<!doctype html><html><head><meta charset="utf-8"><title>${entry.title}</title></head><body><h1>${entry.title}</h1><p>Local Browser history fixture.</p></body></html>`,
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(
    address && typeof address !== "string",
    "History fixture server did not bind a local port",
  );
  return {
    marker,
    pages: pages.map((page) => ({
      ...page,
      url: `http://127.0.0.1:${address.port}${page.pathname}`,
    })),
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

async function waitFor(options, read, predicate, description) {
  const deadline = Date.now() + options.timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await sleep(options.intervalMs);
  }
  throw new Error(`${description}: ${JSON.stringify(sanitizeJson(last))}`);
}

async function historyProfile(app) {
  const profile = await app.evaluate(({ app }) => ({
    e2e: process.env.LIME_ELECTRON_E2E === "1",
    directory: process.env.ELECTRON_E2E_USER_DATA_DIR || "",
    userData: app.getPath("userData"),
  }));
  const temporary = path.relative(os.tmpdir(), profile.directory);
  assert(
    profile.e2e &&
      path.isAbsolute(profile.directory) &&
      path.resolve(profile.directory) === path.resolve(profile.userData) &&
      temporary &&
      !temporary.startsWith("..") &&
      !path.isAbsolute(temporary),
    "Browser history fixture requires the harness's isolated temporary Electron profile",
  );
  return path.join(profile.directory, "browser", "history.json");
}

async function listHistory(page, query) {
  return page.evaluate(async (query) => {
    if (
      window.__LIME_ELECTRON__ !== true ||
      typeof window.electronAPI?.invoke !== "function"
    ) {
      throw new Error(
        "History verification requires real Electron preload IPC",
      );
    }
    return window.electronAPI.invoke("browser_history_list", {
      query,
      limit: 200,
    });
  }, query);
}

async function historySnapshot(page, file, fixture) {
  const ipc = await listHistory(page, fixture.marker);
  const disk = JSON.parse(await fs.readFile(file, "utf8"));
  const urls = new Set(fixture.pages.map((entry) => entry.url));
  return {
    revision: ipc.revision,
    total: ipc.total,
    entries: ipc.entries,
    disk: {
      schemaVersion: disk.schemaVersion,
      revision: disk.revision,
      totalEntries: disk.entries.length,
      fixtureEntries: disk.entries
        .filter((entry) => urls.has(entry.url))
        .map((entry) => ({
          id: entry.id,
          url: entry.url,
          title: entry.title,
          visitCount: entry.visits.length,
        })),
    },
  };
}

function matchesDisk(snapshot) {
  return (
    snapshot.disk.schemaVersion === 1 &&
    snapshot.disk.revision === snapshot.revision &&
    snapshot.entries.length === snapshot.disk.fixtureEntries.length &&
    snapshot.entries.every((entry) =>
      snapshot.disk.fixtureEntries.some(
        (stored) =>
          stored.id === entry.id &&
          stored.url === entry.url &&
          stored.title === entry.title &&
          stored.visitCount === entry.visitCount,
      ),
    )
  );
}

function sameHistory(left, right) {
  return (
    left.revision === right.revision &&
    left.total === right.total &&
    JSON.stringify(left.entries) === JSON.stringify(right.entries) &&
    JSON.stringify(left.disk) === JSON.stringify(right.disk)
  );
}

async function readHistoryTrace(page) {
  return page.evaluate(() => {
    const parsed = JSON.parse(
      window.localStorage.getItem("lime_invoke_trace_buffer_v1") || "[]",
    );
    const trace = Array.isArray(parsed) ? parsed : [];
    return {
      commands: trace
        .filter((entry) =>
          /^browser_history_|^browser_tab_(?:show_menu|mount|list)$/u.test(
            entry?.command || "",
          ),
        )
        .map((entry) => ({
          command: entry.command,
          transport: entry.transport,
          status: entry.status,
        })),
      mockFallbackHitCount: trace.filter(
        (entry) =>
          entry?.mock === true ||
          entry?.mockFallback === true ||
          [
            entry?.transport,
            entry?.source,
            entry?.fallback,
            entry?.fallbackMode,
          ].some(
            (value) =>
              typeof value === "string" && value.toLowerCase().includes("mock"),
          ),
      ).length,
    };
  });
}

async function navigateHistoryPage({
  app,
  page,
  options,
  target,
  before,
  readBrowserWorkspaceState,
}) {
  const address = page.locator('[data-testid="browser-workspace-address"]');
  await address.fill(target.url);
  await address.press("Enter");
  return waitFor(
    options,
    async () => {
      const workspace = await readBrowserWorkspaceState(page);
      const native = await app.evaluate(({ webContents }, id) => {
        const target = webContents.fromId(id);
        if (!target || target.isDestroyed()) return null;
        return {
          webContentsId: target.id,
          url: target.getURL(),
          title: target.getTitle(),
          loading: target.isLoading(),
        };
      }, before.webContentsId);
      return { workspace, native };
    },
    ({ workspace, native }) =>
      workspace.address === target.url &&
      workspace.pageRevision > before.pageRevision &&
      native?.url === target.url &&
      native.title === target.title &&
      !native.loading,
    `History fixture navigation/title did not commit: ${target.pathname}`,
  );
}

/** Desktop-owned history only: no Agent history grant or process-restart claim. */
export async function runBrowserHistoryScenario({
  app,
  page,
  options,
  identity,
  workspaceId,
  guiBeforeTurn,
  readBrowserWorkspaceState,
  readInvokeTrace,
}) {
  const stage = (name) =>
    console.log(`[browser-runtime-history] stage=${name}`);
  const file = await historyProfile(app);
  const locale = options.locale || guiBeforeTurn.rendererLocale || "zh-CN";
  assert(
    ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"].includes(locale),
    "Unsupported history fixture locale",
  );
  const labels = JSON.parse(
    await fs.readFile(
      new URL(
        `../../src/i18n/resources/${locale}/browserHistory.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const label = (key) => labels[`browserHistory.${key}`];
  const bridge = await page.evaluate(() => ({
    electron: window.__LIME_ELECTRON__ === true,
    invoke: typeof window.electronAPI?.invoke === "function",
  }));
  assert(
    bridge.electron && bridge.invoke,
    "Browser history requires the real Electron renderer and preload",
  );
  const fixture = await startHistoryServer();
  const consoleErrors = [];
  const pageErrors = [];
  const onConsole = (message) => {
    if (message.type() === "error")
      consoleErrors.push(sanitizeText(message.text()));
  };
  const onError = (error) => pageErrors.push(sanitizeText(error.message));
  page.on("console", onConsole);
  page.on("pageerror", onError);
  const screenshots = [];
  const capture = async (name) => {
    const directory = options.screenshotDir || path.dirname(options.output);
    await fs.mkdir(directory, { recursive: true });
    const screenshot = path.join(
      directory,
      `${locale}-browser-history-${name}.png`,
    );
    await page.screenshot({ path: screenshot, fullPage: false });
    screenshots.push(screenshot);
  };
  try {
    stage("navigate-two-local-pages");
    const initial = await readBrowserWorkspaceState(page);
    assert(
      initial.tabId === guiBeforeTurn.tabId &&
        initial.threadId === identity.threadId,
      "History fixture initial Browser identity drifted",
    );
    const navigations = [];
    let previous = initial;
    for (const target of fixture.pages) {
      const committed = await navigateHistoryPage({
        app,
        page,
        options,
        target,
        before: previous,
        readBrowserWorkspaceState,
      });
      navigations.push(committed);
      previous = committed.workspace;
    }
    stage("read-real-preload-and-persisted-history");
    const recorded = await waitFor(
      options,
      () => historySnapshot(page, file, fixture),
      (state) =>
        state.total === 2 &&
        fixture.pages.every((target) =>
          state.entries.some(
            (entry) =>
              entry.url === target.url &&
              entry.title === target.title &&
              entry.visitCount >= 1,
          ),
        ) &&
        matchesDisk(state),
      "Committed Browser pages did not reach the history store",
    );
    stage("open-history-through-native-menu");
    await page.locator('[data-testid="browser-workspace-options"]').click();
    await clickNativeMenuItem(app, "history");
    const history = page.locator('[data-testid="browser-history-page"]');
    await history.waitFor({ state: "visible", timeout: options.timeoutMs });
    await history
      .getByRole("heading", { name: label("title"), exact: true })
      .waitFor({ state: "visible" });
    const search = history.getByRole("searchbox", {
      name: label("search"),
      exact: true,
    });
    const rows = () => history.getByRole("listitem").allTextContents();
    stage("search-title-and-url");
    await search.fill(fixture.pages[0].title);
    const titleSearch = await waitFor(
      options,
      rows,
      (rows) => rows.length === 1 && rows[0].includes(fixture.pages[0].title),
      "History title search did not filter to Alpha",
    );
    await capture("search");
    await search.fill(fixture.pages[1].url);
    const urlSearch = await waitFor(
      options,
      rows,
      (rows) => rows.length === 1 && rows[0].includes(fixture.pages[1].title),
      "History URL search did not filter to Beta",
    );
    await search.fill(fixture.pages[0].title);
    await waitFor(
      options,
      rows,
      (rows) => rows.length === 1 && rows[0].includes(fixture.pages[0].title),
      "History Alpha search did not return before reopening",
    );
    stage("reopen-history-entry-through-canonical-workspace");
    const beforeReopenTrace = await readHistoryTrace(page);
    const navigation = {
      app,
      page,
      options,
      history,
      label,
      target: fixture.pages[0],
      initial,
      readBrowserWorkspaceState,
      waitFor,
    };
    const reopened = await reopenBrowserHistoryEntry(navigation);
    const reopenedHistory = await waitFor(
      options,
      () => historySnapshot(page, file, fixture),
      (state) =>
        state.revision > recorded.revision &&
        state.total === 2 &&
        state.entries.some(
          (entry) =>
            entry.url === fixture.pages[0].url &&
            entry.visitCount >
              recorded.entries.find((saved) => saved.id === entry.id)
                ?.visitCount,
        ) &&
        matchesDisk(state),
      "Reopened Browser page did not commit another persisted history visit",
    );
    const reopenedTrace = await readHistoryTrace(page);
    await capture("reopened");
    stage(
      "open-history-through-ordinary-settings-with-explicit-return-session",
    );
    const settingsReopened = await reopenBrowserHistoryFromSettings({
      ...navigation,
      identity,
      workspaceId,
      excludedTabIds: [initial.tabId, reopened.workspace.tabId],
    });
    const settingsReopenedHistory = await waitFor(
      options,
      () => historySnapshot(page, file, fixture),
      (state) =>
        state.revision > reopenedHistory.revision &&
        state.entries.some(
          (entry) =>
            entry.url === fixture.pages[0].url &&
            entry.visitCount >
              reopenedHistory.entries.find((saved) => saved.id === entry.id)
                ?.visitCount,
        ) &&
        matchesDisk(state),
      "Ordinary Settings history reopening did not persist a new visit",
    );
    await capture("settings-reopened");
    stage("return-to-history-through-reopened-tab-native-menu");
    await page.locator('[data-testid="browser-workspace-options"]').click();
    await clickNativeMenuItem(app, "history");
    await history.waitFor({ state: "visible", timeout: options.timeoutMs });
    await search.fill(fixture.pages[0].title);
    await waitFor(
      options,
      rows,
      (rows) => rows.length === 1 && rows[0].includes(fixture.pages[0].title),
      "History Alpha search did not return after reopening before deletion",
    );
    stage("delete-one-history-entry-from-ui");
    await history
      .getByRole("button", {
        name: label("remove").replace("{{title}}", fixture.pages[0].title),
        exact: true,
      })
      .click();
    const deleted = await waitFor(
      options,
      () => historySnapshot(page, file, fixture),
      (state) =>
        state.revision > settingsReopenedHistory.revision &&
        state.total === 1 &&
        state.entries[0].url === fixture.pages[1].url &&
        matchesDisk(state),
      "Single history deletion did not persist through IPC",
    );
    await history
      .getByRole("status")
      .filter({ hasText: label("noResults") })
      .waitFor({ state: "visible" });
    await search.fill(fixture.marker);
    await waitFor(
      options,
      rows,
      (rows) => rows.length === 1 && rows[0].includes(fixture.pages[1].title),
      "History UI did not retain Beta after deleting Alpha",
    );
    const beforeCancelTrace = await readHistoryTrace(page);
    const openClear = async () => {
      await history
        .getByRole("button", { name: label("clear"), exact: true })
        .click();
      const dialog = history.getByRole("alertdialog", {
        name: label("confirm"),
        exact: true,
      });
      await dialog.waitFor({ state: "visible" });
      await dialog
        .getByRole("combobox", { name: label("period"), exact: true })
        .selectOption("all");
      return dialog;
    };
    stage("cancel-explicit-clear-confirmation");
    let dialog = await openClear();
    await capture("confirmation");
    const beforeCancel = await historySnapshot(page, file, fixture);
    await dialog
      .getByRole("button", { name: label("cancel"), exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    const cancelled = await historySnapshot(page, file, fixture);
    const afterCancelTrace = await readHistoryTrace(page);
    stage("confirm-clear-and-verify-disk-revision");
    dialog = await openClear();
    await dialog
      .getByRole("button", { name: label("clear"), exact: true })
      .click();
    const cleared = await waitFor(
      options,
      () => historySnapshot(page, file, fixture),
      (state) =>
        state.revision > cancelled.revision &&
        state.total === 0 &&
        state.disk.totalEntries === 0 &&
        matchesDisk(state),
      "Confirmed history clear did not persist through IPC",
    );
    await dialog.waitFor({ state: "hidden" });
    await search.fill("");
    await history
      .getByRole("status")
      .filter({ hasText: label("empty") })
      .waitFor({ state: "visible" });
    await capture("cleared");
    const invoke = await waitFor(
      options,
      () => readHistoryTrace(page),
      (trace) =>
        ["browser_history_remove", "browser_history_clear"].every((command) =>
          trace.commands.some(
            (entry) =>
              entry.command === command &&
              entry.transport === "electron-ipc" &&
              entry.status === "success",
          ),
        ),
      "History UI mutations did not produce successful native IPC traces",
    );
    const clearCount = (trace) =>
      trace.commands.filter(
        (entry) => entry.command === "browser_history_clear",
      ).length;
    const nativeMountCount = (trace) =>
      trace.commands.filter(
        (entry) =>
          entry.command === "browser_tab_mount" &&
          entry.transport === "electron-ipc" &&
          entry.status === "success",
      ).length;
    const assertions = {
      realElectronPreload: bridge.electron && bridge.invoke,
      isolatedTemporaryProfile: true,
      bothPagesServedLocally: fixture.pages.every((target) =>
        fixture.requests.includes(target.pathname),
      ),
      committedTitlesOnSameNativePage: navigations.every(
        ({ workspace, native }, index) =>
          workspace.tabId === initial.tabId &&
          workspace.sessionId === initial.sessionId &&
          workspace.threadId === identity.threadId &&
          workspace.viewId === initial.viewId &&
          workspace.webContentsId === initial.webContentsId &&
          native.webContentsId === initial.webContentsId &&
          native.url === fixture.pages[index].url &&
          native.title === fixture.pages[index].title &&
          !native.loading,
      ),
      committedHistoryPersisted: recorded.total === 2 && matchesDisk(recorded),
      nativeMenuOpenedHistory: true,
      searchByTitle:
        titleSearch.length === 1 &&
        titleSearch[0].includes(fixture.pages[0].title),
      searchByUrl:
        urlSearch.length === 1 && urlSearch[0].includes(fixture.pages[1].url),
      historyEntryOpensNewCanonicalTab:
        reopened.workspace.tabId !== initial.tabId &&
        reopened.workspace.sessionId === initial.sessionId &&
        reopened.workspace.threadId === identity.threadId &&
        reopened.tabs.some(
          (tab) =>
            tab.tabId === initial.tabId &&
            tab.browserSessionId === initial.sessionId &&
            tab.threadId === identity.threadId &&
            !tab.selected,
        ) &&
        reopened.tabs.some(
          (tab) =>
            tab.tabId === reopened.workspace.tabId &&
            tab.browserSessionId === initial.sessionId &&
            tab.threadId === identity.threadId &&
            tab.selected,
        ),
      reopenedPageHasNewNativeViewAndCommittedTitle:
        reopened.workspace.viewId !== initial.viewId &&
        reopened.workspace.webContentsId !== initial.webContentsId &&
        reopened.native.webContentsId === reopened.workspace.webContentsId &&
        reopened.native.url === fixture.pages[0].url &&
        reopened.native.title === fixture.pages[0].title &&
        !reopened.native.loading &&
        reopened.workspace.pageRevision > 0,
      reopeningPersistsAnotherHistoryVisit:
        reopenedHistory.revision > recorded.revision &&
        matchesDisk(reopenedHistory),
      reopeningMountsThroughRealPreloadIpc:
        nativeMountCount(reopenedTrace) > nativeMountCount(beforeReopenTrace),
      settingsHistoryReturnsToExplicitSessionAndWorkspace:
        settingsReopened.proof.canonicalRead &&
        settingsReopened.proof.workspaceRead &&
        settingsReopened.proof.sameOwnerRequest &&
        settingsReopened.proof.traceComplete,
      settingsHistoryCreatesAnotherCanonicalNativeTab:
        settingsReopened.workspace.tabId !== initial.tabId &&
        settingsReopened.workspace.tabId !== reopened.workspace.tabId &&
        settingsReopened.workspace.webContentsId !== initial.webContentsId &&
        settingsReopened.workspace.webContentsId !==
          reopened.workspace.webContentsId &&
        settingsReopened.tabs.length === reopened.tabs.length + 1 &&
        settingsReopened.tabs.some(
          (tab) =>
            tab.tabId === settingsReopened.workspace.tabId &&
            tab.threadId === identity.threadId &&
            tab.browserSessionId === initial.sessionId &&
            tab.selected,
        ),
      settingsHistoryReopeningPersistsAnotherVisit:
        settingsReopenedHistory.revision > reopenedHistory.revision &&
        matchesDisk(settingsReopenedHistory),
      reopenedTabMenuReturnsToHistory: true,
      singleDeleteRetainsOtherEntry:
        deleted.total === 1 &&
        deleted.entries[0].url === fixture.pages[1].url &&
        matchesDisk(deleted),
      openingConfirmationDoesNotDelete: sameHistory(deleted, beforeCancel),
      cancelKeepsDiskAndRevision:
        sameHistory(beforeCancel, cancelled) &&
        clearCount(beforeCancelTrace) === clearCount(afterCancelTrace),
      confirmedClearPersistsNewRevision:
        cleared.revision > cancelled.revision &&
        cleared.total === 0 &&
        cleared.disk.totalEntries === 0 &&
        matchesDisk(cleared),
      historyMutationsUseRealIpc: [
        "browser_history_remove",
        "browser_history_clear",
      ].every((command) =>
        invoke.commands.some(
          (entry) =>
            entry.command === command &&
            entry.transport === "electron-ipc" &&
            entry.status === "success",
        ),
      ),
      noProductionMockFallback: invoke.mockFallbackHitCount === 0,
      noRendererErrors: consoleErrors.length === 0 && pageErrors.length === 0,
    };
    const failedAssertions = Object.entries(assertions)
      .filter(([, passed]) => !passed)
      .map(([name]) => name);
    return sanitizeJson({
      schemaVersion: "lime.browser_runtime_electron_gate_b.history.v1",
      scenario: "history",
      status: failedAssertions.length === 0 ? "pass" : "fail",
      generatedAt: new Date().toISOString(),
      proofLevel: "Desktop Host/history",
      claimBoundary:
        "真实 Electron 地址栏、原生菜单、preload/IPC、BrowserHistoryHost/store、设置历史 UI（菜单与普通设置入口）与原明确 session/workspace 的 canonical Browser tab 重开的本地闭环。磁盘仅只读核验；未验证进程重启、Agent history 访问权限、完整 G07、live provider 或其他平台。",
      identity: {
        threadId: identity.threadId,
        browserSessionId: initial.sessionId,
        tabId: initial.tabId,
        viewId: initial.viewId,
        webContentsId: initial.webContentsId,
      },
      fixture: { pages: fixture.pages, requests: fixture.requests },
      captures: {
        navigations,
        recorded,
        titleSearch,
        urlSearch,
        reopened,
        reopenedHistory,
        beforeReopenTrace,
        reopenedTrace,
        settingsReopened,
        settingsReopenedHistory,
        deleted,
        beforeCancel,
        cancelled,
        cleared,
      },
      screenshots,
      invoke,
      assertions,
      failedAssertions,
      diagnostics: {
        consoleErrors,
        pageErrors,
        scope:
          "scenario renderer only; main-process diagnostics belong to the harness",
      },
    });
  } catch (error) {
    await writeBrowserHistoryFailure({
      page,
      capture,
      options,
      error,
      consoleErrors,
      pageErrors,
      screenshots,
      identity,
      workspaceId,
      browserSessionId: guiBeforeTurn.sessionId,
      invokeTrace: readInvokeTrace?.(),
    });
    throw error;
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onError);
    await fixture.close();
  }
}
