import { replaceFileTab } from "./thread-side-panel-navigation.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { assertPresentationBorderWidth } from "./presentation-border-width.mjs";
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
import { readPresentationTableStructureFile } from "./presentation-table-structure-scenario.mjs";

const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const timeout = 15_000;
const styleId = "{A1200000-0000-4000-8000-000000000001}";
const sides = { top: "lnT", bottom: "lnB", left: "lnL", right: "lnR" };
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const children = (node, name) =>
  Array.from(node?.children ?? []).filter(
    (node) => node.namespaceURI === a && node.localName === name,
  );

/** Node 的 DOM 与 TS 解析仅存在于隔离 worker；主进程/测试不修改全局环境。 */
export async function writePresentationTableFormatFixture(filePath) {
  const bytes = await new Promise((resolve, reject) => {
    const worker = new Worker(
      String.raw`
        const { parentPort, workerData } = require("node:worker_threads");
        const { registerHooks } = require("node:module");
        const { JSDOM } = require("jsdom");
        registerHooks({ resolve(specifier, context, next) {
          try {
            const result = next(specifier, context);
            return specifier.endsWith(".json") ? { ...result, importAttributes: { type: "json" } } : result;
          }
          catch (error) {
            if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".")) throw error;
            return next(specifier + ".ts", context);
          }
        }});
        (async () => {
          const dom = new JSDOM("");
          try {
            globalThis.DOMParser = dom.window.DOMParser;
            globalThis.XMLSerializer = dom.window.XMLSerializer;
            const { formatFixture } = await import(workerData);
            parentPort.postMessage(await formatFixture());
          } finally { dom.window.close(); }
        })().catch(error => { throw error; });
      `,
      {
        eval: true,
        execArgv: [],
        workerData: pathToFileURL(
          path.resolve(
            "src/components/artifact/presentation/presentationTableFormatPackage.testFixtures.ts",
          ),
        ).href,
      },
    );
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`format fixture worker exited ${code}`));
    });
  });
  fs.writeFileSync(filePath, bytes);
  fs.writeFileSync(
    path.join(path.dirname(filePath), "Broken.pptx"),
    "invalid presentation",
  );
  const snapshot = await readPresentationTableFormatFile(filePath);
  assertPresentationTableFormatFixture(snapshot);
  return {
    sha256: snapshot.sha256,
    slideId: "512",
    tableId: "7",
    rowCount: 4,
    columnCount: 5,
    styleId,
    stylePart: "ppt/tableStyles.xml",
    themePart: "ppt/theme/table-format.xml",
  };
}

/** 独立解析 direct line；不调用生产样式 resolver 或边几何算法生成期望。 */
export async function readPresentationTableFormatFile(filePath) {
  const source = await readPresentationTableStructureFile(filePath);
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath), {
    checkCRC32: true,
  });
  const dom = new JSDOM(await zip.file(source.tablePart).async("string"), {
    contentType: "application/xml",
  });
  try {
    const document = dom.window.document;
    const serialize = (node) =>
      new dom.window.XMLSerializer().serializeToString(node);
    const frame = Array.from(
      document.getElementsByTagNameNS(p, "graphicFrame"),
    ).find(
      (node) =>
        node.getElementsByTagNameNS(p, "cNvPr")[0]?.getAttribute("id") === "7",
    );
    assert.ok(frame);
    const table = frame.getElementsByTagNameNS(a, "tbl")[0];
    const properties = children(table, "tblPr")[0];
    assert.ok(properties);
    const header = {
      row: properties.getAttribute("firstRow") === "1",
      column: properties.getAttribute("firstCol") === "1",
    };
    const direct = children(table, "tr").map((row) =>
      children(row, "tc").map((cell) => {
        const properties = children(cell, "tcPr")[0];
        return Object.fromEntries(
          Object.entries(sides).map(([side, name]) => {
            const line = children(properties, name)[0];
            if (!line) return [side, null];
            const fill = children(line, "solidFill")[0];
            return [
              side,
              {
                width: Number(line.getAttribute("w")),
                color:
                  children(fill, "srgbClr")[0]?.getAttribute("val") ?? null,
                scheme:
                  children(fill, "schemeClr")[0]?.getAttribute("val") ?? null,
                hidden: children(line, "noFill").length === 1,
                dash:
                  children(line, "prstDash")[0]?.getAttribute("val") ?? null,
              },
            ];
          }),
        );
      }),
    );
    const id = children(properties, "tableStyleId")[0]?.textContent;
    for (const name of ["firstRow", "firstCol"])
      properties.removeAttribute(name);
    for (const cell of table.getElementsByTagNameNS(a, "tc")) {
      const properties = children(cell, "tcPr")[0];
      for (const name of Object.values(sides))
        for (const line of children(properties, name)) line.remove();
    }
    return {
      ...source,
      styleId: id,
      header,
      direct,
      stableFrameSha256: digest(serialize(frame)),
    };
  } finally {
    dom.window.close();
  }
}

