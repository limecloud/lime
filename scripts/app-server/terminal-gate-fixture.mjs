import { writeFile } from "node:fs/promises";

export async function writeTerminalExternalBackend(
  backendPath,
  {
    completedText,
    command,
    reasoningText = "TUI_GATE_B_REASONING_DETAIL",
    reasoningParts = [reasoningText],
    reasoningContent = [],
    terminalStatus = "completed",
    scenario = "complete",
    taskProgress = false,
    tokenUsage = false,
    commandItems = false,
    commandStatus = "completed",
    completeAgentMessage = false,
  },
) {
  const terminalEvent =
    terminalStatus === "failed"
      ? { type: "turn.failed", payload: { message: "CLI_TEST_FAILURE" } }
      : terminalStatus === "interrupted"
        ? { type: "turn.canceled", payload: { status: "canceled" } }
        : { type: "turn.completed", payload: { status: "completed" } };
  await writeFile(
    backendPath,
    `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, watchFile, unwatchFile } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
const ledgerPath = process.argv[2];
const session = input.request.session ?? {};
const turn = input.request.turn ?? {};
const questionCallId = "terminal-question-" + turn.turnId;
const questionRequestId = "terminal-user-input-" + turn.turnId;
const assistantItemId = "terminal-assistant-" + turn.turnId;
const commandCallId = "terminal-command-" + turn.turnId;
const summaryParts = ${JSON.stringify(reasoningParts)};
const contentParts = ${JSON.stringify(reasoningContent)};
const toolItem = (
  status,
  output,
  { callId = commandCallId, name = "Bash" } = {},
) => ({
  sessionId: session.sessionId,
  threadId: session.threadId,
  turnId: turn.turnId,
  itemId: "item_" + callId,
  sequence: 3,
  ordinal: 3,
  createdAtMs: Date.now(),
  updatedAtMs: Date.now(),
  ...(status === "completed" ? { completedAtMs: Date.now() } : {}),
  kind: "tool",
  status,
  payload: {
    type: "tool",
    call_id: callId,
    name,
    arguments: [{ name: "command", value: ${JSON.stringify(command)} }],
    ...(output
      ? {
          output: {
            text: output.text,
            truncated: false,
          },
        }
      : {}),
  },
  metadata: {},
});
const reasoningItem = (status) => ({
  sessionId: session.sessionId,
  threadId: session.threadId,
  turnId: turn.turnId,
  itemId: "item_terminal-reasoning-" + turn.turnId,
  sequence: 2,
  ordinal: 2,
  createdAtMs: Date.now(),
  updatedAtMs: Date.now(),
  ...(status === "completed" ? { completedAtMs: Date.now() } : {}),
  kind: "reasoning",
  status,
  payload: {
    type: "reasoning",
    summary: summaryParts,
    content: contentParts,
  },
  metadata: {},
});
const commandItem = (status, output) => ({
  ...toolItem(status),
  kind: "command",
  payload: {
    type: "command",
    command: ${JSON.stringify(command)},
    cwd: "/tmp",
    output: output?.text ?? null,
    exit_code: status === "completed" ? 0 : status === "failed" ? 7 : null,
  },
  metadata: { duration_ms: 42 },
});
const executionItem = ${JSON.stringify(commandItems)} ? commandItem : toolItem;
const patchItem = (status) => ({
  ...toolItem(status, undefined, { callId: "terminal-patch" }),
  kind: "file",
  payload: {
    type: "file",
    status: status === "completed" ? "applied" : "proposed",
    changes: [{
      path: "gate-diff.rs",
      kind: { type: "update", move_path: null },
      diff: "@@ -1 +1 @@\\n-PTY_DIFF_OLD " + "o".repeat(110) + " PTY_DIFF_OLD_TAIL\\n+PTY_DIFF_NEW " + "n".repeat(110) + " PTY_DIFF_NEW_TAIL",
    }],
  },
});
let events = [];
if (input.kind === "turnStart") {
  if (${JSON.stringify(scenario)} === "reasoning-raw") {
    const item = reasoningItem("inProgress");
    item.payload = { type: "reasoning", summary: [], content: [] };
    events = [
      { type: "item.started", payload: { item } },
      ...summaryParts.map((summary, summaryIndex) => ({ type: "reasoning.summary", payload: { itemId: item.itemId, summary, summaryIndex } })),
      ...contentParts.map((delta, contentIndex) => ({ type: "reasoning.delta", payload: { itemId: item.itemId, delta, contentIndex } })),
    ];
  } else if (${JSON.stringify(scenario)} === "exec-json-stream") {
    events = [{ type: "item.started", payload: { item: commandItem("inProgress") } }];
  } else if (${JSON.stringify(scenario)} === "reasoning-resume") {
    events = [{ type: "item.started", payload: { item: reasoningItem("inProgress") } }];
  } else if (${JSON.stringify(scenario)} === "approval") {
    events = [
      {
        type: "item.started",
        payload: { item: executionItem("inProgress") },
      },
      {
        type: "action.required",
        payload: {
          actionType: "tool_confirmation",
          actionKind: "tool_execution_policy",
          requestId: "terminal-approval",
          actionId: "terminal-approval",
          toolCallId: commandCallId,
          toolName: "Bash",
          toolFamily: "shell_command",
          runtime_contract: {
            contract_key: "shell_command",
            tool_family: "shell_command",
            session_cache_supported: false,
          },
          approvalScope: {
            contractKey: "shell_command",
            toolFamily: "shell_command",
            riskClass: "shell_command_requires_approval",
            workingDirHash: "sha256:test",
          },
          prompt: "Allow terminal command?",
          arguments: { command: ${JSON.stringify(command)} },
          cwd: "/tmp",
          availableDecisions: ["allow_once", "decline", "cancel"],
        },
      },
    ];
  } else if (${JSON.stringify(scenario)} === "user-input") {
    events = [
      {
        type: "item.started",
        payload: {
          item: toolItem("inProgress", undefined, {
            callId: questionCallId,
            name: "request_user_input",
          }),
        },
      },
      {
        type: "action.required",
        payload: {
          actionType: "ask_user",
          requestId: questionRequestId,
          toolCallId: questionCallId,
          questions: [
            {
              id: "mode",
              header: "Mode",
              question: "Choose a mode",
              options: [
                { value: "fast", label: "Fast", description: "Continue quickly" },
                { value: "safe", label: "Safe", description: "Review every step" },
              ],
            },
          ],
        },
      },
    ];
  } else if (
    ${JSON.stringify(scenario)} === "interrupt" ||
    ${JSON.stringify(scenario)} === "queue-edit" ||
    ${JSON.stringify(scenario)} === "agents-overview"
  ) {
    events = [
      {
        type: "message.delta",
        payload: {
          itemId: assistantItemId,
          text:
            ${JSON.stringify(scenario)} === "queue-edit"
              ? "QUEUE_EDIT_READY"
              : ${JSON.stringify(scenario)} === "agents-overview"
                ? "AGENTS_OVERVIEW_READY"
                : "INTERRUPT_READY",
        },
      },
    ];
  } else if (${JSON.stringify(scenario)} === "failure") {
    events = [
      { type: "runtime.error", payload: { message: "fixture backend failure", willRetry: false } },
      { type: "turn.failed", payload: { status: "failed", error: { message: "fixture backend failure" } } },
    ];
  } else {
    events = [
      {
        type: "message.delta",
        payload: {
          itemId: assistantItemId,
          role: "assistant",
          text: ${JSON.stringify(completedText)},
        },
      },
      {
        type: "item.started",
        payload: { item: reasoningItem("inProgress") },
      },
      {
        type: "item.completed",
        payload: { item: reasoningItem("completed") },
      },
      {
        type: "item.started",
        payload: { item: executionItem("inProgress") },
      },
      {
        type: "item.completed",
        payload: {
          item: executionItem(${JSON.stringify(commandStatus)}, { text: "terminal-gate-b" }),
        },
      },
      ${JSON.stringify(terminalEvent)},
    ];
  }
  if (${JSON.stringify(scenario)} === "diff-display") {
    events.splice(1, 0,
      { type: "item.started", payload: { item: patchItem("inProgress") } },
      { type: "item.completed", payload: { item: patchItem("completed") } },
    );
  }
  if (${JSON.stringify(taskProgress)}) {
    events.unshift({ type: "turn.plan.updated", payload: {
      explanation: "Canonical task progress fixture",
      plan: [
        { step: "PTY_PLAN_COMPLETED_STEP", status: "completed" },
        { step: "PTY_PLAN_ACTIVE_STEP", status: "in_progress" },
        { step: "PTY_PLAN_PENDING_STEP", status: "pending" },
      ],
    } });
  }
  if (${JSON.stringify(tokenUsage)}) {
    events.splice(events.length - 1, 0, { type: "provider.usage", payload: { usage: {
      total_token_usage: {
        total_tokens: 161000, input_tokens: 155000, cached_input_tokens: 130000,
        cache_write_input_tokens: 500, output_tokens: 6000, reasoning_output_tokens: 2000,
      },
      last_token_usage: {
        total_tokens: 31000, input_tokens: 30000, cached_input_tokens: 10000,
        cache_write_input_tokens: 100, output_tokens: 1000, reasoning_output_tokens: 500,
      },
      model_context_window: 128000,
    } } });
  }
  events.unshift({ type: "turn.started", payload: {} });
} else if (input.kind === "actionRespond") {
  const decision = input.request.decision ?? null;
  const canceled = decision === "cancel";
  const isAskUser = String(input.request.actionType ?? "").toLowerCase().includes("ask");
  const toolCallId = isAskUser
    ? questionCallId
    : commandCallId;
  events = [
    {
      type: canceled ? "action.canceled" : "action.resolved",
      payload: {
        requestId: input.request.requestId,
        actionId: input.request.requestId,
        actionType: input.request.actionType,
        toolCallId,
        decision,
        confirmed: !canceled,
        scope: input.request.actionScope ?? null,
      },
    },
    { type: "message.delta", payload: { itemId: assistantItemId, text: ${JSON.stringify(completedText)} } },
    {
      type: "item.completed",
      payload: {
        item: toolItem(
          "completed",
          { text: "terminal-gate-b" },
          isAskUser
            ? { callId: questionCallId, name: "request_user_input" }
            : undefined,
        ),
      },
    },
    { type: "turn.completed", payload: { status: "completed" } },
  ];
} else if (input.kind === "turnCancel") {
  events = [{ type: "turn.canceled", payload: { status: "canceled" } }];
}
if (${JSON.stringify(completeAgentMessage)} && events.at(-1)?.type === "turn.completed" &&
    events.some((event) => event.type === "message.delta")) {
  events.splice(events.length - 1, 0, {
    type: "message.completed",
    payload: { itemId: assistantItemId, role: "assistant", phase: "final_answer", status: "completed" },
  });
}
appendFileSync(
  ledgerPath,
  JSON.stringify({
    kind: input.kind,
    inputParts: input.request.input?.parts ?? [],
    inputText: (input.request.input?.parts ?? [])
      .map((part) => part?.Text?.text ?? "")
      .join(""),
    threadId: input.request.session?.threadId ?? null,
    turnId: input.request.turn?.turnId ?? null,
    requestId: input.request.requestId ?? null,
    decision: input.request.decision ?? null,
    userData: input.request.userData ?? null,
    runtimeOptions: input.request.runtimeOptions ?? null,
    outputSchema: input.request.runtimeOptions?.outputSchema ?? null,
    scenario: ${JSON.stringify(scenario)},
    eventTypes: events.map((event) => event.type),
  }) + "\\n",
);
console.log(JSON.stringify({ events }));
if (input.kind === "turnStart" && ["reasoning-resume", "reasoning-raw", "exec-json-stream"].includes(${JSON.stringify(scenario)})) {
  // The reader releases this barrier only after observing the required canonical output.
  const continuePath = ledgerPath + ".continue";
  await new Promise((resolve) => {
    const check = () => {
      if (!existsSync(continuePath)) return;
      unwatchFile(continuePath, check);
      resolve();
    };
    watchFile(continuePath, { interval: 10 }, check);
    check();
  });
  if (${JSON.stringify(scenario)} === "exec-json-stream") {
    console.log(JSON.stringify({ events: [
      { type: "item.completed", payload: { item: commandItem("completed", { text: "terminal-gate-b" }) } },
      { type: "message.delta", payload: { itemId: assistantItemId, text: ${JSON.stringify(completedText)} } },
      { type: "turn.completed", payload: { status: "completed" } },
    ] }));
  } else if (${JSON.stringify(scenario)} === "reasoning-raw") {
    contentParts[0] += " RAW_CONTINUED";
    console.log(JSON.stringify({ events: [
      { type: "reasoning.delta", payload: { itemId: "item_terminal-reasoning-" + turn.turnId, contentIndex: 0, delta: " RAW_CONTINUED" } },
      { type: "item.completed", payload: { item: reasoningItem("completed") } },
      { type: "message.delta", payload: { itemId: assistantItemId, text: ${JSON.stringify(completedText)} } },
      { type: "turn.completed", payload: { status: "completed" } },
    ] }));
  } else {
  const index = 0;
  summaryParts[index] += " STDIO_RESUMED_DELTA";
  console.log(JSON.stringify({ events: [
    { type: "reasoning.summary", payload: {
      itemId: "item_terminal-reasoning-" + turn.turnId,
      summaryIndex: index, summary: " STDIO_RESUMED_DELTA",
    } },
    { type: "item.completed", payload: { item: reasoningItem("completed") } },
    { type: "turn.completed", payload: { status: "completed" } },
  ] }));
  }
}
if (
  input.kind === "turnStart" &&
  (${JSON.stringify(scenario)} === "interrupt" ||
    ${JSON.stringify(scenario)} === "queue-edit" ||
    ${JSON.stringify(scenario)} === "agents-overview")
) {
  // An unresolved Promise alone does not keep Node's event loop alive. Keep
  // one active handle so the App Server can deliver a real turn/interrupt.
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}
`,
  );
}
