import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isCanonicalReasoningReadModelReady,
  isExpandedReasoningSnapshotReady,
  isReasoningHistoryPreserved,
  summarizeReasoningFirstVisibleReadModel,
} from "./reasoning-fixture.mjs";
import { runReasoningBackend } from "./reasoning-backend.mjs";
import { writeFixtureBackend } from "./claw-chat-current-fixture-backend-script.mjs";
import {
  REASONING_FIRST_VISIBLE_CONTENT_TEXT,
  REASONING_FIRST_VISIBLE_FINAL_TEXT,
  REASONING_FIRST_VISIBLE_PROMPT,
  REASONING_FIRST_VISIBLE_TEXT,
} from "./claw-chat-current-fixture-constants.mjs";
import { buildReasoningFirstVisibleScenarioAssertions } from "./claw-chat-current-fixture-runtime-surface-assertions.mjs";

const expanded = {
  hasReasoningText: true,
  reasoningSummaryOccurrences: 1,
  reasoningProcessOpen: true,
  hasReasoningContentText: false,
  rawReasoningInDom: false,
};

describe("Electron reasoning fixture display policy", () => {
  it("explicit raw visibility requires one visible canonical raw body", () => {
    const visible = {
      ...expanded,
      hasReasoningContentText: true,
      rawReasoningInDom: true,
      rawReasoningOccurrences: 1,
    };
    expect(isExpandedReasoningSnapshotReady(visible, true)).toBe(true);
    expect(isExpandedReasoningSnapshotReady(visible)).toBe(false);
    expect(
      isExpandedReasoningSnapshotReady(
        { ...visible, rawReasoningOccurrences: 2 },
        true,
      ),
    ).toBe(false);
    expect(isExpandedReasoningSnapshotReady(expanded, true)).toBe(false);
  });
  it("accepts one expanded summary while the raw content stays absent", () => {
    expect(isExpandedReasoningSnapshotReady(expanded)).toBe(true);
  });

  it("rejects visible or hidden DOM leakage of raw reasoning", () => {
    for (const leak of [
      { hasReasoningContentText: true },
      { rawReasoningInDom: true },
    ]) {
      expect(isExpandedReasoningSnapshotReady({ ...expanded, ...leak })).toBe(
        false,
      );
    }
  });

  it("rejects repeated, missing, closed or incomplete observations", () => {
    for (const invalid of [
      { reasoningSummaryOccurrences: 2 },
      { reasoningSummaryOccurrences: 0 },
      { hasReasoningText: false },
      { reasoningProcessOpen: false },
      { rawReasoningInDom: undefined },
    ]) {
      expect(
        isExpandedReasoningSnapshotReady({ ...expanded, ...invalid }),
      ).toBe(false);
    }
    expect(isExpandedReasoningSnapshotReady(null)).toBe(false);
  });

  it("requires canonical content even though the GUI hides it", () => {
    const readModel = {
      includesPrompt: true,
      latestTurnStatus: "completed",
      includesFinalText: true,
      includesReasoningText: true,
      includesReasoningContentText: true,
    };
    const assertions = (content) =>
      buildReasoningFirstVisibleScenarioAssertions({
        summary: {
          readModelReasoningFirstVisibleCompleted: {
            ...readModel,
            includesReasoningContentText: content,
          },
        },
      }).readModelReasoningFirstVisibleCompleted;
    expect(assertions(true)).toBe(true);
    expect(assertions(false)).toBe(false);
  });

  it("keeps reasoning observations out of the generic waits and scenario router", () => {
    const source = (file) =>
      readFileSync(`scripts/agent-runtime/${file}`, "utf8");
    expect(
      source("claw-chat-current-fixture-gui-completion-waits.mjs"),
    ).not.toContain("function reasoningFirstVisibleSnapshotFromDom");
    expect(source("claw-chat-current-fixture-scenario-flow.mjs")).not.toContain(
      "function summarizeReasoningFirstVisibleReadModel",
    );
    for (const file of [
      "claw-chat-current-fixture-gui-completion-waits.mjs",
      "claw-chat-current-fixture-scenario-flow.mjs",
    ])
      expect(source(file).split("\n").length).toBeLessThan(1000);
    expect(source("reasoning-fixture.mjs").split("\n").length).toBeLessThan(
      800,
    );
    expect(source("reasoning-fixture.mjs")).not.toContain(
      "reasoningContentExpandedAfterCompletion",
    );
  });
});

