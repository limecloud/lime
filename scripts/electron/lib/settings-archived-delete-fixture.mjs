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
    prefix: "settings-archived-delete",
    timeoutMs: 45000,
    intervalMs: 250,
    keepTemp: true,
  },
});
fs.mkdirSync(options.evidenceDir, { recursive: true });
const summary = {
  scenario: "archived-chat-permanent-delete",
  result: "fail",
  claimBoundary:
    "Real Electron/preload/IPC, archived settings, thread/delete, canonical read/list and cold restart. Only isolated temporary chats are deleted; unavailable execution backend, no turn/live provider, Windows, packaged or reference runtime evidence.",
  startedAt: new Date().toISOString(),
  assertions: {},
  calls: [],
  launches: [],
  teardowns: [],
  measurements: {},
};
const consoleErrors = [],
  pageErrors = [],
  traces = [];
let handle, mainExit, runtime;
function check(name, value) {
  summary.assertions[name] = Boolean(value);
  console.log(`[archived-delete] ${name}: ${Boolean(value)}`);
  if (!value) throw Error(name);
}
async function call(method, params = {}) {
  const response = await appServerCallFromPage(handle.page, method, params);
  const observed = response.ipcObservation;
  summary.calls.push({ method, ...observed });
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
    consoleErrors,
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
const row = (id) =>
  handle.page.locator(
    `[data-testid="settings-archived-conversation"][data-session-id="${id}"]`,
  );
const remove = (id) =>
  row(id).getByTestId("settings-archived-conversation-delete");
async function openArchived() {
  await openSettings(handle.page, options);
  await handle.page
    .getByTestId("settings-sidebar-tab-archived-conversations")
    .click();
  await handle.page
    .getByTestId("settings-archived-conversations")
    .waitFor({ state: "visible" });
  await handle.page
    .getByTestId("settings-archived-conversations-loading")
    .waitFor({ state: "hidden" });
}
async function visual(name, id) {
  await remove(id).click();
  await handle.page.getByRole("dialog").waitFor({ state: "visible" });
  const measure = await handle.page.evaluate(() => {
    const page = document.querySelector(
      '[data-testid="settings-archived-conversations"]',
    );
    const row = page.querySelector(
      '[data-testid="settings-archived-conversation"]',
    );
    const content = document.querySelector('[data-testid="settings-content"]');
    const dialog = document.querySelector('[role="dialog"]');
    const bounds = dialog.getBoundingClientRect();
    const probe = document.createElement("span");
    probe.style.color = "var(--lime-danger, hsl(var(--destructive)))";
    dialog.appendChild(probe);
    const dangerColor = getComputedStyle(probe).color;
    probe.remove();
    return {
      title: getComputedStyle(page.querySelector("h1")).fontSize,
      label: getComputedStyle(row.querySelector(".settings-row-label"))
        .fontSize,
      description: getComputedStyle(
        row.querySelector(".settings-row-description"),
      ).fontSize,
      dialogTitle: getComputedStyle(dialog.querySelector("h2")).fontSize,
      dialogBody: getComputedStyle(dialog.querySelector("p")).fontSize,
      overflow: content.scrollWidth > content.clientWidth + 1,
      dialogWithinViewport: bounds.left >= 0 && bounds.right <= innerWidth,
      focusInDialog: dialog.contains(document.activeElement),
      deleteUsesDangerColor:
        getComputedStyle(dialog.querySelector('button[type="submit"]'))
          .color === dangerColor &&
        dangerColor !==
          getComputedStyle(dialog.querySelector('button[type="button"]')).color,
      dark: document.documentElement.classList.contains("dark"),
    };
  });
  summary.measurements[name] = measure;
  check(`${name}DangerColor`, measure.deleteUsesDangerColor);
  check(
    `${name}TypographyAndLayout`,
    measure.title === "28px" &&
      measure.label === "13px" &&
      measure.description === "12px" &&
      measure.dialogTitle === "16px" &&
      measure.dialogBody === "13px" &&
      !measure.overflow &&
      measure.dialogWithinViewport &&
      measure.focusInDialog,
  );
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, `${name}.png`),
    animations: "disabled",
  });
  await handle.page.getByRole("dialog").press("Escape");
  await handle.page.getByRole("dialog").waitFor({ state: "hidden" });
  await handle.page.waitForFunction(
    (id) =>
      document.activeElement ===
      document.querySelector(
        `[data-testid="settings-archived-conversation-delete"][data-session-id="${id}"]`,
      ),
    id,
  );
  check(
    `${name}FocusReturns`,
    await remove(id).evaluate((node) => document.activeElement === node),
  );
}
try {
  await ensureElectronFixtureBuild({ rootDir: process.cwd() });
  const binary = electronAppServerBinaryDestination({
    outputRoot: path.join(process.cwd(), "dist-electron"),
    platform: process.platform,
    arch: process.arch,
  });
  runtime = createTempRuntimeEnv();
  runtime.appServerEnv = resolveElectronAppServerRuntimeEnv({
    env: { ...runtime.env, APP_SERVER_BIN: binary },
  });
  check(
    "isolatedUserData",
    runtime.tempRoot && runtime.tempRoot !== process.cwd(),
  );
  await launch();
  check(
    "electronAndPreload",
    summary.launches[0].electron && summary.launches[0].hasInvokeBridge,
  );
  const ids = [];
  for (let index = 0; index < 3; index++) {
    const thread = (
      await call("thread/start", {
        model: "fixture-model",
        modelProvider: "fixture-provider",
      })
    ).thread;
    ids.push(thread.id);
    await call("thread/archive", { threadId: thread.id });
  }
  summary.threadIds = { deleted: ids[0], survivor: ids[1], restored: ids[2] };
  await openArchived();
  for (const id of ids) await row(id).waitFor({ state: "visible" });
  await visual("light-delete", ids[0]);
  check(
    "cancelLeavesCanonicalChat",
    (await call("thread/read", { threadId: ids[0], includeTurns: false }))
      .thread.id === ids[0] &&
      (await call("thread/list", { archived: true, limit: 50 })).data.some(
        (thread) => thread.id === ids[0],
      ),
  );
  await handle.page.getByTestId("settings-sidebar-tab-appearance").click();
  await handle.page.getByRole("radio", { name: "深色", exact: true }).click();
  await openArchived();
  await visual("dark-delete", ids[0]);
  check("darkThemeApplied", summary.measurements["dark-delete"].dark);
  await handle.page.setViewportSize({ width: 900, height: 760 });
  await visual("narrow-delete", ids[0]);
  const beforeDelete = await handle.page.evaluate(() =>
    JSON.parse(localStorage.getItem("lime_invoke_trace_buffer_v1") || "[]"),
  );
  check(
    "cancelHasNoDeleteWrite",
    !beforeDelete.some((entry) =>
      (entry.args_preview?.request?.lines || []).some((line) => {
        try {
          return JSON.parse(line).method === "thread/delete";
        } catch {
          return false;
        }
      }),
    ),
  );
  await remove(ids[0]).click();
  await handle.page.getByTestId("settings-archived-confirm-delete").click();
  await row(ids[0]).waitFor({ state: "hidden" });
  await handle.page.getByRole("dialog").waitFor({ state: "hidden" });
  await handle.page.waitForFunction(
    () =>
      document.activeElement ===
      document.querySelector('[data-testid="settings-archived-conversations"]'),
  );
  check("successReturnsPageFocus", true);
  check(
    "adjacentChatPreserved",
    (await call("thread/read", { threadId: ids[1], includeTurns: false }))
      .thread.id === ids[1],
  );
  const archived = (await call("thread/list", { archived: true, limit: 50 }))
    .data;
  check(
    "canonicalArchivedListReflectsDelete",
    archived.some((x) => x.id === ids[1]) &&
      !archived.some((x) => x.id === ids[0]),
  );
  await row(ids[2])
    .getByTestId("settings-archived-conversation-restore")
    .click();
  await row(ids[2]).waitFor({ state: "hidden" });
  check(
    "restoreStillWorks",
    (await call("thread/list", { archived: false, limit: 50 })).data.some(
      (thread) => thread.id === ids[2],
    ) &&
      !(await call("thread/list", { archived: true, limit: 50 })).data.some(
        (thread) => thread.id === ids[2],
      ),
  );
  await close();
  await launch();
  await openArchived();
  await row(ids[1]).waitFor({ state: "visible" });
  check("coldDeletedChatAbsent", (await row(ids[0]).count()) === 0);
  check("coldRestoredChatAbsent", (await row(ids[2]).count()) === 0);
  check(
    "coldSurvivorPreserved",
    (await call("thread/read", { threadId: ids[1], includeTurns: false }))
      .thread.id === ids[1],
  );
  await close();
  summary.trace = summarizeSettingsAppearanceTrace(traces);
  check(
    "realGuiDeleteAndUnarchive",
    ["thread/delete", "thread/unarchive", "thread/list"].every((method) =>
      summary.trace.methods.includes(method),
    ),
  );
  check(
    "noMockOrLegacy",
    summary.trace.mockFallbackHitCount === 0 &&
      summary.trace.legacyCommands.length === 0,
  );
  check(
    "noConsoleOrPageErrors",
    consoleErrors.length === 0 && pageErrors.length === 0,
  );
  check(
    "twoNormalLaunches",
    summary.teardowns.length === 2 && summary.launches.length === 2,
  );
  summary.freshness = inspectElectronFixtureBuildFreshness({
    rootDir: process.cwd(),
  });
  check("freshBuild", summary.freshness.ready);
  summary.result = "pass";
} catch (error) {
  summary.failure = String(error.stack || error);
  process.exitCode = 1;
} finally {
  if (handle) {
    try {
      await close();
    } catch (error) {
      summary.teardownFailure = String(error);
      process.exitCode = 1;
    }
  }
  summary.consoleErrors = consoleErrors;
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
        evidenceDir: options.evidenceDir,
      },
      null,
      2,
    ),
  );
}
