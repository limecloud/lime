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

const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const slidePath = "ppt/slides/slide1.xml";
const timeout = 15_000;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const markers = {
  2: "SLIDE_PREVIEW_01",
  3: "ELEMENT_A_保留",
  4: "ELEMENT_B_保留",
  7: "ELEMENT_T00",
};
const projectedFrames = (disk) =>
  Object.entries(markers).map(([id, text]) => ({
    id,
    text,
    frame: disk.elements[id].geometry.map(
      (value, index) => value / (index === 4 ? 60000 : 9525),
    ),
  }));
const direct = (node, namespace, name) =>
  Array.from(node?.children ?? []).filter(
    (item) => item.namespaceURI === namespace && item.localName === name,
  );
const initialGeometry = {
  2: [571500, 571500, 8001000, 1143000, 0],
  3: [952500, 2476500, 1143000, 762000, 0],
  4: [2857500, 2667000, 952500, 762000, 0],
  7: [5334000, 2667000, 2667000, 1333500, 0],
};
// 独立手写 EMU oracle；不导入生产 selection/frame/transform helper。
const movedGeometry = {
  ...initialGeometry,
  3: [1333500, 2667000, 1143000, 762000, 0],
  4: [3238500, 2857500, 952500, 762000, 0],
};
const resizedGeometry = {
  ...initialGeometry,
  3: [1333500, 2667000, 1371600, 914400, 0],
  4: [3619500, 2895600, 1143000, 914400, 0],
};
const rotatedGeometry = {
  ...initialGeometry,
  3: [2476500, 1752600, 1371600, 914400, 5400000],
  4: [2362200, 3924300, 1143000, 914400, 5400000],
};

function shape(id, name, x, y, width, height, fill) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm rot="0"><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:extLst><a:ext uri="urn:element:${id}"><keep:shape id="${id}" value="retained"/></a:ext></a:extLst></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:pPr marL="123" lvl="1"><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="zh-CN" sz="1800" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:hlinkClick r:id="rExternal"/></a:rPr><a:t>${name}_保留</a:t></a:r><a:endParaRPr lang="ja-JP" custom="end-${id}"/></a:p></p:txBody></p:sp>`;
}

export async function writePresentationElementFixture(filePath) {
  const zip = await JSZip.loadAsync(
    fs.readFileSync(
      "src/components/artifact/presentation/__fixtures__/review.pptx",
    ),
  );
  const cell = (row, column) =>
    `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1400"><a:solidFill><a:srgbClr val="223344"/></a:solidFill></a:rPr><a:t>ELEMENT_T${row}${column}</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="E5EEF7"/></a:solidFill><a:extLst><a:ext uri="urn:cell:${row}:${column}"><keep:cell value="retained"/></a:ext></a:extLst></a:tcPr></a:tc>`;
  const table = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="ELEMENT_TABLE"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm rot="0"><a:off x="5334000" y="2667000"/><a:ext cx="2667000" cy="1333500"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="0" bandRow="0"/><a:tblGrid><a:gridCol w="1333500"/><a:gridCol w="1333500"/></a:tblGrid>${[0, 1].map((row) => `<a:tr h="666750">${[0, 1].map((column) => cell(row, column)).join("")}</a:tr>`).join("")}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  const objects =
    shape("3", "ELEMENT_A", 952500, 2476500, 1143000, 762000, "328A64") +
    shape("4", "ELEMENT_B", 2857500, 2667000, 952500, 762000, "C87932") +
    table;
  zip.file(
    slidePath,
    (await zip.file(slidePath).async("string"))
      .replace("<p:sld ", '<p:sld xmlns:keep="urn:element-keep" ')
      .replace("</p:spTree>", `${objects}</p:spTree>`)
      .replace(
        "</p:sld>",
        '<p:extLst><p:ext uri="urn:slide-keep"><keep:slide value="retained"/></p:ext></p:extLst></p:sld>',
      ),
  );
  zip.file(
    "customXml/element-retained.xml",
    '<keep xmlns="urn:element-keep">unknown source metadata</keep>',
  );
  zip.file(
    "ppt/media/element-retained.bin",
    new Uint8Array([0, 255, 19, 128, 77]),
  );
  fs.writeFileSync(
    filePath,
    await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
  );
  fs.writeFileSync(
    path.join(path.dirname(filePath), "Broken.pptx"),
    "invalid presentation",
  );
  const snapshot = await readPresentationElementFile(filePath);
  assertPresentationElementFixture(snapshot);
  return {
    sha256: snapshot.sha256,
    slideIds: ["512", "900", "300"],
    elementIds: ["2", "3", "4", "7"],
    slideSize: [960, 540],
  };
}

