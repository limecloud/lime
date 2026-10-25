import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMultiAgentToolSchemaProjectionEvent,
  getMultiAgentToolSchemaContract,
  isMultiAgentToolName,
  isLegacyMultiAgentToolName,
  listMultiAgentToolSchemaContracts,
  validateMultiAgentToolSchema,
} from "../dist/index.js";

test("Current v2 multi-agent schema contracts expose current tool names only", () => {
  assert.deepEqual(
    listMultiAgentToolSchemaContracts().map((contract) => contract.name),
    [
      "spawn_agent",
      "send_message",
      "followup_task",
      "wait_agent",
      "interrupt_agent",
      "list_agents",
    ],
  );

  assert.equal(isMultiAgentToolName("spawn_agent"), true);
  assert.equal(isMultiAgentToolName("Agent"), false);
  assert.equal(isLegacyMultiAgentToolName("Agent"), true);
  assert.equal(isLegacyMultiAgentToolName("TeamCreate"), true);
  assert.equal(isLegacyMultiAgentToolName("multi_agent_v1.send_input"), true);
  for (const legacyName of [
    "send_input",
    "resume_agent",
    "wait",
    "close_agent",
  ]) {
    assert.equal(isMultiAgentToolName(legacyName), false);
    assert.equal(isLegacyMultiAgentToolName(legacyName), true);
  }
});

test("spawn_agent exposes the implemented task/message/fork_turns contract", () => {
  const contract = getMultiAgentToolSchemaContract("spawn_agent");
  assert.deepEqual(contract?.requiredInputFields, ["task_name", "message"]);
  assert.deepEqual(contract?.optionalInputFields, ["fork_turns"]);
  assert.deepEqual(contract?.forbiddenInputFields, [
    "items",
    "fork_context",
    "target",
  ]);
  assert.deepEqual(contract?.outputRequiredFields, ["task_name", "message_id"]);

  assert.deepEqual(
    validateMultiAgentToolSchema({
      toolName: "spawn_agent",
      input: {
        task_name: "researcher",
        message: "Find the relevant files",
        fork_turns: "all",
      },
    }),
    [],
  );

  const validForkTurns = [
    undefined,
    null,
    "",
    "   ",
    "none",
    " NoNe ",
    "all",
    " ALL ",
    "1",
    "01",
    "+1",
    " 3 ",
    "18446744073709551615",
  ];
  for (const fork_turns of validForkTurns) {
    assert.deepEqual(
      validateMultiAgentToolSchema({
        toolName: "spawn_agent",
        input: {
          task_name: "researcher",
          message: "Find the relevant files",
          fork_turns,
        },
      }),
      [],
    );
  }
  const invalidForkTurns = [
    1,
    -1,
    "0",
    "00",
    "+0",
    "-1",
    "banana",
    "1_000",
    "18446744073709551616",
    "99999999999999999999999999999999999999999999999999",
  ];
  for (const fork_turns of invalidForkTurns) {
    assert.deepEqual(
      validateMultiAgentToolSchema({
        toolName: "spawn_agent",
        input: {
          task_name: "researcher",
          message: "Find the relevant files",
          fork_turns,
        },
      }).map((item) => [item.code, item.path]),
      [["invalid_fork_turns", "$.input.fork_turns"]],
    );
  }

  assert.deepEqual(
    validateMultiAgentToolSchema({
      toolName: "spawn_agent",
      input: {
        message: "Find the relevant files",
        items: [{ type: "text", text: "legacy item" }],
        fork_context: true,
      },
    }).map((item) => [item.code, item.path]),
    [
      ["missing_required_field", "$.input.task_name"],
      ["forbidden_field", "$.input.items"],
      ["forbidden_field", "$.input.fork_context"],
    ],
  );
});

