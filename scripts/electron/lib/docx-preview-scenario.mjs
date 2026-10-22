import { selectThreadSidePanelTool } from "./thread-side-panel-navigation.mjs";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createArtifactFrameDriver } from "./artifact-frame-driver.mjs";

export function writeDocxPreviewFixture(filePath) {
  fs.copyFileSync(
    "src/components/artifact/document/__fixtures__/layout.docx",
    filePath,
  );
}

export async function runDocxPreviewScenario({ page, evidenceDir, options }) {
  const panel = page.getByTestId("docx-preview-panel");
  await page.waitForFunction(() => {
    const status = document
      .querySelector('[data-testid="docx-preview-panel"]')
      ?.getAttribute("data-status");
    return status === "ready" || status === "error";
  });
  assert.equal(await panel.getAttribute("data-status"), "ready");
  const frame = createArtifactFrameDriver(
    page,
    '[data-testid="docx-preview-panel"] iframe',
  );
  await frame.visible('[data-docx-page="1"]');
  assert.equal(
    await panel.locator("iframe").getAttribute("sandbox"),
    "allow-same-origin allow-popups",
  );
  assert.equal(await frame.count("section.docx"), 2);
  assert.ok(
    (await frame.text('[data-docx-page="1"]')).includes(
      "DOCX_LAYOUT_FIRST_PAGE",
    ),
  );
  assert.ok((await frame.text("table")).includes("Revenue"));
  assert.ok(
    (await frame.text('[data-docx-page="1"] header')).includes("DOCX_HEADER"),
  );
  // 工作台同时显示聊天与文件树；通过实际缩放控件检查可阅读尺寸的表格。
  for (let index = 0; index < 6; index++) {
    await panel.getByRole("button", { name: "放大", exact: true }).click();
    await waitForDocumentReady(page);
  }
  const table = await frame.box("table");
  assert.ok(
    table.width > 100 && table.height > 10,
    "the table uses real layout",
  );
  assert.equal(await frame.count("script,iframe,object,embed"), 0);
  assert.equal(
    (await frame.read("a"))[0].attributes.href,
    "https://example.invalid/blocked",
  );
  assert.equal((await frame.read("a"))[0].attributes.target, "_blank");
  assert.ok(!(await frame.text("body")).includes("DELETED_REVISION"));
  await page.screenshot({
    path: path.join(evidenceDir, "docx-layout-page-1.png"),
  });
  await panel.getByRole("button", { name: "下一页", exact: true }).click();
  await waitForDocumentReady(page);
  await frame.visible('[data-docx-page="2"]');
  assert.ok(
    (await frame.text('[data-docx-page="2"]')).includes(
      "DOCX_LAYOUT_SECOND_PAGE",
    ),
  );
  const before = await frame.box('[data-docx-page="2"]');
  await panel.getByRole("button", { name: "放大", exact: true }).click();
  await waitForDocumentReady(page);
  await frame.visible('[data-docx-page="2"]');
  const zoomed = await waitForGeometry(
    () => frame.box('[data-docx-page="2"]'),
    (box) => box.width > before.width,
    options,
  );
  assert.ok(
    zoomed.width > before.width,
    "zoom changes the rendered page width",
  );
  await page.screenshot({
    path: path.join(evidenceDir, "docx-layout-page-2-zoom.png"),
  });
  await panel.getByRole("button", { name: "显示修订", exact: true }).click();
  await waitForDocumentReady(page);
  assert.ok((await frame.text("body")).includes("DELETED_REVISION"));
  await page.screenshot({ path: path.join(evidenceDir, "docx-redlines.png") });
  await page.setViewportSize({ width: 780, height: 900 });
  await selectThreadSidePanelTool(page, "files");
  await panel.getByRole("button", { name: "适合宽度", exact: true }).click();
  await waitForDocumentReady(page);
  await frame.visible('[data-docx-page="1"]');
  const iframe = await panel.locator("iframe").boundingBox();
  const narrow = await waitForGeometry(
    () => frame.box('[data-docx-page="1"]'),
    (box) => box.width <= iframe.width + 1,
    options,
  );
  assert.ok(
    narrow.width <= iframe.width + 1,
    "fit width follows the narrow host",
  );
  await page.screenshot({ path: path.join(evidenceDir, "docx-narrow.png") });
  return {
    pageCount: 2,
    table,
    before,
    zoomed,
    narrow,
    iframe,
    redlines: true,
  };
}

async function waitForDocumentReady(page) {
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="docx-preview-panel"]')
        ?.getAttribute("data-status") === "ready",
  );
}

async function waitForGeometry(readBounds, predicate, options) {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const bounds = await readBounds();
    if (bounds && predicate(bounds)) return bounds;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
  assert.fail("rendered DOCX geometry did not reach the expected state");
}
