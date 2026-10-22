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
import { presentationTextEditorMatches } from "./presentation-text-editor-dom.mjs";
import { openFileTab } from "./thread-side-panel-navigation.mjs";
import {
  observeNativeSaveDialogs,
  captureNativeSaveDialog,
} from "./native-save-dialog-observer.mjs";

const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
const timeout = 15_000;
const originalIds = ["512", "900", "300"];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** 只解析本场景要核对的源包 identity、文字与逐 part 摘要，不启动渲染器。 */
export async function readPresentationNavigationFile(filePath) {
  const bytes = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const xml = async (part) => {
    const entry = zip.file(part);
    assert.ok(entry, `PPTX part exists: ${part}`);
    const dom = new JSDOM(await entry.async("string"), {
      contentType: "application/xml",
    });
    try {
      return dom.window.document.cloneNode(true);
    } finally {
      dom.window.close();
    }
  };
  const presentation = await xml("ppt/presentation.xml");
  const relationships = await xml("ppt/_rels/presentation.xml.rels");
  assert.equal(presentation.documentElement.namespaceURI, p);
  assert.equal(relationships.documentElement.namespaceURI, rel);
  const targets = new Map(
    Array.from(relationships.getElementsByTagNameNS(rel, "Relationship"))
      .filter((node) => node.getAttribute("Type") === `${r}/slide`)
      .map((node) => {
        assert.notEqual(node.getAttribute("TargetMode"), "External");
        const target = node.getAttribute("Target");
        assert.ok(target && !target.startsWith("/") && !target.includes("\\"));
        const part = path.posix.normalize(path.posix.join("ppt", target));
        assert.ok(part.startsWith("ppt/"), "slide relation stays inside PPTX");
        return [node.getAttribute("Id"), part];
      }),
  );
  const parts = {};
  for (const [name, entry] of Object.entries(zip.files))
    if (!entry.dir) parts[name] = digest(await entry.async("uint8array"));
  const slides = [];
  for (const node of presentation.getElementsByTagNameNS(p, "sldId")) {
    const id = node.getAttribute("id");
    assert.match(id, /^\d+$/);
    const part = targets.get(node.getAttributeNS(r, "id"));
    assert.ok(part, `slide ${id} has an internal relationship`);
    const document = await xml(part);
    assert.equal(document.documentElement.namespaceURI, p);
    slides.push({
      id,
      part,
      text: Array.from(
        document.getElementsByTagNameNS(a, "t"),
        (text) => text.textContent,
      ).join("\n"),
      xmlSha256: parts[part],
    });
  }
  assert.ok(slides.length > 0, "presentation contains slides");
  assert.equal(new Set(slides.map((slide) => slide.id)).size, slides.length);
  assert.equal(new Set(slides.map((slide) => slide.part)).size, slides.length);
  return { sha256: digest(bytes), parts, slides };
}

/** 文字修改只允许改选定页；其他 ZIP part 和三页 identity 均保留。 */
export function assertPresentationNavigationSave(before, after, value) {
  assert.deepEqual(
    after.slides.map((slide) => slide.id),
    originalIds,
  );
  assert.deepEqual(
    after.slides.map((slide) => [slide.id, slide.part]),
    before.slides.map((slide) => [slide.id, slide.part]),
  );
  const edited = after.slides.find((slide) => slide.id === "512");
  assert.equal(
    edited.text,
    value,
    "saved source contains the full editor value",
  );
  assert.notEqual(
    after.sha256,
    before.sha256,
    "navigation saves changed bytes",
  );
  assert.notEqual(edited.xmlSha256, before.parts[edited.part]);
  assert.deepEqual(
    Object.keys(after.parts).sort(),
    Object.keys(before.parts).sort(),
  );
  let preservedParts = 0;
  for (const [part, sha256] of Object.entries(before.parts)) {
    if (part === edited.part) continue;
    assert.equal(
      after.parts[part],
      sha256,
      `unedited part is unchanged: ${part}`,
    );
    preservedParts++;
  }
  return preservedParts;
}

