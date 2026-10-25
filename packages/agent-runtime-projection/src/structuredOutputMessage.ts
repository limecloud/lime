import type {
  AgentUiProjectionContext,
  AgentUiProjectionEvent,
  AgentUiRuntimeStatus,
} from "@limecloud/agent-ui-contracts";

import { buildAgentUiProjectionBase } from "./envelope.js";
import {
  compactProjectionFields,
  definedString,
  readBooleanField,
  readRecord,
  readStringField,
  truncateText,
} from "./normalization.js";

export type AgentUiStructuredOutputRenderKind =
  | "json"
  | "table"
  | "card"
  | "markdown"
  | "plain_text"
  | "unknown";

export type AgentUiStructuredToolOutputKind =
  | "function"
  | "custom"
  | "mcp"
  | "unknown";

export type AgentUiStructuredToolOutputBodyKind =
  | "text"
  | "content_items"
  | "structured_content"
  | "unknown";

export type AgentUiStructuredOutputIssueCode =
  | "missing_output_schema_request"
  | "output_schema_format_drift"
  | "stale_output_schema_request"
  | "missing_assistant_text"
  | "assistant_payload_invalid_json"
  | "missing_assistant_typed_payload"
  | "assistant_typed_payload_drift"
  | "assistant_rendered_as_markdown"
  | "copy_payload_drift"
  | "export_payload_drift"
  | "tool_output_type_drift"
  | "tool_output_payload_lost"
  | "content_items_textified"
  | "structured_content_precedence_lost"
  | "success_flag_lost";

export interface AgentUiStructuredOutputIssue {
  code: AgentUiStructuredOutputIssueCode;
  path: string;
  message: string;
}

export interface AgentUiStructuredAssistantSnapshot {
  messageId?: string;
  rawTextPreview?: string;
  payloadKind: "object" | "array" | "scalar" | "missing";
  payloadKeys: string[];
  renderKind: AgentUiStructuredOutputRenderKind;
  typedPayloadPresent: boolean;
  copyPayloadStable: boolean;
  exportPayloadStable: boolean;
}

export interface AgentUiStructuredToolOutputSnapshot {
  index: number;
  callId?: string;
  name?: string;
  kind: AgentUiStructuredToolOutputKind;
  expectedKind: AgentUiStructuredToolOutputKind;
  bodyKind: AgentUiStructuredToolOutputBodyKind;
  contentItemCount: number;
  structuredContentKeys: string[];
  success?: boolean;
  projectedSuccess?: boolean;
  projectedBodyKind?: AgentUiStructuredToolOutputBodyKind;
}

export interface AgentUiStructuredOutputMessageProjectionInput {
  outputSchema?: unknown;
  modelRequest?: unknown;
  nextModelRequest?: unknown;
  assistantMessage?: unknown;
  projectedMessage?: unknown;
  copyPayload?: unknown;
  exportPayload?: unknown;
  toolOutputs?: readonly unknown[];
}

export interface AgentUiStructuredOutputMessageSnapshot {
  outputSchemaRequested: boolean;
  outputSchemaFormatValid: boolean;
  outputSchemaPerTurnScoped: boolean;
  assistant: AgentUiStructuredAssistantSnapshot;
  toolOutputs: AgentUiStructuredToolOutputSnapshot[];
  typedPayloadStable: boolean;
  validationIssues: AgentUiStructuredOutputIssue[];
}

