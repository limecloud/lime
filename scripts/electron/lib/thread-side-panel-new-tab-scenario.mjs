import { writeThreadSidePanelTerminalMarker } from "./thread-side-panel-terminal-scenario.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { closeThreadSidePanelTab } from "./thread-side-panel-navigation.mjs";
import {
  verifyFileTreeContextMenu,
  verifyFileTabContextMenu,
} from "./workspace-file-menu-fixture.mjs";
import {
  collectFileEditorEvidence,
  collectMarkdownSaveBeforePreview,
} from "./thread-side-panel-file-editor-scenario.mjs";
import { collectFileTreeSelectionEvidence } from "./file-tree-selection-scenario.mjs";

/** 真实目录选择、捕获事件与编辑器身份；不注入标签状态。 */
async function collectFilePreviewEvidence(
  page,
  options,
  workspace,
  file,
  capture,
) {
  const tabs = page.getByTestId("workspace-right-surface-tab-files");
  const tabAt = (relative) => tabs.filter({ hasText: relative });
  const tree = page.locator('[data-testid="workspace-file-tree"]:visible');
  const open = async (relative, marker) => {
    await tree
      .getByTitle(path.join(workspace.rootPath, relative), { exact: true })
      .click();
    await page.waitForFunction(
      (marker) =>
        document
          .querySelector('[data-testid="workspace-right-surface-active-pane"]')
          ?.textContent?.includes(marker),
      marker,
      { timeout: options.timeoutMs },
    );
  };
  await tabAt(file.secondRelativePath)
    .locator("..")
    .getByTestId("workspace-right-surface-tab-close")
    .click();
  await tree.getByRole("textbox").fill("");
  await open(file.secondRelativePath, file.secondMarker);
  assert.equal(await tabs.count(), 2);
  assert.equal(
    await tabAt(file.secondRelativePath).getAttribute("data-tab-preview"),
    "true",
  );
  const retainedTree = await tree.elementHandle();
  const replacedEditor = await page
    .locator('[data-testid="file-code-editor"]:visible')
    .elementHandle();
  await open(file.markdownRelativePath, file.markdownMarker);
  assert.equal(await tabs.count(), 2);
  assert.equal(await tabAt(file.secondRelativePath).count(), 0);
  assert.equal(
    await tabAt(file.markdownRelativePath).getAttribute("data-tab-preview"),
    "true",
  );
  assert.equal(await retainedTree.evaluate((node) => node.isConnected), true);
  assert.equal(
    await replacedEditor.evaluate((node) => node.isConnected),
    false,
  );
  await capture("file-preview-replaced");
  const markdownEditor = await page
    .locator('[data-testid="text-file-editor"]:visible')
    .elementHandle();
  await tree
    .getByTitle(path.join(workspace.rootPath, file.markdownRelativePath), {
      exact: true,
    })
    .dblclick();
  assert.equal(
    await tabAt(file.markdownRelativePath).getAttribute("data-tab-preview"),
    null,
  );
  assert.equal(await markdownEditor.evaluate((node) => node.isConnected), true);
  await tabAt(file.markdownRelativePath)
    .locator("..")
    .getByTestId("workspace-right-surface-tab-close")
    .click();
  await open(file.secondRelativePath, file.secondMarker);
  const editor = page.locator(
    '[data-testid="file-code-editor"]:visible .cm-content',
  );
  const retainedEditor = await editor.elementHandle();
  await editor.focus();
  await editor.press("ArrowRight");
  assert.equal(
    await tabAt(file.secondRelativePath).getAttribute("data-tab-preview"),
    null,
  );
  assert.equal(await retainedEditor.evaluate((node) => node.isConnected), true);
  await capture("file-preview-keyboard-pin");
  await tabAt(file.relativePath).click();
  await tree.getByRole("textbox").fill(file.relativePath);
  assert.equal(await tabs.count(), 2);
  return {
    singlePreviewReplacement: true,
    replacementPreservesTree: true,
    replacementCreatesEditor: true,
    doubleClickPinsSameEditor: true,
    keyboardCapturePinsSameEditor: true,
  };
}

