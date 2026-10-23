import fs from "node:fs";
import path from "node:path";
import {
  ensureElectronFixtureBuild,
  inspectElectronFixtureBuildFreshness,
} from "../../lib/electron-fixture-build.mjs";
import {
  electronAppServerBinaryDestination,
  resolveElectronAppServerRuntimeEnv,
} from "../../lib/electron-app-server-assets.mjs";
import {
  launchElectronFixture,
  closeElectronFixture,
  createTempRuntimeEnv,
  openSettings,
  appServerCallFromPage,
  parseInvokeTraceRaw,
} from "../mcp-config-fixture-smoke.mjs";
import {
  parseSettingsAppearanceFixtureArgs,
  summarizeSettingsAppearanceTrace,
} from "./settings-appearance-fixture-evidence.mjs";

const options = parseSettingsAppearanceFixtureArgs(process.argv.slice(2), {
  defaults: {
    runId: null,
    evidenceDir: null,
    prefix: "settings-keyboard",
    timeoutMs: 120000,
    intervalMs: 250,
    keepTemp: false,
  },
});
fs.mkdirSync(options.evidenceDir, { recursive: true });
const summary = {
  scenario: "keyboard-bindings-config-dispatch-cold-restore",
  result: "fail",
  startedAt: new Date().toISOString(),
  assertions: {},
  launches: [],
  measurements: {},
  calls: [],
  proof:
    "real Electron/preload/IPC/App Server/config YAML/GUI keyboard input; no agent or live provider turn",
};
const consoleErrors = [],
  pageErrors = [],
  traces = [],
  errors = [];
