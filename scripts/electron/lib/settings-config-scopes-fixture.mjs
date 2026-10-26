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
  appServerCallFromPage,
  createTempRuntimeEnv,
  launchElectronFixture,
  openSettings,
} from "../mcp-config-fixture-smoke.mjs";
import { captureMainProcessExit } from "./persisted-atom-fixture-driver.mjs";
import { settleFixtureResources } from "../../lib/chat-fixture/teardown.mjs";
import {
  parseSettingsAppearanceFixtureArgs,
  summarizeSettingsAppearanceTrace,
} from "./settings-appearance-fixture-evidence.mjs";

const options = parseSettingsAppearanceFixtureArgs(process.argv.slice(2), {
  defaults: {
    runId: null,
    evidenceDir: null,
    prefix: "settings-config-scopes",
    timeoutMs: 120000,
    intervalMs: 250,
    keepTemp: true,
  },
});
fs.mkdirSync(options.evidenceDir, { recursive: true });
const summary = {
  scenario: "project-configuration-scopes",
  result: "fail",
  claimBoundary:
    "Real Electron/preload/IPC, config/read/value/write, trusted project TOML, canonical new/old Thread snapshots and cold restart. Explicit unavailable execution backend; no model turn, reference runtime, managed policy, live provider, Windows or packaged evidence.",
  startedAt: new Date().toISOString(),
  assertions: {},
  calls: [],
  launches: [],
  teardowns: [],
  measurements: {},
};
const consoleErrors = [],
  pageErrors = [],
  traces = [];
let handle, mainExit, runtime, repository;
function check(name, value) {
  summary.assertions[name] = Boolean(value);
  console.log(`[config-scopes] ${name}: ${Boolean(value)}`);
  if (!value) throw Error(name);
}
async function call(method, params = {}) {
  const response = await appServerCallFromPage(handle.page, method, params);
  const observed = response.ipcObservation;
  summary.calls.push({ method, ...observed });
  check(
    "publicIpcIdentity",
    observed.requestId === observed.responseId &&
      observed.electron &&
      observed.transport === "electron-ipc" &&
      !observed.fallback,
  );
  return response.result;
}
async function launch() {
  handle = await launchElectronFixture({
    options,
    runtimeEnv: runtime,
    appServerEnv: runtime.appServerEnv,
    consoleErrors,
    pageErrors,
    backendMode: "unavailable",
  });
  mainExit = captureMainProcessExit(handle.app.process());
  summary.launches.push(handle.rendererSnapshot);
}
async function close() {
  traces.push(
    await handle.page.evaluate(() =>
      localStorage.getItem("lime_invoke_trace_buffer_v1"),
    ),
  );
  const result = await settleFixtureResources({ app: handle.app, mainExit });
  summary.teardowns.push(result);
  handle = null;
  check(
    "normalMainExit",
    result.ok &&
      result.forcedCleanup === null &&
      result.normalMainExit?.exitCode === 0 &&
      result.normalMainExit?.signal === null,
  );
}
const field = (name) =>
  handle.page.locator(`#configuration-${name} button[aria-haspopup]`);
