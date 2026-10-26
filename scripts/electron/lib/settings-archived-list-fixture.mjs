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
import { settleFixtureResources } from "../../lib/chat-fixture/teardown.mjs";
import {
  parseSettingsAppearanceFixtureArgs,
  summarizeSettingsAppearanceTrace,
} from "./settings-appearance-fixture-evidence.mjs";

const options = parseSettingsAppearanceFixtureArgs(process.argv.slice(2), {
  defaults: {
    prefix: "settings-archived-list",
    timeoutMs: 45000,
    intervalMs: 250,
    keepTemp: true,
  },
});
fs.mkdirSync(options.evidenceDir, { recursive: true });
const summary = {
  scenario: "archived-complete-list-search-project-batch",
  result: "fail",
  claimBoundary:
    "Real Electron/preload/IPC, complete archived pagination, fuzzy search, project/sort controls, batch deletion, canonical read/list and cold restart. Only isolated temporary chats are deleted; unavailable execution backend, no turn/live provider, Windows, packaged or reference runtime evidence.",
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
  console.log(`[archived-list] ${name}: ${Boolean(value)}`);
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
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, name + "-page.png"),
    animations: "disabled",
  });
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
  const projectRoot = path.join(runtime.tempRoot, "alpha-project");
  const standaloneRoot = path.join(runtime.tempRoot, "standalone");
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(standaloneRoot, { recursive: true });
  const project = (
    await call("project/create", {
      name: "Fixture Alpha",
      roots: [{ path: projectRoot }],
      idempotencyKey: "archived-project-fixture",
    })
  ).project;
  check("realProjectCreated", Boolean(project?.id));
  const ids = [];
  for (let index = 0; index < 105; index++) {
    const name =
      index < 2
        ? ["Implementation Alpha", "Implementation Beta"][index]
        : index === 104
          ? "needle-deep-104"
          : index === 2
            ? "Unique oakmaple"
            : "Archived record " + String(index).padStart(3, "0");
    const thread = (
      await call("thread/start", {
        model: "fixture-model",
        modelProvider: "fixture-provider",
        cwd: index < 2 ? projectRoot : standaloneRoot,
        ...(index < 2 ? { projectId: project.id } : {}),
      })
    ).thread;
    ids.push(thread.id);
    await call("thread/name/set", { threadId: thread.id, name });
    await call("thread/archive", { threadId: thread.id });
  }
  summary.threadIds = {
    project: ids.slice(0, 2),
    restored: ids[104],
    archiveCount: ids.length,
  };
  await openArchived();
  const rows = handle.page.getByTestId("settings-archived-conversation");
  await handle.page.waitForFunction(
    () =>
      document.querySelectorAll(
        '[data-testid="settings-archived-conversation"]',
      ).length === 105,
  );
  check("all105CanonicalRowsVisible", (await rows.count()) === 105);
  const content = handle.page.getByTestId("settings-content");
  const contentBounds = await content.boundingBox();
  await handle.page.mouse.move(
    contentBounds.x + contentBounds.width / 2,
    contentBounds.y + contentBounds.height / 2,
  );
  await handle.page.mouse.wheel(0, 1000);
  await handle.page.waitForFunction(
    () =>
      document.querySelector('[data-testid="settings-content"]').scrollTop >
      200,
  );
  summary.measurements.stickyControls = await handle.page.evaluate(() => {
    const content = document.querySelector('[data-testid="settings-content"]');
    const controls = document.querySelector(
      '[data-testid="settings-archived-controls"]',
    );
    return {
      scrollTop: content.scrollTop,
      contentTop: content.getBoundingClientRect().top,
      controlsTop: controls.getBoundingClientRect().top,
    };
  });
  check(
    "searchControlsStayVisibleWhileScrolling",
    Math.abs(
      summary.measurements.stickyControls.contentTop -
        summary.measurements.stickyControls.controlsTop,
    ) < 2,
  );
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, "sticky-controls.png"),
    animations: "disabled",
  });
  await handle.page.mouse.wheel(0, -5000);
  await handle.page.waitForFunction(
    () =>
      document.querySelector('[data-testid="settings-content"]').scrollTop ===
      0,
  );
  const pagination = await handle.page.evaluate(() => {
    const entries = JSON.parse(
      localStorage.getItem("lime_invoke_trace_buffer_v1") || "[]",
    );
    return entries.flatMap((entry) =>
      (entry.args_preview?.request?.lines || []).flatMap((line) => {
        try {
          const msg = JSON.parse(line);
          return msg.method === "thread/list" && msg.params?.archived
            ? [{ cursor: msg.params.cursor || null, limit: msg.params.limit }]
            : [];
        } catch {
          return [];
        }
      }),
    );
  });
  summary.archivePagination = pagination;
  check(
    "guiTraversedCanonicalCursor",
    pagination.length >= 2 && pagination.some((page) => page.cursor),
  );
  const search = () => handle.page.getByTestId("settings-archived-search");
  async function find(value, count) {
    await search().fill(value);
    await handle.page.waitForFunction(
      (count) =>
        document.querySelectorAll(
          '[data-testid="settings-archived-conversation"]',
        ).length === count,
      count,
    );
  }
  async function choose(id, label) {
    const trigger = handle.page.locator(
      'button[aria-labelledby="' + id + "-label " + id + '-value"]',
    );
    await trigger.click();
    await handle.page
      .getByRole("menuitemradio", { name: label, exact: true })
      .click();
    await handle.page.getByRole("menu").waitFor({ state: "hidden" });
  }
  await find("needle-deep-104", 1);
  check("searchBeyondFirst100", (await row(ids[104]).count()) === 1);
  await search().press("Escape");
  await handle.page.waitForFunction(
    () =>
      document.querySelector('[data-testid="settings-archived-search"]')
        .value === "" &&
      document.querySelectorAll(
        '[data-testid="settings-archived-conversation"]',
      ).length === 105,
  );
  check(
    "escapeClearsAndKeepsSearchFocus",
    await search().evaluate((node) => document.activeElement === node),
  );
  await find("Implementaton", 2);
  check(
    "fuzzyTitleSearch",
    (await row(ids[0]).count()) === 1 && (await row(ids[1]).count()) === 1,
  );
  await choose("archived-sort", "字母顺序");
  check(
    "alphabeticalRowOrder",
    (await rows.first().getAttribute("data-session-id")) === ids[0],
  );
  await choose("archived-project", "Fixture Alpha");
  check("projectFilterHasOnlyAssignedRows", (await rows.count()) === 2);
  check(
    "selectedProjectHidesGroupHeader",
    await rows
      .first()
      .evaluate((node) => !node.closest("section").querySelector("header")),
  );
  check(
    "selectedProjectShowsRepositoryAfterTimestamp",
    (
      await rows.first().locator(".settings-row-description").innerText()
    ).endsWith(" • alpha-project"),
  );
  await choose("archived-project", "所有项目");
  check(
    "groupedRowsHideRepositoryAndInternalIdentity",
    !(
      await rows.first().locator(".settings-row-description").innerText()
    ).includes("alpha-project") &&
      !(await rows.first().innerText()).includes(project.id),
  );
  await visual("light-list", ids[0]);
  await handle.page.getByTestId("settings-sidebar-tab-appearance").click();
  await handle.page.getByRole("radio", { name: "深色", exact: true }).click();
  await openArchived();
  await find("Implementation", 2);
  await visual("dark-list", ids[0]);
  await handle.page.setViewportSize({ width: 900, height: 760 });
  await visual("narrow-list", ids[0]);
  await handle.page
    .getByRole("button", { name: "项目操作", exact: true })
    .click();
  await handle.page.getByTestId("settings-archived-delete-project").click();
  await handle.page.getByRole("dialog").waitFor({ state: "visible" });
  check(
    "projectConfirmationHasNameAndCount",
    (await handle.page.getByRole("dialog").innerText()).includes(
      "Fixture Alpha",
    ) && (await handle.page.getByRole("dialog").innerText()).includes("2"),
  );
  await handle.page.getByTestId("settings-archived-confirm-delete").click();
  await handle.page.getByRole("dialog").waitFor({ state: "hidden" });
  check(
    "onlyProjectRowsRemoved",
    (await row(ids[0]).count()) === 0 && (await row(ids[1]).count()) === 0,
  );
  await find("", 103);
  await search().fill("needle-deep-104");
  await row(ids[104])
    .getByTestId("settings-archived-conversation-restore")
    .click();
  await row(ids[104]).waitFor({ state: "hidden" });
  check(
    "restorePreservesCanonicalIdentity",
    (await call("thread/read", { threadId: ids[104], includeTurns: false }))
      .thread.id === ids[104],
  );
  traces.push(
    await handle.page.evaluate(() =>
      localStorage.getItem("lime_invoke_trace_buffer_v1"),
    ),
  );
  await find("oakmaple", 1);
  await handle.page.getByTestId("settings-archived-delete-all").click();
  await handle.page.getByRole("dialog").waitFor({ state: "visible" });
  check(
    "deleteAllSnapshotIgnoresSearch",
    (await handle.page.getByRole("dialog").innerText()).includes("102"),
  );
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, "delete-all-confirm.png"),
    animations: "disabled",
  });
  await handle.page.getByRole("dialog").press("Escape");
  await handle.page.getByRole("dialog").waitFor({ state: "hidden" });
  // The store pages all threads before the exact archived projection filters
  // each page. A restored thread can therefore leave fewer than 100 rows.
  const archiveIds = [];
  const archivePages = [];
  const seenCursors = new Set();
  let cursor;
  do {
    const page = await call("thread/list", {
      archived: true,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    archiveIds.push(...page.data.map((thread) => thread.id));
    archivePages.push({
      count: page.data.length,
      cursor: cursor || null,
      nextCursor: page.nextCursor || null,
    });
    cursor = page.nextCursor;
    if (cursor && seenCursors.has(cursor))
      throw Error("archive cursor repeated");
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  summary.cancelArchivePages = archivePages;
  const expectedArchiveIds = ids.slice(2, 104);
  check(
    "cancelAllLeavesArchiveAndCursor",
    archivePages.length > 1 &&
      archiveIds.length === 102 &&
      new Set(archiveIds).size === 102 &&
      expectedArchiveIds.every((id) => archiveIds.includes(id)),
  );
  await handle.page.getByTestId("settings-archived-delete-all").click();
  await handle.page.getByTestId("settings-archived-confirm-delete").click();
  await handle.page
    .getByRole("dialog")
    .waitFor({ state: "hidden", timeout: 120000 });
  await handle.page
    .getByTestId("settings-archived-conversations-empty")
    .waitFor({ state: "visible" });
  check(
    "allArchiveCanonicallyDeleted",
    (await call("thread/list", { archived: true, limit: 100 })).data.length ===
      0,
  );
  check(
    "activeRestoredChatUntouched",
    (await call("thread/read", { threadId: ids[104], includeTurns: false }))
      .thread.id === ids[104],
  );
  await close();
  await launch();
  await openArchived();
  await handle.page
    .getByTestId("settings-archived-conversations-empty")
    .waitFor({ state: "visible" });
  check(
    "coldRestartArchiveEmpty",
    (await handle.page
      .getByTestId("settings-archived-conversation")
      .count()) === 0,
  );
  check(
    "coldActiveIdentityPreserved",
    (await call("thread/read", { threadId: ids[104], includeTurns: false }))
      .thread.id === ids[104],
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
