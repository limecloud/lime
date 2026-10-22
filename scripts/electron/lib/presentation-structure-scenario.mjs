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

const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
const ct = "http://schemas.openxmlformats.org/package/2006/content-types";
const titleLayout = "ppt/slideLayouts/slideLayout1.xml";
const blankLayout = "ppt/slideLayouts/slideLayout2.xml";
const masterPath = "ppt/slideMasters/slideMaster1.xml";
const themePath = "ppt/theme/theme1.xml";
const originalIds = ["512", "900", "300"];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const relationPath = (source) =>
  path.posix.join(
    path.posix.dirname(source),
    "_rels",
    `${path.posix.basename(source)}.rels`,
  );
const tree = (shapes = "") =>
  `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree>`;
const relationships = (rows) =>
  `<Relationships xmlns="${rel}">${rows.map(([id, type, target]) => `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"/>`).join("")}</Relationships>`;

function themeXml() {
  const colors = {
    dk1: "000000",
    lt1: "FFFFFF",
    dk2: "44546A",
    lt2: "E7E6E6",
    accent1: "4472C4",
    accent2: "ED7D31",
    accent3: "A5A5A5",
    accent4: "FFC000",
    accent5: "5B9BD5",
    accent6: "70AD47",
    hlink: "0563C1",
    folHlink: "954F72",
  };
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const line = `<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr">${fill}<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;
  const font =
    '<a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/>';
  return `<a:theme xmlns:a="${a}" name="Structure fixture"><a:themeElements><a:clrScheme name="Office">${Object.entries(
    colors,
  )
    .map(
      ([name, color]) => `<a:${name}><a:srgbClr val="${color}"/></a:${name}>`,
    )
    .join(
      "",
    )}</a:clrScheme><a:fontScheme name="Office"><a:majorFont>${font}</a:majorFont><a:minorFont>${font}</a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst>${fill.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${line.repeat(3)}</a:lnStyleLst><a:effectStyleLst>${"<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${fill.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

/** 只为本场景补真实 master/layout/theme，不改原三页的内容或 identity。 */
export async function writePresentationStructureFixture(filePath) {
  const zip = await JSZip.loadAsync(
    fs.readFileSync(
      "src/components/artifact/presentation/__fixtures__/review.pptx",
    ),
  );
  const append = async (part, end, addition) => {
    const source = await zip.file(part).async("string");
    assert.equal(source.split(end).length, 2, `unique fixture anchor: ${part}`);
    zip.file(part, source.replace(end, `${addition}${end}`));
  };
  const presentation = await zip.file("ppt/presentation.xml").async("string");
  assert.ok(!presentation.includes("sldMasterIdLst"));
  zip.file(
    "ppt/presentation.xml",
    presentation.replace(
      "<p:sldIdLst>",
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="structureMaster"/></p:sldMasterIdLst><p:sldIdLst>',
    ),
  );
  await append(
    "ppt/_rels/presentation.xml.rels",
    "</Relationships>",
    `<Relationship Id="structureMaster" Type="${r}/slideMaster" Target="slideMasters/slideMaster1.xml"/>`,
  );
  const placeholder = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="title" idx="0"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="274320"/><a:ext cx="8229600" cy="1143000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="l"/><a:r><a:rPr lang="en-US" sz="2800" b="1"/><a:t/></a:r></a:p></p:txBody></p:sp>`;
  zip.file(
    masterPath,
    `<p:sldMaster xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld name="Structure master">${tree()}</p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="title"/><p:sldLayoutId id="2147483650" r:id="blank"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`,
  );
  zip.file(
    relationPath(masterPath),
    relationships([
      ["title", "slideLayout", "../slideLayouts/slideLayout1.xml"],
      ["blank", "slideLayout", "../slideLayouts/slideLayout2.xml"],
      ["theme", "theme", "../theme/theme1.xml"],
    ]),
  );
  for (const [layout, type, name, shapes] of [
    [titleLayout, "title", "Structure title", placeholder],
    [blankLayout, "blank", "Structure blank", ""],
  ]) {
    zip.file(
      layout,
      `<p:sldLayout xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}" type="${type}" preserve="1"><p:cSld name="${name}">${tree(shapes)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    );
    zip.file(
      relationPath(layout),
      relationships([
        ["master", "slideMaster", "../slideMasters/slideMaster1.xml"],
      ]),
    );
  }
  zip.file(themePath, themeXml());
  for (let index = 1; index <= 3; index++)
    await append(
      `ppt/slides/_rels/slide${index}.xml.rels`,
      "</Relationships>",
      `<Relationship Id="structureLayout" Type="${r}/slideLayout" Target="../slideLayouts/slideLayout${index === 1 ? 1 : 2}.xml"/>`,
    );
  const types = {
    [masterPath]: "presentationml.slideMaster",
    [titleLayout]: "presentationml.slideLayout",
    [blankLayout]: "presentationml.slideLayout",
    [themePath]: "theme",
  };
  await append(
    "[Content_Types].xml",
    "</Types>",
    Object.entries(types)
      .map(
        ([name, type]) =>
          `<Override PartName="/${name}" ContentType="application/vnd.openxmlformats-officedocument.${type}+xml"/>`,
      )
      .join(""),
  );
  const bytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  const parsed = await readPackage(bytes);
  assert.deepEqual(parsed.ids, originalIds);
  for (let index = 0; index < 3; index++)
    assert.ok(
      parsed.slides[index].text.includes(`SLIDE_PREVIEW_0${index + 1}`),
    );
  fs.writeFileSync(filePath, bytes);
  fs.writeFileSync(
    path.join(path.dirname(filePath), "Broken.pptx"),
    "invalid presentation",
  );
  return {
    sha256: sha(bytes),
    slideIds: parsed.ids,
    titleLayout,
    blankLayout,
    masterPath,
    themePath,
  };
}

async function readPackage(bytes) {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const dom = new JSDOM("");
  try {
    const parse = (source) => {
      assert.ok(
        !/<!DOCTYPE|<!ENTITY/i.test(source),
        "no XML entities in fixture output",
      );
      const xml = new dom.window.DOMParser().parseFromString(
        source,
        "application/xml",
      );
      assert.equal(xml.getElementsByTagNameNS("*", "parsererror").length, 0);
      return xml;
    };
    const xml = async (name) => {
      assert.ok(zip.file(name), `part exists: ${name}`);
      return parse(await zip.file(name).async("string"));
    };
    const graph = new Map();
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir || !name.endsWith(".rels")) continue;
      const match = /^(?:(.*)\/)?_rels\/([^/]+)\.rels$/.exec(name);
      assert.ok(
        name === "_rels/.rels" || match,
        `relationship part name: ${name}`,
      );
      const owner =
        name === "_rels/.rels"
          ? ""
          : `${match?.[1] ? `${match[1]}/` : ""}${match?.[2] ?? ""}`;
      assert.ok(!owner || zip.file(owner), `relationship owner: ${name}`);
      const document = await xml(name);
      assert.equal(document.documentElement.namespaceURI, rel);
      const ids = new Set();
      const rows = Array.from(document.documentElement.children, (node) => {
        const id = node.getAttribute("Id"),
          type = node.getAttribute("Type"),
          raw = node.getAttribute("Target");
        assert.ok(id && !ids.has(id));
        ids.add(id);
        assert.equal(node.namespaceURI, rel);
        assert.equal(node.localName, "Relationship");
        assert.ok(type, `relationship type: ${name}/${id}`);
        const external =
          node.getAttribute("TargetMode")?.toLowerCase() === "external";
        let target;
        if (!external) {
          assert.ok(raw && !/[:\\#?%]/u.test(raw) && !raw.startsWith("//"));
          target = path.posix.normalize(
            raw.startsWith("/")
              ? raw.slice(1)
              : path.posix.join(path.posix.dirname(owner || "part"), raw),
          );
          assert.ok(
            !target.startsWith("../") && zip.file(target),
            `resolved target: ${name} -> ${raw}`,
          );
        }
        return { id, type, external, path: target };
      });
      graph.set(owner, rows);
    }
    const types = await xml("[Content_Types].xml");
    assert.equal(types.documentElement.namespaceURI, ct);
    const overrideNodes = Array.from(
      types.getElementsByTagNameNS(ct, "Override"),
    );
    const overrides = new Map(
      overrideNodes.map((node) => {
        const name = node.getAttribute("PartName");
        assert.ok(name?.startsWith("/") && node.getAttribute("ContentType"));
        return [name.slice(1), node.getAttribute("ContentType")];
      }),
    );
    assert.equal(
      overrides.size,
      overrideNodes.length,
      "content type override names are unique",
    );
    for (const name of overrides.keys())
      assert.ok(zip.file(name), `content type has a real part: ${name}`);
    const presentation = await xml("ppt/presentation.xml");
    assert.equal(presentation.documentElement.namespaceURI, p);
    const list = presentation.getElementsByTagNameNS(p, "sldIdLst");
    assert.equal(list.length, 1);
    const slides = [];
    for (const node of list[0].children) {
      const id = node.getAttribute("id"),
        relation = graph
          .get("ppt/presentation.xml")
          .find((row) => row.id === node.getAttributeNS(r, "id"));
      assert.ok(/^[1-9][0-9]*$/.test(id));
      assert.equal(relation?.type, `${r}/slide`);
      const source = await zip.file(relation.path).async("string"),
        document = parse(source);
      assert.equal(document.documentElement.namespaceURI, p);
      assert.equal(document.documentElement.localName, "sld");
      assert.equal(
        overrides.get(relation.path),
        "application/vnd.openxmlformats-officedocument.presentationml.slide+xml",
      );
      const layouts = (graph.get(relation.path) ?? []).filter(
        (row) => row.type === `${r}/slideLayout`,
      );
      assert.equal(layouts.length, 1);
      const layout = await xml(layouts[0].path);
      assert.equal(layout.documentElement.namespaceURI, p);
      assert.equal(layout.documentElement.localName, "sldLayout");
      slides.push({
        id,
        path: relation.path,
        layout: layouts[0].path,
        layoutType: layout.documentElement.getAttribute("type"),
        text: Array.from(
          document.getElementsByTagNameNS(a, "t"),
          (node) => node.textContent,
        ).join("\n"),
        shapeCount: document.getElementsByTagNameNS(p, "sp").length,
        xmlSha256: sha(source),
      });
    }
    const ids = slides.map((slide) => slide.id);
    assert.equal(new Set(ids).size, ids.length);
    return { ids, slides, sha256: sha(bytes) };
  } finally {
    dom.window.close();
  }
}

/** 仅在父文档读受限 iframe 的同源投影，不往 iframe 安装脚本。 */
function presentationStateDom(expected = {}) {
  const panel = document.querySelector('[data-testid="presentation-panel"]');
  const controls = panel?.querySelector(
    '[data-testid="presentation-editing-controls"]',
  );
  const slide = panel
    ?.querySelector("iframe")
    ?.contentDocument?.querySelector("[data-slide-id]");
  const number = panel?.querySelector('input[aria-label="幻灯片编号"]');
  const total =
    number?.nextElementSibling?.textContent?.match(/^\s*\/\s*(\d+)\s*$/)?.[1];
  const available = Array.from(controls?.querySelectorAll("button") ?? []).find(
    (node) => node.textContent === "复制幻灯片",
  );
  if (panel?.getAttribute("data-status") !== "ready" || !slide || !total)
    return false;
  const state = {
    selectedId: slide.getAttribute("data-slide-id"),
    number: Number(number.value),
    count: Number(total),
    dirty: controls?.getAttribute("data-dirty") === "true",
    saving: controls?.getAttribute("data-saving") === "true",
    sourceSha256: panel.getAttribute("data-source-sha256"),
    text: slide.textContent,
  };
  if (expected.count !== undefined && state.count !== expected.count)
    return false;
  if (expected.selectedId && state.selectedId !== expected.selectedId)
    return false;
  if (expected.excludeIds?.includes(state.selectedId)) return false;
  if (expected.number !== undefined && state.number !== expected.number)
    return false;
  if (expected.dirty !== undefined && state.dirty !== expected.dirty)
    return false;
  if (expected.idle && (!available || available.disabled || state.saving))
    return false;
  return state;
}

/** 真实按钮/键盘 -> current 文件网关 -> 原ZIP -> 真实重开；不手动点保存。 */
export async function runPresentationStructureScenario({
  page,
  evidenceDir,
  filePath,
  readTrace,
}) {
  assert.equal(typeof readTrace, "function");
  const panel = page.getByTestId("presentation-panel");
  const controls = panel.getByTestId("presentation-editing-controls");
  const frame = createArtifactFrameDriver(page, presentationFrameSelector);
  const waitState = async (expected) => {
    const handle = await page.waitForFunction(presentationStateDom, expected);
    try {
      return await handle.jsonValue();
    } finally {
      await handle.dispose();
    }
  };
  const requests = async () =>
    (await readTrace())
      .filter(
        (row) =>
          row.transport === "electron-ipc" &&
          row.command === "app_server_handle_json_lines" &&
          row.status === "success",
      )
      .flatMap((row) =>
        (row.args_preview?.request?.lines ?? []).map((line) =>
          JSON.parse(line),
        ),
      )
      .filter((request) => request.params?.path === filePath);
  const counts = async () => {
    const rows = await requests();
    return {
      read: rows.filter((row) => row.method === "fs/readFile").length,
      write: rows.filter((row) => row.method === "fs/writeFile").length,
    };
  };
  const evidence = { debounceMs: 500, manualSaveClicks: 0, stages: [] };
  const record = (row) => {
    evidence.stages.push(row);
    fs.writeFileSync(
      path.join(evidenceDir, "presentation-structure.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  };
  const action = async (name, expected) => {
    await controls.getByRole("button", { name, exact: true }).click();
    return waitState({ ...expected, idle: true });
  };
  const selectNumber = async (value, id) => {
    const number = panel.getByRole("textbox", {
      name: "幻灯片编号",
      exact: true,
    });
    await number.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText(String(value));
    await page.keyboard.press("Enter");
    await waitForPresentationSlide(page, id);
  };
  const autoSaved = async (label, expectedIds, before, verify) => {
    await waitState({ count: expectedIds.length, dirty: false, idle: true });
    const parsed = await readPackage(fs.readFileSync(filePath));
    assert.deepEqual(
      parsed.ids,
      expectedIds,
      `${label}: persisted original-package order`,
    );
    assert.notEqual(
      parsed.sha256,
      before.sha256,
      `${label}: automatic save changed real disk bytes`,
    );
    assert.equal(await panel.getAttribute("data-source-sha256"), parsed.sha256);
    const io = await counts();
    assert.ok(
      io.write > before.io.write,
      `${label}: real successful fs/writeFile through Electron IPC`,
    );
    assert.ok(
      io.read >= before.io.read + 2,
      `${label}: save verifies the original file twice through real IPC`,
    );
    if (verify) await verify(parsed);
    record({
      label,
      sha256: parsed.sha256,
      slideIds: parsed.ids,
      selectedId: (await page.evaluate(presentationStateDom)).selectedId,
      fileIoDelta: {
        read: io.read - before.io.read,
        write: io.write - before.io.write,
      },
      automaticSave: true,
      elapsedMs: Date.now() - before.startedAt,
    });
    return parsed;
  };
  const capture = async () => ({
    sha256: sha(fs.readFileSync(filePath)),
    io: await counts(),
    startedAt: Date.now(),
  });
  const initial = await readPackage(fs.readFileSync(filePath));
  assert.deepEqual(initial.ids, originalIds);
  for (let index = 0; index < 3; index++)
    assert.ok(
      initial.slides[index].text.includes(`SLIDE_PREVIEW_0${index + 1}`),
    );
  await waitForPresentationSlide(page, "512");
  assert.equal(
    await panel.locator("iframe").getAttribute("sandbox"),
    "allow-same-origin",
  );
  await controls.getByRole("button", { name: "编辑", exact: true }).click();
  const layout = controls.getByRole("combobox", {
    name: "新增版式",
    exact: true,
  });
  await layout.waitFor({ state: "visible" });
  const templatesReady = await page.waitForFunction(() => {
    const select = document.querySelector(
      '[data-testid="presentation-editing-controls"] select[aria-label="新增版式"]',
    );
    return select && !select.disabled && select.options.length === 3;
  });
  await templatesReady.dispose();
  assert.equal(await layout.inputValue(), "");
  assert.deepEqual(
    await layout
      .locator("option")
      .evaluateAll((options) => options.map((option) => option.value)),
    ["", titleLayout, blankLayout],
  );
  const beforeInherited = await capture();
  const inherited = await action("新增幻灯片", {
    count: 4,
    number: 2,
    excludeIds: originalIds,
  });
  const inheritedId = inherited.selectedId;
  let ids = ["512", inheritedId, "900", "300"];
  await autoSaved("add-inherited-title", ids, beforeInherited, (parsed) => {
    const added = parsed.slides.find((slide) => slide.id === inheritedId);
    assert.equal(added.layout, titleLayout);
    assert.equal(added.layoutType, "title");
    assert.equal(added.shapeCount, 1);
    assert.equal(added.text, "");
    assert.notEqual(
      added.xmlSha256,
      initial.slides[0].xmlSha256,
      "new page is not a disguised copy",
    );
  });
  // Playwright 的标准 select 动作触发控件 input/change；不依赖系统弹出菜单接收合成按键。
  assert.deepEqual(await layout.selectOption(blankLayout), [blankLayout]);
  assert.equal(await layout.inputValue(), blankLayout);
  const beforeBlank = await capture();
  const blank = await action("新增幻灯片", {
    count: 5,
    number: 3,
    excludeIds: ids,
  });
  const blankId = blank.selectedId;
  ids = ["512", inheritedId, blankId, "900", "300"];
  await autoSaved("add-explicit-blank", ids, beforeBlank, (parsed) => {
    const added = parsed.slides.find((slide) => slide.id === blankId);
    assert.equal(added.layout, blankLayout);
    assert.equal(added.layoutType, "blank");
    assert.equal(added.shapeCount, 0);
    assert.equal(added.text, "");
  });
  await selectNumber(1, "512");
  const beforeCopy = await capture();
  const copy = await action("复制幻灯片", {
    count: 6,
    number: 2,
    excludeIds: ids,
  });
  const copyId = copy.selectedId;
  assert.ok(copy.text.includes("SLIDE_PREVIEW_01"));
  ids = ["512", copyId, inheritedId, blankId, "900", "300"];
  await autoSaved("duplicate-slide", ids, beforeCopy, (parsed) => {
    const copied = parsed.slides.find((slide) => slide.id === copyId);
    assert.equal(copied.xmlSha256, initial.slides[0].xmlSha256);
    assert.equal(copied.layout, titleLayout);
    assert.ok(copied.text.includes("SLIDE_PREVIEW_01"));
  });
  // 每次真实落盘后再操作历史，验证自动保存不会清空撤销栈。
  let beforeMove = await capture();
  await action("前移幻灯片", { count: 6, number: 1, selectedId: copyId });
  const movedIds = [copyId, "512", inheritedId, blankId, "900", "300"];
  await autoSaved("move-earlier", movedIds, beforeMove);
  beforeMove = await capture();
  await action("撤销", { count: 6, number: 2, selectedId: copyId });
  await autoSaved("undo-after-automatic-save", ids, beforeMove);
  beforeMove = await capture();
  await action("重做", { count: 6, number: 1, selectedId: copyId });
  await autoSaved("redo-after-automatic-save", movedIds, beforeMove);
  beforeMove = await capture();
  await action("后移幻灯片", { count: 6, number: 2, selectedId: copyId });
  await autoSaved("move-later", ids, beforeMove);
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-structure-six-slides.png"),
  });
  const beforeRemove = await capture();
  await action("删除幻灯片", { count: 5, number: 2, selectedId: inheritedId });
  await action("删除幻灯片", { count: 4, number: 2, selectedId: blankId });
  await action("删除幻灯片", { count: 3, number: 2, selectedId: "900" });
  const restored = await autoSaved(
    "delete-created-restore-original-order",
    originalIds,
    beforeRemove,
    (parsed) => {
      for (let index = 0; index < 3; index++)
        assert.equal(
          parsed.slides[index].xmlSha256,
          initial.slides[index].xmlSha256,
          `original slide ${originalIds[index]} remains byte-for-byte unchanged`,
        );
    },
  );
  await selectNumber(1, "512");
  await controls.getByRole("button", { name: "结束编辑", exact: true }).click();
  const previous = await panel.elementHandle(),
    beforeReopen = await counts();
  assert.ok(previous);
  await replaceFileTab(page, filePath);
  await waitForArtifactFileRead(
    async () => (await counts()).read,
    beforeReopen.read,
  );
  const panelReplaced = !(await previous.evaluate((node) => node.isConnected));
  await previous.dispose();
  await waitForPresentationSlide(page, "512");
  const reopenedState = await waitState({
    count: 3,
    selectedId: "512",
    number: 1,
    dirty: false,
  });
  assert.equal(reopenedState.sourceSha256, restored.sha256);
  assert.ok(reopenedState.text.includes("SLIDE_PREVIEW_01"));
  const afterReopen = await counts();
  assert.ok(
    afterReopen.read > beforeReopen.read,
    "reopening reads original disk bytes through real IPC",
  );
  assert.deepEqual(
    (await readPackage(fs.readFileSync(filePath))).ids,
    originalIds,
  );
  assert.equal(await frame.count("script,iframe,a[href],[onclick]"), 0);
  assert.equal(
    await panel.locator("iframe").getAttribute("sandbox"),
    "allow-same-origin",
  );
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-structure-restored.png"),
  });
  evidence.reopen = {
    sourceReads: afterReopen.read - beforeReopen.read,
    panelReplaced,
    sha256: restored.sha256,
    selectedSlideId: "512",
    slideIds: originalIds,
  };
  evidence.restoredOriginalSlides = true;
  evidence.scriptsAllowed = false;
  fs.writeFileSync(
    path.join(evidenceDir, "presentation-structure.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  return evidence;
}
