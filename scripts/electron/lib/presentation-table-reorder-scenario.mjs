import { replaceFileTab } from "./thread-side-panel-navigation.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { JSDOM } from "jsdom";
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

const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const emusPerPixel = 9525;
const timeout = 15_000;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const children = (node, name) =>
  Array.from(node.children).filter(
    (child) => child.namespaceURI === a && child.localName === name,
  );

/** 在已有落盘reader上补列/行元数据和非目标frame内容，不生成重排期望。 */
export async function readPresentationTableReorderFile(filePath) {
  const source = await readPresentationTableStructureFile(filePath);
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath), {
    checkCRC32: true,
  });
  const dom = new JSDOM(await zip.file(source.tablePart).async("string"), {
    contentType: "application/xml",
  });
  try {
    const frame = Array.from(
      dom.window.document.getElementsByTagNameNS(p, "graphicFrame"),
    ).find(
      (node) =>
        node.getElementsByTagNameNS(p, "cNvPr")[0]?.getAttribute("id") === "7",
    );
    assert.ok(frame);
    const table = frame.getElementsByTagNameNS(a, "tbl")[0];
    const hash = (node) =>
      digest(new dom.window.XMLSerializer().serializeToString(node));
    const columnPayloads = children(
      children(table, "tblGrid")[0],
      "gridCol",
    ).map(hash);
    const rowPayloads = children(table, "tr").map((row) => {
      const shell = row.cloneNode(true);
      for (const cell of children(shell, "tc")) cell.remove();
      return hash(shell);
    });
    const shell = frame.cloneNode(true);
    for (const name of ["tr", "gridCol"])
      for (const node of Array.from(shell.getElementsByTagNameNS(a, name)))
        node.remove();
    return {
      ...source,
      columnPayloads,
      rowPayloads,
      framePayload: hash(shell),
    };
  } finally {
    dom.window.close();
  }
}

/** 三列验收矩阵直接声明原格位置；不调用生产Move或重排算法。 */
export function presentationTableReorderExpectations(before) {
  assert.equal(before.cells.length, 2);
  assert.ok(before.cells.every((row) => row.length === 3));
  for (const row of before.cells)
    for (const cell of row)
      assert.deepEqual(
        cell.merge,
        { gridSpan: null, rowSpan: null, hMerge: null, vMerge: null },
        "native reorder fixture is explicitly unmerged",
      );
  const source = (row, column) => ({ from: [row, column] });
  const [A, B, C, D, E, F] = [
    source(0, 0),
    source(0, 1),
    source(0, 2),
    source(1, 0),
    source(1, 1),
    source(1, 2),
  ];
  return {
    initial: {
      matrix: [
        [A, B, C],
        [D, E, F],
      ],
      columnOrder: [0, 1, 2],
    },
    keyboard: {
      matrix: [
        [B, A, C],
        [E, D, F],
      ],
      columnOrder: [1, 0, 2],
    },
    pointer: {
      matrix: [
        [C, B, A],
        [F, E, D],
      ],
      columnOrder: [2, 1, 0],
    },
  };
}

export function assertPresentationTableReorderSave(before, after, expected) {
  assert.deepEqual(
    [...expected.columnOrder].sort(),
    [0, 1, 2],
    "expected column order is a complete handwritten permutation",
  );
  const preserved = assertPresentationTableStructureSave(before, after, {
    matrix: expected.matrix,
    columnWidths: expected.columnOrder.map(
      (index) => before.columnWidths[index] / emusPerPixel,
    ),
    rowHeights: before.rowHeights.map((height) => height / emusPerPixel),
  });
  assert.deepEqual(
    after.columnPayloads,
    expected.columnOrder.map((index) => before.columnPayloads[index]),
    "column metadata moves intact with its original track",
  );
  assert.deepEqual(
    after.rowPayloads,
    before.rowPayloads,
    "row metadata and non-cell siblings remain unchanged",
  );
  assert.equal(
    after.framePayload,
    before.framePayload,
    "non-target graphic-frame content remains unchanged",
  );
  assert.deepEqual(
    after.geometry,
    before.geometry,
    "reordering leaves frame dimensions and position unchanged",
  );
  return preserved;
}

