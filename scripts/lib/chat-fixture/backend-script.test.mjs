import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeFixtureBackend } from "./backend-script.mjs";

function fixture(t, options) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chat-transport-"));
  const backend = path.join(root, "backend.mjs");
  const ledger = path.join(root, "ledger.jsonl");
  const signal = path.join(root, "cancel.jsonl");
  writeFixtureBackend(backend, options);
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return { backend, ledger, signal };
}

function run(t, files, kind, turnId, mode = "complete") {
  const child = spawn(
    process.execPath,
    [files.backend, files.ledger, files.signal],
    {
      env: { ...process.env, LIME_CHAT_FIXTURE_MODE: mode },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });
  let stdout = "",
    stderr = "";
  const ready = new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("error", reject);
  });
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) reject(new Error(`backend exit ${code}: ${stderr}`));
      else
        resolve(
          stdout
            .trim()
            .split("\n")
            .filter(Boolean)
            .flatMap((line) => JSON.parse(line).events),
        );
    });
  });
  child.stdin.end(
    JSON.stringify({
      kind,
      request: {
        session: { sessionId: "session", threadId: "thread" },
        turn: { turnId },
        input: { parts: [{ Text: { text: "recovery input" } }] },
      },
    }),
  );
  return { child, ready, done };
}

test(
  "canonical file tools and messages retain the requested thread and turn",
  { timeout: 10_000 },
  async (t) => {
    const files = fixture(t, {
      toolCalls: [
        {
          name: "read_file",
          arguments: { file_path: "report.md" },
          output: { text: "file result" },
        },
      ],
    });
    const events = await run(t, files, "turnStart", "turn-file").done;
    const started = events.find((event) => event.type === "item.started")
      .payload.item;
    const completed = events.find((event) => event.type === "item.completed")
      .payload.item;
    assert.equal(started.status, "inProgress");
    assert.equal(started.payload.output, null);
    assert.equal(completed.status, "completed");
    assert.equal(completed.itemId, started.itemId);
    assert.equal(completed.threadId, "thread");
    assert.equal(completed.turnId, "turn-file");
    assert.deepEqual(completed.payload.output, { text: "file result" });
    const message = events.find(
      (event) => event.type === "message.completed",
    ).payload;
    assert.equal(message.turnId, "turn-file");
    assert.equal(message.threadId, "thread");
    assert.equal(events.at(-1).type, "turn.completed");
  },
);

test(
  "cancellation only releases the matching running turn",
  { timeout: 10_000 },
  async (t) => {
    const files = fixture(t);
    const first = run(t, files, "turnStart", "first", "running");
    const second = run(t, files, "turnStart", "second", "running");
    await Promise.all([first.ready, second.ready]);
    await run(t, files, "turnCancel", "first").done;
    const firstEvents = await first.done;
    assert.equal(second.child.exitCode, null);
    assert.deepEqual(
      firstEvents.map((event) => event.type),
      ["message.delta"],
    );
    await run(t, files, "turnCancel", "second").done;
    await second.done;
  },
);

test(
  "silent cancellation produces no assistant output or synthetic completion",
  { timeout: 10_000 },
  async (t) => {
    const files = fixture(t);
    const running = run(t, files, "turnStart", "silent", "silent");
    // The cancel signal is durable, including when it arrives before turnStart reads it.
    await run(t, files, "turnCancel", "silent").done;
    assert.deepEqual(await running.done, []);
    const ledger = fs
      .readFileSync(files.ledger, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(
      ledger.find((entry) => entry.kind === "turnStart").inputText,
      "recovery input",
    );
  },
);