function issue(
  code: AgentUiStructuredOutputIssueCode,
  path: string,
  message: string,
): AgentUiStructuredOutputIssue {
  return { code, path, message };
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function parseJsonText(value: string | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function payloadKind(
  value: unknown,
): "object" | "array" | "scalar" | "missing" {
  if (value === undefined) return "missing";
  if (Array.isArray(value)) return "array";
  if (value && typeof value === "object") return "object";
  return "scalar";
}

function payloadKeys(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>).sort();
}

function schemaFromInput(
  input: AgentUiStructuredOutputMessageProjectionInput,
): unknown {
  const direct = input.outputSchema;
  if (direct !== undefined) return direct;
  const request = readRecord(input.modelRequest);
  return (
    request?.outputSchema ??
    request?.output_schema ??
    readRecord(request?.turnStart)?.output_schema ??
    readRecord(request?.turn_start)?.output_schema
  );
}

function textFormatRecord(value: unknown): Record<string, unknown> | undefined {
  const request = readRecord(value);
  const text = readRecord(request?.text);
  const body = readRecord(request?.body);
  const bodyText = readRecord(body?.text);
  return (
    readRecord(text?.format) ??
    readRecord(bodyText?.format) ??
    readRecord(request?.format)
  );
}

function outputSchemaFormatValid(schema: unknown, request: unknown): boolean {
  const format = textFormatRecord(request);
  if (!format || schema === undefined) return false;
  return (
    readStringField(format, ["name"]) === "json_schema" &&
    readStringField(format, ["type"]) === "json_schema" &&
    readBooleanField(format, ["strict"]) === true &&
    sameJson(format.schema, schema)
  );
}

function outputTextFromContent(value: unknown): string | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const direct = readStringField(record, [
    "text",
    "message",
    "outputText",
    "output_text",
  ]);
  if (direct) return direct;
  const content = readArray(record.content);
  const text = content
    .flatMap((entry) => {
      if (typeof entry === "string") return [entry];
      const item = readRecord(entry);
      const type = readStringField(item, ["type"]);
      if (
        type &&
        type !== "output_text" &&
        type !== "text" &&
        type !== "input_text"
      ) {
        return [];
      }
      return [readStringField(item, ["text"])];
    })
    .filter((entry): entry is string => Boolean(entry))
    .join("\n");
  return definedString(text);
}

function projectedPayload(value: unknown): unknown {
  const record = readRecord(value);
  if (!record) return undefined;
  return (
    record.structuredPayload ??
    record.structured_payload ??
    record.typedPayload ??
    record.typed_payload ??
    record.outputData ??
    record.output_data ??
    readRecord(record.structured)?.payload
  );
}

function normalizeRenderKind(
  value: string | undefined,
): AgentUiStructuredOutputRenderKind {
  switch (value) {
    case "json":
    case "table":
    case "card":
    case "markdown":
    case "plain_text":
      return value;
    case "plainText":
      return "plain_text";
    default:
      return "unknown";
  }
}

function projectedRenderKind(
  value: unknown,
): AgentUiStructuredOutputRenderKind {
  const record = readRecord(value);
  return normalizeRenderKind(
    readStringField(record, ["renderKind", "render_kind", "renderer", "kind"]),
  );
}

function messageId(
  input: AgentUiStructuredOutputMessageProjectionInput,
): string | undefined {
  const message = readRecord(input.assistantMessage);
  const projected = readRecord(input.projectedMessage);
  return (
    readStringField(projected, ["id", "messageId", "message_id"]) ??
    readStringField(message, ["id", "messageId", "message_id"])
  );
}

function assistantSnapshot(
  input: AgentUiStructuredOutputMessageProjectionInput,
): AgentUiStructuredAssistantSnapshot {
  const rawText = outputTextFromContent(input.assistantMessage);
  const parsed = parseJsonText(rawText);
  const typedPayload =
    projectedPayload(input.projectedMessage) ??
    projectedPayload(input.assistantMessage);
  const renderKind = projectedRenderKind(input.projectedMessage);
  return {
    messageId: messageId(input),
    rawTextPreview: truncateText(rawText),
    payloadKind: payloadKind(parsed),
    payloadKeys: payloadKeys(parsed),
    renderKind,
    typedPayloadPresent: typedPayload !== undefined,
    copyPayloadStable: sameJson(input.copyPayload, parsed),
    exportPayloadStable: sameJson(input.exportPayload, parsed),
  };
}

function expectedToolKind(
  value: string | undefined,
): AgentUiStructuredToolOutputKind {
  switch (value) {
    case "function":
    case "function_call_output":
    case "FunctionCallOutput":
      return "function";
    case "custom":
    case "custom_tool_call_output":
    case "CustomToolCallOutput":
      return "custom";
    case "mcp":
    case "mcp_tool_call_output":
    case "McpToolCallOutput":
      return "mcp";
    default:
      return "unknown";
  }
}

