import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { expect, it } from "vitest";

import { writeTerminalExternalBackend } from "./terminal-gate-fixture.mjs";

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
