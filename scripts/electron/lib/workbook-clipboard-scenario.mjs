import { replaceFileTab } from "./thread-side-panel-navigation.mjs";
import { withNativeClipboard } from "./native-clipboard.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { waitForArtifactFileRead } from "./artifact-frame-driver.mjs";
import {
  assertWorkbookClipboardFixture,
  assertWorkbookClipboardIo,
  assertWorkbookClipboardSave,
  readWorkbookClipboardFile,
  workbookClipboardCopyText,
  workbookClipboardDigest,
  workbookClipboardExpectedCells,
  workbookClipboardFormat,
  workbookClipboardIo,
  workbookClipboardPaddedValue,
  workbookClipboardPasteText,
  workbookClipboardQuotedValue,
} from "./workbook-clipboard-scenario-oracle.mjs";

export {
  writeWorkbookClipboardFixture,
  readWorkbookClipboardFile,
  assertWorkbookClipboardFixture,
  assertWorkbookClipboardSave,
} from "./workbook-clipboard-scenario-oracle.mjs";

const timeout = 15_000;

/** 用户原剪贴板只留内存，和富文本场景共用同一原始格式恢复 owner。 */
export async function withWorkbookClipboard(app, perform, options) {
  return withNativeClipboard(
    app,
    () =>
      perform({
        readText: () => app.evaluate(({ clipboard }) => clipboard.readText()),
        writeText: async (text) => {
          const matches = await app.evaluate(({ clipboard }, text) => {
            clipboard.write({ text });
            return (
              clipboard.readText() === text &&
              !clipboard.availableFormats().includes("text/html")
            );
          }, text);
          assert.equal(
            matches,
            true,
            "native plain text clipboard roundtrip; no synthetic event fallback",
          );
        },
      }),
    options,
  );
}

/** 只读取公开 DOM；不调用 Controller，不注入 ClipboardEvent 或替代选择状态。 */
function workbookClipboardDom(expected = {}) {
  const panel = document.querySelector(
    '[data-testid="workbook-preview-panel"]',
  );
  const controls = panel?.querySelector(
    '[data-testid="workbook-editing-controls"]',
  );
  const grid = panel?.querySelector('[data-testid="workbook-grid"]');
  const position = panel?.querySelector('input[aria-label="单元格位置"]');
  const active = grid?.getAttribute("aria-activedescendant");
  const cells = Object.fromEntries(
    Array.from(
      grid?.querySelectorAll('[role="gridcell"][data-address]') ?? [],
      (cell) => [cell.getAttribute("data-address"), cell.textContent ?? ""],
    ),
  );
  const state = {
    ready: panel?.getAttribute("data-status") === "ready",
    title: panel?.getAttribute("aria-label"),
    sha256: panel?.getAttribute("data-source-sha256"),
    dirty: controls?.getAttribute("data-dirty") === "true",
    saving: controls?.getAttribute("data-saving") === "true",
    readonly: grid?.getAttribute("aria-readonly") === "true",
    focused: document.activeElement === grid,
    position: position?.value,
    activeAddress: active
      ? document.getElementById(active)?.getAttribute("data-address")
      : null,
    cellEditors:
      grid?.querySelectorAll("input,textarea,[contenteditable=true]").length ??
      0,
    cells,
    alert: controls?.querySelector('[role="alert"]')?.textContent ?? null,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (key === "cells") {
      for (const [address, text] of Object.entries(value))
        if (state.cells[address] !== text) return false;
    } else if (state[key] !== value) return false;
  }
  return state;
}

