// Test-only canonical reasoning producer for the external Electron fixture.
import {
  REASONING_FIRST_VISIBLE_CONTENT_TEXT,
  REASONING_FIRST_VISIBLE_DONE_TEXT,
  REASONING_FIRST_VISIBLE_FINAL_TEXT,
  REASONING_FIRST_VISIBLE_TEXT,
} from "./claw-chat-current-fixture-constants.mjs";

export async function runReasoningBackend({
  sessionId,
  threadId,
  turnId,
  finalAnswerItemId,
  followupText,
  summaryText,
  contentText,
  finalText,
  doneText,
  emitEvents,
  sleep,
  providerTracePayload,
  messageDeltaPayload,
}) {
  const itemId = `${turnId}:reasoning:first-visible`;
  const createdAtMs = Date.now();
  const reasoningItem = (status, summary, content) => {
    const updatedAtMs = Date.now();
    return {
      item: {
        sessionId,
        threadId,
        turnId,
        itemId,
        sequence: 0,
        ordinal: 2,
        createdAtMs,
        updatedAtMs,
        ...(status === "completed" ? { completedAtMs: updatedAtMs } : {}),
        kind: "reasoning",
        status,
        payload: { type: "reasoning", summary, content },
        metadata: {},
      },
    };
  };

  emitEvents([
    { type: "item.started", payload: reasoningItem("inProgress", [], []) },
    {
      type: "reasoning.summary",
      payload: { itemId, summary: summaryText, summaryIndex: 0 },
    },
    {
      type: "reasoning.delta",
      payload: { itemId, delta: contentText, contentIndex: 0 },
    },
  ]);
  // A controlled producer gap lets the GUI observe the summary before the answer.
  await sleep(5000);
  emitEvents([
    {
      type: "item.completed",
      payload: reasoningItem("completed", [summaryText], [contentText]),
    },
    {
      type: "provider.first_text_delta.received",
      payload: providerTracePayload(
        "first_text_delta_received",
        5200,
        "running",
        {
          text_chars: followupText.length,
          textChars: followupText.length,
        },
      ),
    },
    {
      type: "message.delta",
      payload: messageDeltaPayload(
        followupText,
        "final_answer",
        finalAnswerItemId,
      ),
    },
    {
      type: "turn.completed",
      payload: { status: "completed", text: `${finalText}\n${doneText}` },
    },
  ]);
}

export function renderReasoningBackendEvents() {
  return `
  if (isReasoningFirstVisiblePrompt) {
    await (${runReasoningBackend.toString()})({
      sessionId: input.request?.session?.sessionId,
      threadId: currentThreadId(),
      turnId: currentTurnId(),
      finalAnswerItemId,
      followupText,
      summaryText: ${JSON.stringify(REASONING_FIRST_VISIBLE_TEXT)},
      contentText: ${JSON.stringify(REASONING_FIRST_VISIBLE_CONTENT_TEXT)},
      finalText: ${JSON.stringify(REASONING_FIRST_VISIBLE_FINAL_TEXT)},
      doneText: ${JSON.stringify(REASONING_FIRST_VISIBLE_DONE_TEXT)},
      emitEvents, sleep, providerTracePayload, messageDeltaPayload
    });
    process.exit(0);
  }
`;
}
