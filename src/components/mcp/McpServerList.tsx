/**
 * MCP 服务器列表组件
 *
 * 显示所有 MCP 服务器及其运行状态，支持启动/停止操作。
 *
 * @module components/mcp/McpServerList
 */

import { useState, type MouseEvent } from "react";
import { Play, Square, RefreshCw, Server, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { McpServerInfo } from "@/lib/api/mcp";
import type { McpServerConnectionState } from "@/hooks/useMcp";

interface McpServerListProps {
  servers: McpServerInfo[];
  loading: boolean;
  error: string | null;
  onStartServer: (name: string) => Promise<void>;
  onStopServer: (name: string) => Promise<void>;
  onReconnectServer: (name: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onSelectServer?: (server: McpServerInfo) => void;
  selectedServerName?: string;
  serverConnectionStates: Record<string, McpServerConnectionState>;
}

export function McpServerList({
  servers,
  loading,
  error,
  onStartServer,
  onStopServer,
  onReconnectServer,
  onRefresh,
  onSelectServer,
  selectedServerName,
  serverConnectionStates,
}: McpServerListProps) {
  const [operatingServer, setOperatingServer] = useState<string | null>(null);

  const handleStart = async (name: string, e: MouseEvent) => {
    e.stopPropagation();
    setOperatingServer(name);
    try {
      await onStartServer(name);
    } finally {
      setOperatingServer(null);
    }
  };

  const handleStop = async (name: string, e: MouseEvent) => {
    e.stopPropagation();
    setOperatingServer(name);
    try {
      await onStopServer(name);
    } finally {
      setOperatingServer(null);
    }
  };

  const handleReconnect = async (name: string, e: MouseEvent) => {
    e.stopPropagation();
    setOperatingServer(name);
    try {
      await onReconnectServer(name);
    } finally {
      setOperatingServer(null);
    }
  };

  // 获取服务器状态颜色
  const getStatusColor = (isRunning: boolean) => {
    return isRunning ? "text-green-500" : "text-muted-foreground";
  };

  // 获取服务器状态文本
  const getStatusText = (server: McpServerInfo) => {
    if (server.is_running && server.server_info) {
      return `运行中 - ${server.server_info.name} v${server.server_info.version}`;
    }
    return server.is_running ? "运行中" : "已停止";
  };

  return (
    <div className="flex flex-col h-full">
      {/* 标题栏 */}
      <div className="p-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">运行状态</span>
        </div>
        <button
          onClick={() => onRefresh()}
          disabled={loading}
          className="p-1.5 rounded hover:bg-muted"
          title="刷新状态"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="p-3 bg-destructive/10 border-b border-destructive/20">
          <div className="flex items-start gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* 服务器列表 */}
      <div className="flex-1 overflow-auto p-2 space-y-1">
        {loading && servers.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : servers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <p>暂无 MCP 服务器配置</p>
          </div>
        ) : (
          servers.map((server) => {
            const connectionState = serverConnectionStates[server.name];

            return (
              <div
              key={server.id}
              onClick={() => onSelectServer?.(server)}
              className={cn(
                "p-3 rounded-lg border transition-colors cursor-pointer",
                selectedServerName === server.name
                  ? "bg-primary/5 border-primary"
                  : "hover:bg-muted border-transparent",
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {/* 状态指示灯 */}
                    <div
                      className={cn(
                        "w-2 h-2 rounded-full",
                        server.is_running ? "bg-green-500" : "bg-gray-400",
                      )}
                    />
                    <span className="font-medium text-sm truncate">
                      {server.name}
                    </span>
                  </div>
                  <p
                    className={cn(
                      "text-xs mt-1 truncate",
                      getStatusColor(server.is_running),
                    )}
                  >
                    {getStatusText(server)}
                  </p>
                  {server.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {server.description}
                    </p>
                  )}
                </div>

                {/* 启动/停止按钮 */}
                <div className="ml-2 flex flex-shrink-0 items-center gap-1">
                  <button
                    onClick={(e) => handleReconnect(server.name, e)}
                    disabled={operatingServer === server.name}
                    className="p-1.5 rounded hover:bg-blue-500/10 text-blue-600 disabled:opacity-50"
                    title="重连服务器"
                  >
                    <RefreshCw
                      className={cn(
                        "h-4 w-4",
                        operatingServer === server.name &&
                          "animate-spin",
                      )}
                    />
                  </button>
                  {server.is_running ? (
                    <button
                      onClick={(e) => handleStop(server.name, e)}
                      disabled={operatingServer === server.name}
                      className="p-1.5 rounded hover:bg-destructive/10 text-destructive disabled:opacity-50"
                      title="停止服务器"
                    >
                      {operatingServer === server.name ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>
                  ) : (
                    <button
                      onClick={(e) => handleStart(server.name, e)}
                      disabled={operatingServer === server.name}
                      className="p-1.5 rounded hover:bg-green-500/10 text-green-600 disabled:opacity-50"
                      title="启动服务器"
                    >
                      {operatingServer === server.name ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              {connectionState?.error && (
                <p className="mt-2 text-xs text-destructive">
                  最近错误：{connectionState.error}
                </p>
              )}

              {/* 能力标签 */}
              {server.is_running && server.server_info && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {server.server_info.supports_tools && (
                    <span className="px-1.5 py-0.5 text-xs rounded bg-blue-500/10 text-blue-600">
                      工具
                    </span>
                  )}
                  {server.server_info.supports_prompts && (
                    <span className="px-1.5 py-0.5 text-xs rounded bg-purple-500/10 text-purple-600">
                      提示词
                    </span>
                  )}
                  {server.server_info.supports_resources && (
                    <span className="px-1.5 py-0.5 text-xs rounded bg-orange-500/10 text-orange-600">
                      资源
                    </span>
                  )}
                </div>
              )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
