import { replaceFileTab } from "./thread-side-panel-navigation.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  createArtifactFrameDriver,
  waitForArtifactFileRead,
} from "./artifact-frame-driver.mjs";
import {
  presentationFrameSelector,
  waitForPresentationSlide,
} from "./presentation-preview-scenario.mjs";
import { presentationNavigationIo } from "./presentation-navigation-scenario.mjs";
import { ensurePresentationTableSelection } from "./presentation-table-scenario.mjs";
import { assertPresentationTableNativePointerEvents } from "./presentation-table-advanced-scenario.mjs";
import {
  assertPresentationTableStructureSave,
  readPresentationTableStructureFile,
} from "./presentation-table-structure-scenario.mjs";

const emusPerPixel = 9525;
const timeout = 15_000;
const trackSelector =
  '[data-presentation-table-id="7"] [data-presentation-track="row:0"]';
const observationKey = "__limePresentationTableRowPointerObservation";
const noMerge = { gridSpan: null, rowSpan: null, hMerge: null, vMerge: null };

/** 仅目标行可变；期望尺寸来自输入合同或独立原生几何，不调用生产测量。 */
export function assertPresentationTableRowResizeSave(
  before,
  after,
  { row = 0, size, minimum = 20, maximum = Infinity } = {},
) {
  assert.ok(
    Number.isInteger(row) && row >= 0 && row < before.rowHeights.length,
  );
  const actual = after.rowHeights[row] / emusPerPixel;
  assert.ok(
    actual >= minimum && actual <= maximum,
    `row ${row} height ${actual}px must be within ${minimum}..${maximum}px`,
  );
  if (size !== undefined)
    assert.equal(
      after.rowHeights[row],
      Math.round(size * emusPerPixel),
      "target row matches the independently expected persisted size",
    );
  const expectedRows = before.rowHeights.map((height) => height / emusPerPixel);
  expectedRows[row] = actual;
  return assertPresentationTableStructureSave(before, after, {
    matrix: before.cells.map((cells, row) =>
      cells.map((_, column) => ({ from: [row, column] })),
    ),
    columnWidths: before.columnWidths.map((width) => width / emusPerPixel),
    rowHeights: expectedRows,
  });
}

/** 仅投影浏览器实际报告的 screen 增量，不复制生产 inverse-rotation 算法。 */
export function presentationTableRowPointerDelta(lifecycle, vector) {
  const down = lifecycle.events.find((event) => event.type === "pointerdown");
  const up = lifecycle.events.find((event) => event.type === "pointerup");
  const squared = vector.x ** 2 + vector.y ** 2;
  assert.ok(down && up && Number.isFinite(squared) && squared > 0);
  assert.ok(
    [down.screenX, down.screenY, up.screenX, up.screenY].every(Number.isFinite),
    "native screen coordinates must be observable",
  );
  return (
    ((up.screenX - down.screenX) * vector.x +
      (up.screenY - down.screenY) * vector.y) /
    squared
  );
}

/** 使用真实 renderer 每格的滚动尺寸验证正文；夹具值不能替代 DOM 观察。 */
export function assertPresentationTableRowContent(cells) {
  assert.equal(cells.length, 2, "renderer retains two physical rows");
  let checked = 0;
  cells.forEach((row, r) => {
    assert.equal(row.length, 3, "renderer retains three physical columns");
    row.forEach((cell, c) => {
      assert.equal(cell.rows, 1);
      assert.equal(cell.columns, 1);
      assert.ok(
        Number.isFinite(cell.clientHeight) &&
          cell.clientHeight > 0 &&
          Number.isFinite(cell.scrollHeight) &&
          cell.scrollHeight >= 0,
        `cell ${r}:${c} has observable live layout`,
      );
      assert.ok(
        cell.scrollHeight <= cell.clientHeight + 1,
        `cell ${r}:${c} content is not clipped: scrollHeight=${cell.scrollHeight}, clientHeight=${cell.clientHeight}`,
      );
      checked++;
    });
  });
  return checked;
}

