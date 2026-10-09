// Test-only Electron reasoning observations; canonical content remains separate from display.
import {
  REASONING_FIRST_VISIBLE_CONTENT_TEXT,
  REASONING_FIRST_VISIBLE_DONE_TEXT,
  REASONING_FIRST_VISIBLE_FINAL_TEXT,
  REASONING_FIRST_VISIBLE_PROMPT,
  REASONING_FIRST_VISIBLE_TEXT,
  SESSION_TITLE,
} from "./claw-chat-current-fixture-constants.mjs";
import {
  evaluatePageSnapshot,
  reloadRendererDocument,
  waitForRendererReady,
  updateConfigFromPage,
} from "./claw-chat-current-fixture-rpc.mjs";
import { sendPromptFromGui } from "./claw-chat-current-fixture-gui-actions.mjs";
import { waitForSessionReadCompleted } from "./claw-chat-current-fixture-read-model-waits.mjs";
import {
  openFixtureSessionFromSidebar,
  waitForGuiSessionVisible,
} from "./claw-chat-current-fixture-session.mjs";
import { readModelLatestTurnStatus } from "./claw-chat-current-fixture-read-model-core.mjs";
import {
  assert,
  sanitizeJson,
  sleep,
} from "./claw-chat-current-fixture-utils.mjs";

export function summarizeReasoningFirstVisibleReadModel(readModel) {
  const serialized = JSON.stringify(readModel || {});
  // Use the public v2 response once; aggregating aliases can repeat the same collection.
  const thread = readModel?.thread;
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const promptTurns = turns.filter((turn) =>
    turn.items?.some(
      (item) =>
        item.type === "userMessage" &&
        JSON.stringify(item).includes(REASONING_FIRST_VISIBLE_PROMPT),
    ),
  );
  const turn = promptTurns.length === 1 ? promptTurns[0] : null;
  const items = Array.isArray(turn?.items) ? turn.items : [];
  const reasoningItems = items.filter((item) => item?.type === "reasoning");
  const reasoningItem = reasoningItems.length === 1 ? reasoningItems[0] : null;
  const reasoningSequence = reasoningItem ? items.indexOf(reasoningItem) : null;
  const finalItems = items.filter(
    (item) =>
      item?.type === "agentMessage" &&
      item.text?.includes(REASONING_FIRST_VISIBLE_FINAL_TEXT),
  );
  const finalItem = finalItems.length === 1 ? finalItems[0] : null;
  const finalSequence = finalItem ? items.indexOf(finalItem) : null;

  return {
    threadId: thread?.id ?? null,
    turnId: turn?.id ?? null,
    promptTurnCount: promptTurns.length,
    itemCount: items.length,
    itemIds: items.map((item) => item.id ?? null),
    itemIdentitiesUnique:
      items.length > 0 &&
      items.every(
        (item) => typeof item.id === "string" && item.id.length > 0,
      ) &&
      new Set(items.map((item) => item.id)).size === items.length,
    latestTurnStatus: readModelLatestTurnStatus(readModel),
    includesPrompt: serialized.includes(REASONING_FIRST_VISIBLE_PROMPT),
    includesAssistantDone: serialized.includes(
      REASONING_FIRST_VISIBLE_DONE_TEXT,
    ),
    includesFinalText: serialized.includes(REASONING_FIRST_VISIBLE_FINAL_TEXT),
    includesReasoningText: serialized.includes(REASONING_FIRST_VISIBLE_TEXT),
    includesReasoningContentText: serialized.includes(
      REASONING_FIRST_VISIBLE_CONTENT_TEXT,
    ),
    includesReasoningItem: Boolean(reasoningItem),
    reasoningItemCount: reasoningItems.length,
    reasoningItemIds: reasoningItems.map((item) => item.id ?? null),
    reasoningItemId: reasoningItem?.id ?? null,
    reasoningTurnStatus: turn?.status ?? null,
    reasoningSummaryExact:
      JSON.stringify(reasoningItem?.summary) ===
      JSON.stringify([REASONING_FIRST_VISIBLE_TEXT]),
    reasoningContentExact:
      JSON.stringify(reasoningItem?.content) ===
      JSON.stringify([REASONING_FIRST_VISIBLE_CONTENT_TEXT]),
    finalItemCount: finalItems.length,
    finalItemId: finalItem?.id ?? null,
    reasoningSequence,
    finalSequence,
    reasoningSequenceBeforeFinal:
      reasoningSequence != null &&
      finalSequence != null &&
      reasoningSequence < finalSequence,
  };
}

