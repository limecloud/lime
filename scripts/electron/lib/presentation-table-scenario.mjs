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

const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const timeout = 15_000;
const slideId = "512";
const tableId = "7";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const children = (node, localName) =>
  Array.from(node.children).filter(
    (child) => child.namespaceURI === a && child.localName === localName,
  );

/** 比较展开后的 XML 名称和内容；xmlns 闭包不改变正文语义。 */
function bodySignature(node) {
  if (node.nodeType !== 1)
    return [node.nodeType, node.nodeName, node.nodeValue];
  const attributes = Array.from(node.attributes)
    .filter(
      (attribute) => attribute.namespaceURI !== "http://www.w3.org/2000/xmlns/",
    )
    .map((attribute) => [
      attribute.namespaceURI,
      attribute.localName,
      attribute.value,
    ])
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  return [
    node.namespaceURI,
    node.localName,
    attributes,
    Array.from(node.childNodes, bodySignature),
  ];
}

/** 应用 scope 保留选区时复用它；未选中时仍通过真实命中选择表格。 */
export async function ensurePresentationTableSelection(frame, controls) {
  await controls
    .getByRole("button", { name: "结束编辑", exact: true })
    .waitFor();
  const selected = await controls
    .getByTestId("presentation-table-controls")
    .isVisible();
  if (!selected) await frame.click('[data-presentation-element-id="7"]');
  await frame.visible(
    '[data-presentation-table-id="7"] [data-presentation-cell="0:0"]',
  );
  return { retainedSelection: selected };
}

/** 和包级测试共享同一真实两行三列夹具，不另造表格或桥接状态。 */
export async function writePresentationTableFixture(filePath) {
  const { tableFixture } =
    await import("../../../src/components/artifact/presentation/presentationTablePackage.testFixtures.ts");
  fs.writeFileSync(filePath, await tableFixture());
  fs.writeFileSync(
    path.join(path.dirname(filePath), "Broken.pptx"),
    "invalid presentation",
  );
  const snapshot = await readPresentationTableFile(filePath);
  return {
    sha256: snapshot.sha256,
    slideId,
    tableId,
    rowCount: 2,
    columnCount: 3,
  };
}

/** 从落盘 OOXML 核对真实格网、目标文字和应保留的未知 payload。 */
export async function readPresentationTableFile(filePath) {
  const source = await readPresentationNavigationFile(filePath);
  const target = source.slides.find((slide) => slide.id === slideId);
  assert.ok(target, "table fixture has slide 512");
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath), {
    checkCRC32: true,
  });
  const dom = new JSDOM(await zip.file(target.part).async("string"), {
    contentType: "application/xml",
  });
  try {
    const document = dom.window.document;
    const serialize = (node) =>
      new dom.window.XMLSerializer().serializeToString(node);
    const frames = Array.from(
      document.getElementsByTagNameNS(p, "graphicFrame"),
    ).filter(
      (frame) =>
        frame.getElementsByTagNameNS(p, "cNvPr")[0]?.getAttribute("id") ===
        tableId,
    );
    assert.equal(frames.length, 1, "table identity is unique");
    const frame = frames[0];
    const data = frame.getElementsByTagNameNS(a, "graphicData")[0];
    assert.equal(
      data?.getAttribute("uri"),
      `${a.substring(0, a.lastIndexOf("/"))}/table`,
    );
    const table = children(data, "tbl")[0];
    assert.ok(table, "table has a drawingml grid");
    const rows = children(table, "tr");
    const grid = children(table, "tblGrid")[0];
    assert.ok(grid);
    assert.equal(rows.length, 2, "fixture has two rows");
    assert.equal(
      children(grid, "gridCol").length,
      3,
      "fixture has three columns",
    );
    const cells = [];
    for (const [row, line] of rows.entries()) {
      const columns = children(line, "tc");
      assert.equal(columns.length, 3, "fixture keeps its full logical grid");
      for (const [column, cell] of columns.entries()) {
        for (const flag of ["hMerge", "vMerge"])
          assert.ok(
            [null, "0", "false"].includes(cell.getAttribute(flag)),
            "table fixture is unmerged",
          );
        for (const span of ["gridSpan", "rowSpan"])
          assert.ok(
            [null, "1"].includes(cell.getAttribute(span)),
            "table fixture cells span one slot",
          );
        const body = children(cell, "txBody")[0];
        assert.ok(body, "each fixture cell has a text body");
        const runs = Array.from(body.getElementsByTagNameNS(a, "r"));
        assert.equal(runs.length, 1, "single-line fixture keeps one text run");
        const properties = children(runs[0], "rPr")[0];
        assert.ok(properties, "cell keeps its source text properties");
        const nonBoldProperties = properties.cloneNode(true);
        nonBoldProperties.removeAttribute("b");
        const stableBody = body.cloneNode(true);
        for (const name of ["r", "defRPr"])
          for (const node of Array.from(
            stableBody.getElementsByTagNameNS(a, name),
          ))
            node.remove();
        for (const node of stableBody.getElementsByTagNameNS(a, "endParaRPr"))
          node.removeAttribute("b");
        cells.push({
          row,
          column,
          text: children(body, "p")
            .map((paragraph) =>
              Array.from(
                paragraph.getElementsByTagNameNS(a, "t"),
                (text) => text.textContent,
              ).join(""),
            )
            .join("\n"),
          bold: ["1", "true"].includes(properties.getAttribute("b")),
          xmlSha256: digest(serialize(cell)),
          nonBoldPropertiesSha256: digest(serialize(nonBoldProperties)),
          stableBodySha256: digest(JSON.stringify(bodySignature(stableBody))),
        });
      }
    }
    const topology = frame.cloneNode(true);
    for (const body of Array.from(topology.getElementsByTagNameNS(a, "txBody")))
      body.remove();
    frame.remove();
    return {
      sha256: source.sha256,
      slideIds: source.slides.map((slide) => slide.id),
      parts: source.parts,
      tablePart: target.part,
      tableId,
      rowCount: 2,
      columnCount: 3,
      cells,
      topologySha256: digest(serialize(topology)),
      outsideTableSha256: digest(serialize(document)),
    };
  } finally {
    dom.window.close();
  }
}

