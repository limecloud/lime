import fs from "node:fs";
import { createHash } from "node:crypto";
import http from "node:http";
import path from "node:path";
import {
  appServerCallFromPage,
  createTempRuntimeEnv,
  launchElectronFixture,
  openSettings,
  parseInvokeTraceRaw,
} from "../mcp-config-fixture-smoke.mjs";
import { captureMainProcessExit } from "./persisted-atom-fixture-driver.mjs";
import { settleFixtureResources } from "../../agent-runtime/claw-chat-current-fixture-teardown.mjs";
import { bindGuiWorkspaceAndModelPreferences } from "../../agent-runtime/claw-chat-current-fixture-rpc.mjs";
import {
  parseSettingsAppearanceFixtureArgs,
  summarizeSettingsAppearanceTrace,
} from "./settings-appearance-fixture-evidence.mjs";
import { resolveElectronAppServerRuntimeEnv } from "../../lib/electron-app-server-assets.mjs";
import { inspectElectronFixtureBuildFreshness } from "../../lib/electron-fixture-build.mjs";
import { readComposerEditorText } from "../../lib/composer-editor-dom.mjs";

const options = parseSettingsAppearanceFixtureArgs(process.argv.slice(2), {
  defaults: {
    prefix: "settings-enter-behavior",
    timeoutMs: 60000,
    intervalMs: 100,
    keepTemp: false,
  },
});
fs.mkdirSync(options.evidenceDir, { recursive: true });
const model = "enter-behavior-fixture";
const key = "isolated-enter-fixture-key";
const reply = "Enter behavior fixture completed.";
const summary = {
  result: "fail",
  startedAt: new Date().toISOString(),
  boundary:
    "Real Electron/preload/IPC, config persistence and cold restart, actual Composer keyboard input, canonical Thread/Turn, native powerSaveBlocker acquire/release and production provider HTTP lowering to an isolated local SSE fixture. No live provider, Windows native or packaged claim.",
  assertions: {},
  calls: [],
  sends: [],
  launches: [],
  teardowns: [],
  powerSnapshots: [],
};
const requests = [],
  consoleErrors = [],
  pageErrors = [],
  traces = [],
  invokeErrors = [];