function canonicalRead() {
  return {
    thread: {
      id: "thread-reasoning",
      turns: [
        {
          id: "turn-reasoning",
          status: "completed",
          items: [
            {
              type: "userMessage",
              id: "user-input",
              content: [{ type: "text", text: REASONING_FIRST_VISIBLE_PROMPT }],
            },
            {
              type: "reasoning",
              id: "turn-reasoning:reasoning:first-visible",
              summary: [REASONING_FIRST_VISIBLE_TEXT],
              content: [REASONING_FIRST_VISIBLE_CONTENT_TEXT],
            },
            {
              type: "agentMessage",
              id: "assistant-answer",
              text: REASONING_FIRST_VISIBLE_FINAL_TEXT,
            },
          ],
        },
      ],
    },
  };
}

describe("canonical reasoning identity and cold history", () => {
  const summarize = summarizeReasoningFirstVisibleReadModel;

  it("binds the canonical observation to the submitted backend Turn and GUI Thread", () => {
    const snapshot = summarize(canonicalRead());
    const check = (threadId, turnId) =>
      buildReasoningFirstVisibleScenarioAssertions({
        reasoningFirstVisibleTurnStart: { turnId },
        summary: {
          threadId,
          readModelReasoningFirstVisibleCompleted: snapshot,
        },
      }).readModelReasoningFirstVisibleItemObserved;
    expect(check(snapshot.threadId, snapshot.turnId)).toBe(true);
    expect(check("other-thread", snapshot.turnId)).toBe(false);
    expect(check(snapshot.threadId, "other-turn")).toBe(false);
  });

  it("reads the public typed collection once even when an observation repeats it", () => {
    const read = canonicalRead();
    read.detail = { threadRead: read.thread };
    const snapshot = summarize(read);
    expect(snapshot.reasoningItemIds).toEqual([
      "turn-reasoning:reasoning:first-visible",
    ]);
    expect(snapshot.reasoningSequence).toBe(1);
    expect(snapshot.finalSequence).toBe(2);
    expect(isCanonicalReasoningReadModelReady(snapshot)).toBe(true);
    expect(
      isReasoningHistoryPreserved(snapshot, summarize(canonicalRead())),
    ).toBe(true);
  });

  it("rejects actual duplicate Items with equal or different IDs without text deduplication", () => {
    for (const id of [
      "turn-reasoning:reasoning:first-visible",
      "second-reasoning",
    ]) {
      const read = canonicalRead();
      read.thread.turns[0].items.splice(2, 0, {
        ...read.thread.turns[0].items[1],
        id,
      });
      const snapshot = summarize(read);
      expect(snapshot.reasoningItemCount).toBe(2);
      expect(snapshot.reasoningItemIds).toEqual([
        "turn-reasoning:reasoning:first-visible",
        id,
      ]);
      expect(isCanonicalReasoningReadModelReady(snapshot)).toBe(false);
    }
  });

  it("rejects identity drift, content loss and ordering drift after restore", () => {
    const before = summarize(canonicalRead());
    for (const mutate of [
      (read) => {
        read.thread.id = "other-thread";
      },
      (read) => {
        read.thread.turns[0].items[1].id = "other-item";
      },
      (read) => {
        read.thread.turns[0].items[1].summary.push(
          REASONING_FIRST_VISIBLE_TEXT,
        );
      },
      (read) => {
        read.thread.turns[0].items[1].content = [];
      },
      (read) => {
        read.thread.turns[0].items.reverse();
      },
      (read) => {
        read.thread.turns[0].status = "inProgress";
      },
      (read) => {
        read.thread.turns.push(structuredClone(read.thread.turns[0]));
      },
    ]) {
      const read = canonicalRead();
      mutate(read);
      expect(isReasoningHistoryPreserved(before, summarize(read))).toBe(false);
    }
    expect(isCanonicalReasoningReadModelReady(summarize({}))).toBe(false);
  });
});

