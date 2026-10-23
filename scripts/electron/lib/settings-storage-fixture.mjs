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
    prefix: "settings-storage",
    timeoutMs: 120000,
    intervalMs: 250,
    keepTemp: true,
  },
});
fs.mkdirSync(options.evidenceDir, { recursive: true });
const summary = {
  scenario: "device-storage",
  proofLevel: "Desktop Gate B controlled fixture",
  claimBoundary:
    "Real Electron/preload/IPC and App Server with isolated canonical data. External backend only supplies idle thread lifecycle; no live model, reference runtime, Windows or packaged claim.",
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
  invokeErrors = [];
let runtime, handle;
const check = (name, condition) => {
  summary.assertions[name] = Boolean(condition);
  if (!condition) throw Error(name);
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
  await handle.page.getByTestId("settings-sidebar-tab-storage").click();
  await handle.page.getByTestId("settings-storage-page").waitFor();
  return handle.page;
}
async function close() {
  const buffers = await handle.page.evaluate(() => ({
    trace: localStorage.getItem("lime_invoke_trace_buffer_v1"),
    errors: localStorage.getItem("lime_invoke_error_buffer_v1"),
  }));
  traces.push(buffers.trace);
  invokeErrors.push(buffers.errors);
  await closeElectronFixture(handle);
  handle = null;
}
async function measured() {
  await handle.page
    .locator("#storage-usage")
    .getByRole("button", { name: "刷新", exact: true })
    .waitFor({ state: "visible" });
  await handle.page.waitForFunction(
    () => !document.querySelector("#storage-cleanup button")?.disabled,
  );
}
async function screenshot(name) {
  await handle.page.getByTestId("settings-content").evaluate((element) => {
    element.scrollTop = 0;
  });
  summary.measurements[name] = await handle.page.evaluate(() => {
    const content = document.querySelector('[data-testid="settings-content"]');
    const row = document.querySelector("#storage-cleanup");
    return {
      label: getComputedStyle(row.querySelector(".settings-row-label"))
        .fontSize,
      description: getComputedStyle(
        row.querySelector(".settings-row-description"),
      ).fontSize,
      horizontalOverflow: content.scrollWidth > content.clientWidth + 1,
    };
  });
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, `${name}.png`),
    animations: "disabled",
  });
}
async function appearance(name) {
  await handle.page.getByTestId("settings-sidebar-tab-appearance").click();
  await handle.page.getByRole("radio", { name, exact: true }).click();
  await handle.page.getByTestId("settings-sidebar-tab-storage").click();
  await handle.page.waitForFunction(
    (dark) => document.documentElement.classList.contains("dark") === dark,
    name === "深色",
  );
  await measured();
}
const seedAges = (ids, parent, child) => {
  // Only the isolated fixture database is seeded. All review/delete actions still
  // enter the real public method; no renderer state or production path is mocked.
  const script = `import sqlite3,json,sys,pathlib,os
root=pathlib.Path(sys.argv[1]); ids=json.loads(sys.argv[2]); db=sqlite3.connect(root/'sqlite/state.sqlite')
if sys.argv[3]: db.execute("INSERT INTO canonical_thread_spawn_edges(parent_thread_id,child_thread_id,status) VALUES(?,?,'closed')",(sys.argv[3],sys.argv[4]))
for thread_id in ids:
 row=db.execute('SELECT thread_json,rollout_path FROM canonical_threads WHERE thread_id=?',(thread_id,)).fetchone()
 value=json.loads(row[0]); value['createdAtMs']=1000; value['updatedAtMs']=2000
 db.execute('UPDATE canonical_threads SET thread_json=?,created_at_ms=1000,updated_at_ms=2000 WHERE thread_id=?',(json.dumps(value),thread_id))
 rollout=root/row[1]; assert rollout.is_relative_to(root); assert not rollout.is_symlink(); os.utime(rollout,(2,2))
db.commit();db.close()
`;
  execFileSync(
    "python3",
    [
      "-c",
      script,
      runtime.appServerDataDir,
      JSON.stringify(ids),
      parent ?? "",
      child ?? "",
    ],
    { encoding: "utf8", stdio: "pipe" },
  );
};

