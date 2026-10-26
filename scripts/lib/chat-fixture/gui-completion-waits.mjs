import { withComposerEditorDom } from "../composer-editor-dom.mjs";
import { ASSISTANT_DONE_TEXT, RECOVERY_PROMPT } from "./constants.mjs";
import { evaluatePageSnapshot } from "./rpc.mjs";
import { assert, sanitizeJson, sleep } from "./utils.mjs";

export function isGuiCanceledSnapshotReady(
  snapshot,
  { partialText = "" } = {},
) {
  if (
    !snapshot?.hasPrompt ||
    snapshot.editorVisible !== true ||
    snapshot.editorDisabled !== false ||
    snapshot.stopButtonVisible !== false
  ) {
    return false;
  }

  if (partialText) {
    return snapshot.hasPartialText === true;
  }

  return snapshot.hasStoppedCopy === true;
}

export function isGuiChatCompletedSnapshotReady(
  snapshot,
  { requiredAssistantVisibleTexts = [], expectedIdentity = null } = {},
) {
  const hasRequiredAssistantVisibleTexts = (
    snapshot?.requiredVisibleTextHits || []
  ).every((hit) => hit.occurrences > 0);
  const scopedDedupeGuardHits =
    snapshot?.assistantScopeDedupeGuardHits || snapshot?.dedupeGuardHits || [];
  const scopedDisallowedVisibleTextHits =
    snapshot?.disallowedVisibleTextHits || [];
  const hasExpectedAssistantContent =
    requiredAssistantVisibleTexts.length > 0
      ? snapshot?.hasAssistantSummary && hasRequiredAssistantVisibleTexts
      : snapshot?.hasAssistantSummary || snapshot?.hasDoneText;
  const contentReady =
    snapshot?.hasPrompt &&
    hasExpectedAssistantContent &&
    snapshot?.editorVisible === true &&
    snapshot?.editorDisabled === false &&
    snapshot?.stopButtonVisible === false &&
    scopedDedupeGuardHits.every((hit) => hit.occurrences <= 1) &&
    scopedDisallowedVisibleTextHits.every((hit) => hit.occurrences === 0);
  if (!contentReady || !expectedIdentity) {
    return contentReady;
  }

  const expectedSessionId = String(expectedIdentity.sessionId || "").trim();
  const expectedTurnId = String(expectedIdentity.turnId || "").trim();
  const runtimeTurnStatus = String(
    snapshot.completionScope?.runtimeTurnStatus || "",
  )
    .trim()
    .toLowerCase();
  return (
    expectedSessionId.length > 0 &&
    expectedTurnId.length > 0 &&
    snapshot.editorSessionId === expectedSessionId &&
    snapshot.completionScope?.runtimeTurnId === expectedTurnId &&
    snapshot.completionScope?.assistantRuntimeTurnId === expectedTurnId &&
    ["canceled", "cancelled", "completed", "failed", "interrupted"].includes(
      runtimeTurnStatus,
    )
  );
}

