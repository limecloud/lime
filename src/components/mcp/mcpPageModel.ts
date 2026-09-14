import type { McpServer, McpServerConfig } from "@/lib/api/mcp";

export const MCP_PAGE_PRESETS = [
  {
    id: "filesystem",
    nameKey: "settings.mcpPage.preset.filesystem.name",
    defaultName: "Filesystem",
    descriptionKey: "settings.mcpPage.preset.filesystem.description",
    defaultDescription: "文件系统访问",
    server_config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
    },
  },
  {
    id: "context7",
    nameKey: "settings.mcpPage.preset.context7.name",
    defaultName: "Context7",
    descriptionKey: "settings.mcpPage.preset.context7.description",
    defaultDescription: "最新文档检索",
    server_config: {
      transport: "streamable_http",
      url: "https://mcp.context7.com/mcp",
      env_http_headers: {
        CONTEXT7_API_KEY: "CONTEXT7_API_KEY",
      },
      tool_timeout: 60,
    },
  },
  {
    id: "youcom",
    nameKey: "settings.mcpPage.preset.youcom.name",
    defaultName: "You.com",
    descriptionKey: "settings.mcpPage.preset.youcom.description",
    defaultDescription: "网页搜索与内容提取",
    server_config: {
      transport: "streamable_http",
      url: "https://api.you.com/mcp?profile=free",
      tool_timeout: 60,
    },
  },
  {
    id: "github",
    nameKey: "settings.mcpPage.preset.github.name",
    defaultName: "GitHub",
    descriptionKey: "settings.mcpPage.preset.github.description",
    defaultDescription: "GitHub API",
    server_config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "" },
    },
  },
  {
    id: "postgres",
    nameKey: "settings.mcpPage.preset.postgres.name",
    defaultName: "PostgreSQL",
    descriptionKey: "settings.mcpPage.preset.postgres.description",
    defaultDescription: "数据库访问",
    server_config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres"],
      env: { DATABASE_URL: "" },
    },
  },
  {
    id: "custom",
    nameKey: "settings.mcpPage.preset.custom.name",
    defaultName: "自定义",
    descriptionKey: "settings.mcpPage.preset.custom.description",
    defaultDescription: "自定义配置",
    server_config: {
      command: "",
      args: [],
    },
  },
] as const;

export const DEFAULT_MCP_SERVER_CONFIG = JSON.stringify(
  {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-example"],
    env: {},
  },
  null,
  2,
);

export const MCP_PAGE_PRIMARY_ACTION_BUTTON_CLASS_NAME =
  "rounded-lg border border-emerald-200 bg-[linear-gradient(135deg,#0ea5e9_0%,#14b8a6_52%,#10b981_100%)] px-3 py-1.5 text-sm text-white shadow-sm shadow-emerald-950/15 hover:opacity-95";

export interface McpPageConfigSummary {
  transport: "stdio" | "streamable_http" | "unknown";
  command?: string;
  url?: string;
  bearerTokenEnvVar?: string;
  staticHeaderNames: string[];
  envHeaderRefs: Array<{ headerName: string; envVar: string }>;
}

export type McpPageConfigTextField = "command" | "url" | "bearer_token_env_var";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function summarizeMcpServerConfig(
  config: McpServerConfig,
): McpPageConfigSummary {
  const record = config as Record<string, unknown>;
  const rawTransport = readOptionalString(record.transport ?? record.type);
  const url = readOptionalString(record.url);
  const command = readOptionalString(record.command);
  const isHttp =
    rawTransport === "streamable_http" ||
    rawTransport === "streamable-http" ||
    rawTransport === "http" ||
    Boolean(url);
  const httpHeaders = readStringRecord(
    record.http_headers ?? record.httpHeaders,
  );
  const envHttpHeaders = readStringRecord(
    record.env_http_headers ?? record.envHttpHeaders,
  );
  const bearerTokenEnvVar = readOptionalString(
    record.bearer_token_env_var ?? record.bearerTokenEnvVar,
  );

  return {
    transport: isHttp ? "streamable_http" : command ? "stdio" : "unknown",
    command,
    url,
    bearerTokenEnvVar,
    staticHeaderNames: Object.keys(httpHeaders).sort(),
    envHeaderRefs: Object.entries(envHttpHeaders)
      .map(([headerName, envVar]) => ({ headerName, envVar }))
      .sort((left, right) => left.headerName.localeCompare(right.headerName)),
  };
}

export function summarizeMcpServerConfigJson(
  configJson: string,
): McpPageConfigSummary | null {
  try {
    const config = JSON.parse(configJson) as McpServerConfig;
    return summarizeMcpServerConfig(config);
  } catch {
    return null;
  }
}