export function assertPresentationTableFormatFixture(source) {
  assert.equal(
    source.styleId,
    styleId,
    "format scene requires its independent custom style",
  );
  assert.deepEqual(
    source.cells.map((row) => row.map((cell) => cell.text)),
    [
      ["ADV_R0C0", "ADV_R0C1", "ADV_R0C2", "ADV_R0C3", "ADV_R0C4"],
      ["ADV_R1C0", "ADV_R1C1", "ADV_R1C2", "ADV_R1C3", "ADV_R1C4"],
      ["ADV_R2C0", "ADV_R2C1", "ADV_R2C2", "ADV_R2C3", "ADV_R2C4"],
      ["ADV_R3C0", "ADV_R3C1", "ADV_R3C2", "ADV_R3C3", "ADV_R3C4"],
    ],
  );
  assert.deepEqual(source.header, { row: false, column: false });
  for (const row of source.cells)
    for (const cell of row)
      assert.ok(
        Object.values(cell.merge).every((value) => value === null),
        "format scene is explicitly unmerged",
      );
  for (const row of source.direct)
    for (const cell of row)
      assert.ok(
        Object.values(cell).every((value) => value === null),
        "initial borders are inherited, not fabricated direct lines",
      );
  for (const part of ["ppt/tableStyles.xml", "ppt/theme/table-format.xml"])
    assert.ok(
      source.parts[part],
      `independent custom style/theme part exists: ${part}`,
    );
}

/** 手写4×5物理边集合：T/B/L/R 是 direct 可见边，空字符表示显式清空。 */
const patterns = {
  all: [
    ["TBLR", "TBR", "TBR", "TBR", "TBR"],
    ["BLR", "BR", "BR", "BR", "BR"],
    ["BLR", "BR", "BR", "BR", "BR"],
    ["BLR", "BR", "BR", "BR", "BR"],
  ],
  inside: [
    ["BR", "BR", "BR", "BR", "B"],
    ["BR", "BR", "BR", "BR", "B"],
    ["BR", "BR", "BR", "BR", "B"],
    ["R", "R", "R", "R", ""],
  ],
  columns: [
    ["R", "R", "R", "R", ""],
    ["R", "R", "R", "R", ""],
    ["R", "R", "R", "R", ""],
    ["R", "R", "R", "R", ""],
  ],
  rows: [
    ["B", "B", "B", "B", "B"],
    ["B", "B", "B", "B", "B"],
    ["B", "B", "B", "B", "B"],
    ["", "", "", "", ""],
  ],
  none: Array.from({ length: 4 }, () => ["", "", "", "", ""]),
};