export async function waitForGuiChatCompleted(
  page,
  options,
  {
    prompt = RECOVERY_PROMPT,
    doneText = ASSISTANT_DONE_TEXT,
    summaryText = "会话恢复测试正在运行",
    requiredVisibleTexts,
    dedupeGuardTexts = [],
    disallowedVisibleTexts = ["legacy_tool_event"],
    expectedIdentity = null,
  } = {},
) {
  const startedAt = Date.now();
  let lastSnapshot = null;
  const requiredAssistantVisibleTexts = requiredVisibleTexts ?? [];
  while (Date.now() - startedAt < options.timeoutMs) {
    const snapshot = await evaluatePageSnapshot(
      page,
      withComposerEditorDom(
        ({
          prompt,
          doneText,
          summaryText,
          requiredAssistantVisibleTexts,
          dedupeGuardTexts,
          disallowedVisibleTexts,
        }) => {
          const text = document.body?.innerText || "";
          const mainText = document.querySelector("main")?.innerText || text;
          const turnGroups = Array.from(
            document.querySelectorAll('[data-testid="message-turn-group"]'),
          );
          const promptTurnGroups = turnGroups.filter((group) =>
            (group.innerText || "").includes(prompt),
          );
          const messageListScope =
            document.querySelector('[data-testid="message-list-column"]') ||
            document;
          const readTurnGroupSnapshot = (group) => {
            const groupText = group?.innerText || mainText;
            const assistantBubbles = Array.from(
              (group || messageListScope).querySelectorAll(
                '[data-message-role="assistant"]',
              ),
            );
            const lastAssistantMessageId =
              group?.getAttribute("data-last-assistant-message-id") || "";
            const assistantScope =
              assistantBubbles.find(
                (bubble) =>
                  bubble.getAttribute("data-message-id") ===
                  lastAssistantMessageId,
              ) ??
              assistantBubbles[assistantBubbles.length - 1] ??
              group;
            const assistantScopeText = assistantScope?.innerText || groupText;
            const assistantTurnText = assistantBubbles
              .map((bubble) => bubble.innerText || "")
              .join("\n");
            const hasRequiredAssistantVisibleTexts =
              requiredAssistantVisibleTexts.every((requiredText) =>
                groupText.includes(requiredText),
              );

            return {
              group,
              groupText,
              assistantScope,
              assistantScopeText,
              assistantTurnText,
              hasExpectedAssistantContent:
                requiredAssistantVisibleTexts.length > 0
                  ? assistantScopeText.includes(summaryText) &&
                    hasRequiredAssistantVisibleTexts
                  : assistantScopeText.includes(summaryText) ||
                    assistantScopeText.includes(doneText),
            };
          };
          const scopedSnapshot =
            [...promptTurnGroups]
              .reverse()
              .map(readTurnGroupSnapshot)
              .find((candidate) => candidate.hasExpectedAssistantContent) ??
            (promptTurnGroups.length > 0
              ? readTurnGroupSnapshot(
                  promptTurnGroups[promptTurnGroups.length - 1],
                )
              : readTurnGroupSnapshot(null));
          const scopedTurnGroup = scopedSnapshot.group;
          const scopedText = scopedSnapshot.groupText;
          const assistantScope = scopedSnapshot.assistantScope;
          const assistantScopeText = scopedSnapshot.assistantScopeText;
          const assistantTurnText = scopedSnapshot.assistantTurnText;
          const editor = document.querySelector(
            '[data-testid="composer-editor"][role="textbox"]',
          );
          const rect = editor?.getBoundingClientRect();
          const style = editor ? window.getComputedStyle(editor) : null;
          const editorVisible = Boolean(
            editor &&
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
          return {
            url: window.location.href,
            hasPrompt: scopedText.includes(prompt),
            hasAssistantSummary: assistantScopeText.includes(summaryText),
            requiredVisibleTextHits: requiredAssistantVisibleTexts.map(
              (requiredText) => ({
                text: requiredText,
                occurrences: scopedText.split(requiredText).length - 1,
              }),
            ),
            summaryOccurrences: text.split(summaryText).length - 1,
            mainSummaryOccurrences: mainText.split(summaryText).length - 1,
            dedupeGuardHits: dedupeGuardTexts.map((guardText) => ({
              text: guardText,
              occurrences: mainText.split(guardText).length - 1,
            })),
            disallowedVisibleTextHits: disallowedVisibleTexts.map(
              (guardText) => ({
                text: guardText,
                occurrences: assistantTurnText.split(guardText).length - 1,
              }),
            ),
            scopedSummaryOccurrences: scopedText.split(summaryText).length - 1,
            assistantScopeSummaryOccurrences:
              assistantScopeText.split(summaryText).length - 1,
            scopedDedupeGuardHits: dedupeGuardTexts.map((guardText) => ({
              text: guardText,
              occurrences: scopedText.split(guardText).length - 1,
            })),
            assistantScopeDedupeGuardHits: dedupeGuardTexts.map(
              (guardText) => ({
                text: guardText,
                occurrences: assistantTurnText.split(guardText).length - 1,
              }),
            ),
            completionScope: {
              foundTurnGroup: Boolean(scopedTurnGroup),
              runtimeTurnId:
                scopedTurnGroup?.getAttribute("data-runtime-turn-id") || "",
              runtimeTurnStatus:
                scopedTurnGroup?.getAttribute("data-runtime-turn-status") || "",
              lastAssistantMessageId:
                scopedTurnGroup?.getAttribute(
                  "data-last-assistant-message-id",
                ) || "",
              assistantMessageId:
                assistantScope?.getAttribute("data-message-id") || "",
              assistantRuntimeTurnId:
                assistantScope?.getAttribute("data-runtime-turn-id") || "",
              text: scopedText,
              assistantText: assistantScopeText,
            },
            hasDoneText: assistantScopeText.includes(doneText),
            hasEpochFallbackTitle: text.includes("任务 1970/1/1"),
            editorVisible,
            editorDisabled:
              editor instanceof HTMLElement
                ? editor.getAttribute("aria-disabled") === "true" ||
                  editor.getAttribute("contenteditable") !== "true"
                : null,
            editorSessionId:
              editor instanceof HTMLElement
                ? editor.dataset.sessionId || null
                : null,
            editorText:
              editor instanceof HTMLElement
                ? readComposerEditorTextDom(editor)
                : null,
            stopButtonVisible,
            hasMessageList: Boolean(
              document.querySelector('[data-testid="message-list"]') ||
              document.querySelector('[data-testid="message-list-frame"]'),
            ),
            bodyText: text,
            mainText,
          };
        },
      ),
      {
        prompt,
        doneText,
        summaryText,
        requiredAssistantVisibleTexts,
        dedupeGuardTexts,
        disallowedVisibleTexts,
      },
    );
    if (!snapshot) {
      await sleep(options.intervalMs);
      continue;
    }
    lastSnapshot = snapshot;
    if (
      isGuiChatCompletedSnapshotReady(snapshot, {
        requiredAssistantVisibleTexts,
        expectedIdentity,
      })
    ) {
      return snapshot;
    }
    await sleep(options.intervalMs);
  }
  throw new Error(
    `聊天 GUI 未完成输入闭环: ${JSON.stringify(sanitizeJson(lastSnapshot))}`,
  );
}

export async function waitForStopButtonVisibleAndClick(
  page,
  options,
  {
    prompt = RECOVERY_PROMPT,
    visibleOutputText = "会话恢复测试正在运行",
    requireVisibleOutput = false,
  } = {},
) {
  const startedAt = Date.now();
  let lastSnapshot = null;
  while (Date.now() - startedAt < options.timeoutMs) {
    const snapshot = await evaluatePageSnapshot(
      page,
      ({ prompt, visibleOutputText }) => {
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
        const statusNodes = Array.from(
          scope.querySelectorAll(
            [
              '[data-testid="assistant-first-token-runtime-status"]',
              '[data-testid="message-runtime-status-pill"]',
              '[data-testid="inputbar-runtime-status-line"]',
            ].join(","),
          ),
        );
        const statusSnapshots = statusNodes.map((node) => ({
          testId: node.getAttribute("data-testid") || "",
          status: node.getAttribute("data-status") || "",
          text: node.textContent || "",
        }));
        const startupNoteVisible =
          text.includes("启动处理流程") || text.includes("已接收请求");
        const buttons = Array.from(document.querySelectorAll("button")).map(
          (button, index) => {
            const label = [
              button.getAttribute("title") || "",
              button.textContent || "",
              button.getAttribute("aria-label") || "",
            ].join("\n");
            return {
              index,
              label,
              disabled: button.disabled,
              visible: Boolean(
                button.offsetParent ||
                button.getClientRects().length > 0 ||
                window.getComputedStyle(button).position === "fixed",
              ),
              isStop:
                !button.disabled &&
                (label.includes("停止") ||
                  label.includes("终止") ||
                  /\bStop\b/i.test(label)),
            };
          },
        );
        const hasRunningStatus =
          scopedText.includes("正在输出") ||
          scopedText.includes("正在生成") ||
          statusSnapshots.some(
            (entry) =>
              entry.status === "running" ||
              entry.text.includes("正在输出") ||
              entry.text.includes("正在生成"),
          ) ||
          buttons.some(
            (button) =>
              button.visible &&
              (button.label.includes("正在输出") ||
                button.label.includes("正在生成")),
          );
        return {
          url: window.location.href,
          hasPrompt: text.includes(prompt),
          hasAssistantSummary: text.includes("会话恢复测试正在运行"),
          hasVisibleAssistantOutput: visibleOutputText
            ? scopedText.includes(visibleOutputText)
            : true,
          hasRunningStatus,
          startupNoteVisible,
          statusSnapshots,
          stopButtons: buttons.filter((button) => button.isStop),
          buttonLabels: buttons
            .filter((button) => button.label.trim().length > 0)
            .slice(0, 80)
            .map((button) => button.label),
          scopedText,
          bodyText: text,
        };
      },
      { prompt, visibleOutputText },
    );
    if (!snapshot) {
      await sleep(options.intervalMs);
      continue;
    }
    lastSnapshot = snapshot;
    if (
      snapshot.stopButtons?.length > 0 &&
      (!requireVisibleOutput || snapshot.hasVisibleAssistantOutput === true)
    ) {
      const clicked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button"));
        const stopButton = buttons.find((button) => {
          const label = [
            button.getAttribute("title") || "",
            button.textContent || "",
            button.getAttribute("aria-label") || "",
          ].join("\n");
          return (
            !button.disabled &&
            (label.includes("停止") ||
              label.includes("终止") ||
              /\bStop\b/i.test(label))
          );
        });
        if (stopButton instanceof HTMLElement) {
          stopButton.click();
          return {
            clicked: true,
            label:
              stopButton.getAttribute("aria-label") ||
              stopButton.getAttribute("title") ||
              stopButton.textContent ||
              "stop",
          };
        }
        return { clicked: false };
      });
      assert(
        clicked?.clicked,
        `停止按钮出现但点击失败: ${JSON.stringify(sanitizeJson(clicked))}`,
      );
      return {
        beforeClick: sanitizeJson(snapshot),
        clicked: sanitizeJson(clicked),
      };
    }
    await sleep(options.intervalMs);
  }
  throw new Error(
    `聊天 GUI 未出现停止按钮: ${JSON.stringify(sanitizeJson(lastSnapshot))}`,
  );
}

