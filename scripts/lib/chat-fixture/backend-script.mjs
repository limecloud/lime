import fs from "node:fs";
import { runtimeInputImageEvidence } from "../../agent-runtime/runtime-input-image-evidence.mjs";
import {
  ASSISTANT_DONE_TEXT,
  GREETING_PROMPT,
  GREETING_SUMMARY_TEXT,
  GREETING_DONE_TEXT,
  RUNNING_TEXT,
} from "./constants.mjs";

export function summarizeRequestInput(request, imageEvidence) {
  const agentImages = Array.isArray(
    request?.runtimeOptions?.runtimeRequest?.images,
  )
    ? request.runtimeOptions.runtimeRequest.images
    : [];
  const runtimeMetadata =
    request?.runtimeOptions?.runtimeRequest?.metadata ?? {};
  const harnessMetadata = runtimeMetadata?.harness ?? {};
  const pathReferences = Array.isArray(runtimeMetadata?.path_references)
    ? runtimeMetadata.path_references
    : Array.isArray(runtimeMetadata?.pathReferences)
      ? runtimeMetadata.pathReferences
      : [];
  const harnessFileReferences = Array.isArray(harnessMetadata?.file_references)
    ? harnessMetadata.file_references
    : Array.isArray(harnessMetadata?.fileReferences)
      ? harnessMetadata.fileReferences
      : [];
  const fileReferences =
    pathReferences.length > 0 ? pathReferences : harnessFileReferences;
  const inputImageCount = runtimeInputImageCount(request);
  return {
    textLength: runtimeInputText(request).length,
    imageEvidence: imageEvidence(request),
    attachmentCount: inputImageCount + agentImages.length,
    imageAttachmentCount: inputImageCount + agentImages.length,
    fileReferenceCount: fileReferences.length,
    fileReferenceNames: fileReferences
      .map((reference) => reference?.name)
      .filter((value) => typeof value === "string"),
    fileReferencePaths: fileReferences
      .map((reference) => reference?.path)
      .filter((value) => typeof value === "string"),
  };
}

export function runtimeInputText(request) {
  const parts = Array.isArray(request?.input?.parts) ? request.input.parts : [];
  return parts
    .map((part) => (typeof part?.Text?.text === "string" ? part.Text.text : ""))
    .join("");
}

export function runtimeInputImageCount(request) {
  const parts = Array.isArray(request?.input?.parts) ? request.input.parts : [];
  return parts.filter((part) => part?.Image !== undefined).length;
}

export function buildCanonicalToolItem({
  sessionId,
  threadId,
  turnId,
  itemId,
  ordinal,
  callId,
  name,
  arguments: toolArguments = [],
  status = "inProgress",
  output = null,
  metadata = {},
  mcp = null,
}) {
  const timestamp = Date.now();
  const argumentsList = Array.isArray(toolArguments)
    ? toolArguments
    : Object.entries(toolArguments).map(([argumentName, value]) => ({
        name: argumentName,
        value:
          typeof value === "string"
            ? value
            : (JSON.stringify(value) ?? String(value)),
      }));
  const terminal = ["completed", "failed", "interrupted", "cancelled"].includes(
    status,
  );
  return {
    item: {
      sessionId,
      threadId,
      turnId,
      itemId,
      sequence: 0,
      ordinal,
      createdAtMs: timestamp,
      updatedAtMs: timestamp,
      ...(terminal ? { completedAtMs: timestamp } : {}),
      kind: mcp ? "mcpToolCall" : "tool",
      status,
      payload: {
        ...(mcp
          ? {
              type: "mcpToolCall",
              server_name: mcp.server,
              tool_name: mcp.tool,
            }
          : { type: "tool", name }),
        call_id: callId,
        arguments: argumentsList,
        output,
      },
      metadata,
    },
  };
}

export function writeFixtureBackend(backendPath, { toolCalls = [] } = {}) {
  const settings = {
    toolCalls,
    ASSISTANT_DONE_TEXT,
    GREETING_PROMPT,
    GREETING_SUMMARY_TEXT,
    GREETING_DONE_TEXT,
    RUNNING_TEXT,
  };
  fs.writeFileSync(
    backendPath,
    [
      "#!/usr/bin/env node",
      'import { createHash } from "node:crypto";',
      'import { appendFileSync, readFileSync } from "node:fs";',
      `const settings = ${JSON.stringify(settings)};`,
      summarizeRequestInput.toString(),
      runtimeInputText.toString(),
      runtimeInputImageCount.toString(),
      runtimeInputImageEvidence.toString(),
      buildCanonicalToolItem.toString(),
      `await (${runChatFixture.toString()})(runtimeInputImageEvidence);`,
    ].join("\n"),
    { mode: 0o755 },
  );
}

