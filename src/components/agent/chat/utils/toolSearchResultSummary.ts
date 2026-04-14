import { resolveUserFacingToolDisplayLabel } from "./toolDisplayInfo";

export interface ToolSearchResultItemSummary {
  name: string;
  description?: string;
  source?: string;
  extensionName?: string;
  status?: string;
  deferredLoading?: boolean;
  alwaysVisible?: boolean;
}

export interface ToolSearchResultSummary {
  query?: string;
  caller?: string;
  count: number;
  notes: string[];
  tools: ToolSearchResultItemSummary[];
  totalDeferredTools?: number;
  pendingMcpServers?: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => readString(item))
    .filter((item): item is string => Boolean(item));
}

function normalizeToolRecord(
  value: unknown,
): ToolSearchResultItemSummary | null {
  if (typeof value === "string" && value.trim()) {
    return { name: value.trim() };
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const name = readString(record.name);
  if (!name) {
    return null;
  }

  const summary: ToolSearchResultItemSummary = { name };

  const description = readString(record.description);
  if (description) {
    summary.description = description;
  }

  const source = readString(record.source);
  if (source) {
    summary.source = source;
  }

  const extensionName = readString(
    record.extension_name ?? record.extensionName,
  );
  if (extensionName) {
    summary.extensionName = extensionName;
  }

  const status = readString(record.status);
  if (status) {
    summary.status = status;
  }

  const deferredLoading = readBoolean(
    record.deferred_loading ?? record.deferredLoading,
  );
  if (deferredLoading !== undefined) {
    summary.deferredLoading = deferredLoading;
  }

  const alwaysVisible = readBoolean(
    record.always_visible ?? record.alwaysVisible,
  );
  if (alwaysVisible !== undefined) {
    summary.alwaysVisible = alwaysVisible;
  }

  return summary;
}

export function normalizeToolSearchResultSummary(
  rawText: string | null | undefined,
): ToolSearchResultSummary | null {
  const trimmed = rawText?.trim();
  if (!trimmed) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const record = asRecord(parsed);
  if (!record) {
    return null;
  }

  const parsedTools = Array.isArray(record.tools)
    ? record.tools
        .map((item) => normalizeToolRecord(item))
        .filter((item): item is ToolSearchResultItemSummary => Boolean(item))
    : [];
  const legacyMatches = Array.isArray(record.matches)
    ? record.matches
        .map((item) => normalizeToolRecord(item))
        .filter((item): item is ToolSearchResultItemSummary => Boolean(item))
    : [];
  const tools = parsedTools.length > 0 ? parsedTools : legacyMatches;
  const notes = readStringArray(record.notes);
  const query = readString(record.query);
  const caller = readString(record.caller);
  const count = readFiniteNumber(record.count) ?? tools.length;
  const totalDeferredTools = readFiniteNumber(
    record.total_deferred_tools ?? record.totalDeferredTools,
  );
  const pendingMcpServers = readStringArray(
    record.pending_mcp_servers ?? record.pendingMcpServers,
  );

  if (
    !query &&
    tools.length === 0 &&
    notes.length === 0 &&
    pendingMcpServers.length === 0 &&
    count === 0
  ) {
    return null;
  }

  const summary: ToolSearchResultSummary = {
    count,
    notes,
    tools,
  };

  if (query) {
    summary.query = query;
  }
  if (caller) {
    summary.caller = caller;
  }
  if (totalDeferredTools !== undefined) {
    summary.totalDeferredTools = totalDeferredTools;
  }
  if (pendingMcpServers.length > 0) {
    summary.pendingMcpServers = pendingMcpServers;
  }

  return summary;
}

export function resolveToolSearchItemSourceLabel(
  item: ToolSearchResultItemSummary,
): string | null {
  if (item.source === "native_registry") {
    return "原生工具";
  }
  if (item.source === "extension") {
    return item.extensionName ? `扩展工具 · ${item.extensionName}` : "扩展工具";
  }
  return null;
}

export function resolveToolSearchItemStatusLabel(
  item: ToolSearchResultItemSummary,
): string | null {
  if (item.status === "loaded") {
    return "已加载";
  }
  if (item.status === "visible") {
    return "默认可见";
  }
  if (item.status === "deferred") {
    return "待加载";
  }
  if (item.deferredLoading) {
    return "延迟加载";
  }
  if (item.alwaysVisible) {
    return "始终可见";
  }
  return null;
}

export function resolveUserFacingToolSearchItemLabel(toolName: string): string {
  return resolveUserFacingToolDisplayLabel(toolName);
}
