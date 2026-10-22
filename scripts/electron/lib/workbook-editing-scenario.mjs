import {
  openFileTab,
  replaceFileTab,
} from "./thread-side-panel-navigation.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import JSZip from "jszip";

export async function runWorkbookEditingScenario({
  page,
  evidenceDir,
  filePath,
}) {
  const panel = page.getByTestId("workbook-preview-panel");
  const controls = panel.getByTestId("workbook-editing-controls");
  const cell = (address) => panel.locator(`[data-address="${address}"]`);
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const original = fs.readFileSync(filePath);
  const originalZip = await JSZip.loadAsync(original);
  const ready = async (expectedSha) => {
    await page.waitForFunction((expectedSha) => {
      const panel = document.querySelector(
        '[data-testid="workbook-preview-panel"]',
      );
      return (
        panel?.getAttribute("aria-label") === "Preview-report.xlsx" &&
        panel.getAttribute("data-status") === "ready" &&
        (!expectedSha ||
          panel.getAttribute("data-source-sha256") === expectedSha)
      );
    }, expectedSha);
  };
  const reopen = async (freshRead = true) => {
    const previous = freshRead ? await panel.elementHandle() : null;
    if (freshRead) await replaceFileTab(page, filePath);
    else await openFileTab(page, filePath);
    await ready();
    if (previous) {
      assert.equal(await previous.evaluate((node) => node.isConnected), false);
      await previous.dispose();
    }
  };
  const edit = async (value) => {
    await cell("A6").dblclick();
    const input = panel.getByRole("textbox", { name: "编辑 A6", exact: true });
    await input.fill(value);
    await input.press("Enter");
    assert.equal(await cell("A6").innerText(), value);
    assert.equal(await controls.getAttribute("data-dirty"), "true");
  };
  await panel.getByRole("tab", { name: "预算", exact: true }).click();
  const position = panel.getByRole("textbox", {
    name: "单元格位置",
    exact: true,
  });
  await position.fill("A6");
  await position.press("Enter");
  await controls.getByRole("button", { name: "编辑", exact: true }).click();
  await edit("WORKBOOK_SAVED_NATIVE");
  await controls.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForFunction(() => {
    const controls = document.querySelector(
      '[data-testid="workbook-editing-controls"]',
    );
    return (
      controls?.getAttribute("data-dirty") === "false" &&
      controls.getAttribute("data-saving") === "false"
    );
  });
  const saved = fs.readFileSync(filePath),
    savedZip = await JSZip.loadAsync(saved);
  assert.notEqual(sha(saved), sha(original));
  assert.match(
    await savedZip.file("xl/worksheets/sheet1.xml").async("string"),
    /WORKBOOK_SAVED_NATIVE/,
  );
  const changedParts = new Set([
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "[Content_Types].xml",
    "xl/worksheets/sheet1.xml",
    "xl/worksheets/sheet2.xml",
  ]);
  let preserved = 0;
  for (const [name, file] of Object.entries(originalZip.files)) {
    if (file.dir || changedParts.has(name)) continue;
    assert.equal(
      sha(await savedZip.file(name).async("uint8array")),
      sha(await file.async("uint8array")),
      name,
    );
    preserved++;
  }
  await reopen();
  assert.equal(await cell("A6").innerText(), "WORKBOOK_SAVED_NATIVE");
  console.log("[workbook-editing] saved and reopened original bytes");
  await page.screenshot({
    path: path.join(evidenceDir, "workbook-edit-saved.png"),
  });

  await edit("WORKBOOK_CONFLICT_LOCAL_MUST_SURVIVE");
  const externalZip = await JSZip.loadAsync(saved);
  externalZip.file("customXml/external-change.xml", "external modification");
  const external = await externalZip.generateAsync({ type: "nodebuffer" });
  fs.writeFileSync(filePath, external);
  await controls.getByRole("button", { name: "保存", exact: true }).click();
  await controls.getByRole("alert").waitFor({ state: "visible" });
  assert.match(await controls.innerText(), /源文件已变化/);
  assert.equal(
    sha(fs.readFileSync(filePath)),
    sha(external),
    "external source is never overwritten after observed conflict",
  );
  assert.equal(
    await cell("A6").innerText(),
    "WORKBOOK_CONFLICT_LOCAL_MUST_SURVIVE",
  );
  const errorGeometry = await controls.getByRole("alert").evaluate((node) => {
    const panel = node.closest('[data-testid="workbook-preview-panel"]');
    return {
      errorWidth: node.getBoundingClientRect().width,
      panelWidth: panel.getBoundingClientRect().width,
    };
  });
  assert.ok(
    errorGeometry.errorWidth >= errorGeometry.panelWidth - 32,
    "conflict message uses the narrow panel width",
  );
  console.log("[workbook-editing] external source conflict preserved");
  await page.screenshot({
    path: path.join(evidenceDir, "workbook-edit-conflict.png"),
  });

  const originalPanel = await panel.elementHandle();
  await page.getByTestId("app-sidebar-nav-settings").click();
  await page.getByTestId("settings-navigation").waitFor({ state: "visible" });
  await panel.waitFor({ state: "detached" });
  assert.equal(await originalPanel.evaluate((node) => node.isConnected), false);
  await page.getByTestId("settings-back-button").click();
  // 设置返回已经重新挂载原标签；选择同路径保留应用scope草稿，不触发关闭。
  await reopen(false);
  await ready();
  assert.equal(
    await cell("A6").innerText(),
    "WORKBOOK_CONFLICT_LOCAL_MUST_SURVIVE",
  );
  assert.equal(await controls.getAttribute("data-dirty"), "true");
  console.log(
    "[workbook-editing] Workspace unmounted and file reopened with draft",
  );
  await controls.getByRole("button", { name: "放弃更改", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "继续编辑", exact: true }).click();
  assert.equal(await controls.getAttribute("data-dirty"), "true");
  await controls.getByRole("button", { name: "放弃更改", exact: true }).click();
  await dialog.getByRole("button", { name: "放弃更改", exact: true }).click();
  await ready(sha(external));
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="workbook-editing-controls"]')
        ?.getAttribute("data-dirty") === "false",
  );
  assert.equal(await cell("A6").innerText(), "WORKBOOK_SAVED_NATIVE");
  assert.equal(sha(fs.readFileSync(filePath)), sha(external));
  await page.screenshot({
    path: path.join(evidenceDir, "workbook-edit-discarded.png"),
  });
  await controls.getByRole("button", { name: "结束编辑", exact: true }).click();
  return {
    savedSha256: sha(saved),
    externalSha256: sha(external),
    preservedParts: preserved,
    conflictNoOverwrite: true,
    workspaceRemountPreserved: true,
    discardExplicit: true,
    errorGeometry,
  };
}

