import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  appServerCallFromPage,
  launchElectronFixture,
  openSettings,
  readConfigFromPage,
  waitForPageCondition,
  writeConfigEditsFromPage,
} from "./mcp-config-fixture-smoke.mjs";
import { createTempRuntimeEnv } from "../lib/chat-fixture/backend-file.mjs";
import {
  initializeAppServer,
  reloadRendererDocument,
} from "../lib/chat-fixture/rpc.mjs";
import { settleFixtureResources } from "../lib/chat-fixture/teardown.mjs";
import { captureMainProcessExit } from "./lib/persisted-atom-fixture-driver.mjs";
import { inspectElectronFixtureBuildFreshness } from "../lib/electron-fixture-build.mjs";
import { resolveElectronAppServerRuntimeEnv } from "../lib/electron-app-server-assets.mjs";
import {
  captureInvokeTraceCollector,
  installInvokeTraceCollector,
  stopInvokeTraceCollector,
  validateInvokeTraceCollectorCapture,
} from "../lib/invoke-trace-collector.mjs";
import { parseJsonRpcRequestsFromInvokeTrace } from "./lib/mcp-config-fixture-evidence.mjs";

// Real settings/config transport; no provider turn, desktop input or system consent.
const runId =
  process.argv[2] ?? `computer-use-settings-${Date.now()}-${process.pid}`;