export function assertPresentationTableFormatSave(before, after, expected) {
  assert.deepEqual(after.slideIds, before.slideIds);
  assert.equal(after.tablePart, before.tablePart);
  assert.equal(
    after.outsideTableSha256,
    before.outsideTableSha256,
    "non-table slide payload is retained",
  );
  assert.equal(
    after.stableFrameSha256,
    before.stableFrameSha256,
    "all non-border/header frame and cell XML is retained",
  );
  assert.deepEqual(after.geometry, before.geometry);
  assert.deepEqual(after.columnWidths, before.columnWidths);
  assert.deepEqual(after.rowHeights, before.rowHeights);
  assert.deepEqual(
    after.cells.map((row) => row.map((cell) => [cell.text, cell.merge])),
    before.cells.map((row) => row.map((cell) => [cell.text, cell.merge])),
  );
  assert.deepEqual(
    after.header,
    expected.header ?? { row: false, column: false },
  );
  if (!expected.preset) {
    assert.deepEqual(
      after.cells,
      before.cells,
      "header-only edit preserves every complete original cell",
    );
    assert.deepEqual(after.direct, before.direct);
  } else {
    assert.ok(patterns[expected.preset], "handwritten format preset exists");
    const letters = { top: "T", bottom: "B", left: "L", right: "R" };
    after.direct.forEach((row, r) =>
      row.forEach((cell, c) => {
        for (const [side, letter] of Object.entries(letters)) {
          const visible = patterns[expected.preset][r][c].includes(letter);
          const line = cell[side];
          assert.ok(line, `persisted direct line exists at ${r}:${c}:${side}`);
          assert.deepEqual(
            line,
            visible
              ? {
                  width: Math.round(expected.width * 9525),
                  color: expected.color.replace("#", "").toUpperCase(),
                  scheme: null,
                  hidden: false,
                  dash: "solid",
                }
              : {
                  width: 0,
                  color: null,
                  scheme: null,
                  hidden: true,
                  dash: "solid",
                },
            `handwritten direct border at ${r}:${c}:${side}`,
          );
        }
      }),
    );
  }
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
  return { preservedCells: 20, preservedParts };
}

function presentationFormatDom(expected = {}) {
  const panel = document.querySelector('[data-testid="presentation-panel"]');
  const controls = panel?.querySelector(
    '[data-testid="presentation-editing-controls"]',
  );
  const tableControls = panel?.querySelector(
    '[data-testid="presentation-table-controls"]',
  );
  const content = panel?.querySelector("iframe")?.contentDocument;
  const table = content?.querySelector('[data-slide-id="512"] table');
  const style = (cell) => {
    const computed = cell.ownerDocument.defaultView.getComputedStyle(cell);
    return Object.fromEntries(
      ["Top", "Bottom", "Left", "Right"].map((side) => [
        side.toLowerCase(),
        {
          declaredWidth: cell.style[`border${side}Width`],
          declaredStyle: cell.style[`border${side}Style`],
          computedWidth: computed[`border${side}Width`],
          width: parseFloat(computed[`border${side}Width`]) || 0,
          color: computed[`border${side}Color`],
          style: computed[`border${side}Style`],
        },
      ]),
    );
  };
  const input = (label) =>
    tableControls?.querySelector(`input[aria-label="${label}"]`);
  const state = {
    renderingEnvironment: {
      userAgent: content?.defaultView.navigator.userAgent,
      devicePixelRatio: content?.defaultView.devicePixelRatio,
    },
    sha256: panel?.getAttribute("data-source-sha256"),
    dirty: controls?.getAttribute("data-dirty") === "true",
    saving: controls?.getAttribute("data-saving") === "true",
    header: {
      row: input("标题行")?.checked ?? false,
      column: input("标题列")?.checked ?? false,
    },
    preset: tableControls
      ?.querySelector('button[aria-pressed="true"][aria-label$="边框"]')
      ?.getAttribute("aria-label"),
    color: input("边框颜色")?.value ?? null,
    width: input("边框粗细")?.value ?? null,
    selected:
      content?.querySelectorAll('[data-presentation-cell][aria-pressed="true"]')
        .length ?? 0,
    texts: Array.from(table?.rows ?? [], (row) =>
      Array.from(row.cells, (cell) => cell.textContent),
    ),
    renderer: Array.from(table?.rows ?? [], (row) =>
      Array.from(row.cells, style),
    ),
  };
  if (!Object.keys(expected).length) return state;
  if (
    panel?.getAttribute("data-status") !== "ready" ||
    !table ||
    state.dirty ||
    state.saving
  )
    return false;
  if (expected.sha256 && state.sha256 !== expected.sha256) return false;
  if (expected.previousSha256 && state.sha256 === expected.previousSha256)
    return false;
  if (expected.selected !== undefined && state.selected !== expected.selected)
    return false;
  if (
    expected.header &&
    JSON.stringify(state.header) !== JSON.stringify(expected.header)
  )
    return false;
  return state;
}