export async function runDelimitedWorkbookEditingScenario({
  page,
  evidenceDir,
  filePath,
  readTrace,
}) {
  const panel = page.getByTestId("workbook-preview-panel");
  const sourceReads = async (sourcePath) =>
    (await readTrace())
      .filter(
        (entry) =>
          entry.command === "app_server_handle_json_lines" &&
          entry.transport === "electron-ipc" &&
          entry.status === "success",
      )
      .flatMap((entry) =>
        (entry.args_preview?.request?.lines ?? []).map((line) =>
          JSON.parse(line),
        ),
      )
      .filter(
        (request) =>
          request.method === "fs/readFile" &&
          request.params?.path === sourcePath,
      ).length;
  const open = async (filename) => {
    const sourcePath = path.join(path.dirname(filePath), filename);
    const expectedSha = createHash("sha256")
      .update(fs.readFileSync(sourcePath))
      .digest("hex");
    const readsBefore = await sourceReads(sourcePath);
    const previousPanel = await panel.elementHandle();
    assert.ok(previousPanel, "reopen starts with an existing workbook panel");
    await replaceFileTab(page, sourcePath);
    // 文件树的本地投影没有 previewRequestKey；读取经过 loading 卸载旧面板。
    await page.waitForFunction((node) => !node.isConnected, previousPanel);
    await previousPanel.dispose();
    await page.waitForFunction(
      ({ filename, expectedSha }) => {
        const panel = document.querySelector(
          '[data-testid="workbook-preview-panel"]',
        );
        return (
          panel?.getAttribute("aria-label") === filename &&
          panel.getAttribute("data-source-sha256") === expectedSha &&
          panel.getAttribute("data-status") === "ready"
        );
      },
      { filename, expectedSha },
    );
    const readsAfter = await sourceReads(sourcePath);
    assert.ok(
      readsAfter > readsBefore,
      `${filename}: reopening must read its original bytes through real IPC`,
    );
    return { sourceReads: readsAfter - readsBefore, panelReplaced: true };
  };
  const rows = [];
  for (const item of [
    {
      filename: "Values.csv",
      value: '新值,带"引号',
      expected:
        '\uFEFF名称,编号,备注\r\n"新值,带""引号",0012,"第一行\n第二行"\r\n公式,=1+1,原始文本\r\n',
    },
    {
      filename: "Values.tsv",
      value: "新值\t带制表",
      expected: '名称\t编号\n"新值\t带制表"\t002\n',
    },
  ]) {
    await open(item.filename);
    const controls = panel.getByTestId("workbook-editing-controls");
    await controls.getByRole("button", { name: "编辑", exact: true }).click();
    await panel.locator('[data-address="A2"]').dblclick();
    const input = panel.getByRole("textbox", { name: "编辑 A2", exact: true });
    await input.fill(item.value);
    await input.press("Enter");
    await controls.getByRole("button", { name: "保存", exact: true }).click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="workbook-editing-controls"]')
          ?.getAttribute("data-dirty") === "false",
    );
    const bytes = fs.readFileSync(
      path.join(path.dirname(filePath), item.filename),
    );
    assert.equal(
      bytes.toString("utf8"),
      item.expected,
      "untouched lexical fields, BOM and line endings survive actual gateway save",
    );
    const reopened = await open(item.filename);
    assert.equal(
      await panel.locator('[data-address="A2"]').textContent(),
      item.value,
    );
    assert.equal(
      await panel.locator('[data-address="B2"]').textContent(),
      item.filename.endsWith(".csv") ? "0012" : "002",
    );
    if (item.filename.endsWith(".csv"))
      assert.equal(
        await panel.locator('[data-address="B3"]').textContent(),
        "=1+1",
      );
    await page.screenshot({
      path: path.join(evidenceDir, `workbook-edit-${item.filename}.png`),
    });
    rows.push({
      filename: item.filename,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      lexicalBytesVerified: true,
      reopened: true,
      reopenEvidence: reopened,
    });
    await controls
      .getByRole("button", { name: "结束编辑", exact: true })
      .click();
  }
  await open(path.basename(filePath));
  return rows;
}