/** 独立读取 ZIP/OOXML，不使用 renderer 或生产几何函数生成期望。 */
export async function readPresentationElementFile(filePath) {
  const bytes = fs.readFileSync(filePath),
    zip = await JSZip.loadAsync(bytes, { checkCRC32: true }),
    parts = {};
  for (const [name, entry] of Object.entries(zip.files))
    if (!entry.dir) parts[name] = digest(await entry.async("uint8array"));
  const dom = new JSDOM(await zip.file(slidePath).async("string"), {
    contentType: "application/xml",
  });
  const manifest = new JSDOM(
    await zip.file("ppt/presentation.xml").async("string"),
    { contentType: "application/xml" },
  );
  try {
    const document = dom.window.document,
      serialize = (node) =>
        new dom.window.XMLSerializer().serializeToString(node);
    const tree = document.getElementsByTagNameNS(p, "spTree")[0],
      elements = {};
    const objects = Array.from(tree.children).filter(
      (node) =>
        node.namespaceURI === p &&
        ["sp", "graphicFrame"].includes(node.localName),
    );
    const order = [];
    for (const object of objects) {
      const id = object
        .getElementsByTagNameNS(p, "cNvPr")[0]
        .getAttribute("id");
      assert.equal(order.includes(id), false, "unique source object identity");
      order.push(id);
      const xfrm =
        object.localName === "graphicFrame"
          ? direct(object, p, "xfrm")[0]
          : direct(direct(object, p, "spPr")[0], a, "xfrm")[0];
      const off = direct(xfrm, a, "off")[0],
        ext = direct(xfrm, a, "ext")[0];
      const content = object.cloneNode(true);
      (object.localName === "graphicFrame"
        ? direct(content, p, "xfrm")[0]
        : direct(direct(content, p, "spPr")[0], a, "xfrm")[0]
      ).remove();
      elements[id] = {
        geometry: [
          Number(off.getAttribute("x")),
          Number(off.getAttribute("y")),
          Number(ext.getAttribute("cx")),
          Number(ext.getAttribute("cy")),
          Number(xfrm.getAttribute("rot") ?? 0),
        ],
        text: Array.from(
          object.getElementsByTagNameNS(a, "t"),
          (node) => node.textContent,
        ).join("\n"),
        contentSha256: digest(serialize(content)),
        unknown: Array.from(
          object.getElementsByTagNameNS("urn:element-keep", "*"),
          (node) => serialize(node),
        ),
        columnWidths: Array.from(
          object.getElementsByTagNameNS(a, "gridCol"),
          (node) => Number(node.getAttribute("w")),
        ),
        rowHeights: Array.from(object.getElementsByTagNameNS(a, "tr"), (node) =>
          Number(node.getAttribute("h")),
        ),
      };
    }
    const rest = document.documentElement.cloneNode(true),
      restTree = rest.getElementsByTagNameNS(p, "spTree")[0];
    for (const node of Array.from(restTree.children))
      if (node.localName === "sp" || node.localName === "graphicFrame")
        node.remove();
    return {
      sha256: digest(bytes),
      entries: Object.keys(zip.files).sort(),
      parts,
      slideIds: Array.from(
        manifest.window.document.getElementsByTagNameNS(p, "sldId"),
        (node) => node.getAttribute("id"),
      ),
      size: [
        Number(
          manifest.window.document
            .getElementsByTagNameNS(p, "sldSz")[0]
            .getAttribute("cx"),
        ),
        Number(
          manifest.window.document
            .getElementsByTagNameNS(p, "sldSz")[0]
            .getAttribute("cy"),
        ),
      ],
      order,
      elements,
      restSha256: digest(serialize(rest)),
    };
  } finally {
    dom.window.close();
    manifest.window.close();
  }
}