/** 只在 fixture 自有临时工作区写入真实输入；不依赖仓库文件恰好存在。 */
export function createThreadSidePanelFileFixture(workspace) {
  const root = fs.realpathSync(workspace.rootPath);
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  assert.ok(
    root.startsWith(temporaryRoot + path.sep),
    "New tab file fixture requires an isolated temporary workspace",
  );
  const relativePath = "thread-side-panel-" + crypto.randomUUID() + ".ts";
  const marker = "Thread side panel native fixture";
  const content = 'export const source = "' + marker + '";\n';
  fs.writeFileSync(path.join(root, relativePath), content, { flag: "wx" });
  const secondRelativePath =
    "thread-side-panel-second-" + crypto.randomUUID() + ".ts";
  const secondMarker = "Second thread side panel native fixture";
  const previewBoundary = 2 * 1024 * 1024;
  const secondHeader = `export const source = "${secondMarker}";\n//`;
  // 中文首字节落在旧预览上限内，余下字节在上限外；有效UTF-8必须进入编辑器。
  const secondContent =
    secondHeader +
    "a".repeat(previewBoundary - Buffer.byteLength(secondHeader) - 1) +
    "中😀\n";
  fs.writeFileSync(path.join(root, secondRelativePath), secondContent, {
    flag: "wx",
  });
  const markdownRelativePath =
    "thread-side-panel-markdown-" + crypto.randomUUID() + ".md";
  const markdownMarker = "Thread side panel Markdown preview";
  fs.writeFileSync(
    path.join(root, markdownRelativePath),
    `# ${markdownMarker}\n`,
    { flag: "wx" },
  );
  const nestedRelativePath =
    "src/components/thread-side-panel-nested-" + crypto.randomUUID() + ".ts";
  fs.mkdirSync(path.dirname(path.join(root, nestedRelativePath)), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, nestedRelativePath),
    "export const nested = true;\n",
    { flag: "wx" },
  );
  return {
    nestedRelativePath,
    relativePath,
    marker,
    secondRelativePath,
    secondMarker,
    previewBoundary,
    secondFileSize: Buffer.byteLength(secondContent),
    markdownRelativePath,
    markdownMarker,
  };
}