export async function waitForGuiChatCanceled(
  page,
  options,
  { prompt = RECOVERY_PROMPT, partialText = "" } = {},
) {
  const startedAt = Date.now();
  let lastSnapshot = null;
  while (Date.now() - startedAt < options.timeoutMs) {
    const snapshot = await evaluatePageSnapshot(
      page,
      withComposerEditorDom(({ prompt, partialText }) => {
        const text = document.body?.innerText || "";
        const editor = document.querySelector(
          '[data-testid="composer-editor"][role="textbox"]',
        );
        const rect = editor?.getBoundingClientRect();
        const style = editor ? window.getComputedStyle(editor) : null;
        const editorVisible = Boolean(
          editor &&
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
        const assistantBubbles = Array.from(
          document.querySelectorAll('[data-message-role="assistant"]'),
        ).map((bubble) => ({
          messageId: bubble.getAttribute("data-message-id") || "",
          runtimeTurnId: bubble.getAttribute("data-runtime-turn-id") || "",
          threadItemId: bubble.getAttribute("data-thread-item-id") || "",
          contentPartTypes:
            bubble.getAttribute("data-message-content-part-types") || "",
          rendererContentPartTypes:
            bubble.getAttribute("data-renderer-content-part-types") || "",
          text: bubble.textContent || "",
        }));
        const turnGroups = Array.from(
          document.querySelectorAll('[data-testid="message-turn-group"]'),
        ).map((group) => ({
          kind: group.getAttribute("data-render-entry-kind") || "",
          runtimeTurnId: group.getAttribute("data-runtime-turn-id") || "",
          runtimeTurnStatus:
            group.getAttribute("data-runtime-turn-status") || "",
          lastAssistantMessageId:
            group.getAttribute("data-last-assistant-message-id") || "",
          timelineMessageId:
            group.getAttribute("data-timeline-message-id") || "",
          text: group.textContent || "",
        }));
        return {
          url: window.location.href,
          hasPrompt: text.includes(prompt),
          hasAssistantSummary: text.includes("会话恢复测试正在运行"),
          hasPartialText: partialText ? text.includes(partialText) : null,
          hasStoppedCopy:
            text.includes("已停止") ||
            text.includes("本轮已中止") ||
            /\bStopped\b/i.test(text) ||
            /\bCanceled\b/i.test(text),
          editorVisible,
          editorDisabled:
            editor instanceof HTMLElement
              ? editor.getAttribute("aria-disabled") === "true" ||
                editor.getAttribute("contenteditable") !== "true"
              : null,
          editorText:
            editor instanceof HTMLElement
              ? readComposerEditorTextDom(editor)
              : null,
          stopButtonVisible,
          assistantBubbles,
          turnGroups,
          bodyText: text,
        };
      }),
      { prompt, partialText },
    );
    if (!snapshot) {
      await sleep(options.intervalMs);
      continue;
    }
    lastSnapshot = snapshot;
    if (isGuiCanceledSnapshotReady(snapshot, { partialText })) {
      return snapshot;
    }
    await sleep(options.intervalMs);
  }
  throw new Error(
    `聊天 GUI 未完成取消闭环: ${JSON.stringify(sanitizeJson(lastSnapshot))}`,
  );
}
