import assert from "node:assert/strict";
import { lstat, rename } from "node:fs/promises";
import process from "node:process";
import { readBrowserDownloadHandler } from "./browser-download-file-actions.mjs";
import { inspectBrowserDownloadRow } from "./browser-download-row-interactions.mjs";
import { downloadHistoryTraceEvidence } from "./browser-runtime-electron-gate-b-download-history-evidence.mjs";

/** Only the two exercised, correlated native rejections are expected. */
export function assertExpectedDownloadFailures(trace, id) {
  assert.equal(typeof id, "string");
  assert.ok(id.length > 0);
  const errors = trace.filter((event) => event.status === "error");
  assert.equal(errors.length, 2, "Unexpected number of native action failures");
  const actions = downloadHistoryTraceEvidence(errors);
  assert.equal(actions.length, 2, "An unrelated command failed");
  for (const action of actions) {
    assert.equal(action.command, "browser_downloads_action");
    assert.equal(action.transport, "electron-ipc");
    assert.equal(action.id, id);
    assert.equal(action.action, "open");
  }
  return actions.length;
}

/** Exercise real OS failure and a moved fixture without substituting native state. */
export async function verifyBrowserDownloadFailures({
  app,
  page,
  entry,
  file,
  downloadPath,
  action,
  label,
  waitFor,
  capture,
  readList,
}) {
  assert.equal(process.platform, "darwin");
  assert.ok(file.text && file.filename.includes(".lime-download-"));
  const handler = await readBrowserDownloadHandler(downloadPath);
  assert.equal(
    handler.bundleId,
    null,
    "Fixture extension unexpectedly has a default application",
  );
  const downloads = page.getByTestId("browser-downloads-page");
  const row = downloads.locator(`li[data-download-id="${entry.id}"]`);
  const errorToast = page
    .locator('[data-sonner-toast][data-type="error"]')
    .filter({ hasText: label("operationError") });
  const readActions = () =>
    app.evaluate(() => globalThis.__browserRestartEvidence.systemActions);
  const toastPresentation = [];
  const readToastPresentation = () =>
    errorToast.evaluate((element) => {
      const style = getComputedStyle(element);
      const bounds = (target) => {
        const { x, y, width, height } = target.getBoundingClientRect();
        return { x, y, width, height };
      };
      const rect = bounds(element);
      const closeButton = bounds(element.querySelector("[data-close-button]"));
      const insideViewport = (value) =>
        value.width > 0 &&
        value.height > 0 &&
        value.x >= 0 &&
        value.y >= 0 &&
        value.x + value.width <= innerWidth &&
        value.y + value.height <= innerHeight;
      return {
        opacity: Number(style.opacity),
        animating: element
          .getAnimations()
          .some((animation) => animation.playState === "running"),
        rect,
        closeButton,
        viewport: { width: innerWidth, height: innerHeight },
        insideViewport: insideViewport(rect) && insideViewport(closeButton),
      };
    });
  const expectFailure = async () => {
    await errorToast.waitFor({ state: "visible" });
    assert.equal(await errorToast.count(), 1);
    assert.equal(await downloads.getByRole("alert").count(), 0);
    await waitFor(
      () => action(entry, "open").isEnabled(),
      Boolean,
      "Failed action remained pending",
    );
    assert.equal(await row.count(), 1);
    const initial = await readToastPresentation();
    const settled = await waitFor(
      readToastPresentation,
      (value) =>
        value.opacity === 1 && !value.animating && value.insideViewport,
      "Error toast did not settle fully inside the viewport",
    );
    toastPresentation.push({ initial, settled });
  };
  const dismissError = async () => {
    await errorToast.locator("[data-close-button]").click();
    await errorToast.waitFor({ state: "detached" });
  };
  const rowInteraction = {
    completed: await inspectBrowserDownloadRow({
      row,
      entry,
      open: action(entry, "open"),
      missingLabel: label("missing"),
    }),
  };
  await row.click({
    position: { x: 3, y: rowInteraction.completed.row.height - 4 },
  });
  await expectFailure();
  const shellActions = await readActions();
  assert.equal(shellActions.length, 1);
  assert.equal(shellActions[0].action, "open");
  assert.equal(shellActions[0].path, downloadPath);
  assert.equal(shellActions[0].status, "fulfilled");
  assert.equal(typeof shellActions[0].value, "string");
  assert.ok(
    shellActions[0].value.length > 0,
    "The system unexpectedly opened the unregistered document",
  );
  const retained = (await readList()).entries.find(
    (value) => value.id === entry.id,
  );
  assert.equal(retained?.state, "completed");
  assert.equal(retained.fileExists, true);
  await capture("system-open-failure-toast");
  await dismissError();

  const movedPath = downloadPath + ".fixture-moved";
  await assert.rejects(lstat(movedPath), (error) => error.code === "ENOENT");
  let moved = false;
  let missing;
  try {
    await rename(downloadPath, movedPath);
    moved = true;
    await action(entry, "open").press("Enter");
    await expectFailure();
    assert.deepEqual(
      await readActions(),
      shellActions,
      "Missing files reached the OS shell",
    );
    missing = (await readList()).entries.find((value) => value.id === entry.id);
    assert.equal(missing?.state, "completed");
    assert.equal(missing.fileExists, false);
    await capture("missing-file-action-toast");
    await dismissError();
    const search = downloads.getByRole("searchbox", {
      name: label("search"),
      exact: true,
    });
    await search.click();
    await search.press("ControlOrMeta+A");
    await search.pressSequentially(file.filename);
    await waitFor(
      () => action(entry, "open").count(),
      (count) => count === 0,
      "Search refresh did not reflect the missing file",
    );
    assert.ok((await row.textContent()).includes(label("missing")));
    assert.equal(await action(entry, "reveal").count(), 0);
    assert.equal(await action(entry, "remove").isEnabled(), true);
    rowInteraction.missing = await inspectBrowserDownloadRow({
      row,
      entry: missing,
      open: action(entry, "open"),
      missingLabel: label("missing"),
    });
    await capture("missing-file-refreshed");
  } finally {
    if (moved) await rename(movedPath, downloadPath);
  }
  const search = downloads.getByRole("searchbox", {
    name: label("search"),
    exact: true,
  });
  await search.press("ControlOrMeta+A");
  await search.press("Backspace");
  await waitFor(
    () => action(entry, "open").isEnabled(),
    Boolean,
    "Restored file did not recover its open capability",
  );
  const restored = (await readList()).entries.find(
    (value) => value.id === entry.id,
  );
  assert.equal(restored?.state, "completed");
  assert.equal(restored.fileExists, true);
  assert.deepEqual(await readActions(), shellActions);
  rowInteraction.restored = await inspectBrowserDownloadRow({
    row,
    entry: restored,
    open: action(entry, "open"),
    missingLabel: label("missing"),
  });
  await capture("missing-file-restored");
  return {
    id: entry.id,
    handler,
    shellActions,
    retained,
    missing,
    restored,
    expectedNativeErrorCount: 2,
    originalIdPreserved: true,
    failedActionRetryEnabled: true,
    missingFileRejectedBeforeShell: true,
    missingFileOpenUnavailableAfterSearchRefresh: true,
    restoredFileEnabled: true,
    toastDismissedThroughUi: true,
    fileMovedAndRestoredInIsolatedFixture: true,
    noGeneratedHistoryOrNativeFacts: true,
    toastPresentation,
    rowInteraction: {
      ...rowInteraction,
      systemFailureActivation: "Pointer click in blank row background",
      missingFailureActivation: "Playwright locator Enter on native button",
      physicalInput: false,
    },
  };
}
