import type { McpServer, McpServerConfig } from "@/lib/api/mcp";

export type McpEntry = { key: string; value: string };
export interface McpServerDraft {
  name: string;
  transport: "stdio" | "streamable_http";
  command: string;
  args: string[];
  env: McpEntry[];
  envVars: string[];
  cwd: string;
  url: string;
  bearerTokenEnvVar: string;
  headers: McpEntry[];
  envHeaders: McpEntry[];
}

// 与 App Server 的 enabled_lime + config.enabled 过滤保持一致。
export function mcpServerEnabled(server: McpServer): boolean {
  return server.enabled_lime && server.server_config.enabled !== false;
}

const entries = (value?: Record<string, string>): McpEntry[] =>
  Object.entries(value ?? {}).map(([key, value]) => ({ key, value }));

export function createMcpServerDraft(server?: McpServer): McpServerDraft {
  const config = server?.server_config;
  const stdio = config && "command" in config ? config : undefined;
  const http = config && "url" in config ? config : undefined;
  return {
    name: server?.name ?? "",
    transport: http ? "streamable_http" : "stdio",
    command: stdio?.command ?? "",
    args: [...(stdio?.args ?? [])],
    env: entries(stdio?.env),
    envVars: [...(stdio?.env_vars ?? [])],
    cwd: stdio?.cwd ?? "",
    url: http?.url ?? "",
    bearerTokenEnvVar:
      http?.bearer_token_env_var ?? http?.bearerTokenEnvVar ?? "",
    headers: entries(http?.http_headers ?? http?.httpHeaders),
    envHeaders: entries(http?.env_http_headers ?? http?.envHttpHeaders),
  };
}

function record(items: McpEntry[], trimValues = false): Record<string, string> {
  return Object.fromEntries(
    items
      .filter((entry) => entry.key.trim())
      .map((entry) => [
        entry.key.trim(),
        trimValues ? entry.value.trim() : entry.value,
      ])
      .filter(([, value]) => !trimValues || value),
  );
}

export function mcpServerDraftValid(draft: McpServerDraft): boolean {
  if (!draft.name.trim()) return false;
  const groups =
    draft.transport === "stdio"
      ? [draft.env]
      : [draft.headers, draft.envHeaders];
  if (
    groups.some((items) => {
      const keys = items
        .filter((item) => item.key.trim() || item.value)
        .map((item) => item.key.trim());
      return (
        keys.some((key) => !key || key.includes("\0")) ||
        new Set(keys).size !== keys.length
      );
    })
  )
    return false;
  if (draft.transport === "stdio")
    return (
      Boolean(draft.command.trim()) &&
      draft.envVars.every((name) => !/[=\0]/.test(name))
    );
  try {
    return ["http:", "https:"].includes(new URL(draft.url.trim()).protocol);
  } catch {
    return false;
  }
}

// 安装包的详情字段映射到既有配置 owner；未展示字段保持原值。
export function mcpServerConfig(
  draft: McpServerDraft,
  previous?: McpServerConfig,
): McpServerConfig {
  const config: Record<string, unknown> = {
    ...previous,
    type: draft.transport,
  };
  delete config.transport;
  if (draft.transport === "stdio") {
    config.command = draft.command;
    if (draft.args.length) config.args = [...draft.args];
    else delete config.args;
    const env = record(draft.env);
    if (Object.keys(env).length) config.env = env;
    else delete config.env;
    const envVars = draft.envVars.map((name) => name.trim()).filter(Boolean);
    if (envVars.length) config.env_vars = envVars;
    else delete config.env_vars;
    if (draft.cwd.trim()) config.cwd = draft.cwd.trim();
    else delete config.cwd;
  } else {
    Object.assign(config, {
      url: draft.url.trim(),
      http_headers: record(draft.headers, true),
      env_http_headers: record(draft.envHeaders, true),
    });
    if (draft.bearerTokenEnvVar.trim())
      config.bearer_token_env_var = draft.bearerTokenEnvVar.trim();
    else delete config.bearer_token_env_var;
    delete config.bearerTokenEnvVar;
    delete config.httpHeaders;
    delete config.envHttpHeaders;
  }
  return config as McpServerConfig;
}