export function assertPresentationElementFixture(value) {
  assert.deepEqual(value.slideIds, ["512", "900", "300"]);
  assert.deepEqual(value.size, [9144000, 5143500]);
  assert.deepEqual(value.order, ["2", "3", "4", "7"]);
  for (const [id, geometry] of Object.entries(initialGeometry))
    assert.deepEqual(value.elements[id].geometry, geometry);
  assert.equal(value.elements["2"].text, "SLIDE_PREVIEW_01");
  assert.equal(value.elements["3"].text, "ELEMENT_A_保留");
  assert.equal(value.elements["4"].text, "ELEMENT_B_保留");
  assert.equal(
    value.elements["7"].text,
    "ELEMENT_T00\nELEMENT_T01\nELEMENT_T10\nELEMENT_T11",
  );
  assert.deepEqual(value.elements["7"].columnWidths, [1333500, 1333500]);
  assert.deepEqual(value.elements["7"].rowHeights, [666750, 666750]);
  assert.ok(
    value.parts["customXml/element-retained.xml"] &&
      value.parts["ppt/media/element-retained.bin"],
  );
}

export function assertPresentationElementSave(
  before,
  after,
  geometry,
  order = ["2", "3", "4", "7"],
  toleranceEmu = 0,
) {
  assert.deepEqual(after.slideIds, before.slideIds);
  assert.deepEqual(after.size, before.size);
  assert.deepEqual(
    after.entries,
    before.entries,
    "all ZIP entries including directories remain",
  );
  assert.deepEqual(
    after.order,
    order,
    "source z-order matches the requested single-object operation",
  );
  assert.equal(
    after.restSha256,
    before.restSha256,
    "background, slide metadata and non-object XML remain",
  );
  let preservedParts = 0;
  for (const [name, sha] of Object.entries(before.parts))
    if (name !== slidePath) {
      assert.equal(after.parts[name], sha, `untouched ZIP part: ${name}`);
      preservedParts++;
    }
  for (const [id, expected] of Object.entries(geometry)) {
    const actual = after.elements[id];
    assert.ok(actual, `source object ${id} survives`);
    expected.forEach((value, index) =>
      assert.ok(
        Math.abs(actual.geometry[index] - value) <=
          (id === "2" || id === "7" || index === 4 ? 0 : toleranceEmu),
        `object ${id} geometry[${index}]: ${actual.geometry[index]} versus ${value}`,
      ),
    );
    for (const field of [
      "text",
      "contentSha256",
      "unknown",
      "columnWidths",
      "rowHeights",
    ])
      assert.deepEqual(
        actual[field],
        before.elements[id][field],
        `object ${id} retains ${field}`,
      );
  }
  return {
    preservedParts,
    preservedObjectContents: Object.keys(geometry).length,
  };
}

export function assertPresentationElementNativeLifecycle(
  events,
  pointerType,
  terminal,
) {
  const down = events.find((event) => event.type === "pointerdown");
  assert.ok(
    down?.isTrusted &&
      down.pointerType === pointerType &&
      Number.isInteger(down.pointerId),
    "trusted native pointerdown identity",
  );
  const same = events
    .slice(events.indexOf(down))
    .filter((event) => event.pointerId === down.pointerId);
  assert.ok(
    same.every((event) => event.isTrusted && event.pointerType === pointerType),
    "same trusted pointer/type throughout lifecycle",
  );
  assert.ok(
    same.some((event) => event.type === "pointermove"),
    "native pointermove observed",
  );
  const endings = same.filter((event) =>
    ["pointerup", "pointercancel"].includes(event.type),
  );
  assert.equal(endings.length, 1, "exactly one native terminal event");
  assert.equal(endings[0].type, terminal);
  return {
    pointerId: down.pointerId,
    pointerType,
    terminal,
    isTrusted: true,
    events: same,
  };
}

async function observeNative(page, perform) {
  const key = "__limePresentationElementNativeObservation";
  await page.evaluate(
    ({ selector, key }) => {
      const content = document.querySelector(selector)?.contentDocument;
      if (!content || window[key])
        throw new Error(
          "fresh native observer requires the actual slide document",
        );
      const events = [],
        types = [
          "pointerdown",
          "pointermove",
          "pointerup",
          "pointercancel",
          "keydown",
        ];
      const record = (event) => {
        if (!event.target?.closest?.("[data-slide-id]")) return;
        events.push({
          type: event.type,
          isTrusted: event.isTrusted,
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          screenX: event.screenX,
          screenY: event.screenY,
          key: event.key,
          shiftKey: event.shiftKey,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
        });
      };
      types.forEach((type) => content.addEventListener(type, record, true));
      window[key] = {
        events,
        dispose: () =>
          types.forEach((type) =>
            content.removeEventListener(type, record, true),
          ),
      };
    },
    { selector: presentationFrameSelector, key },
  );
  let events;
  try {
    await perform();
  } finally {
    // 监听器属于父文档 realm，原样移除；不向 iframe 注入脚本。
    events = await page.evaluate((key) => {
      const value = window[key];
      value.dispose();
      delete window[key];
      return value.events;
    }, key);
  }
  return events;
}

