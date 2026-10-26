import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { invokeAppServerFromPage } from "../../lib/chat-fixture/rpc.mjs";
import { closeThreadSidePanelTab } from "./thread-side-panel-navigation.mjs";
import {
  fillComposerEditor,
  readComposerEditorText,
  composerEditorSelector,
} from "../../lib/composer-editor-dom.mjs";

export async function runWorkbookAnnotationScenario({
  page,
  evidenceDir,
  filePath,
  identity,
  starts,
  options,
}) {
  const panel = page.getByTestId("workbook-preview-panel");
  const editor = page.getByTestId("document-annotation-editor");
  const accessory = page.locator(
    '[data-testid="composer-annotation-accessory"]:visible',
  );
  const sourceSha = () =>
    createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  const mainDraft = "WORKBOOK_MAIN_COMPOSER_DRAFT_MUST_SURVIVE";
  await fillComposerEditor(page, mainDraft, identity.sessionId);
  const composer = page.locator(
    `${composerEditorSelector(identity.sessionId)}:visible`,
  );
  const ready = () =>
    page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="workbook-preview-panel"]')
          ?.getAttribute("data-status") === "ready",
    );
  const select = async (sheet, address) => {
    await ready();
    await panel.getByRole("tab", { name: sheet, exact: true }).click();
    const input = panel.getByRole("textbox", {
      name: "单元格位置",
      exact: true,
    });
    await input.fill(address);
    await input.press("Enter");
    await page.waitForFunction(
      ({ sheet, address }) => {
        const panel = document.querySelector(
          '[data-testid="workbook-preview-panel"]',
        );
        const grid = panel?.querySelector('[role="grid"]');
        const active = grid?.getAttribute("aria-activedescendant");
        const target = active ? document.getElementById(active) : null;
        return (
          grid?.getAttribute("aria-label") === sheet &&
          target?.getAttribute("data-address") === address.split(":").at(-1) &&
          target?.getAttribute("aria-selected") === "true"
        );
      },
      { sheet, address },
    );
    assert.equal(await input.inputValue(), address);
    console.log(`[workbook-annotation] selected ${sheet}!${address}`);
  };
  const add = async (sheet, address, body) => {
    await select(sheet, address);
    await panel.getByRole("button", { name: "添加批注", exact: true }).click();
    assert.ok((await editor.innerText()).includes(`${sheet} · ${address}`));
    await editor
      .getByRole("textbox", { name: "批注内容", exact: true })
      .fill(body);
  };
  const close = async () => {
    await editor.getByRole("button", { name: "关闭批注", exact: true }).click();
    await editor.waitFor({ state: "detached" });
  };
  const waitCompleted = async (count) => {
    let thread;
    const deadline = Date.now() + options.timeoutMs;
    while (Date.now() < deadline) {
      const read = await invokeAppServerFromPage(page, "thread/read", {
        threadId: identity.threadId,
        includeTurns: true,
      });
      thread = read.result?.thread;
      if (
        thread?.turns.length === count &&
        thread.turns.at(-1).status === "completed"
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
    }
    assert.equal(thread?.id, identity.threadId);
    assert.equal(thread.turns.length, count);
    assert.equal(thread.turns.at(-1).status, "completed");
    return thread;
  };

  const before = starts().length;
  const singleBody = "WORKBOOK_SINGLE_RANGE: update these cells.";
  const initialSha = sourceSha();
  await add("预算", "B2:C3", singleBody);
  await page.screenshot({
    path: path.join(evidenceDir, "workbook-range-single.png"),
  });
  await editor.getByRole("button", { name: "请求修改", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  const first = await waitCompleted(before + 1);
  console.log("[workbook-annotation] single completed");
  const single = starts()[before]?.runtimeRequest?.metadata?.artifactAnnotation;
  assert.ok(single);
  assert.equal(starts().length, before + 1);
  assert.equal(single.type, "workbook");
  assert.equal(single.path, filePath);
  assert.equal(single.sourceSha256, initialSha);
  assert.equal(single.sourceFormat, "xlsx");
  assert.equal(single.sheetName, "预算");
  assert.equal(single.sheetId, "1");
  assert.equal(single.address, "B2:C3");
  assert.equal(single.body, singleBody);
  assert.equal(single.sessionId, identity.sessionId);
  assert.equal(single.threadId, identity.threadId);
  assert.equal(single.originatingTurnId, identity.turns[0].id);
  assert.equal("pageNumber" in single, false);

  const bodies = [
    "WORKBOOK_BATCH_BUDGET: revise this range.",
    "WORKBOOK_BATCH_DETAILS: check this formula.",
  ];
  await add("预算", "B2:B4", bodies[0]);
  await close();
  await add("明细", "A1:B1", bodies[1]);
  await close();
  assert.equal(starts().length, before + 1, "drafts do not create Turns");
  const originalPanel = await panel.elementHandle();
  assert.ok(originalPanel);
  await accessory
    .getByRole("button", {
      name: "Preview-report.xlsx · 2 条批注",
      exact: true,
    })
    .click();
  await accessory.locator("li button").filter({ hasText: bodies[0] }).click();
  await editor.waitFor({ state: "visible" });
  assert.equal(
    await originalPanel.evaluate((node) => node.isConnected),
    true,
    "review reuses the existing file content instance",
  );
  assert.equal(
    await page
      .getByTestId("workspace-right-surface-active-pane")
      .getByTestId("workbook-preview-panel")
      .count(),
    1,
    "Composer review opens the current Files surface",
  );
  assert.equal(await editor.getByRole("textbox").inputValue(), bodies[0]);
  assert.equal(
    await panel
      .getByRole("tab", { name: "预算", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  assert.equal(
    await panel
      .getByRole("textbox", { name: "单元格位置", exact: true })
      .inputValue(),
    "B2:B4",
  );
  await page.waitForFunction(() => {
    const grid = document.querySelector('[data-testid="workbook-grid"]');
    const cell = grid?.querySelector('[data-address="B2"]');
    if (!grid || !cell) return false;
    const viewport = grid.getBoundingClientRect(),
      target = cell.getBoundingClientRect();
    return (
      target.top >= viewport.top + 26 &&
      target.bottom <= viewport.bottom &&
      target.left >= viewport.left + 46 &&
      target.right <= viewport.right
    );
  });
  await close();

  await closeThreadSidePanelTab(page, "files");
  await panel.waitFor({ state: "detached" });
  assert.equal(await originalPanel.evaluate((node) => node.isConnected), false);
  await accessory.locator("li button").filter({ hasText: bodies[0] }).click();
  await ready();
  await editor.waitFor({ state: "visible" });
  assert.equal(await editor.getByRole("textbox").inputValue(), bodies[0]);
  assert.equal(
    await panel
      .getByRole("textbox", { name: "单元格位置", exact: true })
      .inputValue(),
    "B2:B4",
  );
  assert.equal(
    await page
      .getByTestId("workspace-right-surface-active-pane")
      .getByTestId("workbook-preview-panel")
      .count(),
    1,
  );
  assert.equal(await readComposerEditorText(composer), mainDraft);
  await page.screenshot({
    path: path.join(evidenceDir, "workbook-annotation-files-cold-reopen.png"),
  });
  await close();

  // 原 XLSX 尾部追加字节仍可解析，但文件版本已变化；发送必须拒绝并保稿。
  fs.appendFileSync(filePath, "\nWORKBOOK_REVISION_CHANGED\n");
  const revisedSha = sourceSha();
  assert.notEqual(revisedSha, initialSha);
  await accessory
    .getByRole("button", { name: "发送全部批注", exact: true })
    .click();
  await accessory.getByRole("alert").waitFor({ state: "visible" });
  console.log("[workbook-annotation] changed file rejected");
  assert.equal(
    starts().length,
    before + 1,
    "changed source does not reach provider",
  );
  for (const body of bodies)
    assert.ok((await accessory.innerText()).includes(body));
  await page.screenshot({
    path: path.join(evidenceDir, "workbook-range-file-changed.png"),
  });
  // 通过真实设置路由卸载 Workspace，返回后仍由同一应用 scope 保留批注。
  const originalComposer = await composer.elementHandle();
  await page.getByTestId("app-sidebar-nav-settings").click();
  await page.getByTestId("settings-navigation").waitFor({ state: "visible" });
  await composer.waitFor({ state: "detached" });
  assert.ok(originalComposer);
  assert.equal(
    await originalComposer.evaluate((node) => node.isConnected),
    false,
    "settings navigation really unmounts the original Workspace Composer",
  );
  await page.getByTestId("settings-back-button").click();
  await composer.waitFor({ state: "visible" });
  await accessory.waitFor({ state: "visible" });
  await accessory.getByRole("alert").waitFor({ state: "visible" });
  await accessory
    .getByRole("button", {
      name: "Preview-report.xlsx · 2 条批注",
      exact: true,
    })
    .click();
  for (const body of bodies)
    assert.ok((await accessory.innerText()).includes(body));
  assert.equal(starts().length, before + 1, "navigation never resends a draft");
  assert.equal(await readComposerEditorText(composer), mainDraft);
  await page.screenshot({
    path: path.join(evidenceDir, "workbook-range-workspace-remounted.png"),
  });
  for (let index = 0; index < 2; index++) {
    await accessory
      .locator("li button")
      .filter({ hasText: bodies[index] })
      .click();
    await editor
      .getByRole("button", { name: "在最新文件中重新定位", exact: true })
      .click();
    await ready();
    await select(
      index === 0 ? "预算" : "明细",
      index === 0 ? "B2:B4" : "A1:B1",
    );
    await panel.getByRole("button", { name: "添加批注", exact: true }).click();
    assert.equal(await editor.getByRole("textbox").inputValue(), bodies[index]);
    await close();
  }
  await page.screenshot({
    path: path.join(evidenceDir, "workbook-range-composer-review.png"),
  });
  await accessory
    .getByRole("button", { name: "发送全部批注", exact: true })
    .click();
  await accessory.waitFor({ state: "detached" });
  const thread = await waitCompleted(before + 2);
  const batch =
    starts()[before + 1]?.runtimeRequest?.metadata?.artifactAnnotationBatch;
  assert.ok(batch);
  assert.equal(
    starts().length,
    before + 2,
    "one batch creates exactly one additional Turn",
  );
  assert.equal(batch.type, "workbook");
  assert.equal(batch.path, filePath);
  assert.equal(batch.sessionId, identity.sessionId);
  assert.equal(batch.threadId, identity.threadId);
  assert.equal(batch.originatingTurnId, first.turns.at(-1).id);
  assert.equal(new Set(batch.comments.map((comment) => comment.id)).size, 2);
  assert.deepEqual(
    batch.comments.map(
      ({
        type,
        sourceFormat,
        sheetName,
        sheetId,
        address,
        body,
        sourceSha256,
      }) => ({
        type,
        sourceFormat,
        sheetName,
        sheetId,
        address,
        body,
        sourceSha256,
      }),
    ),
    bodies.map((body, index) => ({
      type: "workbook",
      sourceFormat: "xlsx",
      sheetName: index === 0 ? "预算" : "明细",
      sheetId: String(index + 1),
      address: index === 0 ? "B2:B4" : "A1:B1",
      body,
      sourceSha256: revisedSha,
    })),
  );
  for (const turn of first.turns) {
    const after = thread.turns.find((item) => item.id === turn.id);
    assert.deepEqual(
      after.items.map((item) => item.id),
      turn.items.map((item) => item.id),
    );
  }
  for (const body of bodies)
    assert.ok(JSON.stringify(thread.turns.at(-1).items).includes(body));
  const bubble = page
    .locator('[data-message-role="user"]')
    .filter({ hasText: bodies[0] });
  await bubble.waitFor({ state: "visible" });
  const display = await bubble.innerText();
  for (const body of bodies) assert.ok(display.includes(body));
  assert.ok(display.includes("预算!B2:B4") && display.includes("明细!A1:B1"));
  assert.ok(
    !display.includes("sourceSha256") &&
      !display.includes("Request changes to the workbook"),
  );
  assert.equal(await readComposerEditorText(composer), mainDraft);
  await page.screenshot({
    path: path.join(evidenceDir, "workbook-range-accepted.png"),
  });
  return {
    single,
    batch,
    turnId: thread.turns.at(-1).id,
    sourceChangeRejected: true,
    workspaceRemountPreserved: true,
    filesSameInstanceReused: true,
    filesColdReopenLocated: true,
    mainComposerPreserved: true,
    providerRequests: starts().length,
  };
}
