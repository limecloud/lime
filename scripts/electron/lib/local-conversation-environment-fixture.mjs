import fs from "node:fs";
import path from "node:path";
import { parseJsonRpcRequestsFromInvokeTrace } from "./mcp-config-fixture-evidence.mjs";
import { summarizeSettingsAppearanceTrace } from "./settings-appearance-fixture-evidence.mjs";

/** Real GUI selection plus Git, Host and cold-process evidence; no product mock. */
export async function runEnvironmentSelectionScenario({
  source,
  git,
  otherWorktree,
  cwd,
  alternatePath,
  options,
  summary,
  rpc,
  check,
  waitTerminalOutput,
  getHandle,
  restart,
  openConversation,
}) {
  let handle = getHandle();
  await handle.page.setViewportSize({ width: 900, height: 900 });
  const sourceScope = `local:${fs.realpathSync(path.join(source, "packages/app"))}`;
  const sourceChoice = path.join(
    source,
    "packages/app/.lime/environments/environment.toml",
  );
  fs.mkdirSync(path.dirname(sourceChoice), { recursive: true });
  fs.writeFileSync(
    sourceChoice,
    "name='Source environment'\n[setup]\nscript=''\n[[actions]]\nname='Source action'\ncommand='echo source'\n",
  );
  const sourceSaved = await handle.page.evaluate(
    async ({ sourceScope, sourceChoice }) =>
      window.electronAPI.invoke("persisted_atom_update", {
        key: "local-env-selections-by-workspace",
        mutation: {
          op: "set",
          workspaceKey: sourceScope,
          configPath: sourceChoice,
        },
      }),
    { sourceScope, sourceChoice },
  );
  check("sourcePreferenceSeeded", sourceSaved.outcome === "applied");
  async function openEnvironmentMenu() {
    const trigger = handle.page.getByTestId("local-conversation-actions");
    if ((await trigger.getAttribute("data-state")) !== "open")
      await trigger.click();
    await handle.page
      .getByTestId("local-conversation-change-environment")
      .hover();
    const menu = handle.page.getByTestId("local-conversation-environment-menu");
    await menu.waitFor({ state: "visible" });
    return menu;
  }
  let environmentMenu = await openEnvironmentMenu();
  summary.environmentMenuFont = await environmentMenu
    .locator("input")
    .evaluate((node) => getComputedStyle(node).fontSize);
  check("environmentMenuFont13", summary.environmentMenuFont === "13px");
  await environmentMenu
    .locator('[cmdk-item][data-value="no-environment"]')
    .click();
  await environmentMenu.waitFor({ state: "detached" });
  await handle.page
    .getByTestId("local-conversation-primary-action")
    .waitFor({ state: "detached" });
  check(
    "gitScopeNone",
    (await rpc("projectGit/status", { rootPath: cwd }))
      .localEnvironmentConfigPath == null,
  );
  check(
    "gitNoneSentinel",
    git(
      cwd,
      "config",
      "--file",
      git(cwd, "rev-parse", "--git-path", "config.worktree"),
      "--get",
      "lime.localEnvironmentConfigPath",
    ) === "__none__",
  );
  environmentMenu = await openEnvironmentMenu();
  await environmentMenu.locator("input").fill("Alternate");
  check(
    "environmentSearch",
    (await environmentMenu.locator("[data-config-path]").count()) === 1,
  );
  await environmentMenu.locator("input").press("ArrowLeft");
  check(
    "environmentSearchArrowLeft",
    await environmentMenu
      .locator("input")
      .evaluate(
        (node) =>
          document.activeElement === node &&
          node.selectionStart === "Alternate".length - 1,
      ),
  );
  await environmentMenu.locator("input").press("ArrowRight");
  check(
    "environmentSearchArrowRight",
    await environmentMenu
      .locator("input")
      .evaluate(
        (node) =>
          document.activeElement === node &&
          node.selectionStart === "Alternate".length,
      ),
  );
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, "environment-search-dark-900.png"),
    animations: "disabled",
  });
  await environmentMenu.locator("input").press("Escape");
  await environmentMenu.waitFor({ state: "detached" });
  check(
    "environmentEscapeClosesMenu",
    (await handle.page
      .getByTestId("local-conversation-actions")
      .getAttribute("data-state")) === "closed",
  );
  environmentMenu = await openEnvironmentMenu();
  await environmentMenu.locator("input").fill("Alternate");
  const shellCount = await handle.page
    .getByTestId("workspace-right-surface-tab-shell")
    .count();
  const alternateRaw = fs.readFileSync(alternatePath, "utf8");
  fs.writeFileSync(alternatePath, "name = [");
  await handle.page.evaluate(() => {
    window.environmentMenuEvidence = [];
    const identity = (node) =>
      node instanceof Element
        ? `${node.tagName}:${node.getAttribute("role")}:${node.getAttribute("data-testid")}:${node.getAttribute("data-value")}`
        : null;
    for (const type of ["pointerdown", "focusin", "focusout"])
      document.addEventListener(
        type,
        (event) => {
          if (window.environmentMenuEvidence.length < 80)
            window.environmentMenuEvidence.push({
              type,
              target: identity(event.target),
              related: identity(event.relatedTarget),
              submenu: Boolean(
                document.querySelector(
                  '[data-testid="local-conversation-environment-menu"]',
                ),
              ),
            });
        },
        true,
      );
  });
  await environmentMenu
    .locator(`[data-config-path="${alternatePath}"]`)
    .click();
  try {
    await environmentMenu.getByRole("alert").waitFor({ timeout: 10000 });
  } catch (error) {
    summary.environmentMenuEvidence = await handle.page.evaluate(
      () => window.environmentMenuEvidence,
    );
    fs.writeFileSync(
      path.join(options.evidenceDir, "failed-environment-invoke-trace.json"),
      (await handle.page.evaluate(() =>
        localStorage.getItem("lime_invoke_trace_buffer_v1"),
      )) || "[]",
    );
    throw error;
  }
  check(
    "failedSelectionRetainsNone",
    (await rpc("projectGit/status", { rootPath: cwd }))
      .localEnvironmentConfigPath == null &&
      (await handle.page
        .getByTestId("local-conversation-primary-action")
        .count()) === 0,
  );
  await handle.page.screenshot({
    path: path.join(
      options.evidenceDir,
      "environment-save-failed-dark-900.png",
    ),
    animations: "disabled",
  });
  fs.writeFileSync(alternatePath, alternateRaw);
  await environmentMenu
    .locator('[cmdk-item][data-value="retry-environments"]')
    .click();
  await environmentMenu.waitFor({ state: "detached" });
  await handle.page.waitForFunction(() =>
    document
      .querySelector('[data-testid="local-conversation-primary-action"]')
      ?.getAttribute("aria-label")
      ?.includes("Alternate action"),
  );
  check(
    "selectionDoesNotExecute",
    shellCount ===
      (await handle.page
        .getByTestId("workspace-right-surface-tab-shell")
        .count()) && !fs.existsSync(path.join(cwd, "must-not-run")),
  );
  check(
    "selectedAlternatePath",
    (await rpc("projectGit/status", { rootPath: cwd }))
      .localEnvironmentConfigPath === alternatePath,
  );
  await handle.page.getByTestId("local-conversation-primary-action").click();
  await waitTerminalOutput("ALTERNATE_ACTION_OUTPUT");
  await waitTerminalOutput(cwd);
  environmentMenu = await openEnvironmentMenu();
  await environmentMenu
    .locator('[cmdk-item][data-value="no-environment"]')
    .click();
  await environmentMenu.waitFor({ state: "detached" });
  await handle.page
    .getByTestId("local-conversation-primary-action")
    .waitFor({ state: "detached" });
  check(
    "otherWorktreeUnchanged",
    (await rpc("projectGit/status", { rootPath: otherWorktree }))
      .localEnvironmentConfigPath == null,
  );
  const sourceRead = await handle.page.evaluate(() =>
    window.electronAPI.invoke("persisted_atom_read", {
      key: "local-env-selections-by-workspace",
      query: { kind: "selections" },
    }),
  );
  check(
    "sourcePreferenceUnchanged",
    sourceRead.data.selections[sourceScope] === sourceChoice,
  );
  const environmentTrace = await handle.page.evaluate(() =>
    localStorage.getItem("lime_invoke_trace_buffer_v1"),
  );
  const environmentWrites = parseJsonRpcRequestsFromInvokeTrace(
    environmentTrace,
  ).filter(
    (entry) =>
      entry.transport === "electron-ipc" &&
      entry.status === "success" &&
      entry.method === "projectGit/worktree/environment/set",
  );
  check(
    "realEnvironmentSelectionMethod",
    environmentWrites.some(
      (entry) =>
        entry.params.rootPath === cwd &&
        entry.params.configPath === alternatePath,
    ) &&
      environmentWrites.filter(
        (entry) =>
          entry.params.rootPath === cwd && entry.params.configPath === null,
      ).length === 2,
  );
  summary.environmentTrace = summarizeSettingsAppearanceTrace(environmentTrace);
  fs.writeFileSync(
    path.join(options.evidenceDir, "environment-invoke-trace.json"),
    environmentTrace || "[]",
  );
  check(
    "environmentSelectionNoMock",
    summary.environmentTrace.mockFallbackHitCount === 0,
  );
  summary.environmentSelectionMainExit = await restart();
  handle = getHandle();
  await handle.page.setViewportSize({ width: 900, height: 900 });
  await openConversation();
  environmentMenu = await openEnvironmentMenu();
  await environmentMenu
    .locator('[cmdk-item][data-value="no-environment"] svg')
    .waitFor();
  check(
    "coldNoneDoesNotInheritSourceOrDefault",
    (await handle.page
      .getByTestId("local-conversation-primary-action")
      .count()) === 0 &&
      (await rpc("projectGit/status", { rootPath: cwd }))
        .localEnvironmentConfigPath == null,
  );
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, "environment-none-cold-restart.png"),
    animations: "disabled",
  });
  check(
    "environmentSelectionNoErrors",
    summary.pageErrors.length === 0 && summary.consoleErrors.length === 0,
  );
}

