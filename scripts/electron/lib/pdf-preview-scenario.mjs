import { selectThreadSidePanelTool } from "./thread-side-panel-navigation.mjs";
import fs from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";

export function writePdfPreviewFixture(file, pageCount = 12) {
  const objects = [];
  const add = (text) => {
    objects.push(text);
    return objects.length;
  };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(
    `<< /Type /Pages /Count ${pageCount} /Kids [${Array.from({ length: pageCount }, (_, i) => `${4 + i * 2} 0 R`).join(" ")}] >>`,
  );
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (let index = 0; index < pageCount; index++) {
    const landscape = index % 3 === 1;
    const width = landscape ? 800 : 600;
    const height = landscape ? 600 : 800;
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
    );
    const stream = `0.15 0.55 0.35 rg 35 35 ${width - 70} 140 re f\n0 0 0 rg BT /F1 24 Tf 40 ${height - 60} Td (PDF_PREVIEW_${String(index + 1).padStart(2, "0")}) Tj ET\n`;
    add(
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    );
  }
  let data = "%PDF-1.7\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(data));
    data += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(data);
  data += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(file, data);
}

export async function runPdfPreviewScenario({
  page,
  evidenceDir,
  result = { pages: [], screenshots: [] },
}) {
  const panel = page.getByTestId("pdf-preview-panel");
  await page.waitForFunction(() => {
    const status = document
      .querySelector('[data-testid="pdf-preview-panel"]')
      ?.getAttribute("data-status");
    return status === "ready" || status === "error";
  });
  assert.equal(
    await panel.getAttribute("data-status"),
    "ready",
    "PDF loading must reach a successful terminal state",
  );
  const ready = async (number) => {
    const visible = panel.locator(
      `[data-pdf-page="${number}"][data-rendered="true"]`,
    );
    await visible.waitFor({ state: "visible" });
    return visible.evaluate((element) => {
      const canvas = element.querySelector("canvas");
      const pixels = canvas
        .getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let colored = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] < 220 && pixels[i + 1] < 220) colored++;
      return {
        page: Number(element.dataset.pdfPage),
        width: canvas.width,
        height: canvas.height,
        colored,
        text: element.querySelector(".textLayer")?.textContent,
      };
    });
  };
  const screenshot = async (name) => {
    const file = path.join(evidenceDir, name + ".png");
    await page.screenshot({ path: file });
    result.screenshots.push(file);
  };
  const first = await ready(1);
  assert.ok(
    first.colored > 1000 && first.text.includes("PDF_PREVIEW_01"),
    "real PDF pixels and selectable text",
  );
  result.pages.push(first);
  result.layout = await panel.evaluate((element) => {
    const scroll = element.querySelector('[data-testid="pdf-preview-pages"]');
    return {
      mountedPages: element.querySelectorAll("[data-pdf-page]").length,
      clientHeight: scroll.clientHeight,
      scrollHeight: scroll.scrollHeight,
      ancestors: [
        element,
        element.parentElement,
        element.parentElement.parentElement,
      ].map((node) => ({
        height: node.clientHeight,
        className: node.className,
      })),
    };
  });
  await page.waitForFunction(() => {
    const count = document.querySelectorAll(
      '[data-testid="pdf-preview-panel"] [data-pdf-page]',
    ).length;
    return count > 0 && count < 6;
  });
  assert.ok(
    (await panel.locator("[data-pdf-page]").count()) < 6,
    "PDF pages use viewport virtualization",
  );
  await screenshot("pdf-page-1");
  const input = panel.getByRole("textbox", { name: "页码" });
  await input.fill("9");
  await input.press("Enter");
  const ninth = await ready(9);
  assert.ok(ninth.text.includes("PDF_PREVIEW_09"));
  result.pages.push(ninth);
  await panel.getByRole("button", { name: "放大", exact: true }).click();
  await page.waitForFunction((before) => {
    const page = document.querySelector(
      '[data-pdf-page="9"][data-rendered="true"] canvas',
    );
    return page && page.width > before;
  }, ninth.width);
  result.zoom = await ready(9);
  await screenshot("pdf-page-9-zoom");
  await input.fill("2");
  await input.press("Enter");
  const landscape = await ready(2);
  assert.ok(
    landscape.width > landscape.height &&
      landscape.text.includes("PDF_PREVIEW_02"),
  );
  result.pages.push(landscape);
  await screenshot("pdf-landscape");
  await page.setViewportSize({ width: 780, height: 900 });
  await selectThreadSidePanelTool(page, "files");
  await panel.getByRole("button", { name: "适合宽度", exact: true }).click();
  await ready(2);
  result.narrow = await panel.evaluate((element) => ({
    width: element.clientWidth,
    overflow: element.scrollWidth - element.clientWidth,
  }));
  assert.ok(result.narrow.overflow <= 1, "PDF controls fit narrow surface");
  await screenshot("pdf-narrow");
  return result;
}
