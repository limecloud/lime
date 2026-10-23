import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assert, sanitizeText } from "./claw-chat-current-fixture-utils.mjs";
import { parseJsonRpcRequestsFromInvokeTrace } from "../electron/lib/mcp-config-fixture-evidence.mjs";

/** Uses only the launcher's isolated Profile and the existing canonical native tab. */
export async function runBrowserDataScenario(params) {
  const checks = {};
  try {
    return await runScenario({ ...params, checks });
  } catch (error) {
    const ui = await params.page
      .evaluate(() => ({
        alert:
          document.querySelector(
            '[data-testid="browser-clear-browsing-data-dialog"] [role="alert"]',
          )?.textContent || null,
        busy: document
          .querySelector(
            '[data-testid="browser-clear-browsing-data-dialog"] form',
          )
          ?.getAttribute("aria-busy"),
      }))
      .catch(() => null);
    await params.page
      .screenshot({
        path: path.join(path.dirname(params.options.output), "failure.png"),
      })
      .catch(() => undefined);
    await fs.writeFile(
      params.options.output,
      JSON.stringify(
        {
          status: "fail",
          scenario: "browser-data",
          assertions: checks,
          error: sanitizeText(error),
          ui,
          diagnostics: {},
        },
        null,
        2,
      ) + "\n",
    );
    console.error(
      `[browser-data] failure=${sanitizeText(error)} ui=${JSON.stringify(ui)}`,
    );
    throw error;
  }
}

async function waitForClear(page, dialog, options) {
  await page.waitForFunction(
    () => {
      const dialog = document.querySelector(
        '[data-testid="browser-clear-browsing-data-dialog"]',
      );
      return !dialog || Boolean(dialog.querySelector('[role="alert"]'));
    },
    undefined,
    { timeout: options.timeoutMs },
  );
  const errors = dialog.getByRole("alert");
  if (await errors.count()) throw new Error(await errors.innerText());
  await dialog.waitFor({ state: "hidden" });
}

