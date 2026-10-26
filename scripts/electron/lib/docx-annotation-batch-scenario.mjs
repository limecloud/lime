import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { createArtifactFrameDriver } from "./artifact-frame-driver.mjs";
import { invokeAppServerFromPage } from "../../lib/chat-fixture/rpc.mjs";
import {
  fillComposerEditor,
  readComposerEditorText,
  composerEditorSelector,
} from "../../lib/composer-editor-dom.mjs";

export async function runDocxAnnotationBatchScenario({
  page,
  evidenceDir,
  filePath,
  identity,
  starts,
  options,
  fromComposer = false,
}) {
  const frame = createArtifactFrameDriver(
    page,
    '[data-testid="docx-preview-panel"] iframe',
  );
  const panel = page.getByTestId("docx-preview-panel");
  const editor = page.getByTestId("document-annotation-editor");
  const mainDraft = "DOCX_BATCH_MAIN_COMPOSER_DRAFT_MUST_SURVIVE";
  await fillComposerEditor(page, mainDraft, identity.sessionId);
  const composer = page.locator(
    `${composerEditorSelector(identity.sessionId)}:visible`,
  );
  const bodies = [
    "DOCX_BATCH_PAGE_1: update this paragraph.",
    "DOCX_BATCH_PAGE_2: revise this location.",
  ];
  const before = starts().length;
  const baseline = await invokeAppServerFromPage(page, "thread/read", {
    threadId: identity.threadId,
    includeTurns: true,
  });
  assert.equal(baseline.result.thread.turns.length, before);
  const originatingTurnId = baseline.result.thread.turns.at(-1).id;
  const goToPage = async (number) => {
    const input = panel.getByRole("textbox", { name: "页码", exact: true });
    await input.fill(String(number));
    await input.press("Enter");
    await frame.visible(`[data-docx-page="${number}"]`);
  };
  for (let index = 0; index < 2; index++) {
    await goToPage(index + 1);
    await frame.click(`[data-docx-page="${index + 1}"]`, { x: 75, y: 105 });
    await editor
      .getByRole("textbox", { name: "批注内容", exact: true })
      .fill(bodies[index]);
    await editor.getByRole("button", { name: "关闭批注", exact: true }).click();
    await editor.waitFor({ state: "detached" });
  }
  assert.equal(starts().length, before, "saving drafts creates no Turn");
  await frame.click({ button: "批注 2" });
  await editor.getByRole("button", { name: "上一条批注", exact: true }).click();
  assert.equal(await editor.getByRole("textbox").inputValue(), bodies[0]);
  await frame.visible('[data-docx-page="1"]');
  await editor.getByRole("button", { name: "下一条批注", exact: true }).click();
  assert.equal(await editor.getByRole("textbox").inputValue(), bodies[1]);
  await frame.visible('[data-docx-page="2"]');
  await editor.getByRole("button", { name: "关闭批注", exact: true }).click();
  const controls = page.getByTestId("document-annotation-batch-controls");
  await controls.waitFor({ state: "visible" });
  await page.screenshot({
    path: path.join(evidenceDir, "docx-batch-review.png"),
  });
  if (fromComposer) {
    const accessory = page.locator(
      '[data-testid="composer-annotation-accessory"]:visible',
    );
    await accessory
      .getByRole("button", {
        name: "Preview-report.docx · 2 条批注",
        exact: true,
      })
      .click();
    await accessory.locator("li button").filter({ hasText: bodies[0] }).click();
    const focused = page.locator(
      '[data-testid="document-annotation-editor"]:visible',
    );
    await focused.waitFor({ state: "visible" });
    assert.equal(await focused.getByRole("textbox").inputValue(), bodies[0]);
    await frame.visible('[data-docx-page="1"]');
    await focused
      .getByRole("button", { name: "关闭批注", exact: true })
      .click();
    await page.screenshot({
      path: path.join(evidenceDir, "docx-batch-composer-review.png"),
    });
    await accessory
      .getByRole("button", { name: "发送全部批注", exact: true })
      .click();
    await accessory.waitFor({ state: "detached" });
  } else {
    await controls
      .getByRole("button", { name: "发送全部批注", exact: true })
      .click();
    await controls.waitFor({ state: "detached" });
  }
  const metadata =
    starts()[before]?.runtimeRequest?.metadata?.artifactAnnotationBatch;
  assert.ok(metadata);
  assert.equal(
    starts().length,
    before + 1,
    "one batch creates exactly one Turn",
  );
  assert.equal(metadata.type, "docx");
  assert.equal(metadata.path, filePath);
  assert.equal(metadata.sessionId, identity.sessionId);
  assert.equal(metadata.threadId, identity.threadId);
  assert.equal(metadata.originatingTurnId, originatingTurnId);
  assert.equal(metadata.comments.length, 2);
  assert.equal(new Set(metadata.comments.map((comment) => comment.id)).size, 2);
  const sha256 = createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
  assert.deepEqual(
    metadata.comments.map((comment) => ({
      type: comment.type,
      path: comment.path,
      body: comment.body,
      pageNumber: comment.pageNumber,
      sourceSha256: comment.sourceSha256,
    })),
    bodies.map((body, index) => ({
      type: "docx",
      path: filePath,
      body,
      pageNumber: index + 1,
      sourceSha256: sha256,
    })),
  );
  const deadline = Date.now() + options.timeoutMs;
  let thread;
  while (Date.now() < deadline) {
    const result = await invokeAppServerFromPage(page, "thread/read", {
      threadId: identity.threadId,
      includeTurns: true,
    });
    thread = result.result?.thread;
    if (
      thread?.turns?.length === before + 1 &&
      thread.turns[before].status === "completed"
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
  assert.equal(thread?.turns.length, before + 1);
  assert.equal(thread.turns[before].status, "completed");
  for (const body of bodies)
    assert.ok(JSON.stringify(thread.turns[before].items).includes(body));
  const bubble = page
    .locator('[data-message-role="user"]')
    .filter({ hasText: bodies[0] });
  await bubble.waitFor({ state: "visible" });
  const display = await bubble.innerText();
  for (const body of bodies) assert.ok(display.includes(body));
  assert.ok(
    !display.includes("sourceSha256") &&
      !display.includes("Request changes to the DOCX"),
  );
  assert.equal(
    await frame.count("button"),
    0,
    "accepted drafts leave no marker",
  );
  assert.equal(
    await readComposerEditorText(composer),
    mainDraft,
    "batch acceptance preserves main Composer",
  );
  await page.screenshot({
    path: path.join(evidenceDir, "docx-batch-accepted.png"),
  });
  return {
    metadata,
    turnId: thread.turns[before].id,
    mainComposerPreserved: true,
    submittedFromComposer: fromComposer,
  };
}
