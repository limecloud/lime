import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
  closeElectronFixture,
  createTempRuntimeEnv,
  openSettings,
  appServerCallFromPage,
  parseInvokeTraceRaw,
} from "../mcp-config-fixture-smoke.mjs";
import {
  parseSettingsAppearanceFixtureArgs,
  summarizeSettingsAppearanceTrace,
} from "./settings-appearance-fixture-evidence.mjs";

const options = parseSettingsAppearanceFixtureArgs(process.argv.slice(2), {
  defaults: {
    runId: null,
    evidenceDir: null,
    prefix: "settings-worktree-management",
    timeoutMs: 120000,
    intervalMs: 250,
    keepTemp: false,
  },
});
fs.mkdirSync(options.evidenceDir, { recursive: true });
const summary = {
  scenario: "managed-worktrees",
  proofLevel: "Desktop Gate B controlled fixture",
  claimBoundary:
    "Real Electron/preload/IPC, App Server and isolated Git. External backend fixture used only for thread lifecycle; no live model, reference runtime, Windows or packaged proof.",
  result: "fail",
  startedAt: new Date().toISOString(),
  assertions: {},
  calls: [],
  launches: [],
  measurements: {},
};
const consoleErrors = [],
  pageErrors = [],
  traces = [],
  errors = [];
