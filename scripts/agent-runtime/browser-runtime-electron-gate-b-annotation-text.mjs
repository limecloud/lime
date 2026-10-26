import { randomUUID } from "node:crypto";
import { assert } from "../lib/chat-fixture/utils.mjs";
import {
  readBrowserAnnotationCommands,
  waitForBrowserAnnotationState as waitFor,
} from "./browser-runtime-electron-gate-b-annotation-diagnostics.mjs";
import { annotationTextOf } from "./browser-runtime-electron-gate-b-annotation-evidence.mjs";

/** Controlled DOM content only; selections, drafts and acceptance are never injected. */
export async function runBrowserAnnotationTextScenario(ctx, ui) {
  const {
    app,
    page,
    options,
    initial,
    identity,
    providerFixture,
    readBrowserWorkspaceState,
    readInvokeTrace,
  } = ctx;
  const {
    native,
    observerKey,
    beginSelection,
    editor,
    fill,
    chip,
    label,
    capture,
    verifySubmission,
  } = ui;
  await native.page.evaluate(() => {
    const article = document.createElement("article");
    article.id = "annotation-text-fixture";
    Object.assign(article.style, {
      position: "fixed",
      zIndex: "1000",
      inset: "24px",
      padding: "24px",
      background: "white",
      color: "black",
      font: "18px/28px sans-serif",
    });
    article.innerHTML =
      '<p id="annotation-copy">Codex <strong>会话内置</strong> browser 😀 text.<span>Second line with exact UTF-16 offsets.</span></p><p id="annotation-stale">This text will be removed during a drag.</p><p id="annotation-protected">Normal <span>protected sentinel</span> end.</p><section id="annotation-shadow"></section>';
    article.querySelector("#annotation-copy > span").style.display = "block";
    article
      .querySelector("#annotation-protected > span")
      .style.setProperty("-webkit-text-security", "disc");
    article
      .querySelector("#annotation-shadow")
      .attachShadow({ mode: "open" }).innerHTML =
      '<p id="copy">Open shadow text 😀 fixture.</p>';
    article.dataset.pageActions = "0";
    for (const name of ["pointerdown", "mousedown", "click"])
      article.addEventListener(name, () => {
        article.dataset.pageActions = String(
          Number(article.dataset.pageActions) + 1,
        );
      });
    document.body.append(article);
  });
  const points = (selector, shadow = false) =>
    native.page.evaluate(
      ({ selector, shadow }) => {
        const root = shadow
          ? document.querySelector("#annotation-shadow").shadowRoot
          : document;
        const element = root.querySelector(selector);
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let node;
        while ((node = walker.nextNode())) nodes.push(node);
        const range = document.createRange();
        const first = nodes[0],
          last = nodes.at(-1);
        const point = (text, offset) => {
          const caret = document.createRange();
          caret.setStart(text, offset);
          caret.collapse(true);
          const rect = caret.getClientRects()[0];
          if (!rect) throw new Error("Fixture caret has no actual layout");
          return { x: rect.x + 0.05, y: rect.y + rect.height / 2 };
        };
        range.setStart(first, 1);
        range.setEnd(last, last.length - 1);
        return {
          start: point(first, 1),
          end: point(last, last.length - 1),
          expectedText: range.toString(),
        };
      },
      { selector, shadow },
    );
  const drag = async (geometry, backwards = false) => {
    const from = backwards ? geometry.end : geometry.start,
      to = backwards ? geometry.start : geometry.end;
    await native.page.mouse.move(from.x, from.y);
    await native.page.mouse.down();
    await native.page.mouse.move(to.x, to.y, { steps: 12 });
    await native.page.mouse.up();
  };
  const snapshot = async () =>
    app.evaluate((_electron, key) => globalThis[key].records, observerKey);
  const selectionCount = async () =>
    (await snapshot()).filter(
      (entry) =>
        entry.channel === "browser-annotation-page-event" &&
        entry.kind === "selection",
    ).length;
  const latestCapture = async () =>
    (await readBrowserAnnotationCommands(app, observerKey)).findLast(
      (entry) => entry.command === "browser_tab_capture_annotation",
    );
  const submissions = [];
  const selections = [];
  for (const backwards of [false, true]) {
    console.log(
      `[browser-annotation-text] stage=${backwards ? "backward" : "forward"}-select-and-send`,
    );
    const geometry = await points("#annotation-copy");
    await beginSelection();
    await drag(geometry, backwards);
    const target = await editor();
    const summary = await target.page
      .getByTestId("browser-annotation-selection")
      .innerText();
    assert(
      summary.includes(label("text")) &&
        summary.includes(geometry.expectedText),
      "Text target did not reach the existing native editor",
    );
    const captured = await latestCapture();
    const selected = captured?.selection;
    assert(
      captured?.screenshotStatus === "captured" && selected?.kind === "text",
      "Text capture did not finish on the real Host",
    );
    assert(
      selected.targetText === geometry.expectedText &&
        selected.textLocator.rangeText === geometry.expectedText &&
        selected.textLocator.direction ===
          (backwards ? "backward" : "forward") &&
        new Set(selected.selectionRects.map((rect) => rect.y)).size >= 2,
      "Real multi-line Unicode text range was not preserved",
    );
    selections.push(selected);
    const body = `annotation-text-${backwards ? "backward" : "forward"}-${randomUUID()}`;
    await fill(target, body);
    await capture(`text-${backwards ? "backward" : "forward"}-page`, native);
    await capture(`text-${backwards ? "backward" : "forward"}-editor`, target);
    await target.page
      .getByRole("button", { name: label("send"), exact: true })
      .click();
    await chip(body).waitFor({ state: "hidden", timeout: options.timeoutMs });
    const submission = await verifySubmission(body, "text");
    assert(
      !submission.failedAssertions.length,
      `Text submission failed: ${submission.failedAssertions.join(",")}`,
    );
    const providerText = annotationTextOf(
      (
        providerFixture.requests.findLast((request) =>
          (request.body.messages ?? request.body.input ?? []).some(
            (message) =>
              message.role === "user" &&
              annotationTextOf(message.content).includes(body),
          ),
        )?.body.messages ?? []
      ).findLast((message) => message.role === "user")?.content,
    );
    assert(
      providerText.includes(
        `Selected page text: ${JSON.stringify(geometry.expectedText)}`,
      ) &&
        providerText.includes(
          `Text locator (UTF-16 offsets): ${JSON.stringify(selected.textLocator)}`,
        ),
      "Provider did not receive exact selected text and locator",
    );
    submissions.push({ ...submission, exactTextAndLocatorDelivered: true });
  }

  const shadowPoints = await points("#copy", true);
  console.log("[browser-annotation-text] stage=shadow-save-reopen-delete");
  await beginSelection();
  await drag(shadowPoints);
  const shadowEditor = await editor();
  const shadow = (await latestCapture())?.selection;
  assert(
    shadow?.kind === "text" &&
      shadow.targetText === shadowPoints.expectedText &&
      shadow.textLocator.shadowHosts.join(",") === "#annotation-shadow",
    "Open shadow text lost its locator identity",
  );
  const savedBody = `annotation-shadow-${randomUUID()}`;
  await fill(shadowEditor, savedBody);
  await shadowEditor.page
    .getByRole("button", { name: label("save"), exact: true })
    .click();
  await chip(savedBody).waitFor({
    state: "visible",
    timeout: options.timeoutMs,
  });
  const window = await app.browserWindow(page);
  await app.evaluate(({ app }) => app.focus({ steal: true }));
  await window.evaluate((owner) => owner.focus());
  await waitFor(
    options,
    () => window.evaluate((owner) => owner.isFocused()),
    (focused) => focused,
    "Native owner did not regain focus before reopening its draft",
  );
  await chip(savedBody).click();
  const reopened = await editor();
  assert(
    (
      await reopened.page.getByTestId("browser-annotation-composer").innerText()
    ).includes(savedBody),
    "Saved text comment body was not retained",
  );
  assert(
    (
      await reopened.page
        .getByTestId("browser-annotation-selection")
        .innerText()
    ).includes(shadowPoints.expectedText),
    "Reopened text comment lost its original target",
  );
  await capture("text-shadow-reopened", reopened);
  await reopened.page
    .getByRole("button", { name: label("save"), exact: true })
    .click();
  await chip(savedBody).waitFor({
    state: "visible",
    timeout: options.timeoutMs,
  });
  await chip(savedBody)
    .locator("..")
    .getByRole("button", { name: label("remove"), exact: true })
    .click();
  await chip(savedBody).waitFor({
    state: "hidden",
    timeout: options.timeoutMs,
  });

  const rejectDrag = async (selector, remove) => {
    console.log(
      `[browser-annotation-text] stage=reject-${remove ? "detached" : "protected"}-text`,
    );
    const geometry = await points(selector);
    await beginSelection();
    const before = await selectionCount();
    const cancelsBefore = (await snapshot()).filter(
      (entry) => entry.kind === "cancel",
    ).length;
    await native.page.mouse.move(geometry.start.x, geometry.start.y);
    await native.page.mouse.down();
    await native.page.mouse.move(geometry.end.x, geometry.end.y, { steps: 8 });
    if (remove)
      await native.page
        .locator(selector)
        .evaluate((element) => element.remove());
    await native.page.mouse.up();
    await native.page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert(
      (await selectionCount()) === before,
      `${selector}: unsafe or detached text created a selection`,
    );
    await native.page.keyboard.press("Escape");
    await waitFor(
      options,
      snapshot,
      (records) =>
        records.filter(
          (entry) =>
            entry.channel === "browser-annotation-page-event" &&
            entry.kind === "cancel",
        ).length > cancelsBefore,
      "Cancelled invalid text drag did not reach the Host",
    );
  };
  await rejectDrag("#annotation-protected", false);
  await rejectDrag("#annotation-stale", true);
  const actions = await native.page
    .locator("#annotation-text-fixture")
    .getAttribute("data-page-actions");
  const workspace = await readBrowserWorkspaceState(page);
  const trace = [
    ...(readInvokeTrace?.() ?? []),
    ...(await page.evaluate(() =>
      JSON.parse(localStorage.getItem("lime_invoke_trace_buffer_v1") || "[]"),
    )),
  ];
  const assertions = {
    sameCanonicalBrowserAndThread: [
      "sessionId",
      "threadId",
      "tabId",
      "viewId",
      "webContentsId",
    ].every((key) => workspace[key] === initial[key]),
    textForwardAndBackwardAcrossLines:
      selections.length === 2 &&
      selections.every(
        (value) =>
          new Set(value.selectionRects.map((rect) => rect.y)).size >= 2,
      ),
    exactUnicodeTextAndLocatorsReachedProvider: submissions.every(
      (value) => value.exactTextAndLocatorDelivered,
    ),
    canonicalTextImageAndMediaBytes: submissions.every(
      (value) => !value.failedAssertions.length,
    ),
    visibleMessageImagesMatchCapture: submissions.every(
      (value) =>
        value.messagePreview.visible &&
        value.messagePreview.image.sha256 === value.image.sha256,
    ),
    distinctCanonicalTurnsSameThread:
      submissions[0].turnId !== submissions[1].turnId &&
      submissions.every((value) => value.threadId === identity.threadId),
    openShadowSelectionSaveReopenDelete:
      shadow?.kind === "text" && shadow.textLocator.shadowHosts.length === 1,
    protectedAndDetachedSelectionsRejected: (await selectionCount()) === 3,
    pageActionsSuppressed: actions === "0",
    realNativeIpc: (await snapshot())
      .filter((entry) => entry.channel === "browser-annotation-page-event")
      .every(
        (entry) => entry.senderId === initial.webContentsId && entry.mainFrame,
      ),
    noProductionMock: !trace.some(
      (entry) =>
        entry.fallback === true || /mock/iu.test(String(entry.transport)),
    ),
    noRendererErrors:
      ui.consoleErrors.length === 0 && ui.pageErrors.length === 0,
  };
  return {
    schemaVersion: "lime.browser_runtime_electron_gate_b.annotation_text.v1",
    scenario: "annotation-text",
    status: Object.values(assertions).every(Boolean) ? "pass" : "fail",
    proofLevel: "Gate B-F",
    generatedAt: new Date().toISOString(),
    claimBoundary:
      "真实 Electron 同一 WCV 主 frame DOM 与 open shadow 文本拖选、可信编辑器、保存/重开/删除、反向多行 Unicode、保护文本/断开节点拒绝，preload/IPC、App Server、RuntimeCore、canonical Thread/Turn/Item、media/read 与显式本地 provider 的精确文本和截图字节。未证明 live provider、表单文字、跨 frame、完整 G03 或设置视觉。",
    pending: [
      "form-control text",
      "cross-frame text",
      "scroll following",
      "multiple anchors",
      "Design Tweaks",
      "packaged macOS/Windows",
    ],
    identity: { ...initial, conversationSessionId: identity.sessionId },
    selections,
    shadow,
    submissions,
    screenshots: ui.screenshots,
    nativeInputs: await snapshot(),
    nativeCommands: await readBrowserAnnotationCommands(app, observerKey),
    assertions,
    failedAssertions: Object.entries(assertions)
      .filter(([, value]) => !value)
      .map(([key]) => key),
    diagnostics: { consoleErrors: ui.consoleErrors, pageErrors: ui.pageErrors },
  };
}
