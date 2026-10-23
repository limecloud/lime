import { randomUUID } from "node:crypto";
import { assert } from "./claw-chat-current-fixture-utils.mjs";
import {
  readBrowserAnnotationCommands,
  waitForBrowserAnnotationState as waitFor,
} from "./browser-runtime-electron-gate-b-annotation-diagnostics.mjs";
import { annotationTextOf } from "./browser-runtime-electron-gate-b-annotation-evidence.mjs";
import { verifyBrowserAnnotationKeyboard } from "./browser-runtime-electron-gate-b-annotation-keyboard.mjs";
import { verifyBrowserAnnotationAnchors } from "./browser-runtime-electron-gate-b-annotation-anchors.mjs";
import { verifyBrowserAnnotationRegions } from "./browser-runtime-electron-gate-b-annotation-regions.mjs";
import { verifyBrowserAnnotationMode } from "./browser-runtime-electron-gate-b-annotation-mode.mjs";

/** Real frame documents and pointer oracles; no selection, draft or acceptance is injected. */
export async function runBrowserAnnotationFramesScenario(ctx, ui) {
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
  const frame = async (suffix) =>
    waitFor(
      options,
      () =>
        native.page
          .frames()
          .find((value) => new URL(value.url()).pathname === suffix),
      (value) => !!value,
      `Native frame ${suffix} did not load`,
    );
  const mode = await verifyBrowserAnnotationMode(ctx, ui);
  const outer = await frame("/annotation-frame"),
    nested = await frame("/annotation-nested");
  await native.page.evaluate(() => {
    for (const [id, top, width, height] of [
      ["annotation-outer", 36, 480, 380],
      ["annotation-cross", 520, 420, 100],
    ]) {
      const element = document.getElementById(id);
      Object.assign(element.style, {
        position: "fixed",
        left: "36px",
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        border: "5px solid black",
        zIndex: "1000",
        background: "white",
      });
      if (id === "annotation-outer")
        Object.assign(element.style, {
          transform: "scale(1.05)",
          transformOrigin: "top left",
        });
    }
  });
  await outer.evaluate(() => {
    document.body.style.margin = "0";
    for (const element of document.querySelectorAll("h1,p,a")) element.remove();
    Object.assign(document.getElementById("annotation-inner").style, {
      position: "absolute",
      left: "20px",
      top: "20px",
      width: "380px",
      height: "120px",
      border: "4px solid black",
      transform: "scale(1.1)",
      transformOrigin: "top left",
    });
    const host = document.getElementById("annotation-frame-shadow");
    Object.assign(host.style, {
      position: "absolute",
      top: "210px",
      left: "20px",
    });
    host.attachShadow({ mode: "open" }).innerHTML =
      '<textarea id="frame-form"></textarea>';
    const form = host.shadowRoot.querySelector("textarea");
    form.value =
      "First 😀 frame form line.\nSecond 会话内置 browser line.\nThird exact UTF-16 text.\nFourth scrolled line.";
    Object.assign(form.style, {
      display: "block",
      width: "360px",
      height: "96px",
      padding: "4px 8px",
      border: "1px solid black",
      font: "16px/24px monospace",
      boxSizing: "border-box",
    });
    Object.assign(document.getElementById("frame-button").style, {
      position: "absolute",
      left: "20px",
      top: "330px",
    });
  });
  await nested.evaluate(() => {
    for (const element of document.querySelectorAll("h1,a")) element.remove();
    document.body.style.margin = "0";
    Object.assign(document.getElementById("frame-copy").style, {
      whiteSpace: "pre-wrap",
      font: "18px/28px monospace",
      margin: "0",
      padding: "8px",
      width: "340px",
    });
  });
  for (const target of [native.page.mainFrame(), outer, nested])
    await target.evaluate(() => {
      document.body.dataset.annotationActions = "0";
      for (const type of [
        "pointerdown",
        "mousedown",
        "click",
        "input",
        "change",
        "submit",
      ])
        document.addEventListener(type, () => {
          document.body.dataset.annotationActions = String(
            Number(document.body.dataset.annotationActions) + 1,
          );
        });
    });
  const snapshot = () =>
    app.evaluate((_electron, key) => globalThis[key].records, observerKey);
  const commands = () => readBrowserAnnotationCommands(app, observerKey);
  const latest = async () =>
    (await commands()).findLast(
      (value) => value.command === "browser_tab_capture_annotation",
    )?.selection;
  const actions = async (reset = false) =>
    Promise.all(
      [native.page.mainFrame(), outer, nested].map((target) =>
        target.evaluate((reset) => {
          if (reset) document.body.dataset.annotationActions = "0";
          return document.body.dataset.annotationActions;
        }, reset),
      ),
    );
  const drag = async ({ start, end }, backward = false) => {
    const from = backward ? end : start,
      to = backward ? start : end;
    await native.page.mouse.move(from.x, from.y);
    await native.page.mouse.down();
    await native.page.mouse.move(to.x, to.y, { steps: 12 });
    await native.page.mouse.up();
  };
  const submissions = [],
    selections = [],
    oracles = [];
  let anchors;
  console.log("[browser-annotation-frames] stage=keyboard");
  const keyboard = await verifyBrowserAnnotationKeyboard(ctx, ui, outer);
  const submit = async (selected, target, name) => {
    await capture(`${name}-page`, native);
    await capture(`${name}-editor`, target);
    const body = `annotation-frames-${name}-${randomUUID()}`;
    await fill(target, body);
    await target.page
      .getByRole("button", { name: label("send"), exact: true })
      .click();
    await chip(body).waitFor({ state: "hidden", timeout: options.timeoutMs });
    const evidence = await verifySubmission(body, selected.kind);
    assert(
      !evidence.failedAssertions.length,
      `Canonical frame submission failed: ${evidence.failedAssertions.join(",")}`,
    );
    const request = providerFixture.requests.findLast((request) =>
      (request.body.messages ?? request.body.input ?? []).some(
        (message) =>
          message.role === "user" &&
          annotationTextOf(message.content).includes(body),
      ),
    );
    const text = annotationTextOf(
      (request?.body.messages ?? request?.body.input ?? []).findLast(
        (message) => message.role === "user",
      )?.content,
    );
    assert(
      text.includes(
        `Frame: ${selected.frameUrl} ${JSON.stringify(selected.framePath)}`,
      ),
      "Frame identity did not reach provider",
    );
    if (selected.kind === "text")
      assert(
        text.includes(
          `Selected page text: ${JSON.stringify(selected.targetText)}`,
        ) &&
          text.includes(
            `Text locator (UTF-16 offsets): ${JSON.stringify(selected.textLocator)}`,
          ),
        "Frame text/locator did not reach provider",
      );
    selections.push(selected);
    submissions.push({ ...evidence, frameAndLocatorDelivered: true });
  };
  for (const kind of ["dom", "form-control"]) {
    console.log(`[browser-annotation-frames] stage=${kind}`);
    const form = kind === "form-control";
    const locator = (form ? outer : nested).locator(
      form ? "#frame-form" : "#frame-copy",
    );
    if (form)
      await locator.evaluate((element) => {
        element.scrollTop = 24;
      });
    const bounds = await locator.boundingBox();
    assert(bounds, "Native frame text has no layout");
    const points = {
      start: { x: bounds.x + 16, y: bounds.y + 14 },
      end: { x: bounds.x + 260, y: bounds.y + 52 },
    };
    await browse();
    await native.page.mouse.click(bounds.x + 8, bounds.y + 8);
    await drag(points, form);
    const oracle = await locator.evaluate((element, form) => {
      if (form)
        return {
          text: element.value.slice(
            element.selectionStart,
            element.selectionEnd,
          ),
          start: element.selectionStart,
          end: element.selectionEnd,
          value: element.value,
          nativeSelection: [
            element.selectionStart,
            element.selectionEnd,
            element.selectionDirection,
          ],
          scrollTop: element.scrollTop,
        };
      const range = element.ownerDocument.defaultView
        .getSelection()
        ?.getRangeAt(0);
      if (
        !range ||
        range.startContainer !== element.firstChild ||
        range.endContainer !== element.firstChild
      )
        throw new Error(
          "Native frame DOM oracle left its controlled text node",
        );
      return {
        text: range.toString(),
        start: range.startOffset,
        end: range.endOffset,
      };
    }, form);
    assert(
      oracle.text.trim() && oracle.end > oracle.start,
      "Native frame oracle was empty",
    );
    await beginSelection();
    await actions(true);
    await drag(points, form);
    let target = await editor();
    const selected = await latest();
    assert(
      selected?.kind === "text" &&
        selected.textLocator.kind === kind &&
        selected.targetText === oracle.text &&
        selected.textLocator.startOffset === oracle.start &&
        selected.textLocator.endOffset === oracle.end &&
        selected.textLocator.direction === (form ? "backward" : "forward"),
      `Frame text differs from native oracle: ${JSON.stringify({ selected, oracle })}`,
    );
    const expectedFrames = form
      ? ["#annotation-outer"]
      : ["#annotation-outer", "#annotation-inner"];
    assert(
      JSON.stringify(selected.framePath.map((value) => value.selector)) ===
        JSON.stringify(expectedFrames),
      "Nested frame path was lost",
    );
    assert(
      new URL(selected.frameUrl).pathname ===
        (form ? "/annotation-frame" : "/annotation-nested"),
      "Frame URL was replaced by page URL",
    );
    assert(
      selected.selectionRects.length > 1 &&
        selected.selectionRects.every(
          (rect) =>
            rect.x >= bounds.x - 1 &&
            rect.y >= bounds.y - 1 &&
            rect.x + rect.width <= bounds.x + bounds.width + 1 &&
            rect.y + rect.height <= bounds.y + bounds.height + 1,
        ),
      "Frame text line geometry escaped its visible target",
    );
    if (form) {
      assert(
        selected.textLocator.shadowHosts.join(",") ===
          "#annotation-frame-shadow",
        "Frame form lost open shadow identity",
      );
      const unchanged = await locator.evaluate((element) => ({
        value: element.value,
        nativeSelection: [
          element.selectionStart,
          element.selectionEnd,
          element.selectionDirection,
        ],
        scrollTop: element.scrollTop,
      }));
      assert(
        Object.keys(unchanged).every(
          (key) =>
            JSON.stringify(unchanged[key]) === JSON.stringify(oracle[key]),
        ),
        "Frame annotation edited the form",
      );
    }
    assert(
      (await actions()).every((value) => value === "0"),
      "Annotation activated a child or parent page action",
    );
    oracles.push({ kind, ...oracle });
    if (!form) {
      const result = await verifyBrowserAnnotationAnchors(
        ctx,
        ui,
        outer,
        selected,
        target,
      );
      target = result.editor;
      anchors = result.evidence;
    }
    await submit(selected, target, kind);
  }
  console.log("[browser-annotation-frames] stage=element");
  await beginSelection();
  await actions(true);
  const button = await outer.locator("#frame-button").boundingBox();
  await native.page.mouse.click(
    button.x + button.width / 2,
    button.y + button.height / 2,
  );
  const elementEditor = await editor(),
    element = await latest();
  assert(
    element?.kind === "element" &&
      element.targetSelector === "#frame-button" &&
      element.framePath.map((value) => value.selector).join(",") ===
        "#annotation-outer",
    "Frame element did not use its child locator",
  );
  assert(
    (await actions()).every((value) => value === "0"),
    "Frame button was activated",
  );
  await submit(element, elementEditor, "element");
  const regions = await verifyBrowserAnnotationRegions(ctx, ui, outer, submit);
  console.log("[browser-annotation-frames] stage=cross-origin");
  await beginSelection();
  const cross = await native.page.locator("#annotation-cross").boundingBox();
  await native.page.mouse.click(cross.x + 30, cross.y + 30);
  const crossEditor = await editor(),
    container = await latest();
  assert(
    container?.kind === "element" &&
      container.targetSelector === "#annotation-cross" &&
      container.framePath.length === 0 &&
      container.frameUrl === container.pageUrl,
    "Cross-origin frame escaped its container",
  );
  await capture("cross-origin-container-editor", crossEditor);
  await crossEditor.page
    .getByRole("button", { name: label("close"), exact: true })
    .click();
  const stale = [];
  for (const mode of ["navigation", "detached"]) {
    console.log(`[browser-annotation-frames] stage=${mode}`);
    const bounds = await nested.locator("#frame-copy").boundingBox();
    await beginSelection();
    const before = (await snapshot()).filter(
      (value) => value.kind === "selection",
    ).length;
    await native.page.mouse.move(bounds.x + 16, bounds.y + 14);
    await native.page.mouse.down();
    await native.page.mouse.move(bounds.x + 200, bounds.y + 40, { steps: 8 });
    if (mode === "navigation") {
      const loaded = nested.waitForURL(/annotation-nested\?new=1/u, {
        waitUntil: "load",
        timeout: options.timeoutMs,
      });
      await outer.locator("#annotation-inner").evaluate((element) => {
        element.src = "/annotation-nested?new=1";
      });
      await loaded;
      await nested.evaluate(() => {
        for (const element of document.querySelectorAll("h1,a"))
          element.remove();
        document.body.style.margin = "0";
        Object.assign(document.getElementById("frame-copy").style, {
          whiteSpace: "pre-wrap",
          font: "18px/28px monospace",
          margin: "0",
          padding: "8px",
          width: "340px",
        });
      });
    } else
      await native.page
        .locator("#annotation-outer")
        .evaluate((element) => element.remove());
    await native.page.mouse.up();
    await native.page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert(
      (await snapshot()).filter((value) => value.kind === "selection")
        .length === before,
      "A retired frame drag was accepted",
    );
    await native.page.keyboard.press("Escape");
    stale.push({ mode, rejected: true });
  }
  const current = await readBrowserWorkspaceState(page),
    inputs = await snapshot();
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
    ].every((key) => current[key] === initial[key]),
    nestedDomAndShadowFormMatchNativeOracle: oracles.length === 2,
    physicalSpaceReleasesClickAndWheel: keyboard.realPageClickAndWheel,
    childAndFreshFrameKeyupRestoresSelection:
      keyboard.childFrameKeyupRestored && keyboard.lateFrameKeyupRestored,
    inputAndModifiedSpacePreserved:
      keyboard.focusedInputSpacePreserved && keyboard.modifiedSpacePreserved,
    syntheticSpaceIgnored: keyboard.syntheticSpaceIgnored,
    suspendedDragCannotCommit: keyboard.abandonedDragRejected,
    nativeViewAndWindowBlurRestoresSelection:
      keyboard.blurRestored && keyboard.paneBlurRestored,
    networkFrameLoadRetiresOldPageRevision:
      keyboard.networkFrameCancellation?.reason === "page-changed" &&
      keyboard.blankFrameCancellation?.reason === "page-changed" &&
      keyboard.newFrameAnnotationId !==
        keyboard.blankFrameCancellation.annotationId,
    modeSurvivesPaneTabAndReload:
      mode.paneHideRestored &&
      mode.tabSwitchRestored &&
      mode.reloadFreshCapability,
    physicalEscapeExitsMode: mode.escapeExited,
    exactFrameIdentityTextAndLocatorReachedProvider:
      submissions.length === 6 &&
      submissions.every((value) => value.frameAndLocatorDelivered),
    distinctTurnsAndCanonicalUserItems:
      new Set(submissions.map((value) => value.turnId)).size === 6 &&
      submissions.every(
        (value) => value.threadId === identity.threadId && !!value.userItemId,
      ),
    canonicalTextImageAndMediaBytes: submissions.every(
      (value) => !value.failedAssertions.length,
    ),
    visibleMessageImagesMatchCapture: submissions.every(
      (value) =>
        value.messagePreview.visible &&
        value.messagePreview.image.sha256 === value.image.sha256,
    ),
    savedAnchorsFollowScrollAndResize:
      !!anchors?.afterScroll && !!anchors?.afterResize,
    multipleMarkersReopenAndRemove:
      anchors?.physicalMarkerReopened === true &&
      anchors?.secondRemoved === true,
    offscreenEditorKeepsBody: !!anchors?.fallback,
    savedMarkersRestoreWithFreshTokens:
      anchors?.lifecycle.freshTokenAfterPaneAndTab === true &&
      anchors?.lifecycle.sameDocumentAndRevision === true,
    restoredMarkersReopenSavedBodies:
      anchors?.lifecycle.savedBodyReopened === true,
    agentControlRestoresOriginalSavedMarkers:
      anchors?.lifecycle.agent.originalBodyReopened === true &&
      anchors?.lifecycle.agent.freshPresentationRevision === true,
    regionNestedScrollAndScale: regions.nestedScrollAndScale,
    regionOffscreenRestoreAndImmutableCapture:
      regions.offscreenRestored && regions.captureUnchanged,
    fixedElementAndRegionUseDistinctCoordinates:
      regions.fixedElementStable && regions.fixedRegionFollowsDocument,
    crossOriginFrameRemainsContainer: container.framePath.length === 0,
    retiredFramesRejected:
      stale.length === 2 && stale.every((value) => value.rejected),
    mainFrameIpcAuthority: inputs
      .filter((value) => value.channel === "browser-annotation-page-event")
      .every(
        (value) => value.senderId === initial.webContentsId && value.mainFrame,
      ),
    noProductionMock: !trace.some(
      (value) =>
        value.fallback === true || /mock/iu.test(String(value.transport)),
    ),
    noRendererErrors: !ui.consoleErrors.length && !ui.pageErrors.length,
  };
  return {
    schemaVersion: "lime.browser_runtime_electron_gate_b.annotation_frames.v1",
    scenario: "annotation-frames",
    status: Object.values(assertions).every(Boolean) ? "pass" : "fail",
    proofLevel: "Gate B-F",
    generatedAt: new Date().toISOString(),
    claimBoundary:
      "真实Electron物理Space临时浏览、输入保护/失焦/同源frame释放与中途拖动撤销；同源嵌套frame DOM与open shadow滚动表单、正向缩放/边框坐标；持续模式在隐藏/切tab/加载后申请新选择；同文档saved marker在隐藏/切tab后以新token握手恢复，canonical Agent实际claim/observe/press与terminal释放后绑定当前展示版本并重开原正文，原capture不变；真实滚轮/resize、多marker删除及离屏top-left；主frame IPC及同一App Server/RuntimeCore canonical文本图片提交。本地provider fixture，控制turn通过真实bridge直接启动以保留GUI未提交草稿；不证明完整G03、跨文档saved anchor恢复、跨源内部或跨平台。",
    identity: { ...initial, conversationSessionId: identity.sessionId },
    selections,
    oracles,
    keyboard,
    mode,
    anchors,
    regions,
    submissions,
    providerRequestBytes: providerFixture.requests.map((request) =>
      Buffer.byteLength(JSON.stringify(request.body)),
    ),
    stale,
    crossOriginContainer: container,
    screenshots: ui.screenshots,
    nativeInputs: inputs,
    nativeCommands: await commands(),
    assertions,
    failedAssertions: Object.entries(assertions)
      .filter(([, value]) => !value)
      .map(([key]) => key),
    diagnostics: { consoleErrors: ui.consoleErrors, pageErrors: ui.pageErrors },
  };
}
