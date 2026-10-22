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
import {
  assertPresentationTableStructureSave,
  readPresentationTableStructureFile,
} from "./presentation-table-structure-scenario.mjs";

const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const emusPerPixel = 9525;
const timeout = 15_000;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const noMerge = { gridSpan: null, rowSpan: null, hMerge: null, vMerge: null };
const pointerObservationKey = "__limePresentationTableNativePointerObservation";
const mergedMarkers = [
  [
    { gridSpan: "2", rowSpan: "2", hMerge: null, vMerge: null },
    { gridSpan: null, rowSpan: "2", hMerge: "1", vMerge: null },
    noMerge,
  ],
  [
    { gridSpan: "2", rowSpan: null, hMerge: null, vMerge: "1" },
    { gridSpan: null, rowSpan: null, hMerge: "1", vMerge: "1" },
    noMerge,
  ],
];

/** 补充与 merge markers 无关的逐格摘要；不调用生产编辑或变换算法。 */
export async function readPresentationTableAdvancedFile(filePath) {
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
    const cells = frame.getElementsByTagNameNS(a, "tc");
    const payloads = Array.from(cells, (node) => {
      const cell = node.cloneNode(true);
      for (const attribute of Object.keys(noMerge))
        cell.removeAttribute(attribute);
      return digest(new dom.window.XMLSerializer().serializeToString(cell));
    });
    return { ...source, payloads };
  } finally {
    dom.window.close();
  }
}

/** 合并只改变四个标记；原六格的正文、格式和未知 XML 必须逐字节保留。 */
export function assertPresentationTableAdvancedSave(before, after, expected) {
  const preserved = assertPresentationTableStructureSave(before, after, {
    matrix: before.cells.map((row) => row.map((cell) => ({ text: cell.text }))),
    columnWidths: expected.columnWidths.map((value) => value / emusPerPixel),
    rowHeights: expected.rowHeights.map((value) => value / emusPerPixel),
  });
  assert.deepEqual(
    after.payloads,
    before.payloads,
    "every physical cell retains its complete non-merge payload",
  );
  assert.deepEqual(
    after.cells.map((row) => row.map((cell) => cell.merge)),
    expected.merged
      ? mergedMarkers
      : [
          [noMerge, noMerge, noMerge],
          [noMerge, noMerge, noMerge],
        ],
    "persisted merge markers match the handwritten 2x2 rectangle",
  );
  return { ...preserved, preservedCells: before.payloads.length };
}

/** 原生输入必须归因到同一 trusted pointer；状态变化不能代替取消事件证据。 */
export function assertPresentationTableNativePointerEvents(
  events,
  pointerType,
  terminal,
) {
  const down = events.find((event) => event.type === "pointerdown");
  assert.ok(
    down?.isTrusted &&
      down.pointerType === pointerType &&
      Number.isInteger(down.pointerId),
    "native pointerdown has trusted identity and type",
  );
  const same = events
    .slice(events.indexOf(down))
    .filter((event) => event.pointerId === down.pointerId);
  assert.ok(
    same.every((event) => event.isTrusted && event.pointerType === pointerType),
    "all native pointer events retain trusted identity and type",
  );
  assert.ok(
    same.some((event) => event.type === "pointermove"),
    "same native pointer produced a preview move",
  );
  const ending = same.filter(
    (event) => event.type === "pointerup" || event.type === "pointercancel",
  );
  assert.equal(
    ending.length,
    1,
    "native pointer has exactly one terminal event",
  );
  assert.equal(
    ending[0].type,
    terminal,
    "native pointer terminates through the requested lifecycle",
  );
  return {
    pointerId: down.pointerId,
    pointerType,
    terminal,
    isTrusted: true,
    events: same,
  };
}

async function observeNativePointer(page, run) {
  await page.evaluate(
    ({ frameSelector, key }) => {
      const content = document.querySelector(frameSelector)?.contentDocument;
      if (!content || window[key])
        throw new Error(
          "native pointer observer requires a fresh same-origin document",
        );
      const events = [];
      // 回调属于父文档 realm，只读原生事件；不向受限 iframe 安装脚本或修改产品状态。
      const record = (event) => {
        if (!event.target?.closest?.('[data-presentation-track="column:0"]'))
          return;
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
    { frameSelector: presentationFrameSelector, key: pointerObservationKey },
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
    }, pointerObservationKey);
  }
  return events;
}

