/**
 * MCP 管理面板
 *
 * 整合配置管理、运行时状态、工具/提示词/资源浏览为一体的完整 MCP 管理界面。
 * 采用左右分栏布局：左侧为服务器列表和运行控制，右侧为 Tab 切换的功能面板。
 *
 * @module components/mcp/McpPanel
 */

import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  MessageSquareText,
  Settings2,
  Server,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMcp } from "@/hooks/useMcp";
import { McpPage } from "./McpPage";
import { McpServerList } from "./McpServerList";
import { McpToolsBrowser } from "./McpToolsBrowser";
import { McpToolCaller } from "./McpToolCaller";
import { McpPromptsBrowser } from "./McpPromptsBrowser";
import { McpResourcesBrowser } from "./McpResourcesBrowser";
import type { McpToolDefinition } from "@/lib/api/mcp";

type McpTab = "runtime" | "tools" | "prompts" | "resources" | "config";

interface McpTabDefinition {
  id: McpTab;
  label: string;
  icon: LucideIcon;
}

const tabs: McpTabDefinition[] = [
  { id: "runtime", label: "运行状态", icon: Server },
  { id: "tools", label: "工具", icon: Wrench },
  { id: "prompts", label: "提示词", icon: MessageSquareText },
  { id: "resources", label: "资源", icon: FileText },
  { id: "config", label: "配置管理", icon: Settings2 },
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

  const runningServerCount = servers.filter(
    (server) => server.is_running,
  ).length;
  const activeTabDefinition =
    tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  const statusMeta = error
    ? {
        label: "异常",
        detail: "连接状态需要处理",
        className: "border-rose-200 bg-rose-50 text-rose-700",
        icon: AlertTriangle,
      }
    : loading
      ? {
          label: "同步中",
          detail: "正在刷新 MCP 状态",
          className: "border-sky-200 bg-sky-50 text-sky-700",
          icon: Loader2,
        }
      : {
          label: "已同步",
          detail: "本机配置已载入",
          className: "border-emerald-200 bg-emerald-50 text-emerald-700",
          icon: CheckCircle2,
        };

  const getTabCount = (tab: McpTab) => {
    switch (tab) {
      case "runtime":
        return servers.length;
      case "tools":
        return tools.length;
      case "prompts":
        return prompts.length;
      case "resources":
        return resources.length;
      case "config":
        return servers.length;
    }
  };

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
    <div
      data-settings-embedded={hideHeader ? "true" : "false"}
      className="space-y-6 pb-20 text-slate-900"
    >
      {/* 页面标题 */}
      <section className="rounded-[30px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(244,251,248,0.98)_0%,rgba(248,250,252,0.98)_45%,rgba(241,246,255,0.96)_100%)] p-6 shadow-sm shadow-slate-950/5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold text-emerald-700 shadow-sm shadow-emerald-950/5">
              <Activity className="h-3.5 w-3.5" />
              Model Context Protocol
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-[-0.02em] text-slate-950">
                MCP 服务器
              </h2>
              <p className="text-sm leading-6 text-slate-600">
                管理本机 MCP 服务器，统一查看运行状态、工具、提示词和资源。
              </p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[420px]">
            <div className="rounded-[20px] border border-slate-200/80 bg-white px-4 py-3 shadow-sm shadow-slate-950/5">
              <p className="text-xs font-medium text-slate-500">服务器</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950">
                {servers.length}
              </p>
              <p className="mt-1 text-xs text-emerald-700">
                {runningServerCount} 个运行中
              </p>
            </div>
            <div className="rounded-[20px] border border-slate-200/80 bg-white px-4 py-3 shadow-sm shadow-slate-950/5">
              <p className="text-xs font-medium text-slate-500">能力</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950">
                {tools.length + prompts.length + resources.length}
              </p>
              <p className="mt-1 text-xs text-sky-700">工具 / 提示词 / 资源</p>
            </div>
            <div
              className={cn(
                "rounded-[20px] border px-4 py-3 shadow-sm shadow-slate-950/5",
                statusMeta.className,
              )}
            >
              <p className="text-xs font-medium opacity-80">状态</p>
              <div className="mt-1 flex items-center gap-2">
                <statusMeta.icon
                  className={cn("h-4 w-4", loading && "animate-spin")}
                />
                <p className="text-lg font-semibold">{statusMeta.label}</p>
              </div>
              <p className="mt-1 text-xs opacity-80">{statusMeta.detail}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Tab 导航 */}
      <div className="rounded-[26px] border border-slate-200/80 bg-white p-1.5 shadow-sm shadow-slate-950/5">
        <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center justify-between gap-3 rounded-[20px] px-4 py-3 text-left text-sm font-medium transition",
                activeTab === tab.id
                  ? "bg-slate-950 text-white shadow-sm shadow-slate-950/15"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-950",
              )}
            >
              <span className="flex items-center gap-2">
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </span>
              {getTabCount(tab.id) > 0 && (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs",
                    activeTab === tab.id
                      ? "bg-white/15 text-white"
                      : "bg-slate-100 text-slate-500",
                  )}
                >
                  {getTabCount(tab.id)}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab 内容 */}
      <section className="min-h-[520px] overflow-hidden rounded-[26px] border border-slate-200/80 bg-white shadow-sm shadow-slate-950/5">
        <div className="border-b border-slate-200/80 bg-slate-50/80 px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <activeTabDefinition.icon className="h-4 w-4 text-sky-600" />
            {activeTabDefinition.label}
          </div>
        </div>
        <div className="min-h-[464px]">
          {/* 运行状态 Tab */}
          {activeTab === "runtime" && (
            <div className="min-h-[464px]">
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
            <div className="flex min-h-[464px] flex-col gap-4 p-4 xl:flex-row">
              <div
                className={cn(
                  "min-h-[420px] overflow-hidden rounded-[22px] border border-slate-200/80 bg-white",
                  callingTool ? "xl:w-1/2" : "w-full",
                )}
              >
                <McpToolsBrowser
                  tools={tools}
                  loading={loading}
                  onRefresh={refreshTools}
                  serverCount={servers.length}
                  runningServerCount={runningServerCount}
                  onOpenRuntimeTab={() => setActiveTab("runtime")}
                  onOpenConfigTab={() => setActiveTab("config")}
                  onCallTool={handleOpenToolCaller}
                />
              </div>
              {callingTool && (
                <div className="min-h-[420px] overflow-auto rounded-[22px] border border-slate-200/80 bg-white xl:w-1/2">
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
            <div className="min-h-[464px] p-4">
              <div className="min-h-[420px] overflow-hidden rounded-[22px] border border-slate-200/80 bg-white">
                <McpPromptsBrowser
                  prompts={prompts}
                  loading={loading}
                  onRefresh={refreshPrompts}
                  onGetPrompt={getPrompt}
                />
              </div>
            </div>
          )}

          {/* 资源 Tab */}
          {activeTab === "resources" && (
            <div className="min-h-[464px] p-4">
              <div className="min-h-[420px] overflow-hidden rounded-[22px] border border-slate-200/80 bg-white">
                <McpResourcesBrowser
                  resources={resources}
                  loading={loading}
                  onRefresh={refreshResources}
                  onReadResource={readResource}
                />
              </div>
            </div>
          )}

          {/* 配置管理 Tab */}
          {activeTab === "config" && (
            <div className="min-h-[464px] overflow-auto p-4">
              <McpPage hideHeader />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
