import {
  replaceFileTab,
  selectThreadSidePanelTool,
} from "./thread-side-panel-navigation.mjs";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createArtifactFrameDriver } from "./artifact-frame-driver.mjs";

export const presentationFrameSelector =
  '[data-testid="presentation-panel"] iframe';

export function writePresentationPreviewFixture(filePath) {
  fs.copyFileSync(
    "src/components/artifact/presentation/__fixtures__/review.pptx",
    filePath,
  );
  fs.writeFileSync(
    path.join(path.dirname(filePath), "Broken.pptx"),
    "invalid presentation",
  );
}

export async function waitForPresentationSlide(page, slideId) {
  await page.waitForFunction((slideId) => {
    const panel = document.querySelector('[data-testid="presentation-panel"]');
    const slide = panel
      ?.querySelector("iframe")
      ?.contentDocument?.querySelector("[data-slide-id]");
    return (
      panel?.getAttribute("data-status") === "ready" &&
      slide?.getAttribute("data-slide-id") === slideId &&
      slide.getBoundingClientRect().width > 0
    );
  }, slideId);
  assert.equal(
    await page.getByText(/该产物(?:为|是)二进制.*暂不支持在工作台预览/).count(),
    0,
    "supported PPTX never shows an unsupported binary preview notice",
  );
}