// Controlled external transport for recovery, cancellation and file-click tests.
// Product runtime execution and live provider behavior require separate evidence.
async function runChatFixture(runtimeInputImageEvidence) {
  const [ledgerPath, cancelSignalPath] = process.argv.slice(2);
  const input = JSON.parse(readFileSync(0, "utf8"));
  const request = input.request;
  const sessionId = request?.session?.sessionId;
  const threadId = request?.session?.threadId;
  const turnId = request?.turn?.turnId;
  const inputText = runtimeInputText(request);
  const appendLedger = (entry) => {
    if (ledgerPath)
      appendFileSync(
        ledgerPath,
        JSON.stringify({
          ...entry,
          recordedAt: new Date().toISOString(),
        }) + "\n",
      );
  };
  const emitEvents = (events) => {
    appendLedger({
      kind: "backendEmit",
      sessionId,
      turnId,
      eventCount: events.length,
      eventTypes: events.map((event) => event.type),
    });
    console.log(JSON.stringify({ events }));
  };
  appendLedger({
    kind: input.kind,
    sessionId,
    turnId,
    inputText,
    inputSummary: summarizeRequestInput(request, (value) =>
      runtimeInputImageEvidence(value, createHash),
    ),
    providerPreference: request?.providerPreference,
    modelPreference: request?.modelPreference,
    runtimeOptions: request?.runtimeOptions,
    runtimeRequest: request?.runtimeOptions?.runtimeRequest,
  });
  if (input.kind === "turnCancel") {
    if (cancelSignalPath)
      appendFileSync(
        cancelSignalPath,
        JSON.stringify({ sessionId, turnId }) + "\n",
      );
    emitEvents([
      {
        type: "turn.canceled",
        payload: { status: "canceled", reason: "user_cancelled" },
      },
    ]);
    return;
  }
  if (input.kind !== "turnStart") {
    throw new Error(`Unsupported fixture operation: ${input.kind}`);
  }
  const mode = process.env.LIME_CHAT_FIXTURE_MODE ?? "complete";
  if (!["complete", "running", "silent"].includes(mode))
    throw new Error(`Unknown fixture mode: ${mode}`);
  for (const [index, tool] of settings.toolCalls.entries()) {
    const facts = {
      ...tool,
      sessionId,
      threadId,
      turnId,
      itemId: `fixture-tool-${turnId}-${index}`,
      callId: `fixture-tool-${turnId}-${index}`,
      ordinal: index + 2,
    };
    emitEvents([
      {
        type: "item.started",
        payload: buildCanonicalToolItem({
          ...facts,
          status: "inProgress",
          output: null,
        }),
      },
      {
        type: "item.completed",
        payload: buildCanonicalToolItem({ ...facts, status: "completed" }),
      },
    ]);
  }
  const greeting = inputText === settings.GREETING_PROMPT;
  const text = greeting
    ? settings.GREETING_SUMMARY_TEXT
    : settings.RUNNING_TEXT;
  const payload = {
    text,
    phase: "final_answer",
    item_id: `agent-message-final-${turnId}`,
    itemId: `agent-message-final-${turnId}`,
    thread_id: threadId,
    threadId,
    turn_id: turnId,
    turnId,
  };
  if (mode !== "silent") emitEvents([{ type: "message.delta", payload }]);
  if (mode === "complete") {
    emitEvents([
      {
        type: "message.completed",
        payload: { ...payload, role: "assistant", status: "completed" },
      },
      {
        type: "turn.completed",
        payload: {
          status: "completed",
          text: greeting
            ? settings.GREETING_DONE_TEXT
            : settings.ASSISTANT_DONE_TEXT,
        },
      },
    ]);
    return;
  }
  if (!cancelSignalPath)
    throw new Error("Running fixture requires a cancellation signal path");
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    let cancelled = false;
    try {
      cancelled = readFileSync(cancelSignalPath, "utf8")
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .some(
          (entry) => entry.sessionId === sessionId && entry.turnId === turnId,
        );
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError))
        throw error;
    }
    if (cancelled) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    "Running fixture timed out waiting for this turn's cancellation",
  );
}
