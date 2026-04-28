/**
 * MCP 服务器列表组件
 *
 * 显示所有 MCP 服务器及其运行状态，支持启动/停止操作。
 *
 * @module components/mcp/McpServerList
 */

import { useState, type MouseEvent } from "react";
import {
  AlertCircle,
  Play,
  RefreshCw,
  Server,
  Settings2,
  Square,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { McpServerInfo } from "@/lib/api/mcp";
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

  // 获取服务器状态文本
  const getStatusText = (server: McpServerInfo) => {
    if (server.is_running && server.server_info) {
      return `运行中 - ${server.server_info.name} v${server.server_info.version}`;
    }
    return server.is_running ? "运行中" : "已停止";
  };

  const hasInteractiveSelection = Boolean(onSelectServer);

  return (
    <div className="flex min-h-[464px] flex-col bg-white">
      {/* 标题栏 */}
      <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-sky-100 bg-sky-50 text-sky-700">
            <Server className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">服务器状态</p>
            <p className="text-xs text-slate-500">
              {servers.length} 个配置，
              {servers.filter((server) => server.is_running).length} 个运行中
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onRefresh()}
          disabled={loading}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          title="刷新状态"
          aria-label="刷新 MCP 服务器状态"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="border-b border-rose-100 bg-rose-50 px-5 py-3">
          <div className="flex items-start gap-2 text-sm text-rose-700">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* 服务器列表 */}
      <div className="flex-1 overflow-auto p-4">
        {loading && servers.length === 0 ? (
          <div className="flex min-h-[320px] items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-sm text-slate-500">
              <RefreshCw className="h-5 w-5 animate-spin" />
              正在读取 MCP 服务器状态
            </div>
          </div>
        ) : servers.length === 0 ? (
          <div className="flex min-h-[320px] items-center justify-center text-center">
            <div className="max-w-sm space-y-3">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl border border-slate-200 bg-slate-50 text-slate-500">
                <Settings2 className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900">
                  还没有 MCP 服务器
                </p>
                <p className="text-sm leading-6 text-slate-500">
                  去“配置管理”添加或导入服务器后，这里会显示运行状态。
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {servers.map((server) => {
              const connectionState = serverConnectionStates[server.name];
              const isOperating = operatingServer === server.name;

              return (
                <div
                  key={server.id}
                  onClick={() => onSelectServer?.(server)}
                  className={cn(
                    "rounded-[22px] border p-4 transition",
                    hasInteractiveSelection && "cursor-pointer",
                    selectedServerName === server.name
                      ? "border-emerald-200 bg-emerald-50"
                      : "border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50/80",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {/* 状态指示灯 */}
                        <div
                          className={cn(
                            "h-2.5 w-2.5 rounded-full ring-4",
                            server.is_running
                              ? "bg-emerald-500 ring-emerald-100"
                              : "bg-slate-300 ring-slate-100",
                          )}
                        />
                        <span className="truncate text-sm font-semibold text-slate-900">
                          {server.name}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {getStatusText(server)}
                      </p>
                      {server.description && (
                        <p className="mt-1 truncate text-xs text-slate-500">
                          {server.description}
                        </p>
                      )}
                      {connectionState?.phase &&
                        connectionState.phase !== "idle" && (
                          <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-sky-100 bg-sky-50 px-2 py-0.5 text-xs text-sky-700">
                            <RefreshCw className="h-3 w-3 animate-spin" />
                            {connectionState.phase === "starting"
                              ? "启动中"
                              : connectionState.phase === "stopping"
                                ? "停止中"
                                : "重连中"}
                          </span>
                        )}
                    </div>

                    {/* 启动/停止按钮 */}
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => handleReconnect(server.name, e)}
                        disabled={isOperating}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-emerald-100 bg-emerald-50 text-emerald-700 transition hover:border-emerald-200 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                        title="重连服务器"
                        aria-label={`重连 ${server.name}`}
                      >
                        <RefreshCw
                          className={cn(
                            "h-4 w-4",
                            isOperating && "animate-spin",
                          )}
                        />
                      </button>
                      {server.is_running ? (
                        <button
                          type="button"
                          onClick={(e) => handleStop(server.name, e)}
                          disabled={isOperating}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-rose-100 bg-rose-50 text-rose-700 transition hover:border-rose-200 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                          title="停止服务器"
                          aria-label={`停止 ${server.name}`}
                        >
                          {isOperating ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => handleStart(server.name, e)}
                          disabled={isOperating}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-emerald-100 bg-emerald-50 text-emerald-700 transition hover:border-emerald-200 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                          title="启动服务器"
                          aria-label={`启动 ${server.name}`}
                        >
                          {isOperating ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {connectionState?.error && (
                    <p className="mt-3 rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
                      最近错误：{connectionState.error}
                    </p>
                  )}

                  {/* 能力标签 */}
                  {server.is_running && server.server_info && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {server.server_info.supports_tools && (
                        <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                          工具
                        </span>
                      )}
                      {server.server_info.supports_prompts && (
                        <span className="rounded-full border border-sky-100 bg-sky-50 px-2 py-0.5 text-xs text-sky-700">
                          提示词
                        </span>
                      )}
                      {server.server_info.supports_resources && (
                        <span className="rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                          资源
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
