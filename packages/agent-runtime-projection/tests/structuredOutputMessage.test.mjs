import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStructuredOutputMessageProjectionEvent,
  extractStructuredOutputMessageSnapshot,
} from "../dist/index.js";

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    citations: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["answer", "citations"],
  additionalProperties: false,
};

const STRUCTURED_PAYLOAD = {
  answer: "Use Lime typed output guards.",
  citations: ["lime-output-schema"],
};

function modelRequest(schema = OUTPUT_SCHEMA) {
  return {
    text: {
      format: {
        name: "json_schema",
        type: "json_schema",
        strict: true,
        schema,
      },
    },
  };
}

function assistantMessage(overrides = {}) {
  return {
    id: "msg-structured-1",
    type: "message",
    role: "assistant",
    content: [
      {
        type: "output_text",
        text: JSON.stringify(STRUCTURED_PAYLOAD),
      },
    ],
    ...overrides,
  };
}

function projectedMessage(overrides = {}) {
  return {
    id: "msg-structured-1",
    renderKind: "json",
    structuredPayload: STRUCTURED_PAYLOAD,
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    outputSchema: OUTPUT_SCHEMA,
    modelRequest: modelRequest(),
    nextModelRequest: {
      text: {},
    },
    assistantMessage: assistantMessage(),
    projectedMessage: projectedMessage(),
    copyPayload: STRUCTURED_PAYLOAD,
    exportPayload: STRUCTURED_PAYLOAD,
    toolOutputs: [
      {
        type: "function_call_output",
        expectedKind: "function",
        call_id: "fn-1",
        output: "ok",
        success: true,
        projected: {
          bodyKind: "text",
          success: true,
        },
      },
      {
        type: "custom_tool_call_output",
        expectedKind: "custom",
        call_id: "custom-1",
        name: "js_repl",
        output: [
          {
            type: "input_text",
            text: "custom result",
          },
          {
            type: "input_image",
            image_url: "data:image/png;base64,abc123",
            detail: "high",
          },
        ],
        success: true,
        projected: {
          bodyKind: "content_items",
          contentItems: [
            {
              type: "input_text",
              text: "custom result",
            },
            {
              type: "input_image",
              image_url: "data:image/png;base64,abc123",
              detail: "high",
            },
          ],
          success: true,
        },
      },
      {
        type: "mcp_tool_call_output",
        expectedKind: "mcp",
        call_id: "mcp-1",
        output: {
          content: [
            {
              type: "text",
              text: "fallback text",
            },
          ],
          structuredContent: {
            answer: "structured mcp",
            ids: ["ref-1"],
          },
          isError: false,
        },
        projected: {
          bodyKind: "structured_content",
          structuredContent: {
            answer: "structured mcp",
            ids: ["ref-1"],
          },
          success: true,
        },
      },
    ],
    ...overrides,
  };
}

test("structured output message keeps output_schema request, typed payload and tool output shapes", () => {
  const event = buildStructuredOutputMessageProjectionEvent(baseInput(), {
    sessionId: "session-structured",
    threadId: "thread-structured",
    turnId: "turn-structured",
    sequence: 311,
    timestamp: "2026-07-09T00:00:00.000Z",
  });

  assert.deepEqual(
    {
      type: event.type,
      sourceType: event.sourceType,
      sequence: event.sequence,
      sessionId: event.sessionId,
      threadId: event.threadId,
      turnId: event.turnId,
      messageId: event.messageId,
      owner: event.owner,
      scope: event.scope,
      phase: event.phase,
      surface: event.surface,
      persistence: event.persistence,
      runtimeEntity: event.runtimeEntity,
      runtimeStatus: event.runtimeStatus,
    },
    {
      type: "messages.snapshot",
      sourceType: "structured_output_message_projection",
      sequence: 311,
      sessionId: "session-structured",
      threadId: "thread-structured",
      turnId: "turn-structured",
      messageId: "msg-structured-1",
      owner: "model",
      scope: "message",
      phase: "completed",
      surface: "conversation",
      persistence: "snapshot",
      runtimeEntity: "agent_turn",
      runtimeStatus: "completed",
    },
  );

  assert.deepEqual(event.payload.validationIssues, []);
  assert.equal(event.payload.outputSchemaRequested, true);
  assert.equal(event.payload.outputSchemaFormatValid, true);
  assert.equal(event.payload.outputSchemaPerTurnScoped, true);
  assert.deepEqual(event.payload.assistant, {
    messageId: "msg-structured-1",
    rawTextPreview: JSON.stringify(STRUCTURED_PAYLOAD),
    payloadKind: "object",
    payloadKeys: ["answer", "citations"],
    renderKind: "json",
    typedPayloadPresent: true,
    copyPayloadStable: true,
    exportPayloadStable: true,
  });
  assert.deepEqual(
    event.payload.toolOutputs.map((item) => [
      item.kind,
      item.expectedKind,
      item.bodyKind,
      item.contentItemCount,
      item.structuredContentKeys,
      item.success,
      item.projectedSuccess,
    ]),
    [
      ["function", "function", "text", 0, [], true, true],
      ["custom", "custom", "content_items", 2, [], true, true],
      ["mcp", "mcp", "structured_content", 0, ["answer", "ids"], true, true],
    ],
  );
});