let runtime, appServerEnv, handle, mainExit;
let nextResponseGate = null;
const primary = process.platform === "darwin" ? "Meta" : "Control";
const check = (name, value) => {
  summary.assertions[name] = Boolean(value);
  console.log(`[settings-enter] ${name}: ${Boolean(value)}`);
  if (!value) throw Error(name);
};
async function until(predicate, timeoutMs = options.timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
  throw Error("Enter fixture condition timed out");
}
function snapshotBuild(marker) {
  const directory = path.join(options.evidenceDir, `build-${marker}`);
  fs.mkdirSync(directory, { recursive: true });
  const files = [
    ".lime/electron-renderer-build.json",
    "dist-electron/app-server.release.json",
    "dist-electron/desktop-resources.manifest.json",
  ];
  for (const file of files)
    fs.copyFileSync(file, path.join(directory, path.basename(file)));
  const resources = JSON.parse(
    fs.readFileSync("dist-electron/desktop-resources.manifest.json", "utf8"),
  ).resources;
  const artifacts = [
    "dist/index.html",
    "dist/browser-annotation.html",
    "dist-electron/main/main.js",
    "dist-electron/preload/preload.cjs",
    ...resources.map((entry) => path.join("dist-electron", entry.path)),
  ];
  return artifacts
    .filter((file) => fs.existsSync(file) && fs.statSync(file).isFile())
    .map((file) => ({
      path: file,
      sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
    }));
}
const providerServer = http.createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${key}`)
    return response.writeHead(401).end();
  if (request.method === "GET" && request.url.endsWith("/models")) {
    response.writeHead(200, { "content-type": "application/json" });
    return response.end(
      JSON.stringify({ data: [{ id: model, object: "model" }] }),
    );
  }
  if (request.method !== "POST" || !request.url.endsWith("/chat/completions"))
    return response.writeHead(404).end();
  let body = "";
  for await (const chunk of request) body += chunk;
  requests.push(JSON.parse(body));
  const gate = nextResponseGate;
  nextResponseGate = null;
  if (gate) await gate;
  if (response.destroyed) return;
  const chunk = (delta, finish_reason) => ({
    id: `chatcmpl-enter-${requests.length}`,
    object: "chat.completion.chunk",
    created: 1,
    model,
    choices: [{ index: 0, delta, finish_reason }],
  });
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "close",
  });
  response.end(
    `data: ${JSON.stringify(chunk({ role: "assistant", content: reply }, null))}\n\n` +
      `data: ${JSON.stringify(chunk({}, "stop"))}\n\ndata: [DONE]\n\n`,
  );
});
async function call(method, params = {}) {
  const response = await appServerCallFromPage(handle.page, method, params);
  summary.calls.push({ method, ...response.ipcObservation });
  return response.result;
}
async function launch() {
  handle = await launchElectronFixture({
    options,
    runtimeEnv: runtime,
    appServerEnv,
    consoleErrors,
    pageErrors,
    backendMode: "runtime",
  });
  mainExit = captureMainProcessExit(handle.app.process());
  summary.launches.push(handle.rendererSnapshot);
  const instrumentation = await handle.app.evaluate(
    ({ app, powerSaveBlocker }, exitReceipt) => {
      const fs = process.getBuiltinModule("fs");
      const records = [];
      const start = powerSaveBlocker.start.bind(powerSaveBlocker);
      const stop = powerSaveBlocker.stop.bind(powerSaveBlocker);
      const wrappedStart = (type) => {
        const id = start(type);
        records.push({
          action: "start",
          type,
          id,
          isStarted: powerSaveBlocker.isStarted(id),
        });
        return id;
      };
      const wrappedStop = (id) => {
        stop(id);
        records.push({
          action: "stop",
          id,
          isStarted: powerSaveBlocker.isStarted(id),
        });
      };
      powerSaveBlocker.start = wrappedStart;
      powerSaveBlocker.stop = wrappedStop;
      globalThis.__limePowerSaveFixtureRecords = records;
      app.on("will-quit", () =>
        fs.writeFileSync(exitReceipt, JSON.stringify(records, null, 2) + "\n"),
      );
      return {
        node: process.versions.node,
        startInstalled: powerSaveBlocker.start === wrappedStart,
        stopInstalled: powerSaveBlocker.stop === wrappedStop,
      };
    },
    path.join(
      options.evidenceDir,
      `power-exit-${summary.launches.length}.json`,
    ),
  );
  summary.nativeInstrumentation ??= [];
  summary.nativeInstrumentation.push(instrumentation);
  check(
    "nativeInstrumentationInstalled",
    instrumentation.startInstalled && instrumentation.stopInstalled,
  );
  check(
    "realElectronAndPreload",
    handle.rendererSnapshot.electron && handle.rendererSnapshot.hasInvokeBridge,
  );
}
async function trace() {
  return handle.page.evaluate(() => ({
    trace: localStorage.getItem("lime_invoke_trace_buffer_v1"),
    errors: localStorage.getItem("lime_invoke_error_buffer_v1"),
  }));
}
async function close() {
  const snapshot = await trace().catch(() => null);
  if (snapshot) {
    traces.push(snapshot.trace);
    invokeErrors.push(snapshot.errors);
  }
  summary.mainExitBeforeTeardown = mainExit.getExitRecord();
  const result = await settleFixtureResources({ app: handle.app, mainExit });
  summary.teardowns.push(result);
  handle = null;
  check("normalExit", result.ok && result.forcedCleanup === null);
}
const trigger = () =>
  handle.page.locator(
    '[data-settings-search-target="general-enter-behavior"] button',
  );
const menuBarToggle = () =>
  handle.page.locator(
    '[data-settings-search-target="general-menu-bar"] [role="switch"]',
  );
const powerToggle = () =>
  handle.page.locator(
    '[data-settings-search-target="general-prevent-sleep"] [role="switch"]',
  );
async function powerSnapshot(marker) {
  const snapshot = await handle.app.evaluate(({ powerSaveBlocker }) => {
    const records = globalThis.__limePowerSaveFixtureRecords;
    const ids = [
      ...new Set(
        records
          .filter((entry) => entry.action === "start")
          .map((entry) => entry.id),
      ),
    ];
    return {
      records: [...records],
      activeIds: ids.filter((id) => powerSaveBlocker.isStarted(id)),
    };
  });
  const observation = {
    marker,
    launch: summary.launches.length,
    ...snapshot,
  };
  if (
    JSON.stringify(summary.powerSnapshots.at(-1)) !==
    JSON.stringify(observation)
  )
    summary.powerSnapshots.push(observation);
  return snapshot;
}
async function setPowerPreference(enabled, marker) {
  await openGeneral();
  await until(async () => !(await powerToggle().isDisabled()));
  if ((await powerToggle().getAttribute("aria-checked")) !== String(enabled))
    await powerToggle().click();
  await until(
    async () =>
      !(await powerToggle().isDisabled()) &&
      (await powerToggle().getAttribute("aria-checked")) === String(enabled),
  );
  const { config } = await call("config/read");
  check(
    `${marker}-power-config`,
    (config.desktop.preventSleepWhileRunning === true) === enabled,
  );
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, `${marker}-power.png`),
  });
  await handle.page.getByTestId("settings-back-button").click();
  await editor().waitFor();
}
const editor = () =>
  handle.page.locator('[data-testid="composer-editor"]:visible');
async function openGeneral() {
  await openSettings(handle.page, options);
  await handle.page.getByTestId("settings-sidebar-tab-general").click();
  await trigger().waitFor();
  await until(async () => !(await trigger().isDisabled()));
}
async function checkMenuBar(enabled, marker) {
  if (process.platform !== "darwin") return;
  check(
    `${marker}-menu-bar-ui`,
    (await menuBarToggle().getAttribute("aria-checked")) === String(enabled),
  );
  const { config } = await call("config/read", {});
  check(
    `${marker}-menu-bar-config`,
    (config.desktop["mac-menu-bar-enabled"] !== false) === enabled,
  );
}
async function toggleMenuBar(enabled, marker) {
  if (process.platform !== "darwin") return;
  await menuBarToggle().click();
  await until(
    async () =>
      !(await menuBarToggle().isDisabled()) &&
      (await menuBarToggle().getAttribute("aria-checked")) === String(enabled),
  );
  await checkMenuBar(enabled, marker);
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, `${marker}-menu-bar.png`),
  });
}
async function select(mode, index) {
  await openGeneral();
  await trigger().click();
  await handle.page.getByRole("menuitemradio").nth(index).click();
  await until(async () => !(await trigger().isDisabled()));
  const { config } = await call("config/read", {});
  check(`saved-${mode}`, config.desktop.composerEnterBehavior === mode);
  check(
    `preserved-${mode}`,
    config.desktop["open-link-in-target-preference"] === "external-browser",
  );
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, `${mode}-settings.png`),
  });
  await handle.page.getByTestId("settings-back-button").click();
  await editor().waitFor();
}
async function fill(text, multiline = false) {
  await editor().fill(text);
  if (multiline) {
    await editor().press("Shift+Enter");
    await editor().pressSequentially("line two");
  }
}
async function newline(name) {
  const before = await readComposerEditorText(editor());
  const count = requests.length;
  await editor().press("Enter");
  await until(
    async () => (await readComposerEditorText(editor())).length > before.length,
  );
  check(
    `${name}-newline`,
    (await readComposerEditorText(editor())).includes("\n"),
  );
  check(`${name}-no-request`, requests.length === count);
}
async function send(name, shortcut, whileActive) {
  const count = requests.length;
  const draft = await readComposerEditorText(editor());
  const before = parseInvokeTraceRaw((await trace()).trace).flatMap(
    (entry) => entry.args_preview?.request?.lines ?? [],
  );
  await editor().press(shortcut);
  await until(() => requests.length > count);
  const lines = parseInvokeTraceRaw((await trace()).trace).flatMap(
    (entry) => entry.args_preview?.request?.lines ?? [],
  );
  const start = lines
    .filter((line) => !before.includes(line))
    .map((line) => JSON.parse(line))
    .find((message) => message.method === "turn/start");
  check(`${name}-thread`, typeof start?.params.threadId === "string");
  if (whileActive) await whileActive(start.params.threadId);
  const read = await until(async () => {
    const current = await call("thread/read", {
      threadId: start.params.threadId,
      includeTurns: true,
    });
    const turn = current.thread.turns.at(-1);
    return turn?.status === "completed" &&
      !summary.sends.some((sent) => sent.turnId === turn.id)
      ? current
      : null;
  });
  await handle.page
    .locator('[data-message-role="assistant"]')
    .filter({ hasText: reply })
    .last()
    .waitFor();
  check(`${name}-provider`, requests[count].model === model);
  const user = requests[count].messages.findLast(
    (message) => message.role === "user",
  );
  const text =
    typeof user?.content === "string"
      ? user.content
      : (user?.content ?? []).map((part) => part.text ?? "").join("");
  check(`${name}-input`, text.includes(draft.trim()));
  summary.sends.push({
    name,
    threadId: read.thread.id,
    turnId: read.thread.turns.at(-1).id,
    model: requests[count].model,
    providerInputMatchesDraft: text.includes(draft.trim()),
    providerInputLength: text.length,
  });
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, `${name}-completed.png`),
  });
}
async function gatedPowerSend(name, toggleWhileActive = false) {
  const baseline = await powerSnapshot(`${name}-before`);
  let release;
  nextResponseGate = new Promise((resolve) => {
    release = resolve;
  });
  try {
    await fill(name);
    await send(name, "Enter", async (threadId) => {
      const active = await call("thread/read", {
        threadId,
        includeTurns: true,
      });
      check(
        `${name}-canonical-active`,
        active.thread.status.type === "active" &&
          active.thread.turns.at(-1).status === "inProgress",
      );
      const blocked = await until(async () => {
        const s = await powerSnapshot(`${name}-waiting`);
        return s.activeIds.length === 1 ? s : null;
      }, 10000);
      check(
        `${name}-native-start`,
        blocked.records.length === baseline.records.length + 1 &&
          blocked.records.at(-1).action === "start" &&
          blocked.records.at(-1).isStarted === true,
      );
      if (toggleWhileActive) {
        await setPowerPreference(false, `${name}-disabled`);
        const disabled = await powerSnapshot(`${name}-disabled`);
        check(
          `${name}-native-stop-on-disable`,
          disabled.activeIds.length === 0 &&
            disabled.records.at(-1).action === "stop" &&
            disabled.records.at(-1).isStarted === false,
        );
        const stillActive = await call("thread/read", {
          threadId,
          includeTurns: true,
        });
        check(
          `${name}-still-canonical-active`,
          stillActive.thread.status.type === "active",
        );
        await setPowerPreference(true, `${name}-enabled`);
        check(
          `${name}-native-reacquire`,
          (await powerSnapshot(`${name}-reenabled`)).activeIds.length === 1,
        );
      }
      release();
    });
    const released = await until(async () => {
      const s = await powerSnapshot(`${name}-finished`);
      return s.activeIds.length === 0 ? s : null;
    });
    check(
      `${name}-native-stop-on-completion`,
      released.records.at(-1).action === "stop" &&
        released.records.at(-1).isStarted === false,
    );
  } finally {
    release();
  }
}
try {
  summary.freshness = inspectElectronFixtureBuildFreshness({
    rootDir: process.cwd(),
  });
  check("freshBuild", summary.freshness.ready);
  summary.buildStart = snapshotBuild("start");
  await new Promise((resolve) =>
    providerServer.listen(0, "127.0.0.1", resolve),
  );
  runtime = createTempRuntimeEnv();
  appServerEnv = {
    ...resolveElectronAppServerRuntimeEnv({ env: runtime.env }),
    LIME_DEBUG_MCP_NOTIFICATIONS: "1",
    LIME_DEBUG_MCP_NOTIFICATIONS_FILE: path.join(
      options.evidenceDir,
      "observed-notification-methods.log",
    ),
  };
  await launch();
  const { provider } = await call("modelProvider/create", {
    name: "Enter fixture",
    providerType: "openai",
    apiHost: `http://127.0.0.1:${providerServer.address().port}/v1`,
  });
  await call("modelProvider/update", {
    providerId: provider.id,
    enabled: true,
    sortOrder: -1,
    models: [
      {
        id: model,
        capability: {
          taskFamilies: ["chat"],
          inputModalities: ["text"],
          outputModalities: ["text"],
          runtimeFeatures: ["streaming"],
          capabilities: {
            vision: false,
            tools: true,
            streaming: true,
            jsonMode: false,
            functionCalling: true,
            reasoning: false,
          },
        },
      },
    ],
  });
  await call("modelProviderKey/create", {
    providerId: provider.id,
    apiKey: key,
    alias: "fixture",
    replaceExisting: true,
  });
  const { workspace } = await call("workspace/default/ensure");
  check(
    "isolatedWorkspace",
    fs
      .realpathSync(workspace.rootPath ?? workspace.root_path)
      .startsWith(fs.realpathSync(runtime.tempRoot) + path.sep),
  );
  await call("config/batchWrite", {
    edits: [
      {
        keyPath: "desktop.open-link-in-target-preference",
        value: "external-browser",
        mergeStrategy: "replace",
      },
    ],
  });
  await bindGuiWorkspaceAndModelPreferences(handle.page, workspace.id, {
    provider: provider.id,
    model,
  });
  await handle.page.reload();
  await handle.page.getByTestId("app-sidebar").waitFor();
  await openGeneral();
  await checkMenuBar(true, "default");
  await toggleMenuBar(false, "saved-disabled");
  await handle.page.getByTestId("settings-back-button").click();
  await select("cmdAlways", 2);
  await fill("always prompt");
  await newline("always");
  await send("always-primary", `${primary}+Enter`);
  check(
    "default-power-no-native-acquisition",
    (await powerSnapshot("default-completed")).records.length === 0,
  );
  await setPowerPreference(true, "saved-enabled");
  check(
    "enabled-idle-no-native-acquisition",
    (await powerSnapshot("enabled-idle")).activeIds.length === 0,
  );
  await close();
  await launch();
  await openGeneral();
  check(
    "cold-power-ui",
    (await powerToggle().getAttribute("aria-checked")) === "true",
  );
  check(
    "cold-power-config",
    (await call("config/read")).config.desktop.preventSleepWhileRunning ===
      true,
  );
  check(
    "cold-idle-no-native-acquisition",
    (await powerSnapshot("cold-idle")).records.length === 0,
  );
  await checkMenuBar(false, "cold-disabled");
  await toggleMenuBar(true, "saved-enabled");
  await trigger().click();
  check(
    "coldRestartValue",
    (await handle.page
      .getByRole("menuitemradio")
      .nth(2)
      .getAttribute("aria-checked")) === "true",
  );
  await handle.page.keyboard.press("Escape");
  const cold = await call("config/read", {});
  check(
    "coldRestartConfig",
    cold.config.desktop.composerEnterBehavior === "cmdAlways",
  );
  await handle.page.getByTestId("settings-back-button").click();
  await fill("cold prompt");
  await newline("cold");
  await select("cmdIfMultiline", 1);
  await fill("line one", true);
  await newline("multiline");
  await send("multiline-primary", `${primary}+Enter`);
  await fill("single prompt");
  await send("single-enter", "Enter");
  await select("enter", 0);
  await fill("default prompt");
  await send("default-enter", "Enter");
  await gatedPowerSend("power-active-finish");
  await gatedPowerSend("power-preference-toggle", true);
  let releaseExitResponse;
  nextResponseGate = new Promise((resolve) => {
    releaseExitResponse = resolve;
  });
  const beforeExitRequest = requests.length;
  await fill("power-active-exit");
  await editor().press("Enter");
  await until(() => requests.length > beforeExitRequest);
  const exitStart = parseInvokeTraceRaw((await trace()).trace)
    .flatMap((entry) => entry.args_preview?.request?.lines ?? [])
    .map((line) => JSON.parse(line))
    .findLast((message) => message.method === "turn/start");
  const exitActive = await call("thread/read", {
    threadId: exitStart.params.threadId,
    includeTurns: true,
  });
  check(
    "exit-canonical-active",
    exitActive.thread.status.type === "active" &&
      exitActive.thread.turns.at(-1).status === "inProgress",
  );
  await until(
    async () => (await powerSnapshot("before-exit")).activeIds.length === 1,
  );
  await close();
  releaseExitResponse();
  const exitPower = JSON.parse(
    fs.readFileSync(
      path.join(options.evidenceDir, "power-exit-2.json"),
      "utf8",
    ),
  );
  check(
    "exit-native-release",
    exitPower.at(-1).action === "stop" && exitPower.at(-1).isStarted === false,
  );
  summary.trace = summarizeSettingsAppearanceTrace(traces);
  check(
    "noMockFallback",
    summary.trace.mockFallbackHitCount === 0 &&
      summary.trace.legacyCommands.length === 0 &&
      summary.trace.missingConfigMethods.length === 0 &&
      summary.trace.appServerIpcHitCount > 0,
  );
  check(
    "noInvokeErrors",
    invokeErrors.flatMap(parseInvokeTraceRaw).length === 0,
  );
  check("noPageErrors", pageErrors.length === 0);
  summary.finalFreshness = inspectElectronFixtureBuildFreshness({
    rootDir: process.cwd(),
  });
  check("freshBuildAtFinish", summary.finalFreshness.ready);
  summary.buildFinish = snapshotBuild("finish");
  check(
    "buildArtifactsStableDuringRun",
    JSON.stringify(summary.buildStart) === JSON.stringify(summary.buildFinish),
  );
  summary.result = "pass";
} catch (error) {
  summary.error = String(error?.stack ?? error);
  if (handle)
    await handle.page
      .screenshot({ path: path.join(options.evidenceDir, "failure.png") })
      .catch(() => undefined);
  process.exitCode = 1;
} finally {
  if (handle)
    await close().catch((error) => {
      summary.teardownError = String(error);
      process.exitCode = 1;
    });
  providerServer.closeAllConnections();
  if (providerServer.listening)
    await new Promise((resolve) => providerServer.close(resolve));
  summary.finishedAt = new Date().toISOString();
  summary.consoleErrors = consoleErrors;
  summary.pageErrors = pageErrors;
  fs.writeFileSync(
    path.join(options.evidenceDir, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  if (runtime && !options.keepTemp)
    fs.rmSync(runtime.tempRoot, { recursive: true, force: true });
  console.log(`[settings-enter] ${summary.result}: ${options.evidenceDir}`);
}