/** 同一真实文件树入口、系统剪贴板与原生键盘；不启动或伪造 Electron。 */
export async function runWorkbookClipboardScenario({
  app,
  page,
  evidenceDir,
  filePath,
  readTrace,
}) {
  assert.equal(typeof readTrace, "function");
  const format = workbookClipboardFormat(filePath);
  const original = await readWorkbookClipboardFile(filePath);
  assertWorkbookClipboardFixture(original);
  const filename = path.basename(filePath);
  const panel = page.getByTestId("workbook-preview-panel");
  const controls = panel.getByTestId("workbook-editing-controls");
  const position = panel.getByRole("textbox", {
    name: "单元格位置",
    exact: true,
  });
  const io = async () => workbookClipboardIo(await readTrace(), filePath);
  const fileReads = async () =>
    (await readTrace())
      .flatMap((row, ledgerIndex) =>
        (row.command === "app_server_handle_json_lines" &&
        row.transport === "electron-ipc" &&
        row.status === "success"
          ? (row.args_preview?.request?.lines ?? [])
          : []
        ).map((line, requestIndex) => ({
          ...JSON.parse(line),
          ledgerIndex,
          requestIndex,
        })),
      )
      .filter(
        (request) =>
          request.method === "fs/readFile" && request.params?.path === filePath,
      );
  const initialIo = await io();
  const evidence = {
    format,
    filename,
    originalSha256: original.sha256,
    stages: [],
    rejected: [],
  };
  const record = () =>
    fs.writeFileSync(
      path.join(evidenceDir, `workbook-clipboard-${format}.json`),
      JSON.stringify(evidence, null, 2) + "\n",
    );
  const diskSha = () => workbookClipboardDigest(fs.readFileSync(filePath));
  const waitState = async (expected) => {
    try {
      await page.waitForFunction(workbookClipboardDom, expected, { timeout });
    } catch (error) {
      const actual = await page.evaluate(workbookClipboardDom);
      fs.writeFileSync(
        path.join(
          evidenceDir,
          `workbook-clipboard-${format}-wait-failure.json`,
        ),
        JSON.stringify({ expected, actual }, null, 2) + "\n",
      );
      throw error;
    }
    return page.evaluate(workbookClipboardDom);
  };
  const state = () => page.evaluate(workbookClipboardDom);
  const capture = async () => ({
    io: await io(),
    sha256: diskSha(),
    state: await state(),
  });
  const at = async (address, selected = address) => {
    await position.fill(address);
    await position.press("Enter");
    return waitState({ position: selected, focused: true, cellEditors: 0 });
  };
  const open = async (sha256) => {
    const before = await io();
    const previousReadCount = (await fileReads()).length;
    await replaceFileTab(page, filePath, timeout);
    await waitForArtifactFileRead(
      async () => (await io()).read,
      before.read,
      timeout,
    );
    await waitState({
      ready: true,
      title: filename,
      sha256,
      dirty: false,
      saving: false,
    });
    await panel
      .getByRole("tab", {
        name: format === "xlsx" ? "Clipboard" : "Sheet1",
        exact: true,
      })
      .click();
    const delta = assertWorkbookClipboardIo(
      before,
      await io(),
      // current Files 的文件投影与 Workbook 导入分别读取原件。
      { read: 2, write: 0 },
      "current Files cold open/reopen",
    );
    const requests = (await fileReads())
      .slice(previousReadCount)
      .map(({ id, ledgerIndex, requestIndex }) => ({
        id,
        ledgerIndex,
        requestIndex,
      }));
    assert.equal(requests.length, 2, "two successful reads in the IPC ledger");
    assert.equal(
      new Set(requests.map(({ ledgerIndex }) => ledgerIndex)).size,
      2,
      "two distinct successful IPC invocations",
    );
    assert.equal(
      await panel.getByTitle(filename, { exact: true }).textContent(),
      filename,
      "visible source title stays unchanged",
    );
    return { ...delta, requests };
  };
  const quiet = async (label, before, expected) => {
    await waitState(expected);
    // 仅用于验证超出自动保存窗口仍无迟写，不用时间伪造成功终态。
    await page.waitForTimeout(650);
    await waitState(expected);
    assert.equal(
      diskSha(),
      before.sha256,
      `${label}: original bytes stay unchanged`,
    );
    const delta = assertWorkbookClipboardIo(
      before.io,
      await io(),
      { read: 0, write: 0 },
      label,
    );
    evidence.stages.push({
      name: label,
      sourceSha256: before.sha256,
      fileIoDelta: delta,
      zeroDelayedWrites: true,
    });
    record();
  };
  const save = async (stage) => {
    const before = await capture();
    await controls.getByRole("button", { name: "保存", exact: true }).click();
    await waitState({ dirty: false, saving: false });
    const saved = await readWorkbookClipboardFile(filePath);
    const preserved = assertWorkbookClipboardSave(original, saved, stage);
    await waitState({ sha256: saved.sha256 });
    const delta = assertWorkbookClipboardIo(
      before.io,
      await io(),
      { read: 2, write: 1 },
      `${stage}: explicit save`,
    );
    const after = await capture();
    await quiet(`${stage}: saved source has no delayed writes`, after, {
      dirty: false,
      saving: false,
      sha256: saved.sha256,
    });
    evidence.stages.push({
      name: `${stage}: source package verified`,
      sha256: saved.sha256,
      fileIoDelta: delta,
      ...preserved,
    });
    record();
    return saved;
  };
  const host = await page.evaluate(() => ({
    electron: window.__LIME_ELECTRON__ === true,
    currentInvoke: typeof window.electronAPI?.invoke === "function",
  }));
  assert.deepEqual(
    host,
    { electron: true, currentInvoke: true },
    "clipboard scenario requires real Desktop Host/preload",
  );
  evidence.initialOpen = await open(original.sha256);
  await waitState({ readonly: true });
  await at("A1:C2");
  await waitState({
    cells: {
      A1: "SOURCE",
      B1: format === "xlsx" ? "7" : "=1+1",
      C1: "",
      A2: workbookClipboardQuotedValue,
      B2: workbookClipboardPaddedValue,
    },
  });
  await withWorkbookClipboard(app, async (clipboard) => {
    const copy = async (expected) => {
      await clipboard.writeText("WORKBOOK_CLIPBOARD_COPY_SENTINEL");
      await page.keyboard.press("ControlOrMeta+C");
      const deadline = Date.now() + timeout;
      let actual;
      while (Date.now() < deadline) {
        actual = await clipboard.readText();
        if (actual === expected) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(
        actual,
        expected,
        "native copy contains exact hand-written TSV, displayed cache and empty fields",
      );
    };
    const beforeCopy = await capture();
    await copy(workbookClipboardCopyText(format));
    await quiet("readonly native rectangular copy", beforeCopy, {
      dirty: false,
      position: "A1:C2",
    });
    await at("A10:C11");
    await clipboard.writeText("READONLY_PASTE_MUST_NOT_APPLY");
    const beforeReadonly = await capture();
    await page.keyboard.press("ControlOrMeta+V");
    await quiet("readonly native paste rejected", beforeReadonly, {
      readonly: true,
      dirty: false,
      position: "A10:C11",
      cells: { A10: "old-A10", C11: "old-C11" },
    });
    evidence.rejected.push("readonly");
    await at("A1:C2");
    await copy(workbookClipboardCopyText(format));
    await controls.getByRole("button", { name: "编辑", exact: true }).click();
    await at("A10:C11");
    const beforeCopiedPaste = await capture();
    await page.keyboard.press("ControlOrMeta+V");
    const copiedCells = workbookClipboardExpectedCells(format, "copied");
    await waitState({ dirty: true, position: "A10:C11", cells: copiedCells });
    await quiet(
      "native copy then rectangular paste stays in draft",
      beforeCopiedPaste,
      { dirty: true, position: "A10:C11", cells: copiedCells },
    );
    await save("copied");
    await at("A1:C2");
    await copy(workbookClipboardCopyText(format, true));
    evidence.displayedCacheOnly =
      format === "xlsx"
        ? {
            initialCachedValue: "7",
            missingAndInvalidatedCache: "",
            formulaEvaluation: false,
          }
        : { formulaLikeTextStaysLiteral: true };

    await at("D5:E7");
    await clipboard.writeText(workbookClipboardPasteText);
    const beforeHandPaste = await capture();
    await page.keyboard.press("ControlOrMeta+V");
    const pastedCells = {
      D5: "HAND\tCELL",
      E5: 'line 1\nline "2"',
      F5: "  keep  ",
      D6: format === "xlsx" ? "" : "=1+1",
      E6: "0012",
      F6: "",
      D7: "NO_REPEAT_D7",
      F7: "NO_REPEAT_F7",
    };
    await waitState({ dirty: true, position: "D5:F6", cells: pastedCells });
    await quiet(
      "handwritten quoted TSV uses selection top left without repeat",
      beforeHandPaste,
      { dirty: true, position: "D5:F6", cells: pastedCells },
    );
    const reject = async (name, text, address, selected = address) => {
      // 先通过原生同值粘贴清除上一轮错误，确保每次拒绝都产生自己的可见失败终态。
      await at("D5:F6");
      await clipboard.writeText(workbookClipboardPasteText);
      await page.keyboard.press("ControlOrMeta+V");
      await waitState({
        alert: null,
        dirty: true,
        position: "D5:F6",
        cells: pastedCells,
      });
      if (address) await at(address, selected);
      await clipboard.writeText(text);
      const before = await capture();
      await page.keyboard.press("ControlOrMeta+V");
      await controls.getByRole("alert").waitFor({ state: "visible", timeout });
      await quiet(
        `${name}: atomic native paste rejection preserves draft/selection`,
        before,
        {
          dirty: true,
          focused: true,
          position: before.state.position,
        },
      );
      // 错误提示会改变虚拟窗口；用真实位置输入补验已离屏的单元格。
      let observed = await state();
      const revealedCells = [];
      for (const [address, text] of Object.entries(before.state.cells)) {
        if (!(address in observed.cells)) {
          await at(address);
          await waitState({ cells: { [address]: text } });
          observed = await state();
          revealedCells.push(address);
        }
        assert.equal(observed.cells[address], text, `${name}: ${address}`);
      }
      await at(before.state.position);
      assertWorkbookClipboardIo(
        before.io,
        await io(),
        { read: 0, write: 0 },
        `${name}: full visible draft verification`,
      );
      evidence.stages.push({
        name: `${name}: all captured draft cells verified`,
        verifiedCells: Object.keys(before.state.cells).length,
        revealedCells,
        selectionRestored: before.state.position,
      });
      evidence.rejected.push(name);
    };
    await reject("ragged", "two\tcolumns\none");
    await reject("illegal-control-character", "invalid\u0001text");
    await reject("out-of-bounds", "one\ttwo", "J30");
    if (format === "xlsx") await reject("merged", "one\ttwo", "A4", "A4:B4");
    await at("D5:F6");
    const beforeCut = await capture();
    await page.keyboard.press("ControlOrMeta+X");
    await quiet("native cut on grid does not delete cells", beforeCut, {
      dirty: true,
      position: "D5:F6",
      cells: pastedCells,
    });
    evidence.rejected.push("cut-does-not-delete");
    const saved = await save("pasted");
    await page.screenshot({
      path: path.join(evidenceDir, `workbook-clipboard-${format}-saved.png`),
    });
    await controls
      .getByRole("button", { name: "结束编辑", exact: true })
      .click();
    evidence.reopen = await open(saved.sha256);
    await at("A10:C11");
    await waitState({ readonly: true, cells: copiedCells });
    await at("D5:F6");
    await waitState({ readonly: true, cells: pastedCells });
    assertWorkbookClipboardSave(
      original,
      await readWorkbookClipboardFile(filePath),
      "pasted",
    );
    const beforeCleanReopen = await capture();
    await quiet(
      "same-file clean reopen has no delayed save",
      beforeCleanReopen,
      { dirty: false, sha256: saved.sha256 },
    );
    await page.screenshot({
      path: path.join(evidenceDir, `workbook-clipboard-${format}-reopened.png`),
    });

    await controls.getByRole("button", { name: "编辑", exact: true }).click();
    await at("D5");
    await clipboard.writeText("CONFLICT_LOCAL_CLIPBOARD_DRAFT_MUST_SURVIVE");
    const beforeConflictDraft = await capture();
    await page.keyboard.press("ControlOrMeta+V");
    await quiet(
      "conflict candidate paste is only local draft",
      beforeConflictDraft,
      {
        dirty: true,
        position: "D5",
        cells: { D5: "CONFLICT_LOCAL_CLIPBOARD_DRAFT_MUST_SURVIVE" },
      },
    );
    let external;
    if (format === "xlsx") {
      const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
      zip.file(
        "customXml/external-clipboard-change.xml",
        "EXTERNAL_SHA_CHANGED",
      );
      external = await zip.generateAsync({ type: "nodebuffer" });
    } else
      external = Buffer.concat([
        fs.readFileSync(filePath),
        Buffer.from(
          format === "csv"
            ? "EXTERNAL_SHA_CHANGED,,,,,\r\n"
            : "EXTERNAL_SHA_CHANGED\t\t\t\t\t\n",
        ),
      ]);
    fs.writeFileSync(filePath, external);
    const externalSha256 = workbookClipboardDigest(external);
    const beforeConflictSave = await capture();
    await controls.getByRole("button", { name: "保存", exact: true }).click();
    await controls.getByRole("alert").waitFor({ state: "visible", timeout });
    await waitState({
      dirty: true,
      saving: false,
      sha256: saved.sha256,
      cells: { D5: "CONFLICT_LOCAL_CLIPBOARD_DRAFT_MUST_SURVIVE" },
    });
    assert.match(await controls.getByRole("alert").innerText(), /源文件已变化/);
    const conflictIo = assertWorkbookClipboardIo(
      beforeConflictSave.io,
      await io(),
      { read: 1, write: 0 },
      "external SHA conflict",
    );
    const afterConflict = await capture();
    await quiet(
      "external SHA conflict has zero delayed overwrite",
      afterConflict,
      {
        dirty: true,
        saving: false,
        sha256: saved.sha256,
        cells: { D5: "CONFLICT_LOCAL_CLIPBOARD_DRAFT_MUST_SURVIVE" },
      },
    );
    assert.equal(diskSha(), externalSha256);
    await page.screenshot({
      path: path.join(evidenceDir, `workbook-clipboard-${format}-conflict.png`),
    });
    evidence.conflict = {
      externalSha256,
      fileIoDelta: conflictIo,
      zeroOverwrite: true,
      localDraftPreserved: true,
    };
    await controls
      .getByRole("button", { name: "放弃更改", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "放弃更改", exact: true })
      .click();
    await waitState({
      dirty: false,
      saving: false,
      sha256: externalSha256,
      cells: { D5: "HAND\tCELL" },
    });
    assert.equal(diskSha(), externalSha256);
    await controls
      .getByRole("button", { name: "结束编辑", exact: true })
      .click();
    evidence.savedSha256 = saved.sha256;
  });
  assert.equal(
    (await io()).turnStarts,
    initialIo.turnStarts,
    "all local clipboard operations add zero Turns",
  );
  evidence.clipboard = {
    systemClipboard: true,
    nativeKeyboard: true,
    plainTextOnly: true,
    restored: true,
    syntheticEvents: false,
    userContentInEvidence: false,
  };
  evidence.additionalTurns = 0;
  evidence.claimBoundary =
    "text/plain rectangular TSV only; no rich MIME, relative formula references, formula evaluation or cross-process atomic CAS claim";
  record();
  return evidence;
}