// 此函数仅从父文档读取同源 iframe；不在 iframe realm 注入执行代码。
function rowResizeDom(expected = {}) {
  const panel = document.querySelector('[data-testid="presentation-panel"]');
  const controls = panel?.querySelector(
    '[data-testid="presentation-editing-controls"]',
  );
  const content = panel?.querySelector("iframe")?.contentDocument;
  const slide = content?.querySelector('[data-slide-id="512"]');
  const tables = slide?.querySelectorAll("table") ?? [];
  const table = tables[0],
    wrapper = table?.parentElement;
  const state = {
    sha256: panel?.getAttribute("data-source-sha256"),
    dirty: controls?.getAttribute("data-dirty") === "true",
    saving: controls?.getAttribute("data-saving") === "true",
    fontsReady: content?.fonts?.status === "loaded",
    activeTrack: content?.activeElement?.getAttribute(
      "data-presentation-track",
    ),
    cells: Array.from(table?.rows ?? [], (row) =>
      Array.from(row.cells, (cell) => ({
        text: cell.textContent,
        rows: cell.rowSpan,
        columns: cell.colSpan,
        clientHeight: cell.clientHeight,
        scrollHeight: cell.scrollHeight,
      })),
    ),
    renderer: {
      width: parseFloat(wrapper?.style.width ?? "0"),
      height: parseFloat(wrapper?.style.height ?? "0"),
      rotation: Number(
        wrapper?.style.transform.match(/rotate\((-?[\d.]+)deg\)/)?.[1] ?? "0",
      ),
      columns: Array.from(table?.querySelectorAll("col") ?? [], (node) =>
        parseFloat(node.style.width),
      ),
      rows: Array.from(table?.rows ?? [], (node) =>
        parseFloat(node.style.height),
      ),
    },
  };
  if (
    panel?.getAttribute("data-status") !== "ready" ||
    tables.length !== 1 ||
    content.querySelector("[data-presentation-text-editor]") ||
    state.dirty ||
    state.saving ||
    !state.fontsReady
  )
    return false;
  if (expected.sha256 && state.sha256 !== expected.sha256) return false;
  if (expected.changedFrom && state.sha256 === expected.changedFrom)
    return false;
  if (expected.activeTrack && state.activeTrack !== expected.activeTrack)
    return false;
  return state;
}

async function observeRowPointer(page, run) {
  await page.evaluate(
    ({ frameSelector, key, selector }) => {
      const content = document.querySelector(frameSelector)?.contentDocument;
      if (!content || window[key])
        throw new Error(
          "row pointer observer requires a fresh same-origin document",
        );
      const events = [];
      let pointerId;
      const record = (event) => {
        if (
          event.type === "pointerdown" &&
          event.target?.closest?.(selector) &&
          pointerId === undefined
        )
          pointerId = event.pointerId;
        if (pointerId === undefined || event.pointerId !== pointerId) return;
        events.push({
          type: event.type,
          isTrusted: event.isTrusted,
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          screenX: event.screenX,
          screenY: event.screenY,
        });
      };
      const types = [
        "pointerdown",
        "pointermove",
        "pointerup",
        "pointercancel",
      ];
      types.forEach((type) => content.addEventListener(type, record, true));
      window[key] = {
        events,
        dispose: () =>
          types.forEach((type) =>
            content.removeEventListener(type, record, true),
          ),
      };
    },
    {
      frameSelector: presentationFrameSelector,
      key: observationKey,
      selector: trackSelector,
    },
  );
  let events;
  try {
    await run();
  } finally {
    events = await page.evaluate((key) => {
      const observer = window[key];
      observer?.dispose();
      delete window[key];
      return observer?.events ?? [];
    }, observationKey);
  }
  return assertPresentationTableNativePointerEvents(
    events,
    "mouse",
    "pointerup",
  );
}

