import { assert } from "./claw-chat-current-fixture-utils.mjs";
import { waitForBrowserAnnotationState as waitFor } from "./browser-runtime-electron-gate-b-annotation-diagnostics.mjs";

/** Use native keyboard/pointer input; page evaluation only prepares and observes the fixture. */
export async function verifyBrowserAnnotationKeyboard(ctx, ui, outer) {
  const { app, options, initial } = ctx;
  const { native, beginSelection, observerKey, capture } = ui;
  const contentsFocus = (id) =>
    app.evaluate(({ webContents }, id) => webContents.fromId(id).focus(), id);
  await native.page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "annotation-keyboard-button";
    button.textContent = "Page interaction";
    Object.assign(button.style, {
      position: "fixed",
      right: "30px",
      top: "30px",
      zIndex: "1000",
    });
    button.addEventListener("click", () => {
      button.dataset.clicks = String(Number(button.dataset.clicks ?? 0) + 1);
    });
    const scroll = document.createElement("section");
    scroll.id = "annotation-keyboard-scroll";
    Object.assign(scroll.style, {
      position: "fixed",
      right: "30px",
      top: "100px",
      width: "180px",
      height: "90px",
      overflow: "auto",
      zIndex: "1000",
      background: "white",
    });
    const content = document.createElement("p");
    content.textContent = "Native wheel interaction";
    content.style.height = "600px";
    scroll.append(content);
    document.body.append(button, scroll);
  });
  const button = native.page.locator("#annotation-keyboard-button");
  const bounds = await button.boundingBox();
  const point = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const input = outer.locator("#frame-form");
  const inputBounds = await input.boundingBox();
  const hit = () =>
    native.page.evaluate(({ x, y }) => {
      const target = document.getElementById("annotation-keyboard-button");
      return document.elementFromPoint(x, y) === target;
    }, point);
  const selected = () =>
    app.evaluate(
      (_electron, key) =>
        globalThis[key].records.filter((entry) => entry.kind === "selection")
          .length,
      observerKey,
    );
  const recordCount = () =>
    app.evaluate(
      (_electron, key) => globalThis[key].records.length,
      observerKey,
    );
  const pageCancellationSince = (offset) =>
    app.evaluate(
      (_electron, { key, offset }) =>
        globalThis[key].records
          .slice(offset)
          .findLast(
            (record) =>
              record.channel === "browser-annotation-cancelled-projection" &&
              record.reason === "page-changed",
          ),
      { key: observerKey, offset },
    );
  const state = {};
  console.log("[browser-annotation-keyboard] stage=initial-space");
  await beginSelection();
  await contentsFocus(initial.webContentsId);
  const before = await selected();
  await native.page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true }),
    );
  });
  assert(!(await hit()), "Synthetic Space released the annotation shield");
  state.syntheticSpaceIgnored = true;
  await native.page.keyboard.down("Shift");
  await native.page.keyboard.press("Space");
  await native.page.keyboard.up("Shift");
  assert(!(await hit()), "Modified Space released the annotation shield");
  state.modifiedSpacePreserved = true;
  await native.page.keyboard.down("Space");
  await waitFor(
    options,
    hit,
    Boolean,
    "Physical Space did not release the shield",
  );
  await native.page.mouse.click(point.x, point.y);
  assert(
    (await button.getAttribute("data-clicks")) === "1",
    "Suspended annotation blocked a real page click",
  );
  const scroll = native.page.locator("#annotation-keyboard-scroll");
  const scrollBounds = await scroll.boundingBox();
  await native.page.mouse.move(scrollBounds.x + 40, scrollBounds.y + 30);
  await native.page.mouse.wheel(0, 120);
  state.scrollTop = await waitFor(
    options,
    () => scroll.evaluate((element) => element.scrollTop),
    (value) => value > 0,
    "Suspended annotation blocked native wheel scrolling",
  );
  await native.page.mouse.click(inputBounds.x + 40, inputBounds.y + 20);
  await native.page.keyboard.up("Space");
  await waitFor(
    options,
    hit,
    (value) => !value,
    "Space keyup in a child input did not restore the shield",
  );
  assert(
    (await selected()) === before,
    "Suspended page interactions produced an annotation",
  );
  state.realPageClickAndWheel = true;
  state.childFrameKeyupRestored = true;
  const originalValue = await input.inputValue();
  await native.page.keyboard.press("Space");
  assert(
    (await input.inputValue()).length === originalValue.length + 1 &&
      !(await hit()),
    "Annotation captured Space intended for the focused form control",
  );
  state.focusedInputSpacePreserved = true;
  console.log("[browser-annotation-keyboard] stage=late-frame");
  // Network document loading retires the current page revision in the existing Host.
  await contentsFocus(initial.webContentsId);
  await button.focus();
  const networkStart = await recordCount();
  await native.page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.id = "annotation-keyboard-late-frame";
    frame.src = "/annotation-nested?keyboard=1";
    Object.assign(frame.style, {
      position: "fixed",
      right: "30px",
      top: "240px",
      width: "180px",
      height: "90px",
      zIndex: "1000",
    });
    document.body.append(frame);
  });
  const late = await waitFor(
    options,
    () =>
      native.page
        .frames()
        .find((frame) => frame.url().endsWith("/annotation-nested?keyboard=1")),
    Boolean,
    "Late same-origin frame did not load",
  );
  await late
    .locator("#frame-copy")
    .waitFor({ state: "visible", timeout: options.timeoutMs });
  state.networkFrameCancellation = await waitFor(
    options,
    () => pageCancellationSince(networkStart),
    (record) => record?.reason === "page-changed",
    "Network frame loading did not retire the old selection",
  );
  await waitFor(
    options,
    () =>
      app.evaluate(
        ({ webContents }, id) => webContents.fromId(id).isLoading(),
        initial.webContentsId,
      ),
    (value) => value === false,
    "Network frame loading did not settle",
  );
  await native.page
    .locator("#annotation-keyboard-late-frame")
    .evaluate((element) => element.remove());
  await beginSelection();
  await contentsFocus(initial.webContentsId);
  await button.focus();
  // Creating a blank browsing context also loads a document; require a fresh Host session.
  const blankStart = await recordCount();
  await native.page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.id = "annotation-keyboard-late-frame";
    frame.name = "annotation-keyboard-blank";
    Object.assign(frame.style, {
      position: "fixed",
      right: "30px",
      top: "240px",
      width: "180px",
      height: "90px",
      zIndex: "1000",
    });
    document.body.append(frame);
    const input = frame.contentDocument.createElement("input");
    input.id = "late-keyboard-input";
    input.setAttribute("aria-label", "Late frame input");
    frame.contentDocument.body.append(input);
  });
  const blank = await waitFor(
    options,
    () =>
      native.page
        .frames()
        .find((frame) => frame.name() === "annotation-keyboard-blank"),
    Boolean,
    "Added blank frame did not appear",
  );
  await blank
    .locator("#late-keyboard-input")
    .waitFor({ state: "visible", timeout: options.timeoutMs });
  state.blankFrameCancellation = await waitFor(
    options,
    () => pageCancellationSince(blankStart),
    (record) =>
      record?.reason === "page-changed" &&
      record.annotationId !== state.networkFrameCancellation.annotationId,
    "Blank frame loading did not retire the old selection",
  );
  await waitFor(
    options,
    () =>
      app.evaluate(
        ({ webContents }, id) => webContents.fromId(id).isLoading(),
        initial.webContentsId,
      ),
    (value) => value === false,
    "Blank frame loading did not settle",
  );
  await beginSelection();
  await contentsFocus(initial.webContentsId);
  await button.focus();
  state.newFrameAnnotationId = await app.evaluate(
    (_electron, key) =>
      globalThis[key].records.findLast((record) => record.kind === "began")
        ?.annotationId,
    observerKey,
  );
  assert(
    state.newFrameAnnotationId &&
      state.newFrameAnnotationId !== state.blankFrameCancellation.annotationId,
    "Frame loading reused an old annotation session",
  );
  await native.page.keyboard.down("Space");
  await waitFor(
    options,
    hit,
    Boolean,
    "Space did not suspend after form focus was cleared",
  );
  const lateBounds = await blank.locator("#late-keyboard-input").boundingBox();
  await native.page.mouse.click(lateBounds.x + 20, lateBounds.y + 20);
  await native.page.keyboard.up("Space");
  await waitFor(
    options,
    hit,
    (value) => !value,
    "Late frame keyup left annotation suspended",
  );
  state.lateFrameKeyupRestored = true;
  console.log("[browser-annotation-keyboard] stage=abandoned-drag");
  await native.page
    .locator("#annotation-keyboard-late-frame")
    .evaluate((element) => element.remove());
  await contentsFocus(initial.webContentsId);
  await button.focus();
  await native.page.mouse.move(point.x, point.y);
  await native.page.mouse.down();
  await native.page.mouse.move(point.x + 12, point.y + 12, { steps: 4 });
  await native.page.keyboard.down("Space");
  await waitFor(
    options,
    hit,
    Boolean,
    "Mid-drag Space did not suspend annotation",
  );
  await native.page.mouse.up();
  await native.page.keyboard.up("Space");
  await waitFor(
    options,
    hit,
    (value) => !value,
    "Mid-drag release did not restore annotation",
  );
  assert(
    (await selected()) === before,
    "An abandoned pointer gesture committed an annotation",
  );
  state.abandonedDragRejected = true;
  console.log("[browser-annotation-keyboard] stage=blur");
  await native.page.keyboard.down("Space");
  await waitFor(
    options,
    hit,
    Boolean,
    "Space did not suspend before focus transfer",
  );
  await contentsFocus(native.native.ownerWebContentsId);
  state.paneFocusTransfer = {
    documentFocused: await native.page.evaluate(() => document.hasFocus()),
    focusedContents: await app.evaluate(
      ({ webContents }) => webContents.getFocusedWebContents()?.id ?? null,
    ),
  };
  await waitFor(
    options,
    hit,
    (value) => !value,
    "Native view blur left annotation suspended",
  );
  state.paneBlurRestored = true;
  await native.page.keyboard.up("Space");
  await contentsFocus(initial.webContentsId);
  await button.focus();
  await native.page.keyboard.down("Space");
  await waitFor(
    options,
    hit,
    Boolean,
    "Space did not suspend before native window blur",
  );
  const owner = await app.browserWindow(ctx.page);
  await owner.evaluate((window) => window.blur());
  await waitFor(
    options,
    async () => ({
      window: await owner.evaluate((window) => window.isFocused()),
      document: await native.page.evaluate(() => document.hasFocus()),
    }),
    (value) => !value.window,
    "Owned native window did not actually lose focus",
  );
  await waitFor(
    options,
    hit,
    (value) => !value,
    "Document blur left annotation suspended",
  );
  await native.page.keyboard.up("Space");
  await app.evaluate(({ app }) => app.focus({ steal: true }));
  await owner.evaluate((window) => window.focus());
  await contentsFocus(initial.webContentsId);
  state.blurRestored = true;
  await capture("keyboard-restored-page", native);
  await native.page.keyboard.press("Escape");
  await native.page.evaluate(() => {
    document.getElementById("annotation-keyboard-button").remove();
    document.getElementById("annotation-keyboard-scroll").remove();
  });
  return state;
}