function toolKind(
  record: Record<string, unknown>,
): AgentUiStructuredToolOutputKind {
  return expectedToolKind(readStringField(record, ["type", "kind"]));
}

function outputRecord(
  record: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return (
    readRecord(record.output) ??
    readRecord(record.result) ??
    readRecord(record.payload)
  );
}

function outputBodyValue(record: Record<string, unknown>): unknown {
  const output = outputRecord(record);
  return output?.body ?? record.output ?? record.result ?? record.payload;
}

function structuredContent(record: Record<string, unknown>): unknown {
  const output = outputRecord(record);
  return (
    record.structuredContent ??
    record.structured_content ??
    output?.structuredContent ??
    output?.structured_content
  );
}

function contentItems(record: Record<string, unknown>): unknown[] {
  const output = outputRecord(record);
  const body = output?.body;
  if (Array.isArray(body)) return body;
  return [
    ...readArray(record.contentItems ?? record.content_items),
    ...readArray(output?.contentItems ?? output?.content_items),
    ...readArray(Array.isArray(record.output) ? record.output : undefined),
    ...readArray(Array.isArray(output?.body) ? output?.body : undefined),
  ];
}

function bodyKind(
  record: Record<string, unknown>,
): AgentUiStructuredToolOutputBodyKind {
  if (
    structuredContent(record) !== undefined &&
    structuredContent(record) !== null
  ) {
    return "structured_content";
  }
  if (contentItems(record).length > 0) return "content_items";
  const body = outputBodyValue(record);
  if (typeof body === "string") return "text";
  return "unknown";
}

function projectedToolRecord(
  record: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return readRecord(record.projected) ?? readRecord(record.projection);
}

function projectedBodyKind(
  record: Record<string, unknown>,
): AgentUiStructuredToolOutputBodyKind | undefined {
  const projected = projectedToolRecord(record);
  if (!projected) return undefined;
  const explicit = readStringField(projected, ["bodyKind", "body_kind"]);
  if (
    explicit === "text" ||
    explicit === "content_items" ||
    explicit === "structured_content" ||
    explicit === "unknown"
  ) {
    return explicit;
  }
  if (
    projected.structuredContent !== undefined ||
    projected.structured_content !== undefined
  ) {
    return "structured_content";
  }
  if (
    Array.isArray(projected.contentItems) ||
    Array.isArray(projected.content_items)
  ) {
    return "content_items";
  }
  if (
    typeof projected.text === "string" ||
    typeof projected.output === "string"
  ) {
    return "text";
  }
  return undefined;
}

function projectedSuccess(
  record: Record<string, unknown>,
): boolean | undefined {
  const projected = projectedToolRecord(record);
  return readBooleanField(projected, ["success"]);
}

function toolSuccess(
  record: Record<string, unknown>,
  output: Record<string, unknown> | undefined,
): boolean | undefined {
  const explicit =
    readBooleanField(record, ["success"]) ??
    readBooleanField(output, ["success"]);
  if (explicit !== undefined) return explicit;
  const isError = readBooleanField(output, ["isError", "is_error"]);
  return isError === undefined ? undefined : !isError;
}

function toolOutputSnapshot(
  value: unknown,
  index: number,
): AgentUiStructuredToolOutputSnapshot | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const output = outputRecord(record);
  const expectedKind = expectedToolKind(
    readStringField(record, [
      "expectedKind",
      "expected_kind",
      "expectedType",
      "expected_type",
    ]),
  );
  const actualKind = toolKind(record);
  const body = bodyKind(record);
  return compactProjectionFields({
    index,
    callId: readStringField(record, ["callId", "call_id", "toolCallId"]),
    name: readStringField(record, ["name", "tool", "toolName"]),
    kind: actualKind,
    expectedKind: expectedKind === "unknown" ? actualKind : expectedKind,
    bodyKind: body,
    contentItemCount: contentItems(record).length,
    structuredContentKeys: payloadKeys(structuredContent(record)),
    success: toolSuccess(record, output),
    projectedSuccess: projectedSuccess(record),
    projectedBodyKind: projectedBodyKind(record),
  } satisfies AgentUiStructuredToolOutputSnapshot);
}

