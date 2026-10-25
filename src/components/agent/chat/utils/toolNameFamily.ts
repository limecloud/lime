import { normalizeLegacyToolSurfaceName } from "@/lib/api/agentTextNormalization";

export function isDynamicToolCall(item: { metadata?: unknown }): boolean {
  const metadata = item.metadata;
  return (
    metadata != null &&
    typeof metadata === "object" &&
    "canonical_type" in metadata &&
    metadata.canonical_type === "dynamicToolCall"
  );
}

export type McpToolOperationKind =
  | "search"
  | "list"
  | "read"
  | "browser"
  | "mutation";

export interface ParsedMcpToolName {
  serverName: string;
  innerToolName: string;
  normalizedInnerToolName: string;
}

const MCP_MUTATION_ACTION_RE =
  /(?:^|_)(?:create|update|delete|remove|add|set|send|write|edit|patch|run|execute|submit|publish|approve|reject|reply|comment)(?:_|$)/;
const MCP_BROWSER_ACTION_RE =
  /(?:^|_)(?:navigate|goto|click|hover|fill|type|select|press|snapshot|screenshot|drag|upload|wait|tabs?|page|browser|runtime|evaluate)(?:_|$)/;
const MCP_SEARCH_ACTION_RE = /(?:^|_)(?:search|find|lookup|query)(?:_|$)/;
const MCP_LIST_ACTION_RE = /(?:^|_)list(?:_|$)/;
const MCP_READ_ACTION_RE = /(?:^|_)(?:get|read|fetch|open)(?:_|$)/;

const BROWSER_TOOL_MARKERS = [
  "browser",
  "page",
  "runtime",
  "dom",
  "cdp",
  "playwright",
  "navigate",
  "screenshot",
  "snapshot",
  "click",
  "hover",
  "upload",
  "waitfor",
  "tabs",
  "open",
  "presskey",
  "selectoption",
  "drag",
  "evaluate",
  "goto",
] as const;

function normalizeMcpInnerToolName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/-/g, "_")
    .toLowerCase();
}

function compactToolNameKey(value: string): string {
  return value
    .replace(/[\s_-]+/g, "")
    .trim()
    .toLowerCase();
}

function hasAllMcpInnerTokens(
  normalizedInnerToolName: string,
  tokens: string[],
): boolean {
  const parts = normalizedInnerToolName.split("_").filter(Boolean);
  return tokens.every((token) => parts.includes(token));
}

export function normalizeToolNameFamilyKey(value: string): string {
  return compactToolNameKey(normalizeLegacyToolSurfaceName(value) || value);
}

export function isUpdatePlanToolName(
  value: string | null | undefined,
): boolean {
  const normalized = normalizeToolNameFamilyKey(value || "");
  return normalized === "updateplan" || normalized === "updateplantool";
}

export function parseMcpToolName(toolName: string): ParsedMcpToolName | null {
  const normalized = toolName.trim();
  if (!normalized.toLowerCase().startsWith("mcp__")) {
    return null;
  }

  const segments = normalized.split("__");
  if (segments.length < 3) {
    return null;
  }

  const [, serverName, ...innerParts] = segments;
  const innerToolName = innerParts.join("__").trim();
  if (!serverName || !innerToolName) {
    return null;
  }

  return {
    serverName,
    innerToolName,
    normalizedInnerToolName: normalizeMcpInnerToolName(innerToolName),
  };
}

export function classifyMcpToolOperationKind(
  toolName: string,
): McpToolOperationKind | null {
  const parsed = parseMcpToolName(toolName);
  if (!parsed) {
    return null;
  }

  const { serverName, normalizedInnerToolName } = parsed;
  const normalizedServerName = serverName.toLowerCase();

  if (
    normalizedServerName.includes("browser") ||
    normalizedServerName.includes("playwright") ||
    normalizedServerName.includes("chrome")
  ) {
    return "browser";
  }

  if (MCP_MUTATION_ACTION_RE.test(normalizedInnerToolName)) {
    return "mutation";
  }

  if (MCP_SEARCH_ACTION_RE.test(normalizedInnerToolName)) {
    return "search";
  }

  if (MCP_LIST_ACTION_RE.test(normalizedInnerToolName)) {
    return "list";
  }

  if (MCP_READ_ACTION_RE.test(normalizedInnerToolName)) {
    return "read";
  }

  if (MCP_BROWSER_ACTION_RE.test(normalizedInnerToolName)) {
    return "browser";
  }

  return null;
}

export function isBrowserToolName(toolName: string): boolean {
  const normalizedName = normalizeToolNameFamilyKey(toolName);
  return (
    normalizedName === "newtab" ||
    classifyMcpToolOperationKind(toolName) === "browser" ||
    BROWSER_TOOL_MARKERS.some((marker) => normalizedName.includes(marker))
  );
}

export function isUnifiedWebSearchToolName(toolName: string): boolean {
  const normalizedName = normalizeToolNameFamilyKey(toolName);
  if (
    normalizedName === "websearch" ||
    normalizedName === "searchquery" ||
    normalizedName === "websearchtool"
  ) {
    return true;
  }

  const parsed = parseMcpToolName(toolName);
  if (!parsed) {
    return false;
  }

  const innerKey = compactToolNameKey(parsed.normalizedInnerToolName);
  return (
    innerKey === "websearch" ||
    innerKey === "searchquery" ||
    hasAllMcpInnerTokens(parsed.normalizedInnerToolName, ["web", "search"])
  );
}

export function isUnifiedWebFetchToolName(toolName: string): boolean {
  const normalizedName = normalizeToolNameFamilyKey(toolName);
  if (normalizedName === "webfetch" || normalizedName === "webfetchtool") {
    return true;
  }

  const parsed = parseMcpToolName(toolName);
  if (!parsed) {
    return false;
  }

  const innerKey = compactToolNameKey(parsed.normalizedInnerToolName);
  return (
    innerKey === "webfetch" ||
    hasAllMcpInnerTokens(parsed.normalizedInnerToolName, ["web", "fetch"])
  );
}
