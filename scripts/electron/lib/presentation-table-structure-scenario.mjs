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
import {
  presentationNavigationIo,
  readPresentationNavigationFile,
} from "./presentation-navigation-scenario.mjs";
import { presentationTextEditorMatches } from "./presentation-text-editor-dom.mjs";
import { ensurePresentationTableSelection } from "./presentation-table-scenario.mjs";

const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const timeout = 15_000;
const emusPerPixel = 9525;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const children = (node, name) =>
  Array.from(node?.children ?? []).filter(
    (node) => node.namespaceURI === a && node.localName === name,
  );

/** 只读取落盘结果与包不变量，不重建行列变换算法。 */
export async function readPresentationTableStructureFile(filePath) {
  const source = await readPresentationNavigationFile(filePath);
  const slide = source.slides.find((slide) => slide.id === "512");
  assert.ok(slide, "structure fixture keeps slide 512");
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath), {
    checkCRC32: true,
  });
  const dom = new JSDOM(await zip.file(slide.part).async("string"), {
    contentType: "application/xml",
  });
  try {
    const document = dom.window.document;
    const serialize = (node) =>
      new dom.window.XMLSerializer().serializeToString(node);
    const frames = Array.from(
      document.getElementsByTagNameNS(p, "graphicFrame"),
    ).filter(
      (node) =>
        node.getElementsByTagNameNS(p, "cNvPr")[0]?.getAttribute("id") === "7",
    );
    assert.equal(frames.length, 1, "table identity 7 remains unique");
    const frame = frames[0],
      table = frame.getElementsByTagNameNS(a, "tbl")[0];
    assert.ok(table);
    const transform = frame.getElementsByTagNameNS(p, "xfrm")[0];
    assert.ok(transform);
    const offset = children(transform, "off")[0],
      extent = children(transform, "ext")[0];
    assert.ok(offset && extent);
    const number = (node, name, positive = false) => {
      const raw = node.getAttribute(name);
      assert.match(raw ?? "", /^-?\d+$/);
      const value = Number(raw);
      assert.ok(Number.isSafeInteger(value) && (!positive || value > 0));
      return value;
    };
    const columns = children(children(table, "tblGrid")[0], "gridCol");
    const rows = children(table, "tr");
    assert.ok(columns.length > 0 && rows.length > 0);
    const columnWidths = columns.map((node) => number(node, "w", true));
    const rowHeights = rows.map((node) => number(node, "h", true));
    const cells = rows.map((row) => {
      const cells = children(row, "tc");
      assert.equal(
        cells.length,
        columns.length,
        "full logical table grid is retained",
      );
      return cells.map((cell) => ({
        text: children(children(cell, "txBody")[0], "p")
          .map((paragraph) =>
            Array.from(
              paragraph.getElementsByTagNameNS(a, "t"),
              (node) => node.textContent,
            ).join(""),
          )
          .join("\n"),
        xmlSha256: digest(serialize(cell)),
        merge: Object.fromEntries(
          ["gridSpan", "rowSpan", "hMerge", "vMerge"].map((name) => [
            name,
            cell.getAttribute(name),
          ]),
        ),
      }));
    });
    const orientation = transform.cloneNode(true);
    for (const node of [
      ...children(orientation, "off"),
      ...children(orientation, "ext"),
    ])
      node.remove();
    const properties = children(table, "tblPr")[0];
    assert.ok(properties);
    const geometry = {
      left: number(offset, "x"),
      top: number(offset, "y"),
      width: number(extent, "cx", true),
      height: number(extent, "cy", true),
      rotation: Number(transform.getAttribute("rot") ?? "0") / 60000,
    };
    frame.remove();
    return {
      sha256: source.sha256,
      parts: source.parts,
      slideIds: source.slides.map((slide) => slide.id),
      tablePart: slide.part,
      cells,
      columnWidths,
      rowHeights,
      geometry,
      orientationSha256: digest(serialize(orientation)),
      propertiesSha256: digest(serialize(properties)),
      outsideTableSha256: digest(serialize(document)),
    };
  } finally {
    dom.window.close();
  }
}