function validateOutputSchema(
  input: AgentUiStructuredOutputMessageProjectionInput,
  schema: unknown,
): AgentUiStructuredOutputIssue[] {
  const issues: AgentUiStructuredOutputIssue[] = [];
  if (schema === undefined) {
    return issues;
  }
  if (!input.modelRequest) {
    issues.push(
      issue(
        "missing_output_schema_request",
        "$.modelRequest.text.format",
        "Structured output requires a model request text.format json_schema.",
      ),
    );
    return issues;
  }
  if (!outputSchemaFormatValid(schema, input.modelRequest)) {
    issues.push(
      issue(
        "output_schema_format_drift",
        "$.modelRequest.text.format",
        "Structured output request must use Responses json_schema json_schema strict format.",
      ),
    );
  }
  if (input.nextModelRequest && textFormatRecord(input.nextModelRequest)) {
    issues.push(
      issue(
        "stale_output_schema_request",
        "$.nextModelRequest.text.format",
        "Output schema is per-turn and must not leak into the next request.",
      ),
    );
  }
  return issues;
}

function validateAssistant(
  input: AgentUiStructuredOutputMessageProjectionInput,
): AgentUiStructuredOutputIssue[] {
  const issues: AgentUiStructuredOutputIssue[] = [];
  const rawText = outputTextFromContent(input.assistantMessage);
  const parsed = parseJsonText(rawText);
  const typedPayload =
    projectedPayload(input.projectedMessage) ??
    projectedPayload(input.assistantMessage);
  const renderKind = projectedRenderKind(input.projectedMessage);
  if (!rawText) {
    issues.push(
      issue(
        "missing_assistant_text",
        "$.assistantMessage.content",
        "Structured output must keep the assistant message text that carries the JSON result.",
      ),
    );
    return issues;
  }
  if (parsed === undefined) {
    issues.push(
      issue(
        "assistant_payload_invalid_json",
        "$.assistantMessage.content",
        "Structured output assistant text must parse as JSON.",
      ),
    );
    return issues;
  }
  if (typedPayload === undefined) {
    issues.push(
      issue(
        "missing_assistant_typed_payload",
        "$.projectedMessage.structuredPayload",
        "Projection must retain the parsed typed payload instead of only markdown text.",
      ),
    );
  } else if (!sameJson(typedPayload, parsed)) {
    issues.push(
      issue(
        "assistant_typed_payload_drift",
        "$.projectedMessage.structuredPayload",
        "Projected structured payload must match the assistant JSON result.",
      ),
    );
  }
  if (renderKind === "markdown" || renderKind === "plain_text") {
    issues.push(
      issue(
        "assistant_rendered_as_markdown",
        "$.projectedMessage.renderKind",
        "Structured output must use a typed JSON/table/card renderer, not markdown/plain text.",
      ),
    );
  }
  if (!sameJson(input.copyPayload, parsed)) {
    issues.push(
      issue(
        "copy_payload_drift",
        "$.copyPayload",
        "Copy payload must preserve the structured value, not a stringified markdown fallback.",
      ),
    );
  }
  if (!sameJson(input.exportPayload, parsed)) {
    issues.push(
      issue(
        "export_payload_drift",
        "$.exportPayload",
        "Export payload must preserve the structured value, not a stringified markdown fallback.",
      ),
    );
  }
  return issues;
}