export function isCanonicalReasoningReadModelReady(snapshot) {
  return (
    Boolean(snapshot?.threadId) &&
    Boolean(snapshot?.turnId) &&
    snapshot.promptTurnCount === 1 &&
    snapshot.itemIdentitiesUnique === true &&
    snapshot.reasoningItemCount === 1 &&
    snapshot.reasoningItemId === `${snapshot.turnId}:reasoning:first-visible` &&
    snapshot.reasoningTurnStatus === "completed" &&
    snapshot.reasoningSummaryExact === true &&
    snapshot.reasoningContentExact === true &&
    snapshot.finalItemCount === 1 &&
    snapshot.reasoningSequenceBeforeFinal === true
  );
}

export function isReasoningHistoryPreserved(before, after) {
  return (
    isCanonicalReasoningReadModelReady(before) &&
    isCanonicalReasoningReadModelReady(after) &&
    before.threadId === after.threadId &&
    before.turnId === after.turnId &&
    before.reasoningItemId === after.reasoningItemId &&
    before.finalItemId === after.finalItemId &&
    JSON.stringify(before.itemIds) === JSON.stringify(after.itemIds) &&
    before.reasoningSequence === after.reasoningSequence &&
    before.finalSequence === after.finalSequence
  );
}

export async function runReasoningFirstVisibleScenario({
  page,
  options,
  summary,
  appServerRequests,
  logStage,
  recordPerformanceTrace,
}) {
  logStage("send-reasoning-first-visible-prompt-from-gui");
  summary.reasoningFirstVisibleInputSend = sanitizeJson(
    await sendPromptFromGui(page, options, REASONING_FIRST_VISIBLE_PROMPT),
  );
  logStage("wait-gui-reasoning-first-visible-before-answer");
  summary.guiReasoningFirstVisibleBeforeAnswer = sanitizeJson(
    await waitForGuiReasoningFirstVisibleBeforeAnswer(page, options),
  );
  logStage("wait-gui-reasoning-first-visible-completed");
  summary.guiReasoningFirstVisibleCompleted = sanitizeJson(
    await waitForGuiReasoningFirstVisibleCompleted(page, options),
  );

  const readCompleted = async () =>
    summarizeReasoningFirstVisibleReadModel(
      await waitForSessionReadCompleted(page, options, appServerRequests, {
        prompt: REASONING_FIRST_VISIBLE_PROMPT,
        doneText: REASONING_FIRST_VISIBLE_DONE_TEXT,
        summaryText: REASONING_FIRST_VISIBLE_FINAL_TEXT,
      }),
    );
  logStage("wait-read-model-reasoning-first-visible-completed");
  summary.readModelReasoningFirstVisibleCompleted = sanitizeJson(
    await readCompleted(),
  );
  assert(
    isCanonicalReasoningReadModelReady(
      summary.readModelReasoningFirstVisibleCompleted,
    ),
    `推理 canonical Item 身份、内容或顺序不一致: ${JSON.stringify(summary.readModelReasoningFirstVisibleCompleted)}`,
  );
  await recordPerformanceTrace();

  logStage("verify-reasoning-history-hydrate-from-sidebar");
  summary.reasoningHistoryReload = await reloadRendererDocument(page, options);
  summary.reasoningHistoryRendererReady = sanitizeJson(
    await waitForRendererReady(page, options),
  );
  summary.reasoningHistorySessionVisible = sanitizeJson(
    await waitForGuiSessionVisible(page, options, SESSION_TITLE),
  );
  summary.reasoningHistorySessionOpened = sanitizeJson(
    await openFixtureSessionFromSidebar(page, options, appServerRequests),
  );
  summary.guiReasoningHistoryRestored = sanitizeJson(
    await waitForGuiReasoningFirstVisibleCompleted(page, options),
  );
  summary.readModelReasoningHistoryRestored = sanitizeJson(
    await readCompleted(),
  );
  assert(
    isReasoningHistoryPreserved(
      summary.readModelReasoningFirstVisibleCompleted,
      summary.readModelReasoningHistoryRestored,
    ),
    `推理历史恢复后 canonical 身份或内容漂移: ${JSON.stringify({ before: summary.readModelReasoningFirstVisibleCompleted, after: summary.readModelReasoningHistoryRestored })}`,
  );

  logStage("verify-shared-raw-reasoning-config-and-history");
  summary.rawReasoningConfigEnabled = sanitizeJson(
    await updateConfigFromPage(
      page,
      (config) => ({ ...config, show_raw_agent_reasoning: true }),
      appServerRequests,
    ),
  );
  await reloadRendererDocument(page, options);
  await waitForRendererReady(page, options);
  await waitForGuiSessionVisible(page, options, SESSION_TITLE);
  await openFixtureSessionFromSidebar(page, options, appServerRequests);
  summary.guiRawReasoningHistory = sanitizeJson(
    await waitForGuiReasoningFirstVisibleCompleted(page, options, true),
  );
  summary.readModelRawReasoningHistory = sanitizeJson(await readCompleted());
  assert(
    isReasoningHistoryPreserved(
      summary.readModelReasoningFirstVisibleCompleted,
      summary.readModelRawReasoningHistory,
    ),
    "显示原文不得改变 canonical identity/content",
  );

  summary.rawReasoningConfigDisabled = sanitizeJson(
    await updateConfigFromPage(
      page,
      (config) => ({ ...config, show_raw_agent_reasoning: false }),
      appServerRequests,
    ),
  );
  await reloadRendererDocument(page, options);
  await waitForRendererReady(page, options);
  await waitForGuiSessionVisible(page, options, SESSION_TITLE);
  await openFixtureSessionFromSidebar(page, options, appServerRequests);
  summary.guiRawReasoningDisabled = sanitizeJson(
    await waitForGuiReasoningFirstVisibleCompleted(page, options),
  );
}

