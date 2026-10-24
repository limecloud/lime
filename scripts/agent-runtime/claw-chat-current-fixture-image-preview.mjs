import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export async function verifyImageOutputPreview({ page, options, taskId }) {
  const windowCount = page.context().pages().length;
  await page
    .getByTestId(`image-workbench-message-preview-single-media-${taskId}`)
    .click();
  const open = page.getByTestId("image-task-viewer-open-image");
  await open.waitFor({ state: "visible", timeout: options.timeoutMs });
  const outputUrl = await open.locator("img").getAttribute("src");
  assert.ok(outputUrl, "the selected image output must have a source");
  assert.equal(
    await page.getByTestId("image-task-viewer-action-save").count(),
    0,
  );
  await open.click();
  const preview = page.getByTestId("preview-artifact-image");
  await preview.waitFor({ state: "visible", timeout: options.timeoutMs });
  await page.waitForFunction(
    () => {
      const image = document.querySelector(
        '[data-testid="preview-artifact-image"]',
      );
      return (
        image instanceof HTMLImageElement &&
        image.complete &&
        image.naturalWidth > 1
      );
    },
    undefined,
    { timeout: options.timeoutMs },
  );
  assert.equal(
    await preview.getAttribute("src"),
    outputUrl,
    "preview must keep the selected output",
  );
  assert.equal(await page.getByTestId("image-task-viewer-stage").count(), 0);
  assert.equal(
    page.context().pages().length,
    windowCount,
    "preview uses the existing surface",
  );
  return {
    taskId,
    selectedOutputSourceSha256: createHash("sha256")
      .update(outputUrl)
      .digest("hex"),
    sameSource: true,
    loaded: true,
    taskPanelClosed: true,
    resourceImportActionAbsent: true,
    standaloneWindowOpened: false,
  };
}
