import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ensureElectronFixtureBuild } from "../../lib/electron-fixture-build.mjs";
import { resolveElectronAppServerRuntimeEnv } from "../../lib/electron-app-server-assets.mjs";
import { resolveDevAppServerBinary } from "../../lib/electron-dev-sidecar.mjs";
import { writeJsonFile } from "../../mcp/lib/current-smoke-transport.mjs";
import {
  parseProjectDirectoryGateArgs,
  sanitizeProjectDirectoryFailure,
} from "../project-directory-gate-b.mjs";
import {
  parseInvokeTraceRaw,
  parseJsonRpcRequestsFromInvokeTrace,
} from "./mcp-config-fixture-evidence.mjs";
import {
  appServerCallFromPage,
  closeElectronFixture,
  createTempRuntimeEnv,
  launchElectronFixture,
  waitForPageCondition,
} from "../mcp-config-fixture-smoke.mjs";

const LOG_PREFIX = "[smoke:composer-utility-gate-b]";
const REQUIRED_METHODS = [
  "projectGit/status",
  "project/git/branch/create",
  "projectGit/branch/checkout",
];
const BRANCH = "utility-gate-created";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function summarizeComposerUtilityEvidence({
  traceRaw,
  errorRaw,
  rootPath,
  stages,
  readbackBranch,
}) {
  const requests = parseJsonRpcRequestsFromInvokeTrace(traceRaw);
  const gitRequests = requests.filter((request) =>
    REQUIRED_METHODS.includes(request.method),
  );
  const current = gitRequests.filter(
    (request) =>
      request.transport === "electron-ipc" &&
      request.status === "success" &&
      request.command === "app_server_handle_json_lines" &&
      request.params?.rootPath === rootPath,
  );
  const methods = [...new Set(current.map((request) => request.method))];
  return {
    bridge: {
      missingMethods: REQUIRED_METHODS.filter(
        (method) => !methods.includes(method),
      ),
      gitRequestsMatchRoot:
        gitRequests.length > 0 && gitRequests.length === current.length,
      electronIpcHitCount: current.length,
      mockFallbackHitCount: gitRequests.filter(
        (request) => request.transport !== "electron-ipc",
      ).length,
      methods,
    },
    gui: stages,
    readback: {
      currentBranch: readbackBranch,
      matchesGui: readbackBranch === BRANCH,
    },
    errors: { invokeErrorCount: parseInvokeTraceRaw(errorRaw).length },
  };
}

export function assertComposerUtilityEvidence(evidence) {
  assert(
    evidence.bridge.missingMethods.length === 0,
    `缺少 current Git method: ${evidence.bridge.missingMethods.join(", ")}`,
  );
  assert(
    evidence.bridge.gitRequestsMatchRoot,
    "Git 请求未绑定同一 current workspace root",
  );
  assert(
    evidence.bridge.mockFallbackHitCount === 0,
    "Git 请求命中非 Electron transport",
  );
  for (const stage of [
    "firstProject",
    "secondProject",
    "returnedProject",
    "branchCreated",
    "branchCheckedOut",
    "coldRestore",
  ]) {
    assert(
      evidence.gui?.[stage] === true,
      `UtilityBar GUI stage 未完成: ${stage}`,
    );
  }
  assert(evidence.readback.matchesGui, "真实 Git readback 与 GUI 分支不一致");
  assert(evidence.errors.invokeErrorCount === 0, "观察到 invoke error");
}

// Only the disposable fixture repository receives objects/refs; the source checkout is untouched.
function createGitFixture(root) {
  const git = (args, input) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      input,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
        GIT_AUTHOR_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      },
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  git(["init", "--initial-branch=main"]);
  const tree = git(["mktree"], "");
  const commit = git(["commit-tree", tree], "Utility Gate fixture\n");
  git(["update-ref", "refs/heads/main", commit]);
  return git;
}

async function waitForUtility(page, options, projectId, rootPath, branch) {
  await waitForPageCondition(
    page,
    options,
    ({ projectId, rootPath, branch }) => {
      const bar = Array.from(
        document.querySelectorAll('[data-testid="composer-utility-bar"]'),
      ).find(
        (candidate) =>
          candidate.querySelector('[data-testid="composer-utility-mode"]') &&
          candidate.getAttribute("data-project-id") === projectId &&
          candidate.getAttribute("data-workspace-root") === rootPath,
      );
      if (!bar || bar.getAttribute("data-git-status") !== "ready") return null;
      const label = bar
        .querySelector('[data-testid="composer-utility-branch"]')
        ?.textContent?.trim();
      return (
        (!branch || label === branch) &&
        bar.getAttribute("aria-busy") === "false"
      );
    },
    `UtilityBar project/root/branch 未就绪 (${branch || "project"})`,
    { projectId, rootPath, branch },
  );
}

