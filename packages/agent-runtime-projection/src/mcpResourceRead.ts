import type {
  AgentUiProjectionContext,
  AgentUiProjectionEvent,
  AgentUiRuntimeStatus,
} from "@limecloud/agent-ui-contracts";

import {
  compactProjectionFields,
  definedString,
  readBooleanField,
  readRecord,
  readStringArrayField,
  readStringField,
  truncateText,
} from "./normalization.js";

const RESOURCE_CONTENT_PREVIEW_LIMIT = 240;

export type AgentUiMcpResourceToolName =
  | "list_mcp_resources"
  | "list_mcp_resource_templates"
  | "read_mcp_resource";

export type AgentUiMcpResourceToolAction =
  | "list_resources"
  | "list_resource_templates"
  | "read_resource";

export type AgentUiMcpResourceSchemaIssueCode =
  | "unknown_tool"
  | "legacy_tool_name"
  | "missing_required_field"
  | "forbidden_field"
  | "missing_resource_content";

export interface AgentUiMcpResourceSchemaIssue {
  code: AgentUiMcpResourceSchemaIssueCode;
  path: string;
  message: string;
}

export interface AgentUiMcpResourceToolContract {
  name: AgentUiMcpResourceToolName;
  action: AgentUiMcpResourceToolAction;
  requiredInputFields: readonly string[];
  optionalInputFields: readonly string[];
  forbiddenInputFields: readonly string[];
  outputRequiredFields: readonly string[];
}

export interface AgentUiMcpResourceSchemaValidationInput {
  toolName: string;
  input?: unknown;
  path?: string;
}

export interface AgentUiMcpResourceReadProjectionInput {
  toolName: string;
  input?: unknown;
  result?: unknown;
  metadata?: unknown;
  status?: AgentUiRuntimeStatus | string | null;
  toolCallId?: string | null;
  evidenceId?: string | null;
  evidenceRefs?: readonly string[] | null;
  artifactRefs?: readonly string[] | null;
  timestamp?: string | null;
}

export type AgentUiMcpResourceContentKind = "text" | "blob" | "unknown";

export interface AgentUiMcpResourceContentSnapshot {
  uri: string;
  mimeType?: string;
  contentKind: AgentUiMcpResourceContentKind;
  preview?: string;
  contentLength?: number;
  truncated: boolean;
}

export interface AgentUiMcpResourceReadSnapshot {
  toolName: "read_mcp_resource";
  server: string;
  uri: string;
  threadId?: string;
  contextThreadId?: string;
  scopedToThread: boolean;
  contents: AgentUiMcpResourceContentSnapshot[];
  contentPreview?: string;
  truncated: boolean;
  artifactRefs: string[];
  evidenceRefs: string[];
}

const CONTRACTS: readonly AgentUiMcpResourceToolContract[] = [
  {
    name: "list_mcp_resources",
    action: "list_resources",
    requiredInputFields: [],
    optionalInputFields: ["server", "cursor"],
    forbiddenInputFields: ["uri", "resource_name", "content", "contents"],
    outputRequiredFields: ["resources"],
  },
  {
    name: "list_mcp_resource_templates",
    action: "list_resource_templates",
    requiredInputFields: [],
    optionalInputFields: ["server", "cursor"],
    forbiddenInputFields: ["uri", "resource_name", "content", "contents"],
    outputRequiredFields: ["resource_templates"],
  },
  {
    name: "read_mcp_resource",
    action: "read_resource",
    requiredInputFields: ["server", "uri"],
    optionalInputFields: ["thread_id", "threadId"],
    forbiddenInputFields: [
      "server_name",
      "serverName",
      "resource_name",
      "resourceName",
      "url",
      "content",
      "contents",
      "output",
    ],
    outputRequiredFields: ["contents"],
  },
];

const CONTRACT_BY_NAME = new Map(
  CONTRACTS.map((contract) => [contract.name, contract]),
);