/** 在同一 canonical Thread 中验证 New tab 身份、真实文件搜索和 Composer 生命周期。 */
export async function collectThreadSidePanelNewTabEvidence(
  page,
  options,
  workspace,
  file,
  clipboard,
) {
  const waitSurface = (kind) =>
    page.waitForFunction(
      (kind) =>
        document
          .querySelector('[data-testid="workspace-right-surface-host"]')
          ?.getAttribute("data-surface") === kind,
      kind,
      { timeout: options.timeoutMs },
    );
  await closeThreadSidePanelTab(page, "browser");
  await closeThreadSidePanelTab(page, "files");
  const editor = page.getByTestId("composer-editor");
  const editorHandle = await editor.elementHandle();
  const draft = "New tab preserves the canonical unsent draft";
  await editor.fill(draft);
  const screenshots = [];
  const capture = async (name) => {
    assert.equal(await editorHandle.evaluate((node) => node.isConnected), true);
    assert.equal(await editor.textContent(), draft);
    const screenshot = path.join(
      options.evidenceDir,
      `${options.prefix}-new-tab-${name}.png`,
    );
    await page.screenshot({ path: screenshot });
    screenshots.push(screenshot);
  };
  await page.getByTestId("thread-side-panel-toggle").click();
  await waitSurface("workspace-new-tab");
  await page.getByTestId("workspace-right-surface-new-tab").click();
  const newTabs = page.getByTestId(
    "workspace-right-surface-tab-workspace-new-tab",
  );
  assert.equal(await newTabs.count(), 2);
  const ids = await newTabs.evaluateAll((nodes) =>
    nodes.map((node) => node.id),
  );
  assert.equal(new Set(ids).size, 2);
  await capture("two-identities");
  await page
    .locator('[data-testid="side-panel-new-tab-open-file"]:visible')
    .click();
  await waitSurface("files");
  assert.equal(await newTabs.count(), 1);
  const tree = page.locator('[data-testid="workspace-file-tree"]:visible');
  const { relativePath, marker } = file;
  await tree.getByRole("textbox").fill(file.nestedRelativePath);
  const directoryRow = tree.getByRole("treeitem").and(
    tree.getByTitle(path.join(workspace.rootPath, "src/components"), {
      exact: true,
    }),
  );
  const nestedRow = tree.getByRole("treeitem").and(
    tree.getByTitle(path.join(workspace.rootPath, file.nestedRelativePath), {
      exact: true,
    }),
  );
  await nestedRow.waitFor({ state: "visible", timeout: options.timeoutMs });
  assert.equal(await directoryRow.getAttribute("aria-level"), "1");
  assert.equal(await nestedRow.getAttribute("aria-level"), "2");
  assert.equal(await directoryRow.textContent(), "src/components");
  await directoryRow.focus();
  await directoryRow.press("ArrowRight");
  assert.equal(
    await nestedRow.evaluate((node) => node === document.activeElement),
    true,
  );
  await capture("file-search-shared-tree");
  const treeContextMenu = await verifyFileTreeContextMenu({
    page,
    clipboard,
    directory: directoryRow,
    file: nestedRow,
    cwd: workspace.rootPath,
    filePath: path.join(workspace.rootPath, file.nestedRelativePath),
    capture,
  });
  await tree.getByRole("textbox").fill(relativePath);
  const result = tree.getByTitle(path.join(workspace.rootPath, relativePath), {
    exact: true,
  });
  await result.waitFor({ state: "visible", timeout: options.timeoutMs });
  await result.click();
  await page.waitForFunction(
    (marker) =>
      document
        .querySelector(
          '[data-testid="workspace-right-surface-active-pane"] [data-testid="workspace-files-surface"]',
        )
        ?.textContent?.includes(marker),
    marker,
    { timeout: options.timeoutMs },
  );
  assert.equal(
    await page
      .locator('[data-testid="workspace-changes-surface"]:visible')
      .count(),
    0,
  );
  await capture("files");
  const firstFilePane = await page
    .locator('[data-testid="workspace-files-surface"]:visible')
    .elementHandle();
  const firstPath = path.join(workspace.rootPath, relativePath);
  const secondPath = path.join(workspace.rootPath, file.secondRelativePath);
  const fileTabs = page.getByTestId("workspace-right-surface-tab-files");
  assert.equal(
    await fileTabs.count(),
    1,
    "Selecting a path must close the empty Files tab",
  );
  assert.equal(await fileTabs.getAttribute("data-file-path"), firstPath);
  const tabContextMenu = await verifyFileTabContextMenu({
    page,
    clipboard,
    tab: fileTabs,
    filePath: firstPath,
    capture,
  });
  await tree.getByRole("textbox").fill("no-such-file-" + crypto.randomUUID());
  const emptySearch = tree.getByText("未找到文件", { exact: true });
  await emptySearch.waitFor({ state: "visible", timeout: options.timeoutMs });
  const emptySearchGeometry = await emptySearch.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const pane = node
      .closest('[data-testid="workspace-file-tree"]')
      .getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      paneTop: pane.top,
      paneBottom: pane.bottom,
    };
  });
  assert.ok(
    emptySearchGeometry.height > 0 &&
      emptySearchGeometry.top >= emptySearchGeometry.paneTop &&
      emptySearchGeometry.bottom <= emptySearchGeometry.paneBottom,
    "Empty file search feedback must remain inside the visible tree pane",
  );
  await tree.getByRole("textbox").fill(file.secondRelativePath);
  await tree
    .getByTitle(path.join(workspace.rootPath, file.secondRelativePath), {
      exact: true,
    })
    .click();
  await page.waitForFunction(
    (marker) =>
      document
        .querySelector('[data-testid="workspace-right-surface-active-pane"]')
        ?.textContent?.includes(marker),
    file.secondMarker,
    { timeout: options.timeoutMs },
  );
  assert.equal(
    await fileTabs.count(),
    2,
    "Distinct paths require distinct tabs",
  );
  await page
    .locator('[data-testid="workspace-files-surface"]:visible')
    .getByTestId("file-code-editor")
    .waitFor({ state: "visible", timeout: options.timeoutMs });
  assert.ok(file.secondFileSize > file.previewBoundary);
  await fileTabs.filter({ hasText: relativePath }).click();
  assert.equal(await firstFilePane.evaluate((node) => node.isConnected), true);
  assert.equal(
    await tree.getByRole("textbox").inputValue(),
    file.secondRelativePath,
  );
  await fileTabs.filter({ hasText: file.secondRelativePath }).click();
  await tree.getByRole("textbox").fill(relativePath);
  await tree
    .getByTitle(path.join(workspace.rootPath, relativePath), { exact: true })
    .click();
  assert.equal(
    await fileTabs.count(),
    2,
    "Reopening a path must reuse its tab",
  );
  assert.equal(await firstFilePane.evaluate((node) => node.isConnected), true);
  assert.equal(
    await page
      .locator('[data-testid="workspace-files-surface"]:visible')
      .locator("button:disabled")
      .count(),
    0,
    "Source files must not expose unavailable preview modes",
  );
  await capture("file-tabs");
  const previewEvidence = await collectFilePreviewEvidence(
    page,
    options,
    workspace,
    file,
    capture,
  );
  const fileSelectionEvidence = await collectFileTreeSelectionEvidence(page, {
    tree,
    workspace,
    file,
    timeoutMs: options.timeoutMs,
    capture,
  });
  const fileEditorEvidence = await collectFileEditorEvidence(
    page,
    options,
    workspace,
    file,
    capture,
  );
  await tree.getByRole("textbox").fill(file.markdownRelativePath);
  await tree
    .getByTitle(path.join(workspace.rootPath, file.markdownRelativePath), {
      exact: true,
    })
    .click();
  const markdownPane = page.locator(
    '[data-testid="workspace-files-surface"]:visible',
  );
  await markdownPane
    .locator('[data-testid="text-file-editor"][data-preview-mode="markdown"]')
    .waitFor({ state: "visible", timeout: options.timeoutMs });
  const markdownTree = await tree.getByRole("textbox").elementHandle();
  const togglePreview = markdownPane.getByTestId("file-preview-mode-toggle");
  assert.equal(await togglePreview.count(), 1);
  await togglePreview.click();
  await markdownPane
    .getByTestId("file-code-editor")
    .waitFor({ state: "visible", timeout: options.timeoutMs });
  assert.ok((await markdownPane.textContent()).includes(file.markdownMarker));
  const markdownSaveEvidence = await collectMarkdownSaveBeforePreview(
    page,
    options,
    workspace,
    file,
  );
  await markdownPane
    .getByTestId("file-preview-markdown")
    .waitFor({ state: "visible", timeout: options.timeoutMs });
  assert.equal(await markdownTree.evaluate((node) => node.isConnected), true);
  await capture("markdown-preview");
  await fileTabs.filter({ hasText: relativePath }).click();
  const normalViewport = page.viewportSize();
  await page.setViewportSize({ width: 880, height: 720 });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="layout-transition-root"]')
        ?.getAttribute("data-layout-axis") === "single",
    null,
    { timeout: options.timeoutMs },
  );
  await fileTabs.filter({ hasText: relativePath }).click();
  await page.waitForFunction(
    (marker) => {
      const pane = document.querySelector(
        '[data-testid="workspace-right-surface-active-pane"]',
      );
      const canvas = document.querySelector(
        '[data-testid="layout-canvas-panel"]',
      );
      return (
        canvas?.getAttribute("aria-hidden") === "false" &&
        pane?.getBoundingClientRect().width > 0 &&
        pane.textContent?.includes(marker)
      );
    },
    marker,
    { timeout: options.timeoutMs },
  );
  assert.equal(await firstFilePane.evaluate((node) => node.isConnected), true);
  await capture("compact");
  await page.setViewportSize(normalViewport);
  await page.getByTestId("workspace-right-surface-new-tab").click();
  await page
    .locator('[data-testid="side-panel-new-tab-terminal"]:visible')
    .click();
  await waitSurface("shell");
  await page
    .getByTestId("terminal-tab")
    .waitFor({ state: "visible", timeout: options.timeoutMs });
  const terminalHandle = await page.getByTestId("terminal-tab").elementHandle();

  const terminalBeforeCollapse = await writeThreadSidePanelTerminalMarker(
    page,
    options,
    "LIME_SIDE_PANEL_BEFORE",
    31,
  );
  assert.ok(terminalBeforeCollapse.lifetimeMs >= 31_000);
  await page.getByTestId("thread-side-panel-toggle").click();
  await page
    .getByTestId("workspace-right-surface-host")
    .waitFor({ state: "hidden" });
  assert.equal(await terminalHandle.evaluate((node) => node.isConnected), true);
  await page.getByTestId("thread-side-panel-toggle").click();
  await waitSurface("shell");
  assert.equal(await terminalHandle.evaluate((node) => node.isConnected), true);
  const terminalAfterCollapse = await writeThreadSidePanelTerminalMarker(
    page,
    options,
    "LIME_SIDE_PANEL_AFTER",
  );
  assert.equal(
    terminalAfterCollapse.processId,
    terminalBeforeCollapse.processId,
  );
  await capture("terminal");
  const terminalTabs = page.getByTestId("workspace-right-surface-tab-shell");
  assert.equal(await terminalTabs.count(), 1);
  const firstTerminalTabId = await terminalTabs.first().getAttribute("id");
  await page
    .locator('[data-testid="terminal-xterm"]:visible .xterm-helper-textarea')
    .press("Meta+t");
  await terminalTabs
    .nth(1)
    .waitFor({ state: "visible", timeout: options.timeoutMs });
  const secondTerminalHandle = await page
    .locator('[data-testid="terminal-tab"]:visible')
    .elementHandle();
  assert.notEqual(
    await secondTerminalHandle.getAttribute("data-session-id"),
    await terminalHandle.getAttribute("data-session-id"),
  );
  const secondTerminal = await writeThreadSidePanelTerminalMarker(
    page,
    options,
    "LIME_SIDE_PANEL_SECOND",
  );
  assert.notEqual(secondTerminal.processId, terminalBeforeCollapse.processId);
  assert.equal(
    secondTerminal.actualOutput.includes(terminalBeforeCollapse.expectedOutput),
    false,
    "A new terminal must not inherit the first terminal's output",
  );
  await capture("two-terminals");
  await page.locator(`[id="${firstTerminalTabId}"]`).click();
  assert.equal(await terminalHandle.evaluate((node) => node.isConnected), true);
  const firstAfterSwitch = await writeThreadSidePanelTerminalMarker(
    page,
    options,
    "LIME_SIDE_PANEL_FIRST",
  );
  assert.equal(firstAfterSwitch.processId, terminalBeforeCollapse.processId);
  assert.equal(
    firstAfterSwitch.actualOutput.includes(secondTerminal.expectedOutput),
    false,
  );

  await page.getByTestId("app-sidebar-appearance").click();
  await page
    .getByTestId("app-sidebar-appearance-popover")
    .getByRole("button")
    .first()
    .click();
  await page.waitForFunction(
    () =>
      document.documentElement.getAttribute("data-lime-theme-effective") ===
      "light",
    null,
    { timeout: options.timeoutMs },
  );
  await page
    .locator('[data-testid="terminal-xterm"]:visible .xterm-helper-textarea')
    .click();
  const themeBefore = await page
    .locator('[data-testid="terminal-xterm"]:visible')
    .evaluate((node) =>
      getComputedStyle(node).getPropertyValue("--lime-surface").trim(),
    );
  await page.getByTestId("app-sidebar-appearance").click();
  await page
    .getByTestId("app-sidebar-appearance-popover")
    .getByRole("button")
    .nth(1)
    .click();
  await page.waitForFunction(
    () =>
      document.documentElement.getAttribute("data-lime-theme-effective") ===
      "dark",
    null,
    { timeout: options.timeoutMs },
  );
  await page
    .locator('[data-testid="terminal-xterm"]:visible .xterm-helper-textarea')
    .click();
  const themeAfter = await page
    .locator('[data-testid="terminal-xterm"]:visible')
    .evaluate((node) =>
      getComputedStyle(node).getPropertyValue("--lime-surface").trim(),
    );
  assert.notEqual(
    themeBefore,
    themeAfter,
    "The terminal must consume the active theme tokens",
  );
  assert.equal(await terminalHandle.evaluate((node) => node.isConnected), true);
  const afterTheme = await writeThreadSidePanelTerminalMarker(
    page,
    options,
    "LIME_SIDE_PANEL_DARK",
  );
  assert.equal(afterTheme.processId, terminalBeforeCollapse.processId);
  await capture("terminal-dark");
  await page.getByTestId("app-sidebar-appearance").click();
  await page
    .getByTestId("app-sidebar-appearance-popover")
    .getByRole("button")
    .first()
    .click();
  await page
    .locator('[data-testid="terminal-xterm"]:visible .xterm-helper-textarea')
    .click();
  await terminalTabs
    .nth(1)
    .locator("..")
    .getByTestId("workspace-right-surface-tab-close")
    .click();
  await page.waitForFunction(
    (processId) =>
      JSON.parse(
        localStorage.getItem("lime_invoke_trace_buffer_v1") || "[]",
      ).some(
        (entry) =>
          entry.transport === "electron-ipc" &&
          entry.status === "success" &&
          entry.args_preview?.request?.lines?.some((line) => {
            const request = JSON.parse(line);
            return (
              request.method === "command/exec/terminate" &&
              request.params?.processId === processId
            );
          }),
      ),
    secondTerminal.processId,
    { timeout: options.timeoutMs },
  );
  assert.equal(
    await secondTerminalHandle.evaluate((node) => node.isConnected),
    false,
  );
  assert.equal(await terminalTabs.count(), 1);
  const afterClose = await writeThreadSidePanelTerminalMarker(
    page,
    options,
    "LIME_SIDE_PANEL_SURVIVOR",
  );
  assert.equal(afterClose.processId, terminalBeforeCollapse.processId);
  await capture("terminal-close-one");
  await page.getByTestId("workspace-right-surface-new-tab").click();
  await page.locator('[data-testid="side-panel-new-tab-chat"]:visible').click();
  await page
    .getByTestId("workspace-right-surface-host")
    .waitFor({ state: "hidden" });
  assert.equal(
    await editor.evaluate((node) => node === document.activeElement),
    true,
  );
  await capture("chat");
  return {
    workspaceId: workspace.workspaceId,
    rootPath: workspace.rootPath,
    distinctNewTabIds: ids,
    replacedNewTab: true,
    realFileSearch: relativePath,
    searchUsesSharedTree: {
      flattenedAncestor: true,
      canonicalAbsolutePaths: true,
      hierarchyLevels: [1, 2],
      arrowKeyFocus: true,
    },
    localFileMenus: { tree: treeContextMenu, tab: tabContextMenu },
    fileSelectionEvidence,
    filePathTabs: [firstPath, secondPath],
    utf8FileBeyondPreviewBoundary: {
      sizeBytes: file.secondFileSize,
      previewBoundary: file.previewBoundary,
      previewEvidence,
      codeEditorVisible: true,
    },
    fileContentInstancePreserved: true,
    compactFileTabVisible: true,
    markdownPreviewSourceToggle: true,
    fileEditorEvidence,
    markdownSaveEvidence,
    terminalPanelReopened: true,
    terminalContentInstancePreserved: true,
    terminalProcessIdentityPreserved: true,
    terminalWrites: [
      terminalBeforeCollapse,
      terminalAfterCollapse,
      secondTerminal,
      firstAfterSwitch,
      afterTheme,
      afterClose,
    ],
    terminalLifetimeBeyond30Seconds: true,
    terminalMultipleSessionsIsolated: true,
    terminalThemeChangedWithoutRestart: {
      before: themeBefore,
      after: themeAfter,
    },
    terminalCloseIsolated: true,
    chatFocused: true,
    sameEditor: true,
    draftPreserved: true,
    screenshots,
  };
}
