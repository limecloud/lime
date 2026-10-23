import { assert } from "./claw-chat-current-fixture-utils.mjs";
import { verifyBrowserAnnotationControl } from "./browser-runtime-electron-gate-b-annotation-control.mjs";
import {
  readBrowserAnnotationNativeIdentity,
  waitForBrowserAnnotationState as waitFor,
} from "./browser-runtime-electron-gate-b-annotation-diagnostics.mjs";

/** Saved marker restoration is driven through UI; credentials are only observed as digests. */
export async function verifyBrowserAnnotationMarkerLifecycle(ctx, ui, saved) {
  console.log("[browser-annotation-marker-lifecycle] stage=read-saved");
  const { app, page, options, initial } = ctx;
  const { native, observerKey, editor, chip, label, capture, beginSelection } =
    ui;
  const records = () =>
    app.evaluate((_electron, key) => globalThis[key].records, observerKey);
  const ids = [saved.firstId, saved.secondId];
  const selectionsBefore = (await records()).filter(
    (value) => value.kind === "selection",
  ).length;
  const lastAnchor = async (id) =>
    (await records()).findLast(
      (value) => value.kind === "anchor" && value.annotationId === id,
    );
  const originalRecords = await records();
  const original = ids.map((id) =>
    originalRecords.findLast(
      (value) => value.kind === "anchor" && value.annotationId === id,
    ),
  );
  assert(original.every(Boolean), "Saved marker baseline is unavailable");
  const hide = async () => {
    await page.getByTestId("thread-side-panel-toggle").click();
    await waitFor(
      options,
      () => readBrowserAnnotationNativeIdentity(app, initial.webContentsId),
      (value) => value?.visible === false || value?.bounds.width === 0,
      "Saved marker pane did not hide",
    );
  };
  const restored = async (offset, previous) => {
    const next = await waitFor(
      options,
      records,
      (values) =>
        ids.every((id) =>
          values
            .slice(offset)
            .some(
              (value) =>
                value.kind === "marker-restored" && value.annotationId === id,
            ),
        ),
      "Saved markers did not complete a fresh restore handshake",
    );
    return ids.map((id, index) => {
      const value = next
        .slice(offset)
        .findLast(
          (entry) =>
            entry.kind === "marker-restored" && entry.annotationId === id,
        );
      assert(
        value.mainFrame && value.senderId === initial.webContentsId,
        "Saved marker restoration escaped main-frame authority",
      );
      assert(
        value.tokenDigest && value.tokenDigest !== previous[index].tokenDigest,
        "Saved marker restoration reused an old token",
      );
      assert(
        value.documentDigest === original[index].documentDigest &&
          value.pageRevision === original[index].pageRevision,
        "Saved marker restoration changed the captured document or revision",
      );
      return value;
    });
  };
  const reopen = async (stage, restoredMarkers) => {
    const point = await waitFor(
      options,
      () => lastAnchor(saved.firstId),
      (value) =>
        !!value?.anchor?.targetRect &&
        value.tokenDigest === restoredMarkers[0].tokenDigest,
      "Restored marker has no live presentation target",
    );
    await native.page.mouse.click(
      Math.max(12, point.anchor.targetRect.x),
      Math.max(12, point.anchor.targetRect.y),
    );
    const target = await editor();
    assert(
      (await target.page
        .locator('[data-testid="browser-annotation-composer"]')
        .innerText()) === saved.body,
      "Restored marker lost its saved body",
    );
    await capture(`markers-${stage}-editor`, target);
    await target.page
      .getByRole("button", { name: label("save"), exact: true })
      .click();
    await chip(saved.body).waitFor({
      state: "visible",
      timeout: options.timeoutMs,
    });
    await beginSelection();
  };
  console.log("[browser-annotation-marker-lifecycle] stage=pane");
  const paneOffset = (await records()).length;
  await hide();
  await page.getByTestId("thread-side-panel-toggle").click();
  const afterPane = await restored(paneOffset, original);
  await reopen("pane", afterPane);
  console.log("[browser-annotation-marker-lifecycle] stage=tab");
  const tabOffset = (await records()).length;
  await page.getByTestId("workspace-right-surface-new-tab").click();
  await page
    .locator(
      '[data-testid="workspace-right-surface-tab-workspace-new-tab"][aria-selected="true"]',
    )
    .waitFor({ state: "visible", timeout: options.timeoutMs });
  await waitFor(
    options,
    () => readBrowserAnnotationNativeIdentity(app, initial.webContentsId),
    (value) => value?.visible === false || value?.bounds.width === 0,
    "Saved marker tab did not detach",
  );
  await page
    .locator(`[role="tab"][data-browser-tab-id="${initial.tabId}"]`)
    .click();
  const afterTab = await restored(tabOffset, afterPane);
  await reopen("tab", afterTab);
  const agent = await verifyBrowserAnnotationControl(ctx, ui, saved, afterTab);
  assert(
    (await records()).filter((value) => value.kind === "selection").length ===
      selectionsBefore,
    "Restoration created another annotation",
  );
  return {
    original,
    afterPane,
    afterTab,
    agent,
    freshTokenAfterPaneAndTab: true,
    sameDocumentAndRevision: true,
    savedBodyReopened: true,
  };
}