/** expectedCells 只声明允许变化的格；其他 cell、样式、格网和 ZIP 成员必须保留。 */
export function assertPresentationTableSave(before, after, expectedCells) {
  assert.deepEqual(after.slideIds, before.slideIds);
  assert.equal(after.tablePart, before.tablePart);
  assert.equal(after.tableId, before.tableId);
  assert.equal(
    after.topologySha256,
    before.topologySha256,
    "table geometry, grid and cell payload are preserved",
  );
  assert.equal(
    after.outsideTableSha256,
    before.outsideTableSha256,
    "non-table slide XML is preserved",
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
      `unedited ZIP part is preserved: ${part}`,
    );
    preservedParts++;
  }
  const changed = new Map(
    expectedCells.map((cell) => [`${cell.row}:${cell.column}`, cell]),
  );
  assert.equal(
    changed.size,
    expectedCells.length,
    "expected cell addresses are unique",
  );
  let preservedCells = 0;
  for (const original of before.cells) {
    const actual = after.cells.find(
      (cell) => cell.row === original.row && cell.column === original.column,
    );
    assert.ok(actual);
    const expected = changed.get(`${original.row}:${original.column}`);
    assert.equal(
      actual.text,
      expected?.text ?? original.text,
      `source cell text ${original.row}:${original.column}`,
    );
    assert.equal(
      actual.bold,
      expected?.bold ?? original.bold,
      `source cell bold ${original.row}:${original.column}`,
    );
    assert.equal(
      actual.nonBoldPropertiesSha256,
      original.nonBoldPropertiesSha256,
      "other run formatting is preserved",
    );
    assert.equal(
      actual.stableBodySha256,
      original.stableBodySha256,
      "body, list and paragraph properties are preserved",
    );
    if (!expected) {
      assert.equal(
        actual.xmlSha256,
        original.xmlSha256,
        "unselected cell XML is preserved",
      );
      preservedCells++;
    }
  }
  for (const key of changed.keys())
    assert.ok(
      before.cells.some((cell) => `${cell.row}:${cell.column}` === key),
      `expected cell exists: ${key}`,
    );
  return { preservedParts, preservedCells };
}