test("output schema must use json_schema format and stay per-turn", () => {
  const snapshot = extractStructuredOutputMessageSnapshot(
    baseInput({
      modelRequest: {
        text: {
          format: {
            name: "legacy_schema",
            type: "json_object",
            strict: false,
            schema: { type: "object" },
          },
        },
      },
      nextModelRequest: modelRequest(),
    }),
  );

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["output_schema_format_drift", "stale_output_schema_request"],
  );
  assert.equal(snapshot.outputSchemaFormatValid, false);
  assert.equal(snapshot.outputSchemaPerTurnScoped, false);
});

test("structured assistant result cannot degrade to markdown text or string copy/export", () => {
  const snapshot = extractStructuredOutputMessageSnapshot(
    baseInput({
      projectedMessage: projectedMessage({
        renderKind: "markdown",
        structuredPayload: undefined,
        text: `\`\`\`json\n${JSON.stringify(STRUCTURED_PAYLOAD)}\n\`\`\``,
      }),
      copyPayload: JSON.stringify(STRUCTURED_PAYLOAD),
      exportPayload: `# Result\n\n${JSON.stringify(STRUCTURED_PAYLOAD)}`,
    }),
  );

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    [
      "missing_assistant_typed_payload",
      "assistant_rendered_as_markdown",
      "copy_payload_drift",
      "export_payload_drift",
    ],
  );
  assert.equal(snapshot.assistant.typedPayloadPresent, false);
  assert.equal(snapshot.assistant.copyPayloadStable, false);
  assert.equal(snapshot.assistant.exportPayloadStable, false);
});

test("function/custom tool output type, content items and structuredContent fail closed on drift", () => {
  const snapshot = extractStructuredOutputMessageSnapshot(
    baseInput({
      toolOutputs: [
        {
          type: "function_call_output",
          expectedKind: "custom",
          call_id: "custom-1",
          output: [
            {
              type: "input_text",
              text: "custom result",
            },
          ],
          success: true,
          projected: {
            bodyKind: "text",
            output: "custom result",
            success: false,
          },
        },
        {
          type: "mcp_tool_call_output",
          expectedKind: "mcp",
          call_id: "mcp-1",
          output: {
            content: [
              {
                type: "text",
                text: "fallback text",
              },
            ],
            structuredContent: {
              answer: "structured mcp",
            },
            isError: false,
          },
          projected: {
            bodyKind: "text",
            output: "fallback text",
            success: true,
          },
        },
      ],
    }),
  );

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    [
      "tool_output_type_drift",
      "content_items_textified",
      "success_flag_lost",
      "structured_content_precedence_lost",
    ],
  );
});

test("invalid assistant JSON cannot masquerade as structured output", () => {
  const snapshot = extractStructuredOutputMessageSnapshot(
    baseInput({
      assistantMessage: assistantMessage({
        content: [
          {
            type: "output_text",
            text: "answer: not json",
          },
        ],
      }),
    }),
  );

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["assistant_payload_invalid_json"],
  );
});
