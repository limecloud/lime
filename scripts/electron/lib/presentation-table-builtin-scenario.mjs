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
import {
  readPresentationTableFormatFile,
  assertPresentationTableFormatSave,
} from "./presentation-table-format-scenario.mjs";

const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
const styleId = "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}";
const timeout = 15_000;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = { slideId: "512", tableId: "7" };

/** TS 与 writer 的 DOM 只进入独立 Worker，不安装主进程 globals。 */
export async function writePresentationTableBuiltinFixture(
  filePath,
  { styleList = "missing" } = {},
) {
  assert.ok(["missing", "empty"].includes(styleList));
  const bytes = await new Promise((resolve, reject) => {
    const worker = new Worker(
      String.raw`
      const { parentPort, workerData } = require("node:worker_threads");
      const { registerHooks } = require("node:module");
      const { JSDOM } = require("jsdom");
      const JSZip = require("jszip");
      registerHooks({ resolve(specifier, context, next) {
        try {
          const result = next(specifier, context);
          return specifier.endsWith(".json") ? { ...result, importAttributes: { type: "json" } } : result;
        } catch (error) {
          if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".")) throw error;
          return next(specifier + ".ts", context);
        }
      }});
      (async () => {
        const dom = new JSDOM("");
        try {
          globalThis.DOMParser = dom.window.DOMParser;
          globalThis.XMLSerializer = dom.window.XMLSerializer;
          const { builtinIntegrationBase, builtinIntegrationFixture } = await import(workerData.url);
          const bytes = await builtinIntegrationFixture(await builtinIntegrationBase(), undefined, workerData.styleList);
          const zip = await JSZip.loadAsync(bytes);
          const part = "ppt/slides/slide1.xml";
          const xml = new DOMParser().parseFromString(await zip.file(part).async("string"), "application/xml");
          const properties = xml.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/main", "tblPr")[0];
          for (const name of ["firstRow", "lastRow", "firstCol", "lastCol", "bandRow", "bandCol"])
            properties.setAttribute(name, "0");
          zip.file(part, new XMLSerializer().serializeToString(xml));
          parentPort.postMessage(await zip.generateAsync({ type: "uint8array" }));
        } finally { dom.window.close(); }
      })().catch(error => { throw error; });
    `,
      {
        eval: true,
        execArgv: [],
        workerData: {
          url: pathToFileURL(
            path.resolve(
              "src/components/artifact/presentation/presentationTableBuiltinIntegration.testFixtures.ts",
            ),
          ).href,
          styleList,
        },
      },
    );
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0)
        reject(new Error(`builtin fixture worker exited ${code}`));
    });
  });
  fs.writeFileSync(filePath, bytes);
  fs.writeFileSync(
    path.join(path.dirname(filePath), "Broken.pptx"),
    "invalid presentation",
  );
  const source = await readPresentationTableBuiltinFile(filePath);
  assertPresentationTableBuiltinFixture(source, styleList);
  return {
    ...identity,
    sha256: source.sha256,
    rowCount: 4,
    columnCount: 5,
    styleId,
    styleList,
    themePart: "ppt/theme/table-format.xml",
    framePixels: { width: 600, height: 280 },
  };
}

/** 只解析源关系、styles 原件和落盘 direct line；不调用生产 style resolver 生成期望。 */
export async function readPresentationTableBuiltinFile(filePath) {
  const source = await readPresentationTableFormatFile(filePath);
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath), {
    checkCRC32: true,
  });
  const xml = async (name, read) => {
    assert.ok(zip.file(name), `builtin source part exists: ${name}`);
    const dom = new JSDOM(await zip.file(name).async("string"), {
      contentType: "application/xml",
    });
    try {
      return read(dom.window.document);
    } finally {
      dom.window.close();
    }
  };
  const relationships = async (name, type, target) =>
    xml(name, (document) => {
      const entries = [
        ...document.getElementsByTagNameNS(rel, "Relationship"),
      ].filter((entry) => entry.getAttribute("Type") === `${r}/${type}`);
      assert.equal(entries.length, 1, `one genuine ${type} relationship`);
      assert.equal(entries[0].getAttribute("Target"), target);
      assert.notEqual(entries[0].getAttribute("TargetMode"), "External");
    });
  await relationships(
    "ppt/slides/_rels/slide1.xml.rels",
    "slideLayout",
    "../slideLayouts/table-format.xml",
  );
  await relationships(
    "ppt/slideLayouts/_rels/table-format.xml.rels",
    "slideMaster",
    "../slideMasters/table-format.xml",
  );
  await relationships(
    "ppt/slideMasters/_rels/table-format.xml.rels",
    "theme",
    "../theme/table-format.xml",
  );
  const theme = await xml("ppt/theme/table-format.xml", (document) => {
    const root = document.documentElement;
    assert.equal(root.namespaceURI, a);
    assert.equal(root.localName, "theme");
    const scheme = root.getElementsByTagNameNS(a, "clrScheme")[0];
    return Object.fromEntries(
      [...scheme.children].map((slot) => [
        slot.localName,
        slot.firstElementChild?.getAttribute("val"),
      ]),
    );
  });
  const styleList = zip.file("ppt/tableStyles.xml")
    ? await xml("ppt/tableStyles.xml", (document) => {
        assert.equal(document.documentElement.namespaceURI, a);
        assert.equal(document.documentElement.localName, "tblStyleLst");
        return document.documentElement.children.length === 0
          ? "empty"
          : "custom";
      })
    : "missing";
  return { ...source, styleList, theme };
}