export function presentationNavigationIo(trace, filePath) {
  const counts = { read: 0, write: 0 };
  for (const row of trace) {
    if (
      row.transport !== "electron-ipc" ||
      row.command !== "app_server_handle_json_lines" ||
      row.status !== "success"
    )
      continue;
    for (const line of row.args_preview?.request?.lines ?? []) {
      const request = JSON.parse(line);
      if (request.params?.path !== filePath) continue;
      if (request.method === "fs/readFile") counts.read++;
      if (request.method === "fs/writeFile") counts.write++;
    }
  }
  return counts;
}

/** current Files 的标签身份、保存门禁与真实原生保存副本。 */
export async function runPresentationNavigationScenario({
  app,
  page,
  evidenceDir,
  filePath,
  readTrace,
}) {
  const panel = page.getByTestId("presentation-panel");
  const controls = panel.getByTestId("presentation-editing-controls");
  const toggle = page.getByTestId("thread-side-panel-toggle");
  const frame = createArtifactFrameDriver(page, presentationFrameSelector);
  const counts = async () =>
    presentationNavigationIo(await readTrace(), filePath);
  const copyRequests = async () =>
    (await readTrace()).flatMap((row) => {
      if (
        row.transport !== "electron-ipc" ||
        row.command !== "app_server_handle_json_lines" ||
        row.status !== "success"
      )
        return [];
      return (row.args_preview?.request?.lines ?? [])
        .map((line) => JSON.parse(line))
        .filter(
          (request) =>
            request.method === "fs/copy" &&
            request.params?.sourcePath === filePath,
        );
    });
  const selectedTab = () =>
    page.locator(
      '[data-testid="workspace-right-surface-tab-files"][aria-selected="true"]',
    );
  const closeSelected = () =>
    selectedTab()
      .locator("..")
      .getByTestId("workspace-right-surface-tab-close")
      .click();
  const waitReady = async (sha256, value) => {
    await waitForPresentationSlide(page, "512");
    const state = await page.waitForFunction(
      ({ sha256, value }) => {
        const panel = document.querySelector(
          '[data-testid="presentation-panel"]',
        );
        const controls = panel?.querySelector(
          '[data-testid="presentation-editing-controls"]',
        );
        const slide = panel
          ?.querySelector("iframe")
          ?.contentDocument?.querySelector('[data-slide-id="512"]');
        return (
          panel?.getAttribute("data-source-sha256") === sha256 &&
          controls?.getAttribute("data-dirty") === "false" &&
          controls.getAttribute("data-saving") === "false" &&
          slide?.textContent?.includes(value)
        );
      },
      { sha256, value },
      { timeout },
    );
    await state.dispose();
  };
  const editActive = async (value) => {
    const before = await readPresentationNavigationFile(filePath);
    const beforeIo = await counts();
    const edit = controls.getByRole("button", { name: "编辑", exact: true });
    if (await edit.isVisible()) await edit.click();
    await frame.click('[data-presentation-element-id="2"]');
    await controls
      .getByRole("button", { name: "编辑文字", exact: true })
      .click();
    await frame.click("[data-presentation-text-editor]");
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText(value);
    const active = await page.waitForFunction(
      presentationTextEditorMatches,
      {
        selector: presentationFrameSelector,
        value,
        uncommittedSlideId: "512",
      },
      { timeout },
    );
    await active.dispose();
    assert.equal(await controls.getAttribute("data-dirty"), "true");
    assert.equal(await controls.getAttribute("data-saving"), "false");
    assert.equal(digest(fs.readFileSync(filePath)), before.sha256);
    assert.deepEqual(
      await counts(),
      beforeIo,
      "active editor performs no file IO",
    );
    return { before, beforeIo };
  };
  const savedAfter = async (captured, value) => {
    const saved = await readPresentationNavigationFile(filePath);
    const preservedParts = assertPresentationNavigationSave(
      captured.before,
      saved,
      value,
    );
    const afterIo = await counts();
    const delta = {
      read: afterIo.read - captured.beforeIo.read,
      write: afterIo.write - captured.beforeIo.write,
    };
    assert.ok(
      delta.read >= 2,
      "save verifies the source revision through real IPC",
    );
    assert.equal(delta.write, 1, "one source save belongs to this edit");
    return {
      saved,
      evidence: {
        activeTextSaved: true,
        sha256: saved.sha256,
        preservedParts,
        fileIoDelta: delta,
      },
    };
  };
  const open = async (saved, value) => {
    const before = await counts();
    await openFileTab(page, filePath);
    await waitReady(saved.sha256, value);
    const after = await counts();
    assert.ok(
      after.read > before.read,
      "closed content performs fresh source reads",
    );
    assert.equal(after.write, before.write, "reopen adds no write");
    return { sourceReads: after.read - before.read, sha256: saved.sha256 };
  };
  const initial = await readPresentationNavigationFile(filePath);
  assert.deepEqual(
    initial.slides.map((slide) => slide.id),
    originalIds,
  );
  const originalText = initial.slides[0].text;
  assert.ok(originalText.includes("SLIDE_PREVIEW_01"));
  await waitReady(initial.sha256, originalText);
  const evidence = { initialSha256: initial.sha256, slideIds: originalIds };

  let value = "PPTX_FILE_CLOSE_中文 <&>";
  let captured = await editActive(value);
  const closedTabId = await selectedTab().getAttribute("id");
  const closedPanel = await panel.elementHandle();
  await closeSelected();
  await page
    .locator(`[id="${closedTabId}"]`)
    .waitFor({ state: "detached", timeout });
  let result = await savedAfter(captured, value);
  evidence.close = {
    ...result.evidence,
    reopen: await open(result.saved, value),
  };
  assert.equal(await closedPanel.evaluate((node) => node.isConnected), false);
  await closedPanel.dispose();

  value = "PPTX_FILE_REUSED_DRAFT_中文 <&>";
  captured = await editActive(value);
  const content = await panel.elementHandle();
  const sourceTabId = await selectedTab().getAttribute("id");
  const assertDraftPreserved = async () => {
    assert.equal(await content.evaluate((node) => node.isConnected), true);
    assert.equal(await selectedTab().getAttribute("id"), sourceTabId);
    assert.equal(await controls.getAttribute("data-dirty"), "true");
    assert.equal(await controls.getAttribute("data-saving"), "false");
    assert.ok((await frame.text('[data-slide-id="512"]')).includes(value));
    assert.equal(digest(fs.readFileSync(filePath)), captured.before.sha256);
    assert.deepEqual(
      await counts(),
      captured.beforeIo,
      "display-only navigation has no source read/write",
    );
  };
  await toggle.click();
  await panel.waitFor({ state: "hidden", timeout });
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  assert.equal(await content.evaluate((node) => node.isConnected), true);
  await toggle.click();
  await panel.waitFor({ state: "visible", timeout });
  await assertDraftPreserved();
  evidence.hide = {
    sameContentInstance: true,
    draftPreserved: true,
    sourceIoDelta: { read: 0, write: 0 },
  };

  const tree = page
    .getByTestId("workspace-right-surface-active-pane")
    .getByTestId("workspace-file-tree");
  await tree.getByRole("textbox").fill(path.basename(filePath));
  await tree.getByTitle(filePath, { exact: true }).dblclick();
  // 文件树接管焦点会提交活动编辑，current Office 自动保存可随后正常完成。
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="presentation-editing-controls"]')
        ?.getAttribute("data-dirty") === "false",
    undefined,
    { timeout },
  );
  assert.equal(await content.evaluate((node) => node.isConnected), true);
  assert.equal(await selectedTab().getAttribute("id"), sourceTabId);
  result = await savedAfter(captured, value);
  await waitReady(result.saved.sha256, value);
  evidence.samePath = {
    ...result.evidence,
    sameContentInstance: true,
    fullContentPreserved: true,
    saveOwner: "current controller autosave after editor blur",
  };

  await page.getByTestId("workspace-right-surface-new-tab").click();
  await page.getByTestId("side-panel-new-tab-open-file").click();
  const emptyTabId = await selectedTab().getAttribute("id");
  assert.notEqual(emptyTabId, sourceTabId);
  assert.equal(await content.evaluate((node) => node.isConnected), true);
  await page.locator(`[id="${sourceTabId}"]`).click();
  await waitReady(result.saved.sha256, value);
  assert.equal(await content.evaluate((node) => node.isConnected), true);
  await page
    .locator(`[id="${emptyTabId}"]`)
    .locator("..")
    .getByTestId("workspace-right-surface-tab-close")
    .click();
  await waitReady(result.saved.sha256, value);
  assert.equal(await content.evaluate((node) => node.isConnected), true);
  evidence.newFileTab = {
    sourceTabId,
    emptyTabId,
    sameContentInstance: true,
    fullContentPreserved: true,
  };
  assert.deepEqual(
    await counts(),
    {
      read: captured.beforeIo.read + result.evidence.fileIoDelta.read,
      write: captured.beforeIo.write + result.evidence.fileIoDelta.write,
    },
    "new and background tabs add no source IO",
  );
  await content.dispose();
  value = "PPTX_NATIVE_SAVE_ACTIVE_中文 <&>";
  captured = await editActive(value);

  const observer = await observeNativeSaveDialogs(app);
  try {
    const download = () =>
      page
        .getByTestId("workspace-right-surface-active-pane")
        .getByRole("button", { name: "下载文件", exact: true });
    const destination = path.resolve(
      evidenceDir,
      "presentation-save-copy.pptx",
    );
    assert.equal(fs.existsSync(destination), false);
    const beforeCopy = (await copyRequests()).length;
    const nativeSave = await captureNativeSaveDialog(
      {
        observer,
        evidenceDir,
        label: "copy",
        sourcePath: filePath,
        destination,
        onPending: async () => {
          const saved = await readPresentationNavigationFile(filePath);
          assertPresentationNavigationSave(captured.before, saved, value);
          assert.equal(await controls.getAttribute("data-dirty"), "false");
          assert.equal(await download().getAttribute("aria-busy"), "true");
          assert.equal(await download().isDisabled(), true);
          assert.equal(
            (await copyRequests()).length,
            beforeCopy,
            "no copy before actual destination selection",
          );
          return {
            sha256: saved.sha256,
            fullText: saved.slides[0].text,
            io: await counts(),
          };
        },
      },
      () => download().click(),
    );
    await waitForArtifactFileRead(
      async () => Number(fs.existsSync(destination)),
      0,
      timeout,
    );
    await waitForArtifactFileRead(
      async () => (await copyRequests()).length,
      beforeCopy,
      timeout,
    );
    result = await savedAfter(captured, value);
    const copied = await readPresentationNavigationFile(destination);
    assertPresentationNavigationSave(captured.before, copied, value);
    assert.deepEqual(fs.readFileSync(destination), fs.readFileSync(filePath));
    const copies = await copyRequests();
    assert.equal(copies.length, beforeCopy + 1);
    assert.equal(copies.at(-1).params.destinationPath, destination);
    assert.equal(copies.at(-1).params.recursive, false);
    evidence.saveCopy = {
      ...result.evidence,
      nativeSave,
      destination,
      copiedSha256: copied.sha256,
      sourceBytesIdentical: true,
      actualCopyRpc: copies.at(-1),
    };
    await waitReady(result.saved.sha256, value);

    value = "PPTX_SAVE_COPY_CANCEL_中文 <&>";
    captured = await editActive(value);
    const beforeCancel = (await copyRequests()).length;
    const nativeCancel = await captureNativeSaveDialog(
      {
        observer,
        evidenceDir,
        label: "cancel",
        sourcePath: filePath,
        destination: null,
        onPending: async () => {
          const saved = await readPresentationNavigationFile(filePath);
          assertPresentationNavigationSave(captured.before, saved, value);
          assert.equal((await copyRequests()).length, beforeCancel);
          return { sha256: saved.sha256, fullText: saved.slides[0].text };
        },
      },
      () => download().click(),
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector(
            '[data-testid="workspace-right-surface-active-pane"] button[aria-label="下载文件"]',
          )
          ?.getAttribute("aria-busy") === "false",
      undefined,
      { timeout },
    );
    result = await savedAfter(captured, value);
    assert.equal(
      (await copyRequests()).length,
      beforeCancel,
      "native cancellation copies nothing",
    );
    assert.equal(
      digest(fs.readFileSync(destination)),
      copied.sha256,
      "cancel does not overwrite prior export",
    );
    evidence.cancel = { ...result.evidence, nativeCancel, copyRpcDelta: 0 };

    captured = await editActive(originalText);
    await controls.getByRole("button", { name: "保存", exact: true }).click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="presentation-editing-controls"]')
          ?.getAttribute("data-dirty") === "false",
      undefined,
      { timeout },
    );
    result = await savedAfter(captured, originalText);
    await waitReady(result.saved.sha256, originalText);

    const conflictValue = "PPTX_FILE_CONFLICT_DRAFT_MUST_SURVIVE";
    captured = await editActive(conflictValue);
    const externalZip = await JSZip.loadAsync(fs.readFileSync(filePath));
    externalZip.file(
      "customXml/navigation-external-change.xml",
      "external fixture modification",
    );
    const externalBytes = await externalZip.generateAsync({
      type: "nodebuffer",
    });
    fs.writeFileSync(filePath, externalBytes);
    const external = await readPresentationNavigationFile(filePath);
    const beforeConflict = await counts();
    const dialogsBeforeConflict = (await observer.snapshot()).length;
    const copiesBeforeConflict = (await copyRequests()).length;
    const originalPanel = await panel.elementHandle();
    const assertConflictPreserved = async () => {
      assert.equal(
        await originalPanel.evaluate((node) => node.isConnected),
        true,
      );
      assert.equal(await selectedTab().getAttribute("id"), sourceTabId);
      assert.equal(await controls.getAttribute("data-dirty"), "true");
      assert.equal(
        await panel.getAttribute("data-source-sha256"),
        captured.before.sha256,
      );
      assert.ok(
        (await frame.text('[data-slide-id="512"]')).includes(conflictValue),
      );
      assert.equal(digest(fs.readFileSync(filePath)), external.sha256);
      assert.equal(
        (await counts()).write,
        beforeConflict.write,
        "conflict never overwrites disk",
      );
      assert.equal((await copyRequests()).length, copiesBeforeConflict);
      assert.equal(
        (await observer.snapshot()).length,
        dialogsBeforeConflict,
        "blocked save never opens a native chooser",
      );
    };
    await download().click();
    await controls.getByRole("alert").waitFor({ state: "visible", timeout });
    await page.waitForFunction(
      () =>
        document
          .querySelector(
            '[data-testid="workspace-right-surface-active-pane"] button[aria-label="下载文件"]',
          )
          ?.getAttribute("aria-busy") === "false",
      undefined,
      { timeout },
    );
    await assertConflictPreserved();
    await closeSelected();
    const dialog = page.getByTestId("discard-file-changes-dialog");
    await dialog.waitFor({ state: "visible", timeout });
    await page.getByTestId("discard-file-changes-cancel").click();
    await assertConflictPreserved();
    await closeSelected();
    await dialog.waitFor({ state: "visible", timeout });
    await page.screenshot({
      path: path.join(evidenceDir, "presentation-navigation-conflict.png"),
    });
    await page.getByTestId("discard-file-changes-confirm").click();
    await page
      .locator(`[id="${sourceTabId}"]`)
      .waitFor({ state: "detached", timeout });
    assert.equal(
      await originalPanel.evaluate((node) => node.isConnected),
      false,
    );
    await originalPanel.dispose();
    const beforeReopen = await counts();
    await open(external, originalText);
    assert.equal((await counts()).write, beforeReopen.write);
    assert.equal(digest(fs.readFileSync(filePath)), external.sha256);
    assert.equal(
      (await frame.text('[data-slide-id="512"]')).includes(conflictValue),
      false,
    );
    evidence.conflict = {
      saveCopyBlocked: true,
      closeCancelPreservesDraft: true,
      explicitDiscardCloses: true,
      reopenReadsExternalBytes: true,
      writeIpcDelta: 0,
      copyRpcDelta: 0,
      nativeDialogDelta: 0,
      externalSha256: external.sha256,
    };
  } finally {
    const observation = await observer.stop();
    evidence.nativeObservation = observation;
    fs.writeFileSync(
      path.join(evidenceDir, "native-save-observation.json"),
      JSON.stringify(observation, null, 2) + "\n",
    );
    assert.equal(observation.originalRestored, true);
  }
  assert.equal(
    await panel.locator("iframe").getAttribute("sandbox"),
    "allow-same-origin",
  );
  assert.equal(await frame.count("script,iframe,a[href],[onclick]"), 0);
  evidence.finalSha256 = digest(fs.readFileSync(filePath));
  evidence.restoredOriginalSlideText = true;
  evidence.scriptsAllowed = false;
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-navigation-restored.png"),
  });
  fs.writeFileSync(
    path.join(evidenceDir, "presentation-navigation.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  return evidence;
}
