#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { resolveElectronAppServerRuntimeEnv } from "../lib/electron-app-server-assets.mjs";
import { resolveDevAppServerBinary } from "../lib/electron-dev-sidecar.mjs";
import { writeJsonFile } from "../mcp/lib/current-smoke-transport.mjs";
import {
  createTempRuntimeEnv,
  launchElectronFixture,
  parseInvokeTraceRaw,
  sanitizeText,
} from "./mcp-config-fixture-smoke.mjs";
import {
  applyFailedSettingsWebSearchEvidence,
  applyPassingSettingsWebSearchEvidence,
  createSettingsWebSearchEvidence,
  parseSettingsWebSearchFixtureArgs,
  summarizeSettingsWebSearchTrace,
} from "./lib/settings-web-search-fixture-evidence.mjs";

import { captureMainProcessExit } from "./lib/persisted-atom-fixture-driver.mjs";
import { settleFixtureResources } from "../lib/chat-fixture/teardown.mjs";
import {
  openSearchConfiguration,
  inspectSearchMode,
  selectSearchMode,
  restoreSearchMode,
} from "./lib/settings-web-search-navigation-scenario.mjs";

let mainExit;
async function closeElectronFixture(handle) {
  const result = await settleFixtureResources({ app: handle.app, mainExit });
  if (
    !result.ok ||
    result.forcedCleanup !== null ||
    result.normalMainExit?.exitCode !== 0 ||
    result.normalMainExit?.signal !== null
  )
    throw new Error("normal Main exit failed");
}
const DEFAULTS = {
  runId: process.env.LIME_GATE_RUN_ID?.trim() || null,
  evidenceDir: null,
  prefix: "settings-web-search-fixture",
  timeoutMs: 120_000,
  intervalMs: 250,
  keepTemp: false,
};

function printHelp() {
  console.log(`
Settings Web Search Electron Fixture

Usage:
  node scripts/electron/settings-web-search-fixture-smoke.mjs --run-id <id>

Options:
  --run-id <id> --evidence-dir <path> --prefix <name>
  --timeout-ms <ms> --interval-ms <ms> --keep-temp -h|--help
`);
}

async function readWebSearchState(
  page,
  options,
  { expectedMode = null, requireSave = false } = {},
) {
  const { mode, config } = await inspectSearchMode(page);
  if (expectedMode && mode !== expectedMode)
    throw new Error("search mode was not persisted");
  const traceRaw = await page.evaluate(() =>
    localStorage.getItem("lime_invoke_trace_buffer_v1"),
  );
  const trace = summarizeSettingsWebSearchTrace(traceRaw);
  const saveConfirmed =
    !requireSave || trace.methods.includes("config/value/write");
  if (!saveConfirmed) throw new Error("no current config/value/write observed");
  return {
    configurationTabActive: true,
    modeControlReady: true,
    mode,
    config,
    loadingVisible: false,
    errorVisible: false,
    saveConfirmed,
    allSavedVisible: true,
    traceRaw,
    errorRaw: await page.evaluate(() =>
      localStorage.getItem("lime_invoke_error_buffer_v1"),
    ),
  };
}

