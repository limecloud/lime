#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import assert from "node:assert/strict";

import { resolveElectronAppServerRuntimeEnv } from "../lib/electron-app-server-assets.mjs";
import { resolveDevAppServerBinary } from "../lib/electron-dev-sidecar.mjs";
import { writeJsonFile } from "../mcp/lib/current-smoke-transport.mjs";
import { inspectElectronFixtureBuildFreshness } from "../lib/electron-fixture-build.mjs";
import { captureMainProcessExit } from "./lib/persisted-atom-fixture-driver.mjs";
import { settleFixtureResources } from "../agent-runtime/claw-chat-current-fixture-teardown.mjs";
import {
  captureSettingsDraftFixtureSources,
  observeSettingsDraftReadback,
  runMcpDraftNavigationScenario,
} from "./lib/settings-draft-navigation-scenario.mjs";
import {
  appServerCallFromPage,
  createContext7ConfigFromGui,
  createTempRuntimeEnv,
  launchElectronFixture,
  openMcpConfigSettings,
  parseInvokeTraceRaw,
} from "./mcp-config-fixture-smoke.mjs";
import { CONTEXT7_SERVER_NAME } from "./lib/mcp-config-fixture-evidence.mjs";
import {
  MCP_LIFECYCLE_REQUIRED_METHODS,
  applyFailedSettingsMcpLifecycleEvidence,
  applyPassingSettingsMcpLifecycleEvidence,
  createSettingsMcpLifecycleEvidence,
  parseSettingsMcpLifecycleFixtureArgs,
  summarizeSettingsMcpLifecycleTrace,
} from "./lib/settings-mcp-lifecycle-fixture-evidence.mjs";

const DEFAULTS = {
  runId: process.env.LIME_GATE_RUN_ID?.trim() || null,
  evidenceDir: null,
  prefix: "settings-mcp-lifecycle-fixture",
  timeoutMs: 120_000,
  intervalMs: 250,
  keepTemp: false,
};
const FIXTURE_URL = "http://127.0.0.1:9/mcp";
const FIXTURE_ENV_VAR = "SETTINGS_MCP_FIXTURE_TOKEN";
const UPDATED_URL = "http://127.0.0.1:9/updated";

