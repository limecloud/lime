import { randomUUID } from "node:crypto";
import { assert } from "./claw-chat-current-fixture-utils.mjs";
import {
  readBrowserAnnotationCommands,
  readBrowserAnnotationNativeIdentity,
  waitForBrowserAnnotationState as waitFor,
} from "./browser-runtime-electron-gate-b-annotation-diagnostics.mjs";

/** Native input creates every selection; diagnostics only observe the real host. */
export async function verifyBrowserAnnotationRegions(ctx, ui, outer, submit) {
  const { app, options } = ctx;
  const { native, observerKey, beginSelection, editor, fill, capture } = ui;
  const inputs = () =>
    app.evaluate((_electron, key) => globalThis[key].records, observerKey);
  const anchor = async (id) =>
    (await inputs()).findLast(
      (record) => record.kind === "anchor" && record.annotationId === id,
    )?.anchor;
  const identity = (target) =>
    readBrowserAnnotationNativeIdentity(app, target.native.webContentsId);
  const selected = async () =>
    (await readBrowserAnnotationCommands(app, observerKey)).findLast(
      (record) => record.command === "browser_tab_capture_annotation",
    )?.selection;
  const annotationId = async () =>
    (await inputs()).findLast((record) => record.kind === "selection")
      .annotationId;
  const bodyOf = (target) =>
    target.page
      .locator('[data-testid="browser-annotation-composer"]')
      .innerText();
  const drag = async (rect) => {
    await native.page.mouse.move(rect.x + 30, rect.y + 55);
    await native.page.mouse.down();
    await native.page.mouse.move(rect.x + 180, rect.y + 110, { steps: 12 });
    await native.page.mouse.up();
  };
  const sameEditor = async (target, before, body) => {
    const after = await identity(target);
    assert(
      after?.webContentsId === before.webContentsId &&
        (await bodyOf(target)) === body,
      "Region geometry replaced the trusted editor or its body",
    );
    return after;
  };
  console.log("[browser-annotation-regions] stage=nested-scroll");
  await outer.evaluate(() => {
    const container = document.createElement("div");
    container.id = "region-scroll-outer";
    Object.assign(container.style, {
      position: "absolute",
      left: "16px",
      top: "20px",
      width: "420px",
      height: "290px",
      overflow: "auto",
      background: "white",
      zIndex: "2000",
    });
    const content = document.createElement("div");
    Object.assign(content.style, {
      width: "900px",
      height: "1000px",
      position: "relative",
    });
    const inner = document.createElement("div");
    inner.id = "region-scroll-inner";
    Object.assign(inner.style, {
      position: "absolute",
      left: "30px",
      top: "30px",
      width: "320px",
      height: "190px",
      overflow: "auto",
      transform: "scale(1.05)",
      transformOrigin: "top left",
    });
    const pixels = document.createElement("div");
    Object.assign(pixels.style, {
      width: "800px",
      height: "900px",
      background: "linear-gradient(135deg, #dcfce7, #a5b4fc)",
    });
    inner.append(pixels);
    content.append(inner);
    container.append(content);
    document.body.append(container);
  });
  const bounds = await outer.locator("#region-scroll-inner").boundingBox();
  await beginSelection();
  await drag(bounds);
  const regionEditor = await editor(),
    region = await selected(),
    regionId = await annotationId();
  assert(
    region.kind === "region" &&
      region.framePath.map((step) => step.selector).join(",") ===
        "#annotation-outer",
    "Region discarded its originating frame",
  );
  const original = JSON.stringify(region);
  const body = `region-scroll-${randomUUID()}`;
  await fill(regionEditor, body);
  const before = await identity(regionEditor);
  const wheel = async (locator, point, delta) => {
    const initial = await locator.evaluate((element) => element.scrollTop);
    await native.page.mouse.move(point.x, point.y);
    await native.page.mouse.wheel(0, delta);
    return waitFor(
      options,
      () => locator.evaluate((element) => element.scrollTop),
      (value) => value !== initial,
      "Native region wheel did not scroll its intended container",
    );
  };
  const inner = outer.locator("#region-scroll-inner");
  const innerScroll = await wheel(
    inner,
    { x: bounds.x + 10, y: bounds.y + 140 },
    16,
  );
  const innerAnchor = await waitFor(
    options,
    () => anchor(regionId),
    (value) => value?.targetRect?.y < region.targetRect.y - 5,
    "Region ignored inner scroller",
  );
  const scale = await inner.evaluate(
    (element) => element.getBoundingClientRect().height / element.offsetHeight,
  );
  const frameScale = await native.page
    .locator("#annotation-outer")
    .evaluate(
      (element) =>
        element.getBoundingClientRect().height / element.offsetHeight,
    );
  assert(
    Math.abs(
      region.targetRect.y -
        innerAnchor.targetRect.y -
        innerScroll * scale * frameScale,
    ) < 2,
    "Nested region did not convert scroll CSS pixels through positive scale",
  );
  const afterInner = await sameEditor(regionEditor, before, body);
  assert(
    afterInner.bounds.y < before.bounds.y - 5,
    "Region editor did not follow inner scroll",
  );
  const outerScroller = outer.locator("#region-scroll-outer");
  const outerBounds = await outerScroller.boundingBox();
  const outerScroll = await wheel(
    outerScroller,
    { x: outerBounds.x + 9, y: outerBounds.y + 250 },
    12,
  );
  await waitFor(
    options,
    () => anchor(regionId),
    (value) => value?.targetRect?.y < innerAnchor.targetRect.y - 5,
    "Region ignored outer scroller",
  );
  const nestedAnchor = await anchor(regionId);
  await sameEditor(regionEditor, before, body);
  await capture("region-nested-scrolled-editor", regionEditor);
  await native.page.mouse.move(bounds.x + 10, bounds.y + 140);
  await native.page.mouse.wheel(0, 500);
  await waitFor(
    options,
    () => anchor(regionId),
    (value) => value?.targetRect === null,
    "Offscreen region did not hide its marker",
  );
  const pageBounds = (await identity(native)).bounds;
  const fallback = await waitFor(
    options,
    () => identity(regionEditor),
    (value) =>
      value?.bounds.x === pageBounds.x + 8 &&
      value.bounds.y === pageBounds.y + 8,
    "Offscreen region editor did not use top-left fallback",
  );
  await sameEditor(regionEditor, before, body);
  await native.page.mouse.wheel(0, -1000);
  await waitFor(
    options,
    () => anchor(regionId),
    (value) => !!value?.targetRect,
    "Region did not return after scrolling back",
  );
  assert(
    JSON.stringify(await selected()) === original,
    "Live region changed the captured selection",
  );
  await submit(region, regionEditor, "region-nested");
  await outer
    .locator("#region-scroll-outer")
    .evaluate((element) => element.remove());

  console.log("[browser-annotation-regions] stage=fixed-element");
  await native.page.evaluate(() => {
    document.body.style.minHeight = "2400px";
    const fixed = document.createElement("div");
    fixed.id = "region-fixed";
    Object.assign(fixed.style, {
      position: "fixed",
      left: "70px",
      top: "130px",
      width: "280px",
      height: "160px",
      background: "#bfdbfe",
      zIndex: "4000",
    });
    document.body.append(fixed);
  });
  const fixed = await native.page.locator("#region-fixed").boundingBox();
  await beginSelection();
  await native.page.mouse.click(fixed.x + 100, fixed.y + 80);
  const fixedEditor = await editor(),
    fixedSelection = await selected(),
    fixedId = await annotationId();
  assert(
    fixedSelection.kind === "element" &&
      fixedSelection.targetSelector === "#region-fixed",
    "Fixed element click became a region",
  );
  const fixedBody = `fixed-element-${randomUUID()}`;
  await fill(fixedEditor, fixedBody);
  const fixedBefore = await identity(fixedEditor);
  const scrollRoot = async () => {
    const start = await native.page.evaluate(() => scrollY);
    await native.page.mouse.move(600, 500);
    await native.page.mouse.wheel(0, 40);
    return waitFor(
      options,
      () => native.page.evaluate(() => scrollY),
      (value) => value > start + 5,
      "Native root document did not scroll",
    );
  };
  await scrollRoot();
  const fixedAfter = await sameEditor(fixedEditor, fixedBefore, fixedBody);
  assert(
    JSON.stringify(fixedAfter.bounds) === JSON.stringify(fixedBefore.bounds) &&
      (await anchor(fixedId)).targetRect.y === fixedSelection.targetRect.y,
    "Fixed element anchor moved with root document scroll",
  );
  await capture("fixed-element-scrolled-editor", fixedEditor);
  await submit(fixedSelection, fixedEditor, "fixed-element");

  console.log("[browser-annotation-regions] stage=fixed-region");
  await beginSelection();
  await drag(fixed);
  const fixedRegionEditor = await editor(),
    fixedRegion = await selected(),
    fixedRegionId = await annotationId();
  assert(
    fixedRegion.kind === "region",
    "Dragging fixed pixels did not select a region",
  );
  const fixedRegionBody = `fixed-region-${randomUUID()}`;
  await fill(fixedRegionEditor, fixedRegionBody);
  const fixedRegionBefore = await identity(fixedRegionEditor);
  const rootBefore = await native.page.evaluate(() => scrollY);
  const rootAfter = await scrollRoot();
  const fixedRegionAnchor = await waitFor(
    options,
    () => anchor(fixedRegionId),
    (value) => value?.targetRect?.y < fixedRegion.targetRect.y - 5,
    "Region over fixed pixels failed to follow reference document coordinates",
  );
  assert(
    Math.abs(
      fixedRegion.targetRect.y -
        fixedRegionAnchor.targetRect.y -
        (rootAfter - rootBefore),
    ) < 2,
    "Fixed region used element geometry instead of document coordinates",
  );
  await sameEditor(fixedRegionEditor, fixedRegionBefore, fixedRegionBody);
  await capture("fixed-region-scrolled-editor", fixedRegionEditor);
  await submit(fixedRegion, fixedRegionEditor, "fixed-region");
  await native.page
    .locator("#region-fixed")
    .evaluate((element) => element.remove());
  return {
    regionId,
    region,
    innerScroll,
    outerScroll,
    innerAnchor,
    nestedAnchor,
    fallback,
    fixedSelection,
    fixedBefore,
    fixedAfter,
    fixedRegion,
    fixedRegionAnchor,
    rootBefore,
    rootAfter,
    nestedScrollAndScale: true,
    offscreenRestored: true,
    captureUnchanged: true,
    fixedElementStable: true,
    fixedRegionFollowsDocument: true,
  };
}
