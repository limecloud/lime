import { safeInvoke } from "@/lib/dev-bridge";

// ============================================================================
// 基础类型定义
// ============================================================================

export interface McpServer {
  id: string;
  name: string;
  server_config: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    timeout?: number;
  };
  description?: string;
  enabled_lime: boolean;
  enabled_claude: boolean;
  enabled_codex: boolean;
  enabled_gemini: boolean;
  created_at?: number;
}

/** MCP 服务器能力信息 */
export interface McpServerCapabilities {
  name: string;
  version: string;
  supports_tools: boolean;
  supports_prompts: boolean;
  supports_resources: boolean;
}

/** MCP 服务器信息（包含运行状态） */
export interface McpServerInfo {
  id: string;
  name: string;
  description?: string;
  config: McpServer["server_config"];
  is_running: boolean;
  server_info?: McpServerCapabilities;
  enabled_lime: boolean;
  enabled_claude: boolean;
  enabled_codex: boolean;
  enabled_gemini: boolean;
}

// ============================================================================
// 工具类型
// ============================================================================

/** MCP 工具定义。`name` 当前格式固定为 `mcp__<server>__<tool>`。 */
export interface McpToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  server_name: string;
  deferred_loading?: boolean;
  always_visible?: boolean;
  allowed_callers?: string[];
  input_examples?: unknown[];
  tags?: string[];
}

/** MCP 内容类型 */
export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mime_type: string }
  | { type: "resource"; uri: string; text?: string; blob?: string };

/** MCP 工具调用结果 */
export interface McpToolResult {
  content: McpContent[];
  is_error: boolean;
}

/** 从 runtime 名 `mcp__<server>__<tool>` 提取 inner tool 名。 */
export function getMcpInnerToolName(
  toolName: string,
  serverName?: string,
): string {
  if (!toolName) return toolName;

  if (serverName) {
    const prefixedName = `mcp__${serverName}__`;
    if (toolName.startsWith(prefixedName)) {
      return toolName.slice(prefixedName.length);
    }
  }

  if (!toolName.startsWith("mcp__")) {
    return toolName;
  }

  const parts = toolName.split("__");
  return parts.length >= 3 ? parts.slice(2).join("__") : toolName;
}

// ============================================================================
// 提示词类型
// ============================================================================

/** MCP 提示词参数 */
export interface McpPromptArgument {
  name: string;
  description?: string;
  required: boolean;
}

/** MCP 提示词定义 */
export interface McpPromptDefinition {
  name: string;
  description?: string;
  arguments: McpPromptArgument[];
  server_name: string;
}

/** MCP 提示词消息 */
export interface McpPromptMessage {
  role: string;
  content: McpContent;
}

/** MCP 提示词结果 */
export interface McpPromptResult {
  description?: string;
  messages: McpPromptMessage[];
}

// ============================================================================
// 资源类型
// ============================================================================

/** MCP 资源定义 */
export interface McpResourceDefinition {
  uri: string;
  name: string;
  description?: string;
  mime_type?: string;
  server_name: string;
}

/** MCP 资源内容 */
export interface McpResourceContent {
  uri: string;
  mime_type?: string;
  text?: string;
  blob?: string;
}

// ============================================================================
// API 封装
// ============================================================================

export const mcpApi = {
  // --------------------------------------------------------------------------
  // 配置管理 API
  // --------------------------------------------------------------------------

  getServers: (): Promise<McpServer[]> => safeInvoke("get_mcp_servers"),

  addServer: (server: McpServer): Promise<void> =>
    safeInvoke("add_mcp_server", { server }),

  updateServer: (server: McpServer): Promise<void> =>
    safeInvoke("update_mcp_server", { server }),

  deleteServer: (id: string): Promise<void> =>
    safeInvoke("delete_mcp_server", { id }),

  toggleServer: (
    id: string,
    appType: string,
    enabled: boolean,
  ): Promise<void> => safeInvoke("toggle_mcp_server", { id, appType, enabled }),

  /** 从外部应用导入 MCP 配置 */
  importFromApp: (appType: string): Promise<number> =>
    safeInvoke("import_mcp_from_app", { appType }),

  /** 同步所有 MCP 配置到实际配置文件 */
  syncAllToLive: (): Promise<void> => safeInvoke("sync_all_mcp_to_live"),

  // --------------------------------------------------------------------------
  // 生命周期管理 API
  // --------------------------------------------------------------------------

  /** 获取所有服务器及其运行状态 */
  listServersWithStatus: (): Promise<McpServerInfo[]> =>
    safeInvoke("mcp_list_servers_with_status"),

  /** 启动 MCP 服务器 */
  startServer: (name: string): Promise<void> =>
    safeInvoke("mcp_start_server", { name }),

  /** 停止 MCP 服务器 */
  stopServer: (name: string): Promise<void> =>
    safeInvoke("mcp_stop_server", { name }),

  // --------------------------------------------------------------------------
  // 工具管理 API
  // --------------------------------------------------------------------------

  /** 获取所有可用工具，返回名格式为 `mcp__<server>__<tool>`。 */
  listTools: (): Promise<McpToolDefinition[]> => safeInvoke("mcp_list_tools"),

  /** 按调用上下文获取可见工具（支持 deferred_loading） */
  listToolsForContext: (
    caller?: string,
    includeDeferred = false,
  ): Promise<McpToolDefinition[]> =>
    safeInvoke("mcp_list_tools_for_context", { caller, includeDeferred }),

  /** 工具搜索（Tool Search），返回名格式为 `mcp__<server>__<tool>`。 */
  searchTools: (
    query: string,
    caller?: string,
    limit = 10,
  ): Promise<McpToolDefinition[]> =>
    safeInvoke("mcp_search_tools", { query, caller, limit }),

  /** 调用工具，`toolName` 当前格式为 `mcp__<server>__<tool>`。 */
  callTool: (
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> =>
    safeInvoke("mcp_call_tool", { toolName, arguments: args }),

  /** 带 caller 校验调用工具，`toolName` 当前格式为 `mcp__<server>__<tool>`。 */
  callToolWithCaller: (
    toolName: string,
    args: Record<string, unknown>,
    caller?: string,
  ): Promise<McpToolResult> =>
    safeInvoke("mcp_call_tool_with_caller", {
      toolName,
      arguments: args,
      caller,
    }),

  // --------------------------------------------------------------------------
  // 提示词管理 API
  // --------------------------------------------------------------------------

  /** 获取所有可用提示词 */
  listPrompts: (): Promise<McpPromptDefinition[]> =>
    safeInvoke("mcp_list_prompts"),

  /** 获取提示词内容 */
  getPrompt: (
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpPromptResult> =>
    safeInvoke("mcp_get_prompt", { name, arguments: args }),

  // --------------------------------------------------------------------------
  // 资源管理 API
  // --------------------------------------------------------------------------

  /** 获取所有可用资源 */
  listResources: (): Promise<McpResourceDefinition[]> =>
    safeInvoke("mcp_list_resources"),

  /** 读取资源内容 */
  readResource: (uri: string): Promise<McpResourceContent> =>
    safeInvoke("mcp_read_resource", { uri }),
};