function reasoningFirstVisibleSnapshotFromDom({
  prompt,
  reasoningContentText,
  reasoningText,
  finalText,
  doneText,
}) {
  const text = document.body?.innerText || "";
  const turnGroups = Array.from(
    document.querySelectorAll('[data-testid="message-turn-group"]'),
  );
  const promptTurnGroup =
    [...turnGroups]
      .reverse()
      .find((group) => (group.innerText || "").includes(prompt)) ?? null;
  const scope = promptTurnGroup ?? document;
  const scopedText = promptTurnGroup?.innerText || text;
  const processBlocks = Array.from(
    scope.querySelectorAll(
      [
        '[data-testid="agent-thread-timeline:leading"]',
        '[data-testid="assistant-primary-timeline-shell"]',
        '[data-testid^="agent-thread-block:"][data-testid$=":process"]',
      ].join(","),
    ),
  ).map((node) => ({
    testId: node.getAttribute("data-testid") || "",
    text: node.textContent || "",
    open: node instanceof HTMLDetailsElement ? node.open : null,
  }));
  const textarea = document.querySelector(
    'textarea[name="agent-chat-message"]',
  );
  const rect = textarea?.getBoundingClientRect();
  const style = textarea ? window.getComputedStyle(textarea) : null;
  const textareaVisible = Boolean(
    textarea &&
    rect &&
    rect.width > 16 &&
    rect.height > 16 &&
    style?.visibility !== "hidden" &&
    style?.display !== "none",
  );
  const buttons = Array.from(document.querySelectorAll("button")).map(
    (button) => ({
      title: button.getAttribute("title") || "",
      text: button.textContent || "",
      aria: button.getAttribute("aria-label") || "",
      disabled: button.disabled,
    }),
  );
  const stopButtonVisible = buttons.some((button) => {
    const label = [button.title, button.text, button.aria].join("\n");
    return (
      !button.disabled &&
      (label.includes("停止") ||
        label.includes("终止") ||
        /\bStop\b/i.test(label))
    );
  });
  const reasoningIndex = scopedText.indexOf(reasoningText);
  const reasoningContentIndex = scopedText.indexOf(reasoningContentText);
  const finalAnswerIndex = scopedText.indexOf(finalText);
  const hasThinkingLabel =
    scopedText.includes("思考中") || scopedText.includes("已完成思考");
  const hasReasoningProcess =
    hasThinkingLabel ||
    processBlocks.some(
      (block) =>
        block.text.includes(reasoningText) ||
        block.text.includes("思考中") ||
        block.text.includes("已完成思考"),
    );
  const startupNoteVisible =
    text.includes("启动处理流程") || text.includes("已接收请求");

  return {
    url: window.location.href,
    hasPrompt: scopedText.includes(prompt),
    hasReasoningText: reasoningIndex >= 0,
    hasReasoningContentText: reasoningContentIndex >= 0,
    reasoningContentIndex,
    rawReasoningInDom: (
      promptTurnGroup?.textContent ||
      document.body?.textContent ||
      ""
    ).includes(reasoningContentText),
    reasoningSummaryOccurrences: scopedText.split(reasoningText).length - 1,
    rawReasoningOccurrences: scopedText.split(reasoningContentText).length - 1,
    reasoningProcessOpen: processBlocks.some(
      (block) => block.open === true && block.text.includes(reasoningText),
    ),
    hasReasoningProcess,
    hasThinkingLabel,
    hasFinalText: finalAnswerIndex >= 0,
    hasDoneText: scopedText.includes(doneText),
    reasoningIndex,
    finalAnswerIndex,
    hasReasoningBeforeFinalAnswer:
      reasoningIndex >= 0 &&
      (finalAnswerIndex < 0 || reasoningIndex < finalAnswerIndex),
    startupNoteVisible,
    processBlockCount: processBlocks.length,
    processBlocks,
    scopedText,
    bodyText: text,
    textareaVisible,
    textareaDisabled:
      textarea instanceof HTMLTextAreaElement ? textarea.disabled : null,
    textareaValue:
      textarea instanceof HTMLTextAreaElement ? textarea.value : null,
    stopButtonVisible,
    hasMessageList: Boolean(
      document.querySelector('[data-testid="message-list"]') ||
      document.querySelector('[data-testid="message-list-frame"]'),
    ),
  };
}