function elementDom(expected = {}) {
  const panel = document.querySelector('[data-testid="presentation-panel"]'),
    controls = panel?.querySelector(
      '[data-testid="presentation-editing-controls"]',
    );
  const content = panel?.querySelector("iframe")?.contentDocument,
    slide = content?.querySelector('[data-slide-id="512"]');
  const elements = Array.from(
    slide?.querySelectorAll("[data-presentation-element-id]") ?? [],
  );
  const frame = (node) => [
    parseFloat(node.style.left),
    parseFloat(node.style.top),
    parseFloat(node.style.width),
    parseFloat(node.style.height),
    Number(node.style.transform.match(/rotate\((-?[\d.]+)deg\)/)?.[1] ?? 0),
  ];
  const painted = Array.from(slide?.children ?? [])
    .filter(
      (node) =>
        node.localName === "div" &&
        !Array.from(node.attributes).some((item) =>
          item.name.startsWith("data-presentation-"),
        ),
    )
    .slice(-4)
    .map((node) => ({ text: node.textContent, frame: frame(node) }));
  const state = {
    sha256: panel?.getAttribute("data-source-sha256"),
    dirty: controls?.getAttribute("data-dirty") === "true",
    saving: controls?.getAttribute("data-saving") === "true",
    selected: elements
      .filter((node) => node.getAttribute("aria-pressed") === "true")
      .map((node) => node.getAttribute("data-presentation-element-id"))
      .sort(),
    geometry: Object.fromEntries(
      elements.map((node) => [
        node.getAttribute("data-presentation-element-id"),
        frame(node),
      ]),
    ),
    preview: slide?.querySelectorAll("[data-presentation-preview]").length ?? 0,
    marquee: !!slide?.querySelector(
      "[data-presentation-marquee]:not([hidden])",
    ),
    editing: elements.length > 0,
    painted,
  };
  if (!Object.keys(expected).length) return state;
  if (
    panel?.getAttribute("data-status") !== "ready" ||
    !slide ||
    state.dirty ||
    state.saving
  )
    return false;
  if (expected.sha256 && state.sha256 !== expected.sha256) return false;
  if (expected.changedFrom && state.sha256 === expected.changedFrom)
    return false;
  if (
    expected.selected &&
    JSON.stringify(state.selected) !== JSON.stringify(expected.selected)
  )
    return false;
  if (expected.preview !== undefined && state.preview > 0 !== expected.preview)
    return false;
  if (expected.marquee !== undefined && state.marquee !== expected.marquee)
    return false;
  if (expected.editing !== undefined && state.editing !== expected.editing)
    return false;
  if (
    expected.previewCount !== undefined &&
    state.preview !== expected.previewCount
  )
    return false;
  if (
    expected.frames?.some((target) => {
      const actual = state.painted.find((item) =>
        item.text.includes(target.text),
      );
      return (
        !actual ||
        actual.frame.some(
          (value, index) => Math.abs(value - target.frame[index]) >= 0.001,
        )
      );
    })
  )
    return false;
  return state;
}

