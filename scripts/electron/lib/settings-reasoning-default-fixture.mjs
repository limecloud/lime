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
import { settleFixtureResources } from "../../agent-runtime/claw-chat-current-fixture-teardown.mjs";
import {
  parseSettingsAppearanceFixtureArgs,
  summarizeSettingsAppearanceTrace,
} from "./settings-appearance-fixture-evidence.mjs";

const options = parseSettingsAppearanceFixtureArgs(process.argv.slice(2), {
  defaults: {
    prefix: "settings-reasoning-default",
    timeoutMs: 60000,
    intervalMs: 250,
    keepTemp: true,
  },
});
fs.mkdirSync(options.evidenceDir, { recursive: true });
const summary = {
  scenario: "reasoning-default-before-preferences",
  result: "fail",
  startedAt: new Date().toISOString(),
  claimBoundary:
    "Real Electron/preload/IPC and settings controls, canonical default model, ordered User writes, new/old Thread identity and cold restart. Isolated provider capabilities, unavailable execution backend, no Agent turns/live provider, reference runtime, Windows or packaged proof.",
  assertions: {},
  calls: [],
  launches: [],
  teardowns: [],
  writeSequences: {},
};
const errors = [],
  pageErrors = [],
  traces = [];
const levels = ["low", "medium", "high", "xhigh", "max", "ultra", "persistent"];
let runtime, handle, mainExit;
function check(name, value) {
  summary.assertions[name] = Boolean(value);
  console.log(`[reasoning-default] ${name}: ${Boolean(value)}`);
  if (!value) throw Error(name);
}
async function call(method, params = {}) {
  const response = await appServerCallFromPage(handle.page, method, params);
  const observed = response.ipcObservation;
  summary.calls.push({
    method,
    requestId: observed.requestId,
    responseId: observed.responseId,
    electron: observed.electron,
    transport: observed.transport,
    fallback: observed.fallback,
  });
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
    consoleErrors: errors,
    pageErrors,
    backendMode: "unavailable",
  });
  mainExit = captureMainProcessExit(handle.app.process());
  summary.launches.push(handle.rendererSnapshot);
  check(
    "electronAndPreload",
    summary.launches.every(
      (launch) => launch.electron && launch.hasInvokeBridge,
    ),
  );
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
const trigger = () =>
  handle.page.locator(
    "#configuration-reasoning-efforts button[aria-haspopup=menu]",
  );