async function runScenario({
  app,
  page,
  options,
  identity,
  guiBeforeTurn,
  readInvokeTrace,
  checks,
}) {
  const check = (name, value) => {
    checks[name] = Boolean(value);
    console.log(`[browser-data] check=${name} passed=${Boolean(value)}`);
    assert(value, name);
  };
  const locale = options.locale || "zh-CN";
  const messages = JSON.parse(
    await fs.readFile(
      new URL(
        `../../src/i18n/resources/${locale}/browserData.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const label = (key) => messages[`browserData.${key}`];
  const profile = await app.evaluate(({ app }) => ({
    directory: app.getPath("userData"),
    isolated:
      process.env.LIME_ELECTRON_E2E === "1" &&
      app.getPath("userData") === process.env.ELECTRON_E2E_USER_DATA_DIR,
  }));
  const relative = path.relative(os.tmpdir(), profile.directory);
  check(
    "isolated-temporary-profile",
    profile.isolated &&
      relative &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative),
  );
  check(
    "canonical-thread-and-native-view",
    guiBeforeTurn.threadId === identity.threadId &&
      Number.isInteger(guiBeforeTurn.webContentsId),
  );
  check(
    "real-electron-preload",
    await page.evaluate(
      () =>
        window.__LIME_ELECTRON__ === true &&
        typeof window.electronAPI?.invoke === "function",
    ),
  );
  const id = guiBeforeTurn.webContentsId;
  const key = "browser-data-isolation-fixture";
  await app.evaluate(
    async ({ webContents, session }, { id, key }) => {
      const target = webContents.fromId(id);
      if (
        !target ||
        target.isDestroyed() ||
        target.session !== session.fromPartition("persist:embedded-browser")
      )
        throw new Error("Unexpected Browser Session");
      await target.session.cookies.set({
        url: target.getURL(),
        name: key,
        value: "browser",
        httpOnly: true,
      });
      await target.executeJavaScript(
        `localStorage.setItem(${JSON.stringify(key)}, 'browser')`,
      );
      await session.defaultSession.cookies.set({
        url: "https://shell-fixture.invalid/",
        name: key,
        value: "shell",
        httpOnly: true,
      });
    },
    { id, key },
  );
  const nativeState = () =>
    app.evaluate(
      async ({ webContents, session }, { id, key }) => {
        const target = webContents.fromId(id);
        if (!target || target.isDestroyed())
          throw new Error("Canonical Browser view was destroyed");
        return {
          browserCookie: (await target.session.cookies.get({ name: key }))
            .length,
          shellCookie: (await session.defaultSession.cookies.get({ name: key }))
            .length,
          localValue: await target.executeJavaScript(
            `localStorage.getItem(${JSON.stringify(key)})`,
          ),
          sameSession:
            target.session ===
            session.fromPartition("persist:embedded-browser"),
        };
      },
      { id, key },
    );
  const before = await nativeState();
  const historyBefore = await page.evaluate(() =>
    window.electronAPI.invoke("browser_history_list", {}),
  );
  check(
    "native-fixture-and-history-present",
    before.browserCookie === 1 &&
      before.shellCookie === 1 &&
      before.localValue === "browser" &&
      historyBefore.total > 0,
  );
  await page.getByTestId("app-sidebar-nav-settings").click();
  await page.getByTestId("settings-sidebar-tab-browser-use").click();
  const trigger = page.locator("#browser-browsing-data button");
  const dialog = page.getByTestId("browser-clear-browsing-data-dialog");
  const screenshots = [];
  const capture = async (name) => {
    const file = path.join(
      options.screenshotDir || path.dirname(options.output),
      `${locale}-browser-data-${name}.png`,
    );
    await fs.mkdir(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file });
    screenshots.push(file);
  };
  await capture("settings");
  await trigger.click();
  await dialog.waitFor({ state: "visible", timeout: options.timeoutMs });
  check(
    "six-data-rows-five-ranges",
    (await dialog.getByRole("checkbox").count()) === 6 &&
      (await dialog.locator("button[aria-pressed]").count()) === 5,
  );
  check(
    "default-last-hour-and-first-four-types",
    (await dialog
      .getByRole("button", { name: label("range.lastHour"), exact: true })
      .getAttribute("aria-pressed")) === "true" &&
      (
        await dialog
          .getByRole("checkbox")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("aria-checked")),
          )
      ).join(",") === "true,true,true,true,false,false",
  );
  await capture("default");
  await dialog
    .getByRole("button", { name: label("delete"), exact: true })
    .click();
  await dialog.getByRole("alert").waitFor({ state: "visible" });
  check("unsupported-combination-remains-open", await dialog.isVisible());
  const rejected = await nativeState();
  const rejectedHistory = await page.evaluate(() =>
    window.electronAPI.invoke("browser_history_list", {}),
  );
  check(
    "unsupported-combination-zero-side-effects",
    JSON.stringify(before) === JSON.stringify(rejected) &&
      historyBefore.revision === rejectedHistory.revision,
  );
  await capture("unsupported");
  // A supported ranged operation still uses the original history owner and UI submission.
  for (const type of ["siteData", "cache", "downloads"])
    await dialog.locator(`#browser-clear-browsing-data-${type}`).click();
  await dialog
    .getByRole("button", { name: label("delete"), exact: true })
    .click();
  await waitForClear(page, dialog, options);
  const historyAfter = await page.evaluate(() =>
    window.electronAPI.invoke("browser_history_list", {}),
  );
  const disk = JSON.parse(
    await fs.readFile(
      path.join(profile.directory, "browser", "history.json"),
      "utf8",
    ),
  );
  check(
    "ranged-history-cleared-and-persisted",
    historyAfter.total === 0 &&
      historyAfter.revision > historyBefore.revision &&
      disk.revision === historyAfter.revision &&
      disk.entries.length === 0,
  );
  check(
    "unselected-native-data-preserved",
    JSON.stringify(before) === JSON.stringify(await nativeState()),
  );
  await trigger.focus();
  await trigger.click();
  await dialog.waitFor({ state: "visible" });
  check(
    "reopen-restores-default-range",
    (await dialog
      .getByRole("button", { name: label("range.lastHour"), exact: true })
      .getAttribute("aria-pressed")) === "true",
  );
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  check(
    "idle-escape-restores-trigger-focus",
    await trigger.evaluate((node) => document.activeElement === node),
  );
  await trigger.click();
  await dialog
    .getByRole("button", { name: label("range.allTime"), exact: true })
    .click();
  await capture("all-time");
  await dialog
    .getByRole("button", { name: label("delete"), exact: true })
    .click();
  await waitForClear(page, dialog, options);
  const after = await nativeState();
  check(
    "native-cookie-and-local-storage-cleared",
    after.browserCookie === 0 && after.localValue === null && after.sameSession,
  );
  check("default-shell-session-preserved", after.shellCookie === 1);
  await trigger.click();
  await dialog.waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      document.getElementById(
        "browser-clear-browsing-data-siteData-description",
      )?.textContent,
  );
  const preview = await page.evaluate(() =>
    window.electronAPI.invoke("browser_data_summary", { timeRange: "allTime" }),
  );
  check(
    "summary-reflects-actual-cleared-stores",
    preview.history.siteCount === 0 &&
      preview.siteData?.siteCount === 0 &&
      preview.downloads?.count === 0 &&
      Number.isSafeInteger(preview.cache?.sizeBytes),
  );
  await capture("cleared");
  await dialog
    .getByRole("button", { name: label("cancel"), exact: true })
    .click();
  const trace = await readInvokeTrace();
  const entries = Array.isArray(trace)
    ? trace
    : trace.ledgerEntries || trace.entries || [];
  const commands = entries
    .filter((entry) => /^browser_data_/u.test(entry.command || ""))
    .map((entry) => ({
      command: entry.command,
      transport: entry.transport,
      status: entry.status,
    }));
  const requests = parseJsonRpcRequestsFromInvokeTrace(JSON.stringify(entries));
  check(
    "app-server-json-rpc-chain-used",
    requests.some(
      (request) =>
        request.method === "workspaceRightSurface/request" &&
        request.transport === "electron-ipc" &&
        request.status === "success",
    ),
  );
  check(
    "settings-summary-clear-use-real-ipc",
    [
      "browser_data_settings",
      "browser_data_summary",
      "browser_data_clear",
    ].every((command) =>
      commands.some(
        (entry) =>
          entry.command === command &&
          entry.transport === "electron-ipc" &&
          entry.status === "success",
      ),
    ),
  );
  check(
    "no-production-mock-fallback",
    !entries.some(
      (entry) =>
        entry.mock === true ||
        entry.mockFallback === true ||
        /mock/u.test(entry.transport || ""),
    ),
  );
  return {
    status: "pass",
    scenario: "browser-data",
    proofLevel: "Gate B",
    claimBoundary:
      "Isolated macOS Desktop profile slice: real Settings UI/preload/IPC, canonical Browser Session, history persistence, all-time cookie/localStorage clearing and default Session isolation. Does not prove full S05, native range clearing, autofill/site settings, seeded cache eviction, live provider or packaged Windows.",
    assertions: checks,
    failedAssertions: Object.entries(checks)
      .filter(([, value]) => !value)
      .map(([name]) => name),
    identity: { threadId: identity.threadId, webContentsId: id },
    screenshots,
    commands,
    diagnostics: {},
  };
}