let handle, runtime;
const primary = process.platform === "darwin" ? "Meta" : "Control";
const custom = `${primary}+Shift+Y`;
const row = (page) => page.locator('[data-command-id="searchSettings"]');
const check = (name, value) => {
  summary.assertions[name] = Boolean(value);
  if (!value) throw Error(name);
};
async function launch() {
  handle = await launchElectronFixture({
    options,
    runtimeEnv: runtime,
    appServerEnv: runtime.appServerEnv,
    consoleErrors,
    pageErrors,
  });
  summary.launches.push(handle.rendererSnapshot);
  return handle.page;
}
async function close() {
  const buffer = await handle.page.evaluate(() => ({
    trace: localStorage.getItem("lime_invoke_trace_buffer_v1"),
    errors: localStorage.getItem("lime_invoke_error_buffer_v1"),
  }));
  traces.push(buffer.trace);
  errors.push(buffer.errors);
  await closeElectronFixture(handle);
  handle = null;
}
async function open(page) {
  await openSettings(page, options);
  await page.getByTestId("settings-sidebar-tab-keyboard-shortcuts").click();
  await row(page).locator("[data-binding-button]").first().waitFor();
  await page.waitForFunction(
    () =>
      !document.querySelector(
        '[data-command-id="searchSettings"] [data-binding-button]',
      )?.disabled,
  );
}
async function readConfig() {
  const response = await appServerCallFromPage(handle.page, "config/read", {
    includeLayers: true,
  });
  summary.calls.push({
    method: "config/read",
    transport: response.ipcObservation.transport,
    requestId: response.ipcObservation.requestId,
    responseId: response.ipcObservation.responseId,
  });
  return response.result.config;
}
async function edit(page) {
  await row(page).locator("[data-binding-button]").first().click();
  const input = row(page).locator("input");
  await input.waitFor();
  return input;
}
async function action(page, name) {
  await row(page).locator('[aria-haspopup="menu"]').focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("menuitem", { name, exact: true }).click();
}
async function proveCustom(page) {
  await page.locator('[data-testid="settings-content"] h1').click();
  await page.keyboard.press(`${primary}+f`);
  check(
    `oldKeyIgnoredLaunch${summary.launches.length}`,
    await page.evaluate(
      () =>
        document.activeElement?.getAttribute("data-testid") !==
        "settings-sidebar-search",
    ),
  );
  await page.keyboard.press(custom);
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("data-testid") ===
      "settings-sidebar-search",
  );
  check(`newKeyFocusesActualSearchLaunch${summary.launches.length}`, true);
}
async function screenshot(page, name) {
  summary.measurements[name] = await page.evaluate(() => {
    const row = document.querySelector('[data-command-id="searchSettings"]'),
      content = document.querySelector('[data-testid="settings-content"]');
    return {
      label: getComputedStyle(row.querySelector(".settings-row-label"))
        .fontSize,
      description: getComputedStyle(
        row.querySelector(".settings-row-description"),
      ).fontSize,
      radius: getComputedStyle(row.parentElement).borderRadius,
      horizontalOverflow: content.scrollWidth > content.clientWidth + 1,
    };
  });
  await page.screenshot({
    path: path.join(options.evidenceDir, `${name}.png`),
  });
}
try {
  ensureElectronFixtureBuild({
    rootDir: process.cwd(),
    logPrefix: "settings-keyboard-fixture",
  });
  runtime = createTempRuntimeEnv();
  runtime.appServerEnv = resolveElectronAppServerRuntimeEnv({
    env: {
      ...runtime.env,
      APP_SERVER_BIN: electronAppServerBinaryDestination({
        outputRoot: path.resolve("dist-electron"),
      }),
    },
    repoRoot: process.cwd(),
  });
  let page = await launch();
  await open(page);
  const before = await readConfig();
  await (await edit(page)).press(custom);
  await row(page).locator("input").waitFor({ state: "detached" });
  const saved = await readConfig();
  const binding = saved.desktop["keyboard-shortcuts"].searchSettings;
  check(
    "canonicalCustomKeySaved",
    binding.length === 1 &&
      binding[0] ===
        (process.platform === "darwin" ? "Command+Shift+Y" : "Control+Shift+Y"),
  );
  check(
    "otherDesktopPreferencesPreserved",
    saved.desktop["open-local-url-in-target-preference"] ===
      before.desktop?.["open-local-url-in-target-preference"],
  );
  await proveCustom(page);
  await page.getByRole("button", { name: "按键搜索", exact: true }).click();
  const search = page.getByRole("searchbox", {
    name: "按键搜索捕获",
    exact: true,
  });
  await search.press(custom);
  check(
    "keystrokeSearchUsesEffectiveKey",
    (await page.locator("[data-command-id]").count()) === 1 &&
      (await search.evaluate((node) => document.activeElement === node)),
  );
  await search.press("Escape");
  await page
    .getByRole("searchbox", { name: "搜索快捷键", exact: true })
    .waitFor();
  check(
    "escapeLeavesKeystrokeSearch",
    (await page.locator("[data-command-id]").count()) >= 2,
  );
  const capture = await edit(page);
  await capture.press(`${primary}+/`);
  await row(page).getByRole("alert").waitFor();
  check(
    "captureConflictDoesNotOpenHelp",
    (await page.locator("[data-keyboard-shortcuts-dialog]").count()) === 0,
  );
  check(
    "conflictPreservesCanonicalKey",
    JSON.stringify(
      (await readConfig()).desktop["keyboard-shortcuts"].searchSettings,
    ) === JSON.stringify(binding),
  );
  await capture.press("Escape");
  await action(page, "添加快捷键");
  const appended = row(page).locator("input");
  await appended.waitFor();
  await appended.press("Alt+F8");
  await row(page).locator("input").waitFor({ state: "detached" });
  check(
    "secondBindingAppended",
    (await readConfig()).desktop["keyboard-shortcuts"].searchSettings.length ===
      2,
  );
  for (const [theme, name] of [
    ["浅色", "keyboard-light"],
    ["深色", "keyboard-dark"],
  ]) {
    await page.getByTestId("settings-sidebar-tab-appearance").click();
    await page.getByRole("radio", { name: theme, exact: true }).click();
    await page.getByTestId("settings-sidebar-tab-keyboard-shortcuts").click();
    await row(page).waitFor();
    await screenshot(page, name);
  }
  await page.setViewportSize({ width: 900, height: 760 });
  await screenshot(page, "keyboard-narrow");
  await close();
  page = await launch();
  await open(page);
  check(
    "coldRestartKeepsBothBindings",
    (await readConfig()).desktop["keyboard-shortcuts"].searchSettings.length ===
      2,
  );
  await proveCustom(page);
  await action(page, "清除快捷键");
  await page.waitForFunction(() =>
    document
      .querySelector('[data-command-id="searchSettings"]')
      ?.textContent.includes("未分配"),
  );
  check(
    "clearPreservesEditableRow",
    (await row(page).locator("[data-binding-button]").count()) === 1,
  );
  check(
    "emptyBindingsPersisted",
    (await readConfig()).desktop["keyboard-shortcuts"].searchSettings.length ===
      0,
  );
  await page.locator('[data-testid="settings-content"] h1').click();
  await page.keyboard.press(custom);
  check(
    "clearedKeyDoesNotFocusSearch",
    await page.evaluate(
      () =>
        document.activeElement?.getAttribute("data-testid") !==
        "settings-sidebar-search",
    ),
  );
  await row(page).locator('[aria-haspopup="menu"]').focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("menu").waitFor();
  await page.keyboard.press("End");
  await page.waitForFunction(
    () => document.activeElement?.textContent === "恢复默认值",
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      !document
        .querySelector('[data-command-id="searchSettings"]')
        ?.textContent.includes("未分配"),
  );
  check(
    "keyboardMenuRestoresDefault",
    !(await readConfig()).desktop?.["keyboard-shortcuts"]?.searchSettings,
  );
  await (await edit(page)).press(custom);
  await row(page).locator("input").waitFor({ state: "detached" });
  await page
    .getByRole("button", { name: "全部重置为默认值", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  check(
    "resetRequiresConfirmation",
    Boolean((await readConfig()).desktop["keyboard-shortcuts"].searchSettings),
  );
  await page.getByRole("button", { name: "全部重置", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  check(
    "resetUsesCanonicalConfig",
    !Object.keys((await readConfig()).desktop?.["keyboard-shortcuts"] ?? {})
      .length,
  );
  await close();
  page = await launch();
  await open(page);
  check(
    "coldRestartKeepsReset",
    !Object.keys((await readConfig()).desktop?.["keyboard-shortcuts"] ?? {})
      .length,
  );
  await page.locator('[data-testid="settings-content"] h1').click();
  await page.keyboard.press(`${primary}+f`);
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("data-testid") ===
      "settings-sidebar-search",
  );
  check("defaultKeyWorksAfterColdReset", true);
  await close();
  summary.trace = summarizeSettingsAppearanceTrace(traces);
  check(
    "realConfigReadAndWrite",
    summary.trace.methods.includes("config/read") &&
      summary.trace.methods.includes("config/batchWrite"),
  );
  check("noProductionMockFallback", summary.trace.mockFallbackHitCount === 0);
  check("noLegacyCommands", summary.trace.legacyCommands.length === 0);
  check("noInvokeErrors", errors.flatMap(parseInvokeTraceRaw).length === 0);
  check("noConsoleErrors", consoleErrors.length === 0);
  check("noPageErrors", pageErrors.length === 0);
  check(
    "typographyAndGeometry",
    Object.values(summary.measurements).every(
      (value) =>
        value.label === "13px" &&
        value.description === "12px" &&
        value.radius === "16px" &&
        !value.horizontalOverflow,
    ),
  );
  summary.freshness = inspectElectronFixtureBuildFreshness({
    rootDir: process.cwd(),
  });
  check("finalFreshness", summary.freshness.ready);
  summary.result = "pass";
} catch (error) {
  summary.failure = String(error.stack || error);
  process.exitCode = 1;
  if (handle)
    await handle.page
      .screenshot({ path: path.join(options.evidenceDir, "failure.png") })
      .catch(() => undefined);
} finally {
  if (handle) await closeElectronFixture(handle);
  summary.consoleErrors = consoleErrors;
  summary.pageErrors = pageErrors;
  summary.completedAt = new Date().toISOString();
  summary.assertionCounts = {
    total: Object.keys(summary.assertions).length,
    passed: Object.values(summary.assertions).filter(Boolean).length,
  };
  fs.writeFileSync(
    path.join(options.evidenceDir, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        result: summary.result,
        assertions: summary.assertionCounts,
        failure: summary.failure,
        evidence: options.evidenceDir,
      },
      null,
      2,
    ),
  );
}