try {
  await ensureElectronFixtureBuild({
    rootDir: process.cwd(),
    logPrefix: "settings-storage",
  });
  runtime = createTempRuntimeEnv();
  summary.tempRoot = runtime.tempRoot;
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
  let page = await launch();
  await measured();
  const initial = await call("storage/read");
  check(
    "injectedAgentRoot",
    initial.usage.dataRoot === fs.realpathSync(runtime.appServerDataDir),
  );
  check(
    "realNonnegativeCapacity",
    initial.status === "ready" && initial.usage.totalBytes > 0,
  );
  const ids = {};
  for (const name of [
    "Storage root",
    "Storage child",
    "Storage changed",
    "Storage recent",
  ]) {
    const thread = (
      await call("thread/start", {
        model: "fixture-model",
        modelProvider: "fixture-provider",
        cwd: runtime.tempRoot,
      })
    ).thread;
    await call("thread/name/set", { threadId: thread.id, name });
    await call("thread/archive", { threadId: thread.id });
    ids[name] = thread.id;
  }
  seedAges(
    [ids["Storage root"], ids["Storage child"], ids["Storage changed"]],
    ids["Storage root"],
    ids["Storage child"],
  );
  await page
    .locator("#storage-usage")
    .getByRole("button", { name: "刷新", exact: true })
    .click();
  await measured();
  const review = await call("storage/review", { days: 90, archivedOnly: true });
  check(
    "completeSubtreeReview",
    review.candidates.length === 2 &&
      review.candidates.some(
        (entry) =>
          entry.root.threadId === ids["Storage root"] &&
          entry.descendants.length === 1,
      ),
  );
  check(
    "recentExcluded",
    review.candidates.every(
      (entry) => entry.root.threadId !== ids["Storage recent"],
    ),
  );
  await appearance("浅色");
  await screenshot("light");
  await page.getByRole("button", { name: "审阅", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Storage root", { exact: true }).waitFor();
  check(
    "defaultNinetyDays",
    (await dialog.getByRole("combobox").first().inputValue()) === "90",
  );
  check(
    "defaultArchivedOnly",
    (await dialog.getByRole("combobox").nth(1).inputValue()) === "archived",
  );
  await screenshot("review");
  await dialog.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("alertdialog").waitFor();
  await screenshot("confirm");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  check(
    "cancelKeepsCanonicalRoot",
    (
      await call("thread/read", {
        threadId: ids["Storage root"],
        includeTurns: false,
      })
    ).thread.id === ids["Storage root"],
  );
  await page.waitForFunction(
    () => document.activeElement?.textContent === "继续",
  );
  check("confirmationCancelRestoresFocus", true);
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      document.activeElement ===
      document.querySelector("#storage-cleanup button"),
  );
  check("reviewEscapeRestoresFocus", true);
  await page.getByRole("button", { name: "审阅", exact: true }).click();
  await dialog.getByText("Storage root", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "继续", exact: true }).click();
  await call("thread/name/set", {
    threadId: ids["Storage changed"],
    name: "Changed after review",
  });
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "永久删除", exact: true })
    .click();
  await dialog
    .getByText("已删除 1 个，已跳过 1 个，失败 0 个。", { exact: true })
    .waitFor();
  check("resultsVisible", true);
  await screenshot("result");
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await measured();
  const archived = await call("thread/list", { archived: true, limit: 100 });
  check(
    "sameCanonicalSubtreeDeleted",
    !archived.data.some((entry) =>
      [ids["Storage root"], ids["Storage child"]].includes(entry.id),
    ),
  );
  check(
    "changedAndRecentKept",
    archived.data.some((entry) => entry.id === ids["Storage changed"]) &&
      archived.data.some((entry) => entry.id === ids["Storage recent"]),
  );
  await page
    .locator("#storage-worktrees")
    .getByRole("button", { name: "管理", exact: true })
    .click();
  await page.locator("#worktrees-root-input").waitFor();
  check("worktreesNavigation", true);
  await page.getByTestId("settings-sidebar-tab-storage").click();
  await page
    .locator("#storage-archived")
    .getByRole("button", { name: "管理", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Archived chats", exact: true })
    .waitFor();
  check("archivedNavigation", true);
  await page.getByTestId("settings-sidebar-tab-storage").click();
  await measured();
  await appearance("深色");
  await screenshot("dark");
  await page.setViewportSize({ width: 900, height: 760 });
  await screenshot("narrow");
  await close();
  page = await launch();
  await measured();
  const cold = await call("thread/list", { archived: true, limit: 100 });
  check(
    "coldRestartKeepsDeletion",
    !cold.data.some((entry) =>
      [ids["Storage root"], ids["Storage child"]].includes(entry.id),
    ) && cold.data.some((entry) => entry.id === ids["Storage changed"]),
  );
  await close();
  summary.trace = summarizeSettingsAppearanceTrace(traces);
  check(
    "realElectronAndPreload",
    summary.launches.length === 2 &&
      summary.launches.every(
        (entry) => entry.electron && entry.hasInvokeBridge,
      ),
  );
  check("currentIpcObserved", summary.trace.appServerIpcHitCount > 0);
  check(
    "storageUiMethodsObserved",
    [
      "storage/read",
      "storage/refresh",
      "storage/review",
      "storage/delete",
    ].every((method) => summary.trace.methods.includes(method)),
  );
  check(
    "noProductionMockOrLegacy",
    summary.trace.mockFallbackHitCount === 0 &&
      summary.trace.legacyCommands.length === 0 &&
      traces
        .flatMap(parseInvokeTraceRaw)
        .every((entry) => !entry.command?.startsWith("agent_runtime_")),
  );
  check(
    "noInvokeErrors",
    invokeErrors.every((raw) => parseInvokeTraceRaw(raw).length === 0),
  );
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
}
