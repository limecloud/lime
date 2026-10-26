#!/usr/bin/env node

import fs from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";

import { resolveElectronAppServerRuntimeEnv } from "../lib/electron-app-server-assets.mjs";
import { resolveDevAppServerBinary } from "../lib/electron-dev-sidecar.mjs";
import { writeJsonFile } from "../mcp/lib/current-smoke-transport.mjs";
import { invokeAppServerFromPage } from "../lib/chat-fixture/rpc.mjs";
import { captureMainProcessExit } from "./lib/persisted-atom-fixture-driver.mjs";
import { settleFixtureResources } from "../lib/chat-fixture/teardown.mjs";
import { inspectElectronFixtureBuildFreshness } from "../lib/electron-fixture-build.mjs";
import {
  createTempRuntimeEnv,
  launchElectronFixture,
  openSettings,
  sanitizeText,
  waitForPageCondition,
} from "./mcp-config-fixture-smoke.mjs";
import {
  applyFailedSettingsExecutionPolicyEvidence,
  applyPassingSettingsExecutionPolicyEvidence,
  createSettingsExecutionPolicyEvidence,
  parseSettingsExecutionPolicyFixtureArgs,
  summarizeSettingsExecutionPolicyTrace,
} from "./lib/settings-execution-policy-fixture-evidence.mjs";

const DEFAULTS = {
  runId: process.env.LIME_GATE_RUN_ID?.trim() || null,
  evidenceDir: null,
  prefix: "settings-execution-policy-fixture",
  timeoutMs: 120_000,
  intervalMs: 250,
  keepTemp: false,
};
const SWITCH_LABELS = {
  plan: [
    "启用 update_plan 计划工具",
    "啟用 update_plan 計畫工具",
    "Enable the update_plan planning tool",
  ],
};
const SAVE_LABELS = ["保存策略", "儲存策略", "Save policy"];
const RELOAD_LABELS = ["重新加载", "重新載入", "Reload"];

function printHelp() {
  console.log(`
Settings Execution Policy Electron Fixture

Usage:
  node scripts/electron/settings-execution-policy-fixture-smoke.mjs --run-id <id>

Options:
  --run-id <id> --evidence-dir <path> --prefix <name>
  --timeout-ms <ms> --interval-ms <ms> --keep-temp -h|--help
`);
}

async function openExecutionPolicySettings(page, options) {
  await openSettings(page, options);
  await page
    .locator('[data-testid="settings-sidebar-tab-execution-policy"]')
    .click();
}

