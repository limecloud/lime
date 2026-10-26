import { randomUUID } from "node:crypto";
import { assert } from "../lib/chat-fixture/utils.mjs";
import {
  readBrowserAnnotationCommands,
  waitForBrowserAnnotationState as waitFor,
} from "./browser-runtime-electron-gate-b-annotation-diagnostics.mjs";
import { annotationTextOf } from "./browser-runtime-electron-gate-b-annotation-evidence.mjs";

/** Native form selections supply the oracle; no selection, draft or acceptance is injected. */
export async function runBrowserAnnotationFormTextScenario(ctx, ui) {
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
    browse,
    editor,
    fill,
    chip,
    label,
    capture,
    verifySubmission,
  } = ui;
  await native.page.evaluate(() => {
    const article = document.createElement("article");
    article.id = "annotation-form-fixture";
    Object.assign(article.style, {
      position: "fixed",
      zIndex: "1000",
      inset: "20px",
      padding: "20px",
      background: "white",
      color: "black",
    });
    article.innerHTML =
      '<label>Textarea<textarea id="form-multiline"></textarea></label><label>Text input<input id="form-input"></label><section id="form-shadow"></section><label>Scaled input<input id="form-scaled"></label><label>Password<input id="form-password" type="password"></label>';
    article
      .querySelector("#form-shadow")
      .attachShadow({ mode: "open" }).innerHTML =
      '<label>Scrolled shadow textarea<textarea id="form-scrolled"></textarea></label>';
    const controls = [
      ...article.querySelectorAll("textarea,input"),
      article
        .querySelector("#form-shadow")
        .shadowRoot.querySelector("textarea"),
    ];
    for (const control of controls) {
      control.value =
        control.tagName === "TEXTAREA"
          ? "First 😀 line with exact text.\nSecond 会话内置 browser text.\nThird form line.\nFourth visible after scrolling.\nFifth UTF-16 fixture."
          : "Codex 会话 browser 😀 exact form input text";
      Object.assign(control.style, {
        display: "block",
        boxSizing: "border-box",
        width: "360px",
        height: control.tagName === "TEXTAREA" ? "96px" : "38px",
        padding: "4px 8px",
        border: "1px solid black",
        font: "16px/24px monospace",
        margin: "4px 0 12px",
      });
    }
    const scaled = article.querySelector("#form-scaled");
    scaled.style.transform = "scale(1.2)";
    scaled.style.transformOrigin = "top left";
    article.dataset.pageActions = "0";
    for (const type of [
      "pointerdown",
      "mousedown",
      "click",
      "input",
      "change",
      "submit",
    ])
      article.addEventListener(type, () => {
        article.dataset.pageActions = String(
          Number(article.dataset.pageActions) + 1,
        );
      });
    document.body.append(article);
  });
  const snapshot = () =>
    app.evaluate((_electron, key) => globalThis[key].records, observerKey);
  const commands = () => readBrowserAnnotationCommands(app, observerKey);
  const latestCapture = async () =>
    (await commands()).findLast(
      (value) => value.command === "browser_tab_capture_annotation",
    );
  const controlState = (selector) =>
    native.page.locator(selector).evaluate((element) => ({
      value: element.value,
      start: element.selectionStart,
      end: element.selectionEnd,
      direction: element.selectionDirection,
      scrollTop: element.scrollTop,
      scrollLeft: element.scrollLeft,
    }));
  const drag = async (points, backwards = false) => {
    const from = backwards ? points.end : points.start,
      to = backwards ? points.start : points.end;
    await native.page.mouse.move(from.x, from.y);
    await native.page.mouse.down();
    await native.page.mouse.move(to.x, to.y, { steps: 12 });
    await native.page.mouse.up();
  };
  const resetActions = () =>
    native.page.locator("#annotation-form-fixture").evaluate((element) => {
      element.dataset.pageActions = "0";
    });
  const readActions = () =>
    native.page
      .locator("#annotation-form-fixture")
      .getAttribute("data-page-actions");
  const cases = [
    { selector: "#form-multiline", multiline: true },
    { selector: "#form-input", backwards: true },
    { selector: "#form-scrolled", multiline: true, scroll: 48, shadow: true },
    { selector: "#form-scaled", backwards: true },
  ];
  const selections = [],
    submissions = [],
    nativeOracles = [],
    snapshotLifecycles = [];
  for (const test of cases) {
    console.log(`[browser-annotation-form-text] stage=${test.selector}`);
    await app.evaluate(({ app }) => app.focus({ steal: true }));
    await native.page.locator(test.selector).evaluate((element, scroll) => {
      element.scrollTop = scroll ?? 0;
    }, test.scroll);
    const bounds = await native.page.locator(test.selector).boundingBox();
    assert(bounds, "Form control has no real layout");
    const points = {
      start: {
        x: bounds.x + 24,
        y: bounds.y + (test.multiline ? 17 : bounds.height / 2),
      },
      end: {
        x: bounds.x + 240,
        y: bounds.y + (test.multiline ? 65 : bounds.height / 2),
      },
    };
    // Observe real native offsets at the same pointer coordinates before enabling annotation mode.
    await browse();
    await drag(points, test.backwards);
    const oracle = await controlState(test.selector);
    assert(
      Number.isInteger(oracle.start) && oracle.end > oracle.start,
      "Native form selection did not produce a text oracle",
    );
    const expectedText = oracle.value.slice(oracle.start, oracle.end);
    const nativeHit = await native.page.evaluate((point) => {
      const hits = [];
      let hit = document.elementFromPoint(point.x, point.y);
      while (hit) {
        const style = getComputedStyle(hit);
        hits.push({
          tag: hit.tagName,
          id: hit.id,
          userSelect: style.userSelect,
          visibility: style.visibility,
          transform: style.transform,
          scrollTop: hit.scrollTop,
        });
        if (!hit.shadowRoot) break;
        hit = hit.shadowRoot.elementFromPoint(point.x, point.y);
      }
      return hits;
    }, points.start);
    console.log(
      `[browser-annotation-form-text] native-oracle=${JSON.stringify({ selector: test.selector, oracle, nativeHit, points })}`,
    );
    await beginSelection();
    await resetActions();
    const before = await controlState(test.selector);
    await drag(points, test.backwards);
    const target = await editor();
    const observedCommands = await commands();
    const captureIndex = observedCommands.findLastIndex(
      (value) => value.command === "browser_tab_capture_annotation",
    );
    const snapshotFinished = observedCommands
      .slice(captureIndex + 1)
      .some(
        (value) =>
          value.command === "browser_tab_cancel_annotation" &&
          value.status === "success",
      );
    assert(
      snapshotFinished,
      "The completed annotation snapshot did not retire its page picker",
    );
    snapshotLifecycles.push({
      selector: test.selector,
      pickerRetiredBeforeEditor: true,
    });
    const selected = (await latestCapture())?.selection;
    assert(
      selected?.kind === "text" && selected.textLocator.kind === "form-control",
      `Form drag did not produce form text: ${JSON.stringify({ selected, oracle, nativeHit, before })}`,
    );
    assert(
      selected.targetText === expectedText &&
        selected.textLocator.startOffset === oracle.start &&
        selected.textLocator.endOffset === oracle.end &&
        selected.textLocator.direction ===
          (test.backwards ? "backward" : "forward"),
      `Form text differs from native selection: ${JSON.stringify({ selected, oracle })}`,
    );
    assert(
      !Object.hasOwn(selected.textLocator, "rangeText"),
      "Form locator invented DOM rangeText",
    );
    if (test.multiline)
      assert(
        new Set(selected.selectionRects.map((rect) => rect.y)).size > 1,
        "Form selection lost individual lines",
      );
    if (test.shadow)
      assert(
        selected.textLocator.shadowHosts.join(",") === "#form-shadow",
        "Form selection lost its shadow identity",
      );
    assert(
      selected.selectionRects.every(
        (rect) =>
          rect.x >= bounds.x - 0.1 &&
          rect.y >= bounds.y - 0.1 &&
          rect.x + rect.width <= bounds.x + bounds.width + 0.1 &&
          rect.y + rect.height <= bounds.y + bounds.height + 0.1,
      ),
      "Selected form rectangles escaped the control",
    );
    assert(
      JSON.stringify(await controlState(test.selector)) ===
        JSON.stringify(before),
      "Annotation changed the form value or native selection",
    );
    assert((await readActions()) === "0", "Annotation activated a page action");
    assert(
      (await native.page
        .locator("[data-browser-comment-text-selection-mirror]")
        .count()) === 0,
      "A measurement mirror leaked into the document",
    );
    const title = await target.page
      .getByTestId("browser-annotation-selection")
      .innerText();
    assert(
      title.includes(label("text")) &&
        (await target.page
          .getByTestId("browser-annotation-selection")
          .getAttribute("title")) === expectedText,
      "Form text did not reach the existing editor",
    );
    await capture(`form-${test.selector.slice(6)}-page`, native);
    await capture(`form-${test.selector.slice(6)}-editor`, target);
    const body = `annotation-form-${test.selector.slice(1)}-${randomUUID()}`;
    await fill(target, body);
    await target.page
      .getByRole("button", { name: label("send"), exact: true })
      .click();
    await chip(body).waitFor({ state: "hidden", timeout: options.timeoutMs });
    const result = await verifySubmission(body, "text");
    assert(
      !result.failedAssertions.length,
      `Canonical form submission failed: ${result.failedAssertions.join(",")}`,
    );
    const request = providerFixture.requests.findLast((request) =>
      (request.body.messages ?? request.body.input ?? []).some(
        (message) =>
          message.role === "user" &&
          annotationTextOf(message.content).includes(body),
      ),
    );
    const providerText = annotationTextOf(
      (request?.body.messages ?? request?.body.input ?? []).findLast(
        (message) => message.role === "user",
      )?.content,
    );
    assert(
      providerText.includes(
        `Selected page text: ${JSON.stringify(expectedText)}`,
      ) &&
        providerText.includes(
          `Text locator (UTF-16 offsets): ${JSON.stringify(selected.textLocator)}`,
        ),
      "Exact form text and locator did not reach the provider",
    );
    selections.push(selected);
    nativeOracles.push({ ...test, ...oracle });
    submissions.push({ ...result, exactTextAndLocatorDelivered: true });
  }
  console.log("[browser-annotation-form-text] stage=protected-fields");
  const protectedResults = [];
  for (const mode of ["password", "protected", "rotated"]) {
    await native.page.locator("#form-password").evaluate((element, mode) => {
      element.type = mode === "password" ? "password" : "text";
      element.style.setProperty(
        "-webkit-text-security",
        mode === "protected" ? "disc" : "none",
      );
      element.style.transform = mode === "rotated" ? "rotate(2deg)" : "none";
    }, mode);
    const bounds = await native.page.locator("#form-password").boundingBox();
    await beginSelection();
    await resetActions();
    // A protected form cannot start a text gesture; give its region fallback real area.
    await drag({
      start: { x: bounds.x + 24, y: bounds.y + bounds.height / 2 },
      end: { x: bounds.x + 240, y: bounds.y + bounds.height / 2 + 6 },
    });
    const target = await editor();
    const selected = (await latestCapture())?.selection;
    assert(
      selected &&
        selected.kind !== "text" &&
        !selected.textLocator &&
        !selected.targetText,
      `${mode}: unsafe form text was exposed`,
    );
    assert(
      (await readActions()) === "0",
      `${mode}: page actions were activated`,
    );
    protectedResults.push({ mode, kind: selected.kind, textExposed: false });
    await target.page
      .getByRole("button", { name: label("close"), exact: true })
      .click();
  }
  console.log(
    "[browser-annotation-form-text] stage=changed-value-and-detached",
  );
  const staleResults = [];
  for (const remove of [false, true]) {
    const selector = "#form-input";
    const bounds = await native.page.locator(selector).boundingBox();
    await beginSelection();
    const before = (await snapshot()).filter(
      (value) => value.kind === "selection",
    ).length;
    await native.page.mouse.move(bounds.x + 24, bounds.y + 18);
    await native.page.mouse.down();
    await native.page.mouse.move(bounds.x + 220, bounds.y + 18, { steps: 8 });
    await native.page.locator(selector).evaluate((element, remove) => {
      if (remove) element.remove();
      else element.value = "Script replaced the old form value";
    }, remove);
    await native.page.mouse.up();
    await native.page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const after = (await snapshot()).filter(
      (value) => value.kind === "selection",
    ).length;
    assert(before === after, "Stale form drag was accepted");
    staleResults.push({ remove, rejected: true });
    await native.page.keyboard.press("Escape");
  }
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
    nativeSelectionOracleMatchesAllForms: nativeOracles.length === 4,
    multilineAndScrolledSelection:
      selections.filter((value) => value.selectionRects.length > 1).length >= 2,
    forwardBackwardAndUnicode:
      selections.some((value) => value.targetText.includes("😀")) &&
      selections.some((value) => value.textLocator.direction === "backward"),
    openShadowFormLocator: selections.some(
      (value) => value.textLocator.shadowHosts.join(",") === "#form-shadow",
    ),
    exactFormTextAndLocatorReachedProvider:
      submissions.length === 4 &&
      submissions.every((value) => value.exactTextAndLocatorDelivered),
    canonicalTextImageAndMediaBytes: submissions.every(
      (value) => !value.failedAssertions.length,
    ),
    visibleMessageImagesMatchCapture: submissions.every(
      (value) =>
        value.messagePreview.visible &&
        value.messagePreview.image.sha256 === value.image.sha256,
    ),
    distinctCanonicalTurnsSameThread:
      new Set(submissions.map((value) => value.turnId)).size === 4 &&
      submissions.every((value) => value.threadId === identity.threadId),
    changedAndDetachedFormsRejected:
      staleResults.length === 2 &&
      staleResults.every((value) => value.rejected),
    passwordProtectedAndRotatedTextRejected:
      protectedResults.length === 3 &&
      protectedResults.every((value) => !value.textExposed),
    pagePickerRetiredAfterSnapshot:
      snapshotLifecycles.length === 4 &&
      snapshotLifecycles.every((value) => value.pickerRetiredBeforeEditor),
    realNativeIpc: (await snapshot())
      .filter((value) => value.channel === "browser-annotation-page-event")
      .every(
        (value) => value.senderId === initial.webContentsId && value.mainFrame,
      ),
    noProductionMock: !trace.some(
      (value) =>
        value.fallback === true || /mock/iu.test(String(value.transport)),
    ),
    noRendererErrors:
      ui.consoleErrors.length === 0 && ui.pageErrors.length === 0,
  };
  return {
    schemaVersion:
      "lime.browser_runtime_electron_gate_b.annotation_form_text.v1",
    scenario: "annotation-form-text",
    status: Object.values(assertions).every(Boolean) ? "pass" : "fail",
    proofLevel: "Gate B-F",
    generatedAt: new Date().toISOString(),
    claimBoundary:
      "真实 Electron 同一 WCV 主 frame 与 open shadow 表单文字、原生鼠标选区 oracle、正反向/多行/滚动/缩放、同一可信编辑器和 App Server/RuntimeCore canonical 文本图片/media 字节提交。显式本地 provider；不证明跨 frame、完整 G03 或完整设置/原生服务。",
    pending: [
      "cross-frame text",
      "scroll following",
      "persistent selection and keyboard",
      "native password/autofill services",
      "full reference visual comparison",
      "packaged macOS/Windows",
    ],
    identity: { ...initial, conversationSessionId: identity.sessionId },
    selections,
    nativeOracles,
    snapshotLifecycles,
    submissions,
    staleResults,
    protectedResults,
    screenshots: ui.screenshots,
    nativeInputs: await snapshot(),
    nativeCommands: await commands(),
    assertions,
    failedAssertions: Object.entries(assertions)
      .filter(([, value]) => !value)
      .map(([key]) => key),
    diagnostics: { consoleErrors: ui.consoleErrors, pageErrors: ui.pageErrors },
  };
}
