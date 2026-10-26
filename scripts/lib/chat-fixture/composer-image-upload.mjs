import fs from "node:fs/promises";

import os from "node:os";

import path from "node:path";
import {
  composerEditorSelector,
  findVisibleComposerEditorsDom,
} from "../composer-editor-dom.mjs";
import { assert } from "./utils.mjs";

export function readComposerAttachmentOwnerDom(core, sessionId) {
  const editors = findVisibleComposerEditorsDom(sessionId);
  const editor = editors.length === 1 ? editors[0] : null;
  return {
    matches:
      !!editor &&
      core?.isConnected === true &&
      editor.closest('[data-testid="inputbar-core-container"]') === core &&
      core.parentElement?.querySelector('input[type="file"]') === null,
    editorCount: editors.length,
    editorSessionId: editor?.dataset.sessionId ?? null,
  };
}

export async function attachComposerImage(
  page,
  {
    app,
    sessionId,
    image,
    addFilesName,
    timeoutMs,
    source = "composer",
    addSourceName,
    additionalEntries = [],
    canceled = false,
  },
) {
  assert(app, "原生附件fixture要求当前ElectronApplication");
  const editor = page.locator(`${composerEditorSelector(sessionId)}:visible`);
  assert((await editor.count()) === 1, "图片上传要求唯一同会话 Composer");
  const core = editor.locator(
    'xpath=ancestor::*[@data-testid="inputbar-core-container"][1]',
  );
  const observer = new Function(
    "core",
    "sessionId",
    `${findVisibleComposerEditorsDom.toString()}\nreturn (${readComposerAttachmentOwnerDom.toString()})(core, sessionId);`,
  );
  const ownership = await core.evaluate(observer, sessionId);
  assert(ownership.matches, `附件owner不匹配: ${JSON.stringify(ownership)}`);
  const deadline = Date.now() + timeoutMs;
  const remaining = () => {
    const value = deadline - Date.now();
    assert(value > 0, "打开 Composer 文件选择器超时");
    return value;
  };
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "composer-native-attachment-"),
  );
  const file = path.join(temporary, path.basename(image.name));
  await fs.writeFile(file, image.buffer);
  const selectedPaths = [file];
  for (const entry of additionalEntries) {
    const selected = path.join(temporary, path.basename(entry.name));
    if (entry.directory) await fs.mkdir(selected);
    else await fs.writeFile(selected, entry.buffer);
    selectedPaths.push(selected);
  }
  // Only the OS selection result is substituted. Renderer -> preload -> dialog
  // IPC, Main normalizer and App Server file reads run unchanged.
  const dialogFixture = await app.evaluateHandle(
    ({ dialog }, { selected, canceled }) => {
      const original = dialog.showOpenDialog;
      const calls = [];
      dialog.showOpenDialog = async (...args) => {
        const options = args.at(-1);
        calls.push({
          properties: options.properties,
          filters: options.filters ?? null,
        });
        return { canceled, filePaths: canceled ? [] : selected };
      };
      return {
        calls,
        restore() {
          dialog.showOpenDialog = original;
        },
      };
    },
    { selected: selectedPaths, canceled },
  );
  try {
    let trigger;
    let menuOwner;
    let menu;
    if (source === "sources") {
      const summary = page.getByTestId("thread-summary-panel");
      if (!(await summary.isVisible())) {
        await page
          .getByTestId("thread-workspace-summary-toggle")
          .click({ timeout: remaining() });
      }
      const section = summary.locator('[data-summary-section="tool-sources"]');
      await section.waitFor({ state: "visible", timeout: remaining() });
      trigger = section
        .getByRole("button", { name: addSourceName, exact: true })
        .filter({ hasText: addSourceName });
      // Radix makes the background inaccessible while the modal menu is open.
      // Keep the actual row/header identities across that accessibility change.
      const sourceRow = await trigger.elementHandle();
      menuOwner = await section
        .getByRole("button", { name: addSourceName, exact: true })
        .filter({ has: page.locator("svg") })
        .elementHandle();
      await trigger.click({ timeout: remaining() });
      assert(
        (await sourceRow.evaluate((node) => node.isConnected)) &&
          (await sourceRow.getAttribute("aria-expanded")) === "true",
        "Sources 空态行未打开共享菜单",
      );
      menu = page.getByRole("menu");
    } else {
      trigger = core.getByTestId("inputbar-plus-trigger");
      menuOwner = await editor.elementHandle();
      await trigger.click({ timeout: remaining() });
      menu = page
        .getByTestId("composer-context-suggestions")
        .getByRole("listbox");
    }
    await menu.waitFor({ state: "visible", timeout: remaining() });
    const menuId = await menu.getAttribute("id");
    assert(
      !!menuId &&
        (await menuOwner.evaluate((node) => node.isConnected)) &&
        (await menuOwner.getAttribute("aria-controls")) === menuId,
      "文件菜单未绑定当前表面",
    );
    await menu
      .getByRole(source === "sources" ? "menuitem" : "option", {
        name: addFilesName,
        exact: true,
      })
      .click({ timeout: remaining() });
    if (canceled) {
      await page.waitForFunction(
        (node) => node === document.activeElement,
        await editor.elementHandle(),
        { timeout: remaining() },
      );
    } else {
      const expectedImage = `data:${image.mimeType};base64,${image.buffer.toString("base64")}`;
      await core
        .locator(`img[src="${expectedImage}"]`)
        .waitFor({ state: "visible", timeout: remaining() });
      for (const selected of selectedPaths.slice(1)) {
        await core
          .getByTestId("inputbar-path-reference-chip")
          .filter({ hasText: path.basename(selected) })
          .waitFor({ state: "visible", timeout: remaining() });
      }
    }
    const calls = await dialogFixture.evaluate((state) => state.calls);
    assert(
      calls.length === 1 &&
        calls[0].properties.includes("openFile") &&
        calls[0].properties.includes("multiSelections"),
      "未命中真实Main文件选择边界",
    );
    return {
      ...ownership,
      source: `${source === "sources" ? "real Sources menu -> composer.addFiles" : "real Composer context suggestions"} -> preload/dialog IPC -> Main -> OS-result fixture -> ${canceled ? "native cancellation" : "App Server file read"}`,
      canceled,
      selectedPaths: canceled ? [] : selectedPaths,
      nativeDialogCalls: calls,
      osDialogExecuted: false,
      substitutedBoundary: "dialog.showOpenDialog result only",
    };
  } finally {
    await dialogFixture.evaluate((state) => state.restore());
    await dialogFixture.dispose();
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