async function readPolicyState(
  page,
  options,
  {
    expected = null,
    minimumSaveRequestCount = 0,
    requireSuccessMessage = false,
    requireErrorMessage = false,
  } = {},
) {
  return await waitForPageCondition(
    page,
    options,
    ({
      expected,
      minimumSaveRequestCount,
      requireSuccessMessage,
      requireErrorMessage,
    }) => {
      const traceRaw = window.localStorage.getItem(
        "lime_invoke_trace_buffer_v1",
      );
      let entries = [];
      try {
        const parsed = JSON.parse(traceRaw || "[]");
        entries = Array.isArray(parsed) ? parsed : [];
      } catch {
        entries = [];
      }
      const appServerRequests = entries.flatMap((entry) => {
        if (
          entry?.command !== "app_server_handle_json_lines" ||
          entry?.transport !== "electron-ipc"
        )
          return [];
        return Array.isArray(entry?.args_preview?.request?.lines)
          ? entry.args_preview.request.lines.flatMap((line) => {
              try {
                const request = JSON.parse(String(line));
                return typeof request?.method === "string" ? [request] : [];
              } catch {
                return [];
              }
            })
          : [];
      });
      const configReadObserved = appServerRequests.some(
        (request) => request.method === "config/read",
      );
      const saveRequestCount = appServerRequests.filter(
        (request) => request.method === "config/batchWrite",
      ).length;
      const state = {
        plan:
          document
            .querySelector('[aria-label="启用 update_plan 计划工具"]')
            ?.getAttribute("aria-checked") === "true",
        warningPolicy:
          Array.from(document.querySelectorAll("select")).find((select) =>
            Array.from(select.options).some(
              (option) => option.value === "shell_command_risk",
            ),
          )?.value ?? null,
      };
      const bodyText = document.body?.innerText ?? "";
      const controlsReady = Boolean(
        document.querySelector('[aria-label="启用 update_plan 计划工具"]') &&
        state.warningPolicy,
      );
      const retiredSandboxControlsAbsent = !document.querySelector(
        '[data-settings-search-target="execution-policy-sandbox"], [aria-label="启用工作区沙箱"], [aria-label="启用严格工作区沙箱"], [aria-label="启用沙箱回退提醒"]',
      );
      const expectedMatches =
        !expected ||
        (state.plan === expected.plan &&
          state.warningPolicy === expected.warningPolicy);
      const successVisible = bodyText.includes("执行策略已保存");
      const errorVisible = bodyText.includes("保存执行策略失败");
      const backendErrorExposed =
        /EISDIR|is a directory|illegal operation on a directory/i.test(
          bodyText,
        );
      const unexpectedErrorVisible =
        bodyText.includes("加载执行策略失败") ||
        backendErrorExposed ||
        (errorVisible && !requireErrorMessage);
      const executionPolicyTabActive =
        document
          .querySelector(
            '[data-testid="settings-sidebar-tab-execution-policy"]',
          )
          ?.getAttribute("aria-current") === "page";
      if (
        !executionPolicyTabActive ||
        !document.querySelector('[data-testid="execution-policy-settings"]') ||
        document.querySelectorAll(".animate-pulse").length > 0 ||
        !controlsReady ||
        !configReadObserved ||
        !expectedMatches ||
        saveRequestCount < minimumSaveRequestCount ||
        (requireSuccessMessage && !successVisible) ||
        (requireErrorMessage && !errorVisible) ||
        unexpectedErrorVisible
      ) {
        return null;
      }
      return {
        ...state,
        executionPolicyTabActive,
        policyControlsReady: controlsReady,
        retiredSandboxControlsAbsent,
        successVisible,
        errorVisible,
        unexpectedErrorVisible,
        loadingVisible: false,
        traceRaw,
        errorRaw: window.localStorage.getItem("lime_invoke_error_buffer_v1"),
      };
    },
    "Execution Policy Settings did not reach the expected lifecycle state",
    {
      expected,
      minimumSaveRequestCount,
      requireSuccessMessage,
      requireErrorMessage,
    },
  );
}

async function switchLocator(page, labels) {
  for (const label of labels) {
    const locator = page.getByRole("switch", { name: label, exact: true });
    if ((await locator.count()) > 0) return locator.first();
  }
  throw new Error(`Execution Policy switch not found: ${labels.join(" / ")}`);
}

async function warningPolicySelect(page) {
  const selects = page.locator("select");
  for (let index = 0; index < (await selects.count()); index += 1) {
    const select = selects.nth(index);
    const values = await select
      .locator("option")
      .evaluateAll((options) => options.map((option) => option.value));
    if (values.includes("shell_command_risk") && values.includes("none")) {
      return select;
    }
  }
  throw new Error("Execution Policy warning select not found");
}

async function actionButton(page, labels) {
  for (const label of labels) {
    const locator = page.getByRole("button", { name: label, exact: true });
    if ((await locator.count()) > 0) return locator.first();
  }
  throw new Error(`Execution Policy action not found: ${labels.join(" / ")}`);
}

async function applyPolicyState(page, desired) {
  const plan = await switchLocator(page, SWITCH_LABELS.plan);
  if (((await plan.getAttribute("aria-checked")) === "true") !== desired.plan)
    await plan.click();
  await (await warningPolicySelect(page)).selectOption(desired.warningPolicy);
}