async function openConfiguration() {
  await openSettings(handle.page, options);
  await handle.page.getByTestId("settings-sidebar-tab-configuration").click();
  await field("model_verbosity").waitFor({ state: "visible" });
}
async function menuChoose(trigger, index) {
  await trigger.click();
  const option = handle.page.getByRole("menuitemradio").nth(index);
  const label = await option.locator("span").first().textContent();
  await option.click();
  await handle.page.getByRole("menu").waitFor({ state: "hidden" });
  return label;
}
async function selectScope(index) {
  const trigger = handle.page.locator("button:has(#configuration-scope-value)");
  await menuChoose(trigger, index);
}
async function chooseVerbosity(index) {
  await menuChoose(field("model_verbosity"), index);
  await handle.page.waitForFunction(() => {
    const row = document.getElementById("configuration-model_verbosity");
    return (
      row.getAttribute("aria-busy") !== "true" &&
      !row.querySelector('[role="alert"]')
    );
  });
}
async function visual(name) {
  await handle.page.locator("button:has(#configuration-scope-value)").click();
  const measured = await handle.page.evaluate(() => {
    const root = document.querySelector(
      '[data-testid="configuration-settings"]',
    );
    const row = document.getElementById("configuration-model_verbosity");
    const content = document.querySelector('[data-testid="settings-content"]');
    return {
      title: getComputedStyle(root.querySelector("h1")).fontSize,
      label: getComputedStyle(row.querySelector(".settings-row-label"))
        .fontSize,
      description: getComputedStyle(
        row.querySelector(".settings-row-description"),
      ).fontSize,
      menu: getComputedStyle(document.querySelector('[role="menu"]')).fontSize,
      overflow: content.scrollWidth > content.clientWidth + 1,
      menuLeft: document.querySelector('[role="menu"]').getBoundingClientRect()
        .left,
      triggerLeft: document
        .querySelector("#configuration-scope-value")
        .closest("button")
        .getBoundingClientRect().left,
      grouped: Boolean(
        document.querySelector('[role="menu"] [role="separator"]'),
      ),
      dark: document.documentElement.classList.contains("dark"),
    };
  });
  summary.measurements[name] = measured;
  check(
    `${name}ScopeAnchorAndGroups`,
    Math.abs(measured.menuLeft - measured.triggerLeft) <= 1 && measured.grouped,
  );
  check(
    `${name}TypographyAndOverflow`,
    measured.title === "28px" &&
      measured.label === "13px" &&
      measured.description === "12px" &&
      measured.menu === "13px" &&
      !measured.overflow,
  );
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, `${name}.png`),
    animations: "disabled",
  });
  await handle.page.getByRole("menu").press("Escape");
  await handle.page.getByRole("menu").waitFor({ state: "hidden" });
  await handle.page.waitForFunction(
    () =>
      document.activeElement ===
      document.querySelector("#configuration-scope-value")?.closest("button"),
  );
  check(
    `${name}FocusReturns`,
    await handle.page
      .locator("button:has(#configuration-scope-value)")
      .evaluate((node) => node === document.activeElement),
  );
}
try {
  await ensureElectronFixtureBuild({ rootDir: process.cwd() });
  const binary = electronAppServerBinaryDestination({
    outputRoot: path.join(process.cwd(), "dist-electron"),
    platform: process.platform,
    arch: process.arch,
  });
  runtime = createTempRuntimeEnv();
  runtime.appServerEnv = resolveElectronAppServerRuntimeEnv({
    env: { ...runtime.env, APP_SERVER_BIN: binary },
  });
  await launch();
  check(
    "electronAndPreload",
    summary.launches[0].electron && summary.launches[0].hasInvokeBridge,
  );
  const workspace = (await call("workspace/default/ensure")).workspace;
  repository = fs.realpathSync(workspace.rootPath ?? workspace.root_path);
  check(
    "isolatedWorkspace",
    repository.startsWith(fs.realpathSync(runtime.tempRoot) + path.sep),
  );
  fs.mkdirSync(path.join(repository, ".git"), { recursive: true });
  fs.mkdirSync(path.join(repository, ".lime"), { recursive: true });
  const projectFile = path.join(repository, ".lime", "config.toml");
  fs.writeFileSync(
    projectFile,
    '# keep project heading\nmodel_verbosity = "high" # keep comment\nweb_search = "disabled"\n\n[unrelated]\nmarker = "unchanged"\n',
  );
  await openConfiguration();
  check(
    "untrustedProjectReadonly",
    await field("model_verbosity").isDisabled(),
  );
  const before = await call("config/read", { includeLayers: true });
  const trustKey = `projects.${JSON.stringify(repository)}.trust_level`;
  await call("config/batchWrite", {
    expectedVersion: before.layers[0].version,
    edits: [
      { keyPath: trustKey, value: "trusted", mergeStrategy: "upsert" },
      { keyPath: "model_verbosity", value: "medium", mergeStrategy: "replace" },
    ],
  });
  const userBytes = fs.readFileSync(before.layers[0].name.file);
  await handle.page.getByTestId("settings-sidebar-tab-about").click();
  await openConfiguration();
  await field("model_verbosity").waitFor({ state: "visible" });
  check("trustedProjectEditable", await field("model_verbosity").isEnabled());
  const initial = await call("config/read", {
    cwd: repository,
    includeLayers: true,
  });
  check(
    "realProjectLayerAndOrigin",
    initial.layers.at(-1).name.dotLimeFolder === path.dirname(projectFile) &&
      initial.origins.model_verbosity.name.type === "project" &&
      initial.config.model_verbosity === "high",
  );
  const first = (
    await call("thread/start", {
      cwd: repository,
      model: "fixture-model",
      modelProvider: "fixture-provider",
    })
  ).thread;
  check(
    "projectThreadSnapshot",
    first.extra.modelVerbosity === "high" &&
      first.extra.webSearchMode === "disabled",
  );
  await chooseVerbosity(1);
  const after = await call("config/read", {
    cwd: repository,
    includeLayers: true,
  });
  check("projectImmediateSave", after.config.model_verbosity === "low");
  const source = fs.readFileSync(projectFile, "utf8");
  check(
    "commentsAndUnrelatedPreserved",
    source.startsWith("# keep project heading\n") &&
      source.includes("# keep comment") &&
      source.includes('[unrelated]\nmarker = "unchanged"'),
  );
  check(
    "userFileUnchanged",
    fs.readFileSync(before.layers[0].name.file).equals(userBytes),
  );
  await selectScope(1);
  const userLabel = await field("model_verbosity").textContent();
  await selectScope(0);
  check(
    "scopeValuesSeparated",
    (await field("model_verbosity").textContent()) !== userLabel,
  );
  const next = (
    await call("thread/start", {
      cwd: repository,
      model: "fixture-model",
      modelProvider: "fixture-provider",
    })
  ).thread;
  check("newThreadUsesSavedProject", next.extra.modelVerbosity === "low");
  const old = (
    await call("thread/read", { threadId: first.id, includeTurns: false })
  ).thread;
  check(
    "oldThreadKeepsSnapshot",
    old.extra.modelVerbosity === "high" &&
      old.extra.webSearchMode === "disabled",
  );
  await visual("light-scopes");
  await handle.page.getByTestId("settings-sidebar-tab-appearance").click();
  await handle.page.getByRole("radio", { name: "深色", exact: true }).click();
  await openConfiguration();
  await visual("dark-scopes");
  check("darkThemeApplied", summary.measurements["dark-scopes"].dark);
  await handle.page.setViewportSize({ width: 900, height: 760 });
  await visual("narrow-scopes");
  await close();
  await launch();
  await openConfiguration();
  check(
    "coldProjectValue",
    (await call("config/read", { cwd: repository })).config.model_verbosity ===
      "low",
  );
  const resumed = (await call("thread/resume", { threadId: first.id })).thread;
  check(
    "coldThreadSnapshot",
    resumed.extra.modelVerbosity === "high" &&
      resumed.extra.webSearchMode === "disabled",
  );
  await close();
  summary.trace = summarizeSettingsAppearanceTrace(traces);
  check(
    "noMockOrLegacy",
    summary.trace.mockFallbackHitCount === 0 &&
      summary.trace.legacyCommands.length === 0,
  );
  check(
    "noConsoleOrPageErrors",
    consoleErrors.length === 0 && pageErrors.length === 0,
  );
  check(
    "twoNormalLaunches",
    summary.teardowns.length === 2 && summary.launches.length === 2,
  );
  summary.freshness = inspectElectronFixtureBuildFreshness({
    rootDir: process.cwd(),
  });
  check("freshBuild", summary.freshness.ready);
  summary.result = "pass";
} catch (error) {
  summary.failure = String(error.stack || error);
  process.exitCode = 1;
} finally {
  if (handle) {
    try {
      await close();
    } catch (error) {
      summary.teardownFailure = String(error);
      process.exitCode = 1;
    }
  }
  summary.consoleErrors = consoleErrors;
  summary.pageErrors = pageErrors;
  summary.trace = summarizeSettingsAppearanceTrace(traces);
  summary.completedAt = new Date().toISOString();
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
        evidenceDir: options.evidenceDir,
      },
      null,
      2,
    ),
  );
}
