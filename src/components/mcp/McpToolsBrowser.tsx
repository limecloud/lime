/**
 * MCP 工具浏览器组件
 *
 * 按服务器分组显示所有可用的 MCP 工具，包括工具名称、描述和参数 schema。
 *
 * @module components/mcp/McpToolsBrowser
 */

import { useEffect, useMemo, useState } from "react";
import {
  Wrench,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Search,
  Code,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getMcpInnerToolName, McpToolDefinition } from "@/lib/api/mcp";

interface McpToolsBrowserProps {
  tools: McpToolDefinition[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  serverCount?: number;
  runningServerCount?: number;
  onOpenRuntimeTab?: () => void;
  onOpenConfigTab?: () => void;
  onCallTool?: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<void>;
}

export function McpToolsBrowser({
  tools,
  loading,
  onRefresh,
  serverCount = 0,
  runningServerCount = 0,
  onOpenRuntimeTab,
  onOpenConfigTab,
  onCallTool,
}: McpToolsBrowserProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedServers, setExpandedServers] = useState<Set<string>>(
    new Set(),
  );
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  const dedupedTools = useMemo(() => {
    const seen = new Set<string>();
    return tools.filter((tool) => {
      const key = `${tool.server_name}::${tool.name}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, [tools]);

  const toolsByServer = useMemo(
    () =>
      dedupedTools.reduce(
        (acc, tool) => {
          if (!acc[tool.server_name]) {
            acc[tool.server_name] = [];
          }
          acc[tool.server_name].push(tool);
          return acc;
        },
        {} as Record<string, McpToolDefinition[]>,
      ),
    [dedupedTools],
  );

  const filteredToolsByServer = useMemo(
    () =>
      Object.entries(toolsByServer).reduce(
        (acc, [serverName, serverTools]) => {
          const filtered = serverTools
            .filter((tool) => {
              const displayName = getMcpInnerToolName(
                tool.name,
                tool.server_name,
              );
              const normalizedQuery = searchQuery.toLowerCase();
              return (
                displayName.toLowerCase().includes(normalizedQuery) ||
                tool.name.toLowerCase().includes(normalizedQuery) ||
                tool.description.toLowerCase().includes(normalizedQuery)
              );
            })
            .sort((left, right) => {
              const leftName = getMcpInnerToolName(left.name, left.server_name);
              const rightName = getMcpInnerToolName(
                right.name,
                right.server_name,
              );
              return leftName.localeCompare(rightName);
            });
          if (filtered.length > 0) {
            acc[serverName] = filtered;
          }
          return acc;
        },
        {} as Record<string, McpToolDefinition[]>,
      ),
    [searchQuery, toolsByServer],
  );

  useEffect(() => {
    const serverNames = Object.keys(filteredToolsByServer);
    setExpandedServers((prev) => {
      const next = new Set(
        [...prev].filter((serverName) => serverNames.includes(serverName)),
      );
      if (next.size > 0 || serverNames.length === 0) {
        return next;
      }
      return new Set(serverNames);
    });
  }, [filteredToolsByServer]);

  const emptyState = useMemo(() => {
    if (searchQuery) {
      return {
        title: "未找到匹配的工具",
        description: "可以尝试改用服务器名、工具名或描述关键词重新检索。",
      };
    }

    if (serverCount === 0) {
      return {
        title: "还没有配置 MCP 服务器",
        description: "先添加服务器配置，再回来浏览和调用工具。",
        actionLabel: "去配置管理",
        action: onOpenConfigTab,
      };
    }

    if (runningServerCount === 0) {
      return {
        title: "已配置服务器，但当前没有运行中的 MCP 服务器",
        description: "先在“运行状态”里启动服务器，工具目录才会加载出来。",
        actionLabel: "去启动服务器",
        action: onOpenRuntimeTab,
      };
    }

    return {
      title: "运行中的服务器暂未暴露工具",
      description:
        "可以先刷新一次；如果仍为空，请检查服务器能力声明或连接日志。",
      actionLabel: "刷新工具列表",
      action: () => void onRefresh(),
    };
  }, [
    onOpenConfigTab,
    onOpenRuntimeTab,
    onRefresh,
    runningServerCount,
    searchQuery,
    serverCount,
  ]);

  const toggleServer = (serverName: string) => {
    const newExpanded = new Set(expandedServers);
    if (newExpanded.has(serverName)) {
      newExpanded.delete(serverName);
    } else {
      newExpanded.add(serverName);
    }
    setExpandedServers(newExpanded);
  };

  const toggleTool = (toolName: string) => {
    const newExpanded = new Set(expandedTools);
    if (newExpanded.has(toolName)) {
      newExpanded.delete(toolName);
    } else {
      newExpanded.add(toolName);
    }
    setExpandedTools(newExpanded);
  };

  const formatSchema = (schema: Record<string, unknown>) => {
    return JSON.stringify(schema, null, 2);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b p-3">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">可用工具</span>
          <span className="text-xs text-muted-foreground">
            ({dedupedTools.length})
          </span>
        </div>
        <button
          onClick={() => onRefresh()}
          disabled={loading}
          className="rounded p-1.5 hover:bg-muted"
          title="刷新工具列表"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </div>

      <div className="border-b p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索工具..."
            className="w-full rounded border bg-background py-1.5 pl-8 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {loading && dedupedTools.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : Object.keys(filteredToolsByServer).length === 0 ? (
          <div className="px-6 py-8 text-center text-sm">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Wrench className="h-5 w-5" />
            </div>
            <p className="mt-3 font-medium text-foreground">
              {emptyState.title}
            </p>
            <p className="mt-1 text-muted-foreground">
              {emptyState.description}
            </p>
            {emptyState.actionLabel && emptyState.action ? (
              <button
                type="button"
                onClick={emptyState.action}
                className="mt-4 inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                {emptyState.actionLabel}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-1 p-2">
            {Object.entries(filteredToolsByServer).map(
              ([serverName, serverTools]) => (
                <div key={serverName} className="rounded-lg border">
                  <button
                    onClick={() => toggleServer(serverName)}
                    className="flex w-full items-center gap-2 rounded-t-lg p-2.5 hover:bg-muted/50"
                  >
                    {expandedServers.has(serverName) ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium">{serverName}</span>
                    <span className="text-xs text-muted-foreground">
                      ({serverTools.length} 个工具)
                    </span>
                  </button>

                  {expandedServers.has(serverName) && (
                    <div className="border-t">
                      {serverTools.map((tool) => {
                        const displayName = getMcpInnerToolName(
                          tool.name,
                          tool.server_name,
                        );

                        return (
                          <div
                            key={`${tool.server_name}::${tool.name}`}
                            className="border-b last:border-b-0"
                          >
                            <button
                              onClick={() => toggleTool(tool.name)}
                              className="flex w-full items-start gap-2 p-2.5 pl-8 text-left hover:bg-muted/30"
                            >
                              {expandedTools.has(tool.name) ? (
                                <ChevronDown className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <Code className="h-3.5 w-3.5 flex-shrink-0 text-sky-600 dark:text-sky-400" />
                                  <span
                                    className="font-mono text-sm text-emerald-700 dark:text-emerald-300"
                                    title={tool.name}
                                  >
                                    {displayName}
                                  </span>
                                </div>
                                {tool.description && (
                                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                    {tool.description}
                                  </p>
                                )}
                              </div>
                            </button>

                            {expandedTools.has(tool.name) && (
                              <div className="px-8 pb-3">
                                <div className="rounded-lg bg-muted/50 p-3">
                                  <div className="mb-2 flex items-center justify-between">
                                    <span className="text-xs font-medium text-muted-foreground">
                                      输入参数 Schema
                                    </span>
                                    {onCallTool && (
                                      <button
                                        onClick={() =>
                                          onCallTool(tool.name, {})
                                        }
                                        className="rounded border border-emerald-200 bg-[linear-gradient(135deg,#0ea5e9_0%,#14b8a6_52%,#10b981_100%)] px-2 py-1 text-xs text-white shadow-sm shadow-emerald-950/15 hover:opacity-95"
                                      >
                                        调用工具
                                      </button>
                                    )}
                                  </div>
                                  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded border bg-background p-2 font-mono text-xs">
                                    {formatSchema(tool.input_schema)}
                                  </pre>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
