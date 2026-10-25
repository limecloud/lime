import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parse } from "smol-toml";
import { parseJsonRpcRequestsFromInvokeTrace } from "./mcp-config-fixture-evidence.mjs";
import { summarizeSettingsAppearanceTrace } from "./settings-appearance-fixture-evidence.mjs";

/** Real toolbar dialogs, CAS, selection and command owner; no renderer API substitution. */
export async function runLocalEnvironmentDialogsScenario({
  source,
  tempRoot,
  git,
  options,
  summary,
  rpc,
  check,
  waitTerminalOutput,
  getHandle,
  openConversation,
  restart,
}) {
  const project = path.join(tempRoot, "toolbar-project");
  git(source, "worktree", "add", "--detach", project);
  const cwd = fs.realpathSync(path.join(project, "packages/app"));
  const configPath = path.join(cwd, ".lime/environments/environment.toml");
  let handle = getHandle();
  await handle.page.setViewportSize({ width: 900, height: 900 });
  await rpc("workspace/ensure", { rootPath: cwd, name: "Toolbar dialogs" });
  const { thread } = await rpc("thread/start", {
    cwd,
    approvalPolicy: "never",
    sandbox: "danger-full-access",
  });
  await rpc("thread/name/set", {
    threadId: thread.id,
    name: "Toolbar dialogs fixture",
  });
  await openConversation(thread.sessionId);
  const initial = await rpc("projectGit/status", { rootPath: cwd });
  check(
    "toolbarProjectInitiallyUnconfigured",
    initial.isWorktree &&
      initial.localEnvironmentConfigPath == null &&
      !fs.existsSync(configPath),
  );
  await handle.page.getByTestId("local-conversation-actions").click();
  await handle.page.getByTestId("local-conversation-add-action").click();
  const setup = handle.page.getByTestId("local-environment-setup-dialog");
  await setup.waitFor({ state: "visible" });
  const setupInput = setup.getByRole("textbox", {
    name: /^(设置脚本|Setup script)$/,
  });
  check(
    "toolbarSetupInitialFocus",
    await setupInput.evaluate((node) => node === document.activeElement),
  );
  const setupCommand =
    "printf 'PROJECT_SETUP_OUTPUT:%s\\n' 'real-process'; pwd";
  await setupInput.fill(setupCommand);
  await setup
    .getByRole("button", {
      name: /关闭创建本地环境|Close create local environment/,
    })
    .click();
  const discard = handle.page.getByRole("alertdialog");
  await discard.waitFor({ state: "visible" });
  await discard.getByRole("button", { name: /继续编辑|Keep editing/ }).click();
  await discard.waitFor({ state: "hidden" });
  check(
    "toolbarSetupDraftRetained",
    (await setupInput.inputValue()) === setupCommand,
  );
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, "toolbar-project-setup.png"),
    animations: "disabled",
  });
  await setup
    .getByRole("button", { name: /^(设置项目|Set up project)$/ })
    .click();
  await setup.waitFor({ state: "hidden" });
  await waitTerminalOutput("PROJECT_SETUP_OUTPUT:real-process");
  await waitTerminalOutput(cwd);
  const setupEnvironment = parse(fs.readFileSync(configPath, "utf8"));
  check(
    "toolbarSetupSavedScript",
    setupEnvironment.setup.script === setupCommand,
  );
  const selected = await rpc("projectGit/status", { rootPath: cwd });
  check(
    "toolbarSetupSelectedGitScope",
    selected.localEnvironmentConfigPath === configPath,
  );
  const { thread: projected } = await rpc("thread/read", {
    threadId: thread.id,
    includeTurns: true,
  });
  check(
    "toolbarSetupCanonicalThread",
    projected.id === thread.id && fs.realpathSync(projected.cwd) === cwd,
  );

  async function openAction() {
    await handle.page.getByTestId("local-conversation-actions").click();
    await handle.page.getByTestId("local-conversation-add-action").click();
    const modal = handle.page.getByTestId("local-environment-action-dialog");
    await modal.waitFor({ state: "visible" });
    return modal;
  }
  async function requests() {
    const raw = await handle.page.evaluate(() =>
      localStorage.getItem("lime_invoke_trace_buffer_v1"),
    );
    return parseJsonRpcRequestsFromInvokeTrace(raw).filter(
      (entry) =>
        entry.transport === "electron-ipc" && entry.status === "success",
    );
  }
  let modal = await openAction();
  await modal
    .getByRole("textbox", { name: /操作名称|Action name/ })
    .fill("Must not run conflict");
  await modal
    .getByRole("textbox", { name: /要运行的命令|Command to run/ })
    .fill("printf TOOLBAR_CONFLICT_MUST_NOT_RUN");
  const externalRaw =
    fs.readFileSync(configPath, "utf8") + "\n# Concurrent fixture edit\n";
  fs.writeFileSync(configPath, externalRaw);
  await modal.getByRole("button", { name: /^(保存|Save)$/ }).click();
  await modal.waitFor({ state: "hidden" });
  await handle.page
    .getByText(/环境文件已在磁盘上更改|This environment changed on disk/, {
      exact: false,
    })
    .waitFor({ state: "visible" });
  check(
    "toolbarConflictPreservedExternalFile",
    fs.readFileSync(configPath, "utf8") === externalRaw,
  );
  check(
    "toolbarConflictDidNotExecute",
    !(await requests()).some(
      (entry) =>
        entry.method === "command/exec" &&
        entry.params.command?.some((part) =>
          part.includes("TOOLBAR_CONFLICT_MUST_NOT_RUN"),
        ),
    ),
  );
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, "toolbar-action-conflict.png"),
    animations: "disabled",
  });

  modal = await openAction();
  const nameInput = modal.getByRole("textbox", {
    name: /操作名称|Action name/,
  });
  check(
    "toolbarAddActionInitialFocus",
    await nameInput.evaluate((node) => node === document.activeElement),
  );
  await nameInput.fill(" Toolbar saved action ");
  const actionCommand =
    "printf 'TOOLBAR_ACTION_OUTPUT:%s\\n' 'real-process'; pwd; exit 9";
  await modal
    .getByRole("textbox", { name: /要运行的命令|Command to run/ })
    .fill(" " + actionCommand + " ");
  await modal.getByRole("button", { name: /^(图标|Icon)$/ }).click();
  await handle.page.getByRole("menuitem", { name: /^(测试|Test)$/ }).click();
  const metrics = await modal.evaluate((node) => ({
    width: node.getBoundingClientRect().width,
    titleFont: getComputedStyle(node.querySelector("h2")).fontSize,
    inputFont: getComputedStyle(node.querySelector("input")).fontSize,
  }));
  check(
    "toolbarDialogDesktopTypography",
    metrics.width === 379 &&
      metrics.titleFont === "18px" &&
      metrics.inputFont === "13px",
  );
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, "toolbar-add-action.png"),
    animations: "disabled",
  });
  await modal.getByRole("button", { name: /^(保存|Save)$/ }).click();
  await modal.waitFor({ state: "hidden" });
  await waitTerminalOutput("TOOLBAR_ACTION_OUTPUT:real-process");
  await waitTerminalOutput(cwd);
  await handle.page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-testid="terminal-tab"]')].some(
        (node) =>
          node.getBoundingClientRect().width > 0 &&
          node.dataset.exitCode === "9",
      ),
    null,
    { timeout: options.timeoutMs },
  );
  const added = parse(fs.readFileSync(configPath, "utf8"));
  assert.deepEqual(added.actions, [
    { name: "Toolbar saved action", command: actionCommand, icon: "test" },
  ]);
  assert.deepEqual(added.setup, setupEnvironment.setup);
  check(
    "toolbarActionSavedPreservingSetup",
    added.version === setupEnvironment.version,
  );
  const actionsTrace = await requests();
  check(
    "toolbarCreateUsedCreateOnlyCas",
    actionsTrace.some(
      (entry) =>
        entry.method === "localEnvironments/saveConfig" &&
        entry.params.configPath === configPath &&
        entry.params.expectedRevision === null,
    ),
  );
  check(
    "toolbarActionUsedRevisionCas",
    actionsTrace.some(
      (entry) =>
        entry.method === "localEnvironments/saveConfig" &&
        entry.params.configPath === configPath &&
        typeof entry.params.expectedRevision === "string" &&
        parse(entry.params.raw).actions?.some(
          (action) => action.command === actionCommand,
        ),
    ),
  );
  check(
    "toolbarSelectionUsedCurrentMethod",
    actionsTrace.some(
      (entry) =>
        entry.method === "projectGit/worktree/environment/set" &&
        entry.params.configPath === configPath,
    ),
  );
  check(
    "toolbarActionUsedExistingCommandOwner",
    actionsTrace.some(
      (entry) =>
        entry.method === "command/exec" &&
        entry.params.cwd === cwd &&
        entry.params.command?.includes(actionCommand),
    ),
  );

  const beforeColdRaw = await handle.page.evaluate(() =>
    localStorage.getItem("lime_invoke_trace_buffer_v1"),
  );
  fs.writeFileSync(
    path.join(options.evidenceDir, "toolbar-dialogs-invoke-trace.json"),
    beforeColdRaw || "[]",
  );
  const traceBeforeCold = summarizeSettingsAppearanceTrace(beforeColdRaw);
  check(
    "toolbarDialogsBeforeColdNoMockFallback",
    traceBeforeCold.mockFallbackHitCount === 0,
  );
  const exit = await restart();
  check(
    "toolbarDialogsNormalMainExit",
    exit.exitCode === 0 && exit.signal == null,
  );
  handle = getHandle();
  await openConversation(thread.sessionId);
  const primary = handle.page.getByTestId("local-conversation-primary-action");
  await primary.waitFor({ state: "visible" });
  await handle.page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="local-conversation-primary-action"]')
        ?.getAttribute("aria-label")
        ?.includes("Toolbar saved action"),
    null,
    { timeout: options.timeoutMs },
  );
  await primary.click();
  await waitTerminalOutput("TOOLBAR_ACTION_OUTPUT:real-process");
  await waitTerminalOutput(cwd);
  await handle.page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-testid="terminal-tab"]')].some(
        (node) =>
          node.getBoundingClientRect().width > 0 &&
          node.dataset.exitCode === "9",
      ),
    null,
    { timeout: options.timeoutMs },
  );
  const coldRequests = await requests();
  check(
    "toolbarColdActionStartedRealProcess",
    coldRequests.some(
      (entry) =>
        entry.method === "command/exec" &&
        entry.params.cwd === cwd &&
        entry.params.command?.includes(actionCommand),
    ),
  );
  const { thread: coldThread } = await rpc("thread/read", {
    threadId: thread.id,
    includeTurns: true,
  });
  check(
    "toolbarDialogsColdCanonicalIdentity",
    coldThread.id === thread.id && fs.realpathSync(coldThread.cwd) === cwd,
  );
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, "toolbar-action-cold-restart.png"),
    animations: "disabled",
  });
  const rawTrace = await handle.page.evaluate(() =>
    localStorage.getItem("lime_invoke_trace_buffer_v1"),
  );
  const trace = summarizeSettingsAppearanceTrace(rawTrace);
  fs.writeFileSync(
    path.join(options.evidenceDir, "toolbar-dialogs-cold-invoke-trace.json"),
    rawTrace || "[]",
  );
  check("toolbarDialogsNoMockFallback", trace.mockFallbackHitCount === 0);
  check(
    "toolbarDialogsNoPageErrors",
    summary.pageErrors.length === 0 && summary.consoleErrors.length === 0,
  );
  summary.toolbarDialogs = {
    threadId: thread.id,
    sessionId: thread.sessionId,
    cwd,
    configPath,
    metrics,
    normalMainExit: exit,
    traceBeforeCold,
    trace,
  };
}