/** Setup runs on the real command owner; a new Main must inherit its Git metadata. */
export async function runSetupEnvironmentScenario({
  source,
  git,
  options,
  summary,
  rpc,
  check,
  getHandle,
  restart,
  openConversation,
  waitTerminalOutput,
}) {
  const workspace = path.join(source, "packages/app");
  const configPath = path.join(
    workspace,
    ".lime/environments/environment.toml",
  );
  const loaded = await rpc("localEnvironments/readConfig", { configPath });
  const saved = await rpc("localEnvironments/saveConfig", {
    configPath,
    expectedRevision: loaded.revision,
    raw: `name='Setup capture'\n[setup]\nscript='''export LIME_SETUP_ACTION=SETUP_CAPTURED\nunset HOME'''\n[[actions]]\nname='Setup inherited action'\ncommand='''printf '%s|%s\\n' "$LIME_SETUP_ACTION" "\${HOME-missing}"\npwd'''\n`,
  });
  check("setupEnvironmentConfigSaved", saved.type === "success");
  const created = await rpc("projectGit/worktree/create", {
    rootPath: workspace,
    name: "setup-capture",
    baseBranch: "main",
    localEnvironmentConfigPath: configPath,
  });
  check(
    "setupEnvironmentSucceeded",
    created.setupResult?.status === "succeeded",
  );
  const cwd = path.join(created.worktreePath, "packages/app");
  const metadata = JSON.parse(
    fs.readFileSync(
      git(cwd, "rev-parse", "--git-path", "lime-shell-environment.json"),
      "utf8",
    ),
  );
  check(
    "setupEnvironmentGitMetadata",
    metadata.version === 1 &&
      metadata.set.LIME_SETUP_ACTION === "SETUP_CAPTURED" &&
      metadata.exclude.includes("HOME") &&
      !Object.hasOwn(metadata.set, "LIME_SOURCE_TREE_PATH") &&
      !Object.hasOwn(metadata.set, "LIME_WORKTREE_PATH"),
  );
  await rpc("workspace/ensure", {
    rootPath: cwd,
    name: "Setup capture fixture",
  });
  const { thread } = await rpc("thread/start", {
    cwd,
    approvalPolicy: "never",
    sandbox: "danger-full-access",
  });
  await rpc("thread/name/set", {
    threadId: thread.id,
    name: "Setup environment fixture conversation",
  });
  summary.setupEnvironmentMainExit = await restart();
  const handle = getHandle();
  await handle.page.setViewportSize({ width: 900, height: 900 });
  await openConversation(thread.sessionId);
  await handle.page
    .getByTestId("local-conversation-primary-action")
    .waitFor({ state: "visible" });
  check(
    "setupEnvironmentActionRestored",
    (
      await handle.page
        .getByTestId("local-conversation-primary-action")
        .getAttribute("aria-label")
    )?.includes("Setup inherited action"),
  );
  await handle.page.getByTestId("local-conversation-primary-action").click();
  await waitTerminalOutput("SETUP_CAPTURED|missing");
  await waitTerminalOutput(cwd);
  check("setupEnvironmentInheritedAfterColdRestart", true);
  const sourceEnvironment = await rpc("command/exec", {
    cwd: workspace,
    command: ["/bin/sh", "-c", "printf '%s' \"${LIME_SETUP_ACTION-missing}\""],
  });
  check(
    "setupEnvironmentDoesNotLeakToSource",
    sourceEnvironment.exitCode === 0 && sourceEnvironment.stdout === "missing",
  );
  await handle.page.screenshot({
    path: path.join(
      options.evidenceDir,
      "setup-environment-inherited-dark-900.png",
    ),
    animations: "disabled",
  });
  const trace = summarizeSettingsAppearanceTrace(
    await handle.page.evaluate(() =>
      localStorage.getItem("lime_invoke_trace_buffer_v1"),
    ),
  );
  check(
    "setupEnvironmentNoMockOrErrors",
    trace.mockFallbackHitCount === 0 &&
      summary.consoleErrors.length === 0 &&
      summary.pageErrors.length === 0,
  );
}