async function evaluateReasoningFirstVisibleSnapshot(page) {
  return await evaluatePageSnapshot(
    page,
    reasoningFirstVisibleSnapshotFromDom,
    {
      prompt: REASONING_FIRST_VISIBLE_PROMPT,
      reasoningContentText: REASONING_FIRST_VISIBLE_CONTENT_TEXT,
      reasoningText: REASONING_FIRST_VISIBLE_TEXT,
      finalText: REASONING_FIRST_VISIBLE_FINAL_TEXT,
      doneText: REASONING_FIRST_VISIBLE_DONE_TEXT,
    },
  );
}

export async function waitForGuiReasoningFirstVisibleBeforeAnswer(
  page,
  options,
) {
  const startedAt = Date.now();
  let lastSnapshot = null;
  while (Date.now() - startedAt < Math.min(options.timeoutMs, 45_000)) {
    const snapshot = await evaluateReasoningFirstVisibleSnapshot(page);
    if (!snapshot) {
      await sleep(options.intervalMs);
      continue;
    }
    lastSnapshot = snapshot;
    if (
      snapshot.hasPrompt &&
      snapshot.hasReasoningText &&
      snapshot.hasReasoningProcess &&
      snapshot.rawReasoningInDom === false &&
      snapshot.hasReasoningBeforeFinalAnswer &&
      snapshot.hasFinalText === false &&
      snapshot.hasDoneText === false &&
      snapshot.startupNoteVisible === false
    ) {
      return sanitizeJson({
        ...snapshot,
        reasoningFirstVisibleBeforeAnswerCaptured: true,
      });
    }
    await sleep(options.intervalMs);
  }
  throw new Error(
    `Claw GUI 未在最终回答前显示 reasoning: ${JSON.stringify(
      sanitizeJson(lastSnapshot),
    )}`,
  );
}

