import type {
  AgentUiProjectionContext,
  AgentUiProjectionEvent,
  AgentUiRuntimeStatus,
} from "@limecloud/agent-ui-contracts";

import {
  compactProjectionFields,
  definedString,
  normalizeProjectionIdList,
  readBooleanField,
  readNumberField,
  readRecord,
  readStringField,
} from "./normalization.js";

export type AgentUiMcpThreadScopeIssueCode =
  | "missing_selected_thread"
  | "missing_selected_root"
  | "missing_plugin_server"
  | "selected_server_missing_plugin_owner"
  | "missing_selected_thread_inventory"
  | "selected_thread_missing_server"
  | "selected_server_unscoped"
  | "selected_server_leaked_to_thread"
  | "tool_call_missing_thread_scope"
  | "tool_call_wrong_thread"
  | "oauth_notification_missing_thread_scope"
  | "oauth_notification_wrong_thread";

export interface AgentUiMcpThreadScopeIssue {
  code: AgentUiMcpThreadScopeIssueCode;
  path: string;
  message: string;
}

export interface AgentUiMcpThreadScopeProjectionInput {
  selectedThreadId?: string | null;
  threads?: unknown;
  threadInventories?: unknown;
  selectedCapabilityRoots?: unknown;
  mcpServerContributions?: unknown;
  selectedPluginServers?: unknown;
  toolCalls?: unknown;
  oauthNotifications?: unknown;
  timestamp?: string | null;
}

export interface AgentUiMcpSelectedRootSnapshot {
  id: string;
  threadId?: string;
  locationType?: string;
  environmentId?: string;
  path?: string;
}

export interface AgentUiMcpSelectedPluginServerSnapshot {
  name: string;
  pluginId?: string;
  pluginDisplayName?: string;
  selectedRootId?: string;
  selectionOrder?: number;
  environmentId?: string;
  ownerThreadId?: string;
  enabled: boolean;
}

export interface AgentUiMcpThreadInventorySnapshot {
  threadId?: string;
  scopedToThread: boolean;
  selectedRootIds: string[];
  serverNames: string[];
  selectedPluginServerNames: string[];
}

export interface AgentUiMcpThreadScopedToolCallSnapshot {
  server: string;
  tool?: string;
  threadId?: string;
  scopedToOwnerThread: boolean;
}

export interface AgentUiMcpThreadScopedOAuthSnapshot {
  server: string;
  threadId?: string;
  success?: boolean;
  scopedToOwnerThread: boolean;
}

export interface AgentUiMcpThreadScopeLeak {
  server: string;
  threadId?: string;
  path: string;
}

export interface AgentUiMcpThreadScopeSnapshot {
  selectedThreadId?: string;
  selectedRootIds: string[];
  selectedRoots: AgentUiMcpSelectedRootSnapshot[];
  selectedPluginServerNames: string[];
  selectedPluginServers: AgentUiMcpSelectedPluginServerSnapshot[];
  globalServerNames: string[];
  threadInventories: AgentUiMcpThreadInventorySnapshot[];
  toolCalls: AgentUiMcpThreadScopedToolCallSnapshot[];
  oauthNotifications: AgentUiMcpThreadScopedOAuthSnapshot[];
  leaks: AgentUiMcpThreadScopeLeak[];
  scopeStable: boolean;
  validationIssues: AgentUiMcpThreadScopeIssue[];
}

