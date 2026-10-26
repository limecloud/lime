import { sanitizeJson, sleep } from "../lib/chat-fixture/utils.mjs";
import {
  coreImagePromptText,
  modelIdToVisibleLabel,
  normalizeTextForLooseMatch,
} from "./claw-image-live-smoke-common.mjs";
import { INTERNAL_UI_MARKERS } from "./claw-image-live-smoke-options.mjs";

export function extractSessionAndTurn(inputSend) {
  const turnStart = inputSend?.afterClick?.matchingTurnStartTrace ?? null;
  const sessionId =
    normalizedString(turnStart?.threadId) ||
    normalizedString(turnStart?.sessionId) ||
    normalizedString(inputSend?.clicked?.sessionId) ||
    normalizedString(inputSend?.sendReady?.editorSessionId) ||
    normalizedString(inputSend?.before?.editorSessionId);
  const turnId = normalizedString(turnStart?.turnId);
  return {
    sessionId,
    turnId,
    turnStart: sanitizeJson(turnStart),
  };
}

function normalizedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function assertSingleVisiblePrompt(snapshot, phase) {
  if (!snapshot) {
    return;
  }
  const maxCount = Math.max(
    snapshot.promptOccurrenceCount ?? 0,
    snapshot.imagePromptOccurrenceCount ?? 0,
  );
  if (maxCount > 1) {
    throw new Error(
      `live @配图 ${phase} 同一 prompt 被重复渲染: ${JSON.stringify(
        sanitizeJson({
          promptOccurrenceCount: snapshot.promptOccurrenceCount,
          imagePromptOccurrenceCount: snapshot.imagePromptOccurrenceCount,
          pendingTexts: snapshot.pendingTexts,
          mainText: snapshot.mainText?.slice(0, 2000),
        }),
      )}`,
    );
  }
}

