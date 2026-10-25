import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
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
import { resolveElectronAppServerRuntimeEnv } from "../../lib/electron-app-server-assets.mjs";
import { inspectElectronFixtureBuildFreshness } from "../../lib/electron-fixture-build.mjs";

const options = parseSettingsAppearanceFixtureArgs(process.argv.slice(2), {
  defaults: {
    prefix: "settings-window-close",
    timeoutMs: 60000,
    intervalMs: 100,
    keepTemp: false,
  },
});
fs.mkdirSync(options.evidenceDir, { recursive: true });
const summary = {
  result: "fail",
  startedAt: new Date().toISOString(),
  boundary:
    "Real Electron window lifecycle, keyboard input, preload/IPC, public App Server config and cold recovery. No provider, full tab-close UX, Windows native or packaged-app claim.",
  assertions: {},
  calls: [],
  launches: [],
  teardowns: [],
};
const consoleErrors = [],
  pageErrors = [],
  traces = [],
  invokeErrors = [];
let runtime, appServerEnv, handle, mainExit;
const check = (name, value) => {
  summary.assertions[name] = Boolean(value);
  console.log(`[settings-close] ${name}: ${Boolean(value)}`);
  if (!value) throw Error(name);
};
async function until(predicate) {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((done) => setTimeout(done, options.intervalMs));
  }
  throw Error("Window close fixture condition timed out");
}
function buildSnapshot() {
  return [
    ".lime/electron-renderer-build.json",
    "dist-electron/app-server.release.json",
    "dist-electron/desktop-resources.manifest.json",
    "dist-electron/main/main.js",
    "dist-electron/preload/preload.cjs",
  ].map((file) => ({
    path: file,
    sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
  }));
}
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
  check(
    `launch-${summary.launches.length}-real-host`,
    handle.rendererSnapshot.electron && handle.rendererSnapshot.hasInvokeBridge,
  );
  await handle.app.evaluate(({ BrowserWindow }) => {
    globalThis.__limeWindowCloseFixture = { inputs: [], closes: 0 };
    const window = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes("index.html"),
    );
    window.on("close", () => {
      globalThis.__limeWindowCloseFixture.closes++;
    });
    window.webContents.on("before-input-event", (_event, input) => {
      if (input.key.toLowerCase() === "w")
        globalThis.__limeWindowCloseFixture.inputs.push({
          type: input.type,
          meta: input.meta,
          control: input.control,
        });
    });
  });
}
async function close() {
  const trace = await handle.page.evaluate(() => ({
    trace: localStorage.getItem("lime_invoke_trace_buffer_v1"),
    errors: localStorage.getItem("lime_invoke_error_buffer_v1"),
  }));
  traces.push(trace.trace);
  invokeErrors.push(trace.errors);
  summary.native ??= [];
  summary.native.push(
    await handle.app.evaluate(() => globalThis.__limeWindowCloseFixture),
  );
  const result = await settleFixtureResources({ app: handle.app, mainExit });
  summary.teardowns.push(result);
  handle = null;
  check(
    `launch-${summary.launches.length}-normal-exit`,
    result.ok && result.forcedCleanup === null,
  );
}
const dialog = () => handle.page.getByRole("dialog");
const trigger = () =>
  handle.page.locator(
    '[data-settings-search-target="general-confirm-before-close"] button',
  );