async function rowPointerCoordinates(page, frame, delta) {
  const { box, attributes } = await frame.visible(trackSelector);
  assert.equal(attributes["data-pointer-resize"], "available");
  const vector = await page.evaluate(
    ({ frameSelector, selector }) => {
      const content = document.querySelector(frameSelector)?.contentDocument;
      const handle = content?.querySelector(selector);
      const root = content?.querySelector("#slide");
      if (!handle || !root) return null;
      const matrix = new content.defaultView.DOMMatrix(
        content.defaultView.getComputedStyle(handle.parentElement).transform,
      );
      const slide = new content.defaultView.DOMMatrix(
        content.defaultView.getComputedStyle(root).transform,
      );
      const transform = slide.multiply(matrix);
      // 行轴是 CSS matrix 的 c/d；宽度四分之一位置避开列 separator 交点。
      return {
        x: transform.c,
        y: transform.d,
        offsetX: transform.a * (-handle.clientWidth / 4),
        offsetY: transform.b * (-handle.clientWidth / 4),
      };
    },
    { frameSelector: presentationFrameSelector, selector: trackSelector },
  );
  assert.ok(
    vector &&
      [vector.x, vector.y, vector.offsetX, vector.offsetY].every(
        Number.isFinite,
      ) &&
      Math.hypot(vector.x, vector.y) > 0,
    "row separator has observable nonzero CSS geometry",
  );
  const start = {
    x: box.x + box.width / 2 + vector.offsetX,
    y: box.y + box.height / 2 + vector.offsetY,
  };
  const end = { x: start.x + vector.x * delta, y: start.y + vector.y * delta };
  const viewport = page.viewportSize();
  assert.ok(viewport, "native row pointer requires a known viewport");
  for (const point of [start, end])
    assert.ok(
      point.x > 0 &&
        point.y > 0 &&
        point.x < viewport.width &&
        point.y < viewport.height,
      "native row pointer stays inside the viewport",
    );
  return { start, end, vector, requestedDelta: delta };
}