describe("external canonical reasoning producer", () => {
  it("runs the generated backend through its real JSON stdin/stdout boundary", () => {
    const fixtureDirectory = mkdtempSync(
      path.join(os.tmpdir(), "reasoning-backend-"),
    );
    try {
      const backendPath = path.join(fixtureDirectory, "backend.mjs");
      writeFixtureBackend(backendPath);
      const result = spawnSync(process.execPath, [backendPath], {
        encoding: "utf8",
        timeout: 10_000,
        input: JSON.stringify({
          kind: "turnStart",
          request: {
            session: {
              sessionId: "session-generated",
              threadId: "thread-generated",
            },
            turn: { turnId: "turn-generated" },
            input: {
              parts: [{ Text: { text: REASONING_FIRST_VISIBLE_PROMPT } }],
            },
          },
        }),
      });
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      const events = result.stdout
        .trim()
        .split("\n")
        .flatMap((line) => JSON.parse(line).events);
      const reasoningEvents = events.filter(
        (event) =>
          event.payload?.item?.kind === "reasoning" ||
          event.type.startsWith("reasoning."),
      );
      expect(reasoningEvents.map((event) => event.type)).toEqual([
        "item.started",
        "reasoning.summary",
        "reasoning.delta",
        "item.completed",
      ]);
      expect(
        reasoningEvents.map(
          (event) => event.payload.item?.itemId ?? event.payload.itemId,
        ),
      ).toEqual(Array(4).fill("turn-generated:reasoning:first-visible"));
      expect(reasoningEvents.at(-1).payload.item.payload).toEqual({
        type: "reasoning",
        summary: [REASONING_FIRST_VISIBLE_TEXT],
        content: [REASONING_FIRST_VISIBLE_CONTENT_TEXT],
      });
      expect(events.at(-1).type).toBe("turn.completed");
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  }, 15_000);

  it("closes the same typed Item with exact content before emitting the final answer", async () => {
    const batches = [];
    const waits = [];
    await runReasoningBackend({
      sessionId: "session-reasoning",
      threadId: "thread-reasoning",
      turnId: "turn-reasoning",
      finalAnswerItemId: "assistant-answer",
      followupText: "final answer",
      summaryText: " summary ",
      contentText: " raw content ",
      finalText: "final answer",
      doneText: "DONE",
      emitEvents: (events) => batches.push(structuredClone(events)),
      sleep: async (ms) => {
        expect(batches[0].map((event) => event.type)).toEqual([
          "item.started",
          "reasoning.summary",
          "reasoning.delta",
        ]);
        waits.push(ms);
      },
      providerTracePayload: (checkpoint) => ({ checkpoint }),
      messageDeltaPayload: (text, phase, itemId) => ({ text, phase, itemId }),
    });
    expect(waits).toEqual([5000]);
    const events = batches.flat();
    expect(events.map((event) => event.type)).toEqual([
      "item.started",
      "reasoning.summary",
      "reasoning.delta",
      "item.completed",
      "provider.first_text_delta.received",
      "message.delta",
      "turn.completed",
    ]);
    const items = [events[0], events[3]].map((event) => event.payload.item);
    expect(
      items.map((item) => [
        item.sessionId,
        item.threadId,
        item.turnId,
        item.itemId,
      ]),
    ).toEqual(
      Array.from({ length: 2 }, () => [
        "session-reasoning",
        "thread-reasoning",
        "turn-reasoning",
        "turn-reasoning:reasoning:first-visible",
      ]),
    );
    expect(items.map((item) => item.status)).toEqual([
      "inProgress",
      "completed",
    ]);
    expect(items.map((item) => item.createdAtMs)).toEqual(
      Array(2).fill(items[0].createdAtMs),
    );
    expect(items[0].payload).toEqual({
      type: "reasoning",
      summary: [],
      content: [],
    });
    expect(items[1].payload).toEqual({
      type: "reasoning",
      summary: [" summary "],
      content: [" raw content "],
    });
    expect(events[1].payload).toEqual({
      itemId: items[0].itemId,
      summary: " summary ",
      summaryIndex: 0,
    });
    expect(events[2].payload).toEqual({
      itemId: items[0].itemId,
      delta: " raw content ",
      contentIndex: 0,
    });
    expect(items[1].completedAtMs).toBe(items[1].updatedAtMs);
    expect(events[5].payload.itemId).toBe("assistant-answer");
  });
});
