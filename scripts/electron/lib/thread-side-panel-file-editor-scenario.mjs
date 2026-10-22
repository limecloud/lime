import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { targetSnapshot } from "./workspace-file-menu-fixture.mjs";

async function waitForDisk(filePath, expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.readFileSync(filePath, "utf8") === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(
    fs.readFileSync(filePath, "utf8"),
    expected,
    "Editor did not persist the exact file contents",
  );
}

async function replaceEditor(page, content) {
  const editor = page.locator(
    '[data-testid="file-code-editor"]:visible .cm-content',
  );
  await editor.click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+A" : "Control+A",
  );
  await page.keyboard.insertText(content);
}

/** 真键盘→CodeMirror→current fs RPC→临时工作区磁盘；不注入renderer业务状态。 */
export async function collectFileEditorEvidence(
  page,
  options,
  workspace,
  file,
  capture,
) {
  const firstPath = path.join(workspace.rootPath, file.relativePath);
  const secondPath = path.join(workspace.rootPath, file.secondRelativePath);
  const original = fs.readFileSync(firstPath, "utf8");
  const tabs = page.getByTestId("workspace-right-surface-tab-files");
  const tabCount = await tabs.count();
  const breadcrumb = page.locator("[data-file-path-breadcrumb]:visible");
  assert.equal(await breadcrumb.getAttribute("aria-label"), "文件路径");
  assert.deepEqual(
    await breadcrumb.locator("li").allTextContents(),
    [path.basename(workspace.rootPath), ...file.relativePath.split("/")],
    "File header must show the workspace path segments",
  );
  const headerHeight = await breadcrumb.evaluate(
    (node) => node.parentElement.getBoundingClientRect().height,
  );
  assert.equal(
    headerHeight,
    40,
    "File breadcrumb uses the shared pane toolbar height",
  );
  const fileActions = page.locator("[data-artifact-preview-header]:visible");
  const targets = await targetSnapshot(page, firstPath, workspace.rootPath);
  const primaryLabel = targets.primary
    ? `在 ${
        targets.primary.id === "systemDefault"
          ? "默认应用"
          : targets.primary.label === "File Manager"
            ? "文件管理器"
            : targets.primary.label
      } 中打开`
    : "打开";
  await fileActions
    .getByRole("button", { name: primaryLabel, exact: true })
    .waitFor({ state: "visible", timeout: options.timeoutMs });
  assert.equal(
    await fileActions
      .getByRole("button", { name: primaryLabel, exact: true })
      .count(),
    1,
  );
  const optionsButton = fileActions.getByRole("button", {
    name: "打开选项",
    exact: true,
  });
  await optionsButton.focus();
  await page.keyboard.press("ArrowDown");
  const fileMenu = page.locator("[data-artifact-preview-menu]:visible");
  await fileMenu.waitFor({ state: "visible", timeout: options.timeoutMs });
  const expectedTargets = targets.visibleTargets.filter(
    (target) => target.target !== "fileManager",
  );
  const expectedIds = expectedTargets.map((target) => target.id);
  await page.waitForFunction(
    (expected) => {
      const actual = Array.from(
        document.querySelectorAll(
          "[data-artifact-preview-menu] [data-open-in-target]",
        ),
        (node) => node.getAttribute("data-open-in-target"),
      );
      return JSON.stringify(actual) === JSON.stringify(expected);
    },
    expectedIds,
    { timeout: options.timeoutMs },
  );
  assert.deepEqual(await fileMenu.getByRole("menuitem").allTextContents(), [
    ...expectedTargets.map((target) =>
      target.id === "systemDefault" ? "默认应用" : target.label,
    ),
    "在文件夹中打开",
    "另存为…",
  ]);
  assert.equal(
    await fileMenu
      .getByRole("menuitem")
      .first()
      .evaluate((node) => node === document.activeElement),
    true,
  );
  await capture("file-open-options");
  await page.keyboard.press("Escape");
  await fileMenu.waitFor({ state: "hidden", timeout: options.timeoutMs });
  assert.equal(
    await optionsButton.evaluate((node) => node === document.activeElement),
    true,
  );
  assert.equal(
    fs.readFileSync(firstPath, "utf8"),
    original,
    "Inspecting file actions must not alter source bytes",
  );
  await breadcrumb
    .getByRole("button", { name: path.basename(firstPath), exact: true })
    .click();
  const directory = page.locator("[data-file-breadcrumb-directory]:visible");
  await directory
    .getByTitle(secondPath, { exact: true })
    .waitFor({ state: "visible", timeout: options.timeoutMs });
  const directoryNames = await directory
    .locator("button[title]")
    .allTextContents();
  const expectedDirectoryNames = [
    file.nestedRelativePath.split("/")[0],
    file.relativePath,
    file.markdownRelativePath,
    file.secondRelativePath,
  ];
  assert.deepEqual(
    directoryNames,
    expectedDirectoryNames,
    "The nested fixture directory comes first; sibling files use name order without Markdown priority",
  );
  assert.equal(
    await directory.evaluate((node) => node.getBoundingClientRect().height),
    320,
  );
  await capture("file-breadcrumb-directory");
  const siblingRows = directory.getByRole("treeitem");
  assert.equal(await directory.getByRole("tree").count(), 1);
  assert.equal(
    await directory.locator('[role="treeitem"][tabindex="0"]').count(),
    1,
  );
  const rowSemantics = await siblingRows.evaluateAll((nodes) =>
    nodes.map((node) => ({
      level: node.getAttribute("aria-level"),
      position: node.getAttribute("aria-posinset"),
      setSize: node.getAttribute("aria-setsize"),
      selected: node.getAttribute("aria-selected"),
    })),
  );
  assert.deepEqual(
    rowSemantics.map((row) => [row.level, row.position, row.setSize]),
    expectedDirectoryNames.map((_, index) => [
      "1",
      String(index + 1),
      String(expectedDirectoryNames.length),
    ]),
  );
  assert.equal(rowSemantics.filter((row) => row.selected === "true").length, 1);
  await siblingRows.first().focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await siblingRows
      .nth(1)
      .evaluate((node) => node === document.activeElement),
    true,
  );
  await page.keyboard.press("End");
  assert.equal(
    await siblingRows
      .last()
      .evaluate((node) => node === document.activeElement),
    true,
  );
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await siblingRows
      .last()
      .evaluate((node) => node === document.activeElement),
    true,
    "Last sibling focus must not wrap",
  );
  await page.keyboard.press("Home");
  assert.equal(
    await siblingRows
      .first()
      .evaluate((node) => node === document.activeElement),
    true,
  );
  assert.equal(
    await tabs.count(),
    tabCount,
    "Tree navigation alone must not open a file",
  );
  assert.equal(
    await directory.locator('[role="treeitem"][tabindex="0"]').count(),
    1,
  );
  assert.equal(await siblingRows.first().getAttribute("tabindex"), "0");
  assert.equal(await siblingRows.nth(1).getAttribute("tabindex"), "-1");
  await capture("file-breadcrumb-keyboard");
  await directory.getByTitle(secondPath, { exact: true }).click();
  await page
    .locator(
      `[data-testid="text-file-editor"][data-file-path="${secondPath}"]:visible`,
    )
    .waitFor({ state: "visible", timeout: options.timeoutMs });
  assert.equal(
    await directory.count(),
    0,
    "Selecting a sibling closes the directory menu",
  );
  assert.equal(
    await tabs.count(),
    tabCount,
    "Breadcrumb selection reuses the existing file tab identity",
  );
  await tabs.filter({ hasText: file.relativePath }).click();
  const geometry = await page
    .locator('[data-testid="text-file-editor"]:visible')
    .evaluate((node) => ({
      editorWidth: node.getBoundingClientRect().width,
      surfaceWidth: node
        .closest('[data-testid="workspace-files-surface"]')
        .getBoundingClientRect().width,
    }));
  assert.ok(
    geometry.editorWidth >= 320,
    "Desktop file tree must leave a usable editor body",
  );
  const code = page.locator(
    '[data-testid="file-code-editor"]:visible .cm-content',
  );
  const historyToolbar = page.locator(
    '[data-testid="file-editor-history-toolbar"]:visible',
  );
  assert.equal(
    await historyToolbar.count(),
    0,
    "A clean file has no history toolbar",
  );
  await code.click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+f" : "Control+f",
  );
  const search = page.locator('.cm-search:visible input[name="search"]');
  await search.waitFor({ state: "visible", timeout: options.timeoutMs });
  assert.equal(await search.getAttribute("aria-label"), "查找");
  await search.fill("export");
  await page.keyboard.press("Escape");
  const marker = crypto.randomUUID();
  const edited = original + `// editor-autosave-${marker}\n`;
  const editorInstance = await page
    .locator('[data-testid="file-code-editor"]:visible .cm-editor')
    .elementHandle();
  await replaceEditor(page, edited);
  await waitForDisk(firstPath, edited, options.timeoutMs);
  await historyToolbar.waitFor({
    state: "visible",
    timeout: options.timeoutMs,
  });
  await capture("file-editor-saved");
  await tabs.filter({ hasText: file.secondRelativePath }).click();
  await tabs.filter({ hasText: file.relativePath }).click();
  assert.equal(await editorInstance.evaluate((node) => node.isConnected), true);
  await code.click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z",
  );
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+s" : "Control+s",
  );
  await waitForDisk(firstPath, original, options.timeoutMs);
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z",
  );
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+s" : "Control+s",
  );
  await waitForDisk(firstPath, edited, options.timeoutMs);
  const undo = historyToolbar.getByRole("button", {
    name: "撤销",
    exact: true,
  });
  const redo = historyToolbar.getByRole("button", {
    name: "重做",
    exact: true,
  });
  assert.equal(await undo.isEnabled(), true);
  assert.equal(await redo.isEnabled(), false);
  await undo.click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+s" : "Control+s",
  );
  await waitForDisk(firstPath, original, options.timeoutMs);
  assert.equal(await redo.isEnabled(), true);
  await redo.click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+s" : "Control+s",
  );
  await waitForDisk(firstPath, edited, options.timeoutMs);
  await capture("file-editor-history");
  const local = edited + `// local-${marker}\n`;
  await replaceEditor(page, local);
  const disk = edited + `// external-${marker}\n`;
  fs.writeFileSync(firstPath, disk);
  const conflict = page.locator('[data-testid="file-editor-conflict"]:visible');
  await conflict.waitFor({ state: "visible", timeout: options.timeoutMs });
  assert.equal(fs.readFileSync(firstPath, "utf8"), disk);
  assert.equal(await code.isVisible(), false);
  assert.equal(await historyToolbar.count(), 0);
  const reviewGeometry = await conflict.evaluate((node) => {
    const body = node.closest('[data-testid="text-file-editor"]');
    return {
      height: node.getBoundingClientRect().height,
      editorHeight: body.getBoundingClientRect().height,
      actions: [...node.querySelectorAll("button")].map(
        (button) => button.dataset.testid ?? "wrap",
      ),
      unified: node.querySelectorAll("[data-diff-line-type]").length,
    };
  });
  assert.ok(reviewGeometry.height >= reviewGeometry.editorHeight - 60);
  assert.ok(reviewGeometry.unified > 0);
  assert.deepEqual(reviewGeometry.actions, [
    "wrap",
    "file-editor-conflict-edit",
    "file-editor-conflict-reject",
    "file-editor-conflict-accept",
  ]);
  await capture("file-editor-conflict");
  await conflict.getByTestId("file-editor-conflict-edit").click();
  await code.waitFor({ state: "visible", timeout: options.timeoutMs });
  await page.waitForFunction(() =>
    document.activeElement?.classList.contains("cm-content"),
  );
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+s" : "Control+s",
  );
  await waitForDisk(firstPath, local, options.timeoutMs);
  assert.equal(await editorInstance.evaluate((node) => node.isConnected), true);
  await replaceEditor(page, local + `// rejected-local-${marker}\n`);
  fs.writeFileSync(firstPath, disk);
  await conflict.waitFor({ state: "visible", timeout: options.timeoutMs });
  await conflict.getByTestId("file-editor-conflict-reject").click();
  await page.waitForFunction(
    (marker) =>
      Array.from(
        document.querySelectorAll('[data-testid="text-file-editor"]'),
      ).some(
        (node) =>
          node.getAttribute("data-dirty") === "false" &&
          node.textContent.includes(marker),
      ),
    `external-${marker}`,
  );
  assert.equal(
    fs.readFileSync(firstPath, "utf8"),
    disk,
    "Reject must preserve the external disk version",
  );
  assert.equal(await editorInstance.evaluate((node) => node.isConnected), true);

  await tabs.filter({ hasText: file.secondRelativePath }).click();
  const secondDisk =
    fs.readFileSync(secondPath, "utf8") + `// second-external-${marker}\n`;
  await replaceEditor(page, `// second-local-${marker}\n`);
  fs.writeFileSync(secondPath, secondDisk);
  await conflict.waitFor({ state: "visible", timeout: options.timeoutMs });
  const close = tabs
    .filter({ hasText: file.secondRelativePath })
    .locator("..")
    .getByTestId("workspace-right-surface-tab-close");
  await close.click();
  await page
    .getByTestId("discard-file-changes-dialog")
    .waitFor({ state: "visible" });
  await page.getByTestId("discard-file-changes-cancel").click();
  assert.equal(
    await tabs.filter({ hasText: file.secondRelativePath }).count(),
    1,
  );
  assert.equal(fs.readFileSync(secondPath, "utf8"), secondDisk);
  await close.click();
  await page
    .getByTestId("discard-file-changes-dialog")
    .waitFor({ state: "visible" });
  await capture("file-editor-close-conflict");
  await page.getByTestId("discard-file-changes-confirm").click();
  await tabs
    .filter({ hasText: file.secondRelativePath })
    .waitFor({ state: "detached" });
  assert.equal(
    fs.readFileSync(secondPath, "utf8"),
    secondDisk,
    "Discard may not overwrite the external file",
  );
  await tabs.filter({ hasText: file.relativePath }).click();
  assert.equal(await editorInstance.evaluate((node) => node.isConnected), true);
  const viewport = await collectDirectoryViewportEvidence(
    page,
    options,
    workspace,
    firstPath,
    expectedDirectoryNames,
    capture,
  );
  return {
    firstPath,
    secondPath,
    openToolbar: {
      discovery: targets.discovery,
      primaryTargetId: targets.primary?.id ?? null,
      menuTargetIds: expectedIds,
      primaryAccessibleLabel: primaryLabel,
      fixedActionOrder: ["open-in-folder", "save-as"],
      nativeApplicationLaunched: false,
      saveDialogExecuted: false,
    },
    geometry,
    localizedSearch: true,
    undoRedoAfterSaveAndTabSwitch: true,
    autosave: true,
    historyToolbarUndoRedo: true,
    fullHeightUnifiedReview: reviewGeometry,
    editReviewFocusedAndSaved: true,
    diskConflict: true,
    rejectPreservedDisk: true,
    closeCancelPreservedTab: true,
    discardPreservedDisk: true,
    sameEditorInstance: true,
    viewport,
  };
}

