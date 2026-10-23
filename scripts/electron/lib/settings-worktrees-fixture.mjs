import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
    prefix: "settings-worktrees",
    timeoutMs: 120000,
    intervalMs: 250,
    keepTemp: false,
  },
});
fs.mkdirSync(options.evidenceDir, { recursive: true });
const summary = {
  schemaVersion: 1,
  scenario: "worktree-preferences-persistence",
  proofLevel: "Gate B",
  claimBoundary:
    "Real Electron/preload/IPC/App Server preferences, cold persistence and isolated Git worktree creation. Test repositories and local remote only; no live provider or external network.",
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
  await page.getByTestId("settings-sidebar-tab-worktrees").click();
  await page.locator("#worktrees-root-input").waitFor();
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
    () =>
      !document.querySelector("#worktrees-upstream-refresh button")?.disabled,
  );
}
async function screenshot(page, name) {
  await page.waitForFunction(() => !document.querySelector("[data-sonner-toast]"));
  await page.getByTestId("settings-content").evaluate((content) => {
    content.scrollTop = 0;
  });
  summary.measurements[name] = await page.evaluate(() => {
    const row = document.querySelector("#worktrees-upstream-refresh"),
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
    logPrefix: "settings-worktrees",
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
  const repository = path.join(runtime.tempRoot, "repository");
  const custom = path.join(runtime.tempRoot, "Managed Worktrees");
  const remote = path.join(runtime.tempRoot, "local-remote.git");
  fs.mkdirSync(repository);
  const git = (args) =>
    execFileSync("git", ["-C", repository, ...args], {
      encoding: "utf8",
      stdio: "pipe",
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
      ),
    });
  git(["init", "--template=", "--initial-branch=main"]);
  git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@localhost",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--allow-empty",
    "-m",
    "Fixture",
  ]);
  git(["clone", "--bare", repository, remote]);
  git(["remote", "add", "origin", remote]);
  let page = await launch();
  await open(page);
  const before = await read();
  const rootInput = page.locator("#worktrees-root-input");
  check("defaultRoot", (await rootInput.inputValue()) === "");
  check(
    "defaultUpstream",
    (await page
      .locator("#worktrees-upstream-refresh button")
      .getAttribute("aria-checked")) === "false",
  );
  check(
    "threeFunctionalTargets",
    (await page
      .locator(
        '[data-testid="settings-worktrees-page"] [data-settings-search-target]',
      )
      .count()) === 3,
  );
  await rootInput.fill(`  ${custom}  `);
  await rootInput.press("Tab");
  await page.waitForFunction(
    (expected) =>
      document.querySelector("#worktrees-root-input")?.value === expected &&
      !document.querySelector("#worktrees-root-input")?.disabled,
    custom,
  );
  check("trimmedBlurPersisted", (await read()).worktrees.root === custom);
  check("settingsDoNotCreateDirectories", !fs.existsSync(custom));
  await rootInput.fill("");
  await rootInput.press(`${primary}+s`);
  await ready(page);
  check("emptyRootPersisted", !(await read()).worktrees?.root);
  await rootInput.fill(custom);
  await rootInput.press(`${primary}+s`);
  await ready(page);
  await page.locator("#worktrees-upstream-refresh button").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("#worktrees-upstream-refresh button")
        ?.getAttribute("aria-checked") === "true",
  );
  check(
    "upstreamPersisted",
    (await read()).worktrees["upstream-refresh-mode"] === "best-effort",
  );
  check(
    "switchDoesNotFetch",
    git(["for-each-ref", "refs/remotes/origin"]).trim() === "",
  );
  check("otherSettingsPreserved", (await read()).language === before.language);
  for (const [mode, name] of [
    ["浅色", "worktrees-light"],
    ["深色", "worktrees-dark"],
  ]) {
    await page.getByTestId("settings-sidebar-tab-appearance").click();
    await page.getByRole("radio", { name: mode, exact: true }).click();
    await page.getByTestId("settings-sidebar-tab-worktrees").click();
    await rootInput.waitFor();
    await ready(page);
    await page.waitForFunction(
      (dark) => document.documentElement.classList.contains("dark") === dark,
      mode === "深色",
    );
    await screenshot(page, name);
  }
  await page.setViewportSize({ width: 900, height: 760 });
  await screenshot(page, "worktrees-narrow");
  const created = await appServerCallFromPage(
    page,
    "projectGit/worktree/create",
    {
      rootPath: repository,
      name: "desktop-fixture",
      baseBranch: "main",
    },
  );
  summary.calls.push({
    method: "projectGit/worktree/create",
    ...created.ipcObservation,
  });
  check(
    "configuredRootConsumed",
    path.dirname(created.result.worktreePath) === fs.realpathSync(custom),
  );
  check(
    "createdWorktreeExists",
    fs.existsSync(path.join(created.result.worktreePath, ".git")) &&
      created.result.status.hasGitRepository,
  );
  check(
    "refreshConsumed",
    git(["for-each-ref", "refs/remotes/origin/main"]).includes(
      "refs/remotes/origin/main",
    ),
  );
  check(
    "sourceBranchUnchanged",
    git(["symbolic-ref", "--short", "HEAD"]).trim() === "main",
  );
  await close();
  page = await launch();
  await open(page);
  await ready(page);
  const cold = await read();
  check(
    "coldConfigRestore",
    cold.worktrees.root === custom &&
      cold.worktrees["upstream-refresh-mode"] === "best-effort",
  );
  check(
    "coldUiRestore",
    (await page.locator("#worktrees-root-input").inputValue()) === custom &&
      (await page
        .locator("#worktrees-upstream-refresh button")
        .getAttribute("aria-checked")) === "true",
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
