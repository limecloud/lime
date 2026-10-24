import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
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
  createTempRuntimeEnv,
  launchElectronFixture,
  appServerCallFromPage,
  openSettings,
} from "../mcp-config-fixture-smoke.mjs";
import { reloadRendererDocument } from "../../agent-runtime/claw-chat-current-fixture-rpc.mjs";
import { captureMainProcessExit } from "./persisted-atom-fixture-driver.mjs";
import { settleFixtureResources } from "../../agent-runtime/claw-chat-current-fixture-teardown.mjs";
import {
  parseSettingsAppearanceFixtureArgs,
  summarizeSettingsAppearanceTrace,
} from "./settings-appearance-fixture-evidence.mjs";
import {
  isObservedPreloadAppServerResponse,
  parseJsonRpcRequestsFromInvokeTrace,
} from "./mcp-config-fixture-evidence.mjs";
import { artifactFingerprints } from "./settings-navigation-fixture-identity.mjs";

const options = parseSettingsAppearanceFixtureArgs(process.argv.slice(2), {
  defaults: {
    prefix: "local-conversation-actions",
    runId: null,
    evidenceDir: null,
    timeoutMs: 120000,
    intervalMs: 250,
    keepTemp: false,
  },
});
if (options.help) {
  console.log(
    "node scripts/electron/lib/local-conversation-actions-fixture.mjs --run-id <id> --evidence-dir <path>",
  );
  process.exit(0);
}
fs.mkdirSync(options.evidenceDir, { recursive: true });
const sources = [
  "src/components/agent/chat/workspace/LocalConversationActions.tsx",
  "src/components/agent/chat/workspace/localConversationActionHelpers.ts",
  "src/components/agent/chat/workspace/useLocalConversationEnvironment.ts",
  "src/components/agent/chat/workspace/useWorkspaceRightSurfaceHostRuntime.ts",
  "src/components/agent/chat/workspace/useWorkspaceRightSurfaceCoordinatorRuntime.ts",
  "src/components/agent/chat/workspace/useWorkspaceRightSurfaceLocalStateRuntime.ts",
  "src/components/agent/chat/workspace/WorkspaceRightSurfaceHostRuntime.tsx",
  "src/components/agent/chat/workspace/right-surface/threadSidePanelTabs.ts",
  "src/components/agent/chat/components/TerminalPanel.tsx",
  "src/components/agent/chat/components/TerminalTab.tsx",
  "src/lib/api/projectGit.ts",
  "src/lib/api/commandExec.ts",
  "src/lib/api/appServerEventBus.ts",
  "packages/app-server-client/src/protocol.ts",
  "packages/app-server-client/src/generated/protocol-types.ts",
  "lime-rs/crates/services/src/project_git_service.rs",
  "lime-rs/crates/services/src/project_git_service/status.rs",
  "lime-rs/crates/app-server-protocol/src/protocol/v0/project_git.rs",
  "lime-rs/crates/app-server/src/runtime/service_projection.rs",
  "scripts/electron/lib/local-conversation-actions-fixture.mjs",
  ...["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"].map(
    (locale) => `src/i18n/resources/${locale}/agent.json`,
  ),
];
const fingerprints = () =>
  Object.fromEntries(
    sources.map((file) => [
      file,
      createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
    ]),
  );