async function clickAction(page, labels) {
  await (await actionButton(page, labels)).click();
}

function createConfigPathCollision(runtimeEnv) {
  const configPath = path.join(runtimeEnv.electronUserDataDir, "config.yaml");
  const backupPath = path.join(
    runtimeEnv.electronUserDataDir,
    "config.yaml.execution-policy-backup",
  );
  if (!fs.existsSync(configPath) || fs.statSync(configPath).isDirectory()) {
    throw new Error(
      "Execution Policy config file was not ready for error proof",
    );
  }
  fs.renameSync(configPath, backupPath);
  fs.mkdirSync(configPath);
  return { configPath, backupPath };
}

function restoreConfigPathCollision(collision) {
  if (!collision) return;
  if (fs.existsSync(collision.configPath)) {
    fs.rmSync(collision.configPath, { recursive: true, force: true });
  }
  if (fs.existsSync(collision.backupPath)) {
    fs.renameSync(collision.backupPath, collision.configPath);
  }
}

async function run() {
  const options = parseSettingsExecutionPolicyFixtureArgs(
    process.argv.slice(2),
    { defaults: DEFAULTS },
  );
  if (options.help) {
    printHelp();
    return;
  }
  fs.mkdirSync(options.evidenceDir, { recursive: true });
  const file = (suffix) =>
    path.join(options.evidenceDir, `${options.prefix}${suffix}`);
  const summaryPath = file("-summary.json");
  const rawEvidencePath = file("-raw.json");
  const changedScreenshotPath = file("-changed.png");
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
  const summary = createSettingsExecutionPolicyEvidence({
    candidateRunId: options.runId,
    startedAt: new Date().toISOString(),
    prefix: options.prefix,
  });
  let handle = null;
  let page = null;
  let collision = null;
  const consoleErrors = [];
  const pageErrors = [];
  const traceRaws = [];
  const errorRaws = [];
  const rendererSnapshots = [];
  const teardowns = [];
  let saveAcknowledgements = 0;
  let ioRpcProof = null;
  let mainExit = null;
  const fresh = () => {
    const state = inspectElectronFixtureBuildFreshness({
      rootDir: process.cwd(),
    });
    assert.equal(state.ready, true, "current Electron build must be fresh");
    return state;
  };
  const launch = async () => {
    const next = await launchElectronFixture({
      options,
      runtimeEnv,
      appServerEnv,
      consoleErrors,
      pageErrors,
    });
    mainExit = captureMainProcessExit(next.app.process());
    return next;
  };
  const close = async () => {
    const teardown = await settleFixtureResources({
      app: handle?.app,
      mainExit,
    });
    teardowns.push(teardown);
    summary.teardowns = teardowns;
    handle = null;
    page = null;
    mainExit = null;
    assert.equal(
      teardown.ok,
      true,
      "normal Main exit is required within 15 seconds",
    );
  };
  try {
    summary.buildBefore = fresh();
    handle = await launch();
    rendererSnapshots.push(handle.rendererSnapshot);
    page = handle.page;
    await openExecutionPolicySettings(page, options);
    const original = await readPolicyState(page, options);
    const changed = {
      plan: !original.plan,
      warningPolicy: "none",
    };
    await applyPolicyState(page, changed);
    await clickAction(page, SAVE_LABELS);
    const changedState = await readPolicyState(page, options, {
      expected: changed,
      minimumSaveRequestCount: 1,
      requireSuccessMessage: true,
    });
    saveAcknowledgements += 1;
    traceRaws.push(changedState.traceRaw);
    errorRaws.push(changedState.errorRaw);
    await page.screenshot({ path: changedScreenshotPath, fullPage: true });
    await close();

    handle = await launch();
    rendererSnapshots.push(handle.rendererSnapshot);
    page = handle.page;
    await openExecutionPolicySettings(page, options);
    const restartState = await readPolicyState(page, options, {
      expected: changed,
    });
    await page.screenshot({ path: restartScreenshotPath, fullPage: true });

    const readResponse = await invokeAppServerFromPage(page, "config/read", {
      includeLayers: true,
    });
    const failedAttempt = { ...changed, plan: !changed.plan };
    const probeAgent = structuredClone(readResponse.result.config.agent);
    probeAgent.tool_execution.update_plan_enabled = failedAttempt.plan;
    collision = createConfigPathCollision(runtimeEnv);
    ioRpcProof = await page.evaluate(
      async ({ agent, version }) => {
        const id = "execution-policy-io-proof";
        const response = await window.electronAPI.invoke(
          "app_server_handle_json_lines",
          {
            request: {
              lines: [
                JSON.stringify({
                  jsonrpc: "2.0",
                  id,
                  method: "config/batchWrite",
                  params: {
                    edits: [
                      {
                        keyPath: "agent",
                        value: agent,
                        mergeStrategy: "replace",
                      },
                    ],
                    expectedVersion: version,
                    reloadUserConfig: true,
                  },
                }),
              ],
            },
          },
        );
        const error = response.lines
          .map((line) => JSON.parse(line))
          .find((message) => message.id === id)?.error;
        return {
          method: "config/batchWrite",
          errorCode: error?.code ?? null,
          ioCauseVerified:
            /EISDIR|is a directory|illegal operation on a directory/i.test(
              String(error?.message ?? "") + JSON.stringify(error?.data ?? {}),
            ),
        };
      },
      { agent: probeAgent, version: readResponse.result.layers[0].version },
    );
    assert.equal(
      ioRpcProof.ioCauseVerified,
      true,
      "same-boundary IO failure must be verified independently of successful IPC transport",
    );
    await applyPolicyState(page, failedAttempt);
    await clickAction(page, SAVE_LABELS);
    const errorState = await readPolicyState(page, options, {
      expected: failedAttempt,
      requireErrorMessage: true,
    });
    await page.screenshot({
      path: file("-expected-error.png"),
      fullPage: true,
    });
    restoreConfigPathCollision(collision);
    collision = null;
    assert.equal(
      await (await actionButton(page, RELOAD_LABELS)).isDisabled(),
      true,
      "dirty failure cannot reload away the draft",
    );
    await clickAction(page, SAVE_LABELS);
    const recoveredState = await readPolicyState(page, options, {
      expected: failedAttempt,
      minimumSaveRequestCount: 2,
      requireSuccessMessage: true,
    });
    saveAcknowledgements += 1;
    await applyPolicyState(page, original);
    await clickAction(page, SAVE_LABELS);
    const restoredSaveState = await readPolicyState(page, options, {
      expected: original,
      minimumSaveRequestCount: 1,
      requireSuccessMessage: true,
    });
    saveAcknowledgements += 1;
    traceRaws.push(restoredSaveState.traceRaw);
    errorRaws.push(restoredSaveState.errorRaw);
    await close();

    handle = await launch();
    rendererSnapshots.push(handle.rendererSnapshot);
    page = handle.page;
    await openExecutionPolicySettings(page, options);
    const finalState = await readPolicyState(page, options, {
      expected: original,
    });
    traceRaws.push(finalState.traceRaw);
    errorRaws.push(finalState.errorRaw);
    await page.screenshot({ path: restoredScreenshotPath, fullPage: true });
    await close();
    summary.buildAfter = fresh();
    const trace = summarizeSettingsExecutionPolicyTrace({
      traceRaws,
      errorRaws,
    });
    applyPassingSettingsExecutionPolicyEvidence(summary, {
      teardowns,
      saveAcknowledgements,
      ioRpcProof,
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
      executionPolicyTabActive: finalState.executionPolicyTabActive,
      policyControlsReady: finalState.policyControlsReady,
      policyInputsChanged:
        original.plan !== changed.plan ||
        original.warningPolicy !== changed.warningPolicy,
      planInputChanged: original.plan !== changed.plan,
      retiredSandboxControlsAbsent: [
        original,
        changedState,
        restartState,
        errorState,
        recoveredState,
        restoredSaveState,
        finalState,
      ].every((state) => state.retiredSandboxControlsAbsent),
      warningBypassInput: changed.warningPolicy === "none",
      restartReadback:
        restartState.plan === changed.plan &&
        restartState.warningPolicy === changed.warningPolicy,
      expectedSaveFailureVisible:
        errorState.errorVisible === true && ioRpcProof.ioCauseVerified === true,
      expectedSaveFailureRecovered:
        recoveredState.plan === failedAttempt.plan &&
        recoveredState.warningPolicy === failedAttempt.warningPolicy &&
        recoveredState.errorVisible === false,
      restorationSaved:
        restoredSaveState.plan === original.plan &&
        restoredSaveState.warningPolicy === original.warningPolicy,
      finalRestorationReadback:
        finalState.plan === original.plan &&
        finalState.warningPolicy === original.warningPolicy,
      loadingVisible: finalState.loadingVisible,
      unexpectedErrorVisible: finalState.unexpectedErrorVisible,
      trace,
      consoleErrors,
      pageErrors,
      changedScreenshotWritten: fs.existsSync(changedScreenshotPath),
      restartScreenshotWritten: fs.existsSync(restartScreenshotPath),
      restoredScreenshotWritten: fs.existsSync(restoredScreenshotPath),
    });
    writeJsonFile(rawEvidencePath, {
      lifecycle: {
        isolatedUserData: true,
        policyInputsChanged: true,
        planInputChanged: true,
        retiredSandboxControlsAbsent: true,
        warningBypassInput: true,
        restartReadback: true,
        expectedSaveFailureVisible: true,
        expectedSaveFailureRecovered: true,
        restorationSaved: true,
        finalRestorationReadback: true,
      },
      expectedFailure: {
        method: "config/batchWrite",
        transport: "electron-ipc",
        cause: "isolated-config-path-is-directory",
        traceErrorCount: trace.unexpectedHostTraceErrorCount,
        invokeErrorCount: trace.unexpectedInvokeErrorCount,
        ioRpcProof,
        recovery: "save-retry-preserves-failed-draft",
      },
      appServerMethods: trace.methods,
    });
    writeJsonFile(summaryPath, summary);
    console.log(
      `[smoke:settings-execution-policy-fixture] summary=${summaryPath}`,
    );
  } catch (error) {
    applyFailedSettingsExecutionPolicyEvidence(summary, error);
    summary.consoleErrors = consoleErrors.map(sanitizeText);
    summary.pageErrors = pageErrors.map(sanitizeText);
    if (page) {
      const state = await page
        .evaluate(() => ({
          traceRaw: window.localStorage.getItem("lime_invoke_trace_buffer_v1"),
          errorRaw: window.localStorage.getItem("lime_invoke_error_buffer_v1"),
        }))
        .catch(() => ({ traceRaw: null, errorRaw: null }));
      summary.failureTrace = summarizeSettingsExecutionPolicyTrace({
        traceRaws: [...traceRaws, state.traceRaw],
        errorRaws: [...errorRaws, state.errorRaw],
      });
    }
    writeJsonFile(summaryPath, summary);
    if (page) {
      await page
        .screenshot({ path: failureScreenshotPath, fullPage: true })
        .catch(() => undefined);
    }
    throw error;
  } finally {
    try {
      restoreConfigPathCollision(collision);
      if (handle) await close();
      if (!options.keepTemp)
        fs.rmSync(runtimeEnv.tempRoot, { recursive: true, force: true });
    } catch (error) {
      applyFailedSettingsExecutionPolicyEvidence(summary, error);
      writeJsonFile(summaryPath, summary);
      throw error;
    } finally {
      writeJsonFile(summaryPath, summary);
    }
  }
}

run().catch((error) => {
  console.error(
    `[smoke:settings-execution-policy-fixture] ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
