/**
 * MCP 管理面板
 *
 * 整合配置管理、运行时状态、工具/提示词/资源浏览为一体的完整 MCP 管理界面。
 * 采用左右分栏布局：左侧为服务器列表和运行控制，右侧为 Tab 切换的功能面板。
 *
 * @module components/mcp/McpPanel
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useMcp } from "@/hooks/useMcp";
import { McpPage } from "./McpPage";
import { McpServerList } from "./McpServerList";
import { McpToolsBrowser } from "./McpToolsBrowser";
import { McpToolCaller } from "./McpToolCaller";
import { McpPromptsBrowser } from "./McpPromptsBrowser";
import { McpResourcesBrowser } from "./McpResourcesBrowser";
import { McpToolDefinition } from "@/lib/api/mcp";

type McpTab = "runtime" | "tools" | "prompts" | "resources" | "config";

const tabs: { id: McpTab; label: string }[] = [
  { id: "runtime", label: "运行状态" },
  { id: "tools", label: "工具" },
  { id: "prompts", label: "提示词" },
  { id: "resources", label: "资源" },
  { id: "config", label: "配置管理" },
];

interface McpPanelProps {
  hideHeader?: boolean;
}

export function McpPanel({ hideHeader = false }: McpPanelProps) {
  const [activeTab, setActiveTab] = useState<McpTab>("runtime");
  const [callingTool, setCallingTool] = useState<McpToolDefinition | null>(
    null,
  );

  const {
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
  } = useMcp();

  // 工具调用处理
  const handleCallTool = async (
    toolName: string,
    args: Record<string, unknown>,
  ) => {
    return await callTool(toolName, args);
  };

  // 打开工具调用面板
  const handleOpenToolCaller = async (
    toolName: string,
    _args: Record<string, unknown>,
  ): Promise<void> => {
    const tool = tools.find((t) => t.name === toolName);
    if (tool) {
      setCallingTool(tool);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* 页面标题 */}
      {!hideHeader && (
        <div className="mb-4">
          <h2 className="text-2xl font-bold">MCP 服务器</h2>
          <p className="text-muted-foreground">
            管理 Model Context Protocol 服务器，浏览工具、提示词和资源
          </p>
        </div>
      )}

      {/* Tab 导航 */}
      <div className="flex items-center gap-1 mb-4 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30",
            )}
          >
            {tab.label}
            {/* 数量标记 */}
            {tab.id === "tools" && tools.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-blue-500/10 text-blue-600">
                {tools.length}
              </span>
            )}
            {tab.id === "prompts" && prompts.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-purple-500/10 text-purple-600">
                {prompts.length}
              </span>
            )}
            {tab.id === "resources" && resources.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-orange-500/10 text-orange-600">
                {resources.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 min-h-0">
        {/* 运行状态 Tab */}
        {activeTab === "runtime" && (
          <div className="h-full border rounded-lg">
            <McpServerList
              servers={servers}
              loading={loading}
              error={error}
              serverConnectionStates={serverConnectionStates}
              onStartServer={startServer}
              onStopServer={stopServer}
              onReconnectServer={reconnectServer}
              onRefresh={refreshServers}
            />
          </div>
        )}

        {/* 工具 Tab */}
        {activeTab === "tools" && (
          <div className="h-full flex gap-4">
            <div
              className={cn(
                "border rounded-lg",
                callingTool ? "w-1/2" : "w-full",
              )}
            >
              <McpToolsBrowser
                tools={tools}
                loading={loading}
                onRefresh={refreshTools}
                onCallTool={handleOpenToolCaller}
              />
            </div>
            {callingTool && (
              <div className="w-1/2 overflow-auto">
                <McpToolCaller
                  tool={callingTool}
                  onCallTool={handleCallTool}
                  onClose={() => setCallingTool(null)}
                />
              </div>
            )}
          </div>
        )}

        {/* 提示词 Tab */}
        {activeTab === "prompts" && (
          <div className="h-full border rounded-lg">
            <McpPromptsBrowser
              prompts={prompts}
              loading={loading}
              onRefresh={refreshPrompts}
              onGetPrompt={getPrompt}
            />
          </div>
        )}

        {/* 资源 Tab */}
        {activeTab === "resources" && (
          <div className="h-full border rounded-lg">
            <McpResourcesBrowser
              resources={resources}
              loading={loading}
              onRefresh={refreshResources}
              onReadResource={readResource}
            />
          </div>
        )}

        {/* 配置管理 Tab */}
        {activeTab === "config" && (
          <div className="h-full overflow-auto">
            <McpPage hideHeader />
          </div>
        )}
      </div>
    </div>
  );
}