let handle, runtime;
const check = (name, value) => {
  summary.assertions[name] = Boolean(value);
  if (!value) throw Error(name);
};
async function call(method, params = {}) {
  const response = await appServerCallFromPage(handle.page, method, params);
  summary.calls.push({ method, ...response.ipcObservation });
  return response.result;
}
async function launch() {
  handle = await launchElectronFixture({
    options,
    runtimeEnv: runtime,
    appServerEnv: runtime.appServerEnv,
    consoleErrors,
    pageErrors,
    backendMode: "external",
  });
  summary.launches.push(handle.rendererSnapshot);
  await openSettings(handle.page, options);
  await handle.page.getByTestId("settings-sidebar-tab-worktrees").click();
  await handle.page.locator("#worktrees-root-input").waitFor();
  return handle.page;
}
async function close() {
  const buffers = await handle.page.evaluate(() => ({
    trace: localStorage.getItem("lime_invoke_trace_buffer_v1"),
    errors: localStorage.getItem("lime_invoke_error_buffer_v1"),
  }));
  traces.push(buffers.trace);
  errors.push(buffers.errors);
  await closeElectronFixture(handle);
  handle = null;
}
async function refresh() {
  await handle.page
    .locator("#worktrees-managed")
    .getByRole("button", { name: "刷新", exact: true })
    .click();
  await handle.page.waitForFunction(
    () =>
      document
        .querySelector("#worktrees-managed")
        ?.getAttribute("aria-busy") === "false",
  );
}
async function appearance(mode) {
  const page = handle.page;
  await page.getByTestId("settings-sidebar-tab-appearance").click();
  await page.getByRole("radio", { name: mode, exact: true }).click();
  await page.getByTestId("settings-sidebar-tab-worktrees").click();
  await page.locator("#worktrees-root-input").waitFor();
  await page.waitForFunction(
    (dark) => document.documentElement.classList.contains("dark") === dark,
    mode === "深色",
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector("#worktrees-managed")
        ?.getAttribute("aria-busy") === "false",
  );
}
function row(page, target) {
  return page
    .locator("[data-worktree-path]")
    .filter({ has: page.locator("div", { hasText: target }) })
    .first();
}
function deleteButton(page, target) {
  return row(page, target).getByRole("button", {
    name: `删除 ${target}`,
    exact: true,
  });
}
async function backToWorktrees(page) {
  await openSettings(page, options);
  await page.getByTestId("settings-sidebar-tab-worktrees").click();
  await page.locator("#worktrees-root-input").waitFor();
  await refresh();
}
async function screenshot(name) {
  const page = handle.page;
  await page.waitForFunction(
    () => !document.querySelector("[data-sonner-toast]"),
  );
  await page.getByTestId("settings-content").evaluate((content) => {
    content.scrollTop = 0;
  });
  summary.measurements[name] = await page.evaluate(() => {
    const content = document.querySelector('[data-testid="settings-content"]');
    const row = document.querySelector("#worktrees-upstream-refresh");
    return {
      label: getComputedStyle(row.querySelector(".settings-row-label"))
        .fontSize,
      description: getComputedStyle(
        row.querySelector(".settings-row-description"),
      ).fontSize,
      horizontalOverflow: content.scrollWidth > content.clientWidth + 1,
    };
  });
  await page.screenshot({
    path: path.join(options.evidenceDir, `${name}.png`),
    animations: "disabled",
  });
}
try {
  await ensureElectronFixtureBuild({
    rootDir: process.cwd(),
    logPrefix: "settings-worktree-management",
  });
  runtime = createTempRuntimeEnv();
  const backend = path.join(runtime.tempRoot, "lifecycle-backend.mjs");
  fs.writeFileSync(
    backend,
    'import {readFileSync} from "node:fs"; JSON.parse(readFileSync(0,"utf8")); console.log(JSON.stringify({events:[]}));\n',
  );
  runtime.env.APP_SERVER_BACKEND_COMMAND = process.execPath;
  runtime.env.APP_SERVER_BACKEND_ARGS = JSON.stringify([backend]);
  runtime.appServerEnv = resolveElectronAppServerRuntimeEnv({
    env: {
      ...runtime.env,
      APP_SERVER_BIN: electronAppServerBinaryDestination({
        outputRoot: path.resolve("dist-electron"),
      }),
    },
    repoRoot: process.cwd(),
  });
  const source = path.join(runtime.tempRoot, "source");
  fs.mkdirSync(source);
  const git = (args) =>
    execFileSync("git", ["-C", source, ...args], {
      encoding: "utf8",
      stdio: "pipe",
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
      ),
    });
  git(["init", "--template=", "--initial-branch=main"]);
  fs.writeFileSync(
    path.join(source, "README.md"),
    "Recover this worktree file\n",
  );
  git(["add", "README.md"]);
  git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@localhost",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--allow-empty",
    "-m",
    "Fixture",
  ]);
  let page = await launch();
  await page.evaluate(() => {
    window.__worktreeSessionChanges = [];
    window.addEventListener("lime:agent-runtime-sessions-changed", (event) => {
      window.__worktreeSessionChanges.push(event.detail);
    });
  });
  await page.getByText("暂无工作树", { exact: true }).waitFor();
  check(
    "emptyListDoesNotCreateRoot",
    !fs.existsSync(path.join(runtime.appServerDataDir, "worktrees")),
  );
  const first = (
    await call("projectGit/worktree/create", {
      rootPath: source,
      name: "first",
      baseBranch: "main",
    })
  ).worktreePath;
  const dirty = (
    await call("projectGit/worktree/create", {
      rootPath: source,
      name: "dirty",
      baseBranch: "main",
    })
  ).worktreePath;
  fs.writeFileSync(path.join(dirty, "keep.txt"), "local user data");
  const thread = (
    await call("thread/start", {
      model: "fixture-model",
      modelProvider: "fixture-provider",
      cwd: first,
      serviceName: "Worktree fixture chat",
    })
  ).thread;
  summary.threadId = thread.id;
  await call("thread/name/set", {
    threadId: thread.id,
    name: "Worktree fixture chat",
  });
  await call("thread/section/move", {
    threadId: thread.id,
    sectionId: "01984de2-8f74-7c91-a3b2-5c5e937cf318",
  });
  await refresh();
  check(
    "registeredRowsVisible",
    (await page.locator("[data-worktree-path]").count()) === 2,
  );
  check(
    "canonicalLinkedChatVisible",
    await row(page, first)
      .getByText("Worktree fixture chat", { exact: true })
      .isVisible(),
  );
  check("pinnedDeletionDisabled", await deleteButton(page, first).isDisabled());
  await row(page, first)
    .getByRole("button", { name: "Worktree fixture chat", exact: true })
    .click();
  await page
    .locator(
      `[data-testid="thread-workspace-header"][data-session-id="${thread.sessionId}"]`,
    )
    .waitFor();
  check(
    "linkedChatOpensCanonicalSession",
    await page.getByTestId("thread-workspace-header").isVisible(),
  );
  await backToWorktrees(page);
  await row(page, dirty)
    .getByRole("button", { name: "在此工作树中新建聊天", exact: true })
    .click();
  const header = page.getByTestId("thread-workspace-header");
  await header.waitFor();
  const newSessionId = await header.getAttribute("data-session-id");
  const conversations = await call("thread/list", { limit: 100 });
  const created = conversations.data.find(
    (item) => item.sessionId === newSessionId,
  );
  check(
    "newChatReusesWorktree",
    created?.cwd === dirty && created.id !== thread.id,
  );
  const detail = await call("thread/read", {
    threadId: created.id,
    includeTurns: true,
  });
  check(
    "newChatStartsEmpty",
    Array.isArray(detail.thread.turns) && detail.thread.turns.length === 0,
  );
  summary.newConversation = {
    sessionId: newSessionId,
    threadId: created.id,
    cwd: created.cwd,
    turns: detail.thread.turns.length,
  };
  check(
    "navigationCreatesNoCheckout",
    git(["worktree", "list", "--porcelain"]).split("worktree ").length - 1 ===
      3,
  );
  await backToWorktrees(page);
  await appearance("浅色");
  await screenshot("managed-light");
  await call("thread/section/move", { threadId: thread.id, sectionId: null });
  await refresh();
  await deleteButton(page, first).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  check("cancelKeepsCheckout", fs.existsSync(first));
  await deleteButton(page, dirty).click();
  await call("thread/section/move", {
    threadId: created.id,
    sectionId: "01984de2-8f74-7c91-a3b2-5c5e937cf318",
  });
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await page.getByRole("alertdialog").getByRole("alert").waitFor();
  check(
    "latePinKeepsFileAndDialog",
    fs.readFileSync(path.join(dirty, "keep.txt"), "utf8") === "local user data",
  );
  await page.screenshot({
    path: path.join(options.evidenceDir, "delete-failure.png"),
  });
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await call("thread/section/move", { threadId: created.id, sectionId: null });
  await deleteButton(page, first).click();
  await page.screenshot({
    path: path.join(options.evidenceDir, "delete-confirmation.png"),
  });
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await page.getByRole("alertdialog").waitFor({ state: "hidden" });
  await page.waitForFunction(
    () => document.querySelectorAll("[data-worktree-path]").length === 1,
  );
  check(
    "targetedDeletionKeepsOtherCheckout",
    !fs.existsSync(first) && fs.existsSync(dirty),
  );
  check(
    "canonicalSessionCacheInvalidated",
    await page.evaluate(
      () =>
        window.__worktreeSessionChanges.filter(
          (event) => event.reason === "external",
        ).length >= 2,
    ),
  );
  const recent = await page.evaluate(async () => {
    const response = await window.electronAPI.invoke(
      "app_server_drain_events",
      { request: { includeRecent: true, limit: 100 } },
    );
    return (response?.lines ?? []).map((line) => JSON.parse(line));
  });
  summary.archiveNotifications = recent.filter(
    (message) =>
      message.method === "thread/archived" &&
      message.params?.threadId === thread.id,
  );
  check(
    "sameThreadArchiveNotification",
    summary.archiveNotifications.length === 1,
  );
  const archived = await call("thread/list", { archived: true, limit: 100 });
  check(
    "associatedThreadArchived",
    archived.data.some((item) => item.id === thread.id),
  );
  await close();
  page = await launch();
  check("coldDeletionRetained", !fs.existsSync(first));
  await page.getByTestId("settings-sidebar-tab-archived-conversations").click();
  const restore = page.locator(
    `[data-testid="settings-archived-conversation-restore"][data-session-id="${thread.sessionId}"]`,
  );
  await restore.waitFor();
  await restore.click();
  await restore.waitFor({ state: "hidden" });
  check(
    "restoreChatRecreatesCheckout",
    fs.readFileSync(path.join(first, "README.md"), "utf8") ===
      "Recover this worktree file\n",
  );
  const restoredThread = await call("thread/read", {
    threadId: thread.id,
    includeTurns: true,
  });
  check(
    "restorationKeepsCanonicalIdentity",
    restoredThread.thread.id === thread.id &&
      restoredThread.thread.sessionId === thread.sessionId &&
      restoredThread.thread.cwd === first,
  );
  await backToWorktrees(page);
  check("restoredCheckoutVisible", await row(page, first).isVisible());
  check(
    "sourceBranchUnchanged",
    git(["symbolic-ref", "--short", "HEAD"]).trim() === "main",
  );
  await appearance("深色");
  await screenshot("managed-dark");
  await page.setViewportSize({ width: 900, height: 760 });
  await screenshot("managed-narrow");
  await close();
  page = await launch();
  await page.waitForFunction(
    () => document.querySelectorAll("[data-worktree-path]").length === 2,
  );
  check(
    "coldListKeepsRestoration",
    fs.existsSync(first) &&
      (await row(page, first).isVisible()) &&
      (await row(page, dirty).isVisible()),
  );
  const limit = page.locator("#worktrees-keep-count-input");
  await limit.fill("2");
  await limit.press("Enter");
  await page.waitForFunction(
    () => !document.querySelector("#worktrees-keep-count-input")?.disabled,
  );
  await page.locator("#worktrees-auto-cleanup button").click();
  await page
    .getByRole("alertdialog")
    .waitFor({ state: "visible" });
  await screenshot("cleanup-disable-confirm");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "保持自动删除", exact: true })
    .click();
  check(
    "cleanupCancelKeepsEnabled",
    (await page
      .locator("#worktrees-auto-cleanup button")
      .getAttribute("aria-checked")) === "true",
  );
  await page.locator("#worktrees-auto-cleanup button").click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "关闭自动删除", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector("#worktrees-keep-count-input")?.disabled,
  );
  const extra = (
    await call("projectGit/worktree/create", {
      rootPath: source,
      name: "extra",
      baseBranch: "main",
    })
  ).worktreePath;
  const extraThread = (
    await call("thread/start", {
      model: "fixture-model",
      modelProvider: "fixture-provider",
      cwd: extra,
      serviceName: "Cleanup keep chat",
    })
  ).thread;
  for (const id of [thread.id, created.id, extraThread.id])
    await call("thread/unsubscribe", { threadId: id });
  await refresh();
  check(
    "disabledCleanupRetainsDirectories",
    fs.existsSync(first) && fs.existsSync(dirty) && fs.existsSync(extra),
  );
  await screenshot("cleanup-disabled");
  await page.locator("#worktrees-auto-cleanup button").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("#worktrees-auto-cleanup button")
        ?.getAttribute("aria-checked") === "true",
  );
  await page.waitForFunction(
    (root) =>
      !Array.from(document.querySelectorAll("[data-worktree-path]")).some(
        (entry) => entry.getAttribute("data-worktree-path") === root,
      ),
    dirty,
  );
  await refresh();
  check(
    "automaticCleanupRemovesOldDirtyCheckout",
    !fs.existsSync(dirty) && fs.existsSync(first) && fs.existsSync(extra),
  );
  const autoThread = (
    await call("thread/read", { threadId: created.id, includeTurns: false })
  ).thread;
  const autoArchived = await call("thread/list", {
    archived: true,
    limit: 100,
  });
  check(
    "automaticCleanupKeepsChatUnarchived",
    autoThread.id === created.id &&
      !autoArchived.data.some((item) => item.id === created.id),
  );
  await call("thread/resume", { threadId: created.id, excludeTurns: true });
  check(
    "automaticSnapshotRestoresDirtyFile",
    fs.readFileSync(path.join(dirty, "keep.txt"), "utf8") === "local user data",
  );
  await refresh();
  await screenshot("cleanup-restored");
  await close();
  summary.trace = summarizeSettingsAppearanceTrace(traces);
  check("currentIpcObserved", summary.trace.appServerIpcHitCount > 0);
  check(
    "noProductionMockOrLegacy",
    summary.trace.mockFallbackHitCount === 0 &&
      summary.trace.legacyCommands.length === 0,
  );
  check("noInvokeErrors", errors.flatMap(parseInvokeTraceRaw).length === 0);
  check(
    "noConsoleOrPageErrors",
    consoleErrors.length === 0 && pageErrors.length === 0,
  );
  check(
    "typographyAndWidth",
    Object.values(summary.measurements).every(
      (value) =>
        value.label === "13px" &&
        value.description === "12px" &&
        !value.horizontalOverflow,
    ),
  );
  summary.freshness = inspectElectronFixtureBuildFreshness({
    rootDir: process.cwd(),
  });
  check("freshBuild", summary.freshness.ready);
  summary.result = "pass";
} catch (error) {
  summary.failure = String(error.stack || error);
  process.exitCode = 1;
  if (handle)
    await handle.page
      .screenshot({ path: path.join(options.evidenceDir, "failure.png") })
      .catch(() => {});
} finally {
  if (handle) await closeElectronFixture(handle);
  summary.consoleErrors = consoleErrors;
  summary.pageErrors = pageErrors;
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
        evidence: options.evidenceDir,
      },
      null,
      2,
    ),
  );
  if (runtime && !options.keepTemp)
    fs.rmSync(runtime.tempRoot, { recursive: true, force: true });
}
