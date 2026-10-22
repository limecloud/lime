import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { openFileTab } from "./thread-side-panel-navigation.mjs";
import { createArtifactFrameDriver } from "./artifact-frame-driver.mjs";
import { presentationTextEditorMatches } from "./presentation-text-editor-dom.mjs";

const pane = '[data-testid="workspace-right-surface-active-pane"]';
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** 真编辑→共享标签close→Controller→current fs RPC；磁盘原件验证成功与冲突终态。 */
export async function runOfficeFileLifecycleScenario({
  page,
  filePath,
  format,
  evidenceDir,
  options,
}) {
  const panelId =
    format === "presentation" ? "presentation-panel" : "workbook-preview-panel";
  const panel = () => page.locator(`${pane} [data-testid="${panelId}"]`);
  const controls = () =>
    panel().getByTestId(
      format === "presentation"
        ? "presentation-editing-controls"
        : "workbook-editing-controls",
    );
  const ready = () =>
    page
      .locator(`${pane} [data-testid="${panelId}"][data-status="ready"]`)
      .waitFor({ state: "visible", timeout: options.timeoutMs });
  const original = fs.readFileSync(filePath);
  const editorValue = "OFFICE_FILE_CLOSE_NATIVE";
  const beginEdit = async (value) => {
    const edit = controls().getByRole("button", { name: "编辑", exact: true });
    if (await edit.isVisible()) await edit.click();
    else
      assert.equal(
        await controls()
          .getByRole("button", { name: "结束编辑", exact: true })
          .getAttribute("aria-pressed"),
        "true",
        "the current file controller may retain its editing mode on reopen",
      );
    if (format === "presentation") {
      const selector = `${pane} [data-testid="presentation-panel"] iframe`;
      const frame = createArtifactFrameDriver(page, selector);
      await frame.click('[data-presentation-element-id="2"]');
      await controls()
        .getByRole("button", { name: "编辑文字", exact: true })
        .click();
      await frame.click("[data-presentation-text-editor]");
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.insertText(value);
      await page.waitForFunction(presentationTextEditorMatches, {
        selector,
        value,
      });
    } else {
      await panel().getByRole("tab", { name: "预算", exact: true }).click();
      await panel().locator('[data-address="A6"]').dblclick();
      await panel()
        .getByRole("textbox", { name: "编辑 A6", exact: true })
        .fill(value);
    }
    assert.equal(await controls().getAttribute("data-dirty"), "true");
  };
  const selectedTab = () =>
    page.locator(
      '[data-testid="workspace-right-surface-tab-files"][aria-selected="true"]',
    );
  const close = async () => {
    await selectedTab()
      .locator("..")
      .getByTestId("workspace-right-surface-tab-close")
      .click();
  };
  await ready();
  await beginEdit(editorValue);
  const firstTabId = await selectedTab().getAttribute("id");
  const firstPanel = await panel().elementHandle();
  await close();
  await page.locator(`[id="${firstTabId}"]`).waitFor({ state: "detached" });
  const saved = fs.readFileSync(filePath);
  assert.notEqual(sha(saved), sha(original));
  const zip = await JSZip.loadAsync(saved);
  const xml = await zip
    .file(
      format === "presentation"
        ? "ppt/slides/slide1.xml"
        : "xl/worksheets/sheet1.xml",
    )
    .async("string");
  assert.ok(
    xml.includes(editorValue),
    "close persisted original package edits",
  );
  await openFileTab(page, filePath, options.timeoutMs);
  await ready();
  const secondTabId = await selectedTab().getAttribute("id");
  assert.equal(firstTabId, secondTabId, "file path keeps the public tab id");
  assert.equal(
    await firstPanel.evaluate((node) => node.isConnected),
    false,
    "reopening the same path mounts a fresh content instance",
  );
  await firstPanel.dispose();
  await beginEdit("OFFICE_CONFLICT_DRAFT");
  // 外部写入保留有效OOXML，用ZIP comment改变源版本，不伪造fs响应或编辑器状态。
  zip.comment = "EXTERNAL_OFFICE_REVISION";
  const external = await zip.generateAsync({ type: "nodebuffer" });
  fs.writeFileSync(filePath, external);
  await close();
  const dialog = page.getByTestId("discard-file-changes-dialog");
  await dialog.waitFor({ state: "visible", timeout: options.timeoutMs });
  assert.equal(sha(fs.readFileSync(filePath)), sha(external));
  await page.getByTestId("discard-file-changes-cancel").click();
  assert.equal(await selectedTab().getAttribute("id"), secondTabId);
  assert.equal(await controls().getAttribute("data-dirty"), "true");
  await close();
  await dialog.waitFor({ state: "visible", timeout: options.timeoutMs });
  await page.screenshot({
    path: path.join(evidenceDir, "office-close-conflict.png"),
  });
  await page.getByTestId("discard-file-changes-confirm").click();
  await page.locator(`[id="${secondTabId}"]`).waitFor({ state: "detached" });
  assert.equal(sha(fs.readFileSync(filePath)), sha(external));
  await openFileTab(page, filePath, options.timeoutMs);
  await ready();
  assert.equal(await controls().getAttribute("data-dirty"), "false");
  await page.screenshot({
    path: path.join(evidenceDir, "office-reopened.png"),
  });
  return {
    format,
    filePath,
    sourceSha256: sha(original),
    savedSha256: sha(saved),
    externalSha256: sha(external),
    activeEditSavedBeforeClose: true,
    freshContentInstance: true,
    conflictPreservedDiskAndDraft: true,
    cancelPreservedTab: true,
    explicitDiscardClosed: true,
    reopenClean: true,
  };
}
