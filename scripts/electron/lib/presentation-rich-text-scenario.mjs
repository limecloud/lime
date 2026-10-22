import { replaceFileTab } from "./thread-side-panel-navigation.mjs";
import { withNativeClipboard } from "./native-clipboard.mjs";
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
import {
  assertPresentationRichTextCommit,
  assertPresentationRichParagraphDom,
  assertPresentationRichTextFixture,
  assertPresentationRichTextSave,
  readPresentationRichTextFile,
  richDigest,
  richEditedText,
  richOriginalText,
  richParagraphOriginalText,
  richParagraphShapeId,
  richPasteHtml,
  richPastePlain,
  richPastedText,
} from "./presentation-rich-text-scenario-oracle.mjs";

export {
  writePresentationRichTextFixture,
  readPresentationRichTextFile,
  assertPresentationRichTextFixture,
  assertPresentationRichTextSave,
  assertPresentationRichTextCommit,
} from "./presentation-rich-text-scenario-oracle.mjs";

const timeout = 15_000;
const editorSelector = "[data-presentation-text-editor]";

/** 真实 HTML 粘贴；原始系统剪贴板由共享 owner 在内存中保全并精确恢复。 */
export async function withPresentationRichTextClipboard(app, perform, options) {
  return withNativeClipboard(
    app,
    async () => {
      const controlled = await app.evaluate(
        ({ clipboard }, input) => {
          clipboard.write({ text: input.plain, html: input.html });
          return (
            clipboard.readText() === input.plain &&
            clipboard.readHTML().includes("HTML_BOLD") &&
            clipboard.readHTML().includes("example.invalid/rich-paste")
          );
        },
        { plain: richPastePlain, html: richPasteHtml },
      );
      assert.equal(
        controlled,
        true,
        "native clipboard HTML/plain roundtrip failed; no synthetic paste fallback",
      );
      return perform();
    },
    options,
  );
}

/** 父文档只读同源DOM/原生Selection；不向受限iframe注入脚本、监听器或状态。 */
function richTextDom(expected = {}) {
  const panel = document.querySelector('[data-testid="presentation-panel"]'),
    controls = panel?.querySelector(
      '[data-testid="presentation-editing-controls"]',
    ),
    content = panel?.querySelector("iframe")?.contentDocument,
    slide = content?.querySelector('[data-slide-id="512"]'),
    editor = content?.querySelector("[data-presentation-text-editor]");
  const readStyle = (style) => ({
    display: style.display,
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    marginTop: style.marginTop,
    marginBottom: style.marginBottom,
    listStyleType: style.listStyleType,
    listStylePosition: style.listStylePosition,
    counterSet: style.getPropertyValue("counter-set"),
  });
  const paragraphs = Array.from(
    editor?.querySelectorAll("[data-text-paragraph]") ?? [],
    (paragraph) => ({
      index: Number(paragraph.getAttribute("data-text-paragraph")),
      inlineStyle: readStyle(paragraph.style),
      computedStyle: readStyle(content.defaultView.getComputedStyle(paragraph)),
      runs: Array.from(
        paragraph.querySelectorAll("[data-text-run]"),
        (run) => ({
          index: Number(run.getAttribute("data-text-run")),
          text: run.localName === "br" ? "\n" : (run.textContent ?? ""),
          bold: run.style.fontWeight === "bold",
          italic: run.style.fontStyle === "italic",
          color: run.style.color,
        }),
      ),
    }),
  );
  const selection = content?.getSelection();
  const point = (node, offset) => {
    if (!editor || !node || !editor.contains(node)) return null;
    const element = node.nodeType === 1 ? node : node.parentElement,
      run = element?.closest("[data-text-run]"),
      paragraph = element?.closest("[data-text-paragraph]");
    if (!paragraph) return null;
    const paraIndex = Number(paragraph.getAttribute("data-text-paragraph"));
    let runIndex, charIndex;
    if (run) {
      runIndex = Number(run.getAttribute("data-text-run"));
      charIndex =
        node.nodeType === 3
          ? offset
          : offset > 0
            ? (run.textContent ?? "").length
            : 0;
    } else {
      const child = paragraph.childNodes[offset] ?? paragraph.lastChild;
      if (!child?.getAttribute) return null;
      runIndex = Number(child.getAttribute("data-text-run"));
      charIndex =
        offset < paragraph.childNodes.length
          ? 0
          : child.localName === "br"
            ? 1
            : (child.textContent ?? "").length;
    }
    const current = paragraphs.find((item) => item.index === paraIndex);
    const absolute =
      paragraphs
        .filter((item) => item.index < paraIndex)
        .reduce(
          (sum, item) =>
            sum +
            item.runs.reduce((length, item) => length + item.text.length, 0) +
            1,
          0,
        ) +
      current.runs
        .filter((item) => item.index < runIndex)
        .reduce((sum, item) => sum + item.text.length, 0) +
      charIndex;
    return { paraIndex, runIndex, charIndex, offset: absolute };
  };
  const state = {
    ready: panel?.getAttribute("data-status") === "ready" && !!slide,
    sha256: panel?.getAttribute("data-source-sha256"),
    dirty: controls?.getAttribute("data-dirty") === "true",
    saving: controls?.getAttribute("data-saving") === "true",
    active: !!editor,
    focused: !!editor && content.activeElement === editor,
    text: paragraphs
      .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
      .join("\n"),
    paragraphs,
    editorTextContent: editor?.textContent ?? "",
    editorChildCount: editor?.childElementCount ?? 0,
    markerMarkupCount:
      editor?.querySelectorAll("li,ol,ul,style,[contenteditable=false]")
        .length ?? 0,
    selectedPlainText: selection?.toString() ?? "",
    anchor: point(selection?.anchorNode, selection?.anchorOffset),
    caret: point(selection?.focusNode, selection?.focusOffset),
    visibleText: slide?.textContent ?? "",
  };
  if (!Object.keys(expected).length) return state;
  if (!state.ready || state.saving) return false;
  for (const key of [
    "active",
    "focused",
    "dirty",
    "sha256",
    "text",
    "selectedPlainText",
  ])
    if (expected[key] !== undefined && state[key] !== expected[key])
      return false;
  if (expected.changedFrom && state.sha256 === expected.changedFrom)
    return false;
  if (
    expected.selection &&
    (state.anchor?.offset !== expected.selection[0] ||
      state.caret?.offset !== expected.selection[1])
  )
    return false;
  if (
    expected.runStyle &&
    !paragraphs.some((paragraph) =>
      paragraph.runs.some(
        (run) =>
          run.text === expected.runStyle.text &&
          Object.entries(expected.runStyle).every(
            ([key, value]) => run[key] === value,
          ),
      ),
    )
  )
    return false;
  return state;
}