function presentationTableDom(expected = {}) {
  const panel = document.querySelector('[data-testid="presentation-panel"]');
  const controls = panel?.querySelector(
    '[data-testid="presentation-editing-controls"]',
  );
  const content = panel?.querySelector("iframe")?.contentDocument;
  const slide = content?.querySelector('[data-slide-id="512"]');
  const tables = slide?.querySelectorAll("table") ?? [];
  const table = tables[0];
  const cells = Array.from(table?.rows ?? [], (row) =>
    Array.from(row.cells, (cell) => {
      const leaves = Array.from(cell.querySelectorAll("*")).filter((node) =>
        Array.from(node.childNodes).some(
          (child) => child.nodeType === 3 && child.textContent?.trim(),
        ),
      );
      return {
        text: cell.textContent,
        bold: leaves.some(
          (node) =>
            Number(content.defaultView.getComputedStyle(node).fontWeight) >=
            700,
        ),
      };
    }),
  );
  const state = {
    sourceSha256: panel?.getAttribute("data-source-sha256"),
    dirty: controls?.getAttribute("data-dirty") === "true",
    saving: controls?.getAttribute("data-saving") === "true",
    cells,
    selected: Array.from(
      slide?.querySelectorAll(
        '[data-presentation-cell][aria-pressed="true"]',
      ) ?? [],
      (node) => node.getAttribute("data-presentation-cell"),
    ),
  };
  if (!Object.keys(expected).length) return state;
  if (
    panel?.getAttribute("data-status") !== "ready" ||
    tables.length !== 1 ||
    cells.length !== 2 ||
    cells.some((row) => row.length !== 3) ||
    content.querySelector("[data-presentation-text-editor]")
  )
    return false;
  if (expected.sha256 && expected.sha256 !== state.sourceSha256) return false;
  if (expected.dirty !== undefined && expected.dirty !== state.dirty)
    return false;
  if (expected.idle && state.saving) return false;
  if (
    expected.selected &&
    (state.selected.length !== 1 || state.selected[0] !== expected.selected)
  )
    return false;
  for (const expectedCell of expected.cells ?? []) {
    const cell = cells[expectedCell.row]?.[expectedCell.column];
    if (
      !cell ||
      (expectedCell.text !== undefined && cell.text !== expectedCell.text) ||
      (expectedCell.bold !== undefined && cell.bold !== expectedCell.bold)
    )
      return false;
  }
  return state;
}

