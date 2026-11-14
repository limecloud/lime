import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexChatImportError,
  listCodexChats,
  readCodexChat,
} from "./codexChatImport";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

function rolloutLine(record: Record<string, unknown>): string {
  return JSON.stringify(record);
}

async function fixture(
  name: string,
  lines: Array<Record<string, unknown>>,
): Promise<{ home: string; sourcePath: string }> {
  root = await mkdtemp(path.join(tmpdir(), "lime-codex-chat-"));
  const sourcePath = path.join(
    root,
    ".codex",
    "sessions",
    "2026",
    "11",
    "14",
    `rollout-2026-11-14T00-00-00-${name}.jsonl`,
  );
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, lines.map(rolloutLine).join("\n") + "\n", "utf8");
  return { home: root, sourcePath };
}

function sampleLines(): Array<Record<string, unknown>> {
  return [
    {
      timestamp: "2026-11-14T00:00:00.000Z",
      ordinal: 0,
      type: "session_meta",
      payload: {
        session_id: "11111111-1111-7111-8111-111111111111",
        id: "11111111-1111-7111-8111-111111111111",
        timestamp: "2026-11-14T00:00:00.000Z",
        cwd: "/repo/lime",
        originator: "codex-tui",
        cli_version: "0.166.0",
        base_instructions: { text: "provider secret must not leak" },
      },
    },
    {
      timestamp: "2026-11-14T00:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "task_started",
        turn_id: "turn-a",
        started_at: "1794000001",
      },
    },
    {
      timestamp: "2026-11-14T00:00:02.000Z",
      type: "response_item",
      payload: {
        type: "message",
        id: "msg-context",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "# AGENTS.md instructions for /repo/lime\n\n<INSTRUCTIONS>rules</INSTRUCTIONS>",
          },
          {
            type: "input_text",
            text: "<environment_context><cwd>/repo/lime</cwd></environment_context>",
          },
        ],
      },
    },
    {
      timestamp: "2026-11-14T00:00:03.000Z",
      type: "response_item",
      payload: {
        type: "message",
        id: "msg-user-1",
        role: "user",
        content: [{ type: "input_text", text: "帮我整理一下导入流程" }],
      },
    },
    {
      timestamp: "2026-11-14T00:00:04.000Z",
      type: "response_item",
      payload: {
        type: "message",
        id: "msg-assistant-1",
        role: "assistant",
        content: [
          { type: "output_text", text: "先列出可用会话，再逐个导入。" },
        ],
      },
    },
    {
      timestamp: "2026-11-14T00:00:05.000Z",
      type: "event_msg",
      payload: {
        type: "task_complete",
        turn_id: "turn-a",
        completed_at: "1794000005",
      },
    },
    {
      timestamp: "2026-11-14T00:01:00.000Z",
      type: "event_msg",
      payload: {
        type: "task_started",
        turn_id: "turn-b",
        started_at: "1794000060",
      },
    },
    {
      timestamp: "2026-11-14T00:01:01.000Z",
      type: "response_item",
      payload: {
        type: "message",
        id: "msg-user-2",
        role: "user",
        content: [{ type: "input_text", text: "第二个问题" }],
      },
    },
    {
      timestamp: "2026-11-14T00:01:02.000Z",
      type: "response_item",
      payload: {
        type: "message",
        id: "msg-assistant-2",
        role: "assistant",
        content: [{ type: "output_text", text: "第二个回答" }],
      },
    },
    {
      timestamp: "2026-11-14T00:01:03.000Z",
      type: "event_msg",
      payload: {
        type: "turn_aborted",
        turn_id: "turn-b",
        completed_at: "1794000063",
        reason: "interrupted",
      },
    },
    {
      timestamp: "2026-11-14T00:01:04.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        call_id: "call-1",
        name: "shell",
        arguments: '{"command":"rm -rf /tmp/secret"}',
      },
    },
  ];
}

describe("codex chat import host parsing", () => {
  it("lists bounded conversations without tool or credential payloads", async () => {
    const { home } = await fixture("list", sampleLines());
    const result = await listCodexChats({ home, limit: 20 });
    expect(result.totalFileCount).toBe(1);
    expect(result.conversations).toHaveLength(1);
    const conversation = result.conversations[0];
    expect(conversation.id).toBe("11111111-1111-7111-8111-111111111111");
    expect(conversation.title).toBe("帮我整理一下导入流程");
    expect(conversation.messageCount).toBe(4);
    expect(conversation.turnCount).toBe(2);
    expect(conversation.importable).toBe(true);
    expect(JSON.stringify(result)).not.toContain("rm -rf");
    expect(JSON.stringify(result)).not.toContain("provider secret");
  });

  it("reads user/assistant turns in source order with turn timestamps", async () => {
    const { home, sourcePath } = await fixture("read", sampleLines());
    const conversation = await readCodexChat({ home, sourcePath });
    expect(conversation.skippedMessageCount).toBe(1);
    expect(conversation.turns).toHaveLength(2);
    expect(conversation.turns[0]).toMatchObject({
      sourceTurnId: "turn-a",
      status: "completed",
      startedAt: 1794000001000,
      completedAt: 1794000005000,
    });
    expect(
      conversation.turns[0].messages.map((message) => message.role),
    ).toEqual(["user", "assistant"]);
    expect(conversation.turns[0].messages[0].text).toBe("帮我整理一下导入流程");
    expect(conversation.turns[1]).toMatchObject({
      sourceTurnId: "turn-b",
      status: "interrupted",
    });
    expect(conversation.turns[1].messages[1].text).toBe("第二个回答");
  });

  it("marks byte-truncated sessions as not importable", async () => {
    const { home } = await fixture("truncated", sampleLines());
    const result = await listCodexChats({
      home,
      maxBytesPerConversation: 1800,
    });
    expect(result.conversations[0].truncated).toBe(true);
    expect(result.conversations[0].importable).toBe(false);
  });

  it("rejects a path outside the Codex sessions directory", async () => {
    const { home } = await fixture("outside", sampleLines());
    const outside = path.join(root, "outside.jsonl");
    await writeFile(outside, "{}\n", "utf8");
    await expect(
      readCodexChat({ home, sourcePath: outside }),
    ).rejects.toMatchObject({ code: "invalid_path" });
    await expect(
      readCodexChat({
        home,
        sourcePath: path.join(home, "..", "secret.jsonl"),
      }),
    ).rejects.toBeInstanceOf(CodexChatImportError);
  });

  it("refuses to import a conversation above the read limit", async () => {
    const { home, sourcePath } = await fixture("too-large", sampleLines());
    await expect(
      readCodexChat({ home, sourcePath, maxBytes: 100 }),
    ).rejects.toMatchObject({ code: "too_large" });
  });
});
