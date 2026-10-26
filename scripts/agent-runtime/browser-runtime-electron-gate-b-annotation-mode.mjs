import { assert } from "../lib/chat-fixture/utils.mjs";
import {
  waitForBrowserAnnotationState as waitFor,
  readBrowserAnnotationNativeIdentity,
} from "./browser-runtime-electron-gate-b-annotation-diagnostics.mjs";

/** Exercise the mode through native UI; no mode/draft/acceptance state is injected. */
export async function verifyBrowserAnnotationMode(ctx, ui) {
  const { app, page, options, initial } = ctx;
  const { native, beginSelection, browse, hasPicker, observerKey, capture } =
    ui;
  const records = () =>
    app.evaluate((_electron, key) => globalThis[key].records, observerKey);
  const latest = async () =>
    (await records()).findLast((record) => record.kind === "began");
  const modeButton = () =>
    page.locator('[data-testid="browser-annotation-select"]');
  const resumed = async (previous, message) => {
    await waitFor(options, hasPicker, Boolean, message);
    const next = await latest();
    assert(
      next.annotationId !== previous.annotationId,
      "Lifecycle reused an old page selection capability",
    );
    assert(
      (await modeButton().getAttribute("aria-pressed")) === "true",
      "Lifecycle lost annotation mode intent",
    );
    return next;
  };
  console.log("[browser-annotation-mode] stage=pane-hide");
  await beginSelection();
  const started = await latest();
  await page.getByTestId("thread-side-panel-toggle").click();
  const hidden = await waitFor(
    options,
    () => readBrowserAnnotationNativeIdentity(app, initial.webContentsId),
    (value) =>
      value?.visible === false ||
      value?.bounds.width === 0 ||
      value?.bounds.height === 0,
    "Browser pane did not hide its native view",
  );
  await page.getByTestId("thread-side-panel-toggle").click();
  await modeButton().waitFor({ state: "visible", timeout: options.timeoutMs });
  const afterHide = await resumed(
    started,
    "Showing the pane did not restore annotation mode",
  );
  console.log("[browser-annotation-mode] stage=tab-switch");
  await page.getByTestId("workspace-right-surface-new-tab").click();
  await page
    .getByTestId("workspace-right-surface-tab-workspace-new-tab")
    .waitFor({ state: "visible", timeout: options.timeoutMs });
  await page
    .locator(`[role="tab"][data-browser-tab-id="${initial.tabId}"]`)
    .click();
  const afterTab = await resumed(
    afterHide,
    "Returning to the Browser tab did not restore annotation mode",
  );
  console.log("[browser-annotation-mode] stage=reload");
  const loaded = native.page.waitForEvent("load", {
    timeout: options.timeoutMs,
  });
  await page.getByTestId("browser-workspace-refresh").click();
  await loaded;
  const afterReload = await resumed(
    afterTab,
    "Reload did not establish a fresh annotation picker",
  );
  await capture("mode-reloaded-page", native);
  await native.page.keyboard.press("Escape");
  await waitFor(
    options,
    () => modeButton().getAttribute("aria-pressed"),
    (value) => value === "false",
    "Physical Escape did not exit annotation mode",
  );
  assert(!(await hasPicker()), "Escape left a page input shield");
  await browse();
  return {
    started,
    hidden,
    afterHide,
    afterTab,
    afterReload,
    paneHideRestored: true,
    tabSwitchRestored: true,
    reloadFreshCapability: true,
    escapeExited: true,
  };
}