function expectedTexts(before, matrix) {
  return matrix.map((row) =>
    row.map((cell) =>
      cell.from ? before.cells[cell.from[0]][cell.from[1]].text : cell.text,
    ),
  );
}

/** matrix 是手写验收表；from 指向必须逐字节保留的原格，不执行生产变换。 */
export function assertPresentationTableStructureSave(before, after, expected) {
  assert.deepEqual(after.slideIds, before.slideIds);
  assert.equal(after.tablePart, before.tablePart);
  assert.equal(
    after.outsideTableSha256,
    before.outsideTableSha256,
    "non-table slide payload is retained",
  );
  assert.equal(
    after.propertiesSha256,
    before.propertiesSha256,
    "table style and unknown properties are retained",
  );
  assert.equal(
    after.orientationSha256,
    before.orientationSha256,
    "rotation, flips and transform extensions are retained",
  );
  assert.equal(after.geometry.left, before.geometry.left);
  assert.equal(after.geometry.top, before.geometry.top);
  assert.equal(after.geometry.rotation, before.geometry.rotation);
  assert.equal(
    after.geometry.width,
    after.columnWidths.reduce((sum, width) => sum + width, 0),
    "frame width equals persisted column tracks",
  );
  assert.equal(
    after.geometry.height,
    after.rowHeights.reduce((sum, height) => sum + height, 0),
    "frame height equals persisted row tracks",
  );
  assert.deepEqual(
    after.columnWidths,
    expected.columnWidths.map((width) => Math.round(width * emusPerPixel)),
  );
  assert.deepEqual(
    after.rowHeights,
    expected.rowHeights.map((height) => Math.round(height * emusPerPixel)),
  );
  assert.deepEqual(
    after.cells.map((row) => row.map((cell) => cell.text)),
    expectedTexts(before, expected.matrix),
  );
  let preservedCells = 0;
  expected.matrix.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (!cell.from) return;
      const original = before.cells[cell.from[0]][cell.from[1]];
      assert.equal(
        after.cells[r][c].xmlSha256,
        original.xmlSha256,
        `original cell payload survives at ${r}:${c}`,
      );
      preservedCells++;
    }),
  );
  assert.deepEqual(
    Object.keys(after.parts).sort(),
    Object.keys(before.parts).sort(),
  );
  let preservedParts = 0;
  for (const [part, hash] of Object.entries(before.parts)) {
    if (part === before.tablePart) continue;
    assert.equal(
      after.parts[part],
      hash,
      `non-target ZIP payload survives: ${part}`,
    );
    preservedParts++;
  }
  return { preservedCells, preservedParts };
}