export async function runPresentationRichTextScenario({
  app,
  page,
  evidenceDir,
  filePath,
  readTrace,
}) {
  assert.equal(typeof readTrace, "function");
  const panel = page.getByTestId("presentation-panel"),
    controls = panel.getByTestId("presentation-editing-controls"),
    frame = createArtifactFrameDriver(page, presentationFrameSelector);
  const original = await readPresentationRichTextFile(filePath);
  assertPresentationRichTextFixture(original);
  const io = async () => presentationNavigationIo(await readTrace(), filePath);
  const turns = async () =>
    (await readTrace())
      .flatMap((row) => row.args_preview?.request?.lines ?? [])
      .filter((line) => JSON.parse(line).method === "turn/start").length;
  const initialTurns = await turns(),
    evidence = {
      initialSha256: original.sha256,
      manualSaveClicks: 0,
      inputTransport:
        "real CDP mouse + Playwright keyboard; native Electron clipboard HTML; read-only parent DOM observation",
      fixture: {
        shapeId: "3",
        tableId: "7",
        cell: "0:0",
        paragraphShapeId: richParagraphShapeId,
      },
      stages: [],
    };
  const record = () =>
    fs.writeFileSync(
      path.join(evidenceDir, "presentation-rich-text.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  const waitState = async (expected) => {
    const handle = await page.waitForFunction(richTextDom, expected, {
      timeout,
    });
    try {
      return await handle.jsonValue();
    } finally {
      await handle.dispose();
    }
  };
  const capture = async () => ({
    sha256: richDigest(fs.readFileSync(filePath)),
    io: await io(),
  });
  const quiet = async (label, before, expectedText) => {
    // 650ms只验证负向条件；完成态始终等公开投影与磁盘/IPC，不靠时间猜测。
    await page.waitForTimeout(650);
    const state = await waitState({
      active: true,
      dirty: true,
      text: expectedText,
    });
    assert.equal(
      richDigest(fs.readFileSync(filePath)),
      before.sha256,
      `${label}: active draft never writes disk`,
    );
    assert.equal(
      (await io()).write,
      before.io.write,
      `${label}: active editor has zero delayed writes`,
    );
    assert.equal(await turns(), initialTurns);
    evidence.stages.push({
      name: label,
      sourceSha256: before.sha256,
      activeEditor: true,
      zeroSourceWrites: true,
      text: state.text,
      anchor: state.anchor,
      caret: state.caret,
    });
    record();
  };
  const saved = async (name, before, expected) => {
    const state = await waitState({
      changedFrom: before.sha256,
      active: false,
      dirty: false,
    });
    const disk = await readPresentationRichTextFile(filePath),
      preserved = assertPresentationRichTextSave(original, disk, expected);
    assert.equal(
      state.sha256,
      disk.sha256,
      `${name}: visible source identity matches persisted bytes`,
    );
    const delta = assertPresentationRichTextCommit(before.io, await io(), name);
    assert.equal(
      await turns(),
      initialTurns,
      `${name}: local edits create no turn`,
    );
    evidence.stages.push({
      name,
      sha256: disk.sha256,
      fileIoDelta: delta,
      ...preserved,
      expected,
      automaticSave: true,
    });
    record();
    return disk;
  };
  const startKey =
      process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home",
    endKey = process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End";
  const press = async (key, count) => {
    for (let index = 0; index < count; index++) await page.keyboard.press(key);
  };
  const atStart = async () => {
    await frame.click(editorSelector);
    await page.keyboard.press(startKey);
    await waitState({ active: true, focused: true, selection: [0, 0] });
  };
  const activateShape = async () => {
    await frame.click('[data-presentation-element-id="3"]');
    await controls
      .locator("[data-presentation-text-controls]")
      .getByRole("button", { name: "编辑文字", exact: true })
      .click();
    await waitState({ active: true, focused: true, text: richOriginalText });
  };
  const history = async (name, expected) => {
    const before = await capture();
    await controls.getByRole("button", { name, exact: true }).click();
    return saved(`single-${name}-after-save`, before, expected);
  };
  await waitForPresentationSlide(page, "512");
  await waitState({ active: false, dirty: false, sha256: original.sha256 });
  await controls.getByRole("button", { name: "编辑", exact: true }).click();
  const paragraphBefore = await capture();
  await frame.click(`[data-presentation-element-id="${richParagraphShapeId}"]`);
  await controls
    .locator("[data-presentation-text-controls]")
    .getByRole("button", { name: "编辑文字", exact: true })
    .click();
  await waitState({
    active: true,
    focused: true,
    text: richParagraphOriginalText,
  });
  await atStart();
  await press("Shift+ArrowRight", 9);
  const paragraphState = await waitState({
    active: true,
    focused: true,
    selectedPlainText: richParagraphOriginalText,
    selection: [0, 9],
  });
  const paragraphStyles = assertPresentationRichParagraphDom(paragraphState);
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-rich-text-paragraph-css.png"),
  });
  await page.keyboard.insertText("CANCELLED_PARAGRAPH_PROBE");
  await quiet(
    "native-paragraph-style-probe-draft",
    paragraphBefore,
    "CANCELLED_PARAGRAPH_PROBE",
  );
  await page.keyboard.press("Escape");
  await waitState({ active: false, dirty: false, sha256: original.sha256 });
  assert.equal(richDigest(fs.readFileSync(filePath)), original.sha256);
  assert.deepEqual(
    await io(),
    paragraphBefore.io,
    "Escape-cancelled paragraph probe has zero source IO",
  );
  assertPresentationRichTextSave(
    original,
    await readPresentationRichTextFile(filePath),
    { shape: "original", cell: "original" },
  );
  evidence.paragraphStyles = {
    ...paragraphStyles,
    cancelled: true,
    zeroSourceIO: true,
    originalPackageUnchanged: true,
  };
  record();
  const shapeBefore = await capture();
  await activateShape();
  await page.keyboard.press(endKey);
  await page.keyboard.insertText(" WordTest");
  await waitState({ active: true, text: `${richOriginalText} WordTest` });
  await page.keyboard.press(
    process.platform === "darwin" ? "Alt+Backspace" : "Control+Backspace",
  );
  await waitState({ active: true, text: `${richOriginalText} ` });
  const deletedLine = process.platform === "darwin";
  if (deletedLine) await page.keyboard.press("Meta+Backspace");
  await quiet(
    "native-word-and-line-delete-draft",
    shapeBefore,
    deletedLine ? richOriginalText.slice(0, -5) : `${richOriginalText} `,
  );
  await page.keyboard.press("Escape");
  await waitState({ active: false, dirty: false, sha256: original.sha256 });
  assert.equal(richDigest(fs.readFileSync(filePath)), original.sha256);
  assert.deepEqual(
    await io(),
    shapeBefore.io,
    "cancelled native deletion has no source IO",
  );
  await activateShape();
  await atStart();
  await press("ArrowRight", 6);
  await press("Shift+ArrowRight", 3);
  const selected = await waitState({
    active: true,
    selectedPlainText: "中😀文",
    selection: [6, 10],
  });
  evidence.nativeSelection = {
    text: selected.selectedPlainText,
    anchor: selected.anchor,
    caret: selected.caret,
  };
  const textControls = controls.locator("[data-presentation-text-controls]");
  await textControls.getByRole("button", { name: "加粗", exact: true }).click();
  await waitState({ active: true, runStyle: { text: "中😀文", bold: true } });
  await textControls.getByLabel("文字颜色", { exact: true }).fill("#9b2c2c");
  await waitState({
    active: true,
    runStyle: { text: "中😀文", bold: true, color: "rgb(155, 44, 44)" },
  });
  await atStart();
  await press("Shift+ArrowRight", 5);
  await waitState({ selectedPlainText: "Alpha", selection: [0, 5] });
  await page.keyboard.insertText("Lime");
  await waitState({ text: richOriginalText.replace("Alpha", "Lime") });
  await atStart();
  await press("ArrowRight", 7);
  await waitState({ selectedPlainText: "", selection: [8, 8] });
  await page.keyboard.press("Backspace");
  await waitState({ text: "Lime 中文\ntail\nSecond 👩‍💻IME\nThird" });
  await page.keyboard.press(endKey);
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("Hard");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.insertText("Soft");
  await quiet(
    "shape-active-editor-beyond-autosave-window",
    shapeBefore,
    richEditedText,
  );
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-rich-text-shape-draft.png"),
  });
  await page.keyboard.press("ControlOrMeta+Enter");
  await saved("commit-entire-shape-draft-once", shapeBefore, {
    shape: "edited",
    cell: "original",
  });
  await history("撤销", { shape: "original", cell: "original" });
  await history("重做", { shape: "edited", cell: "original" });
  await frame.click('[data-presentation-element-id="7"]');
  await frame.click(
    '[data-presentation-table-id="7"] [data-presentation-cell="0:0"]',
  );
  await panel
    .getByTestId("presentation-table-controls")
    .getByRole("button", { name: "编辑文字", exact: true })
    .click();
  await waitState({ active: true, focused: true, text: richOriginalText });
  const cellBefore = await capture();
  await page.keyboard.press(endKey);
  await page.keyboard.press("Enter");
  await withPresentationRichTextClipboard(app, async () => {
    await page.keyboard.press("ControlOrMeta+V");
    await waitState({ active: true, text: richPastedText });
  });
  evidence.clipboard = {
    nativeHtmlPaste: true,
    restored: true,
    syntheticPasteFallback: false,
    userContentInEvidence: false,
  };
  await quiet(
    "cell-native-html-paste-beyond-autosave-window",
    cellBefore,
    richPastedText,
  );
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-rich-text-cell-draft.png"),
  });
  await page.keyboard.press("ControlOrMeta+Enter");
  await saved("commit-cell-html-and-new-link-once", cellBefore, {
    shape: "edited",
    cell: "pasted",
  });
  await history("撤销", { shape: "edited", cell: "original" });
  const final = await history("重做", { shape: "edited", cell: "pasted" });
  await controls.getByRole("button", { name: "结束编辑", exact: true }).click();
  const beforeReopen = await io();
  await replaceFileTab(page, filePath);
  await waitForArtifactFileRead(
    async () => (await io()).read,
    beforeReopen.read,
    timeout,
  );
  const reopened = await waitState({
    active: false,
    dirty: false,
    sha256: final.sha256,
  });
  assertPresentationRichTextSave(
    original,
    await readPresentationRichTextFile(filePath),
    { shape: "edited", cell: "pasted" },
  );
  for (const text of [
    "Lime ",
    "中文",
    "Hard",
    "Soft",
    "HTML_BOLD",
    "HTML_ITALIC",
    "HTML_LIST",
    "HTML_LINK",
  ])
    assert.ok(
      reopened.visibleText.includes(text),
      `reopened real renderer displays ${text}`,
    );
  await page.waitForTimeout(650);
  const afterReopen = await io();
  assert.equal(
    afterReopen.write,
    beforeReopen.write,
    "same-path clean reopen creates zero delayed writes",
  );
  assert.equal(await turns(), initialTurns);
  assert.equal(
    await panel.locator("iframe").getAttribute("sandbox"),
    "allow-same-origin",
  );
  assert.equal(await frame.count("script,iframe,a[href],[onclick]"), 0);
  evidence.reopen = {
    sha256: final.sha256,
    sourceReads: afterReopen.read - beforeReopen.read,
    zeroDelayedWrites: true,
  };
  evidence.undoRedoAcrossSave = true;
  evidence.additionalTurns = 0;
  evidence.scriptsAllowed = false;
  evidence.colorInputAutomation =
    "Locator.fill(input[type=color]) native input/change; operating system color picker not exercised";
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-rich-text-reopened.png"),
  });
  record();
  return evidence;
}
