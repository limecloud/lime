/**
 * MCP 运行时状态管理 Hook
 *
 * 提供 MCP 服务器的运行时状态管理，包括：
 * - 服务器启动/停止
 * - 工具列表和调用
 * - 提示词列表和获取
 * - 资源列表和读取
 * - Tauri 事件监听
 *
 * @module hooks/useMcp
 */

import { useState, useEffect, useCallback } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  mcpApi,
  McpServerInfo,
  McpToolDefinition,
  McpPromptDefinition,
  McpResourceDefinition,
  McpToolResult,
  McpPromptResult,
  McpResourceContent,
  McpServerCapabilities,
} from "@/lib/api/mcp";
import { safeListen } from "@/lib/dev-bridge";

// ============================================================================
// 事件 Payload 类型
// ============================================================================

interface McpServerStartedPayload {
  server_name: string;
  server_info?: McpServerCapabilities;
}

interface McpServerStoppedPayload {
  server_name: string;
}

interface McpServerErrorPayload {
  server_name: string;
  error: string;
}

interface McpToolsUpdatedPayload {
  tools: McpToolDefinition[];
}

// ============================================================================
// Hook 返回类型
// ============================================================================

export interface McpServerConnectionState {
  phase: "idle" | "starting" | "stopping" | "reconnecting";
  error: string | null;
  updatedAt: number | null;
}

export interface UseMcpReturn {
  // 状态
  servers: McpServerInfo[];
  tools: McpToolDefinition[];
  prompts: McpPromptDefinition[];
  resources: McpResourceDefinition[];
  loading: boolean;
  error: string | null;
  serverConnectionStates: Record<string, McpServerConnectionState>;

  // 服务器操作
  startServer: (name: string) => Promise<void>;
  stopServer: (name: string) => Promise<void>;
  reconnectServer: (name: string) => Promise<void>;
  refreshServers: () => Promise<void>;

  // 工具操作
  refreshTools: () => Promise<void>;
  callTool: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<McpToolResult>;

  // 提示词操作
  refreshPrompts: () => Promise<void>;
  getPrompt: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<McpPromptResult>;

  // 资源操作
  refreshResources: () => Promise<void>;
  readResource: (uri: string) => Promise<McpResourceContent>;
}

// ============================================================================
// Hook 实现
// ============================================================================

