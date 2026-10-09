import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { expect, it } from "vitest";

import { writeTerminalExternalBackend } from "./terminal-gate-fixture.mjs";

it("closes assistant identity for fork evidence only when explicitly enabled and successful", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "terminal-message-lifecycle-"));
  try {
    const backend = path.join(dir, "backend.mjs");
    for (const [completeAgentMessage, terminalStatus, expected] of [
      [false, "completed", false],
      [true, "completed", true],
      [true, "failed", false],
      [true, "interrupted", false],
    ]) {
      await writeTerminalExternalBackend(backend, {
        completedText: "answer",
        command: "test-only",
        completeAgentMessage,
        terminalStatus,
      });
      const events = JSON.parse(
        execFileSync(
          process.execPath,
          [backend, path.join(dir, "ledger.jsonl")],
          {
            input: JSON.stringify({
              kind: "turnStart",
              request: {
                session: { threadId: "thread" },
                turn: { turnId: "turn" },
              },
            }),
            encoding: "utf8",
          },
        ),
      ).events;
      const completed = events.filter(
        (event) => event.type === "message.completed",
      );
      expect(completed).toHaveLength(expected ? 1 : 0);
      if (expected) {
        expect(completed[0].payload).toEqual({
          itemId: events.find((event) => event.type === "message.delta").payload
            .itemId,
          role: "assistant",
          phase: "final_answer",
          status: "completed",
        });
        expect(events.at(-2)).toEqual(completed[0]);
        expect(events.at(-1).type).toBe("turn.completed");
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("scopes every completed reasoning and command identity to its canonical Turn", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "terminal-multiple-turns-"));
  try {
    const backend = path.join(dir, "backend.mjs");
    const reasoningParts = [
      "**Status**\n\n<!-- -->",
      "**Plan**\n\nSummary body",
      "Second paragraph",
      "**Tail**\n<!-- -->",
    ];
    await writeTerminalExternalBackend(backend, {
      completedText: "completed",
      command: "test-only",
      reasoningParts,
      reasoningContent: ["raw fixture content"],
    });
    const turns = ["first", "second"].map(
      (turnId) =>
        JSON.parse(
          execFileSync(
            process.execPath,
            [backend, path.join(dir, "ledger.jsonl")],
            {
              input: JSON.stringify({
                kind: "turnStart",
                request: {
                  session: { sessionId: "session", threadId: "thread" },
                  turn: { turnId },
                },
              }),
              encoding: "utf8",
            },
          ),
        ).events,
    );
    const completed = turns.map((events) =>
      events
        .filter((event) => event.type === "item.completed")
        .map((event) => event.payload.item),
    );
    expect(completed[0]).toHaveLength(2);
    for (const items of completed) {
      expect(
        items.find((item) => item.kind === "reasoning").payload.summary,
      ).toEqual(reasoningParts);
      expect(
        items.find((item) => item.kind === "reasoning").payload.content,
      ).toEqual(["raw fixture content"]);
    }
    for (const item of completed[0]) {
      expect(completed[1].some((second) => second.itemId === item.itemId)).toBe(
        false,
      );
    }
    for (const [index, events] of turns.entries()) {
      const started = events
        .filter((event) => event.type === "item.started")
        .map((event) => event.payload.item.itemId);
      expect(completed[index].map((item) => item.itemId)).toEqual(started);
      expect(events.at(-1).type).toBe("turn.completed");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("keeps CLI usage absent by default and emits distinct total and last facts when enabled", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "terminal-usage-fixture-"));
  try {
    const backend = path.join(dir, "backend.mjs");
    for (const tokenUsage of [false, true]) {
      await writeTerminalExternalBackend(backend, {
        completedText: "completed",
        command: "test-only",
        tokenUsage,
      });
      const events = JSON.parse(
        execFileSync(
          process.execPath,
          [backend, path.join(dir, "ledger.jsonl")],
          {
            input: JSON.stringify({
              kind: "turnStart",
              request: {
                session: { sessionId: "session", threadId: "thread" },
                turn: { turnId: "turn" },
              },
            }),
            encoding: "utf8",
          },
        ),
      ).events;
      const usage = events.find((event) => event.type === "provider.usage");
      expect(Boolean(usage)).toBe(tokenUsage);
      if (tokenUsage) {
        expect(events.at(-2)).toBe(usage);
        expect(usage.payload.usage).toEqual({
          total_token_usage: {
            total_tokens: 161000,
            input_tokens: 155000,
            cached_input_tokens: 130000,
            cache_write_input_tokens: 500,
            output_tokens: 6000,
            reasoning_output_tokens: 2000,
          },
          last_token_usage: {
            total_tokens: 31000,
            input_tokens: 30000,
            cached_input_tokens: 10000,
            cache_write_input_tokens: 100,
            output_tokens: 1000,
            reasoning_output_tokens: 500,
          },
          model_context_window: 128000,
        });
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("emits typed checklist progress only for the explicitly enabled TUI fixture", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "terminal-progress-fixture-"));
  try {
    const backend = path.join(dir, "backend.mjs");
    const ledger = path.join(dir, "ledger.jsonl");
    for (const taskProgress of [false, true]) {
      await writeTerminalExternalBackend(backend, {
        completedText: "completed",
        command: "test-only",
        taskProgress,
      });
      const events = JSON.parse(
        execFileSync(process.execPath, [backend, ledger], {
          input: JSON.stringify({
            kind: "turnStart",
            request: {
              session: { sessionId: "session", threadId: "thread" },
              turn: { turnId: "turn" },
            },
          }),
          encoding: "utf8",
        }),
      ).events;
      const plan = events.find((event) => event.type === "turn.plan.updated");
      expect(Boolean(plan)).toBe(taskProgress);
      if (taskProgress) {
        expect(events[0].type).toBe("turn.started");
        expect(plan.payload.plan.map((step) => step.status)).toEqual([
          "completed",
          "in_progress",
          "pending",
        ]);
        expect(events.at(-1).type).toBe("turn.completed");
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("correlates consecutive questions and responses without reusing identities", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "terminal-question-fixture-"));
  try {
    const backend = path.join(dir, "backend.mjs");
    const ledger = path.join(dir, "ledger.jsonl");
    await writeTerminalExternalBackend(backend, {
      completedText: "completed",
      command: "test-only",
      scenario: "user-input",
    });
    const invoke = (kind, request) =>
      JSON.parse(
        execFileSync(process.execPath, [backend, ledger], {
          input: JSON.stringify({ kind, request }),
          encoding: "utf8",
        }),
      ).events;
    const requests = [];
    const messages = [];
    for (const turnId of ["turn-first", "turn-second"]) {
      const scope = {
        session: { sessionId: "session", threadId: "thread" },
        turn: { turnId },
      };
      const started = invoke("turnStart", scope);
      expect(started.map((event) => event.type)).toEqual([
        "turn.started",
        "item.started",
        "action.required",
      ]);
      const request = started[2].payload;
      const tool = started[1].payload.item;
      expect(tool.turnId).toBe(turnId);
      expect(request.toolCallId).toBe(tool.payload.call_id);
      requests.push(request);
      const answered = invoke("actionRespond", {
        ...scope,
        requestId: request.requestId,
        actionType: request.actionType,
        userData: { mode: ["Safe"] },
      });
      expect(answered.map((event) => event.type)).toEqual([
        "action.resolved",
        "message.delta",
        "item.completed",
        "turn.completed",
      ]);
      expect(answered[0].payload.requestId).toBe(request.requestId);
      expect(answered[0].payload.toolCallId).toBe(request.toolCallId);
      messages.push(answered[1].payload.itemId);
      expect(answered[2].payload.item.itemId).toBe(tool.itemId);
      expect(answered[2].payload.item.turnId).toBe(turnId);
    }
    expect(requests[0].requestId).not.toBe(requests[1].requestId);
    expect(requests[0].toolCallId).not.toBe(requests[1].toolCallId);
    expect(messages[0]).not.toBe(messages[1]);
    const entries = readFileSync(ledger, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(entries.map(({ kind, turnId }) => ({ kind, turnId }))).toEqual([
      { kind: "turnStart", turnId: "turn-first" },
      { kind: "actionRespond", turnId: "turn-first" },
      { kind: "turnStart", turnId: "turn-second" },
      { kind: "actionRespond", turnId: "turn-second" },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
