import {
  replaceFileTab,
  selectThreadSidePanelTool,
} from "./thread-side-panel-navigation.mjs";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { invokeAppServerFromPage } from "../../lib/chat-fixture/rpc.mjs";

export function writeWorkbookPreviewFixture(filePath) {
  fs.copyFileSync(
    "src/components/artifact/workbook/__fixtures__/review.xlsx",
    filePath,
  );
  const root = path.dirname(filePath);
  fs.writeFileSync(
    path.join(root, "Values.csv"),
    '\uFEFF名称,编号,备注\r\n"甲,乙",0012,"第一行\n第二行"\r\n公式,=1+1,原始文本\r\n',
  );
  fs.writeFileSync(path.join(root, "Values.tsv"), "名称\t编号\n真实TSV\t002\n");
  fs.writeFileSync(path.join(root, "Broken.xlsx"), "invalid workbook");
}

export async function runWorkbookPreviewScenario({
  page,
  evidenceDir,
  filePath,
  identity,
  options,
}) {
  const panel = page.getByTestId("workbook-preview-panel");
  const ready = async (filename = "Preview-report.xlsx") => {
    // 点击换文件/重试后，旧 DOM 可暂时仍是 ready/error；等待目标文件真正 ready。
    await page.waitForFunction((filename) => {
      const current = document.querySelector(
        '[data-testid="workbook-preview-panel"]',
      );
      return (
        current?.getAttribute("aria-label") === filename &&
        current.getAttribute("data-status") === "ready"
      );
    }, filename);
    assert.equal(await panel.getAttribute("data-status"), "ready");
  };
  const cell = (address) => panel.locator(`[data-address="${address}"]`);
  const position = panel.getByRole("textbox", {
    name: "单元格位置",
    exact: true,
  });
  const formula = panel.getByRole("textbox", {
    name: "公式或原始值",
    exact: true,
  });
  const at = async (address) => {
    await position.fill(address);
    await position.press("Enter");
    await page.waitForFunction((address) => {
      const grid = document.querySelector('[data-testid="workbook-grid"]');
      const cell = grid?.querySelector(`[data-address="${address}"]`);
      if (!grid || !cell) return false;
      const outer = grid.getBoundingClientRect(),
        inner = cell.getBoundingClientRect();
      return (
        inner.top >= outer.top + 26 &&
        inner.bottom <= outer.bottom + 2 &&
        inner.left >= outer.left + 46 &&
        inner.right <= outer.right + 2
      );
    }, address);
  };
  await ready();
  assert.equal(await cell("A1").innerText(), "年度预算");
  assert.equal(await cell("A1").getAttribute("aria-colspan"), "3");
  const style = await cell("A1").evaluate((node) => ({
    color: getComputedStyle(node).color,
    background: getComputedStyle(node).backgroundColor,
    weight: getComputedStyle(node).fontWeight,
  }));
  assert.deepEqual(style, {
    color: "rgb(37, 99, 235)",
    background: "rgb(253, 230, 138)",
    weight: "700",
  });
  await cell("B4").click();
  assert.equal(await cell("B4").innerText(), "$1,484.50");
  assert.equal(await formula.innerText(), "=SUM(B2:B3)");
  await panel.getByRole("tab", { name: "明细", exact: true }).click();
  assert.equal(await cell("A1").innerText(), "真实明细");
  assert.equal(
    await cell("B1").innerText(),
    "7",
    "cached formula value is displayed without evaluation",
  );
  await panel.getByRole("tab", { name: "预算", exact: true }).press("Home");
  await at("AD1200");
  assert.equal(await cell("AD1200").innerText(), "远端单元格");
  assert.ok(
    (await panel.getByRole("gridcell").count()) < 500,
    "large worksheet remains virtualized",
  );
  await page.screenshot({
    path: path.join(evidenceDir, "workbook-far-cell.png"),
  });
  await at("A6");
  assert.equal(await cell("A6").innerText(), "<img src=x onerror=alert(1)>");
  assert.equal(await panel.locator("img,script,a").count(), 0);
  await position.fill("XFE1");
  await position.press("Enter");
  assert.equal(await position.getAttribute("aria-invalid"), "true");
  await at("B4");
  await page.setViewportSize({ width: 980, height: 760 });
  await selectThreadSidePanelTool(page, "files");
  await at("B4");
  await page.screenshot({
    path: path.join(evidenceDir, "workbook-narrow.png"),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });

  const open = async (filename) => {
    await replaceFileTab(page, path.join(path.dirname(filePath), filename));
  };
  await open("Values.csv");
  await ready("Values.csv");
  assert.equal(await cell("A2").innerText(), "甲,乙");
  assert.equal(await cell("B2").innerText(), "0012");
  assert.equal(await cell("C2").textContent(), "第一行\n第二行");
  assert.equal(await cell("B3").innerText(), "=1+1");
  await page.screenshot({ path: path.join(evidenceDir, "workbook-csv.png") });
  await open("Values.tsv");
  await ready("Values.tsv");
  assert.equal(await cell("A2").innerText(), "真实TSV");
  assert.equal(await cell("B2").innerText(), "002");
  await open("Broken.xlsx");
  await panel.getByRole("alert").waitFor();
  assert.equal(await panel.getAttribute("data-status"), "error");
  fs.copyFileSync(filePath, path.join(path.dirname(filePath), "Broken.xlsx"));
  await panel.getByRole("button", { name: "重试", exact: true }).click();
  await ready("Broken.xlsx");
  assert.equal(await cell("A1").innerText(), "年度预算");

  const artifactRef = "workbook-native-review";
  const written = await invokeAppServerFromPage(page, "artifact/write", {
    threadId: identity.threadId,
    turnId: identity.turns[0].id,
    artifact: {
      artifactRef,
      kind: "file",
      path: filePath,
      title: "Preview-report.xlsx",
      content: "CANONICAL_WORKBOOK_ARTIFACT: preview the original file bytes.",
      status: "completed",
    },
  });
  assert.equal(written.error, undefined, JSON.stringify(written.error));
  assert.equal(written.result.artifactRef, artifactRef);
  const persistedThread = await invokeAppServerFromPage(page, "thread/read", {
    threadId: identity.threadId,
    includeTurns: true,
  });
  fs.writeFileSync(
    path.join(evidenceDir, "workbook-artifact-thread.json"),
    JSON.stringify(persistedThread, null, 2) + "\n",
  );
  const change = persistedThread.result.thread.turns
    .find((turn) => turn.id === identity.turns[0].id)
    ?.items.find((item) => item.id === `media-${written.result.eventId}`);
  assert.ok(change, "artifact/write retains a canonical file change item");
  assert.equal(change.type, "fileChange");
  assert.equal(change.status, "completed");
  assert.equal(change.changes[0].path, filePath);
  // 已结束会话的外部写入通过真实历史恢复读取；不向 Renderer 注入投影。
  await page.getByTestId("app-sidebar-home-button").click();
  await page
    .locator(
      `[data-testid="app-sidebar-conversation-open"][data-session-id="${identity.sessionId}"]`,
    )
    .click();
  await page.waitForFunction(
    (sessionId) =>
      document
        .querySelector('[data-testid="message-list-frame"]')
        ?.getAttribute("data-session-id") === sessionId,
    identity.sessionId,
  );
  // artifact/write 是文件变更；沿真实变更入口打开，保留 patch/审批语义。
  const file = page
    .getByTestId("file-changes-summary-file-row")
    .filter({ hasText: "Preview-report.xlsx" });
  await page.waitForFunction(() =>
    Boolean(
      document.querySelector(
        '[data-testid="file-changes-summary-file-row"], [data-testid^="message-list-historical-timeline-preview:"]',
      ),
    ),
  );
  const history = page.locator(
    '[data-testid^="message-list-historical-timeline-preview:"]:visible',
  );
  for (let index = 0; index < (await history.count()); index++)
    await history.nth(index).click();
  await file.first().click();
  await ready("Preview-report.xlsx");
  const activeFiles = page
    .getByTestId("workspace-right-surface-active-pane")
    .getByTestId("workspace-files-surface");
  await activeFiles.getByTestId("workbook-preview-panel").waitFor({
    state: "visible",
    timeout: options.timeoutMs,
  });
  const selectedFileTab = page.locator(
    '[data-testid="workspace-right-surface-tab-files"][aria-selected="true"]',
  );
  assert.equal(await selectedFileTab.count(), 1);
  assert.ok(
    (await selectedFileTab.textContent()).includes("Preview-report.xlsx"),
  );
  assert.equal(await cell("A1").innerText(), "年度预算");
  const read = await invokeAppServerFromPage(page, "thread/read", {
    threadId: identity.threadId,
    includeTurns: true,
  });
  assert.deepEqual(
    read.result.thread.turns.map((turn) => turn.id),
    identity.turns.map((turn) => turn.id),
  );
  assert.equal(read.result.thread.id, identity.threadId);
  for (const before of identity.turns) {
    const after = read.result.thread.turns.find(
      (turn) => turn.id === before.id,
    );
    const originalItems = new Set(before.items);
    assert.deepEqual(
      after.items.map((item) => item.id).filter((id) => originalItems.has(id)),
      before.items,
      "adding the artifact preserves the original canonical item identities",
    );
  }
  const artifacts = await invokeAppServerFromPage(page, "artifact/read", {
    sessionId: identity.sessionId,
    artifactRef,
    includeContent: true,
  });
  const persisted = artifacts.result.artifacts.find(
    (item) => item.artifactRef === artifactRef,
  );
  assert.ok(persisted, "artifact is readable from the same canonical thread");
  assert.equal(persisted.turnId, identity.turns[0].id);
  assert.equal(persisted.path, filePath);
  assert.equal(persisted.eventId, written.result.eventId);
  assert.equal(
    persisted.content,
    "CANONICAL_WORKBOOK_ARTIFACT: preview the original file bytes.",
  );
  await page.screenshot({
    path: path.join(evidenceDir, "workbook-canonical-artifact.png"),
  });
  return {
    sheets: ["预算", "明细"],
    farCell: "AD1200",
    csv: true,
    tsv: true,
    errorRetry: true,
    cachedFormula: "7",
    style,
    artifactRef,
    artifactEventId: written.result.eventId,
    artifactItemId: change.id,
    artifactOpenedInFiles: true,
    timeoutMs: options.timeoutMs,
  };
}