async function general() {
  await openSettings(handle.page, options);
  await handle.page.getByTestId("settings-sidebar-tab-general").click();
  await trigger().waitFor();
  await until(async () => !(await trigger().isDisabled()));
}
async function select(mode, index) {
  await trigger().click();
  await handle.page.getByRole("menuitemradio").nth(index).click();
  await until(async () => !(await trigger().isDisabled()));
  check(
    `saved-${mode}`,
    (await call("config/read")).config.desktop["confirm-before-close"] === mode,
  );
}
async function nativeClose() {
  await handle.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().includes("index.html"))
      .close(),
  );
}
async function visible() {
  return handle.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().includes("index.html"))
      .isVisible(),
  );
}
async function show() {
  await handle.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes("index.html"),
    );
    window.show();
    window.focus();
  });
}
async function cancel() {
  await dialog().getByRole("button", { name: "取消", exact: true }).click();
  await dialog().waitFor({ state: "hidden" });
}
try {
  summary.freshnessStart = inspectElectronFixtureBuildFreshness({
    rootDir: process.cwd(),
  });
  check("fresh-build-start", summary.freshnessStart.ready);
  summary.buildStart = buildSnapshot();
  runtime = createTempRuntimeEnv();
  appServerEnv = resolveElectronAppServerRuntimeEnv({
    repoRoot: process.cwd(),
    env: runtime.env,
  });
  await launch();
  await call("config/batchWrite", {
    edits: [{ keyPath: "language", value: "zh-CN", mergeStrategy: "replace" }],
  });
  await general();
  check(
    "default-keyboard-only",
    (await trigger().textContent()).includes("仅关闭快捷键"),
  );
  await select("always", 2);
  await nativeClose();
  await dialog().waitFor();
  check("ordinary-close-asks", await visible());
  check(
    "cancel-default-focus",
    await dialog()
      .getByRole("button", { name: "取消", exact: true })
      .evaluate((node) => node === document.activeElement),
  );
  await nativeClose();
  check("repeat-single-dialog", (await dialog().count()) === 1);
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, "close-confirmation.png"),
  });
  await cancel();
  check("cancel-keeps-window", await visible());
  await nativeClose();
  await dialog().waitFor();
  await handle.page.keyboard.press("Escape");
  await dialog().waitFor({ state: "hidden" });
  check("escape-keeps-window", await visible());
  await select("keyboardOnly", 1);
  await nativeClose();
  await until(async () => !(await visible()));
  check(
    "keyboard-only-native-button-closes-without-prompt",
    (await dialog().count()) === 0,
  );
  await show();
  await handle.page.getByTestId("settings-back-button").click();
  await handle.page.keyboard.press(
    process.platform === "darwin" ? "Meta+w" : "Control+w",
  );
  await dialog().waitFor();
  check("keyboard-shortcut-asks", await visible());
  await cancel();
  await handle.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes("index.html"),
    );
    window.focus();
    window.webContents.focus();
    const modifiers = process.platform === "darwin" ? ["meta"] : ["control"];
    window.webContents.sendInputEvent({
      type: "keyDown",
      keyCode: "W",
      modifiers,
    });
    window.webContents.sendInputEvent({
      type: "keyUp",
      keyCode: "W",
      modifiers,
    });
  });
  await dialog().waitFor();
  check("native-keyboard-shortcut-asks", await visible());
  check(
    "native-before-input-observed",
    await handle.app.evaluate(
      () => globalThis.__limeWindowCloseFixture.inputs.length > 0,
    ),
  );
  await cancel();
  await general();
  await select("always", 2);
  await close();
  await launch();
  await general();
  check(
    "cold-restored-always",
    (await trigger().textContent()).includes("始终"),
  );
  await nativeClose();
  await dialog().waitFor();
  await dialog().getByRole("checkbox").check();
  await dialog().getByRole("button", { name: "关闭窗口", exact: true }).click();
  await until(async () => !(await visible()));
  await show();
  check(
    "do-not-ask-persisted",
    (await call("config/read")).config.desktop["confirm-before-close"] ===
      "never",
  );
  await nativeClose();
  await until(async () => !(await visible()));
  check("never-no-confirmation", (await dialog().count()) === 0);
  await show();
  await close();
  summary.trace = summarizeSettingsAppearanceTrace(traces);
  check(
    "config-via-real-ipc",
    summary.trace.configIpcHitCount > 0 &&
      summary.trace.missingConfigMethods.length === 0,
  );
  check("no-mock-fallback", summary.trace.mockFallbackHitCount === 0);
  check(
    "no-page-or-console-errors",
    pageErrors.length === 0 && consoleErrors.length === 0,
  );
  check(
    "no-invoke-errors",
    invokeErrors.every((raw) => !raw || JSON.parse(raw).length === 0),
  );
  summary.freshnessFinish = inspectElectronFixtureBuildFreshness({
    rootDir: process.cwd(),
  });
  summary.buildFinish = buildSnapshot();
  check("fresh-build-finish", summary.freshnessFinish.ready);
  check(
    "build-digests-stable",
    JSON.stringify(summary.buildStart) === JSON.stringify(summary.buildFinish),
  );
  summary.result = "pass";
} catch (error) {
  summary.error = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  if (handle) {
    try {
      await close();
    } catch (error) {
      summary.result = "fail";
      summary.teardownError = String(error);
      process.exitCode = 1;
    }
  }
  if (
    runtime &&
    !options.keepTemp &&
    summary.teardowns.every((entry) => entry.ok)
  )
    fs.rmSync(runtime.tempRoot, { recursive: true, force: true });
  summary.consoleErrors = consoleErrors;
  summary.pageErrors = pageErrors;
  summary.finishedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(options.evidenceDir, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(`[settings-close] ${summary.result}: ${options.evidenceDir}`);
}