/** 入口负责打开此独立夹具和真实 Electron freshness；本函数不启动进程。 */
export async function runPresentationElementScenario({
  page,
  evidenceDir,
  filePath,
  readTrace,
}) {
  assert.equal(typeof readTrace, "function");
  const panel = page.getByTestId("presentation-panel"),
    controls = panel.getByTestId("presentation-editing-controls");
  const frame = createArtifactFrameDriver(page, presentationFrameSelector),
    original = await readPresentationElementFile(filePath);
  assertPresentationElementFixture(original);
  const io = async () => presentationNavigationIo(await readTrace(), filePath);
  const turns = async () =>
    (await readTrace())
      .flatMap((row) => row.args_preview?.request?.lines ?? [])
      .filter((line) => JSON.parse(line).method === "turn/start").length;
  const initialTurns = await turns(),
    evidence = {
      initialSha256: original.sha256,
      fixture: { slideSize: [960, 540], objectIds: original.order },
      manualSaveClicks: 0,
      stages: [],
    };
  const record = (value) => {
    evidence.stages.push(value);
    fs.writeFileSync(
      path.join(evidenceDir, "presentation-elements.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  };
  const waitState = async (expected) => {
    let value;
    try {
      value = await page.waitForFunction(elementDom, expected, { timeout });
    } catch (error) {
      evidence.waitFailure = {
        expected,
        actual: await page.evaluate(elementDom).catch(() => null),
      };
      fs.writeFileSync(
        path.join(evidenceDir, "presentation-elements.json"),
        `${JSON.stringify(evidence, null, 2)}\n`,
      );
      throw error;
    }
    try {
      return await value.jsonValue();
    } finally {
      await value.dispose();
    }
  };
  const capture = async () => ({
    sha256: digest(fs.readFileSync(filePath)),
    io: await io(),
  });
  const noWrite = async (name, before) => {
    await page.waitForTimeout(650);
    assert.equal(
      digest(fs.readFileSync(filePath)),
      before.sha256,
      `${name}: persisted bytes unchanged across autosave window`,
    );
    assert.equal(
      (await io()).write,
      before.io.write,
      `${name}: zero real IPC source writes`,
    );
    assert.equal(await turns(), initialTurns, `${name}: zero additional turns`);
  };
  const checkRenderer = (state, disk) => {
    assert.equal(
      state.sha256,
      disk.sha256,
      "visible projection is bound to persisted source SHA",
    );
    assert.equal(state.painted.length, 4);
    assert.deepEqual(
      state.painted.map(
        (node) =>
          Object.entries(markers).find(([, text]) =>
            node.text.includes(text),
          )?.[0],
      ),
      disk.order,
      "actual painted stacking matches source z-order",
    );
    for (const [id, marker] of Object.entries(markers)) {
      const actual = state.painted.find((node) => node.text.includes(marker));
      assert.ok(actual, `actual rendered object ${id} content remains visible`);
      const expected = disk.elements[id].geometry.map(
        (value, index) => value / (index === 4 ? 60000 : 9525),
      );
      actual.frame.forEach((value, index) =>
        assert.ok(
          Math.abs(value - expected[index]) < 0.001,
          `rendered object ${id} frame ${index} matches saved source`,
        ),
      );
      if (state.editing)
        state.geometry[id].forEach((value, index) =>
          assert.ok(
            Math.abs(value - expected[index]) < 0.001,
            `overlay ${id} matches source`,
          ),
        );
    }
  };
  const saved = async (name, before, geometry, order, lifecycle) => {
    await waitState({
      changedFrom: before.sha256,
      preview: false,
    });
    const disk = await readPresentationElementFile(filePath);
    const state = await waitState({
      sha256: disk.sha256,
      frames: projectedFrames(disk),
      preview: false,
    });
    const preserved = assertPresentationElementSave(
      original,
      disk,
      geometry,
      order,
      4 * 9525,
    );
    checkRenderer(state, disk);
    const counts = await io(),
      delta = {
        read: counts.read - before.io.read,
        write: counts.write - before.io.write,
      };
    assert.deepEqual(
      delta,
      { read: 2, write: 1 },
      `${name}: one atomic commit has two source checks and one automatic save`,
    );
    assert.equal(await turns(), initialTurns);
    record({
      name,
      sha256: disk.sha256,
      ...preserved,
      geometry: Object.fromEntries(
        Object.entries(disk.elements).map(([id, value]) => [
          id,
          value.geometry,
        ]),
      ),
      order: disk.order,
      fileIoDelta: delta,
      automaticSave: true,
      ...(lifecycle ? { lifecycle } : {}),
    });
    return disk;
  };
  const localPoint = async (x, y) => {
    const box = await frame.box("[data-slide-id]");
    return {
      x: box.x + (x * box.width) / 960,
      y: box.y + (y * box.height) / 540,
    };
  };
  const middle = (box) => ({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });
  const select = async (id, shift = false) => {
    if (shift) await page.keyboard.down("Shift");
    try {
      const { hitPoint } = await frame.visible(
        `[data-presentation-element-id="${id}"]`,
      );
      assert.ok(hitPoint, `object ${id}: native selection requires a real hit`);
      await page.mouse.click(hitPoint.x, hitPoint.y);
    } finally {
      if (shift) await page.keyboard.up("Shift");
    }
  };
  const drag = async (
    name,
    start,
    end,
    previewKind,
    expectedGeometry,
    order,
  ) => {
    const before = await capture();
    let lifecycle;
    const events = await observeNative(page, async () => {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 12 });
      await waitState(
        previewKind === "marquee"
          ? { marquee: true, selected: ["3", "4"] }
          : { preview: true, previewCount: 2, selected: ["3", "4"] },
      );
      await noWrite(`${name}-preview`, before);
      await page.mouse.up();
    });
    lifecycle = assertPresentationElementNativeLifecycle(
      events,
      "mouse",
      "pointerup",
    );
    if (previewKind === "marquee") {
      await waitState({ selected: ["3", "4"], marquee: false });
      await noWrite(name, before);
      record({ name, lifecycle, sourceWrites: 0, observationMs: 650 });
      return;
    }
    return saved(name, before, expectedGeometry, order, lifecycle);
  };
  const history = async (name, key, geometry) => {
    const before = await capture();
    const events = await observeNative(page, () => page.keyboard.press(key));
    assert.ok(
      events.some(
        (event) =>
          event.type === "keydown" &&
          event.isTrusted &&
          event.key.toLowerCase() === "z" &&
          (event.ctrlKey || event.metaKey),
      ),
      "history uses trusted keyboard input",
    );
    return saved(name, before, geometry, undefined, {
      trustedKeyboard: true,
      key,
      events,
    });
  };

  await waitForPresentationSlide(page, "512");
  checkRenderer(
    await waitState({
      sha256: original.sha256,
      editing: false,
      frames: projectedFrames(original),
    }),
    original,
  );
  await controls.getByRole("button", { name: "编辑", exact: true }).click();
  const beforeSelection = await capture();
  const selectionEvents = await observeNative(page, async () => {
    await select("3");
    await waitState({ selected: ["3"] });
    await select("4", true);
    await waitState({ selected: ["3", "4"] });
    await select("4", true);
    await waitState({ selected: ["3"] });
    await page.keyboard.press("Escape");
    await waitState({ selected: [] });
  });
  const shiftDowns = selectionEvents.filter(
    (event) => event.type === "pointerdown" && event.shiftKey,
  );
  assert.equal(
    shiftDowns.length,
    2,
    "both additive/removal clicks carry native Shift",
  );
  assert.ok(shiftDowns.every((event) => event.isTrusted));
  await noWrite("shift-toggle-and-clear-selection", beforeSelection);
  record({
    name: "shift-add-remove-and-escape",
    sourceWrites: 0,
    observationMs: 650,
    events: selectionEvents,
  });
  await drag(
    "native-blank-marquee",
    await localPoint(80, 230),
    await localPoint(420, 380),
    "marquee",
  );
  const startMove = middle(
      await frame.box('[data-presentation-element-id="3"]'),
    ),
    scale = (await frame.box("[data-slide-id]")).width / 960;
  await drag(
    "native-two-object-move",
    startMove,
    { x: startMove.x + 40 * scale, y: startMove.y + 20 * scale },
    "element",
    movedGeometry,
  );
  await history(
    "single-undo-reverts-both-moved-objects",
    "ControlOrMeta+z",
    initialGeometry,
  );
  await history(
    "single-redo-restores-both-moved-objects",
    "ControlOrMeta+Shift+z",
    movedGeometry,
  );
  const resize = middle(await frame.box('[data-presentation-resize="se"]'));
  await drag(
    "native-two-object-proportional-resize",
    resize,
    { x: resize.x + 60 * scale, y: resize.y + 20 * scale },
    "element",
    resizedGeometry,
  );
  const rotate = middle(await frame.box("[data-presentation-rotate]")),
    selectionBox = await frame.box("[data-presentation-selection]"),
    origin = middle(selectionBox);
  const radius = Math.hypot(rotate.x - origin.x, rotate.y - origin.y);
  await page.keyboard.down("Shift");
  try {
    await drag(
      "native-two-object-rotate-90",
      rotate,
      { x: origin.x + radius, y: origin.y },
      "element",
      rotatedGeometry,
    );
  } finally {
    await page.keyboard.up("Shift");
  }
  const beforeCancel = await capture(),
    cancelStart = middle(await frame.box('[data-presentation-element-id="3"]'));
  const cdp = await page.context().newCDPSession(page);
  const cancelEvents = await observeNative(page, async () => {
    try {
      await cdp.send("Emulation.setTouchEmulationEnabled", {
        enabled: true,
        maxTouchPoints: 1,
      });
      const points = (x, y) => [
        { x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 },
      ];
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: points(cancelStart.x, cancelStart.y),
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: points(cancelStart.x + 25, cancelStart.y + 15),
      });
      await waitState({ preview: true, selected: ["3", "4"] });
      await noWrite("native-touch-before-cancel", beforeCancel);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchCancel",
        touchPoints: [],
      });
      await waitState({ preview: false, selected: ["3", "4"] });
    } finally {
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
      await cdp.detach();
    }
  });
  const cancelLifecycle = assertPresentationElementNativeLifecycle(
    cancelEvents,
    "touch",
    "pointercancel",
  );
  await noWrite("native-touch-cancel", beforeCancel);
  checkRenderer(
    await waitState({ preview: false }),
    await readPresentationElementFile(filePath),
  );
  record({
    name: "native-pointercancel-restores-artwork",
    lifecycle: cancelLifecycle,
    sourceWrites: 0,
    observationMs: 650,
  });
  await history(
    "cancel-adds-no-history-undo-rotation",
    "ControlOrMeta+z",
    resizedGeometry,
  );
  await history(
    "redo-restores-rotation-after-cancel",
    "ControlOrMeta+Shift+z",
    rotatedGeometry,
  );
  const beforeSingleSelection = await capture();
  await page.keyboard.press("Escape");
  await waitState({ selected: [] });
  await select("3");
  await waitState({ selected: ["3"] });
  await noWrite(
    "clear-group-before-single-object-z-order",
    beforeSingleSelection,
  );
  record({
    name: "clear-group-before-single-object-z-order",
    selected: ["3"],
    sourceWrites: 0,
    observationMs: 650,
  });
  for (const [label, order] of [
    ["上移一层", ["2", "4", "3", "7"]],
    ["置于顶层", ["2", "4", "7", "3"]],
    ["下移一层", ["2", "4", "3", "7"]],
    ["置于底层", ["3", "2", "4", "7"]],
  ]) {
    const before = await capture();
    await controls.getByRole("button", { name: label, exact: true }).click();
    await saved(
      `single-object-z-order-${label}`,
      before,
      rotatedGeometry,
      order,
    );
  }
  const beforeEndEditing = await capture();
  await controls.getByRole("button", { name: "结束编辑", exact: true }).click();
  await waitState({ editing: false });
  await noWrite("finish-clean-editing-before-reopen", beforeEndEditing);
  record({
    name: "finish-clean-editing-before-reopen",
    sourceWrites: 0,
    observationMs: 650,
  });
  const final = await readPresentationElementFile(filePath),
    beforeReopen = await io();
  await replaceFileTab(page, filePath);
  await waitForArtifactFileRead(
    async () => (await io()).read,
    beforeReopen.read,
  );
  await waitForPresentationSlide(page, "512");
  const reopened = await waitState({
    sha256: final.sha256,
    editing: false,
    frames: projectedFrames(final),
  });
  checkRenderer(reopened, final);
  await page.waitForTimeout(650);
  assert.equal(
    (await io()).write,
    beforeReopen.write,
    "same-path clean reopen never writes",
  );
  assert.equal(digest(fs.readFileSync(filePath)), final.sha256);
  assert.equal(await turns(), initialTurns);
  assert.equal(
    await panel.locator("iframe").getAttribute("sandbox"),
    "allow-same-origin",
  );
  assert.equal(await frame.count("script,iframe,a[href],[onclick]"), 0);
  evidence.finalSha256 = final.sha256;
  evidence.additionalTurns = 0;
  evidence.undoRedoAcrossSave = true;
  evidence.reopen = {
    sha256: final.sha256,
    sourceReads: (await io()).read - beforeReopen.read,
    painted: reopened.painted,
  };
  evidence.geometryTolerance = {
    targetEmu: 38100,
    nonTargetEmu: 0,
    rotationEmu: 0,
    reason:
      "native screen coordinate quantization; manually specified frame/EMU oracle, never derived from saved output",
  };
  record({ name: "same-path-clean-reopen", sourceWrites: 0 });
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-elements-reopened.png"),
  });
  return evidence;
}
