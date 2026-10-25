import type {
  AgentUiProjectionContext,
  AgentUiProjectionEvent,
  AgentUiRuntimeStatus,
} from "@limecloud/agent-ui-contracts";

import {
  compactProjectionFields,
  definedString,
  readRecord,
  readStringField,
} from "./normalization.js";

export type AgentUiMcpInventoryDetail = "full" | "toolsAndAuthOnly";

export type AgentUiMcpInventoryIssueCode =
  | "missing_response_data"
  | "missing_raw_server_name"
  | "missing_raw_tool_name"
  | "naked_sanitized_tool_name"
  | "tools_auth_only_loaded_resources";

export interface AgentUiMcpInventoryIssue {
  code: AgentUiMcpInventoryIssueCode;
  path: string;
  message: string;
}

export interface AgentUiMcpInventoryStatusProjectionInput {
  params?: unknown;
  response?: unknown;
  timestamp?: string | null;
}

export interface AgentUiMcpInventoryToolSnapshot {
  rawName: string;
  displayName: string;
  sanitizedName: string;
  collisionKey: string;
}

export interface AgentUiMcpInventoryServerSnapshot {
  rawName: string;
  displayName: string;
  sanitizedName: string;
  collisionKey: string;
  title?: string;
  authStatus?: string;
  toolNames: string[];
  tools: AgentUiMcpInventoryToolSnapshot[];
  resourceCount: number;
  resourceTemplateCount: number;
}

export interface AgentUiMcpInventoryStatusSnapshot {
  detail: AgentUiMcpInventoryDetail;
  threadId?: string;
  scopedToThread: boolean;
  serverCount: number;
  toolCount: number;
  authOnly: boolean;
  hasNameCollisions: boolean;
  collisionGroups: Record<string, string[]>;
  servers: AgentUiMcpInventoryServerSnapshot[];
  validationIssues: AgentUiMcpInventoryIssue[];
}

function issue(
  code: AgentUiMcpInventoryIssueCode,
  path: string,
  message: string,
): AgentUiMcpInventoryIssue {
  return { code, path, message };
}

function sanitizeMcpName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function paramsRecord(
  input: AgentUiMcpInventoryStatusProjectionInput,
): Record<string, unknown> {
  return readRecord(input.params) ?? {};
}

function responseRecord(
  input: AgentUiMcpInventoryStatusProjectionInput,
): Record<string, unknown> {
  return readRecord(input.response) ?? {};
}