export function isExpandedReasoningSnapshotReady(snapshot, showRaw = false) {
  return (
    snapshot?.hasReasoningText === true &&
    snapshot?.reasoningSummaryOccurrences === 1 &&
    snapshot?.reasoningProcessOpen === true &&
    snapshot?.hasReasoningContentText === showRaw &&
    snapshot?.rawReasoningInDom === showRaw &&
    (!showRaw || snapshot?.rawReasoningOccurrences === 1)
  );
}

export async function waitForGuiReasoningFirstVisibleCompleted(
  page,
  options,
  showRaw = false,
) {
  const startedAt = Date.now();
  let lastSnapshot = null;
  while (Date.now() - startedAt < options.timeoutMs) {
    const snapshot = await evaluateReasoningFirstVisibleSnapshot(page);
    if (!snapshot) {
      await sleep(options.intervalMs);
      continue;
    }
    lastSnapshot = snapshot;
    if (
      snapshot.hasPrompt &&
      snapshot.hasReasoningText &&
      snapshot.hasFinalText &&
      snapshot.hasReasoningBeforeFinalAnswer &&
      (showRaw || snapshot.hasReasoningContentText === false) &&
      snapshot.startupNoteVisible === false &&
      snapshot.textareaVisible &&
      snapshot.textareaDisabled === false &&
      snapshot.stopButtonVisible === false
    ) {
      const promptTurnGroup = page
        .locator('[data-testid="message-turn-group"]')
        .filter({ hasText: REASONING_FIRST_VISIBLE_PROMPT })
        .last();
      const historicalPreview = promptTurnGroup
        .locator('[data-testid^="message-list-historical-timeline-preview:"]')
        .last();
      const historicalPreviewCount = await historicalPreview.count();
      if (historicalPreviewCount > 0) {
        await historicalPreview.click();
      }

      const reasoningBlock = promptTurnGroup
        .locator(
          'details[data-testid*="agent-thread-block:"][data-testid$=":process"]',
        )
        .last();
      await reasoningBlock.waitFor({
        state: "visible",
        timeout: Math.min(options.timeoutMs, 30_000),
      });
      assert(
        (await reasoningBlock.count()) === 1,
        "Claw GUI 完成态缺少可展开的 reasoning 过程块",
      );
      const detailsAvailable =
        (await reasoningBlock.getAttribute("data-details-available")) ===
        "true";
      assert(detailsAvailable, "Claw GUI 完成态 reasoning 过程块不可展开");
      const reasoningSummary = reasoningBlock.locator(":scope > summary");
      let reasoningOpenedByClick = await reasoningBlock.evaluate(
        (node) => node instanceof HTMLDetailsElement && node.open,
      );
      if (!reasoningOpenedByClick) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await reasoningSummary.click();
          reasoningOpenedByClick = await reasoningBlock.evaluate(
            (node) => node instanceof HTMLDetailsElement && node.open,
          );
          if (reasoningOpenedByClick) {
            break;
          }
        }
      }
      assert(
        reasoningOpenedByClick,
        "Claw GUI 完成态 reasoning 过程块点击后未展开",
      );

      const expandedStartedAt = Date.now();
      let expandedSnapshot = null;
      while (
        Date.now() - expandedStartedAt <
        Math.min(options.timeoutMs, 20_000)
      ) {
        expandedSnapshot = await evaluateReasoningFirstVisibleSnapshot(page);
        if (isExpandedReasoningSnapshotReady(expandedSnapshot, showRaw)) {
          return sanitizeJson({
            ...expandedSnapshot,
            historicalReasoningPreviewExpanded: historicalPreviewCount > 0,
            reasoningDetailsAvailable: detailsAvailable,
            reasoningOpenedByClick,
            reasoningSummaryExpandedAfterCompletion: true,
          });
        }
        await sleep(options.intervalMs);
      }
      throw new Error(
        `Claw GUI 完成态 reasoning 展开后摘要重复、缺失或原文泄漏: ${JSON.stringify(
          sanitizeJson(expandedSnapshot),
        )}`,
      );
    }
    await sleep(options.intervalMs);
  }
  throw new Error(
    `Claw GUI reasoning-first 场景未完成: ${JSON.stringify(
      sanitizeJson(lastSnapshot),
    )}`,
  );
}