export function assertPresentationTableBuiltinFixture(
  source,
  styleList = source.styleList,
) {
  assert.equal(
    source.styleId,
    styleId,
    "builtin scenario keeps the fixed genuine UUID",
  );
  assert.ok(
    ["missing", "empty"].includes(styleList),
    "custom list cannot impersonate builtin",
  );
  assert.equal(source.styleList, styleList);
  assert.deepEqual(source.header, { row: false, column: false });
  assert.deepEqual(
    source.cells.map((row) => row.map((cell) => cell.text)),
    [
      ["ADV_R0C0", "ADV_R0C1", "ADV_R0C2", "ADV_R0C3", "ADV_R0C4"],
      ["ADV_R1C0", "ADV_R1C1", "ADV_R1C2", "ADV_R1C3", "ADV_R1C4"],
      ["ADV_R2C0", "ADV_R2C1", "ADV_R2C2", "ADV_R2C3", "ADV_R2C4"],
      ["ADV_R3C0", "ADV_R3C1", "ADV_R3C2", "ADV_R3C3", "ADV_R3C4"],
    ],
  );
  assert.deepEqual(
    source.columnWidths,
    [381000, 762000, 1143000, 1524000, 1905000],
  );
  assert.deepEqual(source.rowHeights, [381000, 571500, 762000, 952500]);
  assert.equal(source.geometry.width, 5715000);
  assert.equal(source.geometry.height, 2667000);
  assert.equal(source.theme.accent1, "336699");
  assert.equal(source.theme.dk1, "000000");
  assert.equal(source.theme.lt1, "FFFFFF");
  for (const row of source.cells)
    for (const cell of row)
      assert.ok(
        Object.values(cell.merge).every((value) => value === null),
        "builtin fixture is unmerged",
      );
  for (const row of source.direct)
    for (const cell of row)
      assert.ok(
        Object.values(cell).every((value) => value === null),
        "initial lines are genuinely inherited",
      );
}

export function assertPresentationTableBuiltinSave(before, after, expected) {
  assert.equal(after.styleId, styleId);
  assert.equal(
    after.styleList,
    before.styleList,
    "no builtin definition is added to the source ZIP",
  );
  assert.deepEqual(after.theme, before.theme);
  return assertPresentationTableFormatSave(before, after, expected);
}

/** 纯 DOM 投影，可直接给 waitForFunction；不向 iframe 安装脚本或监听器。 */
export function presentationBuiltinDom(expected = {}) {
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
    const view = cell.ownerDocument.defaultView;
    const computed = view.getComputedStyle(cell);
    const textStyles = [];
    const walker = cell.ownerDocument.createTreeWalker(cell, 4);
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue;
      const text = view.getComputedStyle(walker.currentNode.parentElement);
      textStyles.push({
        color: text.color,
        bold: text.fontWeight === "bold" || Number(text.fontWeight) >= 600,
      });
    }
    return {
      fill: computed.backgroundColor,
      textStyles,
      ...Object.fromEntries(
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
      ),
    };
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
    framePixels: {
      width: parseFloat(table?.parentElement.style.width),
      height: parseFloat(table?.parentElement.style.height),
    },
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

// 手写4×5可见边 owner，不调用生产边几何或 style resolver。
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
  none: [
    ["", "", "", "", ""],
    ["", "", "", "", ""],
    ["", "", "", "", ""],
    ["", "", "", "", ""],
  ],
};
const colors = {
  "#FFFFFF": "rgb(255, 255, 255)",
  "#AA3344": "rgb(170, 51, 68)",
  "#D1D5DB": "rgb(209, 213, 219)",
};