function issue(
  code: AgentUiMcpThreadScopeIssueCode,
  path: string,
  message: string,
): AgentUiMcpThreadScopeIssue {
  return { code, path, message };
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => readRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function readThreadId(
  record: Record<string, unknown> | undefined,
): string | undefined {
  return readStringField(record, ["threadId", "thread_id", "id"]);
}

function rootRecords(
  record: Record<string, unknown> | undefined,
): Record<string, unknown>[] {
  if (!record) return [];
  return [
    ...recordArray(record.selectedCapabilityRoots),
    ...recordArray(record.selected_capability_roots),
  ];
}

function readNameList(value: unknown): string[] {
  if (typeof value === "string") {
    return normalizeProjectionIdList([value]);
  }
  if (!Array.isArray(value)) return [];
  return normalizeProjectionIdList(
    value.map((item) => {
      if (typeof item === "string") return item;
      const record = readRecord(item);
      return readStringField(record, [
        "name",
        "server",
        "serverName",
        "server_name",
      ]);
    }),
  );
}

function inventoryServerNames(record: Record<string, unknown>): string[] {
  for (const key of [
    "mcpServerNames",
    "mcp_server_names",
    "mcpServers",
    "mcp_servers",
    "servers",
  ]) {
    const names = readNameList(record[key]);
    if (names.length > 0) return names;
  }
  return [];
}

function selectedThreadIdForInput(
  input: AgentUiMcpThreadScopeProjectionInput,
): string | undefined {
  const explicit = definedString(input.selectedThreadId ?? undefined);
  if (explicit) return explicit;
  for (const thread of [
    ...recordArray(input.threads),
    ...recordArray(input.threadInventories),
  ]) {
    if (rootRecords(thread).length > 0) return readThreadId(thread);
  }
  return undefined;
}

function buildSelectedRoot(
  record: Record<string, unknown>,
  threadId: string | undefined,
): AgentUiMcpSelectedRootSnapshot | undefined {
  const id = readStringField(record, [
    "id",
    "selectedRootId",
    "selected_root_id",
  ]);
  if (!id) return undefined;
  const location = readRecord(record.location);
  return compactProjectionFields({
    id,
    threadId,
    locationType: readStringField(location, ["type"]),
    environmentId: readStringField(location, [
      "environmentId",
      "environment_id",
    ]),
    path: readStringField(location, ["path", "uri"]),
  } satisfies AgentUiMcpSelectedRootSnapshot);
}

function selectedRootsForInput(
  input: AgentUiMcpThreadScopeProjectionInput,
  selectedThreadId: string | undefined,
): AgentUiMcpSelectedRootSnapshot[] {
  const roots: AgentUiMcpSelectedRootSnapshot[] = [];
  for (const root of recordArray(input.selectedCapabilityRoots)) {
    const snapshot = buildSelectedRoot(root, selectedThreadId);
    if (snapshot) roots.push(snapshot);
  }
  for (const thread of [
    ...recordArray(input.threads),
    ...recordArray(input.threadInventories),
  ]) {
    const threadId = readThreadId(thread);
    for (const root of rootRecords(thread)) {
      const snapshot = buildSelectedRoot(root, threadId);
      if (snapshot) roots.push(snapshot);
    }
  }
  const seen = new Set<string>();
  return roots.filter((root) => {
    const key = `${root.threadId ?? ""}:${root.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function contributionRecords(
  input: AgentUiMcpThreadScopeProjectionInput,
): Record<string, unknown>[] {
  return [
    ...recordArray(input.mcpServerContributions),
    ...recordArray(input.selectedPluginServers),
  ];
}

function isSelectedPluginContribution(
  record: Record<string, unknown>,
  selectedRootIds: ReadonlySet<string>,
): boolean {
  const kind = readStringField(record, [
    "kind",
    "type",
    "contributionType",
    "contribution_type",
  ]);
  const pluginId = readStringField(record, ["pluginId", "plugin_id"]);
  const selectedRootId = readStringField(record, [
    "selectedRootId",
    "selected_root_id",
  ]);
  return (
    kind === "SelectedPlugin" ||
    kind === "selected_plugin" ||
    Boolean(
      pluginId && (selectedRootIds.size === 0 || selectedRootIds.has(pluginId)),
    ) ||
    Boolean(selectedRootId && selectedRootIds.has(selectedRootId))
  );
}

function buildSelectedPluginServer(
  record: Record<string, unknown>,
): AgentUiMcpSelectedPluginServerSnapshot | undefined {
  const name = readStringField(record, [
    "name",
    "server",
    "serverName",
    "server_name",
  ]);
  if (!name) return undefined;
  const pluginId = readStringField(record, ["pluginId", "plugin_id"]);
  return compactProjectionFields({
    name,
    pluginId,
    pluginDisplayName: readStringField(record, [
      "pluginDisplayName",
      "plugin_display_name",
    ]),
    selectedRootId:
      readStringField(record, ["selectedRootId", "selected_root_id"]) ??
      pluginId,
    selectionOrder: readNumberField(record, [
      "selectionOrder",
      "selection_order",
    ]),
    environmentId: readStringField(record, ["environmentId", "environment_id"]),
    ownerThreadId: readStringField(record, [
      "ownerThreadId",
      "owner_thread_id",
      "threadId",
      "thread_id",
    ]),
    enabled: readBooleanField(record, ["enabled"]) ?? true,
  } satisfies AgentUiMcpSelectedPluginServerSnapshot);
}

function selectedPluginServersForInput(
  input: AgentUiMcpThreadScopeProjectionInput,
  selectedRootIds: readonly string[],
): AgentUiMcpSelectedPluginServerSnapshot[] {
  const selectedRootSet = new Set(selectedRootIds);
  const servers = contributionRecords(input)
    .filter((record) => isSelectedPluginContribution(record, selectedRootSet))
    .map(buildSelectedPluginServer)
    .filter((item): item is AgentUiMcpSelectedPluginServerSnapshot =>
      Boolean(item),
    );
  const seen = new Set<string>();
  return servers.filter((server) => {
    const key = `${server.name}:${server.pluginId ?? ""}:${server.selectedRootId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildThreadInventory(
  record: Record<string, unknown>,
  selectedServerNames: ReadonlySet<string>,
): AgentUiMcpThreadInventorySnapshot | undefined {
  const serverNames = inventoryServerNames(record);
  const selectedPluginServerNames = serverNames.filter((name) =>
    selectedServerNames.has(name),
  );
  const threadId = readThreadId(record);
  const selectedRootIds = rootRecords(record)
    .map((root) =>
      readStringField(root, ["id", "selectedRootId", "selected_root_id"]),
    )
    .filter((id): id is string => Boolean(id));
  if (!threadId && serverNames.length === 0 && selectedRootIds.length === 0)
    return undefined;
  return compactProjectionFields({
    threadId,
    scopedToThread: Boolean(threadId),
    selectedRootIds,
    serverNames,
    selectedPluginServerNames,
  } satisfies AgentUiMcpThreadInventorySnapshot);
}

function threadInventoriesForInput(
  input: AgentUiMcpThreadScopeProjectionInput,
  selectedServerNames: ReadonlySet<string>,
): AgentUiMcpThreadInventorySnapshot[] {
  const explicit = recordArray(input.threadInventories);
  const records = explicit.length > 0 ? explicit : recordArray(input.threads);
  return records
    .map((record) => buildThreadInventory(record, selectedServerNames))
    .filter((item): item is AgentUiMcpThreadInventorySnapshot => Boolean(item));
}

function buildToolCall(
  record: Record<string, unknown>,
  selectedThreadId: string | undefined,
): AgentUiMcpThreadScopedToolCallSnapshot | undefined {
  const server = readStringField(record, [
    "server",
    "serverName",
    "server_name",
    "name",
  ]);
  if (!server) return undefined;
  const threadId = readStringField(record, ["threadId", "thread_id"]);
  return compactProjectionFields({
    server,
    tool: readStringField(record, ["tool", "toolName", "tool_name"]),
    threadId,
    scopedToOwnerThread: Boolean(
      selectedThreadId && threadId === selectedThreadId,
    ),
  } satisfies AgentUiMcpThreadScopedToolCallSnapshot);
}

function buildOAuthNotification(
  record: Record<string, unknown>,
  selectedThreadId: string | undefined,
): AgentUiMcpThreadScopedOAuthSnapshot | undefined {
  const server = readStringField(record, [
    "server",
    "serverName",
    "server_name",
    "name",
  ]);
  if (!server) return undefined;
  const threadId = readStringField(record, ["threadId", "thread_id"]);
  return compactProjectionFields({
    server,
    threadId,
    success: readBooleanField(record, ["success"]),
    scopedToOwnerThread: Boolean(
      selectedThreadId && threadId === selectedThreadId,
    ),
  } satisfies AgentUiMcpThreadScopedOAuthSnapshot);
}

function buildLeaks(
  inventories: readonly AgentUiMcpThreadInventorySnapshot[],
  selectedThreadId: string | undefined,
): AgentUiMcpThreadScopeLeak[] {
  const leaks: AgentUiMcpThreadScopeLeak[] = [];
  inventories.forEach((inventory, inventoryIndex) => {
    inventory.selectedPluginServerNames.forEach((server) => {
      if (!inventory.threadId || inventory.threadId !== selectedThreadId) {
        leaks.push(
          compactProjectionFields({
            server,
            threadId: inventory.threadId,
            path: `$.threadInventories[${inventoryIndex}].serverNames`,
          } satisfies AgentUiMcpThreadScopeLeak),
        );
      }
    });
  });
  return leaks;
}

function validateSnapshot(
  snapshot: Omit<
    AgentUiMcpThreadScopeSnapshot,
    "scopeStable" | "validationIssues"
  >,
): AgentUiMcpThreadScopeIssue[] {
  const issues: AgentUiMcpThreadScopeIssue[] = [];
  const enabledSelectedServers = snapshot.selectedPluginServers.filter(
    (server) => server.enabled,
  );
  const selectedServerNames = new Set(
    enabledSelectedServers.map((server) => server.name),
  );
  const selectedThreadInventory = snapshot.threadInventories.find(
    (inventory) => inventory.threadId === snapshot.selectedThreadId,
  );

  if (!snapshot.selectedThreadId) {
    issues.push(
      issue(
        "missing_selected_thread",
        "$.selectedThreadId",
        "MCP thread scope requires the selected thread id.",
      ),
    );
  }
  if (snapshot.selectedRoots.length === 0) {
    issues.push(
      issue(
        "missing_selected_root",
        "$.selectedCapabilityRoots",
        "Selected executor/plugin MCP scope requires selected capability roots.",
      ),
    );
  }
  if (enabledSelectedServers.length === 0) {
    issues.push(
      issue(
        "missing_plugin_server",
        "$.mcpServerContributions",
        "Selected executor/plugin MCP scope requires selected plugin server contributions.",
      ),
    );
  }
  enabledSelectedServers.forEach((server, serverIndex) => {
    if (!server.pluginId && !server.selectedRootId) {
      issues.push(
        issue(
          "selected_server_missing_plugin_owner",
          `$.mcpServerContributions[${serverIndex}]`,
          "Selected plugin MCP server must preserve plugin or selected-root ownership.",
        ),
      );
    }
  });
  if (selectedServerNames.size > 0 && !selectedThreadInventory) {
    issues.push(
      issue(
        "missing_selected_thread_inventory",
        "$.threadInventories",
        "Selected plugin MCP scope requires an inventory snapshot for the selected thread.",
      ),
    );
  }
  enabledSelectedServers.forEach((server) => {
    if (
      selectedThreadInventory &&
      !selectedThreadInventory.serverNames.includes(server.name)
    ) {
      issues.push(
        issue(
          "selected_thread_missing_server",
          "$.threadInventories",
          `Selected thread inventory is missing selected plugin MCP server ${server.name}.`,
        ),
      );
    }
  });
  snapshot.leaks.forEach((leak) => {
    issues.push(
      issue(
        leak.threadId
          ? "selected_server_leaked_to_thread"
          : "selected_server_unscoped",
        leak.path,
        leak.threadId
          ? `Selected plugin MCP server ${leak.server} leaked into thread ${leak.threadId}.`
          : `Selected plugin MCP server ${leak.server} leaked into an unscoped/global inventory.`,
      ),
    );
  });
  snapshot.toolCalls.forEach((call, callIndex) => {
    if (!selectedServerNames.has(call.server)) return;
    if (!call.threadId) {
      issues.push(
        issue(
          "tool_call_missing_thread_scope",
          `$.toolCalls[${callIndex}].threadId`,
          "Selected plugin MCP tool calls must carry the owning thread id.",
        ),
      );
    } else if (
      snapshot.selectedThreadId &&
      call.threadId !== snapshot.selectedThreadId
    ) {
      issues.push(
        issue(
          "tool_call_wrong_thread",
          `$.toolCalls[${callIndex}].threadId`,
          "Selected plugin MCP tool call thread id must match the selected thread.",
        ),
      );
    }
  });
  snapshot.oauthNotifications.forEach((notification, notificationIndex) => {
    if (!selectedServerNames.has(notification.server)) return;
    if (!notification.threadId) {
      issues.push(
        issue(
          "oauth_notification_missing_thread_scope",
          `$.oauthNotifications[${notificationIndex}].threadId`,
          "Selected plugin MCP OAuth notifications must carry the owning thread id.",
        ),
      );
    } else if (
      snapshot.selectedThreadId &&
      notification.threadId !== snapshot.selectedThreadId
    ) {
      issues.push(
        issue(
          "oauth_notification_wrong_thread",
          `$.oauthNotifications[${notificationIndex}].threadId`,
          "Selected plugin MCP OAuth notification thread id must match the selected thread.",
        ),
      );
    }
  });
  return issues;
}

function runtimeStatus(
  issues: readonly AgentUiMcpThreadScopeIssue[],
): AgentUiRuntimeStatus {
  return issues.length > 0 ? "failed" : "completed";
}

export function extractMcpThreadScopeSnapshot(
  input: AgentUiMcpThreadScopeProjectionInput,
): AgentUiMcpThreadScopeSnapshot {
  const selectedThreadId = selectedThreadIdForInput(input);
  const selectedRoots = selectedRootsForInput(input, selectedThreadId);
  const selectedRootIds = normalizeProjectionIdList(
    selectedRoots.map((root) => root.id),
  );
  const selectedPluginServers = selectedPluginServersForInput(
    input,
    selectedRootIds,
  );
  const selectedPluginServerNames = normalizeProjectionIdList(
    selectedPluginServers
      .filter((server) => server.enabled)
      .map((server) => server.name),
  );
  const selectedServerNameSet = new Set(selectedPluginServerNames);
  const threadInventories = threadInventoriesForInput(
    input,
    selectedServerNameSet,
  );
  const toolCalls = recordArray(input.toolCalls)
    .map((record) => buildToolCall(record, selectedThreadId))
    .filter((item): item is AgentUiMcpThreadScopedToolCallSnapshot =>
      Boolean(item),
    );
  const oauthNotifications = recordArray(input.oauthNotifications)
    .map((record) => buildOAuthNotification(record, selectedThreadId))
    .filter((item): item is AgentUiMcpThreadScopedOAuthSnapshot =>
      Boolean(item),
    );
  const allServerNames = normalizeProjectionIdList(
    threadInventories.flatMap((inventory) => inventory.serverNames),
  );
  const leaks = buildLeaks(threadInventories, selectedThreadId);
  const base = {
    selectedThreadId,
    selectedRootIds,
    selectedRoots,
    selectedPluginServerNames,
    selectedPluginServers,
    globalServerNames: allServerNames.filter(
      (name) => !selectedServerNameSet.has(name),
    ),
    threadInventories,
    toolCalls,
    oauthNotifications,
    leaks,
  };
  const validationIssues = validateSnapshot(base);
  return {
    ...base,
    scopeStable: validationIssues.length === 0,
    validationIssues,
  };
}

export function buildMcpThreadScopeProjectionEvent(
  input: AgentUiMcpThreadScopeProjectionInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractMcpThreadScopeSnapshot(input);
  const status = runtimeStatus(snapshot.validationIssues);
  return compactProjectionFields({
    type: "context.changed",
    sourceType: "mcp_thread_scope_projection",
    sequence: context.sequence,
    timestamp: definedString(input.timestamp ?? undefined) ?? context.timestamp,
    sessionId: definedString(context.sessionId ?? undefined),
    threadId:
      snapshot.selectedThreadId ?? definedString(context.threadId ?? undefined),
    runId: definedString(context.runId ?? undefined),
    turnId: definedString(context.turnId ?? undefined),
    owner: "context",
    scope: "thread",
    phase: snapshot.scopeStable ? "completed" : "failed",
    surface: "timeline_evidence",
    persistence: "snapshot",
    control: "open_detail",
    runtimeEntity: "agent_turn",
    runtimeStatus: status,
    latestTurnStatus: status,
    payload: {
      mcpThreadScopeEvent: "thread_scope",
      selectedThreadId: snapshot.selectedThreadId,
      selectedRootIds: snapshot.selectedRootIds,
      selectedPluginServerNames: snapshot.selectedPluginServerNames,
      globalServerNames: snapshot.globalServerNames,
      leakCount: snapshot.leaks.length,
      scopeStable: snapshot.scopeStable,
      mcpThreadScope: snapshot,
      validationIssues: snapshot.validationIssues,
    },
  } satisfies AgentUiProjectionEvent);
}