export function useMcp(): UseMcpReturn {
  // 状态
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [tools, setTools] = useState<McpToolDefinition[]>([]);
  const [prompts, setPrompts] = useState<McpPromptDefinition[]>([]);
  const [resources, setResources] = useState<McpResourceDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serverConnectionStates, setServerConnectionStates] = useState<
    Record<string, McpServerConnectionState>
  >({});

  const updateServerConnectionState = useCallback(
    (
      serverName: string,
      nextState: Partial<McpServerConnectionState> & {
        phase: McpServerConnectionState["phase"];
      },
    ) => {
      setServerConnectionStates((prev) => ({
        ...prev,
        [serverName]: {
          phase: nextState.phase,
          error: nextState.error ?? null,
          updatedAt: Date.now(),
        },
      }));
    },
    [],
  );

  // --------------------------------------------------------------------------
  // 数据获取方法
  // --------------------------------------------------------------------------

  const refreshServers = useCallback(async () => {
    try {
      const list = await mcpApi.listServersWithStatus();
      setServers(list);
    } catch (e) {
      console.error("[useMcp] 获取服务器列表失败:", e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refreshTools = useCallback(async () => {
    try {
      const list = await mcpApi.listTools();
      setTools(list);
    } catch (e) {
      console.error("[useMcp] 获取工具列表失败:", e);
      // 工具列表获取失败不设置全局错误
    }
  }, []);

  const refreshPrompts = useCallback(async () => {
    try {
      const list = await mcpApi.listPrompts();
      setPrompts(list);
    } catch (e) {
      console.error("[useMcp] 获取提示词列表失败:", e);
    }
  }, []);

  const refreshResources = useCallback(async () => {
    try {
      const list = await mcpApi.listResources();
      setResources(list);
    } catch (e) {
      console.error("[useMcp] 获取资源列表失败:", e);
    }
  }, []);

  // --------------------------------------------------------------------------
  // 服务器操作
  // --------------------------------------------------------------------------

  const startServer = useCallback(
    async (name: string) => {
      try {
        setError(null);
        updateServerConnectionState(name, {
          phase: "starting",
        });
        await mcpApi.startServer(name);
        // 启动后刷新服务器列表和工具列表
        await refreshServers();
        await refreshTools();
        updateServerConnectionState(name, {
          phase: "idle",
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        updateServerConnectionState(name, {
          phase: "idle",
          error: msg,
        });
        throw e;
      }
    },
    [refreshServers, refreshTools, updateServerConnectionState],
  );

  const stopServer = useCallback(
    async (name: string) => {
      try {
        setError(null);
        updateServerConnectionState(name, {
          phase: "stopping",
        });
        await mcpApi.stopServer(name);
        // 停止后刷新服务器列表和工具列表
        await refreshServers();
        await refreshTools();
        updateServerConnectionState(name, {
          phase: "idle",
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        updateServerConnectionState(name, {
          phase: "idle",
          error: msg,
        });
        throw e;
      }
    },
    [refreshServers, refreshTools, updateServerConnectionState],
  );

  const reconnectServer = useCallback(
    async (name: string) => {
      updateServerConnectionState(name, {
        phase: "reconnecting",
      });
      try {
        const target = servers.find((server) => server.name === name);
        if (target?.is_running) {
          await mcpApi.stopServer(name);
        }
        await mcpApi.startServer(name);
        await refreshServers();
        await refreshTools();
        updateServerConnectionState(name, {
          phase: "idle",
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        updateServerConnectionState(name, {
          phase: "idle",
          error: msg,
        });
        throw e;
      }
    },
    [refreshServers, refreshTools, servers, updateServerConnectionState],
  );

  // --------------------------------------------------------------------------
  // 工具操作
  // --------------------------------------------------------------------------

  const callTool = useCallback(
    async (
      toolName: string,
      args: Record<string, unknown>,
    ): Promise<McpToolResult> => {
      try {
        return await mcpApi.callTool(toolName, args);
      } catch (e) {
        console.error("[useMcp] 调用工具失败:", e);
        throw e;
      }
    },
    [],
  );

  // --------------------------------------------------------------------------
  // 提示词操作
  // --------------------------------------------------------------------------

  const getPrompt = useCallback(
    async (
      name: string,
      args: Record<string, unknown>,
    ): Promise<McpPromptResult> => {
      try {
        return await mcpApi.getPrompt(name, args);
      } catch (e) {
        console.error("[useMcp] 获取提示词失败:", e);
        throw e;
      }
    },
    [],
  );

  // --------------------------------------------------------------------------
  // 资源操作
  // --------------------------------------------------------------------------

  const readResource = useCallback(
    async (uri: string): Promise<McpResourceContent> => {
      try {
        return await mcpApi.readResource(uri);
      } catch (e) {
        console.error("[useMcp] 读取资源失败:", e);
        throw e;
      }
    },
    [],
  );

  // --------------------------------------------------------------------------
  // 初始化和事件监听
  // --------------------------------------------------------------------------

  useEffect(() => {
    let mounted = true;
    const unlisteners: UnlistenFn[] = [];

    const init = async () => {
      setLoading(true);
      try {
        await refreshServers();
        await refreshTools();
        await refreshPrompts();
        await refreshResources();
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    const setupListeners = async () => {
      try {
        const unlistenStarted = await safeListen<McpServerStartedPayload>(
          "mcp:server_started",
          (event) => {
            console.log("[useMcp] 服务器已启动:", event.payload.server_name);
            updateServerConnectionState(event.payload.server_name, {
              phase: "idle",
            });
            refreshServers();
            refreshTools();
          },
        );
        unlisteners.push(unlistenStarted);

        const unlistenStopped = await safeListen<McpServerStoppedPayload>(
          "mcp:server_stopped",
          (event) => {
            console.log("[useMcp] 服务器已停止:", event.payload.server_name);
            updateServerConnectionState(event.payload.server_name, {
              phase: "idle",
            });
            refreshServers();
            refreshTools();
          },
        );
        unlisteners.push(unlistenStopped);

        const unlistenError = await safeListen<McpServerErrorPayload>(
          "mcp:server_error",
          (event) => {
            console.error(
              "[useMcp] 服务器错误:",
              event.payload.server_name,
              event.payload.error,
            );
            if (mounted) {
              setError(`${event.payload.server_name}: ${event.payload.error}`);
            }
            updateServerConnectionState(event.payload.server_name, {
              phase: "idle",
              error: event.payload.error,
            });
          },
        );
        unlisteners.push(unlistenError);

        const unlistenTools = await safeListen<McpToolsUpdatedPayload>(
          "mcp:tools_updated",
          (event) => {
            console.log("[useMcp] 工具列表已更新:", event.payload.tools.length);
            if (mounted) {
              setTools(event.payload.tools);
            }
          },
        );
        unlisteners.push(unlistenTools);
      } catch (error) {
        console.error("[useMcp] 注册 MCP 事件监听失败:", error);
      }
    };

    init();
    setupListeners();

    return () => {
      mounted = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [
    refreshServers,
    refreshTools,
    refreshPrompts,
    refreshResources,
    updateServerConnectionState,
  ]);

  return {
    servers,
    tools,
    prompts,
    resources,
    loading,
    error,
    serverConnectionStates,
    startServer,
    stopServer,
    reconnectServer,
    refreshServers,
    refreshTools,
    callTool,
    refreshPrompts,
    getPrompt,
    refreshResources,
    readResource,
  };
}