function parseMcpServerConfigJson(
  configJson: string,
): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(configJson);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stringifyMcpServerConfig(config: Record<string, unknown>): string {
  return JSON.stringify(config, null, 2);
}

function setOptionalStringField(
  config: Record<string, unknown>,
  field: string,
  value: string,
) {
  const trimmedValue = value.trim();
  if (trimmedValue) {
    config[field] = trimmedValue;
    return;
  }
  delete config[field];
}

function getEnvHeaderRefs(
  config: Record<string, unknown>,
): Array<{ headerName: string; envVar: string }> {
  return Object.entries(
    readStringRecord(config.env_http_headers ?? config.envHttpHeaders),
  )
    .map(([headerName, envVar]) => ({ headerName, envVar }))
    .sort((left, right) => left.headerName.localeCompare(right.headerName));
}

function writeEnvHeaderRefs(
  config: Record<string, unknown>,
  refs: Array<{ headerName: string; envVar: string }>,
) {
  const envHeaders = refs.reduce<Record<string, string>>((acc, ref) => {
    const headerName = ref.headerName.trim();
    const envVar = ref.envVar.trim();
    if (headerName && envVar) {
      acc[headerName] = envVar;
    }
    return acc;
  }, {});

  delete config.envHttpHeaders;
  if (Object.keys(envHeaders).length > 0) {
    config.env_http_headers = envHeaders;
  } else {
    delete config.env_http_headers;
  }
}

function createDefaultEnvHeaderRef(
  refs: Array<{ headerName: string; envVar: string }>,
): { headerName: string; envVar: string } {
  const usedHeaderNames = new Set(refs.map((ref) => ref.headerName));
  const baseHeaderName = "X-MCP-API-Key";
  if (!usedHeaderNames.has(baseHeaderName)) {
    return { headerName: baseHeaderName, envVar: "MCP_API_KEY" };
  }

  for (let index = 2; index < 100; index += 1) {
    const headerName = `${baseHeaderName}-${index}`;
    if (!usedHeaderNames.has(headerName)) {
      return { headerName, envVar: `MCP_API_KEY_${index}` };
    }
  }

  return {
    headerName: `${baseHeaderName}-100`,
    envVar: "MCP_API_KEY_100",
  };
}

export function updateMcpServerConfigTextField(
  configJson: string,
  field: McpPageConfigTextField,
  value: string,
): string {
  const config = parseMcpServerConfigJson(configJson);
  if (!config) {
    return configJson;
  }

  if (field === "bearer_token_env_var") {
    delete config.bearerTokenEnvVar;
    setOptionalStringField(config, "bearer_token_env_var", value);
    return stringifyMcpServerConfig(config);
  }

  setOptionalStringField(config, field, value);
  return stringifyMcpServerConfig(config);
}

export function addMcpServerConfigEnvHeaderRef(configJson: string): string {
  const config = parseMcpServerConfigJson(configJson);
  if (!config) {
    return configJson;
  }

  const refs = getEnvHeaderRefs(config);
  writeEnvHeaderRefs(config, [...refs, createDefaultEnvHeaderRef(refs)]);
  return stringifyMcpServerConfig(config);
}

export function updateMcpServerConfigEnvHeaderRef(
  configJson: string,
  index: number,
  patch: Partial<{ headerName: string; envVar: string }>,
): string {
  const config = parseMcpServerConfigJson(configJson);
  if (!config) {
    return configJson;
  }

  const refs = getEnvHeaderRefs(config);
  const currentRef = refs[index];
  if (!currentRef) {
    return stringifyMcpServerConfig(config);
  }

  refs[index] = { ...currentRef, ...patch };
  writeEnvHeaderRefs(config, refs);
  return stringifyMcpServerConfig(config);
}

export function removeMcpServerConfigEnvHeaderRef(
  configJson: string,
  index: number,
): string {
  const config = parseMcpServerConfigJson(configJson);
  if (!config) {
    return configJson;
  }

  const refs = getEnvHeaderRefs(config);
  refs.splice(index, 1);
  writeEnvHeaderRefs(config, refs);
  return stringifyMcpServerConfig(config);
}

export function getEnabledMcpApps(server: McpServer): string[] {
  const apps: string[] = [];
  if (server.enabled_lime) apps.push("Lime");
  if (server.enabled_claude) apps.push("Claude");
  if (server.enabled_codex) apps.push("本地 CLI");
  if (server.enabled_gemini) apps.push("Gemini");
  return apps;
}