const summary = {
  schemaVersion: 1,
  runId: options.runId,
  result: "fail",
  startedAt: new Date().toISOString(),
  proofLevel: "Desktop Gate B controlled fixture",
  claimBoundary:
    "Real Electron/preload/IPC/App Server Git-scoped environment selection and configuration read, canonical empty Thread navigation, real local command/exec output/exit/termination and GUI action/terminal identity. Agent backend unavailable; no Turn/provider execution, setup environment inheritance, recent ordering, Windows native or full-settings claim.",
  assertions: {},
  consoleErrors: [],
  pageErrors: [],
  receipts: [],
};
let handle, mainExit, runtime, failure, trace;
const check = (name, value) => {
  summary.assertions[name] = Boolean(value);
  assert.ok(value, name);
};
const stage = (name) => {
  summary.stage = name;
  console.log(`[local-actions] ${name}`);
};
async function rpc(method, params) {
  const response = await appServerCallFromPage(handle.page, method, params);
  check(
    `preload-${method}`,
    isObservedPreloadAppServerResponse(response.ipcObservation, method),
  );
  assert.ok(!response.error, `${method}: ${JSON.stringify(response.error)}`);
  summary.receipts.push({ method, ipcObservation: response.ipcObservation });
  return response.result;
}
function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}
async function openConversation(sessionId) {
  await reloadRendererDocument(handle.page, options);
  await handle.page
    .locator(
      `[data-testid="app-sidebar-conversation-open"][data-session-id="${sessionId}"]`,
    )
    .click();
  await handle.page
    .locator(
      `[data-testid="thread-workspace-header"][data-session-id="${sessionId}"]`,
    )
    .waitFor({ state: "visible" });
  await handle.page
    .getByTestId("local-conversation-actions")
    .waitFor({ state: "visible" });
}
async function waitTerminalOutput(marker) {
  try {
    await handle.page.waitForFunction(
      (value) =>
        [...document.querySelectorAll('[data-testid="terminal-tab"]')].some(
          (node) =>
            node.getBoundingClientRect().width > 0 &&
            node.querySelector(".xterm-rows")?.textContent.includes(value),
        ),
      marker,
      { timeout: options.timeoutMs },
    );
  } catch (error) {
    summary.terminalFailure = await handle.page
      .getByTestId("terminal-tab")
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          sessionId: node.dataset.sessionId,
          exitCode: node.dataset.exitCode,
          text: node.querySelector(".xterm-rows")?.textContent,
          alert: node.querySelector('[role="alert"]')?.textContent,
        })),
      );
    throw new Error(
      `Terminal output missing ${JSON.stringify(marker)}: ${JSON.stringify(summary.terminalFailure)}`,
      { cause: error },
    );
  }
}
async function readTerminalSurface(terminal) {
  return terminal.evaluate((node) => {
    const viewport = node.querySelector(".xterm-viewport");
    const screen = node.querySelector(".xterm-scrollable-element");
    const panel = node.querySelector('[data-testid="terminal-panel"]');
    return {
      viewportBackground: getComputedStyle(viewport).backgroundColor,
      panelBackground: getComputedStyle(panel).backgroundColor,
      viewportHeight: viewport.getBoundingClientRect().height,
      screenHeight: screen.getBoundingClientRect().height,
    };
  });
}
try {
  stage("build-current-original-repository");
  summary.sourceBeforeBuild = fingerprints();
  await ensureElectronFixtureBuild({
    rootDir: process.cwd(),
    logPrefix: "local-actions",
  });
  summary.sourceBefore = fingerprints();
  check(
    "stableBuildSources",
    JSON.stringify(summary.sourceBeforeBuild) ===
      JSON.stringify(summary.sourceBefore),
  );
  summary.artifactsBefore = artifactFingerprints();
  check(
    "freshBuild",
    inspectElectronFixtureBuildFreshness({ rootDir: process.cwd() }).ready,
  );
  runtime = createTempRuntimeEnv();
  const source = path.join(runtime.tempRoot, "source"),
    worktree = path.join(runtime.tempRoot, "worktree");
  fs.mkdirSync(path.join(source, "packages/app"), { recursive: true });
  fs.writeFileSync(
    path.join(source, "packages/app/README.md"),
    "Actions fixture\n",
  );
  git(source, "init", "--template=", "--initial-branch=main");
  git(source, "add", ".");
  git(
    source,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@localhost",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "Fixture",
  );
  git(source, "worktree", "add", "--detach", worktree);
  const cwd = fs.realpathSync(path.join(worktree, "packages/app"));
  const configPath = path.join(cwd, ".codex/environments/environment.toml");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    `version=1\nname='Actions fixture'\n[setup]\nscript=''\n[[actions]]\nname='Verify cwd and exit'\nicon='test'\ncommand='''printf 'ACTION_OUTPUT:%s\\n' 'real-process'; pwd; exit 7'''\n[[actions]]\nname='Long running action'\nicon='run'\ncommand='''printf 'ACTION_RUNNING:%s\\n' 'real-process'; sleep 60'''\n[[actions]]\nname='Windows only action'\nplatform='win32'\ncommand='echo Windows'\n`,
  );
  git(
    worktree,
    "config",
    "--file",
    git(worktree, "rev-parse", "--git-path", "config.worktree"),
    "codex.localEnvironmentConfigPath",
    configPath,
  );
  const appServerEnv = resolveElectronAppServerRuntimeEnv({
    env: {
      ...runtime.env,
      APP_SERVER_BIN: electronAppServerBinaryDestination({
        outputRoot: path.resolve("dist-electron"),
      }),
    },
    repoRoot: process.cwd(),
  });
  stage("launch-real-electron");
  handle = await launchElectronFixture({
    options,
    runtimeEnv: runtime,
    appServerEnv,
    consoleErrors: summary.consoleErrors,
    pageErrors: summary.pageErrors,
    backendMode: "unavailable",
  });
  mainExit = captureMainProcessExit(handle.app.process());
  handle.page.setDefaultTimeout(Math.min(options.timeoutMs, 30000));
  check(
    "realElectronAndPreload",
    handle.rendererSnapshot.electron && handle.rendererSnapshot.hasInvokeBridge,
  );
  await rpc("workspace/ensure", { rootPath: cwd, name: "Actions fixture" });
  const thread = (
    await rpc("thread/start", {
      cwd,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
    })
  ).thread;
  summary.identity = {
    threadId: thread.id,
    sessionId: thread.sessionId,
    cwd,
    configPath,
  };
  await rpc("thread/name/set", {
    threadId: thread.id,
    name: "Actions fixture conversation",
  });
  stage("navigate-canonical-conversation");
  await openConversation(thread.sessionId);
  const status = await rpc("projectGit/status", { rootPath: cwd });
  check(
    "gitScopeSelection",
    status.isWorktree && status.localEnvironmentConfigPath === configPath,
  );
  const read = (
    await rpc("thread/read", { threadId: thread.id, includeTurns: true })
  ).thread;
  check(
    "canonicalCwd",
    read.id === thread.id && fs.realpathSync(read.cwd) === cwd,
  );
  await handle.page
    .getByTestId("local-conversation-primary-action")
    .waitFor({ state: "visible" });
  stage("run-real-action");
  await handle.page.getByTestId("local-conversation-actions").click();
  await handle.page
    .getByTestId("local-conversation-action")
    .filter({ hasText: "Verify cwd and exit" })
    .waitFor();
  check(
    "platformFiltered",
    !(await handle.page
      .getByRole("menuitem", { name: "Windows only action" })
      .count()),
  );
  summary.menuFont = await handle.page
    .getByTestId("local-conversation-action")
    .first()
    .evaluate((node) => getComputedStyle(node).fontSize);
  check("menuFont13", summary.menuFont === "13px");
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, "actions-menu.png"),
    animations: "disabled",
  });
  await handle.page
    .getByTestId("local-conversation-action")
    .filter({ hasText: "Verify cwd and exit" })
    .click();
  await waitTerminalOutput("ACTION_OUTPUT:real-process");
  const terminal = handle.page.locator('[data-testid="terminal-tab"]:visible');
  await terminal.locator('[data-testid="terminal-xterm"]').waitFor();
  await handle.page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-testid="terminal-tab"]')].some(
        (node) => node.dataset.exitCode === "7",
      ),
    null,
    { timeout: options.timeoutMs },
  );
  await waitTerminalOutput(cwd);
  summary.firstTerminalOutput = await terminal
    .locator(".xterm-rows")
    .textContent();
  check("realOutputAndCwd", summary.firstTerminalOutput.includes(cwd));
  summary.firstTerminalId = await terminal.getAttribute("data-session-id");
  summary.terminalSurface = await readTerminalSurface(terminal);
  check(
    "terminalSurfaceTheme",
    summary.terminalSurface.viewportBackground ===
      summary.terminalSurface.panelBackground,
  );
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, "actions-exit.png"),
    animations: "disabled",
  });
  stage("terminate-running-action");
  await handle.page.getByTestId("local-conversation-actions").click();
  await handle.page
    .getByTestId("local-conversation-action")
    .filter({ hasText: "Long running action" })
    .click();
  await waitTerminalOutput("ACTION_RUNNING:real-process");
  const activeTab = handle.page.locator(
    '[data-testid="workspace-right-surface-tab-shell"][aria-selected="true"]',
  );
  check(
    "independentActionTabs",
    (await handle.page
      .getByTestId("workspace-right-surface-tab-shell")
      .count()) === 2,
  );
  await activeTab
    .locator("..")
    .getByTestId("workspace-right-surface-tab-close")
    .click();
  check(
    "survivingTerminalIdentity",
    (await handle.page
      .locator('[data-testid="terminal-tab"]:visible')
      .getAttribute("data-session-id")) === summary.firstTerminalId,
  );
  stage("configuration-deep-link");
  await handle.page.getByTestId("local-conversation-actions").click();
  await handle.page
    .getByRole("menuitem", { name: /配置操作|Configure actions/ })
    .click();
  await handle.page.getByTestId("settings-content").waitFor();
  const editor = handle.page.locator(
    '[data-testid="local-environment-editor"][aria-busy="false"]',
  );
  await editor.waitFor({ state: "visible" });
  check(
    "selectedConfigDeepLink",
    (await editor.locator("input").first().inputValue()) ===
      "Actions fixture" &&
      (
        await editor
          .locator("input")
          .evaluateAll((nodes) => nodes.map((node) => node.value))
      ).includes("Long running action"),
  );
  const tabs = await handle.page
    .locator('[data-testid^="settings-sidebar-tab-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.testid));
  check("aboutLast", tabs.at(-1) === "settings-sidebar-tab-about");
  for (const mode of ["light", "dark"]) {
    stage(`appearance-${mode}-900`);
    await handle.page.getByTestId("settings-sidebar-tab-appearance").click();
    await handle.page
      .locator(`[role="radio"]:has([data-mode="${mode}"])`)
      .click();
    await handle.page.waitForFunction(
      (mode) =>
        document.documentElement.classList.contains("dark") ===
        (mode === "dark"),
      mode,
    );
    await handle.page.getByTestId("settings-back-button").click();
    await handle.page
      .getByTestId("local-conversation-actions")
      .waitFor({ state: "visible" });
    await handle.page.setViewportSize({ width: 900, height: 900 });
    await handle.page.getByTestId("local-conversation-actions").click();
    await handle.page
      .getByTestId("local-conversation-action")
      .first()
      .waitFor();
    check(
      `noOverflow-${mode}`,
      await handle.page.getByRole("menu").evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return (
          rect.left >= 0 &&
          rect.right <= innerWidth + 1 &&
          document.documentElement.scrollWidth <= innerWidth + 1
        );
      }),
    );
    await handle.page.screenshot({
      path: path.join(options.evidenceDir, `actions-${mode}-900.png`),
      animations: "disabled",
    });
    await handle.page
      .getByTestId("local-conversation-action")
      .filter({ hasText: "Verify cwd and exit" })
      .click();
    await waitTerminalOutput("ACTION_OUTPUT:real-process");
    await waitTerminalOutput(cwd);
    const visibleTerminal = handle.page.locator(
      '[data-testid="terminal-tab"]:visible',
    );
    const surface = await readTerminalSurface(visibleTerminal);
    summary[`terminalSurface-${mode}`] = surface;
    check(
      `terminalSurfaceTheme-${mode}`,
      surface.viewportBackground === surface.panelBackground,
    );
    await handle.page.screenshot({
      path: path.join(options.evidenceDir, `terminal-${mode}-900.png`),
      animations: "disabled",
    });
    if (mode === "light") await openSettings(handle.page, options);
  }
  trace = await handle.page.evaluate(() =>
    localStorage.getItem("lime_invoke_trace_buffer_v1"),
  );
  const requests = parseJsonRpcRequestsFromInvokeTrace(trace);
  const successes = requests.filter(
    (entry) => entry.transport === "electron-ipc" && entry.status === "success",
  );
  check(
    "realCommandExec",
    successes.some(
      (entry) =>
        entry.method === "command/exec" &&
        entry.params.cwd === cwd &&
        entry.params.command?.includes(
          "printf 'ACTION_OUTPUT:%s\\n' 'real-process'; pwd; exit 7",
        ),
    ),
  );
  check(
    "realTermination",
    successes.some((entry) => entry.method === "command/exec/terminate"),
  );
  summary.trace = summarizeSettingsAppearanceTrace(trace);
  check("noMockFallback", summary.trace.mockFallbackHitCount === 0);
  check("noPageErrors", summary.pageErrors.length === 0);
  check("noConsoleErrors", summary.consoleErrors.length === 0);
  summary.result = "pass";
} catch (error) {
  failure = error;
  summary.error = String(error?.stack ?? error);
  console.error(summary.error);
  if (handle)
    await handle.page
      .screenshot({
        path: path.join(options.evidenceDir, "failed.png"),
        animations: "disabled",
      })
      .catch(() => undefined);
} finally {
  if (handle) {
    if (!trace)
      trace = await handle.page
        .evaluate(() => localStorage.getItem("lime_invoke_trace_buffer_v1"))
        .catch(() => null);
    summary.teardown = await settleFixtureResources({
      app: handle.app,
      mainExit,
    });
    if (
      !summary.teardown.ok ||
      summary.teardown.forcedCleanup !== null ||
      summary.teardown.normalMainExit?.exitCode !== 0
    ) {
      summary.result = "fail";
      summary.normalQuitFailed = true;
    }
  }
  summary.sourceAfter = fingerprints();
  summary.artifactsAfter = artifactFingerprints();
  summary.sourceStable =
    JSON.stringify(summary.sourceBefore) ===
    JSON.stringify(summary.sourceAfter);
  summary.artifactsStable =
    JSON.stringify(summary.artifactsBefore) ===
    JSON.stringify(summary.artifactsAfter);
  if (!summary.sourceStable || !summary.artifactsStable)
    summary.result = "fail";
  summary.finishedAt = new Date().toISOString();
  summary.tempRoot = runtime?.tempRoot ?? null;
  fs.writeFileSync(
    path.join(options.evidenceDir, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(options.evidenceDir, "invoke-trace.json"),
    trace || "[]",
  );
  if (summary.result !== "pass" || failure) process.exitCode = 1;
}