async function selectProject(page, options, projectId, rootPath, branch) {
  const bar = page
    .locator('[data-testid="composer-utility-bar"]')
    .filter({ has: page.locator('[data-testid="composer-utility-mode"]') });
  await bar.locator('[data-testid="composer-utility-project-trigger"]').click();
  await page
    .locator(
      `[data-testid="composer-utility-opened-project"][data-project-id="${projectId}"]`,
    )
    .click();
  await waitForUtility(page, options, projectId, rootPath, branch);
}

async function run() {
  const options = parseProjectDirectoryGateArgs(process.argv.slice(2), {
    evidenceDir: path.join(
      process.cwd(),
      ".lime/qc/gui-evidence/composer-utility-electron-gate-b",
    ),
    prefix: "codex-gui-alignment-composer",
    timeoutMs: 120_000,
    intervalMs: 250,
    keepTemp: false,
  });
  if (options.help) {
    console.log(
      "Composer Utility Electron Gate B: --evidence-dir <path> --prefix <name> --timeout-ms <ms> --interval-ms <ms> --keep-temp",
    );
    return;
  }
  fs.mkdirSync(options.evidenceDir, { recursive: true });
  const runtimeEnv = createTempRuntimeEnv();
  const roots = ["alpha", "beta"].map((name) =>
    path.join(runtimeEnv.tempRoot, name),
  );
  roots.forEach((root) => fs.mkdirSync(root, { recursive: true }));
  const git = createGitFixture(roots[0]);
  createGitFixture(roots[1]);
  const consoleErrors = [];
  const pageErrors = [];
  const stages = {};
  let handle;
  const summary = {
    schemaVersion: 1,
    scenarioId: "CODEX-ALIGN-composer-utility",
    proofLevel: "Gate B controlled fixture",
    claimBoundary:
      "Real Electron home project selection, Git branch create/checkout and cold restore; no Turn, provider, staged worktree, cloud or remote.",
    backendMode: "unavailable",
    ok: false,
    checkedAt: new Date().toISOString(),
  };
  const stage = (name) => console.log(`${LOG_PREFIX} stage=${name}`);
  try {
    ensureElectronFixtureBuild({
      logPrefix: LOG_PREFIX,
      rootDir: process.cwd(),
    });
    const binary = resolveDevAppServerBinary({
      env: runtimeEnv.env,
      repoRoot: process.cwd(),
      forceBuild: false,
    });
    const appServerEnv = resolveElectronAppServerRuntimeEnv({
      env: { ...runtimeEnv.env, APP_SERVER_BIN: binary },
    });
    summary.appServerBinarySha256 = createHash("sha256")
      .update(fs.readFileSync(binary))
      .digest("hex");
    stage("launch-and-seed");
    handle = await launchElectronFixture({
      options,
      runtimeEnv,
      appServerEnv,
      consoleErrors,
      pageErrors,
    });
    const ids = [];
    for (let index = 0; index < roots.length; index += 1) {
      const response = await appServerCallFromPage(
        handle.page,
        "workspace/ensure",
        {
          name: `Utility Gate ${index === 0 ? "Alpha" : "Beta"}`,
          rootPath: roots[index],
          workspaceType: "general",
        },
      );
      const id = response.result?.workspace?.id;
      assert(typeof id === "string" && id, "workspace/ensure 未返回 identity");
      ids.push(id);
    }
    await handle.page.evaluate((ids) => {
      window.localStorage.setItem(
        "agent_opened_project_ids",
        JSON.stringify(ids),
      );
      window.localStorage.setItem(
        "agent_last_project_id",
        JSON.stringify(ids[0]),
      );
      window.localStorage.setItem("lime.app-sidebar.collapsed", "false");
      window.localStorage.removeItem("lime_invoke_trace_buffer_v1");
      window.localStorage.removeItem("lime_invoke_error_buffer_v1");
    }, ids);
    await handle.page.reload({ waitUntil: "domcontentloaded" });
    await waitForPageCondition(
      handle.page,
      options,
      () =>
        window.__LIME_ELECTRON__ === true &&
        typeof window.electronAPI?.invoke === "function" &&
        Boolean(document.querySelector('[data-testid="app-sidebar"]')),
      "真实 Electron/preload 未就绪",
    );
    stage("select-projects");
    // Fresh-chat initialization intentionally clears the remembered selection.
    // Select Alpha through the GUI instead of treating seeded storage as success.
    await selectProject(handle.page, options, ids[0], roots[0], "main");
    stages.firstProject = true;
    await selectProject(handle.page, options, ids[1], roots[1], "main");
    stages.secondProject = true;
    await selectProject(handle.page, options, ids[0], roots[0], "main");
    stages.returnedProject = true;
    // From this point every required Git request must belong to Alpha.
    await handle.page.evaluate(() => {
      window.localStorage.removeItem("lime_invoke_trace_buffer_v1");
      window.localStorage.removeItem("lime_invoke_error_buffer_v1");
    });
    stage("create-branch");
    const bar = handle.page
      .locator('[data-testid="composer-utility-bar"]')
      .filter({
        has: handle.page.locator('[data-testid="composer-utility-mode"]'),
      });
    await bar.locator('[data-testid="composer-utility-branch"]').click();
    const menu = handle.page.locator(
      '[data-testid="composer-utility-branch-menu"]',
    );
    await menu.locator("input").fill(BRANCH);
    await menu.locator('[data-utility-action="create-branch"]').click();
    await waitForUtility(handle.page, options, ids[0], roots[0], BRANCH);
    assert(
      git(["symbolic-ref", "--short", "HEAD"]) === BRANCH,
      "分支创建未落到真实 Git",
    );
    stages.branchCreated = true;
    stage("checkout-main-and-created");
    for (const branch of ["main", BRANCH]) {
      await bar.locator('[data-testid="composer-utility-branch"]').click();
      await menu.locator(`button[data-branch="${branch}"]`).click();
      await waitForUtility(handle.page, options, ids[0], roots[0], branch);
      assert(
        git(["symbolic-ref", "--short", "HEAD"]) === branch,
        "分支切换未落到真实 Git",
      );
    }
    stages.branchCheckedOut = true;
    const mutationTrace = await handle.page.evaluate(() => ({
      traceRaw: window.localStorage.getItem("lime_invoke_trace_buffer_v1"),
      errorRaw: window.localStorage.getItem("lime_invoke_error_buffer_v1"),
    }));
    stage("cold-restore");
    await closeElectronFixture(handle);
    handle = null;
    handle = await launchElectronFixture({
      options,
      runtimeEnv,
      appServerEnv,
      consoleErrors,
      pageErrors,
    });
    // A fresh chat opens detached; the opened-project directory persists while Git state is re-read.
    await selectProject(handle.page, options, ids[0], roots[0], BRANCH);
    await waitForUtility(handle.page, options, ids[0], roots[0], BRANCH);
    stages.coldRestore = true;
    const observed = await handle.page.evaluate(() => ({
      traceRaw: window.localStorage.getItem("lime_invoke_trace_buffer_v1"),
      errorRaw: window.localStorage.getItem("lime_invoke_error_buffer_v1"),
    }));
    observed.traceRaw = JSON.stringify([
      ...parseInvokeTraceRaw(mutationTrace.traceRaw),
      ...parseInvokeTraceRaw(observed.traceRaw),
    ]);
    observed.errorRaw = JSON.stringify([
      ...parseInvokeTraceRaw(mutationTrace.errorRaw),
      ...parseInvokeTraceRaw(observed.errorRaw),
    ]);
    const evidence = summarizeComposerUtilityEvidence({
      ...observed,
      rootPath: roots[0],
      stages,
      readbackBranch: git(["symbolic-ref", "--short", "HEAD"]),
    });
    assertComposerUtilityEvidence(evidence);
    assert(
      consoleErrors.length === 0 && pageErrors.length === 0,
      "观察到 Electron console/page error",
    );
    await handle.page.screenshot({
      path: path.join(options.evidenceDir, `${options.prefix}.png`),
      fullPage: true,
    });
    Object.assign(summary, evidence, {
      ok: true,
      screenshot: `${options.prefix}.png`,
    });
  } catch (error) {
    summary.failure = sanitizeProjectDirectoryFailure(error, [
      runtimeEnv.tempRoot,
      process.cwd(),
    ]);
    summary.gui = stages;
    await handle?.page
      ?.screenshot({
        path: path.join(options.evidenceDir, `${options.prefix}-failure.png`),
        fullPage: true,
      })
      .catch(() => undefined);
    throw error;
  } finally {
    summary.errors = {
      ...(summary.errors ?? {}),
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
    };
    writeJsonFile(
      path.join(options.evidenceDir, `${options.prefix}-summary.json`),
      summary,
    );
    await closeElectronFixture(handle);
    if (!options.keepTemp)
      fs.rmSync(runtimeEnv.tempRoot, { recursive: true, force: true });
  }
  console.log(`${LOG_PREFIX} passed`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  run().catch((error) => {
    console.error(
      `${LOG_PREFIX} failed: ${sanitizeProjectDirectoryFailure(error)}`,
    );
    process.exitCode = 1;
  });
}