export async function waitForLiveImagePendingPromptStable(
  page,
  options,
  prompt,
) {
  const startedAt = Date.now();
  const timeoutMs = Math.min(options.timeoutMs, 15_000);
  let lastSnapshot = null;
  let bestSnapshot = null;
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await page.evaluate(
      ({ normalizedPrompt, normalizedImagePrompt }) => {
        const mainText = document.querySelector("main")?.innerText || "";
        const normalizeLoose = (value) =>
          String(value || "")
            .trim()
            .replace(/\s+/g, "")
            .replace(/[，。！？、,.!?;；:："'“”‘’`()[\]{}<>《》]/g, "")
            .toLowerCase();
        const normalizedMainText = normalizeLoose(mainText);
        const countNormalizedOccurrences = (needle) => {
          if (!needle) {
            return 0;
          }
          let count = 0;
          let fromIndex = 0;
          while (fromIndex < normalizedMainText.length) {
            const index = normalizedMainText.indexOf(needle, fromIndex);
            if (index < 0) {
              break;
            }
            count += 1;
            fromIndex = index + needle.length;
          }
          return count;
        };
        const pendingTexts = [
          "正在准备回复",
          "正在生成回复",
          "正在准备",
          "正在生成",
          "正在输出",
          "已完成思考",
        ].filter((text) => mainText.includes(text));
        return {
          url: window.location.href,
          promptOccurrenceCount: countNormalizedOccurrences(normalizedPrompt),
          imagePromptOccurrenceCount: countNormalizedOccurrences(
            normalizedImagePrompt,
          ),
          userMessageVisible: mainText.includes("@配图"),
          pendingTexts,
          mainText,
        };
      },
      {
        normalizedPrompt: normalizeTextForLooseMatch(prompt),
        normalizedImagePrompt: normalizeTextForLooseMatch(
          coreImagePromptText(prompt),
        ),
      },
    );
    lastSnapshot = snapshot;
    assertSingleVisiblePrompt(snapshot, "生成中");
    if (
      !bestSnapshot &&
      (snapshot.userMessageVisible ||
        snapshot.promptOccurrenceCount > 0 ||
        snapshot.imagePromptOccurrenceCount > 0 ||
        snapshot.pendingTexts.length > 0)
    ) {
      bestSnapshot = snapshot;
    }
    if (bestSnapshot && Date.now() - startedAt > 2_500) {
      return sanitizeJson({
        ...bestSnapshot,
        mainText: undefined,
      });
    }
    await sleep(Math.min(options.intervalMs, 500));
  }

  return sanitizeJson({
    ...(bestSnapshot ?? lastSnapshot),
    mainText: undefined,
  });
}

export async function waitForLiveImageGuiTerminal(page, options, prompt) {
  const startedAt = Date.now();
  let lastSnapshot = null;
  while (Date.now() - startedAt < options.timeoutMs) {
    const snapshot = await page.evaluate(
      ({
        prompt,
        normalizedPrompt,
        normalizedImagePrompt,
        modelPreference,
        modelLabel,
        forbiddenMarkers,
      }) => {
        const bodyText = document.body?.innerText || "";
        const mainText = document.querySelector("main")?.innerText || bodyText;
        const normalizeLoose = (value) =>
          String(value || "")
            .trim()
            .replace(/\s+/g, "")
            .replace(/[，。！？、,.!?;；:："'“”‘’`()[\]{}<>《》]/g, "")
            .toLowerCase();
        const imageCards = Array.from(
          document.querySelectorAll(
            '[data-testid^="image-workbench-message-preview-"]',
          ),
        ).map((card) => {
          const cardText = card.textContent || "";
          const images = Array.from(card.querySelectorAll("img")).map(
            (image) => {
              const rect = image.getBoundingClientRect();
              return {
                complete: image.complete,
                naturalWidth: image.naturalWidth,
                naturalHeight: image.naturalHeight,
                width: rect.width,
                height: rect.height,
                srcKind: image.currentSrc.startsWith("data:image/")
                  ? "data"
                  : image.currentSrc.startsWith("http")
                    ? "remote"
                    : image.currentSrc
                      ? "other"
                      : "empty",
              };
            },
          );
          return {
            testId: card.getAttribute("data-testid") || "",
            modelId: card.getAttribute("data-model-id") || "",
            text: cardText,
            hasImageGenerationLabel: /Image Generation|图片生成/i.test(
              cardText,
            ),
            hasModel:
              card.getAttribute("data-model-id") === modelPreference ||
              cardText.includes(modelPreference) ||
              (modelLabel ? cardText.includes(modelLabel) : false),
            imageCount: images.length,
            loadedImageCount: images.filter(
              (image) =>
                image.complete &&
                image.naturalWidth > 1 &&
                image.naturalHeight > 1 &&
                image.width > 24 &&
                image.height > 24,
            ).length,
            images,
          };
        });
        const normalizedMainText = normalizeLoose(mainText);
        const countNormalizedOccurrences = (needle) => {
          if (!needle) {
            return 0;
          }
          let count = 0;
          let fromIndex = 0;
          while (fromIndex < normalizedMainText.length) {
            const index = normalizedMainText.indexOf(needle, fromIndex);
            if (index < 0) {
              break;
            }
            count += 1;
            fromIndex = index + needle.length;
          }
          return count;
        };
        // Completed reasoning is folded into the current timeline summary.
        const reasoningSummaryVisible = Array.from(
          document.querySelectorAll(
            '[data-testid^="message-list-historical-timeline-preview:"]',
          ),
        ).some((summary) => {
          const rect = summary.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            /[1-9]\d*(?:\.\d+)?[Kk]?\s*条思路/.test(
              summary.getAttribute("aria-label") || "",
            )
          );
        });
        const reasoningVisible =
          reasoningSummaryVisible ||
          mainText.includes("已完成思考") ||
          mainText.includes("思考") ||
          mainText.includes("Thinking");
        const tokenVisible = /\d+(?:\.\d+)?[Kk]?\s*Tokens?\b/.test(mainText);
        const promptVisible =
          normalizedMainText.includes(normalizedPrompt) ||
          (normalizedImagePrompt
            ? normalizedMainText.includes(normalizedImagePrompt)
            : false);
        const userMessageVisible =
          mainText.includes("@配图") &&
          (!normalizedImagePrompt ||
            normalizedMainText.includes(normalizedImagePrompt));
        const stopVisible = Array.from(
          document.querySelectorAll("button"),
        ).some((button) => {
          const label = [
            button.getAttribute("title") || "",
            button.getAttribute("aria-label") || "",
            button.textContent || "",
          ].join("\n");
          return (
            !button.disabled &&
            (label.includes("停止") ||
              label.includes("终止") ||
              /\bStop\b/i.test(label))
          );
        });
        const editor = document.querySelector(
          '[data-testid="composer-editor"][role="textbox"]',
        );
        const editorRect = editor?.getBoundingClientRect();
        const editorVisible = Boolean(
          editor &&
          editorRect &&
          editorRect.width > 16 &&
          editorRect.height > 16,
        );
        const rightSurfaceHost = document.querySelector(
          '[data-testid="workspace-right-surface-host"]',
        );
        const rightSurfaceVisible = Boolean(
          rightSurfaceHost &&
          rightSurfaceHost.getBoundingClientRect().width > 40 &&
          rightSurfaceHost.getBoundingClientRect().height > 40,
        );
        const forbiddenVisibleMarkers = forbiddenMarkers.filter((marker) =>
          mainText.includes(marker),
        );
        const assistantTextBlocks = Array.from(
          document.querySelectorAll('[data-testid="message-turn-group"]'),
        )
          .map((group) => group.textContent || "")
          .filter((text) => text && !text.includes(prompt));
        const hasNonCardAssistantText = assistantTextBlocks.some(
          (text) =>
            !/^\s*(Image Generation|图片生成)/i.test(text) &&
            text.replace(/\s+/g, "").length > 12,
        );
        return {
          url: window.location.href,
          promptVisible,
          promptOccurrenceCount: countNormalizedOccurrences(normalizedPrompt),
          imagePromptOccurrenceCount: countNormalizedOccurrences(
            normalizedImagePrompt,
          ),
          userMessageVisible,
          reasoningVisible,
          hasNonCardAssistantText,
          tokenVisible,
          stopVisible,
          editorVisible,
          editorDisabled:
            editor instanceof HTMLElement
              ? editor.getAttribute("aria-disabled") === "true" ||
                editor.getAttribute("contenteditable") !== "true"
              : null,
          rightSurfaceVisible,
          imageCardCount: imageCards.length,
          imageCards,
          hasImageCard: imageCards.length > 0,
          hasLoadedImage: imageCards.some((card) => card.loadedImageCount > 0),
          hasImageGenerationLabel: imageCards.some(
            (card) => card.hasImageGenerationLabel,
          ),
          hasModelLabel: imageCards.some((card) => card.hasModel),
          forbiddenVisibleMarkers,
          mainText,
        };
      },
      {
        prompt,
        normalizedPrompt: normalizeTextForLooseMatch(prompt),
        normalizedImagePrompt: normalizeTextForLooseMatch(
          coreImagePromptText(prompt),
        ),
        modelPreference: options.modelPreference,
        modelLabel: modelIdToVisibleLabel(options.modelPreference),
        forbiddenMarkers: INTERNAL_UI_MARKERS,
      },
    );
    lastSnapshot = snapshot;
    assertSingleVisiblePrompt(snapshot, "终态");
    if (
      snapshot.userMessageVisible &&
      snapshot.reasoningVisible &&
      snapshot.hasNonCardAssistantText &&
      snapshot.hasImageCard &&
      snapshot.hasImageGenerationLabel &&
      snapshot.hasModelLabel &&
      snapshot.hasLoadedImage &&
      snapshot.tokenVisible &&
      snapshot.stopVisible === false &&
      snapshot.editorVisible &&
      snapshot.editorDisabled === false &&
      snapshot.rightSurfaceVisible === false &&
      snapshot.forbiddenVisibleMarkers.length === 0 &&
      snapshot.promptOccurrenceCount <= 1 &&
      snapshot.imagePromptOccurrenceCount <= 1
    ) {
      return sanitizeJson({
        ...snapshot,
        mainText: undefined,
      });
    }
    await sleep(options.intervalMs);
  }
  throw new Error(
    `live @配图 GUI 终态未达标: ${JSON.stringify(
      sanitizeJson({
        ...lastSnapshot,
        mainText: lastSnapshot?.mainText?.slice(0, 2000),
      }),
    )}`,
  );
}