/** 初始 tint(20000) 的标准 sRGB 手算值#E8EAEF，不由生产 resolver生成期望。 */
export function assertPresentationTableBuiltinRenderer(
  state,
  original,
  expected = {},
) {
  assert.deepEqual(
    state.texts,
    original.cells.map((row) => row.map((cell) => cell.text)),
  );
  assert.deepEqual(state.framePixels, { width: 600, height: 280 });
  const header = expected.header ?? { row: false, column: false };
  const preset = expected.preset ?? "all";
  const width = expected.width ?? 4 / 3;
  const color = expected.color ?? "#FFFFFF";
  assert.ok(patterns[preset]);
  assert.equal(state.renderer.length, 4);
  state.renderer.forEach((row, r) => {
    assert.equal(row.length, 5);
    row.forEach((cell, c) => {
      const isHeader = (header.row && r === 0) || (header.column && c === 0);
      assert.equal(
        cell.fill,
        isHeader ? "rgb(51, 102, 153)" : "rgb(232, 234, 239)",
        `${r}:${c} builtin fill`,
      );
      assert.ok(cell.textStyles.length > 0);
      for (const text of cell.textStyles) {
        assert.equal(
          text.color,
          isHeader ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)",
          `${r}:${c} inherited text color`,
        );
        assert.equal(text.bold, isHeader, `${r}:${c} inherited text bold`);
      }
      for (const [side, letter] of [
        ["bottom", "B"],
        ["right", "R"],
        ...(r === 0 ? [["top", "T"]] : []),
        ...(c === 0 ? [["left", "L"]] : []),
      ]) {
        const line = cell[side],
          visible = patterns[preset][r][c].includes(letter);
        assertPresentationBorderWidth(
          { ...line, ...state.renderingEnvironment },
          visible ? width : 0,
          `${r}:${c}:${side} handwritten builtin width`,
        );
        if (visible) {
          assert.equal(line.style, "solid");
          assert.equal(
            line.color,
            colors[color],
            `${r}:${c}:${side} handwritten builtin color`,
          );
        }
      }
    });
  });
}

export function assertPresentationTableBuiltinIo(before, after) {
  const delta = {
    read: after.read - before.read,
    write: after.write - before.write,
  };
  assert.deepEqual(
    delta,
    { read: 2, write: 1 },
    "each action uses two real source reads and one autosave write IPC",
  );
  return delta;
}