const LEGACY_MCP_RESOURCE_TOOL_NAMES = new Set([
  "ListMcpResources",
  "ListMcpResourcesTool",
  "ListMcpResourceTemplates",
  "ListMcpResourceTemplatesTool",
  "ReadMcpResource",
  "ReadMcpResourceTool",
  "McpResourceTool",
  "mcp.resource.list",
  "mcp.resource.read",
]);

function normalizedToolName(
  value: string | null | undefined,
): string | undefined {
  return definedString(value);
}

function issue(
  code: AgentUiMcpResourceSchemaIssueCode,
  path: string,
  message: string,
): AgentUiMcpResourceSchemaIssue {
  return { code, path, message };
}

function readStringArrayFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]),
  );
}

function resultRoots(
  result: unknown,
  metadata: unknown,
): Record<string, unknown>[] {
  const resultRecord = readRecord(result);
  const resultMetadata = readRecord(resultRecord?.metadata);
  const inputMetadata = readRecord(metadata);
  return [
    resultRecord,
    readRecord(resultRecord?.result),
    readRecord(resultRecord?.structuredContent),
    readRecord(resultRecord?.structured_content),
    readRecord(resultMetadata?.mcpResourceRead),
    readRecord(resultMetadata?.mcp_resource_read),
    readRecord(inputMetadata?.mcpResourceRead),
    readRecord(inputMetadata?.mcp_resource_read),
  ].filter((record): record is Record<string, unknown> => Boolean(record));
}

function contentRecordsFromRoot(
  root: Record<string, unknown>,
): Record<string, unknown>[] {
  const contents = root.contents;
  if (Array.isArray(contents)) {
    return contents
      .map((item) => readRecord(item))
      .filter((record): record is Record<string, unknown> => Boolean(record));
  }
  const content = readRecord(root.content);
  if (content) return [content];
  if (
    readStringField(root, ["uri"]) ||
    readStringField(root, ["text", "blob"])
  ) {
    return [root];
  }
  return [];
}