function advancedDom(expected = {}) {
  const panel = document.querySelector('[data-testid="presentation-panel"]');
  const controls = panel?.querySelector(
    '[data-testid="presentation-editing-controls"]',
  );
  const content = panel?.querySelector("iframe")?.contentDocument;
  const slide = content?.querySelector('[data-slide-id="512"]');
  const tables = slide?.querySelectorAll("table") ?? [];
  const table = tables[0];
  const wrapper = table?.parentElement;
  const state = {
    sha256: panel?.getAttribute("data-source-sha256"),
    dirty: controls?.getAttribute("data-dirty") === "true",
    saving: controls?.getAttribute("data-saving") === "true",
    selected: Array.from(
      slide?.querySelectorAll(
        '[data-presentation-cell][aria-pressed="true"]',
      ) ?? [],
      (node) => node.getAttribute("data-presentation-cell"),
    ),
    activeTrack: content?.activeElement?.getAttribute(
      "data-presentation-track",
    ),
    cells: Array.from(table?.rows ?? [], (row) =>
      Array.from(row.cells, (cell) => ({
        text: cell.textContent,
        columns: cell.colSpan,
        rows: cell.rowSpan,
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
  if (expected.activeTrack && state.activeTrack !== expected.activeTrack)
    return false;
  if (
    expected.selected &&
    JSON.stringify(state.selected) !== JSON.stringify(expected.selected)
  )
    return false;
  if (
    expected.cells &&
    JSON.stringify(state.cells) !== JSON.stringify(expected.cells)
  )
    return false;
  for (const axis of ["width", "height"])
    if (
      expected[axis] !== undefined &&
      Math.abs(state.renderer[axis] - expected[axis]) > 0.001
    )
      return false;
  return state;
}

/** 仅在同一真实文件的基础 cell 场景后调用；父入口负责进程、freshness 与零 mock 门禁。 */
export async function runPresentationTableAdvancedScenario({
  page,
  evidenceDir,
  filePath,
  readTrace,
}) {
  assert.equal(typeof readTrace, "function");
  const panel = page.getByTestId("presentation-panel");
  const controls = panel.getByTestId("presentation-editing-controls");
  const tableControls = panel.getByTestId("presentation-table-controls");
  const frame = createArtifactFrameDriver(page, presentationFrameSelector);
  const counts = async () =>
    presentationNavigationIo(await readTrace(), filePath);
  const original = await readPresentationTableAdvancedFile(filePath);
  const texts = [
    ["表格第一格_中文 <&>", "独立第二格_中文 <&>", "TABLE_R1C3"],
    ["TABLE_R2C1", "TABLE_R2C2", ""],
  ];
  assert.deepEqual(
    original.cells.map((row) => row.map((cell) => cell.text)),
    texts,
  );
  assert.deepEqual(original.columnWidths, [1828800, 1828800, 1828800]);
  assert.deepEqual(original.rowHeights, [914400, 914400]);
  const initial = {
    columnWidths: [1828800, 1828800, 1828800],
    rowHeights: [914400, 914400],
    merged: false,
  };
  const merged = { ...initial, merged: true };
  const wider = { ...initial, columnWidths: [1924050, 1828800, 1828800] };
  const taller = { ...wider, rowHeights: [1009650, 914400] };
  const evidence = {
    initialSha256: original.sha256,
    manualSaveClicks: 0,
    stages: [],
  };
  const record = (value) => {
    evidence.stages.push(value);
    fs.writeFileSync(
      path.join(evidenceDir, "presentation-table-advanced.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  };
  const waitState = async (expected) => {
    const handle = await page.waitForFunction(advancedDom, expected, {
      timeout,
    });
    try {
      return await handle.jsonValue();
    } finally {
      await handle.dispose();
    }
  };
  const cellSelector = (row, column) =>
    `[data-presentation-table-id="7"] [data-presentation-cell="${row}:${column}"]`;
  const trackSelector = (axis, index) =>
    `[data-presentation-table-id="7"] [data-presentation-track="${axis}:${index}"]`;
  const expectedDom = (expected) => ({
    width:
      expected.columnWidths.reduce((sum, value) => sum + value, 0) /
      emusPerPixel,
    height:
      expected.rowHeights.reduce((sum, value) => sum + value, 0) / emusPerPixel,
    cells: expected.merged
      ? [
          [
            { text: texts[0][0], columns: 2, rows: 2 },
            { text: texts[0][2], columns: 1, rows: 1 },
          ],
          [{ text: texts[1][2], columns: 1, rows: 1 }],
        ]
      : texts.map((row) => row.map((text) => ({ text, columns: 1, rows: 1 }))),
  });
  const capture = async () => ({
    sha256: digest(fs.readFileSync(filePath)),
    io: await counts(),
  });
  const checkRenderer = (state, disk) => {
    assert.equal(
      state.sha256,
      disk.sha256,
      "renderer and disk share the same source revision",
    );
    assert.equal(state.renderer.rotation, disk.geometry.rotation);
    for (const [percentages, tracks] of [
      [state.renderer.columns, disk.columnWidths],
      [state.renderer.rows, disk.rowHeights],
    ]) {
      assert.equal(percentages.length, tracks.length);
      const total = tracks.reduce((sum, value) => sum + value, 0);
      percentages.forEach((value, index) =>
        assert.ok(
          Math.abs(value - (tracks[index] * 100) / total) < 0.0001,
          "renderer tracks agree with saved OOXML",
        ),
      );
    }
  };
  const saved = async (name, before, expected, focus = {}) => {
    const state = await waitState({
      ...expectedDom(expected),
      changedFrom: before.sha256,
      ...focus,
    });
    const disk = await readPresentationTableAdvancedFile(filePath);
    const preserved = assertPresentationTableAdvancedSave(
      original,
      disk,
      expected,
    );
    assert.notEqual(
      disk.sha256,
      before.sha256,
      `${name}: automatic save changes source bytes`,
    );
    checkRenderer(state, disk);
    const io = await counts();
    const fileIoDelta = {
      read: io.read - before.io.read,
      write: io.write - before.io.write,
    };
    assert.ok(
      fileIoDelta.read >= 2 && fileIoDelta.write > 0,
      `${name}: source is checked twice and written through real IPC`,
    );
    record({
      name,
      sha256: disk.sha256,
      ...preserved,
      fileIoDelta,
      activeTrack: state.activeTrack,
      renderer: state.renderer,
      automaticSave: true,
    });
    return disk;
  };
  const select = async (row, column) => {
    await frame.click(cellSelector(row, column));
    await waitState({ selected: [`${row}:${column}`] });
  };
  const menu = async (label) => {
    await tableControls
      .getByRole("button", { name: "表格操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: label, exact: true }).click();
  };
  const history = async (label, name, expected) => {
    const before = await capture();
    await controls.getByRole("button", { name: label, exact: true }).click();
    return saved(name, before, expected);
  };
  await waitForPresentationSlide(page, "512");
  await waitState({ ...expectedDom(initial), sha256: original.sha256 });
  await controls.getByRole("button", { name: "编辑", exact: true }).click();
  evidence.entry = await ensurePresentationTableSelection(frame, controls);
  await select(0, 0);
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await waitState({ selected: ["0:0", "0:1", "1:0", "1:1"] });
  let before = await capture();
  await menu("合并单元格");
  await saved("merge-four-cells-keeps-six-payloads", before, merged);
  await history("撤销", "undo-merge-after-save", initial);
  await history("重做", "redo-merge-after-save", merged);
  await select(0, 0);
  before = await capture();
  await menu("取消合并");
  await saved("unmerge-restores-all-six-source-texts", before, initial);
  await history("撤销", "undo-unmerge-after-save", merged);
  await history("重做", "redo-unmerge-after-save", initial);

  const trackCoordinates = async (axis) => {
    const selector = trackSelector(axis, 0);
    const box = (await frame.visible(selector)).box;
    const vector = await page.evaluate(
      ({ frameSelector, selector, axis }) => {
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
        const localX = axis === "row" ? -handle.clientWidth / 4 : 0;
        const localY = axis === "column" ? -handle.clientHeight / 4 : 0;
        // 避开行列 separator 的交点；只读取实际 CSS 变换计算原生输入坐标。
        return {
          x: transform.a,
          y: transform.b,
          scale: Math.hypot(slide.a, slide.b),
          offsetX: transform.a * localX + transform.c * localY,
          offsetY: transform.b * localX + transform.d * localY,
        };
      },
      { frameSelector: presentationFrameSelector, selector, axis },
    );
    assert.ok(
      vector &&
        vector.scale > 0 &&
        Number.isFinite(vector.x) &&
        Number.isFinite(vector.y),
    );
    const start = {
      x: box.x + box.width / 2 + vector.offsetX,
      y: box.y + box.height / 2 + vector.offsetY,
    };
    const end = { x: start.x + vector.x * 12, y: start.y + vector.y * 12 };
    const viewport = page.viewportSize();
    for (const point of [start, end])
      assert.ok(
        point.x > 0 &&
          point.y > 0 &&
          point.x < viewport.width &&
          point.y < viewport.height,
        "native pointer remains inside viewport",
      );
    const hit = await page.evaluate(
      ({ frameSelector, selector, point }) => {
        const iframe = document.querySelector(frameSelector);
        const rect = iframe?.getBoundingClientRect();
        const content = iframe?.contentDocument;
        const handle = content?.querySelector(selector);
        if (!iframe || !rect || !content || !handle) return false;
        return (
          document.elementFromPoint(point.x, point.y) === iframe &&
          handle.contains(
            content.elementFromPoint(
              point.x - rect.left - iframe.clientLeft,
              point.y - rect.top - iframe.clientTop,
            ),
          )
        );
      },
      { frameSelector: presentationFrameSelector, selector, point: start },
    );
    assert.equal(hit, true, "native pointer hits the visible table separator");
    return { start, end, vector };
  };
  const keyboardResize = async (axis, key, expected) => {
    const { start } = await trackCoordinates(axis);
    await page.mouse.click(start.x, start.y);
    await waitState({ activeTrack: `${axis}:0` });
    const before = await capture();
    await page.keyboard.press(key);
    return saved(`keyboard-${axis}-plus-ten`, before, expected, {
      activeTrack: `${axis}:0`,
    });
  };
  await keyboardResize("column", "Shift+ArrowRight", wider);
  await keyboardResize("row", "Shift+ArrowDown", taller);
  const waitPreview = async (resizing) => {
    const handle = await page.waitForFunction(
      ({ frameSelector, resizing }) => {
        const node = document
          .querySelector(frameSelector)
          ?.contentDocument?.querySelector(
            '[data-presentation-track="column:0"]',
          );
        return (
          node && (node.getAttribute("data-resizing") === "true") === resizing
        );
      },
      { frameSelector: presentationFrameSelector, resizing },
      { timeout },
    );
    await handle.dispose();
  };
  const noWrite = async (name, before) => {
    // 超过 500ms 自动保存窗口，验证预览/取消不会延迟写回，而非用等待合成成功终态。
    await page.waitForTimeout(650);
    assert.equal(
      digest(fs.readFileSync(filePath)),
      before.sha256,
      `${name}: no source mutation`,
    );
    assert.equal(
      (await counts()).write,
      before.io.write,
      `${name}: no IPC write`,
    );
  };
  const pointer = await trackCoordinates("column");
  before = await capture();
  const mouseEvents = await observeNativePointer(page, async () => {
    await page.mouse.move(pointer.start.x, pointer.start.y);
    await page.mouse.down();
    await page.mouse.move(pointer.end.x, pointer.end.y, { steps: 4 });
    await waitPreview(true);
    await noWrite("pointer-preview", before);
    await page.mouse.up();
  });
  const mouseLifecycle = assertPresentationTableNativePointerEvents(
    mouseEvents,
    "mouse",
    "pointerup",
  );
  const pointerState = await waitState({
    cells: expectedDom(taller).cells,
    changedFrom: before.sha256,
    activeTrack: "column:0",
  });
  const pointerDisk = await readPresentationTableAdvancedFile(filePath);
  assert.ok(
    pointerDisk.columnWidths[0] >= 210 * emusPerPixel &&
      pointerDisk.columnWidths[0] <= 216 * emusPerPixel,
    "12px native drag increases the first column by 8..14px, including screen-pixel quantization",
  );
  assert.deepEqual(
    pointerDisk.columnWidths.slice(1),
    taller.columnWidths.slice(1),
  );
  assert.deepEqual(pointerDisk.rowHeights, taller.rowHeights);
  const dragged = { ...taller, columnWidths: pointerDisk.columnWidths };
  checkRenderer(pointerState, pointerDisk);
  await saved("native-column-pointer-commit", before, dragged, {
    activeTrack: "column:0",
  });
  evidence.pointer = {
    ...pointer,
    nativeMouse: true,
    lifecycle: mouseLifecycle,
    firstColumnEmu: pointerDisk.columnWidths[0],
  };

  const cancelledPointer = await trackCoordinates("column");
  before = await capture();
  const cdp = await page.context().newCDPSession(page);
  const cancelEvents = await observeNativePointer(page, async () => {
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
        touchPoints: point(cancelledPointer.start),
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: point(cancelledPointer.end),
      });
      await waitPreview(true);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchCancel",
        touchPoints: [],
      });
      await waitPreview(false);
    } finally {
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
      await cdp.detach();
    }
  });
  const cancelLifecycle = assertPresentationTableNativePointerEvents(
    cancelEvents,
    "touch",
    "pointercancel",
  );
  await noWrite("native-pointer-cancel", before);
  record({
    name: "native-pointer-cancel",
    sha256: before.sha256,
    nativeTouchCancel: true,
    lifecycle: cancelLifecycle,
    sourceWrites: 0,
    observationMs: 650,
  });
  await history(
    "撤销",
    "cancel-adds-no-history-single-undo-reverts-commit",
    taller,
  );
  await history("重做", "single-redo-restores-pointer-commit", dragged);

  await select(0, 0);
  before = await capture();
  await menu("平均分布行");
  const rows = { ...dragged, rowHeights: [962025, 962025] };
  await saved("distribute-all-rows-from-single-cell", before, rows);
  before = await capture();
  await menu("平均分布列");
  const distributedState = await waitState({
    cells: expectedDom(rows).cells,
    changedFrom: before.sha256,
  });
  const distributedDisk = await readPresentationTableAdvancedFile(filePath);
  assert.equal(
    distributedDisk.columnWidths.reduce((sum, value) => sum + value, 0),
    dragged.columnWidths.reduce((sum, value) => sum + value, 0),
    "distribution retains exact total EMU",
  );
  assert.ok(
    Math.max(...distributedDisk.columnWidths) -
      Math.min(...distributedDisk.columnWidths) <=
      1,
    "three distributed tracks differ by at most one EMU",
  );
  const final = { ...rows, columnWidths: distributedDisk.columnWidths };
  checkRenderer(distributedState, distributedDisk);
  const finalDisk = await saved(
    "distribute-all-columns-keeps-frame-and-cell-payload",
    before,
    final,
  );
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-table-advanced-edited.png"),
  });

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
    ...expectedDom(final),
    sha256: finalDisk.sha256,
  });
  const reopened = await readPresentationTableAdvancedFile(filePath);
  assert.equal(reopened.sha256, finalDisk.sha256);
  const preserved = assertPresentationTableAdvancedSave(
    original,
    reopened,
    final,
  );
  checkRenderer(reopenedState, reopened);
  const afterReopen = await counts();
  assert.equal(
    afterReopen.write,
    beforeReopen.write,
    "clean reopen adds no write",
  );
  assert.equal(
    await frame.count("[data-presentation-cell], [data-presentation-track]"),
    0,
    "reopened document is in view mode",
  );
  assert.equal(
    await panel.locator("iframe").getAttribute("sandbox"),
    "allow-same-origin",
  );
  assert.equal(await frame.count("script,iframe,a[href],[onclick]"), 0);
  evidence.reopen = {
    sha256: reopened.sha256,
    sourceReads: afterReopen.read - beforeReopen.read,
    ...preserved,
    texts,
  };
  evidence.finalSha256 = reopened.sha256;
  evidence.undoRedoAcrossAutomaticSave = true;
  evidence.cancelAddsNoHistory = true;
  evidence.scriptsAllowed = false;
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-table-advanced-reopened.png"),
  });
  fs.writeFileSync(
    path.join(evidenceDir, "presentation-table-advanced.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  return evidence;
}