function responseData(
  input: AgentUiMcpInventoryStatusProjectionInput,
): Record<string, unknown>[] {
  const response = responseRecord(input);
  const data = response.data ?? response.servers;
  return Array.isArray(data)
    ? data
        .map((item) => readRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function normalizeDetail(value: string | undefined): AgentUiMcpInventoryDetail {
  return value === "toolsAndAuthOnly" || value === "tools_and_auth_only"
    ? "toolsAndAuthOnly"
    : "full";
}

function toolRecords(
  server: Record<string, unknown>,
): Array<[string, Record<string, unknown>]> {
  const tools = readRecord(server.tools);
  if (tools) {
    return Object.entries(tools)
      .map(([name, value]) => [name, readRecord(value) ?? { name }] as const)
      .map(([name, value]) => [name, value]);
  }
  const toolList = Array.isArray(server.tools) ? server.tools : [];
  return toolList
    .map((value) => readRecord(value))
    .filter((value): value is Record<string, unknown> => Boolean(value))
    .map((value) => [readStringField(value, ["name"]) ?? "", value]);
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function buildToolSnapshot(
  rawKey: string,
  record: Record<string, unknown>,
): AgentUiMcpInventoryToolSnapshot | undefined {
  const rawName = readStringField(record, ["name"]) ?? definedString(rawKey);
  if (!rawName) return undefined;
  const sanitizedName = sanitizeMcpName(rawName);
  return {
    rawName,
    displayName: rawName,
    sanitizedName,
    collisionKey: sanitizedName,
  };
}

function buildServerSnapshot(
  server: Record<string, unknown>,
): AgentUiMcpInventoryServerSnapshot | undefined {
  const rawName = readStringField(server, ["name"]);
  if (!rawName) return undefined;
  const serverInfo =
    readRecord(server.serverInfo) ?? readRecord(server.server_info);
  const tools = toolRecords(server)
    .map(([name, record]) => buildToolSnapshot(name, record))
    .filter((item): item is AgentUiMcpInventoryToolSnapshot => Boolean(item));
  const sanitizedName = sanitizeMcpName(rawName);
  return compactProjectionFields({
    rawName,
    displayName: rawName,
    sanitizedName,
    collisionKey: sanitizedName,
    title: readStringField(serverInfo, ["title", "name"]),
    authStatus: readStringField(server, ["authStatus", "auth_status"]),
    toolNames: tools.map((tool) => tool.rawName),
    tools,
    resourceCount: countArray(server.resources),
    resourceTemplateCount: countArray(
      server.resourceTemplates ?? server.resource_templates,
    ),
  } satisfies AgentUiMcpInventoryServerSnapshot);
}

function collisionGroups(
  servers: AgentUiMcpInventoryServerSnapshot[],
): Record<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const server of servers) {
    groups.set(server.collisionKey, [
      ...(groups.get(server.collisionKey) ?? []),
      server.rawName,
    ]);
  }
  return Object.fromEntries(
    Array.from(groups.entries()).filter(([, names]) => names.length > 1),
  );
}

function validateSnapshot(
  snapshot: Omit<AgentUiMcpInventoryStatusSnapshot, "validationIssues">,
): AgentUiMcpInventoryIssue[] {
  const issues: AgentUiMcpInventoryIssue[] = [];
  if (snapshot.serverCount === 0) {
    issues.push(
      issue(
        "missing_response_data",
        "$.response.data",
        "MCP inventory status requires response data.",
      ),
    );
  }
  snapshot.servers.forEach((server, serverIndex) => {
    if (!server.rawName) {
      issues.push(
        issue(
          "missing_raw_server_name",
          `$.response.data[${serverIndex}].name`,
          "MCP inventory status must preserve the raw server name.",
        ),
      );
    }
    server.tools.forEach((tool, toolIndex) => {
      if (!tool.rawName) {
        issues.push(
          issue(
            "missing_raw_tool_name",
            `$.response.data[${serverIndex}].tools[${toolIndex}].name`,
            "MCP inventory status must preserve the raw tool name.",
          ),
        );
      }
      if (/__/.test(tool.rawName)) {
        issues.push(
          issue(
            "naked_sanitized_tool_name",
            `$.response.data[${serverIndex}].tools[${toolIndex}].name`,
            "MCP inventory status must not expose naked server__tool names as raw tool names.",
          ),
        );
      }
    });
    if (
      snapshot.detail === "toolsAndAuthOnly" &&
      (server.resourceCount > 0 || server.resourceTemplateCount > 0)
    ) {
      issues.push(
        issue(
          "tools_auth_only_loaded_resources",
          `$.response.data[${serverIndex}]`,
          "toolsAndAuthOnly detail must not load resources or resource templates.",
        ),
      );
    }
  });
  return issues;
}

function runtimeStatus(
  issues: readonly AgentUiMcpInventoryIssue[],
): AgentUiRuntimeStatus {
  return issues.length > 0 ? "failed" : "completed";
}

export function extractMcpInventoryStatusSnapshot(
  input: AgentUiMcpInventoryStatusProjectionInput,
): AgentUiMcpInventoryStatusSnapshot {
  const params = paramsRecord(input);
  const detail = normalizeDetail(readStringField(params, ["detail"]));
  const threadId = readStringField(params, ["threadId", "thread_id"]);
  const servers = responseData(input)
    .map(buildServerSnapshot)
    .filter((item): item is AgentUiMcpInventoryServerSnapshot => Boolean(item));
  const groups = collisionGroups(servers);
  const base = {
    detail,
    threadId,
    scopedToThread: Boolean(threadId),
    serverCount: servers.length,
    toolCount: servers.reduce(
      (count, server) => count + server.tools.length,
      0,
    ),
    authOnly: detail === "toolsAndAuthOnly",
    hasNameCollisions: Object.keys(groups).length > 0,
    collisionGroups: groups,
    servers,
  };
  return {
    ...base,
    validationIssues: validateSnapshot(base),
  };
}

export function buildMcpInventoryStatusProjectionEvent(
  input: AgentUiMcpInventoryStatusProjectionInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractMcpInventoryStatusSnapshot(input);
  const status = runtimeStatus(snapshot.validationIssues);
  return compactProjectionFields({
    type: "context.changed",
    sourceType: "mcp_inventory_status_projection",
    sequence: context.sequence,
    timestamp: definedString(input.timestamp ?? undefined) ?? context.timestamp,
    sessionId: definedString(context.sessionId ?? undefined),
    threadId: snapshot.threadId ?? definedString(context.threadId ?? undefined),
    runId: definedString(context.runId ?? undefined),
    turnId: definedString(context.turnId ?? undefined),
    owner: "context",
    scope: "thread",
    phase: snapshot.validationIssues.length > 0 ? "failed" : "completed",
    surface: "timeline_evidence",
    persistence: "snapshot",
    control: "open_detail",
    runtimeEntity: "agent_turn",
    runtimeStatus: status,
    latestTurnStatus: status,
    payload: {
      mcpInventoryEvent: "status",
      detail: snapshot.detail,
      threadId: snapshot.threadId,
      scopedToThread: snapshot.scopedToThread,
      serverCount: snapshot.serverCount,
      toolCount: snapshot.toolCount,
      authOnly: snapshot.authOnly,
      hasNameCollisions: snapshot.hasNameCollisions,
      collisionGroups: snapshot.collisionGroups,
      serverNames: snapshot.servers.map((server) => server.rawName),
      mcpInventoryStatus: snapshot,
      validationIssues: snapshot.validationIssues,
    },
  } satisfies AgentUiProjectionEvent);
}
