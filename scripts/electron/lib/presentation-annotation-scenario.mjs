import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { invokeAppServerFromPage } from "../../lib/chat-fixture/rpc.mjs";
import {
  fillComposerEditor,
  readComposerEditorText,
  composerEditorSelector,
} from "../../lib/composer-editor-dom.mjs";
import { createArtifactFrameDriver } from "./artifact-frame-driver.mjs";
import {
  presentationFrameSelector,
  waitForPresentationSlide,
} from "./presentation-preview-scenario.mjs";

export async function runPresentationAnnotationScenario({
  page,
  evidenceDir,
  filePath,
  identity,
  starts,
  options,
}) {
  const panel = page.getByTestId("presentation-panel");
  const editor = page.getByTestId("document-annotation-editor");
  const accessory = page.locator(
    '[data-testid="composer-annotation-accessory"]:visible',
  );
  const frame = createArtifactFrameDriver(page, presentationFrameSelector);
  const mainDraft = "PRESENTATION_MAIN_COMPOSER_DRAFT_MUST_SURVIVE";
  await fillComposerEditor(page, mainDraft, identity.sessionId);
  const composer = page.locator(
    `${composerEditorSelector(identity.sessionId)}:visible`,
  );
  const sha = () =>
    createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  const initialSha = sha();
  const initialStarts = starts().length;
  const select = async (number, id) => {
    const input = panel.getByRole("textbox", {
      name: "幻灯片编号",
      exact: true,
    });
    await input.fill(String(number));
    await input.press("Enter");
    await waitForPresentationSlide(page, id);
  };
  const add = async (number, id, body, point = false) => {
    await select(number, id);
    if (point) {
      const toggle = panel.getByRole("button", {
        name: "添加批注",
        exact: true,
      });
      if ((await toggle.getAttribute("aria-pressed")) !== "true")
        await toggle.click();
      const box = await frame.box("[data-slide-id]");
      await frame.click("[data-slide-id]", {
        x: box.width / 3,
        y: box.height / 3,
      });
    } else
      await panel
        .getByRole("button", { name: "要求修改", exact: true })
        .click();
    await editor.waitFor();
    assert.ok((await editor.innerText()).includes(`第 ${number} 张幻灯片`));
    await editor
      .getByRole("textbox", { name: "批注内容", exact: true })
      .fill(body);
  };
  const close = async () => {
    await editor.getByRole("button", { name: "关闭批注", exact: true }).click();
    await editor.waitFor({ state: "detached" });
  };
  const completed = async (count) => {
    let thread;
    const deadline = Date.now() + options.timeoutMs;
    while (Date.now() < deadline) {
      const read = await invokeAppServerFromPage(page, "thread/read", {
        threadId: identity.threadId,
        includeTurns: true,
      });
      thread = read.result?.thread;
      if (
        thread?.turns.length === count &&
        thread.turns.at(-1).status === "completed"
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
    }
    assert.equal(thread?.id, identity.threadId);
    assert.equal(thread.turns.length, count);
    assert.equal(thread.turns.at(-1).status, "completed");
    return thread;
  };

  const singleBody = "SLIDE_SINGLE: revise the point on slide 2.";
  await add(2, "900", singleBody, true);
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-point-comment.png"),
  });
  await close();
  await frame.click({ button: "批注 1" });
  assert.equal(await editor.getByRole("textbox").inputValue(), singleBody);
  await editor.getByRole("button", { name: "请求修改", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  const first = await completed(initialStarts + 1);
  const single =
    starts()[initialStarts]?.runtimeRequest?.metadata?.artifactAnnotation;
  assert.ok(single);
  assert.equal(starts().length, initialStarts + 1);
  assert.equal(single.type, "presentation");
  assert.equal(single.target.slideId, "900");
  assert.equal(single.slideNumber, 2);
  assert.ok(Math.abs(single.target.position.x - 320) < 3);
  assert.ok(Math.abs(single.target.position.y - 180) < 3);
  assert.deepEqual(single.slideSize, { width: 960, height: 540 });
  assert.equal(single.sourceSha256, initialSha);
  assert.equal(single.path, filePath);
  assert.equal(single.sourceFormat, "pptx");
  assert.equal(single.body, singleBody);
  assert.equal(single.sessionId, identity.sessionId);
  assert.equal(single.threadId, identity.threadId);
  assert.equal(single.originatingTurnId, identity.turns[0].id);
  assert.equal("pageNumber" in single, false);
  assert.equal(await readComposerEditorText(composer), mainDraft);

  const bodies = [
    "SLIDE_BATCH_1: change the heading.",
    "SLIDE_BATCH_3: change the final summary.",
  ];
  for (const [index, number, id] of [
    [0, 1, "512"],
    [1, 3, "300"],
  ]) {
    await add(number, id, bodies[index]);
    await close();
  }
  await accessory
    .getByRole("button", {
      name: "Preview-report.pptx · 2 条批注",
      exact: true,
    })
    .click();
  await accessory.locator("li button").filter({ hasText: bodies[0] }).click();
  await waitForPresentationSlide(page, "512");
  assert.equal(await editor.getByRole("textbox").inputValue(), bodies[0]);
  await close();
  fs.appendFileSync(filePath, "\nPRESENTATION_REVISION_CHANGED\n");
  const revisedSha = sha();
  assert.notEqual(revisedSha, initialSha);
  await accessory
    .getByRole("button", { name: "发送全部批注", exact: true })
    .click();
  await accessory.getByRole("alert").waitFor();
  assert.equal(
    starts().length,
    initialStarts + 1,
    "changed source starts no turn",
  );
  for (const body of bodies)
    assert.ok((await accessory.innerText()).includes(body));
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-source-changed.png"),
  });
  for (const [index, number, id] of [
    [0, 1, "512"],
    [1, 3, "300"],
  ]) {
    await accessory
      .locator("li button")
      .filter({ hasText: bodies[index] })
      .click();
    await waitForPresentationSlide(page, id);
    await editor
      .getByRole("button", { name: "在最新文件中重新定位", exact: true })
      .click();
    await waitForPresentationSlide(page, id);
    await page.waitForFunction(
      (expected) =>
        document
          .querySelector('[data-testid="presentation-panel"]')
          ?.getAttribute("data-source-sha256") === expected,
      revisedSha,
    );
    await select(number, id);
    await panel.getByRole("button", { name: "要求修改", exact: true }).click();
    assert.equal(await editor.getByRole("textbox").inputValue(), bodies[index]);
    await close();
  }
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-composer-review.png"),
  });
  await accessory
    .getByRole("button", { name: "发送全部批注", exact: true })
    .click();
  await accessory.waitFor({ state: "detached" });
  const thread = await completed(initialStarts + 2);
  const batch =
    starts()[initialStarts + 1]?.runtimeRequest?.metadata
      ?.artifactAnnotationBatch;
  assert.ok(batch);
  assert.equal(starts().length, initialStarts + 2, "one batch adds one turn");
  assert.equal(batch.type, "presentation");
  assert.equal(batch.path, filePath);
  assert.equal(batch.sessionId, identity.sessionId);
  assert.equal(batch.threadId, identity.threadId);
  assert.equal(batch.originatingTurnId, first.turns.at(-1).id);
  assert.equal(new Set(batch.comments.map((comment) => comment.id)).size, 2);
  assert.deepEqual(
    batch.comments.map(
      ({ type, sourceFormat, target, slideNumber, body, sourceSha256 }) => ({
        type,
        sourceFormat,
        target,
        slideNumber,
        body,
        sourceSha256,
      }),
    ),
    bodies.map((body, index) => ({
      type: "presentation",
      sourceFormat: "pptx",
      target: { slideId: index === 0 ? "512" : "300" },
      slideNumber: index === 0 ? 1 : 3,
      body,
      sourceSha256: revisedSha,
    })),
  );
  for (const original of first.turns)
    assert.deepEqual(
      thread.turns
        .find((turn) => turn.id === original.id)
        ?.items.map((item) => item.id),
      original.items.map((item) => item.id),
    );
  const bubble = page
    .locator('[data-message-role="user"]')
    .filter({ hasText: bodies[0] });
  await bubble.waitFor();
  const text = await bubble.innerText();
  for (const body of bodies) assert.ok(text.includes(body));
  assert.ok(text.includes("Slide 1") && text.includes("Slide 3"));
  assert.ok(
    !text.includes("sourceSha256") &&
      !text.includes("Request changes to the presentation"),
  );
  assert.equal(await readComposerEditorText(composer), mainDraft);
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-accepted.png"),
  });
  return {
    single,
    batch,
    turnId: thread.turns.at(-1).id,
    changedSourceRejected: true,
    mainComposerPreserved: true,
  };
}