/** 在 advanced 同路径保存稿后运行；父入口拥有真实 Electron 与零 mock 门禁。 */
export async function runPresentationTableRowResizeScenario({
  page,
  evidenceDir,
  filePath,
  readTrace,
}) {
  assert.equal(typeof readTrace, "function");
  const original = await readPresentationTableStructureFile(filePath);
  assert.equal(original.cells.length, 2);
  original.cells.forEach((row) => {
    assert.equal(row.length, 3);
    row.forEach((cell) => assert.deepEqual(cell.merge, noMerge));
  });
  const panel = page.getByTestId("presentation-panel");
  const controls = panel.getByTestId("presentation-editing-controls");
  const frame = createArtifactFrameDriver(page, presentationFrameSelector);
  const counts = async () =>
    presentationNavigationIo(await readTrace(), filePath);
  const evidencePath = path.join(
    evidenceDir,
    "presentation-table-row-resize.json",
  );
  const evidence = {
    initialSha256: original.sha256,
    manualSaveClicks: 0,
    expectedAutomaticSaves: 4,
    stages: [],
  };
  const record = (stage) => {
    evidence.stages.push(stage);
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  };
  const waitState = async (expected) => {
    const handle = await page.waitForFunction(rowResizeDom, expected, {
      timeout,
    });
    try {
      return await handle.jsonValue();
    } finally {
      await handle.dispose();
    }
  };
  const checkRenderer = (state, disk) => {
    assert.equal(
      state.sha256,
      disk.sha256,
      "renderer and disk share the source revision",
    );
    assert.deepEqual(
      state.cells.map((row) => row.map((cell) => cell.text)),
      disk.cells.map((row) => row.map((cell) => cell.text)),
    );
    assert.equal(state.renderer.rotation, disk.geometry.rotation);
    for (const [axis, tracks] of [
      ["columns", disk.columnWidths],
      ["rows", disk.rowHeights],
    ]) {
      assert.equal(state.renderer[axis].length, tracks.length);
      const total = tracks.reduce((sum, value) => sum + value, 0);
      state.renderer[axis].forEach((value, index) =>
        assert.ok(
          Math.abs(value - (tracks[index] * 100) / total) < 0.0001,
          `renderer ${axis} match persisted tracks`,
        ),
      );
    }
    for (const axis of ["width", "height"])
      assert.ok(
        Math.abs(state.renderer[axis] - disk.geometry[axis] / emusPerPixel) <
          0.001,
        `renderer frame ${axis} matches persisted OOXML`,
      );
    return assertPresentationTableRowContent(state.cells);
  };
  const capture = async () => ({
    disk: await readPresentationTableStructureFile(filePath),
    io: await counts(),
  });
  const saved = async (name, before, expected = {}, details = {}) => {
    const state = await waitState({
      changedFrom: before.disk.sha256,
      activeTrack: "row:0",
    });
    const disk = await readPresentationTableStructureFile(filePath);
    assert.notEqual(
      disk.sha256,
      before.disk.sha256,
      `${name}: automatic save changes source`,
    );
    const preserved = assertPresentationTableRowResizeSave(
      original,
      disk,
      expected,
    );
    const checkedCells = checkRenderer(state, disk);
    const afterIo = await counts();
    const fileIoDelta = {
      read: afterIo.read - before.io.read,
      write: afterIo.write - before.io.write,
    };
    assert.ok(
      fileIoDelta.read >= 2,
      `${name}: save checks and rereads source through real IPC`,
    );
    assert.equal(
      fileIoDelta.write,
      1,
      `${name}: commit causes exactly one automatic source write`,
    );
    record({
      name,
      sha256: disk.sha256,
      rowHeights: disk.rowHeights,
      ...preserved,
      fileIoDelta,
      activeTrack: state.activeTrack,
      checkedCells,
      cells: state.cells,
      renderer: state.renderer,
      automaticSave: true,
      ...details,
    });
    return disk;
  };
  await waitForPresentationSlide(page, "512");
  checkRenderer(await waitState({ sha256: original.sha256 }), original);
  const edit = controls.getByRole("button", { name: "编辑", exact: true });
  if (await edit.isVisible()) await edit.click();
  await controls
    .getByRole("button", { name: "结束编辑", exact: true })
    .waitFor();
  evidence.entry = await ensurePresentationTableSelection(frame, controls);
  await frame.visible(trackSelector);

  const drag = async (name, requestedSize) => {
    const before = await capture();
    const currentSize = before.disk.rowHeights[0] / emusPerPixel;
    const pointer = await rowPointerCoordinates(
      page,
      frame,
      requestedSize - currentSize,
    );
    const cdp = await page.context().newCDPSession(page);
    let held = false;
    const lifecycle = await observeRowPointer(page, async () => {
      try {
        const send = (type, point, buttons) =>
          cdp.send("Input.dispatchMouseEvent", {
            type,
            ...point,
            button: "left",
            buttons,
            clickCount: 1,
          });
        await send("mouseMoved", pointer.start, 0);
        await send("mousePressed", pointer.start, 1);
        held = true;
        for (let step = 1; step <= 4; step++)
          await send(
            "mouseMoved",
            {
              x:
                pointer.start.x +
                ((pointer.end.x - pointer.start.x) * step) / 4,
              y:
                pointer.start.y +
                ((pointer.end.y - pointer.start.y) * step) / 4,
            },
            1,
          );
        const preview = await page.waitForFunction(
          ({ frameSelector, selector }) =>
            document
              .querySelector(frameSelector)
              ?.contentDocument?.querySelector(selector)
              ?.getAttribute("data-resizing") === "true",
          { frameSelector: presentationFrameSelector, selector: trackSelector },
          { timeout },
        );
        await preview.dispose();
        // 跨过 500ms 保存窗口观察零写；完成仍由真实保存终态判定。
        await page.waitForTimeout(650);
        assert.equal(
          (await readPresentationTableStructureFile(filePath)).sha256,
          before.disk.sha256,
          `${name}: preview does not mutate source bytes`,
        );
        assert.equal(
          (await counts()).write,
          before.io.write,
          `${name}: preview causes no source write`,
        );
        await send("mouseReleased", pointer.end, 0);
        held = false;
      } finally {
        try {
          if (held)
            await cdp.send("Input.dispatchMouseEvent", {
              type: "mouseReleased",
              ...pointer.end,
              button: "left",
              buttons: 0,
              clickCount: 1,
            });
        } finally {
          await cdp.detach();
        }
      }
    });
    const observedDelta = presentationTableRowPointerDelta(
      lifecycle,
      pointer.vector,
    );
    return {
      before,
      pointer,
      lifecycle,
      observedDelta,
      requestedNativeSize: currentSize + observedDelta,
    };
  };
  const growth = await drag(
    "grow-row-preview",
    original.rowHeights[0] / emusPerPixel + 12,
  );
  assert.ok(
    growth.observedDelta >= 8 && growth.observedDelta <= 16,
    "native growth requests approximately twelve CSS pixels",
  );
  const grown = await saved(
    "native-row-pointer-grow",
    growth.before,
    {
      minimum: original.rowHeights[0] / emusPerPixel + 8,
      maximum: original.rowHeights[0] / emusPerPixel + 16,
    },
    {
      pointer: growth.pointer,
      lifecycle: growth.lifecycle,
      observedDelta: growth.observedDelta,
      previewWrites: 0,
      previewObservationMs: 650,
    },
  );
  assert.ok(
    Math.abs(grown.rowHeights[0] / emusPerPixel - growth.requestedNativeSize) <
      0.05,
    "saved growth follows the independent CSS-axis projection of trusted native screen coordinates",
  );
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-table-row-grown.png"),
  });

  const shrink = await drag("clamp-row-preview", 8);
  assert.ok(
    shrink.requestedNativeSize < 20,
    "native shrink requests below the twenty-pixel guard",
  );
  const clamped = await saved(
    "native-row-pointer-content-clamp",
    shrink.before,
    {
      minimum: 20,
      maximum: grown.rowHeights[0] / emusPerPixel - 1,
    },
    {
      pointer: shrink.pointer,
      lifecycle: shrink.lifecycle,
      requestedSize: 8,
      requestedNativeSize: shrink.requestedNativeSize,
      previewWrites: 0,
      previewObservationMs: 650,
      contentProof: "live-renderer-cell-scrollHeight/clientHeight",
    },
  );
  assert.ok(
    clamped.rowHeights[0] / emusPerPixel > shrink.requestedNativeSize,
    "saved row is clamped above the native requested size",
  );
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-table-row-clamped.png"),
  });

  for (const [label, key, name, disk] of [
    ["撤销", "ControlOrMeta+z", "undo-row-clamp-across-save", grown],
    ["重做", "ControlOrMeta+Shift+z", "redo-row-clamp-across-save", clamped],
  ]) {
    const before = await capture();
    assert.equal(
      await controls
        .getByRole("button", { name: label, exact: true })
        .isEnabled(),
      true,
    );
    await page.keyboard.press(key);
    await saved(name, before, { size: disk.rowHeights[0] / emusPerPixel });
  }
  const finalDisk = await readPresentationTableStructureFile(filePath);
  await controls.getByRole("button", { name: "结束编辑", exact: true }).click();
  const beforeReopen = await counts();
  await replaceFileTab(page, filePath);
  await waitForArtifactFileRead(
    async () => (await counts()).read,
    beforeReopen.read,
    timeout,
  );
  const reopened = await waitState({ sha256: finalDisk.sha256 });
  const reopenedDisk = await readPresentationTableStructureFile(filePath);
  assert.equal(reopenedDisk.sha256, finalDisk.sha256);
  assertPresentationTableRowResizeSave(original, reopenedDisk, {
    size: clamped.rowHeights[0] / emusPerPixel,
  });
  const checkedCells = checkRenderer(reopened, reopenedDisk);
  const afterReopen = await counts();
  assert.equal(
    afterReopen.write,
    beforeReopen.write,
    "same-path clean reopen performs no write",
  );
  assert.equal(
    await frame.count("[data-presentation-cell],[data-presentation-track]"),
    0,
  );
  assert.equal(
    await panel.locator("iframe").getAttribute("sandbox"),
    "allow-same-origin",
  );
  assert.equal(await frame.count("script,iframe,a[href],[onclick]"), 0);
  evidence.finalSha256 = reopenedDisk.sha256;
  evidence.undoRedoAcrossSave = true;
  evidence.reopen = {
    sha256: reopenedDisk.sha256,
    sourceReads: afterReopen.read - beforeReopen.read,
    sourceWrites: 0,
    checkedCells,
    cells: reopened.cells,
    renderer: reopened.renderer,
  };
  evidence.scriptsAllowed = false;
  record({ name: "same-path-clean-reopen", sha256: reopenedDisk.sha256 });
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-table-row-reopened.png"),
  });
  return evidence;
}
