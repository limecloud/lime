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
import { createArtifactFrameDriver } from "./artifact-frame-driver.mjs";
import {
  presentationFrameSelector,
  waitForPresentationSlide,
} from "./presentation-preview-scenario.mjs";
import { presentationTextEditorMatches } from "./presentation-text-editor-dom.mjs";

/** 活动输入经真实提交/自动保存/flush 落盘；旧 SHA 拒绝并保稿，重新定位后才可发送。 */
export async function runPresentationFlushScenario({
  page,
  evidenceDir,
  filePath,
  identity,
  starts,
  options,
}) {
  const panel = page.getByTestId("presentation-panel");
  const controls = panel.getByTestId("presentation-editing-controls");
  const editor = page.getByTestId("document-annotation-editor");
  const frame = createArtifactFrameDriver(page, presentationFrameSelector);
  const body = "PRESENTATION_FLUSH_COMMENT_MUST_SURVIVE";
  const value = "PPTX_FLUSH_BEFORE_COMMENT";
  const mainDraft = "PRESENTATION_FLUSH_MAIN_DRAFT_MUST_SURVIVE";
  const sha = () =>
    createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  const readThread = async () => {
    const read = await invokeAppServerFromPage(page, "thread/read", {
      threadId: identity.threadId,
      includeTurns: true,
    });
    assert.equal(read.result?.thread?.id, identity.threadId);
    return read.result.thread;
  };
  const assertPreviousTurns = (thread, previous) => {
    for (const original of previous.turns)
      assert.deepEqual(
        thread.turns.find((turn) => turn.id === original.id)?.items,
        original.items,
        `existing canonical items stay unchanged: ${original.id}`,
      );
  };
  const selectSlide = async () => {
    const number = panel.getByRole("textbox", {
      name: "幻灯片编号",
      exact: true,
    });
    await number.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText("1");
    await page.keyboard.press("Enter");
    await waitForPresentationSlide(page, "512");
  };

  await fillComposerEditor(page, mainDraft, identity.sessionId);
  const composer = page.locator(
    `${composerEditorSelector(identity.sessionId)}:visible`,
  );
  await selectSlide();
  const initialSha = sha();
  const beforeStarts = starts().length;
  const beforeThread = await readThread();
  assert.equal(await panel.getAttribute("data-source-sha256"), initialSha);
  assert.equal(await controls.getAttribute("data-dirty"), "false");
  await panel.getByRole("button", { name: "要求修改", exact: true }).click();
  await editor
    .getByRole("textbox", { name: "批注内容", exact: true })
    .fill(body);
  assert.ok((await editor.innerText()).includes("第 1 张幻灯片"));
  await editor.getByRole("button", { name: "关闭批注", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  // 在旧版本 marker 仍存在时重开，后续保留批注卡，不与自动保存竞争旧 marker。
  await frame.click({ button: "批注 1" });
  assert.equal(await editor.getByRole("textbox").inputValue(), body);

  await controls.getByRole("button", { name: "编辑", exact: true }).click();
  const elements = await frame.read(
    "[data-slide-id] > button[data-presentation-element-id]",
  );
  assert.ok(elements.length > 0, "slide 1 exposes a top-level editable object");
  const elementId = elements[0].attributes["data-presentation-element-id"];
  assert.match(elementId, /^\d+$/);
  await frame.click(
    `[data-slide-id] > button[data-presentation-element-id="${elementId}"]`,
    { x: 8, y: 8 },
  );
  await controls.getByRole("button", { name: "编辑文字", exact: true }).click();
  await frame.click("[data-presentation-text-editor]", { x: 8, y: 8 });
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(value);
  await page.waitForFunction(
    presentationTextEditorMatches,
    { selector: presentationFrameSelector, value, ready: true },
    { timeout: options.timeoutMs },
  );
  assert.equal(await controls.getAttribute("data-dirty"), "true");
  assert.equal(await controls.getAttribute("data-saving"), "false");
  assert.equal(
    sha(),
    initialSha,
    "active uncommitted text editor keeps original bytes",
  );
  assert.equal(await panel.getAttribute("data-source-sha256"), initialSha);
  assert.equal(
    await panel.locator("iframe").getAttribute("sandbox"),
    "allow-same-origin",
  );
  assert.equal(await frame.count("script,iframe,a[href],[onclick]"), 0);
  assert.equal(await editor.getByRole("textbox").inputValue(), body);
  const beforeSubmitSha = sha();
  // 原生点击会先 blur/提交编辑器。无论自动保存或此处 flush 先完成，都必须保存后拒绝旧 SHA。
  await editor.getByRole("button", { name: "请求修改", exact: true }).click();
  await editor.getByRole("alert").waitFor({ state: "visible" });
  await editor
    .getByRole("button", { name: "在最新文件中重新定位", exact: true })
    .waitFor({ state: "visible" });
  assert.equal(
    starts().length,
    beforeStarts,
    "old annotation SHA starts no Turn",
  );
  const rejectedThread = await readThread();
  assert.equal(rejectedThread.turns.length, beforeThread.turns.length);
  assertPreviousTurns(rejectedThread, beforeThread);
  assert.equal(await editor.getByRole("textbox").inputValue(), body);
  await page.waitForFunction(
    (initialSha) => {
      const panel = document.querySelector(
        '[data-testid="presentation-panel"]',
      );
      const controls = panel?.querySelector(
        '[data-testid="presentation-editing-controls"]',
      );
      return (
        panel?.getAttribute("data-status") === "ready" &&
        panel.getAttribute("data-source-sha256") !== initialSha &&
        controls?.getAttribute("data-dirty") === "false" &&
        controls.getAttribute("data-saving") === "false" &&
        !panel
          .querySelector("iframe")
          ?.contentDocument?.querySelector("[data-presentation-text-editor]")
      );
    },
    initialSha,
    { timeout: options.timeoutMs },
  );
  const savedSha = sha();
  assert.notEqual(
    savedSha,
    initialSha,
    "file edits are persisted before the stale annotation is rejected",
  );
  assert.equal(await panel.getAttribute("data-source-sha256"), savedSha);
  const savedZip = await JSZip.loadAsync(fs.readFileSync(filePath));
  const savedSlide = savedZip.file("ppt/slides/slide1.xml");
  assert.ok(savedSlide, "the saved file remains a PPTX with slide 1");
  assert.ok((await savedSlide.async("string")).includes(value));
  await waitForPresentationSlide(page, "512");
  assert.ok((await frame.text("[data-slide-id]")).includes(value));
  assert.equal(await readComposerEditorText(composer), mainDraft);
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-flush-file-changed.png"),
  });
  await controls.getByRole("button", { name: "结束编辑", exact: true }).click();

  await editor
    .getByRole("button", { name: "在最新文件中重新定位", exact: true })
    .click();
  await editor.waitFor({ state: "detached" });
  await page.waitForFunction(
    (savedSha) => {
      const panel = document.querySelector(
        '[data-testid="presentation-panel"]',
      );
      return (
        panel?.getAttribute("data-status") === "ready" &&
        panel.getAttribute("data-source-sha256") === savedSha
      );
    },
    savedSha,
    { timeout: options.timeoutMs },
  );
  await selectSlide();
  await panel.getByRole("button", { name: "要求修改", exact: true }).click();
  assert.equal(await editor.getByRole("textbox").inputValue(), body);
  await editor.getByRole("button", { name: "请求修改", exact: true }).click();
  await editor.waitFor({ state: "detached" });

  let thread;
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    thread = await readThread();
    if (
      thread.turns.length === beforeThread.turns.length + 1 &&
      thread.turns.at(-1).status === "completed"
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
  assert.equal(thread?.id, identity.threadId);
  assert.equal(thread.turns.length, beforeThread.turns.length + 1);
  assert.equal(thread.turns.at(-1).status, "completed");
  assertPreviousTurns(thread, beforeThread);
  assert.equal(starts().length, beforeStarts + 1);
  const comment = starts().at(-1)?.runtimeRequest?.metadata?.artifactAnnotation;
  assert.ok(comment);
  assert.equal(comment.type, "presentation");
  assert.equal(comment.path, filePath);
  assert.equal(comment.sourceFormat, "pptx");
  assert.equal(comment.sourceSha256, savedSha);
  assert.equal(comment.body, body);
  assert.deepEqual(comment.target, { slideId: "512" });
  assert.equal(comment.slideNumber, 1);
  assert.equal(comment.slideCount, 3);
  assert.deepEqual(comment.slideSize, { width: 960, height: 540 });
  assert.equal(comment.sessionId, identity.sessionId);
  assert.equal(comment.threadId, identity.threadId);
  assert.equal(comment.originatingTurnId, identity.turns.at(-1).id);
  const bubble = page
    .locator('[data-message-role="user"]')
    .filter({ hasText: body });
  await bubble.waitFor();
  const bubbleText = await bubble.innerText();
  assert.ok(bubbleText.includes(body) && bubbleText.includes("Slide 1"));
  assert.ok(
    !bubbleText.includes("sourceSha256") &&
      !bubbleText.includes("Request changes to the presentation"),
  );
  assert.equal(sha(), savedSha);
  assert.equal(await readComposerEditorText(composer), mainDraft);
  assert.equal(
    await panel.locator("iframe").getAttribute("sandbox"),
    "allow-same-origin",
  );
  assert.equal(await frame.count("script,iframe,a[href],[onclick]"), 0);
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-flush-accepted.png"),
  });
  return {
    initialSha256: initialSha,
    savedSha256: savedSha,
    elementId,
    comment,
    staleAnnotationRejected: true,
    explicitRelocationAccepted: true,
    mainComposerPreserved: true,
    activeTextEditorBeforeSubmit: true,
    beforeSubmitSha256: beforeSubmitSha,
    saveTrigger: "native-text-blur/current-autosave-or-flush",
    turnId: thread.turns.at(-1).id,
  };
}