function presentationStructureDom(expected = {}) {
  const panel = document.querySelector('[data-testid="presentation-panel"]');
  const controls = panel?.querySelector(
    '[data-testid="presentation-editing-controls"]',
  );
  const content = panel?.querySelector("iframe")?.contentDocument;
  const slide = content?.querySelector('[data-slide-id="512"]');
  const tables = slide?.querySelectorAll("table") ?? [];
  const table = tables[0],
    wrapper = table?.parentElement;
  const texts = Array.from(table?.rows ?? [], (row) =>
    Array.from(row.cells, (cell) => cell.textContent),
  );
  const selected = Array.from(
    slide?.querySelectorAll('[data-presentation-cell][aria-pressed="true"]') ??
      [],
    (node) => node.getAttribute("data-presentation-cell"),
  );
  const state = {
    sha256: panel?.getAttribute("data-source-sha256"),
    dirty: controls?.getAttribute("data-dirty") === "true",
    saving: controls?.getAttribute("data-saving") === "true",
    texts,
    selected,
    activeCell: content?.activeElement?.getAttribute("data-presentation-cell"),
    renderer: {
      width: parseFloat(wrapper?.style.width ?? "0"),
      height: parseFloat(wrapper?.style.height ?? "0"),
      rotation: Number(
        wrapper?.style.transform.match(/rotate\((-?[\d.]+)deg\)/)?.[1] ?? "0",
      ),
      columnPercentages: Array.from(
        table?.querySelectorAll("col") ?? [],
        (node) => parseFloat(node.style.width),
      ),
      rowPercentages: Array.from(table?.rows ?? [], (node) =>
        parseFloat(node.style.height),
      ),
    },
  };
  if (!Object.keys(expected).length) return state;
  if (
    panel?.getAttribute("data-status") !== "ready" ||
    tables.length !== 1 ||
    content.querySelector("[data-presentation-text-editor]")
  )
    return false;
  if (state.saving || state.dirty) return false;
  if (expected.sha256 && state.sha256 !== expected.sha256) return false;
  if (
    expected.texts &&
    JSON.stringify(texts) !== JSON.stringify(expected.texts)
  )
    return false;
  if (
    expected.width !== undefined &&
    Math.abs(state.renderer.width - expected.width) > 0.001
  )
    return false;
  if (
    expected.height !== undefined &&
    Math.abs(state.renderer.height - expected.height) > 0.001
  )
    return false;
  if (
    expected.selected &&
    (selected.length !== 1 || selected[0] !== expected.selected)
  )
    return false;
  if (expected.activeCell && state.activeCell !== expected.activeCell)
    return false;
  return state;
}