/** 大目录必须经过真实fs读取；滚动/键盘只操作当前菜单，不注入业务投影。 */
async function collectDirectoryViewportEvidence(
  page,
  options,
  workspace,
  firstPath,
  existingNames,
  capture,
) {
  const prefix = "zz-virtual-" + crypto.randomUUID();
  const names = Array.from(
    { length: 200 },
    (_, index) => `${prefix}-${String(index).padStart(3, "0")}.ts`,
  );
  const totalEntries = existingNames.length + names.length;
  for (const name of names)
    fs.writeFileSync(path.join(workspace.rootPath, name), "export {};\n", {
      flag: "wx",
    });
  await page
    .locator("[data-file-path-breadcrumb]:visible")
    .getByRole("button", { name: path.basename(firstPath), exact: true })
    .click();
  const menu = page.locator("[data-file-breadcrumb-directory]:visible");
  const first = menu.getByRole("treeitem", {
    name: path.basename(firstPath),
    exact: true,
  });
  await page.waitForFunction(
    (expected) =>
      document
        .querySelector('[data-file-breadcrumb-directory] [role="treeitem"]')
        ?.getAttribute("aria-setsize") === String(expected),
    totalEntries,
    { timeout: options.timeoutMs },
  );
  const mountedBefore = await menu.getByRole("treeitem").count();
  assert.ok(mountedBefore < 50, "Large directory must not mount every row");
  await first.focus();
  const originalFocus = await first.elementHandle();
  const scroll = menu.locator("[data-file-tree-virtualized-scroll]");
  await scroll.hover();
  await page.mouse.wheel(0, 1800);
  await page.waitForFunction(
    (node) =>
      node === document.activeElement && node.dataset.itemParked === "true",
    originalFocus,
    { timeout: options.timeoutMs },
  );
  assert.ok((await menu.getByRole("treeitem").count()) < 50);
  await page.keyboard.press("End");
  const last = menu.getByRole("treeitem", { name: names.at(-1), exact: true });
  await page.waitForFunction(
    (name) =>
      document.activeElement?.getAttribute("aria-label") === name &&
      !document.activeElement?.dataset.itemParked,
    names.at(-1),
    { timeout: options.timeoutMs },
  );
  assert.equal(await last.getAttribute("aria-posinset"), String(totalEntries));
  assert.equal(await last.getAttribute("tabindex"), "0");
  assert.equal(await originalFocus.evaluate((node) => node.isConnected), false);
  await capture("file-directory-virtualized");
  await page.keyboard.press("Home");
  await page.waitForFunction(
    (name) => document.activeElement?.getAttribute("aria-label") === name,
    existingNames[0],
    { timeout: options.timeoutMs },
  );
  assert.equal(
    await menu.locator('[role="treeitem"][tabindex="0"]').count(),
    1,
  );
  const mountedAfter = await menu.getByRole("treeitem").count();
  assert.ok(mountedAfter < 50);
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden", timeout: options.timeoutMs });
  await originalFocus.dispose();
  return {
    totalEntries,
    mountedBefore,
    mountedAfter,
    parkedFocusPreserved: true,
    keyboardCrossedWindow: true,
  };
}

export async function collectMarkdownSaveBeforePreview(
  page,
  options,
  workspace,
  file,
) {
  const filePath = path.join(workspace.rootPath, file.markdownRelativePath);
  const content =
    fs.readFileSync(filePath, "utf8") +
    `\nSaved before preview ${crypto.randomUUID()}\n`;
  await replaceEditor(page, content);
  await page
    .locator('[data-testid="file-preview-mode-toggle"]:visible')
    .click();
  await page
    .locator('[data-testid="file-preview-markdown"]:visible')
    .waitFor({ state: "visible", timeout: options.timeoutMs });
  assert.equal(fs.readFileSync(filePath, "utf8"), content);
  return { savedBeforePreview: true };
}
