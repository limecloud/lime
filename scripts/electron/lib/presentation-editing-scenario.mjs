import {
  openFileTab,
  replaceFileTab,
} from "./thread-side-panel-navigation.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import {
  createArtifactFrameDriver,
  waitForArtifactFileRead,
} from "./artifact-frame-driver.mjs";
import {
  presentationFrameSelector,
  waitForPresentationSlide,
} from "./presentation-preview-scenario.mjs";
import { presentationTextEditorMatches } from "./presentation-text-editor-dom.mjs";

export async function runPresentationEditingScenario({
  page,
  evidenceDir,
  filePath,
  readTrace,
}) {
  const panel = page.getByTestId("presentation-panel");
  const controls = panel.getByTestId("presentation-editing-controls");
  const frame = createArtifactFrameDriver(page, presentationFrameSelector);
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const original = fs.readFileSync(filePath);
  const originalZip = await JSZip.loadAsync(original);
  const fileIo = async () => {
    const requests = (await readTrace())
      .filter(
        (entry) =>
          entry.transport === "electron-ipc" &&
          entry.command === "app_server_handle_json_lines" &&
          entry.status === "success",
      )
      .flatMap((entry) => {
        return (entry.args_preview?.request?.lines ?? []).map((line) =>
          JSON.parse(line),
        );
      })
      .filter((request) => request.params?.path === filePath);
    return {
      read: requests.filter((request) => request.method === "fs/readFile")
        .length,
      write: requests.filter((request) => request.method === "fs/writeFile")
        .length,
    };
  };
  const reads = async () => (await fileIo()).read;
  const automaticSaves = [];
  const waitSaved = async (previousSha, beforeIo, label) => {
    await page.waitForFunction((previousSha) => {
      const panel = document.querySelector(
        '[data-testid="presentation-panel"]',
      );
      const controls = panel?.querySelector(
        '[data-testid="presentation-editing-controls"]',
      );
      return (
        panel?.getAttribute("data-status") === "ready" &&
        panel.getAttribute("data-source-sha256") !== previousSha &&
        controls?.getAttribute("data-dirty") === "false" &&
        controls.getAttribute("data-saving") === "false" &&
        !panel
          .querySelector("iframe")
          ?.contentDocument?.querySelector("[data-presentation-text-editor]")
      );
    }, previousSha);
    const bytes = fs.readFileSync(filePath);
    assert.notEqual(
      sha(bytes),
      previousSha,
      `${label}: real disk bytes changed`,
    );
    assert.equal(await panel.getAttribute("data-source-sha256"), sha(bytes));
    const io = await fileIo();
    assert.ok(
      io.write > beforeIo.write,
      `${label}: successful current IPC write`,
    );
    assert.ok(
      io.read >= beforeIo.read + 2,
      `${label}: both conflict checks use current IPC`,
    );
    automaticSaves.push({
      label,
      sha256: sha(bytes),
      fileIoDelta: {
        read: io.read - beforeIo.read,
        write: io.write - beforeIo.write,
      },
    });
    return bytes;
  };
  const open = async (expectedSha, withPrevious = true, readsBeforeRemount) => {
    const previous = withPrevious ? await panel.elementHandle() : null;
    const before = readsBeforeRemount ?? (await reads());
    if (withPrevious) await replaceFileTab(page, filePath);
    else await openFileTab(page, filePath);
    await waitForArtifactFileRead(reads, before);
    const panelReplaced = previous
      ? !(await previous.evaluate((node) => node.isConnected))
      : null;
    await previous?.dispose();
    await waitForPresentationSlide(page, "512");
    assert.equal(await panel.getAttribute("data-source-sha256"), expectedSha);
    const after = await reads();
    assert.ok(
      after > before,
      "same-path reopening reads original bytes through real IPC",
    );
    return { sourceReads: after - before, panelReplaced };
  };
  const beginEdit = async (value) => {
    const originalSha = sha(fs.readFileSync(filePath));
    const beforeIo = await fileIo();
    if (
      await controls.getByRole("button", { name: "编辑", exact: true }).count()
    )
      await controls.getByRole("button", { name: "编辑", exact: true }).click();
    const elements = await frame.read("[data-presentation-element-id]");
    assert.ok(elements.length > 0);
    const id = elements[0].attributes["data-presentation-element-id"];
    assert.equal(id, "2", "fixture selects the original top-level text shape");
    await frame.click(`[data-presentation-element-id="${id}"]`);
    await controls
      .getByRole("button", { name: "编辑文字", exact: true })
      .click();
    await frame.click("[data-presentation-text-editor]");
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText(value);
    await page.waitForFunction(presentationTextEditorMatches, {
      selector: presentationFrameSelector,
      value,
    });
    assert.equal(await controls.getAttribute("data-dirty"), "true");
    assert.equal(await controls.getAttribute("data-saving"), "false");
    assert.equal(
      sha(fs.readFileSync(filePath)),
      originalSha,
      "active text input does not write the original file",
    );
    assert.equal(await panel.getAttribute("data-source-sha256"), originalSha);
    const io = await fileIo();
    assert.equal(
      io.write,
      beforeIo.write,
      "active text editor has no file write IPC",
    );
    return { id, sha256: originalSha, io };
  };
  const commitEdit = async (value) => {
    await page.keyboard.press("ControlOrMeta+Enter");
    await page.waitForFunction((value) => {
      const panel = document.querySelector(
        '[data-testid="presentation-panel"]',
      );
      const content = panel?.querySelector("iframe")?.contentDocument;
      return (
        panel?.getAttribute("data-status") === "ready" &&
        !content?.querySelector("[data-presentation-text-editor]") &&
        content?.querySelector("[data-slide-id]")?.textContent?.includes(value)
      );
    }, value);
    await waitForPresentationSlide(page, "512");
    assert.ok((await frame.text("[data-slide-id]")).includes(value));
  };
  await waitForPresentationSlide(page, "512");
  const text = "PPTX_NATIVE_SAVED_中文 <&>";
  const active = await beginEdit(text);
  const elementId = active.id;
  await commitEdit(text);
  const textSaved = await waitSaved(active.sha256, active.io, "text");
  const beforeBold = await fileIo();
  await controls.getByRole("button", { name: "加粗", exact: true }).click();
  await page.waitForFunction(() =>
    [
      ...document.querySelectorAll(
        '[data-testid="presentation-editing-controls"] button',
      ),
    ].some(
      (button) =>
        button.textContent === "加粗" &&
        button.getAttribute("aria-pressed") === "true",
    ),
  );
  await waitForPresentationSlide(page, "512");
  assert.equal(
    await controls
      .getByRole("button", { name: "加粗", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  const boldSaved = await waitSaved(sha(textSaved), beforeBold, "bold");
  const beforeNudge = await fileIo();
  await frame.click(`[data-presentation-element-id="${elementId}"]`);
  await page.keyboard.press("ArrowRight");
  const saved = await waitSaved(sha(boldSaved), beforeNudge, "nudge");
  const savedZip = await JSZip.loadAsync(saved);
  assert.notEqual(sha(saved), sha(original));
  const slidePath = "ppt/slides/slide1.xml";
  const savedXml = await savedZip.file(slidePath).async("string");
  assert.ok(savedXml.includes("PPTX_NATIVE_SAVED_中文 &lt;&amp;&gt;"));
  assert.match(savedXml, /\bb="1"/);
  const originalXml = await originalZip.file(slidePath).async("string");
  const originalX = Number(
    originalXml.match(/<p:sp>[\s\S]*?<a:off\s+x="(\d+)"/)?.[1],
  );
  const savedX = Number(
    savedXml.match(/<p:sp>[\s\S]*?<a:off\s+x="(\d+)"/)?.[1],
  );
  assert.equal(
    savedX,
    originalX + 9525,
    "ArrowRight writes one CSS pixel in EMU",
  );
  let preservedParts = 0;
  for (const [name, file] of Object.entries(originalZip.files)) {
    if (file.dir || name === slidePath) continue;
    assert.equal(
      sha(await savedZip.file(name).async("uint8array")),
      sha(await file.async("uint8array")),
      name,
    );
    preservedParts++;
  }
  const reopenEvidence = await open(sha(saved));
  assert.ok(
    (await frame.text("[data-slide-id]")).includes(
      "PPTX_NATIVE_SAVED_中文 <&>",
    ),
  );
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-edit-saved.png"),
  });
  const conflictText = "PPTX_LOCAL_CONFLICT_MUST_SURVIVE";
  const conflictDraft = await beginEdit(conflictText);
  const externalZip = await JSZip.loadAsync(saved);
  externalZip.file("customXml/external-change.xml", "external modification");
  const external = await externalZip.generateAsync({ type: "nodebuffer" });
  // 活动编辑器阻止自动保存；先制造外部版本，再提交本地草稿触发真实冲突检查。
  fs.writeFileSync(filePath, external);
  await commitEdit(conflictText);
  await controls.getByRole("alert").waitFor({ state: "visible" });
  assert.match(await controls.innerText(), /文件已被外部修改/);
  assert.equal(sha(fs.readFileSync(filePath)), sha(external));
  const conflictIo = await fileIo();
  assert.equal(
    conflictIo.write,
    conflictDraft.io.write,
    "external conflict prevents any overwrite IPC",
  );
  assert.ok(
    conflictIo.read > conflictDraft.io.read,
    "external revision is checked through real IPC",
  );
  assert.equal(await controls.getAttribute("data-dirty"), "true");
  assert.ok(
    (await frame.text("[data-slide-id]")).includes(
      "PPTX_LOCAL_CONFLICT_MUST_SURVIVE",
    ),
  );
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-edit-conflict.png"),
  });
  const previous = await panel.elementHandle();
  await page.getByTestId("app-sidebar-nav-settings").click();
  await page.getByTestId("settings-navigation").waitFor({ state: "visible" });
  await panel.waitFor({ state: "detached" });
  assert.equal(await previous.evaluate((node) => node.isConnected), false);
  await previous.dispose();
  const readsBeforeRemount = await reads();
  await page.getByTestId("settings-back-button").click();
  // dirty application-scope projection仍绑定旧文件版本，不能用磁盘SHA冒充草稿已接受外部内容。
  await open(sha(saved), false, readsBeforeRemount);
  assert.ok(
    (await frame.text("[data-slide-id]")).includes(
      "PPTX_LOCAL_CONFLICT_MUST_SURVIVE",
    ),
  );
  assert.equal(await controls.getAttribute("data-dirty"), "true");
  await controls.getByRole("button", { name: "放弃更改", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "继续编辑", exact: true })
    .click();
  assert.equal(await controls.getAttribute("data-dirty"), "true");
  await controls.getByRole("button", { name: "放弃更改", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "放弃更改", exact: true })
    .click();
  await waitForPresentationSlide(page, "512");
  await page.waitForFunction(
    (expected) =>
      document
        .querySelector('[data-testid="presentation-panel"]')
        ?.getAttribute("data-source-sha256") === expected,
    sha(external),
  );
  assert.ok(
    (await frame.text("[data-slide-id]")).includes(
      "PPTX_NATIVE_SAVED_中文 <&>",
    ),
  );
  assert.equal(sha(fs.readFileSync(filePath)), sha(external));
  assert.equal(
    (await fileIo()).write,
    conflictDraft.io.write,
    "conflict, remount and explicit discard never overwrite the external version",
  );
  await controls.getByRole("button", { name: "结束编辑", exact: true }).click();
  await page.screenshot({
    path: path.join(evidenceDir, "presentation-edit-discarded.png"),
  });
  return {
    savedSha256: sha(saved),
    externalSha256: sha(external),
    preservedParts,
    reopenEvidence,
    conflictNoOverwrite: true,
    workspaceRemountPreserved: true,
    discardExplicit: true,
    automaticSaves,
    manualSaveClicks: 0,
    activeTextEditorHeldWrites: true,
    conflictWriteDelta: conflictIo.write - conflictDraft.io.write,
  };
}
