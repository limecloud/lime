import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openSettings } from "../mcp-config-fixture-smoke.mjs";
import { invokeAppServerFromPage } from "../../agent-runtime/claw-chat-current-fixture-rpc.mjs";

export async function openLocalEnvironmentEditor(page, options, projectName) {
  await openSettings(page, options);
  await page.getByTestId("settings-sidebar-tab-local-environments").click();
  await page
    .getByRole("button")
    .filter({ has: page.getByText(projectName, { exact: true }) })
    .click();
  await page
    .locator('[data-testid="project-environments"][aria-busy="false"]')
    .waitFor();
  const environment = page.getByTestId("local-environment-row").first();
  if (await environment.count()) {
    await environment.click();
    await page.getByRole("button", { name: "编辑环境", exact: true }).click();
  } else {
    await page.getByRole("button", { name: "创建环境", exact: true }).click();
  }
  const editor = page.getByTestId("local-environment-editor");
  await editor.getByLabel("名称", { exact: true }).waitFor();
  return editor;
}

export async function runSettingsLocalEnvironmentsNavigationScenario({
  page,
  options,
  evidenceDir,
  stage,
  waitForSession,
  workspaceRoot,
}) {
  const projectName = "Local environment fixture";
  fs.mkdirSync(workspaceRoot, { recursive: true });
  workspaceRoot = fs.realpathSync(workspaceRoot);
  const call = async (method, params) => {
    const response = await invokeAppServerFromPage(page, method, params);
    return response.result;
  };
  await call("workspace/ensure", {
    rootPath: workspaceRoot,
    name: projectName,
  });
  const configPath = path.join(
    workspaceRoot,
    ".lime",
    "environments",
    "environment.toml",
  );
  const dialog = page.getByTestId("settings-unsaved-changes-dialog");
  const observations = [];
  for (const target of ["section", "back"]) {
    stage("local-environments-unsaved-" + target);
    const editor = await openLocalEnvironmentEditor(page, options, projectName);
    await editor
      .getByLabel("名称", { exact: true })
      .fill("Unsaved environment fixture");
    const trigger =
      target === "section"
        ? page.getByTestId("settings-sidebar-tab-about")
        : page.getByTestId("settings-back-button");
    await trigger.click();
    await dialog.waitFor({ state: "visible" });
    await dialog.getByRole("button", { name: "继续编辑", exact: true }).click();
    assert.equal(
      await editor.getByLabel("名称", { exact: true }).inputValue(),
      "Unsaved environment fixture",
    );
    assert.equal(
      fs.existsSync(configPath),
      false,
      "unsaved draft does not create a file",
    );
    await trigger.click();
    await dialog.waitFor({ state: "visible" });
    await page.screenshot({
      path: path.join(evidenceDir, `local-environments-unsaved-${target}.png`),
    });
    await dialog.getByRole("button", { name: "放弃更改", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    if (target === "section")
      await page.getByTestId("settings-back-button").click();
    await waitForSession();
    assert.equal(fs.existsSync(configPath), false, "discard does not persist");
    observations.push({ target, keptDraft: true, discardNoWrite: true });
  }
  stage("local-environments-save-and-conflict");
  let editor = await openLocalEnvironmentEditor(page, options, projectName);
  await editor
    .getByRole("textbox", { name: "设置脚本 · 默认", exact: true })
    .fill("printf 'setup fixture'\n");
  await editor
    .getByRole("textbox", { name: "清理脚本 · 默认", exact: true })
    .fill("printf 'cleanup fixture'\n");
  await editor.getByRole("button", { name: "添加操作", exact: true }).click();
  await editor
    .getByRole("textbox", { name: "操作 1 · 操作名称", exact: true })
    .fill("Test fixture");
  await editor
    .getByRole("textbox", { name: "操作 1 · 命令", exact: true })
    .fill("printf 'action fixture'");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  const details = page.getByTestId("local-environment-details");
  await details.waitFor({ state: "visible" });
  assert.equal(
    await details.locator("textarea, input").count(),
    0,
    "saved environment opens read-only details",
  );
  await details.getByText("printf 'setup fixture'", { exact: true }).waitFor();
  await page.screenshot({
    path: path.join(evidenceDir, "local-environments-details.png"),
  });
  const saved = await call("localEnvironments/readConfig", { configPath });
  assert.equal(saved.environment.type, "success");
  assert.equal(
    saved.environment.environment.setup.script,
    "printf 'setup fixture'",
  );
  assert.equal(
    saved.environment.environment.cleanup.script,
    "printf 'cleanup fixture'",
  );
  assert.equal(saved.environment.environment.actions[0].name, "Test fixture");
  await page.getByTestId("settings-back-button").click();
  await waitForSession();
  editor = await openLocalEnvironmentEditor(page, options, projectName);
  assert.equal(
    await editor
      .getByRole("textbox", { name: "设置脚本 · 默认", exact: true })
      .inputValue(),
    "printf 'setup fixture'",
  );
  fs.appendFileSync(configPath, "\n# external fixture edit\n");
  const externalRaw = fs.readFileSync(configPath, "utf8");
  await editor
    .getByLabel("名称", { exact: true })
    .fill("Conflicting editor draft");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await editor
    .getByRole("alert")
    .filter({ hasText: "文件已被修改或删除" })
    .waitFor();
  assert.equal(
    await editor.getByLabel("名称", { exact: true }).inputValue(),
    "Conflicting editor draft",
  );
  assert.equal(
    fs.readFileSync(configPath, "utf8"),
    externalRaw,
    "conflict must preserve external bytes",
  );
  await page.screenshot({
    path: path.join(evidenceDir, "local-environments-conflict.png"),
  });
  await page.getByTestId("settings-back-button").click();
  await dialog.waitFor({ state: "visible" });
  await dialog.getByRole("button", { name: "放弃更改", exact: true }).click();
  await waitForSession();
  return {
    observations,
    saveAndReopen: true,
    readOnlyDetails: true,
    conflictKeepsDraft: true,
    externalBytesPreserved: true,
    configPath,
    projectName,
    workspaceRoot,
    limitations:
      "Configuration management only. No lifecycle scripts or actions executed, no live provider, remote host, Windows or reference-runtime claim.",
  };
}
