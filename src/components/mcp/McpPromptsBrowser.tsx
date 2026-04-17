/**
 * MCP 提示词浏览器组件
 *
 * 按服务器分组显示所有可用的 MCP 提示词，支持参数输入和内容获取。
 *
 * @module components/mcp/McpPromptsBrowser
 */

import { useState } from "react";
import {
  MessageSquare,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Search,
  Play,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { McpPromptDefinition, McpPromptResult } from "@/lib/api/mcp";

interface McpPromptsBrowserProps {
  prompts: McpPromptDefinition[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onGetPrompt: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<McpPromptResult>;
}

export function McpPromptsBrowser({
  prompts,
  loading,
  onRefresh,
  onGetPrompt,
}: McpPromptsBrowserProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedServers, setExpandedServers] = useState<Set<string>>(
    new Set(),
  );
  const [activePrompt, setActivePrompt] = useState<string | null>(null);
  const [promptArgs, setPromptArgs] = useState<Record<string, string>>({});
  const [promptResult, setPromptResult] = useState<McpPromptResult | null>(
    null,
  );
  const [calling, setCalling] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);

  // 按服务器分组
  const promptsByServer = prompts.reduce(
    (acc, prompt) => {
      if (!acc[prompt.server_name]) {
        acc[prompt.server_name] = [];
      }
      acc[prompt.server_name].push(prompt);
      return acc;
    },
    {} as Record<string, McpPromptDefinition[]>,
  );

  // 过滤
  const filteredByServer = Object.entries(promptsByServer).reduce(
    (acc, [serverName, serverPrompts]) => {
      const filtered = serverPrompts.filter(
        (p) =>
          p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (p.description || "")
            .toLowerCase()
            .includes(searchQuery.toLowerCase()),
      );
      if (filtered.length > 0) acc[serverName] = filtered;
      return acc;
    },
    {} as Record<string, McpPromptDefinition[]>,
  );

  const toggleServer = (name: string) => {
    const s = new Set(expandedServers);
    if (s.has(name)) {
      s.delete(name);
    } else {
      s.add(name);
    }
    setExpandedServers(s);
  };

  const handleOpenPrompt = (prompt: McpPromptDefinition) => {
    setActivePrompt(prompt.name);
    setPromptArgs({});
    setPromptResult(null);
    setCallError(null);
  };

  const handleCallPrompt = async (prompt: McpPromptDefinition) => {
    setCalling(true);
    setCallError(null);
    try {
      const args: Record<string, unknown> = {};
      prompt.arguments.forEach((arg) => {
        if (promptArgs[arg.name]) args[arg.name] = promptArgs[arg.name];
      });
      const result = await onGetPrompt(prompt.name, args);
      setPromptResult(result);
    } catch (e) {
      setCallError(e instanceof Error ? e.message : String(e));
    } finally {
      setCalling(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 标题栏 */}
      <div className="p-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">提示词</span>
          <span className="text-xs text-muted-foreground">
            ({prompts.length})
          </span>
        </div>
        <button
          onClick={() => onRefresh()}
          disabled={loading}
          className="p-1.5 rounded hover:bg-muted"
          title="刷新提示词列表"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </div>

      {/* 搜索框 */}
      <div className="p-2 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索提示词..."
            className="w-full pl-8 pr-3 py-1.5 rounded border bg-background text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
          />
        </div>
      </div>

      {/* 提示词列表 */}
      <div className="flex-1 overflow-auto">
        {loading && prompts.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : Object.keys(filteredByServer).length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            {searchQuery
              ? "未找到匹配的提示词"
              : "暂无可用提示词，请先启动 MCP 服务器"}
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {Object.entries(filteredByServer).map(
              ([serverName, serverPrompts]) => (
                <div key={serverName} className="border rounded-lg">
                  <button
                    onClick={() => toggleServer(serverName)}
                    className="w-full p-2.5 flex items-center gap-2 hover:bg-muted/50 rounded-t-lg"
                  >
                    {expandedServers.has(serverName) ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="font-medium text-sm">{serverName}</span>
                    <span className="text-xs text-muted-foreground">
                      ({serverPrompts.length} 个提示词)
                    </span>
                  </button>

                  {expandedServers.has(serverName) && (
                    <div className="border-t">
                      {serverPrompts.map((prompt) => (
                        <div
                          key={prompt.name}
                          className="border-b last:border-b-0"
                        >
                          <div className="p-2.5 pl-8 flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 text-sky-600 dark:text-sky-400" />
                                <span className="font-mono text-sm text-sky-700 dark:text-sky-300">
                                  {prompt.name}
                                </span>
                              </div>
                              {prompt.description && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                  {prompt.description}
                                </p>
                              )}
                              {prompt.arguments.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                  {prompt.arguments.map((arg) => (
                                    <span
                                      key={arg.name}
                                      className={cn(
                                        "px-1.5 py-0.5 text-xs rounded",
                                        arg.required
                                          ? "bg-orange-500/10 text-orange-600"
                                          : "bg-muted text-muted-foreground",
                                      )}
                                    >
                                      {arg.name}
                                      {arg.required && " *"}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() =>
                                activePrompt === prompt.name
                                  ? setActivePrompt(null)
                                  : handleOpenPrompt(prompt)
                              }
                              className="p-1 rounded hover:bg-muted text-muted-foreground flex-shrink-0"
                              title="调用提示词"
                            >
                              {activePrompt === prompt.name ? (
                                <X className="h-4 w-4" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                            </button>
                          </div>

                          {/* 参数输入和结果展示 */}
                          {activePrompt === prompt.name && (
                            <div className="px-8 pb-3 space-y-3">
                              {/* 参数输入 */}
                              {prompt.arguments.length > 0 && (
                                <div className="space-y-2">
                                  {prompt.arguments.map((arg) => (
                                    <div key={arg.name}>
                                      <label className="block text-xs font-medium text-muted-foreground mb-1">
                                        {arg.name}
                                        {arg.required && (
                                          <span className="text-destructive ml-0.5">
                                            *
                                          </span>
                                        )}
                                        {arg.description && (
                                          <span className="font-normal ml-1">
                                            - {arg.description}
                                          </span>
                                        )}
                                      </label>
                                      <input
                                        type="text"
                                        value={promptArgs[arg.name] || ""}
                                        onChange={(e) =>
                                          setPromptArgs((prev) => ({
                                            ...prev,
                                            [arg.name]: e.target.value,
                                          }))
                                        }
                                        className="w-full px-2.5 py-1.5 rounded border bg-background text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                                        placeholder={`输入 ${arg.name}`}
                                      />
                                    </div>
                                  ))}
                                </div>
                              )}

                              <button
                                onClick={() => handleCallPrompt(prompt)}
                                disabled={calling}
                                className="rounded border border-emerald-200 bg-[linear-gradient(135deg,#0ea5e9_0%,#14b8a6_52%,#10b981_100%)] px-3 py-1.5 text-sm text-white shadow-sm shadow-emerald-950/15 hover:opacity-95 disabled:opacity-50"
                              >
                                {calling ? "获取中..." : "获取提示词"}
                              </button>

                              {callError && (
                                <div className="p-2 rounded bg-destructive/10 text-destructive text-xs">
                                  {callError}
                                </div>
                              )}

                              {promptResult && (
                                <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                                  {promptResult.description && (
                                    <p className="text-xs text-muted-foreground">
                                      {promptResult.description}
                                    </p>
                                  )}
                                  {promptResult.messages.map((msg, i) => (
                                    <div
                                      key={i}
                                      className="bg-background p-2 rounded border"
                                    >
                                      <span className="text-xs font-medium text-muted-foreground">
                                        {msg.role}
                                      </span>
                                      <div className="text-sm mt-1 whitespace-pre-wrap">
                                        {msg.content.type === "text"
                                          ? msg.content.text
                                          : `[${msg.content.type}]`}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
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