export async function runPresentationTableBuiltinScenario({
  page,
  evidenceDir,
  filePath,
  readTrace,
}) {
  assert.equal(typeof readTrace, "function");
  const panel = page.getByTestId("presentation-panel"),
    controls = panel.getByTestId("presentation-editing-controls");
  const tableControls = panel.getByTestId("presentation-table-controls");
  const frame = createArtifactFrameDriver(page, presentationFrameSelector);
  const counts = async () =>
    presentationNavigationIo(await readTrace(), filePath);
  const turns = async () =>
    (await readTrace())
      .flatMap((row) => row.args_preview?.request?.lines ?? [])
      .filter((line) => JSON.parse(line).method === "turn/start").length;
  const initialTurns = await turns(),
    original = await readPresentationTableBuiltinFile(filePath);
  assertPresentationTableBuiltinFixture(original, "missing");
  const evidence = {
    initialSha256: original.sha256,
    fixture: {
      ...identity,
      rows: 4,
      columns: 5,
      styleId,
      styleList: "missing",
    },
    manualSaveClicks: 0,
    stages: [],
  };
  const record = () =>
    fs.writeFileSync(
      path.join(evidenceDir, "presentation-table-builtin.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  const waitState = async (expected) => {
    const handle = await page.waitForFunction(
      presentationBuiltinDom,
      expected,
      { timeout },
    );
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
      selected: 20,
    });
    const disk = await readPresentationTableBuiltinFile(filePath);
    assert.equal(
      state.sha256,
      disk.sha256,
      `${name}: UI displays persisted source identity`,
    );
    const preserved = assertPresentationTableBuiltinSave(
      original,
      disk,
      expected,
    );
    assertPresentationTableBuiltinRenderer(state, original, expected);
    const fileIoDelta = assertPresentationTableBuiltinIo(
      before.io,
      await counts(),
    );
    assert.equal(
      await turns(),
      initialTurns,
      `${name}: no additional agent turn`,
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
  const header = (label) =>
    tableControls.getByRole("checkbox", { name: label, exact: true }).click();
  const history = (label) =>
    controls.getByRole("button", { name: label, exact: true }).click();
  await waitForPresentationSlide(page, "512");
  const initial = await waitState({ sha256: original.sha256 });
  assertPresentationTableBuiltinRenderer(initial, original);
  evidence.initial = {
    renderer: initial.renderer,
    renderingEnvironment: initial.renderingEnvironment,
    framePixels: initial.framePixels,
  };
  await controls.getByRole("button", { name: "编辑", exact: true }).click();
  const selectionInput = async (stage) => {
    evidence.selectionInput ??= [];
    evidence.selectionInput.push(
      await page.evaluate(
        ({ frameSelector, stage }) => {
          const frame = [...document.querySelectorAll(frameSelector)].find(
            (element) => element.getClientRects().length > 0,
          );
          const doc = frame?.contentDocument;
          const active = doc?.activeElement;
          const cell = doc?.querySelector('[data-presentation-cell="0:0"]');
          const rect = cell?.getBoundingClientRect();
          const hit =
            rect &&
            doc.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            );
          const describe = (element) =>
            element
              ? {
                  tag: element.localName,
                  rect: element.getBoundingClientRect().toJSON(),
                  parent: {
                    attributes: Object.fromEntries(
                      [...element.parentElement.attributes].map(
                        ({ name, value }) => [name, value],
                      ),
                    ),
                    rect: element.parentElement
                      .getBoundingClientRect()
                      .toJSON(),
                  },
                  attributes: Object.fromEntries(
                    [...element.attributes].map(({ name, value }) => [
                      name,
                      value,
                    ]),
                  ),
                }
              : null;
          return {
            stage,
            frameFocused: document.activeElement === frame,
            active: describe(active),
            cell: describe(cell),
            hit: describe(hit),
            selectedObjects: [
              ...(doc?.querySelectorAll(
                '[data-presentation-element-id][aria-pressed="true"]',
              ) ?? []),
            ].map((element) => element.dataset.presentationElementId),
          };
        },
        { frameSelector: presentationFrameSelector, stage },
      ),
    );
    record();
  };
  await frame.click('[data-presentation-element-id="7"]');
  await selectionInput("object-click");
  await frame.click(
    '[data-presentation-table-id="7"] [data-presentation-cell="0:0"]',
  );
  await selectionInput("cell-click");
  await page.keyboard.press("ControlOrMeta+A");
  await selectionInput("select-all");
  const selected = await waitState({ sha256: original.sha256, selected: 20 });
  evidence.selected = selected;
  record();
  assert.equal(await button("所有边框").isEnabled(), true);
  assert.equal(selected.color.toUpperCase(), "#FFFFFF");
  assert.equal(
    selected.width,
    "1.333",
    "toolbar displays three decimals; package and renderer retain 12700 EMU",
  );
  await saved("header-row-on", { header: { row: true, column: false } }, () =>
    header("标题行"),
  );
  await saved("header-row-off", {}, () => header("标题行"));
  const column = { header: { row: false, column: true } };
  await saved("header-column-on", column, () => header("标题列"));
  await saved("undo-saved-header-column", {}, () => history("撤销"));
  await saved("redo-saved-header-column", column, () => history("重做"));
  await saved("header-column-off", {}, () => header("标题列"));
  const all = { preset: "all", width: 4 / 3, color: "#FFFFFF" };
  await saved("preset-all-from-inherited", all, () =>
    button("所有边框").click(),
  );
  const colored = { ...all, color: "#AA3344" };
  await saved("border-color", colored, () =>
    tableControls.getByLabel("边框颜色", { exact: true }).fill("#aa3344"),
  );
  const weighted = { ...colored, width: 3.25 };
  await saved("border-width", weighted, async () => {
    await tableControls
      .getByRole("spinbutton", { name: "边框粗细", exact: true })
      .click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText("3.25");
    await page.keyboard.press("Tab");
  });
  await saved("undo-saved-width", colored, () => history("撤销"));
  await saved("redo-saved-width", weighted, () => history("重做"));
  await saved("preset-inside", { ...weighted, preset: "inside" }, () =>
    button("内部边框").click(),
  );
  await saved(
    "preset-none",
    { preset: "none", width: 0, color: "#AA3344" },
    () => button("无边框").click(),
  );
  assert.equal(
    await tableControls.getByLabel("边框颜色", { exact: true }).count(),
    0,
  );
  const final = { preset: "all", width: 1, color: "#D1D5DB" };
  const finalDisk = await saved("preset-all-after-none", final, () =>
    button("所有边框").click(),
  );
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-table-builtin-edited.png"),
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
  const disk = await readPresentationTableBuiltinFile(filePath);
  assert.equal(disk.sha256, finalDisk.sha256);
  assertPresentationTableBuiltinSave(original, disk, final);
  assertPresentationTableBuiltinRenderer(reopened, original, final);
  // 超过 autosave 窗口只核对零额外写入；不靠等待制造保存终态。
  await page.waitForTimeout(650);
  const afterReopen = await counts();
  assert.equal(afterReopen.write, beforeReopen.write);
  assert.equal(await turns(), initialTurns);
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
  };
  evidence.finalSha256 = disk.sha256;
  evidence.undoRedoAcrossSave = true;
  evidence.additionalTurns = 0;
  evidence.colorInputAutomation =
    "Playwright Locator.fill(input[type=color]); native OS picker not exercised";
  evidence.scriptsAllowed = false;
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-table-builtin-reopened.png"),
  });
  record();
  return evidence;
}