function reorderDom(expected = {}) {
  const panel = document.querySelector('[data-testid="presentation-panel"]');
  const controls = panel?.querySelector(
    '[data-testid="presentation-editing-controls"]',
  );
  const content = panel?.querySelector("iframe")?.contentDocument;
  const slide = content?.querySelector('[data-slide-id="512"]');
  const tables = slide?.querySelectorAll("table") ?? [];
  const table = tables[0],
    wrapper = table?.parentElement;
  const guide = slide?.querySelector("[data-presentation-reorder-guide]");
  const state = {
    sha256: panel?.getAttribute("data-source-sha256"),
    dirty: controls?.getAttribute("data-dirty") === "true",
    saving: controls?.getAttribute("data-saving") === "true",
    texts: Array.from(table?.rows ?? [], (row) =>
      Array.from(row.cells, (cell) => cell.textContent),
    ),
    selected: Array.from(
      slide?.querySelectorAll(
        '[data-presentation-cell][aria-pressed="true"]',
      ) ?? [],
      (node) => node.getAttribute("data-presentation-cell"),
    ),
    activeReorder: content?.activeElement?.getAttribute(
      "data-presentation-reorder",
    ),
    pressedReorders: Array.from(
      slide?.querySelectorAll(
        '[data-presentation-reorder][aria-pressed="true"]',
      ) ?? [],
      (node) => node.getAttribute("data-presentation-reorder"),
    ),
    guide: guide
      ? {
          axis: guide.getAttribute("data-presentation-reorder-guide"),
          index: Number(guide.getAttribute("data-insertion-index")),
          valid: guide.getAttribute("data-valid") === "true",
          visible: !guide.hidden && guide.getClientRects().length > 0,
        }
      : null,
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
  if (!Object.keys(expected).length) return state;
  if (
    panel?.getAttribute("data-status") !== "ready" ||
    tables.length !== 1 ||
    content.querySelector("[data-presentation-text-editor]") ||
    state.dirty ||
    state.saving
  )
    return false;
  if (expected.sha256 && state.sha256 !== expected.sha256) return false;
  if (expected.changedFrom && state.sha256 === expected.changedFrom)
    return false;
  for (const key of ["texts", "selected", "pressedReorders"])
    if (
      expected[key] &&
      JSON.stringify(state[key]) !== JSON.stringify(expected[key])
    )
      return false;
  if (expected.activeReorder && state.activeReorder !== expected.activeReorder)
    return false;
  if (
    expected.preview !== undefined &&
    (!state.guide?.visible ||
      !state.guide.valid ||
      state.guide.axis !== "column" ||
      state.guide.index !== expected.preview)
  )
    return false;
  if (expected.noPreview && state.guide?.visible) return false;
  return state;
}

async function observeReorderPointer(page, selector, run) {
  const key = "__limePresentationReorderNativeObservation";
  await page.evaluate(
    ({ frameSelector, selector, key }) => {
      const content = document.querySelector(frameSelector)?.contentDocument;
      if (!content || window[key])
        throw new Error(
          "native reorder observer requires a fresh same-origin document",
        );
      const events = [];
      // 父realm闭包只读原生事件；不在受限iframe执行脚本、派发事件或访问Controller。
      const record = (event) => {
        if (!event.target?.closest?.(selector)) return;
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
    { frameSelector: presentationFrameSelector, selector, key },
  );
  let events;
  try {
    await run();
  } finally {
    events = await page.evaluate((key) => {
      const value = window[key];
      value?.dispose();
      delete window[key];
      return value?.events ?? [];
    }, key);
  }
  return events;
}

/** advanced结束编辑后调用；只操作同一真实文件、原生输入和current IPC。 */
export async function runPresentationTableReorderScenario({
  page,
  evidenceDir,
  filePath,
  readTrace,
}) {
  assert.equal(typeof readTrace, "function");
  const panel = page.getByTestId("presentation-panel");
  const controls = panel.getByTestId("presentation-editing-controls");
  const frame = createArtifactFrameDriver(page, presentationFrameSelector);
  const counts = async () =>
    presentationNavigationIo(await readTrace(), filePath);
  const original = await readPresentationTableReorderFile(filePath);
  const expected = presentationTableReorderExpectations(original);
  assert.deepEqual(
    original.cells.map((row) => row.map((cell) => cell.text)),
    [
      ["表格第一格_中文 <&>", "独立第二格_中文 <&>", "TABLE_R1C3"],
      ["TABLE_R2C1", "TABLE_R2C2", ""],
    ],
    "native reorder starts from the completed advanced scenario's same source",
  );
  const evidence = {
    initialSha256: original.sha256,
    manualSaveClicks: 0,
    mergedNativeCoverage: false,
    stages: [],
  };
  const record = (stage) => {
    evidence.stages.push(stage);
    fs.writeFileSync(
      path.join(evidenceDir, "presentation-table-reorder.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  };
  const waitState = async (expected) => {
    let handle;
    try {
      handle = await page.waitForFunction(reorderDom, expected, { timeout });
    } catch (error) {
      fs.writeFileSync(
        path.join(evidenceDir, "presentation-table-reorder-failure.json"),
        `${JSON.stringify({ expected, actual: await page.evaluate(reorderDom) }, null, 2)}\n`,
      );
      throw error;
    }
    try {
      return await handle.jsonValue();
    } finally {
      await handle.dispose();
    }
  };
  const texts = (value) =>
    value.matrix.map((row) =>
      row.map((cell) => original.cells[cell.from[0]][cell.from[1]].text),
    );
  const selection = (index) => ({
    selected: [`0:${index}`, `1:${index}`],
    activeReorder: `column:${index}`,
    pressedReorders: [`column:${index}`],
  });
  const gripSelector = (index) =>
    `[data-presentation-table-id="7"] [data-presentation-reorder="column:${index}"]`;
  const capture = async () => ({
    sha256: digest(fs.readFileSync(filePath)),
    io: await counts(),
  });
  const checkRenderer = (state, disk) => {
    assert.equal(state.sha256, disk.sha256);
    assert.equal(state.renderer.rotation, disk.geometry.rotation);
    assert.ok(
      Math.abs(state.renderer.width - disk.geometry.width / emusPerPixel) <
        0.001,
    );
    assert.ok(
      Math.abs(state.renderer.height - disk.geometry.height / emusPerPixel) <
        0.001,
    );
    for (const [percentages, tracks] of [
      [state.renderer.columns, disk.columnWidths],
      [state.renderer.rows, disk.rowHeights],
    ]) {
      const total = tracks.reduce((sum, value) => sum + value, 0);
      assert.equal(percentages.length, tracks.length);
      percentages.forEach((value, index) =>
        assert.ok(
          Math.abs(value - (tracks[index] * 100) / total) < 0.0001,
          "renderer and persisted tracks agree",
        ),
      );
    }
  };
  const saved = async (name, before, value, focus = {}) => {
    const state = await waitState({
      texts: texts(value),
      changedFrom: before.sha256,
      ...focus,
    });
    const disk = await readPresentationTableReorderFile(filePath);
    const preserved = assertPresentationTableReorderSave(original, disk, value);
    checkRenderer(state, disk);
    const io = await counts();
    const fileIoDelta = {
      read: io.read - before.io.read,
      write: io.write - before.io.write,
    };
    assert.ok(
      fileIoDelta.read >= 2,
      `${name}: source is checked twice through real IPC`,
    );
    assert.equal(
      fileIoDelta.write,
      1,
      `${name}: one user action writes the original file once`,
    );
    record({
      name,
      sha256: disk.sha256,
      ...preserved,
      fileIoDelta,
      selected: state.selected,
      activeReorder: state.activeReorder,
      automaticSave: true,
    });
    return disk;
  };
  const history = async (label, name, value) => {
    const before = await capture();
    await controls.getByRole("button", { name: label, exact: true }).click();
    return saved(name, before, value);
  };
  const reveal = async (index) => {
    await frame.click(
      `[data-presentation-table-id="7"] [data-presentation-cell="0:${index}"]`,
    );
    await frame.visible(gripSelector(index));
  };
  const pointerPlan = async (index, boundary, order) => {
    const box = await frame.box(gripSelector(index));
    const vector = await page.evaluate(
      ({ frameSelector, selector }) => {
        const content = document.querySelector(frameSelector)?.contentDocument;
        const handle = content?.querySelector(selector),
          root = content?.querySelector("#slide");
        if (!handle || !root) return null;
        const matrix = new content.defaultView.DOMMatrix(
          content.defaultView.getComputedStyle(root).transform,
        ).multiply(
          new content.defaultView.DOMMatrix(
            content.defaultView.getComputedStyle(handle.parentElement)
              .transform,
          ),
        );
        return { x: matrix.a, y: matrix.b };
      },
      {
        frameSelector: presentationFrameSelector,
        selector: gripSelector(index),
      },
    );
    assert.ok(vector && Math.hypot(vector.x, vector.y) > 0);
    const widths = order.map(
      (column) => original.columnWidths[column] / emusPerPixel,
    );
    const center =
      widths.slice(0, index).reduce((sum, value) => sum + value, 0) +
      widths[index] / 2;
    const destination =
      boundary === 0 ? 0 : widths.reduce((sum, value) => sum + value, 0);
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const end = {
      x: start.x + vector.x * (destination - center),
      y: start.y + vector.y * (destination - center),
    };
    const viewport = page.viewportSize();
    for (const point of [start, end])
      assert.ok(
        point.x > 0 &&
          point.y > 0 &&
          point.x < viewport.width &&
          point.y < viewport.height,
        "native reorder coordinates stay inside the viewport",
      );
    return { start, end, vector };
  };
  const noWrite = async (name, before) => {
    // 观测超过500ms自动保存窗口，确认预览/取消没有延迟文件写入。
    await page.waitForTimeout(650);
    assert.equal(
      digest(fs.readFileSync(filePath)),
      before.sha256,
      `${name}: source bytes are unchanged`,
    );
    assert.equal(
      (await counts()).write,
      before.io.write,
      `${name}: no native IPC write`,
    );
  };

  await waitForPresentationSlide(page, "512");
  await waitState({ texts: texts(expected.initial), sha256: original.sha256 });
  await controls.getByRole("button", { name: "编辑", exact: true }).click();
  evidence.entry = await ensurePresentationTableSelection(frame, controls);
  await reveal(0);
  await frame.click(gripSelector(0));
  await waitState(selection(0));
  let before = await capture();
  await page.keyboard.press("Alt+ArrowRight");
  await saved(
    "native-alt-right-moves-first-column-one-place",
    before,
    expected.keyboard,
    selection(1),
  );
  await history("撤销", "undo-keyboard-reorder-after-save", expected.initial);
  await history("重做", "redo-keyboard-reorder-after-save", expected.keyboard);
  await reveal(2);
  await frame.click(gripSelector(2));
  await waitState(selection(2));
  const pointer = await pointerPlan(2, 0, expected.keyboard.columnOrder);
  before = await capture();
  const events = await observeReorderPointer(
    page,
    '[data-presentation-reorder="column:2"]',
    async () => {
      await page.mouse.move(pointer.start.x, pointer.start.y);
      await page.mouse.down();
      await page.mouse.move(pointer.end.x, pointer.end.y, { steps: 8 });
      await waitState({ preview: 0, sha256: before.sha256, ...selection(2) });
      await noWrite("reorder-guide-preview", before);
      await page.mouse.up();
    },
  );
  const lifecycle = assertPresentationTableNativePointerEvents(
    events,
    "mouse",
    "pointerup",
  );
  await saved(
    "native-pointer-moves-outside-column-to-first",
    before,
    expected.pointer,
    selection(0),
  );
  evidence.pointer = { ...pointer, lifecycle };
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-table-reorder-edited.png"),
  });

  const cancelled = await pointerPlan(0, 3, expected.pointer.columnOrder);
  before = await capture();
  const cdp = await page.context().newCDPSession(page);
  const cancellation = await observeReorderPointer(
    page,
    '[data-presentation-reorder="column:0"]',
    async () => {
      try {
        await cdp.send("Emulation.setTouchEmulationEnabled", {
          enabled: true,
          maxTouchPoints: 1,
        });
        const point = ({ x, y }) => [
          { x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 },
        ];
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: point(cancelled.start),
        });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: point(cancelled.end),
        });
        await waitState({ preview: 3, sha256: before.sha256, ...selection(0) });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchCancel",
          touchPoints: [],
        });
        await waitState({ noPreview: true, sha256: before.sha256 });
      } finally {
        await cdp.send("Emulation.setTouchEmulationEnabled", {
          enabled: false,
        });
        await cdp.detach();
      }
    },
  );
  const cancelledLifecycle = assertPresentationTableNativePointerEvents(
    cancellation,
    "touch",
    "pointercancel",
  );
  await noWrite("trusted-reorder-pointercancel", before);
  record({
    name: "trusted-reorder-pointercancel",
    lifecycle: cancelledLifecycle,
    sha256: before.sha256,
    sourceWrites: 0,
    observationMs: 650,
  });
  await history(
    "撤销",
    "cancel-adds-no-history-single-undo-reverts-pointer-move",
    expected.keyboard,
  );
  const finalDisk = await history(
    "重做",
    "single-redo-restores-pointer-column-order",
    expected.pointer,
  );
  await controls.getByRole("button", { name: "结束编辑", exact: true }).click();
  const beforeReopen = await counts();
  await replaceFileTab(page, filePath);
  await waitForArtifactFileRead(
    async () => (await counts()).read,
    beforeReopen.read,
    timeout,
  );
  await waitForPresentationSlide(page, "512");
  const reopenedState = await waitState({
    texts: texts(expected.pointer),
    sha256: finalDisk.sha256,
  });
  const reopened = await readPresentationTableReorderFile(filePath);
  const preserved = assertPresentationTableReorderSave(
    original,
    reopened,
    expected.pointer,
  );
  checkRenderer(reopenedState, reopened);
  const afterReopen = await counts();
  assert.equal(
    afterReopen.write,
    beforeReopen.write,
    "clean file-tree reopen adds no write",
  );
  assert.equal(
    await frame.count("[data-presentation-cell], [data-presentation-reorder]"),
    0,
  );
  assert.equal(
    await panel.locator("iframe").getAttribute("sandbox"),
    "allow-same-origin",
  );
  assert.equal(await frame.count("script,iframe,a[href],[onclick]"), 0);
  evidence.reopen = {
    sha256: reopened.sha256,
    sourceReads: afterReopen.read - beforeReopen.read,
    texts: texts(expected.pointer),
    ...preserved,
  };
  evidence.finalSha256 = reopened.sha256;
  evidence.undoRedoAcrossAutomaticSave = true;
  evidence.cancelAddsNoHistory = true;
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-table-reorder-reopened.png"),
  });
  fs.writeFileSync(
    path.join(evidenceDir, "presentation-table-reorder.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  return evidence;
}