/** 在真实文件入口打开 tableFixture 后调用；readTrace 必须来自实际 Electron IPC。 */
export async function runPresentationTableScenario({
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
  const cellSelector = (row, column) =>
    `[data-presentation-table-id="7"] [data-presentation-cell="${row}:${column}"]`;
  const evidence = {
    slideId,
    tableId,
    rowCount: 2,
    columnCount: 3,
    manualSaveClicks: 0,
    stages: [],
  };
  const record = (row) => {
    evidence.stages.push(row);
    fs.writeFileSync(
      path.join(evidenceDir, "presentation-table.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  };
  const waitState = async (expected) => {
    const result = await page.waitForFunction(presentationTableDom, expected, {
      timeout,
    });
    try {
      return await result.jsonValue();
    } finally {
      await result.dispose();
    }
  };
  const original = await readPresentationTableFile(filePath);
  assert.deepEqual(original.slideIds, ["512", "900", "300"]);
  assert.equal(original.cells[0].text, "TABLE_R1C1");
  await waitForPresentationSlide(page, slideId);
  await waitState({
    sha256: original.sha256,
    cells: original.cells.map(({ row, column, text }) => ({
      row,
      column,
      text,
    })),
    dirty: false,
    idle: true,
  });
  const firstText = "表格第一格_中文 <&>";
  const secondText = "独立第二格_中文 <&>";
  let expectedCells = [];
  const capture = async () => ({
    sha256: digest(fs.readFileSync(filePath)),
    io: await counts(),
  });
  const autoSaved = async (name, before) => {
    const state = await waitState({
      cells: expectedCells,
      dirty: false,
      idle: true,
    });
    const saved = await readPresentationTableFile(filePath);
    assert.notEqual(
      saved.sha256,
      before.sha256,
      `${name}: automatic save writes changed source bytes`,
    );
    assert.equal(state.sourceSha256, saved.sha256);
    const preserved = assertPresentationTableSave(
      original,
      saved,
      expectedCells,
    );
    const io = await counts();
    const fileIoDelta = {
      read: io.read - before.io.read,
      write: io.write - before.io.write,
    };
    assert.ok(
      fileIoDelta.read >= 2,
      `${name}: source SHA is checked twice through real IPC`,
    );
    assert.ok(
      fileIoDelta.write > 0,
      `${name}: original PPTX is written through real IPC`,
    );
    record({
      name,
      sha256: saved.sha256,
      ...preserved,
      fileIoDelta,
      selectedCells: state.selected,
      automaticSave: true,
    });
    return saved;
  };
  const selectCell = async (row, column) => {
    await frame.click(cellSelector(row, column));
    await waitState({ selected: `${row}:${column}`, idle: true });
    assert.ok(
      (await tableControls.innerText()).includes(
        `第 ${row + 1} 行，第 ${column + 1} 列`,
      ),
    );
  };
  const doubleClickCell = async (row, column) => {
    const box = await frame.box(cellSelector(row, column));
    const viewport = page.viewportSize();
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    assert.ok(x >= 0 && x < viewport.width && y >= 0 && y < viewport.height);
    const cdp = await page.context().newCDPSession(page);
    try {
      for (const clickCount of [1, 2]) {
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          button: "left",
          buttons: 1,
          clickCount,
          x,
          y,
        });
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          button: "left",
          buttons: 0,
          clickCount,
          x,
          y,
        });
      }
    } finally {
      await cdp.detach();
    }
  };
  const editCell = async (row, column, value, doubleClick = false) => {
    await selectCell(row, column);
    if (doubleClick) await doubleClickCell(row, column);
    else
      await tableControls
        .getByRole("button", { name: "编辑文字", exact: true })
        .click();
    await frame.visible("[data-presentation-text-editor]");
    await frame.click("[data-presentation-text-editor]");
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

  await controls.getByRole("button", { name: "编辑", exact: true }).click();
  await frame.click('[data-presentation-element-id="7"]');
  await frame.visible(cellSelector(0, 0));
  assert.equal(
    await frame.count(
      '[data-presentation-table-id="7"] [data-presentation-cell]',
    ),
    6,
  );
  await selectCell(0, 0);
  assert.equal(
    digest(fs.readFileSync(filePath)),
    original.sha256,
    "pointer selection does not mutate the source",
  );

  let before = await capture();
  await editCell(0, 0, firstText, true);
  expectedCells = [{ row: 0, column: 0, text: firstText }];
  await autoSaved("double-click-first-cell-text", before);
  evidence.doubleClickNative = true;
  evidence.chineseInputCommitted = true;

  before = await capture();
  await editCell(0, 1, secondText);
  expectedCells.push({ row: 0, column: 1, text: secondText });
  await autoSaved("independent-second-cell-text", before);

  await selectCell(0, 0);
  assert.equal(
    await tableControls
      .getByRole("button", { name: "加粗", exact: true })
      .getAttribute("aria-pressed"),
    "false",
  );
  before = await capture();
  await tableControls
    .getByRole("button", { name: "加粗", exact: true })
    .click();
  expectedCells[0].bold = true;
  await autoSaved("bold-first-cell", before);
  assert.equal(
    await tableControls
      .getByRole("button", { name: "加粗", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );

  await selectCell(1, 2);
  before = await capture();
  await tableControls
    .getByRole("button", { name: "清空单元格", exact: true })
    .click();
  expectedCells.push({ row: 1, column: 2, text: "" });
  await autoSaved("clear-one-cell", before);
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-table-edited.png"),
  });

  before = await capture();
  await controls.getByRole("button", { name: "撤销", exact: true }).click();
  expectedCells = expectedCells.filter(
    (cell) => cell.row !== 1 || cell.column !== 2,
  );
  await autoSaved("undo-clear-after-save", before);
  assert.equal(
    (await readPresentationTableFile(filePath)).cells.at(-1).text,
    "TABLE_R2C3",
  );
  before = await capture();
  await controls.getByRole("button", { name: "重做", exact: true }).click();
  expectedCells.push({ row: 1, column: 2, text: "" });
  const saved = await autoSaved("redo-clear-after-save", before);

  await controls.getByRole("button", { name: "结束编辑", exact: true }).click();
  const beforeReopen = await counts();
  await replaceFileTab(page, filePath);
  await waitForArtifactFileRead(
    async () => (await counts()).read,
    beforeReopen.read,
    timeout,
  );
  await waitForPresentationSlide(page, slideId);
  await waitState({
    sha256: saved.sha256,
    cells: expectedCells,
    dirty: false,
    idle: true,
  });
  const reopened = await readPresentationTableFile(filePath);
  assert.equal(reopened.sha256, saved.sha256);
  const preserved = assertPresentationTableSave(
    original,
    reopened,
    expectedCells,
  );
  const afterReopen = await counts();
  assert.equal(
    afterReopen.write,
    beforeReopen.write,
    "reopening clean table adds no write",
  );
  assert.equal(
    await frame.count("[data-presentation-cell]"),
    0,
    "reopened table is in view mode",
  );
  assert.equal(
    await panel.locator("iframe").getAttribute("sandbox"),
    "allow-same-origin",
  );
  assert.equal(await frame.count("script,iframe,a[href],[onclick]"), 0);
  evidence.reopen = {
    sha256: saved.sha256,
    sourceReads: afterReopen.read - beforeReopen.read,
    ...preserved,
    texts: expectedCells,
  };
  evidence.initialSha256 = original.sha256;
  evidence.finalSha256 = saved.sha256;
  evidence.undoRedoAcrossAutomaticSave = true;
  evidence.scriptsAllowed = false;
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-table-reopened.png"),
  });
  fs.writeFileSync(
    path.join(evidenceDir, "presentation-table.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  return evidence;
}
