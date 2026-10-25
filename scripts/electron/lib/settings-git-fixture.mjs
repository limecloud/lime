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
    prefix: "settings-git",
    timeoutMs: 120000,
    intervalMs: 250,
    keepTemp: false,
  },
});
fs.mkdirSync(options.evidenceDir, { recursive: true });
const summary = {
  schemaVersion: 1,
  scenario: "git-preferences-persistence",
  proofLevel: "Gate B",
  claimBoundary:
    "Real Electron/preload/IPC/App Server config and GUI persistence. No native Git push/PR execution or live provider claim.",
  result: "fail",
  startedAt: new Date().toISOString(),
  assertions: {},
  launches: [],
  measurements: {},
  calls: [],
};
const consoleErrors = [],
  pageErrors = [],
  traces = [],
  errors = [];
let handle, runtime;
const primary = process.platform === "darwin" ? "Meta" : "Control";
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
  const buffers = await handle.page.evaluate(() => ({
    trace: localStorage.getItem("lime_invoke_trace_buffer_v1"),
    errors: localStorage.getItem("lime_invoke_error_buffer_v1"),
  }));
  traces.push(buffers.trace);
  errors.push(buffers.errors);
  await closeElectronFixture(handle);
  handle = null;
}
async function open(page) {
  await openSettings(page, options);
  await page.getByTestId("settings-sidebar-tab-git").click();
  await page.locator("#git-branch-prefix-input").waitFor();
}
async function read() {
  const response = await appServerCallFromPage(handle.page, "config/read", {
    includeLayers: true,
  });
  summary.calls.push({ method: "config/read", ...response.ipcObservation });
  return response.result.config;
}
async function ready(page) {
  await page.waitForFunction(
    () => !document.querySelector("#git-forcePush button")?.disabled,
  );
}
async function select(page, id, name) {
  await page.locator(`#${id} button`).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
  await page.locator(`#${id} button`).filter({ hasText: name }).waitFor();
  await ready(page);
}
async function screenshot(page, name) {
  summary.measurements[name] = await page.evaluate(() => {
    const row = document.querySelector("#git-forcePush"),
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
    animations: "disabled",
  });
}
try {
  await ensureElectronFixtureBuild({
    rootDir: process.cwd(),
    logPrefix: "settings-git",
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
  const before = await read();
  const prefix = page.locator("#git-branch-prefix-input");
  check("defaultPrefix", (await prefix.inputValue()) === "lime/");
  check(
    "defaultForcePush",
    (await page
      .locator("#git-forcePush button")
      .getAttribute("aria-checked")) === "false",
  );
  check(
    "defaultDraftPr",
    (await page.locator("#git-draftPr button").getAttribute("aria-checked")) ===
      "true",
  );
  check(
    "sevenSearchTargets",
    (await page
      .locator(
        '[data-testid="settings-git-page"] [data-settings-search-target]',
      )
      .count()) === 7,
  );
  await prefix.fill("team/");
  await prefix.press("Tab");
  await ready(page);
  check("prefixBlurPersisted", (await read()).git["branch-prefix"] === "team/");
  await prefix.fill("");
  await prefix.press(`${primary}+s`);
  await ready(page);
  check("explicitEmptyPrefix", (await read()).git["branch-prefix"] === "");
  await prefix.fill("team/");
  await prefix.press(`${primary}+s`);
  await ready(page);
  await page.locator("#git-forcePush button").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("#git-forcePush button")
        ?.getAttribute("aria-checked") === "true",
  );
  await page.locator("#git-draftPr button").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("#git-draftPr button")
        ?.getAttribute("aria-checked") === "false",
  );
  await select(page, "git-merge-method", "压缩合并");
  await select(page, "git-review-delivery", "独立聊天");
  await page
    .locator("#git-commit-instructions-input")
    .fill("Electron commit guidance");
  await page
    .locator("#git-commit-instructions")
    .getByRole("status")
    .filter({ hasText: "已保存" })
    .waitFor();
  check(
    "instructionDebounceSaved",
    (await read()).git["commit-instructions"] === "Electron commit guidance",
  );
  await page.locator("#git-pr-instructions-input").fill("Electron PR guidance");
  await page.locator("#git-pr-instructions-input").press(`${primary}+s`);
  await page
    .locator("#git-pr-instructions")
    .getByRole("status")
    .filter({ hasText: "已保存" })
    .waitFor();
  const config = await read();
  check(
    "allSevenPreferencesPersisted",
    Object.entries({
      "branch-prefix": "team/",
      "always-force-push": true,
      "create-draft-pull-requests": false,
      "pull-request-merge-method": "squash",
      "review-delivery": "detached",
      "commit-instructions": "Electron commit guidance",
      "pull-request-instructions": "Electron PR guidance",
    }).every(([key, value]) => config.git[key] === value),
  );
  check("otherConfigurationPreserved", config.language === before.language);
  for (const [mode, name] of [
    ["浅色", "git-light"],
    ["深色", "git-dark"],
  ]) {
    await page.getByTestId("settings-sidebar-tab-appearance").click();
    await page.getByRole("radio", { name: mode, exact: true }).click();
    await page.getByTestId("settings-sidebar-tab-git").click();
    await prefix.waitFor();
    await page.waitForFunction(
      (dark) => document.documentElement.classList.contains("dark") === dark,
      mode === "深色",
    );
    await screenshot(page, name);
  }
  await page.locator("#git-pr-instructions-input").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(options.evidenceDir, "git-instructions.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 900, height: 760 });
  await prefix.scrollIntoViewIfNeeded();
  await screenshot(page, "git-narrow");
  await page
    .locator("#git-commit-instructions-input")
    .fill("Flush on navigation");
  await page.getByTestId("settings-sidebar-tab-appearance").click();
  await page.getByTestId("settings-sidebar-tab-git").click();
  await prefix.waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector("#git-commit-instructions-input")?.value ===
      "Flush on navigation",
  );
  check(
    "navigationFlushPersisted",
    (await read()).git["commit-instructions"] === "Flush on navigation",
  );
  await close();
  page = await launch();
  await open(page);
  const cold = await read();
  check(
    "coldConfigurationRestore",
    cold.git["branch-prefix"] === "team/" &&
      cold.git["always-force-push"] === true &&
      cold.git["create-draft-pull-requests"] === false &&
      cold.git["pull-request-merge-method"] === "squash" &&
      cold.git["review-delivery"] === "detached" &&
      cold.git["commit-instructions"] === "Flush on navigation" &&
      cold.git["pull-request-instructions"] === "Electron PR guidance",
  );
  check(
    "coldUiRestore",
    (await page.locator("#git-commit-instructions-input").inputValue()) ===
      "Flush on navigation" &&
      (await page.locator("#git-review-delivery button").innerText()).includes(
        "独立聊天",
      ),
  );
  await close();
  summary.trace = summarizeSettingsAppearanceTrace(traces);
  check(
    "canonicalConfigMethods",
    ["config/read", "config/batchWrite"].every((method) =>
      summary.trace.methods.includes(method),
    ),
  );
  check(
    "noMocksOrLegacy",
    summary.trace.mockFallbackHitCount === 0 &&
      summary.trace.legacyCommands.length === 0,
  );
  check("noInvokeErrors", errors.flatMap(parseInvokeTraceRaw).length === 0);
  check(
    "noConsoleOrPageErrors",
    consoleErrors.length === 0 && pageErrors.length === 0,
  );
  check(
    "referenceTypographyAndGeometry",
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
      .catch(() => {});
} finally {
  if (handle) await closeElectronFixture(handle);
  summary.completedAt = new Date().toISOString();
  summary.consoleErrors = consoleErrors;
  summary.pageErrors = pageErrors;
  const details = summary.assertions;
  summary.assertions = {
    total: Object.keys(details).length,
    passed: Object.values(details).filter(Boolean).length,
    failed: Object.entries(details)
      .filter(([, value]) => !value)
      .map(([name]) => name),
    details,
  };
  fs.writeFileSync(
    path.join(options.evidenceDir, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        result: summary.result,
        assertions: summary.assertions,
        failure: summary.failure,
        evidence: options.evidenceDir,
      },
      null,
      2,
    ),
  );
  if (runtime && !options.keepTemp)
    fs.rmSync(runtime.tempRoot, { recursive: true, force: true });
}