async function openConfiguration() {
  await openSettings(handle.page, options);
  await handle.page.getByTestId("settings-sidebar-tab-configuration").click();
  await trigger().waitFor();
  await trigger().click();
}
async function guiWrites() {
  return await handle.page.evaluate(() => {
    const entries = JSON.parse(
      localStorage.getItem("lime_invoke_trace_buffer_v1") || "[]",
    );
    return entries.flatMap((entry) =>
      (entry.args_preview?.request?.lines || []).flatMap((line) => {
        const message = JSON.parse(line);
        return message.method === "config/value/write" ? [message.params] : [];
      }),
    );
  });
}
async function disable(label, field) {
  const before = (await guiWrites()).length;
  const item = handle.page.getByRole("menuitemcheckbox", {
    name: label,
    exact: true,
  });
  check(
    `${field}InitiallyEnabled`,
    (await item.getAttribute("aria-checked")) === "true",
  );
  await item.click();
  await handle.page.waitForFunction(
    (label) =>
      [...document.querySelectorAll('[role="menuitemcheckbox"]')].some(
        (node) =>
          node.textContent === label &&
          node.getAttribute("aria-checked") === "false",
      ),
    label,
  );
  const writes = (await guiWrites()).slice(before);
  summary.writeSequences[field] = writes;
  return writes;
}
async function seedEffort(effort) {
  await call("config/batchWrite", {
    edits: [
      {
        keyPath: "model_reasoning_effort",
        value: effort,
        mergeStrategy: "upsert",
      },
      {
        keyPath: "desktop.enabled-reasoning-efforts",
        value: levels,
        mergeStrategy: "upsert",
      },
    ],
  });
}
try {
  await ensureElectronFixtureBuild({ rootDir: process.cwd() });
  runtime = createTempRuntimeEnv();
  runtime.appServerEnv = resolveElectronAppServerRuntimeEnv({
    env: {
      ...runtime.env,
      APP_SERVER_BIN: electronAppServerBinaryDestination({
        outputRoot: path.resolve("dist-electron"),
      }),
    },
  });
  check(
    "isolatedUserData",
    runtime.tempRoot && runtime.tempRoot !== process.cwd(),
  );
  await launch();
  const { provider } = await call("modelProvider/create", {
    name: "Reasoning default fixture",
    providerType: "openai",
    apiHost: "http://127.0.0.1:9/v1",
  });
  const model = "reasoning-default-fixture";
  await call("modelProvider/update", {
    providerId: provider.id,
    enabled: true,
    sortOrder: -1,
    models: [
      {
        id: model,
        capability: {
          taskFamilies: ["chat", "reasoning"],
          inputModalities: ["text"],
          outputModalities: ["text"],
          runtimeFeatures: ["streaming", "reasoning"],
          capabilities: {
            vision: false,
            tools: true,
            streaming: true,
            jsonMode: false,
            functionCalling: true,
            reasoning: true,
            reasoningEffort: {
              supported: true,
              levels,
              default: "medium",
              source: "api",
              options: [],
            },
          },
        },
      },
    ],
  });
  await call("modelProviderKey/create", {
    providerId: provider.id,
    apiKey: "reasoning-default-test-only-key",
    alias: "fixture",
    replaceExisting: true,
  });
  const catalog = await call("model/list", {});
  const defaults = catalog.data.filter((entry) => entry.isDefault);
  summary.defaultModels = defaults;
  check(
    "uniqueCanonicalDefaultModel",
    defaults.length === 1 &&
      defaults[0].providerId === provider.id &&
      defaults[0].model === model &&
      defaults[0].defaultReasoningEffort === "medium",
  );
  await seedEffort("ultra");
  const old = await call("thread/start", {
    model,
    modelProvider: provider.id,
    cwd: runtime.tempRoot,
  });
  const oldId = old.thread.id;
  summary.oldThreadId = oldId;
  check(
    "originalThreadSnapshotsUltra",
    old.reasoningEffort === "ultra" &&
      old.thread.extra.reasoningEffort === "ultra",
  );
  await handle.page.reload();
  await handle.page.getByTestId("app-sidebar").waitFor();
  await openConfiguration();
  const ultraWrites = await disable("超高", "ultra");
  check(
    "ultraDefaultWrittenBeforePreference",
    ultraWrites.length === 2 &&
      ultraWrites[0].keyPath === "model_reasoning_effort" &&
      ultraWrites[0].value === "medium" &&
      ultraWrites[1].keyPath === "desktop.enabled-reasoning-efforts" &&
      !ultraWrites[1].value.includes("ultra") &&
      ultraWrites[0].filePath === ultraWrites[1].filePath &&
      ultraWrites[0].expectedVersion !== ultraWrites[1].expectedVersion,
  );
  const saved = await call("config/read", { includeLayers: true });
  check(
    "realUserDefaultAndPreferenceSaved",
    saved.config.model_reasoning_effort === "medium" &&
      !saved.config.desktop["enabled-reasoning-efforts"].includes("ultra") &&
      ultraWrites.every(
        (write) =>
          write.filePath ===
          saved.layers.find((layer) => layer.name.type === "user").name.file,
      ),
  );
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, "saved-default-menu.png"),
    animations: "disabled",
  });
  await handle.page.keyboard.press("Escape");
  const next = await call("thread/start", {
    model,
    modelProvider: provider.id,
    cwd: runtime.tempRoot,
  });
  summary.newThreadId = next.thread.id;
  check(
    "newThreadSnapshotsCorrectedDefault",
    next.reasoningEffort === "medium" &&
      next.thread.extra.reasoningEffort === "medium",
  );
  check(
    "existingThreadNotRewritten",
    (await call("thread/read", { threadId: oldId, includeTurns: false })).thread
      .extra.reasoningEffort === "ultra",
  );
  await seedEffort("max");
  await handle.page.reload();
  await handle.page.getByTestId("app-sidebar").waitFor();
  await openConfiguration();
  const maxWrites = await disable("最大", "max");
  check(
    "maxDefaultWrittenBeforePreference",
    maxWrites.length === 2 &&
      maxWrites[0].keyPath === "model_reasoning_effort" &&
      maxWrites[0].value === "medium" &&
      maxWrites[1].keyPath === "desktop.enabled-reasoning-efforts" &&
      !maxWrites[1].value.includes("max"),
  );
  await handle.page.keyboard.press("Escape");
  await close();
  await launch();
  await openConfiguration();
  check(
    "coldPreferencesRetained",
    (await handle.page
      .getByRole("menuitemcheckbox", { name: "最大", exact: true })
      .getAttribute("aria-checked")) === "false",
  );
  await handle.page.keyboard.press("Escape");
  const cold = await call("config/read", {});
  check(
    "coldUserDefaultRetained",
    cold.config.model_reasoning_effort === "medium",
  );
  check(
    "coldOldThreadKeepsOriginalEffort",
    (await call("thread/resume", { threadId: oldId })).reasoningEffort ===
      "ultra",
  );
  check(
    "coldNewThreadKeepsCorrectedEffort",
    (
      await call("thread/read", {
        threadId: next.thread.id,
        includeTurns: false,
      })
    ).thread.extra.reasoningEffort === "medium",
  );
  await close();
  const trace = summarizeSettingsAppearanceTrace(traces);
  check(
    "noMockOrLegacy",
    trace.mockFallbackHitCount === 0 && trace.legacyCommands.length === 0,
  );
  check(
    "noConsoleOrPageErrors",
    errors.length === 0 && pageErrors.length === 0,
  );
  check(
    "twoNormalLaunches",
    summary.launches.length === 2 && summary.teardowns.length === 2,
  );
  summary.freshness = inspectElectronFixtureBuildFreshness({
    rootDir: process.cwd(),
  });
  check("freshBuild", summary.freshness.ready);
  summary.result = "pass";
} catch (error) {
  summary.failure = String(error.stack || error);
  process.exitCode = 1;
  if (handle?.page) {
    try {
      await handle.page.screenshot({
        path: path.join(options.evidenceDir, "failure.png"),
        animations: "disabled",
      });
    } catch (captureError) {
      summary.failureCaptureError = String(captureError);
    }
  }
} finally {
  if (handle) {
    try {
      await close();
    } catch (error) {
      summary.teardownFailure = String(error);
      process.exitCode = 1;
    }
  }
  summary.consoleErrors = errors;
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
      },
      null,
      2,
    ),
  );
}