/** 读取真正renderer的每格样式；共边由浏览器collapsed border显示，核对可见owner边。 */
export function assertPresentationTableFormatRenderer(
  state,
  original,
  expected,
) {
  assert.deepEqual(
    state.texts,
    original.cells.map((row) => row.map((cell) => cell.text)),
  );
  const colors = {
    "#336699": "rgb(51, 102, 153)",
    "#AA3344": "rgb(170, 51, 68)",
    "#ABCDEF": "rgb(171, 205, 239)",
    "#D1D5DB": "rgb(209, 213, 219)",
  };
  const compare = (line, width, color, style, location) => {
    assertPresentationBorderWidth(
      { ...line, ...state.renderingEnvironment },
      width,
      location,
    );
    if (width > 0) {
      assert.equal(line.color, colors[color], `${location}: renderer color`);
      assert.equal(line.style, style, `${location}: renderer dash`);
    }
  };
  assert.equal(state.renderer.length, 4);
  state.renderer.forEach((row, r) => {
    assert.equal(row.length, 5);
    row.forEach((cell, c) => {
      if (!expected.preset) {
        for (const side of Object.keys(sides)) {
          const header = expected.header?.row && r === 0 && side === "bottom";
          compare(
            cell[side],
            header ? 4 : 2,
            header ? "#ABCDEF" : "#336699",
            header ? "dashed" : "solid",
            `${r}:${c}:${side}`,
          );
        }
      } else {
        // bottom/right 是明确手写preset的可见owner；top/left只在外边界核对。
        for (const [side, letter] of [
          ["bottom", "B"],
          ["right", "R"],
          ...(r === 0 ? [["top", "T"]] : []),
          ...(c === 0 ? [["left", "L"]] : []),
        ]) {
          const visible = patterns[expected.preset][r][c].includes(letter);
          compare(
            cell[side],
            visible ? expected.width : 0,
            expected.color,
            "solid",
            `${r}:${c}:${side}`,
          );
        }
      }
    });
  });
}