function printHelp() {
  console.log(`
Settings MCP Lifecycle Electron Fixture

Usage:
  node scripts/electron/settings-mcp-lifecycle-fixture-smoke.mjs --run-id <id>

Options:
  --run-id <id> --evidence-dir <path> --prefix <name>
  --timeout-ms <ms> --interval-ms <ms> --keep-temp -h|--help
`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readInvokeBuffers(page) {
  return await page.evaluate(() => ({
    traceRaw: window.localStorage.getItem("lime_invoke_trace_buffer_v1"),
    errorRaw: window.localStorage.getItem("lime_invoke_error_buffer_v1"),
  }));
}

async function waitForFixtureServer(
  page,
  options,
  predicate,
  failureMessage,
  expectedId = null,
) {
  const startedAt = Date.now();
  let lastCall = null;
  while (Date.now() - startedAt < Math.min(options.timeoutMs, 45_000)) {
    lastCall = await appServerCallFromPage(page, "mcpServer/list", {});
    observeSettingsDraftReadback(lastCall, "mcpServer/list");
    const servers = Array.isArray(lastCall.result?.servers)
      ? lastCall.result.servers
      : [];
    const server = servers.find((item) => item?.name === CONTEXT7_SERVER_NAME);
    if (server && expectedId !== null)
      assert.equal(
        server.id === expectedId,
        true,
        "MCP server identity must survive restart",
      );
    if (!server && expectedId !== null)
      assert.equal(
        servers.some((item) => item?.id === expectedId),
        false,
        "MCP server identity must not change its name",
      );
    if (predicate(server)) {
      return { server, call: lastCall };
    }
    await sleep(options.intervalMs);
  }
  throw new Error(failureMessage);
}

async function selectFixtureServer(page, options) {
  const row = page
    .locator('[data-testid="mcp-config-server"]')
    .filter({ hasText: CONTEXT7_SERVER_NAME });
  await row.waitFor({
    state: "visible",
    timeout: Math.min(options.timeoutMs, 45_000),
  });
  await row.getByTestId("mcp-config-open-settings").click();
  await page.locator('[data-testid="mcp-config-connection-url"]').waitFor({
    state: "visible",
    timeout: Math.min(options.timeoutMs, 30_000),
  });
}

async function run() {
  const options = parseSettingsMcpLifecycleFixtureArgs(process.argv.slice(2), {
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
  const updatedScreenshotPath = file("-updated.png");
  const recoveredScreenshotPath = file("-recovered.png");
  const finalScreenshotPath = file("-final.png");
  const runtimeEnv = createTempRuntimeEnv();
  const appServerBinary = resolveDevAppServerBinary({
    env: runtimeEnv.env,
    repoRoot: process.cwd(),
    forceBuild: false,
  });
  const appServerEnv = resolveElectronAppServerRuntimeEnv({
    env: { ...runtimeEnv.env, APP_SERVER_BIN: appServerBinary },
  });
  const summary = createSettingsMcpLifecycleEvidence({
    candidateRunId: options.runId,
    startedAt: new Date().toISOString(),
    prefix: options.prefix,
  });
  const consoleErrors = [];
  const pageErrors = [];
  const rendererSnapshots = [];
  const traceRaws = [];
  const errorRaws = [];
  let electronHandle = null;
  let page = null;
  let mainExit = null;
  const teardowns = [];
  const fresh = () => {
    const value = inspectElectronFixtureBuildFreshness({
      rootDir: process.cwd(),
    });
    assert.equal(value.ready, true, "current Electron build must be fresh");
    return value;
  };
  const close = async () => {
    if (!electronHandle) return;
    const teardown = await settleFixtureResources({
      app: electronHandle.app,
      mainExit,
    });
    teardowns.push(teardown);
    summary.teardowns = teardowns;
    electronHandle = null;
    page = null;
    mainExit = null;
    assert.equal(
      teardown.ok,
      true,
      "normal Main exit is required within 15 seconds",
    );
  };
  try {
    summary.buildFreshness = { before: fresh() };
    summary.sourceManifest = {
      before: captureSettingsDraftFixtureSources(process.cwd()),
    };
    electronHandle = await launchElectronFixture({
      options,
      runtimeEnv,
      appServerEnv,
      consoleErrors,
      pageErrors,
      backendMode: "unavailable",
    });
    mainExit = captureMainProcessExit(electronHandle.app.process());
    rendererSnapshots.push(electronHandle.rendererSnapshot);
    page = electronHandle.page;
    await openMcpConfigSettings(page, options);
    await createContext7ConfigFromGui(page, {
      configUrl: FIXTURE_URL,
      envVarName: FIXTURE_ENV_VAR,
    });
    const created = await waitForFixtureServer(
      page,
      options,
      (server) => Boolean(server),
      "MCP Settings did not create the fixture server",
    );
    const serverId = created.server?.id;
    assert.equal(typeof serverId, "string");
    assert.ok(serverId);
    const mcpDraft = await runMcpDraftNavigationScenario({
      page,
      options,
      server: created.server,
      selectServer: () => selectFixtureServer(page, options),
    });
    await page
      .locator('[data-testid="mcp-config-connection-url"]')
      .fill(UPDATED_URL);
    await page.locator('[data-testid="mcp-config-save"]').click();
    await waitForFixtureServer(
      page,
      options,
      (server) => server?.server_config?.url === UPDATED_URL,
      "MCP Settings update was not persisted",
      serverId,
    );
    await page.getByTestId("mcp-config-server").getByRole("switch").click();
    await waitForFixtureServer(
      page,
      options,
      (server) => server?.enabled_lime === false,
      "MCP toggle was not persisted",
      serverId,
    );
    await page.screenshot({ path: updatedScreenshotPath, fullPage: true });
    const updatedBuffers = await readInvokeBuffers(page);
    traceRaws.push(updatedBuffers.traceRaw);
    errorRaws.push(updatedBuffers.errorRaw);
    await close();

    electronHandle = await launchElectronFixture({
      options,
      runtimeEnv,
      appServerEnv,
      consoleErrors,
      pageErrors,
      backendMode: "unavailable",
    });
    mainExit = captureMainProcessExit(electronHandle.app.process());
    rendererSnapshots.push(electronHandle.rendererSnapshot);
    page = electronHandle.page;
    await openMcpConfigSettings(page, options);
    await waitForFixtureServer(
      page,
      options,
      (server) =>
        server?.server_config?.url === UPDATED_URL &&
        server?.enabled_lime === false,
      "MCP Settings restart did not recover the updated server",
      serverId,
    );
    await selectFixtureServer(page, options);
    const recoveredUrl = await page
      .locator('[data-testid="mcp-config-connection-url"]')
      .inputValue();
    await page.getByTestId("mcp-config-cancel").click();
    const recoveredEnabled = await page
      .getByTestId("mcp-config-server")
      .getByRole("switch")
      .isChecked();
    if (recoveredUrl !== UPDATED_URL || recoveredEnabled !== false) {
      throw new Error("MCP Settings GUI did not recover the updated values");
    }
    await page.screenshot({ path: recoveredScreenshotPath, fullPage: true });
    await selectFixtureServer(page, options);
    await page.locator('[data-testid="mcp-config-delete"]').click();
    await page.getByRole("alertdialog").getByRole("button").last().click();
    await waitForFixtureServer(
      page,
      options,
      (server) => !server,
      "MCP Settings did not delete the fixture server",
      serverId,
    );
    const deletedBuffers = await readInvokeBuffers(page);
    traceRaws.push(deletedBuffers.traceRaw);
    errorRaws.push(deletedBuffers.errorRaw);
    await close();

    electronHandle = await launchElectronFixture({
      options,
      runtimeEnv,
      appServerEnv,
      consoleErrors,
      pageErrors,
      backendMode: "unavailable",
    });
    mainExit = captureMainProcessExit(electronHandle.app.process());
    rendererSnapshots.push(electronHandle.rendererSnapshot);
    page = electronHandle.page;
    await openMcpConfigSettings(page, options);
    const finalList = await waitForFixtureServer(
      page,
      options,
      (server) => !server,
      "MCP Settings final restart restored a deleted server",
      serverId,
    );
    await page.locator('[data-testid="mcp-config-create-server"]').waitFor({
      state: "visible",
      timeout: Math.min(options.timeoutMs, 30_000),
    });
    await page.screenshot({ path: finalScreenshotPath, fullPage: true });
    const finalBuffers = await readInvokeBuffers(page);
    traceRaws.push(finalBuffers.traceRaw);
    errorRaws.push(finalBuffers.errorRaw);
    const trace = summarizeSettingsMcpLifecycleTrace(traceRaws);
    await close();
    summary.buildFreshness.after = fresh();
    summary.sourceManifest.after = captureSettingsDraftFixtureSources(
      process.cwd(),
    );
    applyPassingSettingsMcpLifecycleEvidence(summary, {
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
      guiCreated: trace.methods.includes("mcpServer/create"),
      guiUpdated: trace.methods.includes("mcpServer/update"),
      restartReadback: true,
      guiDeleted: trace.methods.includes("mcpServer/delete"),
      finalRestartAbsent: !finalList.server,
      sameServerAcrossRestarts: true,
      mcpDraft,
      buildFreshness: summary.buildFreshness,
      sourceManifest: summary.sourceManifest,
      normalMainExits: teardowns.map((value) => ({
        ...value.normalMainExit,
        forcedCleanup: value.forcedCleanup !== null,
      })),
      trace,
      consoleErrors,
      pageErrors,
      invokeErrorCount: errorRaws.reduce(
        (count, raw) => count + parseInvokeTraceRaw(raw).length,
        0,
      ),
      updatedScreenshotWritten: fs.existsSync(updatedScreenshotPath),
      recoveredScreenshotWritten: fs.existsSync(recoveredScreenshotPath),
      finalScreenshotWritten: fs.existsSync(finalScreenshotPath),
    });
    writeJsonFile(rawEvidencePath, {
      lifecycle: {
        isolatedUserData: true,
        guiCreated: true,
        guiUpdated: true,
        restartReadback: true,
        guiDeleted: true,
        finalRestartAbsent: true,
      },
      mcpDraft,
      appServerMethods: trace.methods.filter((method) =>
        MCP_LIFECYCLE_REQUIRED_METHODS.includes(method),
      ),
    });
    writeJsonFile(summaryPath, summary);
    console.log(
      `[smoke:settings-mcp-lifecycle-fixture] summary=${summaryPath}`,
    );
  } catch (error) {
    applyFailedSettingsMcpLifecycleEvidence(summary, error);
    summary.failureDiagnostics = {
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
    };
    if (page) {
      const buffers = await readInvokeBuffers(page).catch(() => null);
      summary.failureTrace = summarizeSettingsMcpLifecycleTrace([
        ...traceRaws,
        buffers?.traceRaw,
      ]);
    }
    writeJsonFile(summaryPath, summary);
    throw error;
  } finally {
    if (electronHandle) {
      try {
        await close();
      } finally {
        writeJsonFile(summaryPath, summary);
      }
    }
    if (!options.keepTemp) {
      fs.rmSync(runtimeEnv.tempRoot, { recursive: true, force: true });
    }
  }
}

run().catch((error) => {
  console.error(
    `[smoke:settings-mcp-lifecycle-fixture] ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
