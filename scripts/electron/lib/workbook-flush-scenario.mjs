import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { invokeAppServerFromPage } from "../../lib/chat-fixture/rpc.mjs";
import {
  fillComposerEditor,
  readComposerEditorText,
  composerEditorSelector,
} from "../../lib/composer-editor-dom.mjs";

/** 提交必须先落原文件；旧 SHA 的批注保留并要求重新定位。 */
export async function runWorkbookFlushScenario({
  page,
  evidenceDir,
  filePath,
  identity,
  starts,
  options,
}) {
  const panel = page.getByTestId("workbook-preview-panel");
  const controls = panel.getByTestId("workbook-editing-controls");
  const editor = page.getByTestId("document-annotation-editor");
  const body = "WORKBOOK_FLUSH_COMMENT_MUST_SURVIVE";
  const mainDraft = "WORKBOOK_FLUSH_MAIN_DRAFT_MUST_SURVIVE";
  await fillComposerEditor(page, mainDraft, identity.sessionId);
  const composer = page.locator(
    `${composerEditorSelector(identity.sessionId)}:visible`,
  );
  const hash = () =>
    createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  const beforeSha = hash();
  const before = starts().length;
  await panel.getByRole("tab", { name: "预算", exact: true }).click();
  const position = panel.getByRole("textbox", {
    name: "单元格位置",
    exact: true,
  });
  await position.fill("A6");
  await position.press("Enter");
  await controls.getByRole("button", { name: "编辑", exact: true }).click();
  await panel.locator('[data-address="A6"]').dblclick();
  const input = panel.getByRole("textbox", { name: "编辑 A6", exact: true });
  await input.fill("WORKBOOK_AUTO_FLUSH_NATIVE");
  await input.press("Enter");
  assert.equal(await controls.getAttribute("data-dirty"), "true");
  assert.equal(hash(), beforeSha, "editing alone does not write the file");
  await position.fill("A6");
  await position.press("Enter");
  await panel.getByRole("button", { name: "添加批注", exact: true }).click();
  await editor
    .getByRole("textbox", { name: "批注内容", exact: true })
    .fill(body);
  await editor.getByRole("button", { name: "请求修改", exact: true }).click();
  await editor.getByRole("alert").waitFor({ state: "visible" });
  assert.equal(
    starts().length,
    before,
    "old annotation SHA never starts a Turn",
  );
  assert.equal(await editor.getByRole("textbox").inputValue(), body);
  assert.equal(await controls.getAttribute("data-dirty"), "false");
  const savedSha = hash();
  assert.notEqual(savedSha, beforeSha, "submission flushes unsaved file edits");
  const saved = await JSZip.loadAsync(fs.readFileSync(filePath));
  assert.match(
    await saved.file("xl/worksheets/sheet1.xml").async("string"),
    /WORKBOOK_AUTO_FLUSH_NATIVE/,
  );
  await page.screenshot({
    path: path.join(evidenceDir, "workbook-flush-file-changed.png"),
  });

  await editor
    .getByRole("button", { name: "在最新文件中重新定位", exact: true })
    .click();
  await page.waitForFunction((savedSha) => {
    const panel = document.querySelector(
      '[data-testid="workbook-preview-panel"]',
    );
    return (
      panel?.getAttribute("data-status") === "ready" &&
      panel.getAttribute("data-source-sha256") === savedSha
    );
  }, savedSha);
  await position.fill("A6");
  await position.press("Enter");
  await panel.getByRole("button", { name: "添加批注", exact: true }).click();
  assert.equal(await editor.getByRole("textbox").inputValue(), body);
  await editor.getByRole("button", { name: "请求修改", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  let thread;
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const read = await invokeAppServerFromPage(page, "thread/read", {
      threadId: identity.threadId,
      includeTurns: true,
    });
    thread = read.result?.thread;
    if (
      thread?.turns.length === before + 1 &&
      thread.turns.at(-1).status === "completed"
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
  assert.equal(thread?.id, identity.threadId);
  assert.equal(thread.turns.length, before + 1);
  assert.equal(thread.turns.at(-1).status, "completed");
  assert.equal(starts().length, before + 1);
  const comment = starts().at(-1)?.runtimeRequest?.metadata?.artifactAnnotation;
  assert.equal(comment?.body, body);
  assert.equal(comment.sourceSha256, savedSha);
  assert.equal(comment.address, "A6");
  assert.equal(comment.sheetId, "1");
  assert.equal(comment.sessionId, identity.sessionId);
  assert.equal(comment.threadId, identity.threadId);
  assert.equal(comment.originatingTurnId, identity.turns.at(-1).id);
  assert.equal(hash(), savedSha);
  assert.equal(await readComposerEditorText(composer), mainDraft);
  await controls.getByRole("button", { name: "结束编辑", exact: true }).click();
  await page.screenshot({
    path: path.join(evidenceDir, "workbook-flush-accepted.png"),
  });
  return {
    savedSha256: savedSha,
    staleAnnotationRejected: true,
    explicitRelocationAccepted: true,
    mainComposerPreserved: true,
    turnId: thread.turns.at(-1).id,
  };
}