export async function runPresentationPreviewScenario({
  page,
  evidenceDir,
  filePath,
}) {
  const panel = page.getByTestId("presentation-panel");
  const frame = createArtifactFrameDriver(page, presentationFrameSelector);
  await waitForPresentationSlide(page, "512");
  assert.ok((await frame.text("[data-slide-id]")).includes("SLIDE_PREVIEW_01"));
  assert.equal(
    await panel.locator("iframe").getAttribute("sandbox"),
    "allow-same-origin",
  );
  assert.equal(await frame.count("script,iframe,a[href],[onclick]"), 0);
  // 展开动画尚在改变容器宽度时，正数尺寸不构成缩放往返的基线。
  await page.waitForFunction(
    async () => {
      const panel = document.querySelector(
        '[data-testid="presentation-panel"]',
      );
      const content = panel?.querySelector("iframe")?.contentDocument;
      const slide = content?.querySelector("[data-slide-id]");
      const mount = content?.getElementById("slide");
      if (!panel || !slide || !mount) return false;
      const moving = () => {
        for (let node = panel; node; node = node.parentElement)
          if (
            node
              .getAnimations()
              .some(
                (animation) =>
                  (animation.pending || animation.playState === "running") &&
                  Number.isFinite(
                    animation.effect?.getComputedTiming().endTime,
                  ),
              )
          )
            return true;
        return false;
      };
      const geometry = () => {
        const container = panel.getBoundingClientRect();
        const rendered = slide.getBoundingClientRect();
        return [container.x, container.y, container.width, rendered.width];
      };
      if (moving()) return false;
      const before = geometry();
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      return (
        !moving() &&
        geometry().every((value, index) => value === before[index]) &&
        before[3] > 0 &&
        Math.abs(before[3] - Math.min(panel.clientWidth, mount.clientWidth)) < 2
      );
    },
    undefined,
    { timeout: 15_000 },
  );
  const before = await frame.box("[data-slide-id]");
  const geometry = [];
  const recordGeometry = async (phase) => {
    geometry.push({
      phase,
      before,
      actual: await page.evaluate(() => {
        const panel = document.querySelector(
          '[data-testid="presentation-panel"]',
        );
        const frame = panel?.querySelector("iframe");
        const content = frame?.contentDocument;
        const mount = content?.getElementById("slide");
        const slide = content?.querySelector("[data-slide-id]");
        return {
          panelWidth: panel?.getBoundingClientRect().width,
          panelClientWidth: panel?.clientWidth,
          frameWidth: frame?.getBoundingClientRect().width,
          mountWidth: mount?.style.width,
          mountTransform: mount?.style.transform,
          slideWidth: slide?.getBoundingClientRect().width,
          slideStyleWidth: slide?.style.width,
        };
      }),
    });
    fs.writeFileSync(
      path.join(evidenceDir, "presentation-preview-geometry.json"),
      JSON.stringify(geometry, null, 2) + "\n",
    );
  };
  await recordGeometry("before");
  const waitForGeometry = async (zoomed) => {
    try {
      await page.waitForFunction(
        ({ width, zoomed }) => {
          const slide = document
            .querySelector('[data-testid="presentation-panel"] iframe')
            ?.contentDocument?.querySelector("[data-slide-id]");
          const actual = slide?.getBoundingClientRect().width;
          return (
            actual !== undefined &&
            (zoomed ? actual > width * 1.2 : Math.abs(actual - width) < 2)
          );
        },
        { width: before.width, zoomed },
        { timeout: 15_000 },
      );
    } finally {
      await recordGeometry(zoomed ? "zoom" : "fit");
    }
  };
  await panel.getByRole("button", { name: "放大", exact: true }).click();
  await waitForGeometry(true);
  const zoomed = await frame.box("[data-slide-id]");
  assert.ok(
    zoomed.width > before.width * 1.2,
    "zoom changes actual slide geometry",
  );
  await panel.getByRole("button", { name: "适合宽度", exact: true }).click();
  await waitForGeometry(false);
  assert.ok(
    Math.abs((await frame.box("[data-slide-id]")).width - before.width) < 2,
  );
  await panel.getByRole("button", { name: "下一张", exact: true }).click();
  await waitForPresentationSlide(page, "900");
  assert.ok((await frame.text("[data-slide-id]")).includes("SLIDE_PREVIEW_02"));
  await panel.getByRole("button", { name: "下一张", exact: true }).click();
  await waitForPresentationSlide(page, "300");
  assert.ok((await frame.text("[data-slide-id]")).includes("SLIDE_PREVIEW_03"));
  assert.equal(
    await panel
      .getByRole("button", { name: "下一张", exact: true })
      .isDisabled(),
    true,
  );
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-slide3.png"),
  });
  const number = panel.getByRole("textbox", {
    name: "幻灯片编号",
    exact: true,
  });
  await number.fill("1");
  await number.press("Enter");
  await waitForPresentationSlide(page, "512");
  await page.setViewportSize({ width: 980, height: 760 });
  await selectThreadSidePanelTool(page, "files");
  await waitForPresentationSlide(page, "512");
  await page.waitForFunction(() => {
    const panel = document.querySelector('[data-testid="presentation-panel"]');
    const slide = panel
      ?.querySelector("iframe")
      ?.contentDocument?.querySelector("[data-slide-id]");
    const width = slide?.getBoundingClientRect().width ?? 0;
    return width > 0 && width <= panel.getBoundingClientRect().width + 1;
  });
  const narrow = await frame.box("[data-slide-id]");
  const viewport = await panel.boundingBox();
  assert.ok(
    narrow.width <= viewport.width + 1,
    "fit width survives narrow layout",
  );
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-narrow.png"),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });

  const open = async (filename) => {
    await replaceFileTab(page, path.join(path.dirname(filePath), filename));
  };
  await open("Broken.pptx");
  await panel.getByRole("alert").waitFor();
  assert.equal(await panel.getAttribute("data-status"), "error");
  fs.copyFileSync(filePath, path.join(path.dirname(filePath), "Broken.pptx"));
  await panel.getByRole("button", { name: "重试", exact: true }).click();
  await waitForPresentationSlide(page, "512");
  await open(path.basename(filePath));
  await waitForPresentationSlide(page, "512");
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-preview-ready.png"),
  });
  return {
    slideIds: ["512", "900", "300"],
    zoom: true,
    narrowFit: true,
    errorRetry: true,
    scriptsAllowed: false,
  };
}
