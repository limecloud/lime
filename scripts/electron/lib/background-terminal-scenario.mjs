import assert from "node:assert/strict";
import { invokeAppServerFromPage } from "../../lib/chat-fixture/rpc.mjs";
import { closeThreadSidePanelTab } from "./thread-side-panel-navigation.mjs";

export const BACKGROUND_MARKER = "LIME_SUMMARY_BACKGROUND";
export const BACKGROUND_FINAL = "Background commands are still running.";

/** 模型响应仅触发真实工具；进程、输出和终态必须来自current runtime。 */
export function backgroundResponses() {
  const command = (suffix) => ({
    type: "tool_call",
    id: `call-background-${suffix}`,
    name: "exec_command",
    arguments: {
      cmd: `i=0; while [ "$i" -lt 240 ]; do i=$((i+1)); printf '${BACKGROUND_MARKER}_${suffix}_%s\\n' "$i"; sleep 1; done`,
      tty: true,
      yield_time_ms: 250,
    },
  });
  return [
    command("A"),
    command("B"),
    { type: "text", content: BACKGROUND_FINAL },
  ];
}

export async function verifyBackgroundTerminals({
  page,
  identity,
  requestLog,
  options,
  capture,
  record,
}) {
  const rpc = (method, params) =>
    invokeAppServerFromPage(page, method, params, requestLog).then(
      (r) => r.result,
    );
  const read = () =>
    rpc("thread/read", { threadId: identity.threadId, includeTurns: true });
  const list = () =>
    rpc("thread/backgroundTerminals/list", { threadId: identity.threadId });
  let running;
  await page.getByText(BACKGROUND_FINAL, { exact: false }).first().waitFor();
  // waitForFunction只执行同步predicate；App Server读取保持await且不得合成终态。
  const poll = async (predicate, label) => {
    const started = Date.now();
    let last;
    while (Date.now() - started < options.timeoutMs) {
      last = await predicate();
      if (last) return last;
      await page.waitForTimeout(options.intervalMs);
    }
    throw new Error(
      `Background terminal Gate B timeout: ${label}; last=${JSON.stringify(last)}`,
    );
  };
  running = await poll(async () => {
    const { thread } = await read();
    const turn = thread.turns.at(-1);
    const commands =
      turn?.items.filter((i) => i.type === "commandExecution") ?? [];
    return turn?.status === "completed" &&
      commands.length === 2 &&
      commands.every((i) => i.status === "inProgress")
      ? { thread, turn, commands }
      : null;
  }, "completed turn retains two inProgress commands");
  const initial = await list();
  record?.({ running, initial });
  assert.equal(initial.data.length, 2);
  for (const terminal of initial.data) {
    assert.ok(running.commands.some((item) => item.id === terminal.itemId));
  }
  const section = () =>
    page.locator('[data-summary-section="background-tasks"]:visible');
  const showSummary = async () => {
    if (!(await section().isVisible())) {
      await page.getByTestId("thread-workspace-summary-toggle").click();
    }
    await section().waitFor({ state: "visible" });
  };
  await showSummary();
  assert.equal(await section().locator("button[title]").count(), 4);
  await capture("processes");
  const command = running.commands.find((item) =>
    item.command.includes(`${BACKGROUND_MARKER}_A`),
  );
  assert.ok(command);
  const open = async () => {
    await showSummary();
    await section()
      .getByRole("button", { name: command.command, exact: true })
      .click();
    await page
      .getByTestId("background-terminal-tab")
      .waitFor({ state: "visible" });
    assert.equal(
      await page
        .getByTestId("background-terminal-tab")
        .getAttribute("data-item-id"),
      command.id,
    );
  };
  await open();
  const output = page.locator(
    '[data-testid="background-terminal-tab"]:visible .xterm-rows',
  );
  await poll(
    async () => (await output.innerText()).includes(`${BACKGROUND_MARKER}_A_`),
    "visible output",
  );
  const before = (await read()).thread.turns
    .at(-1)
    .items.find((item) => item.id === command.id).aggregatedOutput;
  await poll(async () => {
    const item = (await read()).thread.turns
      .at(-1)
      .items.find((item) => item.id === command.id);
    return item.aggregatedOutput.length > before.length;
  }, "canonical output grows");
  await capture("output");
  await closeThreadSidePanelTab(page, "background-terminal");
  const afterClose = await list();
  assert.deepEqual(
    afterClose.data.map((t) => t.processId).sort(),
    initial.data.map((t) => t.processId).sort(),
  );
  await open();
  await poll(
    async () => (await output.innerText()).includes(`${BACKGROUND_MARKER}_A_`),
    "reopened output",
  );
  await capture("reopened");
  // 输出panel必须只读；真实键盘输入不得变成stdin或启动新进程。
  await page.getByTestId("background-terminal-tab").click();
  await page.keyboard.type("LIME_MUST_NOT_REACH_STDIN");
  await showSummary();
  await section().locator("button[title]").nth(1).click();
  await poll(
    async () => (await list()).data.length === 0,
    "stop all removes runtime processes",
  );
  record?.({ afterStopAll: await read(), processes: await list() });
  const stopped = await poll(async () => {
    const { thread } = await read();
    const commands = thread.turns
      .at(-1)
      .items.filter((item) => item.type === "commandExecution");
    return commands.length === 2 &&
      commands.every((item) => item.status !== "inProgress")
      ? thread
      : null;
  }, "stop all updates canonical items");
  await section().waitFor({ state: "hidden" });
  await capture("stopped");
  return {
    threadId: identity.threadId,
    turnId: running.turn.id,
    itemIds: running.commands.map((item) => item.id),
    processIds: initial.data.map((terminal) => terminal.processId),
    completedTurnRetainsCommands: true,
    outputGrew: true,
    closePreservesProcesses: true,
    reopenedSameItem: true,
    stopped,
  };
}
