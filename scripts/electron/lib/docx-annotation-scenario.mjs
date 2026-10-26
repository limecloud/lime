import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createArtifactFrameDriver } from "./artifact-frame-driver.mjs";
import { createHash } from "node:crypto";
import { invokeAppServerFromPage } from "../../lib/chat-fixture/rpc.mjs";

export async function runDocxAnnotationScenario({
  page,
  evidenceDir,
  filePath,
  identity,
  starts,
  options,
  onStage = () => undefined,
}) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const panel = page.getByTestId("docx-preview-panel");
  const frame = createArtifactFrameDriver(
    page,
    '[data-testid="docx-preview-panel"] iframe',
  );
  const input = panel.getByRole("textbox", { name: "页码", exact: true });
  const ready = () =>
    page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="docx-preview-panel"]')
          ?.getAttribute("data-status") === "ready",
    );
  await panel.getByRole("button", { name: "适合宽度", exact: true }).click();
  await ready();
  await input.fill("2");
  await input.press("Enter");
  await ready();
  await panel.getByRole("button", { name: "添加批注", exact: true }).click();
  const location = '[data-docx-page="2"]';
  onStage("point-click");
  await frame.click(location, { x: 70, y: 100 });
  const editor = page.getByTestId("document-annotation-editor");
  const body = "DOCX_ANNOTATION_POINT_02: please update this location.";
  onStage("point-edit");
  await editor
    .getByRole("textbox", { name: "批注内容", exact: true })
    .fill(body);
  onStage("point-close");
  await editor.getByRole("button", { name: "关闭批注", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  onStage("marker-reopen");
  await frame.click({ button: "批注 1" });
  assert.equal(await editor.getByRole("textbox").inputValue(), body);
  await page.screenshot({
    path: path.join(evidenceDir, "docx-annotation-restored.png"),
  });
  onStage("point-submit");
  await editor.getByRole("button", { name: "请求修改", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  const pointTurn = await waitForTurns(page, identity.threadId, 2, options);
  assert.equal(starts().length, 2);
  const metadata = starts()[1].runtimeRequest?.metadata?.artifactAnnotation;
  assert.equal(metadata.type, "docx");
  assert.equal(metadata.path, filePath);
  assert.equal(metadata.pageNumber, 2);
  assert.equal(metadata.pageCount, 2);
  assert.equal(metadata.threadId, identity.threadId);
  assert.equal(metadata.sessionId, identity.sessionId);
  assert.equal(metadata.originatingTurnId, identity.turns[0].id);
  assert.equal(metadata.body, body);
  assert.equal(metadata.anchor.kind, "point");
  assert.equal(metadata.sourceSha256, hash(filePath));
  assert.ok(JSON.stringify(pointTurn.turns[1].items).includes(body));
  const bubble = page
    .locator('[data-message-role="user"]')
    .filter({ hasText: body });
  await bubble.waitFor({ state: "visible" });
  const display = await bubble.innerText();
  assert.ok(display.includes("Preview-report.docx · 2"));
  assert.ok(
    !display.includes("sourceSha256") &&
      !display.includes("Request changes to the DOCX"),
  );
  assert.equal(await frame.count({ button: "批注 1" }), 0);
  console.log("[document-preview] docx-point-accepted");

  // 由真实鼠标拖选产生 Selection，不向受限子文档注入脚本或状态。
  onStage("region-select");
  const text = `${location} article p:first-child`;
  assert.ok((await frame.text(text)).includes("DOCX_LAYOUT_SECOND_PAGE"));
  await frame.selectText(text);
  onStage("region-open");
  await frame.click({ button: "要求修改" });
  const selectedText = await editor.locator("blockquote").innerText();
  assert.ok(selectedText.includes("DOCX_LAYOUT_SECOND_PAGE"));
  const regionBody = "DOCX_ANNOTATION_REGION: update selected text.";
  onStage("region-edit");
  await editor.getByRole("textbox").fill(regionBody);
  await editor.getByRole("button", { name: "请求修改", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  const regionTurn = await waitForTurns(page, identity.threadId, 3, options);
  assert.equal(starts().length, 3);
  const regionMetadata =
    starts()[2].runtimeRequest?.metadata?.artifactAnnotation;
  assert.equal(regionMetadata.type, "docx");
  assert.equal(regionMetadata.anchor.kind, "region");
  assert.equal(regionMetadata.anchor.selectedText, selectedText);
  assert.ok(regionMetadata.anchor.selectionRects.length > 0);
  assert.ok(JSON.stringify(regionTurn.turns[2].items).includes(regionBody));
  console.log("[document-preview] docx-region-accepted");

  onStage("recovery-point");
  await frame.click(location, { x: 70, y: 100 });
  const recoveryBody =
    "DOCX_ANNOTATION_RECOVERY: preserve this draft across revision changes.";
  onStage("recovery-edit");
  await editor.getByRole("textbox").fill(recoveryBody);
  const oldSha = hash(filePath);
  // 合法 ZIP comment 只改变源版本，保持文档主体及分页不变。
  const bytes = fs.readFileSync(filePath);
  const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0);
  const comment = Buffer.from("DOCX_ANNOTATION_REVISED_SOURCE");
  const revised = Buffer.concat([bytes.subarray(0, eocd + 22), comment]);
  revised.writeUInt16LE(comment.length, eocd + 20);
  fs.writeFileSync(filePath, revised);
  const newSha = hash(filePath);
  assert.notEqual(newSha, oldSha);
  await editor.getByRole("button", { name: "请求修改", exact: true }).click();
  await editor.getByRole("alert").waitFor({ state: "visible" });
  assert.equal(starts().length, 3, "source revision mismatch creates no Turn");
  assert.equal(await editor.getByRole("textbox").inputValue(), recoveryBody);
  console.log("[document-preview] docx-revision-rejected-draft-retained");
  await page.screenshot({
    path: path.join(evidenceDir, "docx-annotation-file-changed.png"),
  });
  onStage("relocate");
  await editor
    .getByRole("button", { name: "在最新文件中重新定位", exact: true })
    .click();
  await editor.waitFor({ state: "detached" });
  await ready();
  await frame.click('[data-docx-page="1"]', {
    x: 80,
    y: 110,
  });
  assert.equal(await editor.getByRole("textbox").inputValue(), recoveryBody);
  assert.equal(await editor.getByRole("alert").count(), 0);
  await editor.getByRole("button", { name: "请求修改", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  const recovered = await waitForTurns(page, identity.threadId, 4, options);
  assert.equal(starts().length, 4);
  const recoveryMetadata =
    starts()[3].runtimeRequest?.metadata?.artifactAnnotation;
  assert.equal(recoveryMetadata.type, "docx");
  assert.equal(recoveryMetadata.sourceSha256, newSha);
  assert.equal(recoveryMetadata.pageNumber, 1);
  assert.equal(recoveryMetadata.body, recoveryBody);
  assert.ok(JSON.stringify(recovered.turns[3].items).includes(recoveryBody));
  console.log("[document-preview] docx-relocated-accepted");
  await page.screenshot({
    path: path.join(evidenceDir, "docx-annotation-accepted.png"),
  });
  return {
    metadata,
    regionMetadata,
    recoveryMetadata,
    oldSha,
    newSha,
    selectedText,
    turnIds: recovered.turns.map((turn) => turn.id),
  };
}

const hash = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");

async function waitForTurns(page, threadId, count, options) {
  const deadline = Date.now() + options.timeoutMs;
  let thread;
  while (Date.now() < deadline) {
    const read = await invokeAppServerFromPage(page, "thread/read", {
      threadId,
      includeTurns: true,
    });
    thread = read.result?.thread;
    if (
      thread?.turns?.length === count &&
      thread.turns[count - 1].status === "completed"
    )
      return thread;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
  assert.equal(thread?.turns?.length, count);
  assert.equal(thread.turns[count - 1].status, "completed");
  return thread;
}
