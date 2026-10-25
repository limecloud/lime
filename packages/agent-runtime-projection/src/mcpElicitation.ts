import {
  compactProjectionFields,
  definedString,
  metadataKeys,
  readRecord,
  readStringArrayField,
  readStringField,
  truncateText,
} from "./normalization.js";

export type AgentUiMcpElicitationMode = "form";
export type AgentUiMcpElicitationAction = "accept" | "decline" | "cancel";

export type AgentUiMcpElicitationIssueCode =
  | "missing_request_id"
  | "missing_thread_scope"
  | "missing_server_name"
  | "missing_request_mode"
  | "missing_requested_schema"
  | "invalid_response_action"
  | "missing_accept_content";

export interface AgentUiMcpElicitationIssue {
  code: AgentUiMcpElicitationIssueCode;
  path: string;
  message: string;
}

export interface AgentUiMcpElicitationProjectionInput {
  requestId?: string | null;
  params?: unknown;
  response?: unknown;
}

export interface AgentUiMcpElicitationRequestSnapshot {
  requestId: string;
  serverName?: string;
  threadId?: string;
  turnId?: string;
  mode: AgentUiMcpElicitationMode;
  messagePreview?: string;
  schemaPropertyNames: string[];
  requiredFields: string[];
  requestedSchemaKeys: string[];
  correlatedToTurn: boolean;
}

export interface AgentUiMcpElicitationResponseSnapshot {
  action: AgentUiMcpElicitationAction;
  accepted: boolean;
  contentKeys: string[];
  metaKeys: string[];
}

export interface AgentUiMcpElicitationSnapshot {
  request: AgentUiMcpElicitationRequestSnapshot;
  response?: AgentUiMcpElicitationResponseSnapshot;
  validationIssues: AgentUiMcpElicitationIssue[];
}

function issue(
  code: AgentUiMcpElicitationIssueCode,
  path: string,
  message: string,
): AgentUiMcpElicitationIssue {
  return { code, path, message };
}

function paramsRecord(
  input: AgentUiMcpElicitationProjectionInput,
): Record<string, unknown> {
  return readRecord(input.params) ?? {};
}

function readRequestedSchema(
  params: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return (
    readRecord(params.requestedSchema) ?? readRecord(params.requested_schema)
  );
}

function readSchemaProperties(
  schema: Record<string, unknown> | undefined,
): string[] {
  return Object.keys(readRecord(schema?.properties) ?? {}).sort();
}

function readRequiredFields(
  schema: Record<string, unknown> | undefined,
): string[] {
  return readStringArrayField(schema, ["required"]).sort();
}

function responseRecord(
  input: AgentUiMcpElicitationProjectionInput,
): Record<string, unknown> {
  return readRecord(input.response) ?? {};
}

function readResponseAction(
  input: AgentUiMcpElicitationProjectionInput,
): AgentUiMcpElicitationAction | undefined {
  const action = readStringField(responseRecord(input), ["action"]);
  if (action === "accept" || action === "decline" || action === "cancel") {
    return action;
  }
  return undefined;
}

function requestIdForInput(
  input: AgentUiMcpElicitationProjectionInput,
): string | undefined {
  return definedString(input.requestId ?? undefined);
}

function buildRequestSnapshot(
  input: AgentUiMcpElicitationProjectionInput,
): AgentUiMcpElicitationRequestSnapshot | undefined {
  const params = paramsRecord(input);
  const requestId = requestIdForInput(input);
  if (!requestId) return undefined;
  const serverName = readStringField(params, ["serverName", "server_name"]);
  const threadId = readStringField(params, ["threadId", "thread_id"]);
  const turnId = readStringField(params, ["turnId", "turn_id"]);
  const requestedSchema = readRequestedSchema(params);

  return compactProjectionFields({
    requestId,
    serverName,
    threadId,
    turnId,
    mode: "form",
    messagePreview: truncateText(readStringField(params, ["message"])),
    schemaPropertyNames: readSchemaProperties(requestedSchema),
    requiredFields: readRequiredFields(requestedSchema),
    requestedSchemaKeys: Object.keys(requestedSchema ?? {}).sort(),
    correlatedToTurn: Boolean(turnId),
  } satisfies AgentUiMcpElicitationRequestSnapshot);
}

function validateRequestSnapshot(
  snapshot: AgentUiMcpElicitationRequestSnapshot | undefined,
): AgentUiMcpElicitationIssue[] {
  if (!snapshot) {
    return [
      issue(
        "missing_request_id",
        "$.requestId",
        "MCP elicitation request id is required.",
      ),
    ];
  }
  const issues: AgentUiMcpElicitationIssue[] = [];
  if (!snapshot.threadId) {
    issues.push(
      issue(
        "missing_thread_scope",
        "$.params.threadId",
        "MCP elicitation requires thread scope.",
      ),
    );
  }
  if (!snapshot.serverName) {
    issues.push(
      issue(
        "missing_server_name",
        "$.params.serverName",
        "MCP server name is required.",
      ),
    );
  }
  if (!snapshot.mode) {
    issues.push(
      issue(
        "missing_request_mode",
        "$.params.mode",
        "MCP elicitation mode is required.",
      ),
    );
  }
  if (snapshot.requestedSchemaKeys.length === 0) {
    issues.push(
      issue(
        "missing_requested_schema",
        "$.params.requestedSchema",
        "MCP form elicitation requires a requested schema.",
      ),
    );
  }
  return issues;
}

function buildResponseSnapshot(
  input: AgentUiMcpElicitationProjectionInput,
): AgentUiMcpElicitationResponseSnapshot | undefined {
  const action = readResponseAction(input);
  if (!action) return undefined;
  const response = responseRecord(input);
  const content = readRecord(response.content);
  const meta = readRecord(response._meta) ?? readRecord(response.meta);
  return {
    action,
    accepted: action === "accept",
    contentKeys: Object.keys(content ?? {}).sort(),
    metaKeys: metadataKeys(meta),
  };
}

function validateResponseSnapshot(
  response: AgentUiMcpElicitationResponseSnapshot | undefined,
): AgentUiMcpElicitationIssue[] {
  if (!response) {
    return [
      issue(
        "invalid_response_action",
        "$.response.action",
        "MCP elicitation response action must be accept, decline or cancel.",
      ),
    ];
  }
  if (response.action === "accept" && response.contentKeys.length === 0) {
    return [
      issue(
        "missing_accept_content",
        "$.response.content",
        "Accepted MCP elicitation responses require structured content.",
      ),
    ];
  }
  return [];
}

export function extractMcpElicitationSnapshot(
  input: AgentUiMcpElicitationProjectionInput,
): AgentUiMcpElicitationSnapshot | undefined {
  const request = buildRequestSnapshot(input);
  if (!request) return undefined;
  const response = buildResponseSnapshot(input);
  const validationIssues = [
    ...validateRequestSnapshot(request),
    ...(input.response === undefined ? [] : validateResponseSnapshot(response)),
  ];
  return compactProjectionFields({
    request,
    response,
    validationIssues,
  } satisfies AgentUiMcpElicitationSnapshot);
}