function extractContentSnapshots(
  input: AgentUiMcpResourceReadProjectionInput,
  requestUri: string,
): AgentUiMcpResourceContentSnapshot[] {
  const records = resultRoots(input.result, input.metadata).flatMap(
    contentRecordsFromRoot,
  );
  const snapshots: AgentUiMcpResourceContentSnapshot[] = [];
  const seen = new Set<string>();

  for (const record of records) {
    const uri = readStringField(record, ["uri"]) ?? requestUri;
    const text = readStringField(record, ["text"]);
    const blob = readStringField(record, ["blob"]);
    const rawContent = text ?? blob;
    const contentKind: AgentUiMcpResourceContentKind = text
      ? "text"
      : blob
        ? "blob"
        : "unknown";
    const preview = truncateText(rawContent, RESOURCE_CONTENT_PREVIEW_LIMIT);
    const explicitTruncated = readBooleanField(record, [
      "truncated",
      "isTruncated",
      "is_truncated",
    ]);
    const contentLength = rawContent?.length;
    const truncated =
      explicitTruncated ??
      Boolean(rawContent && rawContent.length > RESOURCE_CONTENT_PREVIEW_LIMIT);
    const mimeType = readStringField(record, ["mimeType", "mime_type"]);
    const key = `${uri}\0${contentKind}\0${preview ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    snapshots.push(
      compactProjectionFields({
        uri,
        mimeType,
        contentKind,
        preview,
        contentLength,
        truncated,
      }),
    );
  }

  return snapshots;
}

function collectRefs(
  input: AgentUiMcpResourceReadProjectionInput,
  keys: string[],
): string[] {
  const resultRecord = readRecord(input.result);
  const resultMetadata = readRecord(resultRecord?.metadata);
  const metadata = readRecord(input.metadata);
  return uniqueStrings([
    ...readStringArrayFromUnknown(
      keys.includes("evidenceRefs") ? input.evidenceRefs : input.artifactRefs,
    ),
    ...readStringArrayField(resultRecord, keys),
    ...readStringArrayField(resultMetadata, keys),
    ...readStringArrayField(metadata, keys),
  ]);
}

function resolveStatus(
  input: AgentUiMcpResourceReadProjectionInput,
  validationIssues: readonly AgentUiMcpResourceSchemaIssue[],
): AgentUiRuntimeStatus {
  if (validationIssues.length > 0) return "failed";
  const status = definedString(input.status ?? undefined);
  if (!status) return "completed";
  switch (status) {
    case "pending":
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "completed":
    case "success":
      return "completed";
    case "blocked":
      return "needs_input";
    case "failed":
    case "error":
      return "failed";
    case "canceled":
    case "cancelled":
      return "cancelled";
    default:
      return "unknown";
  }
}

export function listMcpResourceToolContracts(): readonly AgentUiMcpResourceToolContract[] {
  return CONTRACTS;
}

export function isMcpResourceToolName(
  toolName: string | null | undefined,
): toolName is AgentUiMcpResourceToolName {
  const normalized = normalizedToolName(toolName);
  return Boolean(
    normalized &&
    CONTRACT_BY_NAME.has(normalized as AgentUiMcpResourceToolName),
  );
}

export function isLegacyMcpResourceToolName(
  toolName: string | null | undefined,
): boolean {
  const normalized = normalizedToolName(toolName);
  return Boolean(normalized && LEGACY_MCP_RESOURCE_TOOL_NAMES.has(normalized));
}

export function getMcpResourceToolContract(
  toolName: string | null | undefined,
): AgentUiMcpResourceToolContract | undefined {
  const normalized = normalizedToolName(toolName);
  if (!normalized) return undefined;
  return CONTRACT_BY_NAME.get(normalized as AgentUiMcpResourceToolName);
}

export function validateMcpResourceToolSchema(
  input: AgentUiMcpResourceSchemaValidationInput,
): AgentUiMcpResourceSchemaIssue[] {
  const path = input.path ?? "$";
  const toolName = normalizedToolName(input.toolName);
  if (!toolName) {
    return [
      issue(
        "unknown_tool",
        `${path}.toolName`,
        "MCP resource tool name is required.",
      ),
    ];
  }
  if (isLegacyMcpResourceToolName(toolName)) {
    return [
      issue(
        "legacy_tool_name",
        `${path}.toolName`,
        `${toolName} is a legacy Lime/Agent MCP resource tool name; use current MCP resource tools instead.`,
      ),
    ];
  }

  const contract = getMcpResourceToolContract(toolName);
  if (!contract) {
    return [
      issue(
        "unknown_tool",
        `${path}.toolName`,
        `${toolName} is not a current MCP resource tool.`,
      ),
    ];
  }

  const args = readRecord(input.input) ?? {};
  const issues: AgentUiMcpResourceSchemaIssue[] = [];
  for (const field of contract.requiredInputFields) {
    if (
      args[field] === undefined ||
      args[field] === null ||
      args[field] === ""
    ) {
      issues.push(
        issue(
          "missing_required_field",
          `${path}.input.${field}`,
          `${toolName} requires ${field}.`,
        ),
      );
    }
  }
  for (const field of contract.forbiddenInputFields) {
    if (args[field] !== undefined) {
      issues.push(
        issue(
          "forbidden_field",
          `${path}.input.${field}`,
          `${toolName} does not accept legacy field ${field}.`,
        ),
      );
    }
  }
  return issues;
}

export function extractMcpResourceReadSnapshot(
  input: AgentUiMcpResourceReadProjectionInput,
  context: AgentUiProjectionContext = {},
): AgentUiMcpResourceReadSnapshot | undefined {
  if (
    getMcpResourceToolContract(input.toolName)?.name !== "read_mcp_resource"
  ) {
    return undefined;
  }
  const args = readRecord(input.input) ?? {};
  const server = readStringField(args, ["server"]);
  const uri = readStringField(args, ["uri"]);
  if (!server || !uri) return undefined;
  const threadId =
    readStringField(args, ["thread_id", "threadId"]) ??
    readStringField(readRecord(input.metadata), ["thread_id", "threadId"]);
  const contents = extractContentSnapshots(input, uri);
  const artifactRefs = collectRefs(input, ["artifactRefs", "artifact_refs"]);
  const evidenceRefs = collectRefs(input, ["evidenceRefs", "evidence_refs"]);
  const contentPreview = truncateText(
    contents
      .map((content) => content.preview)
      .filter(Boolean)
      .join("\n"),
    RESOURCE_CONTENT_PREVIEW_LIMIT,
  );

  return compactProjectionFields({
    toolName: "read_mcp_resource" as const,
    server,
    uri,
    threadId,
    contextThreadId: definedString(context.threadId ?? undefined),
    scopedToThread: Boolean(threadId),
    contents,
    contentPreview,
    truncated:
      contents.some((content) => content.truncated) ||
      Boolean(
        contentPreview &&
        contentPreview.length > RESOURCE_CONTENT_PREVIEW_LIMIT,
      ),
    artifactRefs,
    evidenceRefs,
  } satisfies AgentUiMcpResourceReadSnapshot);
}

export function buildMcpResourceReadProjectionEvent(
  input: AgentUiMcpResourceReadProjectionInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent | undefined {
  const contract = getMcpResourceToolContract(input.toolName);
  if (contract?.name !== "read_mcp_resource") return undefined;
  const snapshot = extractMcpResourceReadSnapshot(input, context);
  if (!snapshot) return undefined;
  const validationIssues = validateMcpResourceToolSchema({
    toolName: input.toolName,
    input: input.input,
  });
  if (snapshot.contents.length === 0) {
    validationIssues.push(
      issue(
        "missing_resource_content",
        "$.result.contents",
        "read_mcp_resource requires structured resource contents; ordinary tool output is not accepted.",
      ),
    );
  }
  const runtimeStatus = resolveStatus(input, validationIssues);
  const evidenceId =
    definedString(input.evidenceId ?? undefined) ??
    snapshot.evidenceRefs[0] ??
    `mcp-resource-read:${snapshot.server}:${snapshot.uri}`;

  return compactProjectionFields({
    type: "evidence.changed",
    sourceType: "mcp_resource_read_projection",
    sequence: context.sequence,
    timestamp: definedString(input.timestamp ?? undefined) ?? context.timestamp,
    sessionId: definedString(context.sessionId ?? undefined),
    threadId: definedString(context.threadId ?? undefined),
    runId: definedString(context.runId ?? undefined),
    turnId: definedString(context.turnId ?? undefined),
    toolCallId: definedString(input.toolCallId ?? undefined),
    evidenceId,
    owner: "evidence",
    scope: "tool_call",
    phase: validationIssues.length > 0 ? "failed" : "completed",
    surface: "timeline_evidence",
    persistence: "evidence_pack",
    control: "open_detail",
    runtimeEntity: "agent_turn",
    runtimeStatus,
    latestTurnStatus: runtimeStatus,
    payload: {
      mcpResourceEvent: "resource_read",
      toolName: contract.name,
      action: contract.action,
      server: snapshot.server,
      uri: snapshot.uri,
      threadId: snapshot.threadId,
      contextThreadId: snapshot.contextThreadId,
      scopedToThread: snapshot.scopedToThread,
      contentPreview: snapshot.contentPreview,
      truncated: snapshot.truncated,
      contentCount: snapshot.contents.length,
      mcpResourceRead: snapshot,
      validationIssues,
    },
    refs:
      snapshot.artifactRefs.length > 0
        ? { artifactIds: snapshot.artifactRefs }
        : undefined,
  } satisfies AgentUiProjectionEvent);
}
