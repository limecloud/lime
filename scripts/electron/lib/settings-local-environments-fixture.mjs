import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
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
  createTempRuntimeEnv,
  appServerCallFromPage,
} from "../mcp-config-fixture-smoke.mjs";
import { captureMainProcessExit } from "./persisted-atom-fixture-driver.mjs";
import { settleFixtureResources } from "../../agent-runtime/claw-chat-current-fixture-teardown.mjs";
import {
  parseSettingsAppearanceFixtureArgs,
  summarizeSettingsAppearanceTrace,
} from "./settings-appearance-fixture-evidence.mjs";
import {
  openLocalEnvironmentEditor,
  runSettingsLocalEnvironmentsNavigationScenario,
} from "./settings-local-environments-navigation-scenario.mjs";
import { artifactFingerprints } from "./settings-navigation-fixture-identity.mjs";

const sources = [
  "scripts/electron/lib/settings-local-environments-fixture.mjs",
  "scripts/electron/lib/settings-local-environments-navigation-scenario.mjs",
  "scripts/lib/electron-fixture-build.mjs",
  "src/components/settings-v2/sections.tsx",
  "src/components/settings-v2/SettingsPrimitives.tsx",
  "src/components/settings-v2/_layout/SettingsSidebar.tsx",
  "src/components/settings-v2/hooks/useSettingsCategory.ts",
  "src/lib/api/localEnvironments.ts",
  "src/lib/localEnvironments.ts",
  "src/lib/localEnvironmentSelection.ts",
  "src/lib/api/localEnvironmentSelection.ts",
  "src/lib/api/localEnvironmentSelectionProtocol.ts",
  "src/lib/api/persistedAtoms.ts",
  "src/lib/api/persistedAtomTypes.ts",
  "src/lib/api/persistedAtomProtocol.ts",
  "src/types/page.ts",
  "src/components/settings-v2/_layout/index.tsx",
  "electron/persistedAtomHost.ts",
  "electron/persistedAtomStore.ts",
  "electron/persistedAtomRecords.ts",
  "electron/persistedAtomFile.ts",
  "electron/hostCommands.ts",
  "electron/ipcChannels.ts",
  "electron/systemUtilityHost.ts",
  "packages/app-server-client/src/generated/protocol-types.ts",
  "lime-rs/crates/app-server-protocol/src/protocol/v2/local_environments.rs",
  "lime-rs/crates/app-server/src/processor/local_environments.rs",
  "lime-rs/crates/app-server/src/runtime/local_environments.rs",
  "lime-rs/crates/app-server/src/runtime/local_environments/paths.rs",
  ...[
    "LocalEnvironmentsSettings.tsx",
    "LocalEnvironmentDetails.tsx",
    "LocalEnvironmentEditor.tsx",
    "LifecycleEditor.tsx",
    "ActionsEditor.tsx",
  ].map(
    (file) => `src/components/settings-v2/coding/local-environments/${file}`,
  ),
  ...["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"].map(
    (locale) => `src/i18n/resources/${locale}/settings.json`,
  ),
];
const sourceFingerprints = () =>
  Object.fromEntries(
    sources.map((file) => [
      file,
      createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
    ]),
  );
const drift = (before, after) =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (file) => before[file] !== after[file],
  );

const options = parseSettingsAppearanceFixtureArgs(process.argv.slice(2), {
  defaults: {
    runId: null,
    evidenceDir: null,
    prefix: "settings-local-environments",
    timeoutMs: 120000,
    intervalMs: 250,
    keepTemp: false,
  },
});
if (options.help) {
  console.log(
    "node scripts/electron/lib/settings-local-environments-fixture.mjs --run-id <id> --evidence-dir <path>",
  );
  process.exit(0);
}
fs.mkdirSync(options.evidenceDir, { recursive: true });
const summary = {
  schemaVersion: 1,
  scenario: "settings-local-environments",
  proofLevel: "Desktop Gate B controlled fixture",
  claimBoundary:
    "Real Electron/preload/IPC/App Server local configuration discovery, draft protection, file persistence, revision conflicts and GUI-triggered new-environment selection in the existing Host atom, including cold restart. No picker or worktree creation, scripts/actions, remote host, live provider, Windows or full-settings claim.",
  startedAt: new Date().toISOString(),
  result: "fail",
  assertions: {},
  launches: [],
  teardowns: [],
  measurements: [],
};
const errors = [],
  pageErrors = [],
  traces = [];