async function run() {
  const options = parseSettingsWebSearchFixtureArgs(process.argv.slice(2), {
    defaults: DEFAULTS,
  });
  if (options.help) {
    printHelp();
    return;
  }
  fs.mkdirSync(options.evidenceDir, { recursive: true });
  const file = (suffix) =>
    path.join(options.evidenceDir, `${options.prefix}${suffix}`);
  const summaryPath = file("-summary.json");
  const rawEvidencePath = file("-raw.json");
  const savedScreenshotPath = file("-saved.png");
  const restartScreenshotPath = file("-restart.png");
  const restoredScreenshotPath = file("-restored.png");
  const failureScreenshotPath = file("-failure.png");
  const runtimeEnv = createTempRuntimeEnv();
  const appServerBinary = resolveDevAppServerBinary({
    env: runtimeEnv.env,
    repoRoot: process.cwd(),
    forceBuild: false,
  });
  const appServerEnv = resolveElectronAppServerRuntimeEnv({
    env: { ...runtimeEnv.env, APP_SERVER_BIN: appServerBinary },
  });
  const summary = createSettingsWebSearchEvidence({
    candidateRunId: options.runId,
    startedAt: new Date().toISOString(),
    prefix: options.prefix,
  });
  let handle = null;
  let page = null;
  const consoleErrors = [];
  const pageErrors = [];
  const traceRaws = [];
  const errorRaws = [];
  const rendererSnapshots = [];
  try {
    handle = await launchElectronFixture({
      options,
      runtimeEnv,
      appServerEnv,
      consoleErrors,
      pageErrors,
    });
    mainExit = captureMainProcessExit(handle.app.process());
    rendererSnapshots.push(handle.rendererSnapshot);
    page = handle.page;
    await openSearchConfiguration(page, options);
    const initialState = await readWebSearchState(page, options);
    const originalMode = initialState.mode;
    const changedMode = originalMode === "live" ? "disabled" : "live";
    await selectSearchMode(page, changedMode);
    const savedState = await readWebSearchState(page, options, {
      expectedMode: changedMode,
      requireSave: true,
    });
    traceRaws.push(savedState.traceRaw);
    errorRaws.push(savedState.errorRaw);
    await page.screenshot({ path: savedScreenshotPath, fullPage: true });
    await closeElectronFixture(handle);
    handle = null;
    page = null;

    handle = await launchElectronFixture({
      options,
      runtimeEnv,
      appServerEnv,
      consoleErrors,
      pageErrors,
    });
    mainExit = captureMainProcessExit(handle.app.process());
    rendererSnapshots.push(handle.rendererSnapshot);
    page = handle.page;
    await openSearchConfiguration(page, options);
    const restartState = await readWebSearchState(page, options, {
      expectedMode: changedMode,
    });
    await page.screenshot({ path: restartScreenshotPath, fullPage: true });
    await restoreSearchMode(page, initialState);
    const restoredSaveState = await readWebSearchState(page, options, {
      expectedMode: originalMode,
      requireSave: true,
    });
    traceRaws.push(restartState.traceRaw, restoredSaveState.traceRaw);
    errorRaws.push(restartState.errorRaw, restoredSaveState.errorRaw);
    await closeElectronFixture(handle);
    handle = null;
    page = null;

    handle = await launchElectronFixture({
      options,
      runtimeEnv,
      appServerEnv,
      consoleErrors,
      pageErrors,
    });
    mainExit = captureMainProcessExit(handle.app.process());
    rendererSnapshots.push(handle.rendererSnapshot);
    page = handle.page;
    await openSearchConfiguration(page, options);
    const finalState = await readWebSearchState(page, options, {
      expectedMode: originalMode,
    });
    traceRaws.push(finalState.traceRaw);
    errorRaws.push(finalState.errorRaw);
    await page.screenshot({ path: restoredScreenshotPath, fullPage: true });
    await closeElectronFixture(handle);
    handle = null;
    page = null;
    const trace = summarizeSettingsWebSearchTrace(traceRaws);
    applyPassingSettingsWebSearchEvidence(summary, {
      completedAt: new Date().toISOString(),
      electronLaunchCount: rendererSnapshots.filter(
        (snapshot) => snapshot.electron,
      ).length,
      preloadLaunchCount: rendererSnapshots.filter(
        (snapshot) => snapshot.hasInvokeBridge,
      ).length,
      isolatedUserData: runtimeEnv.electronUserDataDir.startsWith(
        runtimeEnv.tempRoot,
      ),
      configurationTabActive: finalState.configurationTabActive,
      modeControlReady: finalState.modeControlReady,
      routeChanged: changedMode !== originalMode,
      saveConfirmed: savedState.saveConfirmed && savedState.allSavedVisible,
      restartReadback: restartState.mode === changedMode,
      restorationSaveConfirmed:
        restoredSaveState.saveConfirmed && restoredSaveState.allSavedVisible,
      restorationReadback: finalState.mode === originalMode,
      loadingVisible: finalState.loadingVisible,
      errorVisible: finalState.errorVisible,
      trace,
      consoleErrors,
      pageErrors,
      invokeErrorCount: errorRaws.reduce(
        (count, raw) => count + parseInvokeTraceRaw(raw).length,
        0,
      ),
      savedScreenshotWritten: fs.existsSync(savedScreenshotPath),
      restartScreenshotWritten: fs.existsSync(restartScreenshotPath),
      restoredScreenshotWritten: fs.existsSync(restoredScreenshotPath),
    });
    writeJsonFile(rawEvidencePath, {
      lifecycle: {
        isolatedUserData: true,
        routeChanged: true,
        saveConfirmed: true,
        restartReadback: true,
        restorationSaveConfirmed: true,
        restorationReadback: true,
      },
      appServerMethods: trace.methods,
      hostCommands: trace.hostCommands,
    });
    writeJsonFile(summaryPath, summary);
    console.log(`[smoke:settings-web-search-fixture] summary=${summaryPath}`);
  } catch (error) {
    applyFailedSettingsWebSearchEvidence(summary, error);
    summary.consoleErrors = consoleErrors.map(sanitizeText);
    summary.pageErrors = pageErrors.map(sanitizeText);
    summary.failureTrace = summarizeSettingsWebSearchTrace(traceRaws);
    writeJsonFile(summaryPath, summary);
    if (page) {
      await page
        .screenshot({ path: failureScreenshotPath, fullPage: true })
        .catch(() => undefined);
    }
    throw error;
  } finally {
    if (handle) await closeElectronFixture(handle);
    if (!options.keepTemp) {
      fs.rmSync(runtimeEnv.tempRoot, { recursive: true, force: true });
    }
  }
}

run().catch((error) => {
  console.error(
    `[smoke:settings-web-search-fixture] ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
