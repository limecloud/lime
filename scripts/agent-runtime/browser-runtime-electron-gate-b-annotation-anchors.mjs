import { randomUUID } from "node:crypto";
import { assert } from "../lib/chat-fixture/utils.mjs";
import {
  readBrowserAnnotationNativeIdentity,
  waitForBrowserAnnotationState as waitFor,
} from "./browser-runtime-electron-gate-b-annotation-diagnostics.mjs";
import { verifyBrowserAnnotationMarkerLifecycle } from "./browser-runtime-electron-gate-b-annotation-marker-lifecycle.mjs";

/** Drive saved markers through actual native input; IPC is observed, never injected. */
export async function verifyBrowserAnnotationAnchors(
  ctx,
  ui,
  outer,
  selected,
  initialEditor,
) {
  const { app, page, options } = ctx;
  const {
    native,
    observerKey,
    beginSelection,
    editor,
    fill,
    chip,
    label,
    capture,
  } = ui;
  const records = () =>
    app.evaluate((_electron, key) => globalThis[key].records, observerKey);
  const latestAnchor = async (id) =>
    (await records()).findLast(
      (value) => value.kind === "anchor" && value.annotationId === id,
    )?.anchor;
  const nativeIdentity = (target) =>
    readBrowserAnnotationNativeIdentity(app, target.native.webContentsId);
  const firstId = (await records()).findLast(
    (value) => value.kind === "selection",
  ).annotationId;
  const body = `anchor-first-${randomUUID()}`;
  console.log("[browser-annotation-anchors] stage=scroll");
  await outer.evaluate(() => {
    document.body.style.minHeight = "1200px";
  });
  await fill(initialEditor, body);
  const before = await nativeIdentity(initialEditor);
  const frameBounds = await native.page
    .locator("#annotation-outer")
    .boundingBox();
  await native.page.mouse.move(frameBounds.x + 9, frameBounds.y + 180);
  await native.page.mouse.wheel(0, 16);
  const moved = await waitFor(
    options,
    () => latestAnchor(firstId),
    (value) =>
      value?.targetRect && value.targetRect.y < selected.targetRect.y - 5,
    "Saved text did not follow real child-frame wheel input",
  );
  const afterScroll = await waitFor(
    options,
    () => nativeIdentity(initialEditor),
    (value) => value?.bounds.y < before.bounds.y - 5,
    "Trusted editor did not follow the saved text",
  );
  assert(
    (await initialEditor.page
      .locator('[data-testid="browser-annotation-composer"]')
      .innerText()) === body,
    "Scrolling replaced the editor body",
  );
  const owner = await app.browserWindow(page);
  const beforeViewport = await nativeIdentity(native);
  console.log("[browser-annotation-anchors] stage=resize");
  const originalBounds = await owner.evaluate((window) => window.getBounds());
  await owner.evaluate((window) => {
    const bounds = window.getBounds();
    window.setSize(bounds.width - 70, bounds.height - 40);
  });
  await waitFor(
    options,
    () => nativeIdentity(native),
    (value) => value?.bounds.height <= beforeViewport.bounds.height - 30,
    "Native Browser viewport did not resize",
  );
  const afterResize = await nativeIdentity(initialEditor);
  assert(
    afterResize && afterResize.webContentsId === before.webContentsId,
    "Resize replaced or closed the trusted editor",
  );
  assert(
    (await initialEditor.page
      .locator('[data-testid="browser-annotation-composer"]')
      .innerText()) === body,
    "Resize lost the editor draft",
  );
  await owner.evaluate(
    (window, bounds) => window.setBounds(bounds),
    originalBounds,
  );
  await waitFor(
    options,
    () => nativeIdentity(native),
    (value) =>
      value?.bounds.width === beforeViewport.bounds.width &&
      value.bounds.height === beforeViewport.bounds.height,
    "Native Browser viewport did not restore",
  );
  await initialEditor.page
    .getByRole("button", { name: label("save"), exact: true })
    .click();
  await chip(body).waitFor({ state: "visible", timeout: options.timeoutMs });

  await beginSelection();
  console.log("[browser-annotation-anchors] stage=second-marker");
  const button = await outer.locator("#frame-button").boundingBox();
  await native.page.mouse.click(
    button.x + button.width / 2,
    button.y + button.height / 2,
  );
  const secondEditor = await editor();
  const secondId = (await records()).findLast(
    (value) => value.kind === "selection",
  ).annotationId;
  const secondBody = `anchor-second-${randomUUID()}`;
  await fill(secondEditor, secondBody);
  await secondEditor.page
    .getByRole("button", { name: label("save"), exact: true })
    .click();
  await chip(secondBody).waitFor({
    state: "visible",
    timeout: options.timeoutMs,
  });
  assert(firstId !== secondId, "Saved markers shared an annotation identity");
  const lifecycle = await verifyBrowserAnnotationMarkerLifecycle(ctx, ui, {
    firstId,
    secondId,
    body,
  });

  const activateCount = async () =>
    (await records()).filter((value) => value.kind === "activate").length;
  const beforeSynthetic = await activateCount();
  await native.page.evaluate(() => {
    for (const element of document.querySelectorAll("div")) element.click();
  });
  assert(
    (await activateCount()) === beforeSynthetic,
    "Script click activated a saved annotation",
  );
  const point = await latestAnchor(firstId);
  console.log("[browser-annotation-anchors] stage=reopen-first");
  await native.page.mouse.click(
    Math.max(12, point.targetRect.x),
    Math.max(12, point.targetRect.y),
  );
  const reopened = await editor();
  assert(
    (await reopened.page
      .locator('[data-testid="browser-annotation-composer"]')
      .innerText()) === body,
    "Native marker did not reopen its own existing draft",
  );
  assert(
    (await records()).some(
      (value) =>
        value.kind === "activate" &&
        value.annotationId === firstId &&
        value.mainFrame,
    ),
    "Marker activation bypassed main-frame IPC",
  );
  await capture("anchors-multiple-page", native);
  await capture("anchors-reopened-editor", reopened);

  await native.page.mouse.move(frameBounds.x + 9, frameBounds.y + 180);
  console.log("[browser-annotation-anchors] stage=offscreen");
  await native.page.mouse.wheel(0, 700);
  await waitFor(
    options,
    () => latestAnchor(firstId),
    (value) => value?.targetRect === null,
    "Offscreen saved text did not report a missing presentation target",
  );
  const pageBounds = (await nativeIdentity(native)).bounds;
  const fallback = await waitFor(
    options,
    () => nativeIdentity(reopened),
    (value) =>
      value?.bounds.x === pageBounds.x + 8 &&
      value.bounds.y === pageBounds.y + 8,
    "Offscreen editor did not use reference top-left fallback",
  );
  assert(
    (await reopened.page
      .locator('[data-testid="browser-annotation-composer"]')
      .innerText()) === body,
    "Offscreen fallback lost the body",
  );
  await capture("anchors-offscreen-editor", reopened);
  await native.page.mouse.wheel(0, -1000);
  await waitFor(
    options,
    () => latestAnchor(firstId),
    (value) => !!value?.targetRect,
    "Saved text did not return after scrolling back",
  );
  await reopened.page
    .getByRole("button", { name: label("save"), exact: true })
    .click();
  await chip(secondBody)
    .locator("..")
    .getByRole("button", { name: label("remove"), exact: true })
    .click();
  await chip(secondBody).waitFor({
    state: "hidden",
    timeout: options.timeoutMs,
  });
  await waitFor(
    options,
    records,
    (values) =>
      values.some(
        (value) =>
          value.channel === "browser-annotation-cancelled-projection" &&
          value.annotationId === secondId,
      ),
    "Deleting a draft did not release its page marker",
  );
  assert(
    (await chip(body).count()) === 1,
    "Deleting the second marker consumed the first draft",
  );
  const restored = await latestAnchor(firstId);
  await native.page.mouse.click(
    Math.max(12, restored.targetRect.x),
    Math.max(12, restored.targetRect.y),
  );
  const finalEditor = await editor();
  return {
    editor: finalEditor,
    evidence: {
      firstId,
      secondId,
      before,
      afterScroll,
      afterResize,
      moved,
      fallback,
      lifecycle,
      physicalMarkerReopened: true,
      secondRemoved: true,
      syntheticActivationRejected: true,
    },
  };
}
