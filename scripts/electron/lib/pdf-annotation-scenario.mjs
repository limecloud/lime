import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { invokeAppServerFromPage } from "../../lib/chat-fixture/rpc.mjs";

export async function runPdfAnnotationScenario({
  page,
  evidenceDir,
  filePath,
  identity,
  starts,
  options,
  fromComposer = false,
}) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const panel = page.getByTestId("pdf-preview-panel");
  await panel.getByRole("button", { name: "添加批注", exact: true }).click();
  const pdfPage = panel.locator('[data-pdf-page="2"][data-rendered="true"]');
  await pdfPage.click({ position: { x: 70, y: 100 } });
  const editor = page.getByTestId("document-annotation-editor");
  const body = "PDF_ANNOTATION_POINT_02: please update this location.";
  await editor
    .getByRole("textbox", { name: "批注内容", exact: true })
    .fill(body);
  await editor.getByRole("button", { name: "关闭批注", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  // Reopen through the visible marker; its draft survives the editor's unmount.
  await panel.getByRole("button", { name: "批注 1", exact: true }).click();
  assert.equal(await editor.getByRole("textbox").inputValue(), body);
  const screenshotData = (
    await editor.locator("img").getAttribute("src")
  ).split(",")[1];
  const screenshotSha256 = createHash("sha256")
    .update(Buffer.from(screenshotData, "base64"))
    .digest("hex");
  await page.screenshot({
    path: path.join(evidenceDir, "pdf-annotation-restored.png"),
  });
  if (fromComposer) {
    await editor.getByRole("button", { name: "关闭批注", exact: true }).click();
    const accessory = page.locator(
      '[data-testid="composer-annotation-accessory"]:visible',
    );
    await accessory
      .getByRole("button", {
        name: "Preview-report.pdf · 1 条批注",
        exact: true,
      })
      .click();
    await accessory.locator("li button").filter({ hasText: body }).click();
    await editor.waitFor({ state: "visible" });
    assert.equal(await editor.getByRole("textbox").inputValue(), body);
    assert.equal(
      await panel
        .getByRole("textbox", { name: "页码", exact: true })
        .inputValue(),
      "2",
    );
    await page.waitForFunction(() => {
      const viewport = document.querySelector(
        '[data-testid="pdf-preview-pages"]',
      );
      const target = viewport?.querySelector(
        '[data-pdf-page="2"][data-rendered="true"]',
      );
      if (!viewport || !target) return false;
      const outer = viewport.getBoundingClientRect();
      const inner = target.getBoundingClientRect();
      return (
        inner.top >= outer.top - 2 &&
        inner.top <= outer.top + 32 &&
        inner.bottom > outer.top + 100
      );
    });
    await page.screenshot({
      path: path.join(evidenceDir, "pdf-composer-annotation-restored.png"),
    });
  }
  await editor.getByRole("button", { name: "请求修改", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  const deadline = Date.now() + options.timeoutMs;
  let canonical;
  while (Date.now() < deadline) {
    const read = await invokeAppServerFromPage(page, "thread/read", {
      threadId: identity.threadId,
      includeTurns: true,
    });
    canonical = read.result?.thread;
    if (
      canonical?.turns?.length === 2 &&
      canonical.turns[1].status === "completed"
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
  assert.equal(
    starts().length,
    2,
    "one accepted annotation creates exactly one further Turn",
  );
  assert.equal(canonical?.turns?.length, 2);
  assert.equal(canonical.turns[1].status, "completed");
  const request = starts()[1];
  assert.equal(request.sessionId, identity.sessionId);
  const metadata = request.runtimeRequest?.metadata?.artifactAnnotation;
  assert.ok(
    metadata,
    "canonical request retains structured annotation metadata",
  );
  assert.equal(metadata.threadId, identity.threadId);
  assert.equal(metadata.sessionId, identity.sessionId);
  assert.equal(metadata.originatingTurnId, identity.turns[0].id);
  assert.equal(metadata.path, filePath);
  assert.equal(metadata.pageNumber, 2);
  assert.equal(metadata.pageCount, 12);
  assert.equal(metadata.body, body);
  assert.equal(metadata.anchor.kind, "point");
  const image = request.inputSummary?.imageEvidence?.[0];
  assert.equal(request.inputSummary?.imageEvidence?.length, 1);
  assert.equal(image.mediaType, "image/png");
  assert.equal(image.signature, "89504e470d0a1a0a");
  assert.equal(image.sha256, screenshotSha256);
  assert.equal(image.width, metadata.screenshot.width);
  assert.equal(image.height, metadata.screenshot.height);
  assert.ok(metadata.screenshot.width > 0 && metadata.screenshot.width <= 1024);
  assert.equal(metadata.screenshot.data, undefined);
  assert.ok(!request.inputText.includes(screenshotData));
  assert.equal(
    metadata.sourceSha256,
    createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"),
  );
  assert.ok(request.inputText.includes(body));
  assert.ok(
    JSON.stringify(canonical.turns[1].items).includes(body),
    "same canonical Turn contains the submitted annotation",
  );
  assert.equal(
    await panel.getByRole("button", { name: "批注 1", exact: true }).count(),
    0,
    "accepted draft marker is retired",
  );
  const userBubble = page
    .locator('[data-message-role="user"]')
    .filter({ hasText: body });
  await userBubble.waitFor({ state: "visible" });
  const display = await userBubble.innerText();
  assert.ok(display.includes("Preview-report.pdf · 2"));
  assert.ok(
    !display.includes("sourceSha256") &&
      !display.includes("Request changes to the PDF"),
  );
  await page.screenshot({
    path: path.join(evidenceDir, "pdf-annotation-accepted.png"),
  });
  return {
    body,
    metadata,
    turnId: canonical.turns[1].id,
    items: canonical.turns[1].items.map((item) => ({
      id: item.id,
      type: item.type,
    })),
    editorRestored: true,
    composerReview: fromComposer,
  };
}

/** Select through native pointer input; no synthetic Range or business state. */
export async function runPdfRegionRecoveryScenario({
  page,
  evidenceDir,
  filePath,
  identity,
  starts,
  options,
}) {
  const panel = page.getByTestId("pdf-preview-panel");
  const pageInput = panel.getByRole("textbox", { name: "页码", exact: true });
  await pageInput.fill("2");
  await pageInput.press("Enter");
  const pdfPage = panel.locator('[data-pdf-page="2"][data-rendered="true"]');
  const text = pdfPage
    .locator(".textLayer span")
    .filter({ hasText: "PDF_PREVIEW_02" });
  await text.scrollIntoViewIfNeeded();
  const bounds = await text.boundingBox();
  assert.ok(bounds && bounds.width > 0 && bounds.height > 0);
  await page.mouse.move(bounds.x + 1, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width - 1,
    bounds.y + bounds.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
  await pdfPage.getByRole("button", { name: "要求修改", exact: true }).click();
  const editor = page.getByTestId("document-annotation-editor");
  const selectedText = await editor.locator("blockquote").innerText();
  assert.ok(selectedText.includes("PDF_PREVIEW_02"));
  const body =
    "PDF_ANNOTATION_REGION_RECOVERY: keep this text after a file revision change.";
  await editor
    .getByRole("textbox", { name: "批注内容", exact: true })
    .fill(body);
  await editor.locator("img").waitFor({ state: "visible" });
  await editor.getByRole("button", { name: "请求修改", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  const regionTurn = await waitForTurns(page, identity.threadId, 3, options);
  assert.equal(starts().length, 3);
  const regionMetadata =
    starts()[2].runtimeRequest?.metadata?.artifactAnnotation;
  assert.equal(regionMetadata.anchor.kind, "region");
  assert.equal(regionMetadata.anchor.selectedText, selectedText);
  assert.ok(regionMetadata.anchor.selectionRects.length > 0);
  assert.equal(regionMetadata.body, body);
  assert.equal(regionMetadata.pageNumber, 2);
  assert.equal(regionMetadata.threadId, identity.threadId);
  assert.equal(starts()[2].inputSummary?.imageEvidence?.length, 1);
  assert.ok(JSON.stringify(regionTurn.turns[2].items).includes(body));
  // Composer 回原文会重建预览；点批注模式是该面板的显示状态，需显式开启。
  const addComment = panel.getByRole("button", {
    name: "添加批注",
    exact: true,
  });
  if ((await addComment.getAttribute("aria-pressed")) !== "true")
    await addComment.click();
  assert.equal(await addComment.getAttribute("aria-pressed"), "true");
  await pdfPage.click({ position: { x: 70, y: 100 } });
  await editor
    .getByRole("textbox", { name: "批注内容", exact: true })
    .fill(body);
  const oldSha = createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
  // A legal trailing PDF comment changes the source identity without corrupting the file.
  fs.appendFileSync(filePath, "\n% PDF_ANNOTATION_REVISED_SOURCE\n");
  const newSha = createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
  assert.notEqual(newSha, oldSha);
  await editor.getByRole("button", { name: "请求修改", exact: true }).click();
  await editor.getByRole("alert").waitFor({ state: "visible" });
  assert.equal(
    starts().length,
    3,
    "a changed source must not start another Turn",
  );
  assert.equal(await editor.getByRole("textbox").inputValue(), body);
  await page.screenshot({
    path: path.join(evidenceDir, "pdf-annotation-file-changed.png"),
  });
  await editor
    .getByRole("button", { name: "在最新文件中重新定位", exact: true })
    .click();
  await editor.waitFor({ state: "detached" });
  await panel.locator('[data-pdf-page="1"][data-rendered="true"]').waitFor();
  await pageInput.fill("3");
  await pageInput.press("Enter");
  const relocatedPage = panel.locator(
    '[data-pdf-page="3"][data-rendered="true"]',
  );
  await relocatedPage.waitFor({ state: "visible" });
  await relocatedPage.click({ position: { x: 110, y: 130 } });
  assert.equal(await editor.getByRole("textbox").inputValue(), body);
  assert.equal(await editor.getByRole("alert").count(), 0);
  await page.screenshot({
    path: path.join(evidenceDir, "pdf-annotation-relocated.png"),
  });
  await editor.getByRole("button", { name: "请求修改", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  const canonical = await waitForTurns(page, identity.threadId, 4, options);
  assert.equal(
    starts().length,
    4,
    "relocating one draft creates exactly one further Turn",
  );
  const request = starts()[3];
  const metadata = request.runtimeRequest?.metadata?.artifactAnnotation;
  assert.equal(request.sessionId, identity.sessionId);
  assert.equal(metadata.threadId, identity.threadId);
  assert.equal(metadata.sourceSha256, newSha);
  assert.equal(metadata.pageNumber, 3);
  assert.equal(metadata.body, body);
  assert.equal(metadata.anchor.kind, "point");
  assert.equal(request.inputSummary?.imageEvidence?.length, 1);
  assert.ok(JSON.stringify(canonical.turns[3].items).includes(body));
  assert.equal(
    await panel.getByRole("button", { name: "批注 1", exact: true }).count(),
    0,
  );
  return {
    oldSha,
    newSha,
    selectedText,
    regionMetadata,
    metadata,
    turnId: canonical.turns[3].id,
  };
}

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