export async function runPresentationTableFormatScenario({
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
  const turns = async () =>
    (await readTrace())
      .flatMap((row) => row.args_preview?.request?.lines ?? [])
      .filter((line) => JSON.parse(line).method === "turn/start").length;
  const initialTurns = await turns();
  const original = await readPresentationTableFormatFile(filePath);
  assertPresentationTableFormatFixture(original);
  const evidence = {
    initialSha256: original.sha256,
    fixture: { rows: 4, columns: 5, styleId },
    manualSaveClicks: 0,
    stages: [],
  };
  const record = () =>
    fs.writeFileSync(
      path.join(evidenceDir, "presentation-table-format.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  const waitState = async (expected) => {
    const handle = await page.waitForFunction(presentationFormatDom, expected, {
      timeout,
    });
    try {
      return await handle.jsonValue();
    } finally {
      await handle.dispose();
    }
  };
  const saved = async (name, expected, perform) => {
    const before = {
      sha256: digest(fs.readFileSync(filePath)),
      io: await counts(),
    };
    await perform();
    const state = await waitState({
      previousSha256: before.sha256,
      header: expected.header ?? { row: false, column: false },
    });
    const disk = await readPresentationTableFormatFile(filePath);
    assert.equal(
      state.sha256,
      disk.sha256,
      `${name}: visible source identity matches persisted file`,
    );
    const preserved = assertPresentationTableFormatSave(
      original,
      disk,
      expected,
    );
    assertPresentationTableFormatRenderer(state, original, expected);
    const io = await counts();
    const fileIoDelta = {
      read: io.read - before.io.read,
      write: io.write - before.io.write,
    };
    assert.ok(
      fileIoDelta.read >= 2 && fileIoDelta.write > 0,
      `${name}: real IPC verifies source twice and writes automatic save`,
    );
    assert.equal(
      await turns(),
      initialTurns,
      `${name}: local table edits create zero additional turns`,
    );
    evidence.stages.push({
      name,
      sha256: disk.sha256,
      ...preserved,
      fileIoDelta,
      automaticSave: true,
      header: disk.header,
      renderer: state.renderer,
      renderingEnvironment: state.renderingEnvironment,
      color: state.color,
      width: state.width,
    });
    record();
    return disk;
  };
  const button = (label) =>
    tableControls.getByRole("button", { name: label, exact: true });
  const history = (label) =>
    controls.getByRole("button", { name: label, exact: true }).click();
  const header = (label) =>
    tableControls.getByRole("checkbox", { name: label, exact: true }).click();
  const initial = { header: { row: false, column: false } };
  await waitForPresentationSlide(page, "512");
  const initialState = await waitState({ sha256: original.sha256 });
  assertPresentationTableFormatRenderer(initialState, original, initial);
  evidence.initial = {
    renderer: initialState.renderer,
    renderingEnvironment: initialState.renderingEnvironment,
  };
  await controls.getByRole("button", { name: "编辑", exact: true }).click();
  await frame.click('[data-presentation-element-id="7"]');
  await frame.click(
    '[data-presentation-table-id="7"] [data-presentation-cell="0:0"]',
  );
  await page.keyboard.press("ControlOrMeta+A");
  await waitState({ sha256: original.sha256, selected: 20 });
  assert.equal(await button("所有边框").isEnabled(), true);
  const rowHeader = { header: { row: true, column: false } };
  await saved("header-row-on-inherited-style", rowHeader, () =>
    header("标题行"),
  );
  await saved("header-row-off", initial, () => header("标题行"));
  const columnHeader = { header: { row: false, column: true } };
  await saved("header-column-on", columnHeader, () => header("标题列"));
  await saved("undo-saved-header-column", initial, () => history("撤销"));
  await saved("redo-saved-header-column", columnHeader, () => history("重做"));
  await saved("header-column-off", initial, () => header("标题列"));
  const all = { preset: "all", width: 2, color: "#336699" };
  await saved("preset-all", all, () => button("所有边框").click());
  const colored = { ...all, color: "#AA3344" };
  await saved("border-color-accessible-input-fill", colored, () =>
    tableControls.getByLabel("边框颜色", { exact: true }).fill("#aa3344"),
  );
  const weighted = { ...colored, width: 3.25 };
  await saved("border-width-keyboard-blur", weighted, async () => {
    await tableControls
      .getByRole("spinbutton", { name: "边框粗细", exact: true })
      .click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText("3.25");
    await page.keyboard.press("Tab");
  });
  await saved("undo-saved-width", colored, () => history("撤销"));
  await saved("redo-saved-width", weighted, () => history("重做"));
  for (const [preset, label] of [
    ["inside", "内部边框"],
    ["columns", "列边框"],
    ["rows", "行边框"],
  ])
    await saved(`preset-${preset}`, { ...weighted, preset }, () =>
      button(label).click(),
    );
  const none = { preset: "none", width: 0, color: "#AA3344" };
  await saved("preset-none", none, () => button("无边框").click());
  assert.equal(
    await tableControls.getByLabel("边框颜色", { exact: true }).count(),
    0,
  );
  const final = { preset: "all", width: 1, color: "#D1D5DB" };
  const finalDisk = await saved("preset-all-after-none", final, () =>
    button("所有边框").click(),
  );
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-table-format-edited.png"),
  });
  await controls.getByRole("button", { name: "结束编辑", exact: true }).click();
  const beforeReopen = await counts();
  await replaceFileTab(page, filePath);
  await waitForArtifactFileRead(
    async () => (await counts()).read,
    beforeReopen.read,
    timeout,
  );
  const reopened = await waitState({ sha256: finalDisk.sha256 });
  const disk = await readPresentationTableFormatFile(filePath);
  assert.equal(disk.sha256, finalDisk.sha256);
  assertPresentationTableFormatSave(original, disk, final);
  assertPresentationTableFormatRenderer(reopened, original, final);
  // 超过500ms autosave窗口只检查负向条件，不以等待合成保存完成。
  await page.waitForTimeout(650);
  const afterReopen = await counts();
  assert.equal(
    afterReopen.write,
    beforeReopen.write,
    "clean reopen has no immediate or delayed write",
  );
  assert.equal(
    await turns(),
    initialTurns,
    "format edits and reopen create zero additional turns",
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
    renderingEnvironment: reopened.renderingEnvironment,
    texts: reopened.texts,
  };
  evidence.finalSha256 = disk.sha256;
  evidence.undoRedoAcrossSave = true;
  evidence.additionalTurns = 0;
  evidence.colorInputAutomation =
    "Playwright Locator.fill(input[type=color]); input/change events; OS picker not exercised";
  evidence.scriptsAllowed = false;
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-table-format-reopened.png"),
  });
  record();
  return evidence;
}
