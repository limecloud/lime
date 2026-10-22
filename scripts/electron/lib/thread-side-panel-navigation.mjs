import path from "node:path";

/** 只经 current 共享标签或 New tab 工具入口操作侧栏。 */
export async function selectThreadSidePanelTool(
  page,
  kind,
  timeoutMs = 60_000,
) {
  const tab = page.getByTestId(`workspace-right-surface-tab-${kind}`).first();
  if (await tab.isVisible()) {
    await tab.click();
    return { source: "existing-tab", kind };
  }
  const actionId = {
    files: "open-file",
    changes: "review",
    shell: "terminal",
    browser: "browser",
  }[kind];
  if (!actionId) throw new Error(`No current New tab action for ${kind}`);
  const action = page.locator(
    `[data-testid="side-panel-new-tab-${actionId}"]:visible`,
  );
  const add = page.getByTestId("workspace-right-surface-new-tab");
  if (!(await add.isVisible())) {
    await page.getByTestId("thread-side-panel-toggle").click();
    if (await tab.isVisible()) {
      await tab.click();
      return { source: "existing-tab", kind };
    }
  }
  if (!(await action.isVisible())) await add.click();
  await action.waitFor({ state: "visible", timeout: timeoutMs });
  await action.click();
  return { source: "new-tab", kind, actionId };
}

export async function closeThreadSidePanelTab(page, kind) {
  const tab = page.getByTestId(`workspace-right-surface-tab-${kind}`).first();
  await tab
    .locator("..")
    .getByTestId("workspace-right-surface-tab-close")
    .click();
}

/** 经共享Files树固定文件标签；具体预览的ready状态由场景观察。 */
export async function openFileTab(page, filePath, timeoutMs = 120_000) {
  await selectThreadSidePanelTool(page, "files", timeoutMs);
  const pane = page.getByTestId("workspace-right-surface-active-pane");
  const tree = pane.getByTestId("workspace-file-tree");
  const toggle = pane.getByRole("button", {
    name: "切换文件树",
    exact: true,
  });
  await toggle.waitFor({ state: "visible", timeout: timeoutMs });
  if ((await toggle.getAttribute("aria-pressed")) !== "true")
    await toggle.click();
  await tree.waitFor({ state: "visible", timeout: timeoutMs });
  await tree.getByRole("textbox").fill(path.basename(filePath));
  const file = tree.getByTitle(filePath, { exact: true });
  await file.waitFor({ state: "visible", timeout: timeoutMs });
  await file.dblclick();
}

/** 独立专业场景关闭当前Files标签后再打开，不能把同路径选择当作重新读取。 */
export async function replaceFileTab(page, filePath, timeoutMs = 120_000) {
  const selected = page.locator(
    '[data-testid="workspace-right-surface-tab-files"][aria-selected="true"]',
  );
  const previousTabId = (await selected.count())
    ? await selected.getAttribute("id")
    : null;
  if (previousTabId) {
    await selected
      .locator("..")
      .getByTestId("workspace-right-surface-tab-close")
      .click();
    await page.locator(`[id="${previousTabId}"]`).waitFor({
      state: "detached",
      timeout: timeoutMs,
    });
  }
  await openFileTab(page, filePath, timeoutMs);
}