function validateTools(
  tools: readonly AgentUiStructuredToolOutputSnapshot[],
): AgentUiStructuredOutputIssue[] {
  const issues: AgentUiStructuredOutputIssue[] = [];
  for (const tool of tools) {
    const path = `$.toolOutputs[${tool.index}]`;
    if (
      tool.expectedKind !== "unknown" &&
      tool.kind !== "unknown" &&
      tool.kind !== tool.expectedKind
    ) {
      issues.push(
        issue(
          "tool_output_type_drift",
          `${path}.type`,
          "Function and custom tool outputs must keep their ResponseInputItem type.",
        ),
      );
    }
    if (tool.bodyKind === "unknown") {
      issues.push(
        issue(
          "tool_output_payload_lost",
          `${path}.output`,
          "Tool output must preserve text, structured content, or content items.",
        ),
      );
    }
    if (
      tool.bodyKind === "content_items" &&
      tool.projectedBodyKind &&
      tool.projectedBodyKind !== "content_items"
    ) {
      issues.push(
        issue(
          "content_items_textified",
          `${path}.projected`,
          "Content item arrays must not be flattened into ordinary text.",
        ),
      );
    }
    if (
      tool.bodyKind === "structured_content" &&
      tool.projectedBodyKind &&
      tool.projectedBodyKind !== "structured_content"
    ) {
      issues.push(
        issue(
          "structured_content_precedence_lost",
          `${path}.projected`,
          "structuredContent must remain the primary typed payload when present.",
        ),
      );
    }
    if (
      tool.success !== undefined &&
      tool.projectedSuccess !== undefined &&
      tool.success !== tool.projectedSuccess
    ) {
      issues.push(
        issue(
          "success_flag_lost",
          `${path}.projected.success`,
          "Tool output success metadata must stay attached to the typed payload.",
        ),
      );
    }
  }
  return issues;
}

function runtimeStatus(
  issues: readonly AgentUiStructuredOutputIssue[],
): AgentUiRuntimeStatus {
  return issues.length > 0 ? "failed" : "completed";
}

export function extractStructuredOutputMessageSnapshot(
  input: AgentUiStructuredOutputMessageProjectionInput,
): AgentUiStructuredOutputMessageSnapshot {
  const schema = schemaFromInput(input);
  const assistant = assistantSnapshot(input);
  const toolOutputs = readArray(input.toolOutputs)
    .map(toolOutputSnapshot)
    .filter((entry): entry is AgentUiStructuredToolOutputSnapshot =>
      Boolean(entry),
    );
  const validationIssues = [
    ...validateOutputSchema(input, schema),
    ...validateAssistant(input),
    ...validateTools(toolOutputs),
  ];
  return {
    outputSchemaRequested: schema !== undefined,
    outputSchemaFormatValid:
      schema === undefined ||
      outputSchemaFormatValid(schema, input.modelRequest),
    outputSchemaPerTurnScoped: !textFormatRecord(input.nextModelRequest),
    assistant,
    toolOutputs,
    typedPayloadStable: validationIssues.length === 0,
    validationIssues,
  };
}

export function buildStructuredOutputMessageProjectionEvent(
  input: AgentUiStructuredOutputMessageProjectionInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractStructuredOutputMessageSnapshot(input);
  return {
    ...buildAgentUiProjectionBase(
      { sourceType: "structured_output_message_projection" },
      context,
    ),
    type: "messages.snapshot",
    sequence: context.sequence,
    messageId: snapshot.assistant.messageId,
    owner: "model",
    scope: "message",
    phase: "completed",
    surface: "conversation",
    persistence: "snapshot",
    runtimeEntity: "agent_turn",
    runtimeStatus: runtimeStatus(snapshot.validationIssues),
    payload: {
      outputSchemaRequested: snapshot.outputSchemaRequested,
      outputSchemaFormatValid: snapshot.outputSchemaFormatValid,
      outputSchemaPerTurnScoped: snapshot.outputSchemaPerTurnScoped,
      assistant: snapshot.assistant,
      toolOutputs: snapshot.toolOutputs,
      typedPayloadStable: snapshot.typedPayloadStable,
      validationIssues: snapshot.validationIssues,
    },
    refs:
      snapshot.validationIssues.length > 0
        ? {
            diagnosticKeys: snapshot.validationIssues.map(
              (entry) => entry.code,
            ),
          }
        : undefined,
  };
}