test("spawn_agent rejects unsupported options until the current runtime owner exists", () => {
  assert.deepEqual(
    validateMultiAgentToolSchema({
      toolName: "spawn_agent",
      input: {
        task_name: "researcher",
        message: "Find the relevant files",
        agent_type: "reviewer",
        model: "gpt-5",
        reasoning_effort: "high",
        service_tier: "flex",
      },
    }).map((item) => [item.code, item.path]),
    [
      ["unsupported_field", "$.input.agent_type"],
      ["unsupported_field", "$.input.model"],
      ["unsupported_field", "$.input.reasoning_effort"],
      ["unsupported_field", "$.input.service_tier"],
    ],
  );
});

test("message, wait, interrupt and list contracts match current v2 guardrails", () => {
  assert.deepEqual(
    validateMultiAgentToolSchema({
      toolName: "send_message",
      input: { target: "researcher", message: "Continue" },
    }),
    [],
  );
  assert.deepEqual(
    validateMultiAgentToolSchema({
      toolName: "send_message",
      input: { target: "researcher", items: [] },
    }).map((item) => [item.code, item.path]),
    [
      ["missing_required_field", "$.input.message"],
      ["forbidden_field", "$.input.items"],
    ],
  );
  assert.deepEqual(
    validateMultiAgentToolSchema({
      toolName: "wait_agent",
      input: { timeout_ms: -1 },
    }).map((item) => [item.code, item.path]),
    [["invalid_timeout", "$.input.timeout_ms"]],
  );
  assert.deepEqual(
    getMultiAgentToolSchemaContract("list_agents")?.outputRequiredFields,
    ["agents"],
  );
  assert.deepEqual(
    getMultiAgentToolSchemaContract("interrupt_agent")?.outputRequiredFields,
    ["previous_status"],
  );
});

test("legacy Lime/Agent team tool names fail closed before projection", () => {
  for (const toolName of [
    "TeamCreate",
    "send_input",
    "resume_agent",
    "wait",
    "close_agent",
  ]) {
    assert.deepEqual(
      validateMultiAgentToolSchema({
        toolName,
        input: { name: "writers" },
      }).map((item) => item.code),
      ["legacy_tool_name"],
    );
  }
  assert.equal(
    buildMultiAgentToolSchemaProjectionEvent({
      toolName: "TeamCreate",
      input: { name: "writers" },
    }),
    undefined,
  );
});

test("projection event binds current v2 tool schema to Team UI policy surface", () => {
  const event = buildMultiAgentToolSchemaProjectionEvent(
    {
      toolName: "spawn_agent",
      toolCallId: "tool-spawn-1",
      input: {
        task_name: "researcher",
        message: "Collect source links",
      },
      result: {
        task_name: "/root/researcher",
        message_id: "mailbox-spawn-1",
      },
    },
    {
      sessionId: "session-root",
      threadId: "thread-root",
      turnId: "turn-root",
      sequence: 17,
      timestamp: "2026-07-08T00:00:00.000Z",
    },
  );

  assert.deepEqual(
    {
      type: event?.type,
      sourceType: event?.sourceType,
      sequence: event?.sequence,
      sessionId: event?.sessionId,
      threadId: event?.threadId,
      turnId: event?.turnId,
      taskId: event?.taskId,
      agentId: event?.agentId,
      toolCallId: event?.toolCallId,
      owner: event?.owner,
      scope: event?.scope,
      surface: event?.surface,
      control: event?.control,
      topology: event?.topology,
      runtimeEntity: event?.runtimeEntity,
      runtimeStatus: event?.runtimeStatus,
    },
    {
      type: "task.changed",
      sourceType: "multi_agent_tool_schema_projection",
      sequence: 17,
      sessionId: "session-root",
      threadId: "thread-root",
      turnId: "turn-root",
      taskId: "researcher",
      agentId: "researcher",
      toolCallId: "tool-spawn-1",
      owner: "task",
      scope: "task",
      surface: "team_policy",
      control: "delegate",
      topology: "coordinator_team",
      runtimeEntity: "work_item",
      runtimeStatus: "completed",
    },
  );
  assert.deepEqual(event?.payload?.requiredInputFields, [
    "task_name",
    "message",
  ]);
  assert.deepEqual(event?.payload?.forbiddenInputFields, [
    "items",
    "fork_context",
    "target",
  ]);
  assert.deepEqual(event?.payload?.validationIssues, []);
});
