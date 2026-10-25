import fs from "node:fs/promises";
import path from "node:path";
import { clickNativeMenuItem } from "./browser-runtime-gate-a.mjs";
import { assert, sanitizeText } from "./claw-chat-current-fixture-utils.mjs";
import { runBrowserSiteSettingsControls } from "./browser-runtime-electron-site-settings.mjs";

/** Real settings routes and native browser identity; no synthetic route or turn. */
export async function runBrowserSettingsNavigationScenario({
  app,
  page,
  options,
  guiBeforeTurn,
  readBrowserWorkspaceState,
  readInvokeTrace,
}) {
  const assertions = {};
  const screenshots = [];
  const observations = {};
  const check = (name, value) => {
    assertions[name] = Boolean(value);
    assert(value, name);
  };
  const locale = options.locale || "zh-CN";
  const load = async (part) =>
    JSON.parse(
      await fs.readFile(
        new URL(
          `../../src/i18n/resources/${locale}/${part}.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
  const messages = await load("browserManagement");
  const history = await load("browserHistory");
  const settings = await load("settings");
  const label = (key) => messages[`browserManagement.${key}`];
  const list = () =>
    page.evaluate(
      async (scope) =>
        window.electronAPI.invoke("browser_tab_list", {
          browserSessionId: scope.sessionId,
          threadId: scope.threadId,
        }),
      guiBeforeTurn,
    );
  const capture = async (name) => {
    const file = path.join(
      path.dirname(options.output),
      `${locale}-${name}.png`,
    );
    await page.screenshot({ path: file });
    screenshots.push(file);
  };
  const rootButton = (kind) =>
    page.locator(
      `#browser-${kind === "history" ? "history" : "download-history"} button`,
    );
  const waitForFocus = (selector) =>
    page.waitForFunction(
      (selector) => document.querySelector(selector) === document.activeElement,
      selector,
      { timeout: Math.min(options.timeoutMs, 20000) },
    );
  const header = page.getByTestId("browser-management-header");
  let initial = [];
  try {
    const isolated = await app.evaluate(
      ({ app }) =>
        process.env.LIME_ELECTRON_E2E === "1" &&
        app.getPath("userData") === process.env.ELECTRON_E2E_USER_DATA_DIR,
    );
    check("isolated-native-profile", isolated);
    initial = await list();
    check(
      "one-original-native-page",
      initial.length === 1 &&
        initial[0].webContentsId === guiBeforeTurn.webContentsId,
    );
    const siteSettings = await runBrowserSiteSettingsControls({
      app,
      page,
      options,
      guiBeforeTurn,
      header,
      messages: settings,
    });
    Object.assign(assertions, siteSettings.assertions);
    screenshots.push(...siteSettings.screenshots);
    observations.siteSettings = { claimBoundary: siteSettings.claimBoundary };
    for (const kind of ["history", "downloads"]) {
      await page.getByTestId("browser-workspace-options").click();
      await clickNativeMenuItem(app, kind);
      await page
        .getByTestId(`browser-${kind}-page`)
        .waitFor({ state: "visible", timeout: options.timeoutMs });
      check(`${kind}-menu-opens-management`, await header.isVisible());
      check(
        `${kind}-forward-disabled`,
        await header
          .getByRole("button", { name: label("forward"), exact: true })
          .isDisabled(),
      );
      check(
        `${kind}-breadcrumb-shape`,
        (await header.locator("nav button").count()) === 2 &&
          (await header.locator('[aria-current="page"] h1').count()) === 1,
      );
      await waitForFocus(
        `[data-testid="browser-${kind}-page"] input[type="search"]`,
      );
      check(
        `${kind}-search-focused`,
        await page
          .getByTestId(`browser-${kind}-page`)
          .locator('input[type="search"]')
          .evaluate((input) => document.activeElement === input),
      );
      await capture(`${kind}-management`);
      await header
        .getByRole("button", { name: label("back"), exact: true })
        .click();
      await rootButton(kind).waitFor({ state: "visible" });
      await waitForFocus(
        `#browser-${kind === "history" ? "history" : "download-history"} button`,
      );
      check(
        `${kind}-back-restores-manage-focus`,
        await rootButton(kind).evaluate(
          (button) => document.activeElement === button,
        ),
      );
      await rootButton(kind).click();
      await header.waitFor({ state: "visible" });
      check(
        `${kind}-reopens-after-back`,
        await page.getByTestId(`browser-${kind}-page`).isVisible(),
      );
      await header.locator("nav button").nth(1).click();
      await rootButton(kind).waitFor({ state: "visible" });
      await waitForFocus(
        `#browser-${kind === "history" ? "history" : "download-history"} button`,
      );
      check(
        `${kind}-browser-breadcrumb-restores-focus`,
        await rootButton(kind).evaluate(
          (button) => document.activeElement === button,
        ),
      );
      await rootButton(kind).click();
      await header
        .getByRole("button", { name: label("settings"), exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="settings-sidebar-tab-general"]')
            ?.getAttribute("aria-current") === "page",
        undefined,
        { timeout: options.timeoutMs },
      );
      check(
        `${kind}-settings-breadcrumb-opens-general`,
        (await page.getByTestId(`browser-${kind}-page`).count()) === 0,
      );
      await page.getByTestId("settings-sidebar-tab-browser-use").click();
      await rootButton(kind).waitFor({ state: "visible" });
      await page.getByTestId("settings-back-button").click();
      await page
        .getByTestId("browser-workspace-options")
        .waitFor({ state: "visible", timeout: options.timeoutMs });
      const returned = await readBrowserWorkspaceState(page);
      check(
        `${kind}-returns-to-original-canonical-browser`,
        returned.threadId === guiBeforeTurn.threadId &&
          returned.sessionId === guiBeforeTurn.sessionId &&
          returned.webContentsId === guiBeforeTurn.webContentsId &&
          returned.tabId === guiBeforeTurn.tabId,
      );
    }
    await page.getByTestId("browser-workspace-options").click();
    await clickNativeMenuItem(app, "history");
    await page
      .getByTestId("browser-history-page")
      .waitFor({ state: "visible" });
    const openLabel = history["browserHistory.open"].replace(
      "{{title}}",
      initial[0].title,
    );
    await page.getByRole("link", { name: openLabel, exact: true }).click();
    await page
      .getByTestId("browser-workspace-options")
      .waitFor({ state: "visible", timeout: options.timeoutMs });
    observations.firstHistoryReturn = await readBrowserWorkspaceState(page);
    observations.historyReturnWorkspaces = await page
      .locator('[data-testid="browser-workspace"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          visible: node.checkVisibility(),
          threadId: node.getAttribute("data-browser-thread-id"),
          sessionId: node.getAttribute("data-browser-session-id"),
          tabId: node.getAttribute("data-browser-tab-id"),
          viewId: node.getAttribute("data-browser-view-id"),
          webContentsId: node.getAttribute("data-browser-web-contents-id"),
        })),
      );
    const final = await list();
    const created = final.find(
      (tab) => tab.selected && tab.tabId !== guiBeforeTurn.tabId,
    );
    assert(created, "History navigation has no distinct selected native tab");
    await page.waitForFunction(
      ({ initial, created }) =>
        [
          ...document.querySelectorAll('[data-testid="browser-workspace"]'),
        ].some(
          (node) =>
            node.checkVisibility() &&
            node.getAttribute("data-browser-thread-id") === initial.threadId &&
            node.getAttribute("data-browser-session-id") ===
              initial.sessionId &&
            node.getAttribute("data-browser-tab-id") === created.tabId &&
            node.getAttribute("data-browser-view-id") === created.viewId &&
            Number(node.getAttribute("data-browser-web-contents-id")) ===
              created.webContentsId &&
            node.getAttribute("data-browser-url") === created.url,
        ),
      { initial: guiBeforeTurn, created },
      { timeout: Math.min(options.timeoutMs, 20000) },
    );
    const opened = await page
      .locator('[data-testid="browser-workspace"]:visible')
      .evaluate((node) => ({
        threadId: node.getAttribute("data-browser-thread-id"),
        sessionId: node.getAttribute("data-browser-session-id"),
        webContentsId: Number(
          node.getAttribute("data-browser-web-contents-id"),
        ),
        address: node.getAttribute("data-browser-url"),
      }));
    observations.settledHistoryReturn = opened;
    check(
      "history-after-settings-navigation-uses-original-thread",
      opened.threadId === guiBeforeTurn.threadId &&
        opened.sessionId === guiBeforeTurn.sessionId,
    );
    check(
      "original-native-page-retained",
      final.some(
        (tab) =>
          tab.tabId === guiBeforeTurn.tabId &&
          tab.webContentsId === guiBeforeTurn.webContentsId &&
          tab.url === initial[0].url,
      ),
    );
    check(
      "history-entry-created-distinct-native-page",
      final.length === 2 &&
        opened.webContentsId !== guiBeforeTurn.webContentsId &&
        opened.address === initial[0].url,
    );
    const native = await app.evaluate(({ webContents, session }, id) => {
      const contents = webContents.fromId(id);
      return {
        alive: Boolean(contents && !contents.isDestroyed()),
        sameSession:
          contents?.session ===
          session.fromPartition("persist:embedded-browser"),
      };
    }, guiBeforeTurn.webContentsId);
    check("same-persistent-native-session", native.alive && native.sameSession);
    const trace = readInvokeTrace();
    check(
      "real-app-server-and-native-bridge",
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
      scenario: "settings-navigation",
      assertions,
      failedAssertions: Object.keys(assertions).filter(
        (key) => !assertions[key],
      ),
      screenshots,
      initial,
      final,
      observations,
      claimBoundary:
        "Real Electron management routes, production native menu callback, preload/IPC/App Server bridge and same Browser Session/thread/native page. Native menu uses synthetic DOM click in its actual trusted WCV. No Agent turn, physical OS input, reference pixel parity or packaged-platform claim.",
      diagnostics: { hiddenHost: host },
    };
  } catch (error) {
    await capture("failure").catch(() => undefined);
    await fs.writeFile(
      options.output,
      JSON.stringify(
        {
          scenario: "settings-navigation",
          status: "fail",
          assertions,
          screenshots,
          observations,
          error: sanitizeText(error),
          nativeTabs: await list().catch(() => null),
          diagnostics: {},
        },
        null,
        2,
      ) + "\n",
    );
    throw error;
  }
}