/** 在独立 table fixture / 基础 cell 场景后调用；只用真实控件、原文件和 IPC。 */
export async function runPresentationTableStructureScenario({
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
  const original = await readPresentationTableStructureFile(filePath);
  assert.equal(original.cells.length, 2);
  assert.equal(original.cells[0].length, 3);
  assert.deepEqual(original.columnWidths, [1828800, 1828800, 1828800]);
  assert.deepEqual(original.rowHeights, [914400, 914400]);
  const source = (row, column) => ({ from: [row, column] });
  const [A, B, C, D, E, F] = [
    source(0, 0),
    source(0, 1),
    source(0, 2),
    source(1, 0),
    source(1, 1),
    source(1, 2),
  ];
  const blank = { text: "" };
  const initial = {
    matrix: [
      [A, B, C],
      [D, E, F],
    ],
    columnWidths: [192, 192, 192],
    rowHeights: [96, 96],
  };
  const above = {
    matrix: [
      [A, B, C],
      [blank, blank, blank],
      [D, E, F],
    ],
    columnWidths: [192, 192, 192],
    rowHeights: [96, 96, 96],
  };
  const below = {
    matrix: [
      [A, B, C],
      [blank, blank, blank],
      [blank, blank, blank],
      [D, E, F],
    ],
    columnWidths: [192, 192, 192],
    rowHeights: [96, 96, 96, 96],
  };
  const left = {
    matrix: [
      [A, blank, B, C],
      [blank, blank, blank, blank],
      [D, blank, E, F],
    ],
    columnWidths: [192, 192, 192, 192],
    rowHeights: [96, 96, 96],
  };
  const right = {
    matrix: [
      [A, blank, blank, B, C],
      [blank, blank, blank, blank, blank],
      [D, blank, blank, E, F],
    ],
    columnWidths: [192, 192, 192, 192, 192],
    rowHeights: [96, 96, 96],
  };
  const newCell = { text: "STRUCTURE_NEW_CELL_中文 <&>" };
  const edited = {
    ...left,
    matrix: [
      [A, blank, B, C],
      [blank, newCell, blank, blank],
      [D, blank, E, F],
    ],
  };
  const wider = { ...edited, columnWidths: [160, 160, 160, 160] };
  const resized = { ...wider, rowHeights: [80, 80, 80] };
  const appended = {
    ...resized,
    matrix: [...resized.matrix, [blank, blank, blank, blank]],
    rowHeights: [80, 80, 80, 80],
  };
  const appendedText = { text: "STRUCTURE_TAB_APPENDED_中文 <&>" };
  const final = {
    ...appended,
    matrix: [...resized.matrix, [appendedText, blank, blank, blank]],
  };
  const evidence = {
    initialSha256: original.sha256,
    manualSaveClicks: 0,
    stages: [],
  };
  const record = (row) => {
    evidence.stages.push(row);
    fs.writeFileSync(
      path.join(evidenceDir, "presentation-table-structure.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  };
  const waitState = async (expected) => {
    const handle = await page.waitForFunction(
      presentationStructureDom,
      expected,
      { timeout },
    );
    try {
      return await handle.jsonValue();
    } finally {
      await handle.dispose();
    }
  };
  const expectedDom = (expected) => ({
    texts: expectedTexts(original, expected.matrix),
    width: expected.columnWidths.reduce((sum, value) => sum + value, 0),
    height: expected.rowHeights.reduce((sum, value) => sum + value, 0),
  });
  const capture = async () => ({
    sha256: digest(fs.readFileSync(filePath)),
    io: await counts(),
  });
  const assertRenderer = (state, disk, expected) => {
    assert.equal(state.sha256, disk.sha256);
    assert.equal(state.renderer.rotation, disk.geometry.rotation);
    assert.equal(
      state.renderer.columnPercentages.length,
      expected.columnWidths.length,
    );
    assert.equal(
      state.renderer.rowPercentages.length,
      expected.rowHeights.length,
    );
    const totalWidth = expected.columnWidths.reduce(
      (sum, value) => sum + value,
      0,
    );
    const totalHeight = expected.rowHeights.reduce(
      (sum, value) => sum + value,
      0,
    );
    state.renderer.columnPercentages.forEach((percentage, index) =>
      assert.ok(
        Math.abs(
          percentage - (expected.columnWidths[index] * 100) / totalWidth,
        ) < 0.0001,
      ),
    );
    state.renderer.rowPercentages.forEach((percentage, index) =>
      assert.ok(
        Math.abs(
          percentage - (expected.rowHeights[index] * 100) / totalHeight,
        ) < 0.0001,
      ),
    );
  };
  const saved = async (name, before, expected, focus = {}) => {
    const state = await waitState({ ...expectedDom(expected), ...focus });
    const disk = await readPresentationTableStructureFile(filePath);
    const preserved = assertPresentationTableStructureSave(
      original,
      disk,
      expected,
    );
    assert.notEqual(
      disk.sha256,
      before.sha256,
      `${name}: automatic save changed real source bytes`,
    );
    assertRenderer(state, disk, expected);
    const io = await counts();
    const fileIoDelta = {
      read: io.read - before.io.read,
      write: io.write - before.io.write,
    };
    assert.ok(
      fileIoDelta.read >= 2 && fileIoDelta.write > 0,
      `${name}: source is verified twice and written through real IPC`,
    );
    record({
      name,
      sha256: disk.sha256,
      ...preserved,
      fileIoDelta,
      selected: state.selected,
      activeCell: state.activeCell,
      renderer: state.renderer,
      automaticSave: true,
    });
    return disk;
  };
  const select = async (row, column) => {
    const before = await page.evaluate(presentationStructureDom);
    const input = await frame.click(
      `[data-presentation-table-id="7"] [data-presentation-cell="${row}:${column}"]`,
      undefined,
      { capture: true },
    );
    const selection = {
      target: `${row}:${column}`,
      before,
      input,
      afterInput: await page.evaluate(presentationStructureDom),
    };
    evidence.nativeSelections ??= [];
    evidence.nativeSelections.push(selection);
    fs.writeFileSync(
      path.join(evidenceDir, "presentation-table-structure.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    await waitState({ selected: `${row}:${column}` });
  };
  const action = async (name, row, column, expected) => {
    await select(row, column);
    const before = await capture();
    await tableControls
      .getByRole("button", { name: "表格操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name, exact: true }).click();
    return saved(name, before, expected);
  };
  const enterText = async (value) => {
    await frame.visible("[data-presentation-text-editor]");
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText(value);
    const active = await page.waitForFunction(
      presentationTextEditorMatches,
      { selector: presentationFrameSelector, value },
      { timeout },
    );
    await active.dispose();
    await page.keyboard.press("ControlOrMeta+Enter");
  };

  await waitForPresentationSlide(page, "512");
  await waitState({ ...expectedDom(initial), sha256: original.sha256 });
  if (await controls.getByRole("button", { name: "编辑", exact: true }).count())
    await controls.getByRole("button", { name: "编辑", exact: true }).click();
  evidence.entry = await ensurePresentationTableSelection(frame, controls);
  await frame.visible('[data-presentation-cell="0:0"]');
  await action("在上方插入行", 1, 1, above);
  await action("在下方插入行", 0, 0, below);
  await action("删除所选行", 1, 0, above);
  await action("在左侧插入列", 0, 1, left);
  await action("在右侧插入列", 0, 0, right);
  await action("删除所选列", 0, 1, left);

  await select(1, 1);
  let before = await capture();
  await tableControls
    .getByRole("button", { name: "编辑文字", exact: true })
    .click();
  await enterText(newCell.text);
  await saved("edit-inserted-cell", before, edited);
  const resize = async (label, value, expected) => {
    const input = controls.getByRole("spinbutton", {
      name: label,
      exact: true,
    });
    assert.equal(await input.isEnabled(), true);
    const before = await capture();
    await input.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText(String(value));
    await page.keyboard.press("Tab");
    return saved(`resize-${label}`, before, expected);
  };
  await resize("宽（px）", 640, wider);
  await resize("高（px）", 240, resized);
  before = await capture();
  await controls.getByRole("button", { name: "撤销", exact: true }).click();
  await saved("undo-height-after-save", before, wider);
  before = await capture();
  await controls.getByRole("button", { name: "重做", exact: true }).click();
  await saved("redo-height-after-save", before, resized);
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-table-structure-resized.png"),
  });

  await select(2, 3);
  before = await capture();
  await page.keyboard.press("Tab");
  await saved("tab-last-cell-appends-row", before, appended, {
    selected: "3:0",
    activeCell: "3:0",
  });
  evidence.lastCellTabFocus = true;
  before = await capture();
  await page.keyboard.press("Enter");
  await enterText(appendedText.text);
  const finalDisk = await saved("keyboard-edit-appended-cell", before, final);

  await controls.getByRole("button", { name: "结束编辑", exact: true }).click();
  const beforeReopen = await counts();
  await replaceFileTab(page, filePath);
  await waitForArtifactFileRead(
    async () => (await counts()).read,
    beforeReopen.read,
    timeout,
  );
  const reopened = await waitState({
    ...expectedDom(final),
    sha256: finalDisk.sha256,
  });
  const disk = await readPresentationTableStructureFile(filePath);
  assert.equal(disk.sha256, finalDisk.sha256);
  assertPresentationTableStructureSave(original, disk, final);
  assertRenderer(reopened, disk, final);
  const afterReopen = await counts();
  assert.equal(
    afterReopen.write,
    beforeReopen.write,
    "clean structure reopen performs no write",
  );
  assert.equal(await frame.count("[data-presentation-cell]"), 0);
  assert.equal(
    await panel.locator("iframe").getAttribute("sandbox"),
    "allow-same-origin",
  );
  assert.equal(await frame.count("script,iframe,a[href],[onclick]"), 0);
  evidence.reopen = {
    sha256: disk.sha256,
    sourceReads: afterReopen.read - beforeReopen.read,
    renderer: reopened.renderer,
    texts: reopened.texts,
  };
  evidence.finalSha256 = disk.sha256;
  evidence.sixStructureActions = true;
  evidence.widthHeightTracksPersisted = true;
  evidence.undoRedoAcrossSave = true;
  evidence.scriptsAllowed = false;
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-table-structure-reopened.png"),
  });
  fs.writeFileSync(
    path.join(evidenceDir, "presentation-table-structure.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  return evidence;
}