assert.match(runId, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const evidenceDir = path.resolve(".lime/qc/computer-use-settings", runId);
fs.mkdirSync(path.dirname(evidenceDir), { recursive: true });
fs.mkdirSync(evidenceDir);
const runtimeEnv = createTempRuntimeEnv();
runtimeEnv.writeFixtureConfig({ language: "zh-CN" });
const options = { timeoutMs: 120_000, intervalMs: 200 };
const fixtureApp = "org.lime.fixture.Editor";
const summary = {
  runId,
  ok: false,
  proofLevel: "Desktop Gate B: Computer Use settings only",
  backendMode: "runtime",
  startedAt: new Date().toISOString(),
  limitations: [
    "No provider/tool turn, OS permissions, desktop input, Chrome/Office connection, Windows execution or packaged installation is exercised.",
  ],
  consoleErrors: [],
  pageErrors: [],
  segments: [],
  checks: {},
};
let handle;
let mainExit;
let collector;
let failure;
const stage = (name) => {
  summary.stage = name;
  console.log(`[computer-use-settings] ${name}`);
};
const unrelated = (config) =>
  Object.fromEntries(
    Object.entries(config).filter(
      ([key]) => !["features", "computer_use"].includes(key),
    ),
  );

async function captureSegment(name) {
  const captured = await captureInvokeTraceCollector(handle.page, collector);
  const validated = validateInvokeTraceCollectorCapture(captured, collector);
  assert.equal(validated.complete, true, "continuous preload trace provenance");
  const requests = parseJsonRpcRequestsFromInvokeTrace(
    JSON.stringify(validated.ledgerEntries),
  );
  assert(requests.every((entry) => entry.transport === "electron-ipc"));
  summary.segments.push({
    name,
    provenance: validated.provenance,
    requests: requests.map(({ method, transport, status, id }) => ({
      method,
      transport,
      status,
      id,
    })),
  });
  const stopped = await stopInvokeTraceCollector(handle.page, collector);
  assert.equal(stopped.nativeRestored, true);
  collector = null;
}

try {
  stage("verify-current-build");
  const before = inspectElectronFixtureBuildFreshness({
    rootDir: process.cwd(),
  });
  assert.equal(
    before.ready,
    true,
    "build current renderer/host/App Server before fixture",
  );
  summary.sourceSha256 = Object.fromEntries(
    [
      "src/components/settings-v2/integrations/computer-use/ComputerUseSettings.tsx",
      "src/components/settings-v2/integrations/computer-use/ComputerUseDialogs.tsx",
      "src/components/settings-v2/integrations/computer-use/useComputerUseSettings.ts",
      "src/lib/api/computerUseSettings.ts",
      "src/components/settings-v2/sections.tsx",
      "src/components/settings-v2/settingsSearchDocuments.ts",
    ].map((file) => [
      file,
      createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
    ]),
  );
  stage("launch-isolated-electron");
  handle = await launchElectronFixture({
    options,
    runtimeEnv,
    backendMode: "runtime",
    consoleErrors: summary.consoleErrors,
    pageErrors: summary.pageErrors,
    appServerEnv: resolveElectronAppServerRuntimeEnv(),
  });
  mainExit = captureMainProcessExit(handle.app.process());
  const { page } = handle;
  summary.identity = handle.rendererSnapshot;
  assert.equal(
    await page.evaluate(
      () =>
        window.__LIME_ELECTRON__ === true &&
        typeof window.electronAPI?.invoke === "function" &&
        window.electronAPI?.devBridgeFallback !== true,
    ),
    true,
  );
  await initializeAppServer(page);
  const initial = await readConfigFromPage(page);
  assert(
    initial.filePath &&
      path.resolve(initial.filePath).startsWith(runtimeEnv.tempRoot + path.sep),
    "fixture writes an isolated user config",
  );
  await writeConfigEditsFromPage(page, {
    expectedVersion: initial.version,
    edits: [
      {
        keyPath: "features",
        value: { ...initial.config.features, computer_use: false },
        mergeStrategy: "replace",
      },
      {
        keyPath: "computer_use",
        value: { macos: { bundle_ids: { [fixtureApp]: "allow" } } },
        mergeStrategy: "replace",
      },
    ],
  });
  await reloadRendererDocument(page, options);
  const navigate = async () => {
    await openSettings(page, options);
    await page.getByTestId("settings-sidebar-tab-computer-use").click();
    await waitForPageCondition(
      page,
      options,
      () => {
        const root = document.querySelector(
          '[data-testid="computer-use-settings"]',
        );
        return (
          root &&
          root.querySelectorAll('[role="switch"]').length === 3 &&
          !root.querySelector('[role="alert"]') &&
          !root.querySelector('#computer-use-native [role="switch"]').disabled
        );
      },
      "Computer Use settings loaded through current App Server",
    );
  };
  collector = await installInvokeTraceCollector(page);
  stage("open-settings-and-enable");
  await navigate();
  const controls = page
    .getByTestId("computer-use-settings")
    .getByRole("switch");
  assert.equal(await controls.nth(0).getAttribute("aria-checked"), "false");
  assert.equal(await controls.nth(1).isDisabled(), false);
  assert.equal(await controls.nth(2).isDisabled(), false);
  assert.match(
    await page.locator("#computer-use-office").textContent(),
    /WPS Office/,
  );
  await controls.nth(0).click();
  await waitForPageCondition(
    page,
    options,
    () => {
      const control = document.querySelector(
        '#computer-use-native [role="switch"]',
      );
      return (
        control?.getAttribute("aria-checked") === "true" && !control.disabled
      );
    },
    "native feature save confirmed by reload",
  );
  const enabled = await readConfigFromPage(page);
  assert.equal(enabled.config.features.computer_use, true);
  for (const [adapter, feature] of [
    ["chrome", "chrome_use"],
    ["office", "office_use"],
  ]) {
    const control = page.locator(`#computer-use-${adapter} [role="switch"]`);
    await control.click();
    await waitForPageCondition(
      page,
      options,
      (id) => {
        const element = document.querySelector(
          `#computer-use-${id} [role="switch"]`,
        );
        return (
          element?.getAttribute("aria-checked") === "true" && !element.disabled
        );
      },
      `${adapter} feature persisted`,
      adapter,
    );
    const saved = await readConfigFromPage(page);
    assert.equal(saved.config.features[feature], true);
    assert.equal(saved.config.features.computer_use, true);
  }
  assert.equal(
    isDeepStrictEqual(unrelated(initial.config), unrelated(enabled.config)),
    true,
    "unrelated user configuration preserved",
  );
  assert.equal(
    enabled.config.computer_use.default_app_access ?? null,
    null,
    "feature enable does not grant every app",
  );
  const status = await appServerCallFromPage(page, "computerUse/status", {});
  assert.equal(
    status.result.grants?.length ?? 0,
    0,
    "feature switch creates no control grants",
  );
  summary.adapterReadiness = status.result.adapters.map(
    ({ adapter, readiness }) => ({ adapter, readiness }),
  );
  await page.screenshot({
    path: path.join(evidenceDir, "computer-use-settings.png"),
  });
  await captureSegment("native-enable");
  stage("reload-and-remove-approval");
  await reloadRendererDocument(page, options);
  collector = await installInvokeTraceCollector(page);
  await navigate();
  assert.equal(
    await page
      .locator('#computer-use-native [role="switch"]')
      .getAttribute("aria-checked"),
    "true",
  );
  for (const adapter of ["chrome", "office"]) {
    assert.equal(
      await page
        .locator(`#computer-use-${adapter} [role="switch"]`)
        .getAttribute("aria-checked"),
      "true",
    );
  }
  await page.locator("#computer-use-allowed-apps button").click();
  const dialog = page.getByRole("alertdialog");
  assert.equal((await dialog.textContent()).includes(fixtureApp), true);
  await dialog.getByRole("button").last().click();
  await dialog.waitFor({ state: "detached" });
  await waitForPageCondition(
    page,
    options,
    (app) =>
      !document
        .querySelector("#computer-use-allowed-apps")
        ?.textContent.includes(app),
    "allowed-app removal confirmed",
    fixtureApp,
  );
  const removed = await readConfigFromPage(page);
  assert.equal(
    removed.config.computer_use?.macos?.bundle_ids?.[fixtureApp],
    undefined,
  );
  assert.equal(
    isDeepStrictEqual(unrelated(enabled.config), unrelated(removed.config)),
    true,
  );
  await page.setViewportSize({ width: 1000, height: 760 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "settings fits smaller desktop window",
  );
  await page.screenshot({
    path: path.join(evidenceDir, "computer-use-settings-compact.png"),
  });
  await captureSegment("reload-and-remove");
  const methods = new Set(
    summary.segments.flatMap((segment) =>
      segment.requests.map((entry) => entry.method),
    ),
  );
  for (const method of [
    "config/read",
    "configRequirements/read",
    "config/batchWrite",
    "computerUse/status",
  ])
    assert(methods.has(method), `current renderer IPC includes ${method}`);
  assert.equal(summary.pageErrors.length, 0);
  assert.equal(summary.consoleErrors.length, 0);
  assert.equal(
    inspectElectronFixtureBuildFreshness({ rootDir: process.cwd() }).ready,
    true,
    "source/build freshness remains valid",
  );
  summary.checks = {
    nativeTogglePersisted: true,
    chromeAndWpsTogglesPersisted: true,
    reloadPersisted: true,
    threeControlRows: true,
    noImplicitAppGrant: true,
    isolatedConfig: true,
    approvalRemoved: true,
    unrelatedConfigPreserved: true,
    compactLayout: true,
    preloadAndCurrentRpc: true,
  };
} catch (error) {
  failure = error;
  summary.error = String(error.message);
  await handle?.page
    .screenshot({ path: path.join(evidenceDir, "failure.png") })
    .catch(() => undefined);
} finally {
  stage("settle-owned-resources");
  summary.teardown = await settleFixtureResources({
    app: handle?.app,
    mainExit,
    invokeTraceCollector: collector
      ? {
          stop: async () => {
            const stopped = await stopInvokeTraceCollector(
              handle.page,
              collector,
            );
            assert.equal(stopped.nativeRestored, true);
          },
        }
      : null,
  });
  if (!summary.teardown.ok) failure ??= new Error("fixture teardown failed");
  summary.ok = !failure;
  summary.completedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(evidenceDir, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  if (summary.ok)
    fs.rmSync(runtimeEnv.tempRoot, { recursive: true, force: true });
}
if (failure) {
  console.error(failure);
  process.exitCode = 1;
} else console.log(`[computer-use-settings] pass ${evidenceDir}`);