let runtime, handle, mainExit;
const identity = { sourceBeforeBuild: sourceFingerprints() };
function check(name, value) {
  summary.assertions[name] = Boolean(value);
  if (!value) throw Error(name);
}
async function launch() {
  handle = await launchElectronFixture({
    options,
    runtimeEnv: runtime,
    appServerEnv: runtime.appServerEnv,
    consoleErrors: errors,
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
  const teardown = await settleFixtureResources({ app: handle.app, mainExit });
  summary.teardowns.push(teardown);
  handle = null;
  check(
    "normalMainExit",
    teardown.ok &&
      teardown.forcedCleanup === null &&
      teardown.normalMainExit?.exitCode === 0 &&
      teardown.normalMainExit?.signal === null,
  );
}
async function screenshot(name) {
  const page = handle.page;
  const measurement = await page
    .getByTestId("local-environment-editor")
    .evaluate((editor) => {
      const content = editor.closest("main");
      return {
        title: getComputedStyle(editor.querySelector("h1")).fontSize,
        body: getComputedStyle(editor).fontSize,
        documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        contentOverflow: content.scrollWidth > content.clientWidth + 1,
      };
    });
  summary.measurements.push({ name, ...measurement });
  check(
    `typography-${name}`,
    measurement.title === "28px" && measurement.body === "13px",
  );
  check(
    `no-overflow-${name}`,
    !measurement.documentOverflow && !measurement.contentOverflow,
  );
  await page.screenshot({
    path: path.join(options.evidenceDir, `${name}.png`),
    animations: "disabled",
  });
}
async function checkSavedSelection(name) {
  const expected = {
    workspaceKey: `local:${summary.configuration.workspaceRoot}`,
    configPath: summary.configuration.configPath,
  };
  await handle.page.waitForFunction(async ({ workspaceKey, configPath }) => {
    const state = await window.electronAPI.invoke("persisted_atom_read", {
      key: "local-env-selections-by-workspace",
      query: { kind: "selections" },
    });
    return (
      state.outcome === "ready" &&
      state.data.queryKind === "selections" &&
      state.data.selections[workspaceKey] === configPath &&
      state.persistence.state === "saved"
    );
  }, expected);
  check(name, true);
}
try {
  await ensureElectronFixtureBuild({
    rootDir: process.cwd(),
    logPrefix: "settings-local-environments",
  });
  identity.sourceBefore = sourceFingerprints();
  check(
    "stableBuildSources",
    drift(identity.sourceBeforeBuild, identity.sourceBefore).length === 0,
  );
  identity.artifactsBefore = artifactFingerprints();
  summary.freshnessBefore = inspectElectronFixtureBuildFreshness({
    rootDir: process.cwd(),
  });
  check("freshBuildBefore", summary.freshnessBefore.ready);
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
  await launch();
  check(
    "realElectronAndPreload",
    handle.rendererSnapshot.electron && handle.rendererSnapshot.hasInvokeBridge,
  );
  summary.configuration = await runSettingsLocalEnvironmentsNavigationScenario({
    page: handle.page,
    options,
    evidenceDir: options.evidenceDir,
    stage: (stage) => console.log(`[local-environments] ${stage}`),
    waitForSession: () =>
      handle.page
        .getByTestId("settings-navigation")
        .waitFor({ state: "detached" }),
    workspaceRoot: path.join(runtime.tempRoot, "local-environment-project"),
  });
  check(
    "configurationFlow",
    summary.configuration.saveAndReopen &&
      summary.configuration.conflictKeepsDraft &&
      summary.configuration.externalBytesPreserved,
  );
  await checkSavedSelection("newEnvironmentSelectedAndSaved");
  await close();
  await launch();
  await checkSavedSelection("coldSelectionRestored");
  await openLocalEnvironmentEditor(
    handle.page,
    options,
    summary.configuration.projectName,
  );
  summary.sidebarOrder = await handle.page
    .locator('[data-testid^="settings-sidebar-tab-"]')
    .evaluateAll((buttons) => buttons.map((button) => button.dataset.testid));
  check(
    "aboutIsLast",
    summary.sidebarOrder.at(-1) === "settings-sidebar-tab-about" &&
      summary.sidebarOrder.at(-2) === "settings-sidebar-tab-worktrees",
  );
  check(
    "coldUiRestore",
    (await handle.page
      .getByRole("textbox", { name: "设置脚本 · 默认", exact: true })
      .inputValue()) === "printf 'setup fixture'",
  );
  const read = await appServerCallFromPage(
    handle.page,
    "localEnvironments/readConfig",
    { configPath: summary.configuration.configPath },
  );
  check(
    "coldCanonicalRestore",
    read.result.environment.type === "success" &&
      read.result.environment.environment.actions[0].name === "Test fixture",
  );
  check(
    "directPublicIpc",
    read.ipcObservation.transport === "electron-ipc" &&
      read.ipcObservation.requestId === read.ipcObservation.responseId &&
      !read.ipcObservation.fallback,
  );
  await screenshot("local-environments-desktop");
  await handle.page.setViewportSize({ width: 900, height: 760 });
  await screenshot("local-environments-narrow");
  await close();
  identity.sourceAfter = sourceFingerprints();
  identity.artifactsAfter = artifactFingerprints();
  summary.identity = {
    sourceDrift: drift(identity.sourceBefore, identity.sourceAfter),
    artifactDrift: drift(identity.artifactsBefore, identity.artifactsAfter),
    receipt: "identity.json",
  };
  check("stableProductSources", summary.identity.sourceDrift.length === 0);
  check("stableBuiltArtifacts", summary.identity.artifactDrift.length === 0);
  summary.trace = summarizeSettingsAppearanceTrace(traces);
  check(
    "currentMethods",
    [
      "localEnvironments/list",
      "localEnvironments/readConfig",
      "localEnvironments/saveConfig",
    ].every((method) => summary.trace.methods.includes(method)),
  );
  check(
    "noLegacyOrMock",
    summary.trace.mockFallbackHitCount === 0 &&
      summary.trace.legacyCommands.length === 0,
  );
  check(
    "noConsoleOrPageErrors",
    errors.length === 0 && pageErrors.length === 0,
  );
  summary.freshnessAfter = inspectElectronFixtureBuildFreshness({
    rootDir: process.cwd(),
  });
  check("freshBuildAfter", summary.freshnessAfter.ready);
  summary.result = "pass";
} catch (error) {
  summary.failure = String(error.stack || error);
  if (handle) {
    try {
      const filename = "failure.png";
      await handle.page.screenshot({
        path: path.join(options.evidenceDir, filename),
        animations: "disabled",
      });
      summary.failureScreenshot = filename;
    } catch (screenshotError) {
      summary.failureScreenshotError = String(screenshotError);
    }
  }
  process.exitCode = 1;
} finally {
  if (handle)
    try {
      await close();
    } catch (error) {
      summary.teardownFailure = String(error);
      summary.result = "fail";
      process.exitCode = 1;
    }
  summary.consoleErrors = errors;
  summary.pageErrors = pageErrors;
  summary.completedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(options.evidenceDir, "identity.json"),
    `${JSON.stringify(identity, null, 2)}\n`,
  );
  if (runtime && !options.keepTemp)
    fs.rmSync(runtime.tempRoot, { recursive: true, force: true });
  fs.writeFileSync(
    path.join(options.evidenceDir, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
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
