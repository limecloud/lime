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
    prefix: "settings-personalization",
    timeoutMs: 120000,
    intervalMs: 250,
    keepTemp: false,
  },
});
if (options.help) {
  console.log(
    "node scripts/electron/lib/settings-personalization-fixture.mjs --run-id <id> [--evidence-dir <path>]",
  );
  process.exit(0);
}
if (!process.argv.includes("--evidence-dir")) {
  options.evidenceDir = path.resolve(
    ".lime/qc/project-gates",
    options.runId,
    "settings-personalization-persistence",
  );
}
fs.mkdirSync(options.evidenceDir, { recursive: true });
const summary = {
  schemaVersion: 1,
  candidateRunId: options.runId,
  proofLevel: "Gate B-F",
  claimBoundary:
    "Isolated real Electron settings/config/instructions/memory store persistence. No Agent/provider turn, reference runtime, physical input or Windows packaged claim.",
  settingsScenarioProof: {
    scenarioId: "memory-personalization-persistence",
    complete: false,
  },
  scenario: "personalization-config-instructions-reset-cold-restore",
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
  await page.getByTestId("settings-sidebar-tab-memory").click();
  await page.waitForFunction(
    () =>
      !document.querySelector('[data-testid="settings-memory-toggle"]')
        ?.disabled,
  );
}
async function rpc(method, params = {}) {
  const response = await appServerCallFromPage(handle.page, method, params);
  summary.calls.push({ method, ...response.ipcObservation });
  return response.result;
}
async function read() {
  return (await rpc("config/read", { includeLayers: true })).config;
}
async function editor(page) {
  await page.getByTestId("settings-instructions-open").click();
  const input = page.locator(
    '[data-testid="settings-instructions-editor"] textarea',
  );
  await input.waitFor();
  return input;
}
async function screenshot(page, name) {
  summary.measurements[name] = await page.evaluate(() => {
    const row = document.querySelector("#memory-enabled");
    const content = document.querySelector('[data-testid="settings-content"]');
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
async function waitSaved(page) {
  await page.getByRole("status").filter({ hasText: "已保存" }).waitFor();
}
try {
  ensureElectronFixtureBuild({
    rootDir: process.cwd(),
    logPrefix: "settings-personalization-fixture",
  });
  runtime = createTempRuntimeEnv();
  runtime.env.CODEX_HOME = path.join(runtime.tempRoot, "codex");
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
  const enabled = page.getByTestId("settings-memory-toggle");
  if ((await enabled.getAttribute("aria-checked")) !== "true") {
    await enabled.click();
    await page.waitForFunction(
      () =>
        !document.querySelector('[data-testid="settings-memory-toggle"]')
          .disabled,
    );
  }
  let config = await read();
  check(
    "featureAndGenerationPersist",
    config.memory.enabled && config.memory.auto.enabled,
  );
  check("otherPreferencesPreserved", config.language === before.language);
  await enabled.click();
  await page.waitForFunction(
    () =>
      !document.querySelector('[data-testid="settings-memory-toggle"]')
        ?.disabled,
  );
  const tools = page.locator("#memory-tools button");
  check(
    "sourcePreferenceRemainsEditableWhenMemoryIsOff",
    await tools.isEnabled(),
  );
  if ((await tools.getAttribute("aria-checked")) === "true") {
    await tools.click();
    await page.waitForFunction(
      () =>
        !document.querySelector('[data-testid="settings-memory-toggle"]')
          .disabled,
    );
  }
  check(
    "externalContextPreferencePersisted",
    (await read()).memory.disable_on_external_context === true,
  );
  config = await read();
  check(
    "editingSourcePreferenceDoesNotEnableMemory",
    !config.memory.enabled && !config.memory.auto.enabled,
  );
  await enabled.click();
  await page.waitForFunction(
    () =>
      !document.querySelector('[data-testid="settings-memory-toggle"]')
        ?.disabled,
  );
  check(
    "documentationAndRowHitArea",
    await page.locator("#memory-instructions").evaluate((row) => {
      const button = row.querySelector("button");
      const link = row.querySelector("a");
      const r = link.getBoundingClientRect();
      return (
        button.getBoundingClientRect().width >=
          row.getBoundingClientRect().width - 2 &&
        document
          .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
          ?.closest("a") === link
      );
    }),
  );
  let input = await editor(page);
  let initial = await rpc("instructions/read");
  check(
    "serverResolvesIsolatedPath",
    path
      .resolve(initial.path)
      .startsWith(path.resolve(runtime.tempRoot) + path.sep),
  );
  const marker = "# Personal instructions\n\n请简明回答。";
  await input.fill(marker);
  await page.getByTestId("settings-instructions-back").click();
  let dialog = page.getByRole("alertdialog");
  await dialog.waitFor();
  check(
    "dirtyBackDoesNotWrite",
    (await rpc("instructions/read")).contents === initial.contents,
  );
  await dialog.getByRole("button", { name: "继续编辑", exact: true }).click();
  check("keepEditingRetainsInput", (await input.inputValue()) === marker);
  await input.press(`${primary}+s`);
  await waitSaved(page);
  let saved = await rpc("instructions/read");
  check(
    "primarySaveWritesSameFile",
    saved.contents === marker && fs.readFileSync(saved.path, "utf8") === marker,
  );
  await page.screenshot({
    path: path.join(options.evidenceDir, "instructions-editor.png"),
  });
  await page.getByTestId("settings-instructions-back").click();
  check(
    "returnFocusRestored",
    await page
      .getByTestId("settings-instructions-open")
      .evaluate((node) => document.activeElement === node),
  );
  input = await editor(page);
  await input.fill("stale draft");
  fs.writeFileSync(saved.path, "external editor");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page
    .locator('[data-testid="settings-instructions-editor"] [role="alert"]')
    .waitFor();
  check(
    "conflictPreservesBothEdits",
    (await input.inputValue()) === "stale draft" &&
      fs.readFileSync(saved.path, "utf8") === "external editor",
  );
  await page.screenshot({
    path: path.join(options.evidenceDir, "instructions-conflict.png"),
  });
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  dialog = page.getByRole("alertdialog");
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "放弃更改", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("textarea")?.value === "external editor",
  );
  check(
    "confirmedReloadUsesExternalFile",
    (await input.inputValue()) === "external editor",
  );
  await input.fill(marker);
  await input.press(`${primary}+s`);
  await waitSaved(page);
  const override = path.join(path.dirname(saved.path), "AGENTS.override.md");
  fs.writeFileSync(override, "override instruction");
  await page.getByTestId("settings-instructions-back").click();
  await editor(page);
  check(
    "overrideWarningVisible",
    await page
      .getByRole("status")
      .filter({ hasText: "AGENTS.override.md" })
      .isVisible(),
  );
  fs.writeFileSync(override, "");
  await page.getByTestId("settings-instructions-back").click();
  await rpc("memoryStore/addNote", {
    scope: "global",
    title: "Fixture note",
    content: "Remember a fixture preference.",
  });
  const notes = async () =>
    (
      await rpc("memoryStore/list", {
        scope: "global",
        path: "extensions/ad_hoc/notes",
        maxResults: 200,
      })
    ).entries;
  check("seededRealMemoryStore", (await notes()).length > 0);
  await page.locator("#memory-delete button").click();
  dialog = page.getByRole("alertdialog");
  await dialog.waitFor();
  await page.screenshot({
    path: path.join(options.evidenceDir, "delete-confirmation.png"),
  });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  check("cancelDeletePreservesStore", (await notes()).length > 0);
  await page.locator("#memory-delete button").click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "删除所有记忆", exact: true })
    .click();
  await page.getByRole("alertdialog").waitFor({ state: "detached" });
  check("confirmedDeleteClearsStore", (await notes()).length === 0);
  check(
    "deletePreservesInstructions",
    (await rpc("instructions/read")).contents === marker,
  );
  for (const [mode, name] of [
    ["浅色", "personalization-light"],
    ["深色", "personalization-dark"],
  ]) {
    await page.getByTestId("settings-sidebar-tab-appearance").click();
    await page.getByRole("radio", { name: mode, exact: true }).click();
    await page.getByTestId("settings-sidebar-tab-memory").click();
    await enabled.waitFor();
    await page.waitForFunction(
      () =>
        !document.querySelector('[data-testid="settings-memory-toggle"]')
          ?.disabled,
    );
    await page.waitForFunction(
      (dark) => document.documentElement.classList.contains("dark") === dark,
      mode === "深色",
    );
    await screenshot(page, name);
  }
  await page.setViewportSize({ width: 900, height: 760 });
  await screenshot(page, "personalization-narrow");
  await close();
  page = await launch();
  await open(page);
  config = await read();
  check(
    "coldMemorySettingsRestore",
    config.memory.enabled &&
      config.memory.auto.enabled &&
      config.memory.disable_on_external_context,
  );
  input = await editor(page);
  check("coldInstructionsRestore", (await input.inputValue()) === marker);
  check("coldDeleteDoesNotResurrectNotes", (await notes()).length === 0);
  await close();
  summary.trace = summarizeSettingsAppearanceTrace(traces);
  check(
    "currentMethodsObserved",
    [
      "config/read",
      "config/batchWrite",
      "instructions/read",
      "instructions/write",
      "memory/reset",
    ].every((method) => summary.trace.methods.includes(method)),
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
  summary.assertionDetails = summary.assertions;
  summary.assertions = {
    total: Object.keys(summary.assertions).length,
    passed: Object.values(summary.assertions).filter(Boolean).length,
    failed: Object.entries(summary.assertions)
      .filter(([, value]) => !value)
      .map(([name]) => name),
  };
  summary.trace = summarizeSettingsAppearanceTrace(traces);
  summary.bridge = {
    electron:
      summary.launches.length === 2 &&
      summary.launches.every((value) => value.electron),
    preloadInvoke:
      summary.launches.length === 2 &&
      summary.launches.every((value) => value.hasInvokeBridge),
    transport: "electron-ipc",
    command: "app_server_handle_json_lines",
    appServerIpcHitCount: summary.trace.appServerIpcHitCount,
    methods: summary.trace.methods,
  };
  summary.errors = {
    consoleErrorCount: consoleErrors.length,
    pageErrorCount: pageErrors.length,
    invokeErrorCount: errors.flatMap(parseInvokeTraceRaw).length,
    legacyCommandHitCount: summary.trace.legacyCommands.length,
    legacyCommands: summary.trace.legacyCommands,
    mockFallbackHitCount: summary.trace.mockFallbackHitCount,
  };
  summary.artifacts = {
    screenshot: path.join(options.evidenceDir, "personalization-light.png"),
  };
  summary.settingsScenarioProof.complete = summary.result === "pass";
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
  if (runtime && !options.keepTemp) {
    fs.rmSync(runtime.tempRoot, { recursive: true, force: true });
  }
}
