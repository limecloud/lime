/**
 * @file TerminalAIPanel.tsx
 * @description Terminal AI 面板主组件
 * @module components/terminal/ai/TerminalAIPanel
 *
 * 参考 Waveterm 的 AIPanel 设计，实现终端 AI 助手面板。
 * 支持 AI 控制终端执行命令（需用户审批）。
 */

import React, { useState, useCallback, useEffect } from "react";
import { Sparkles, MoreVertical, Trash2, Terminal, Unplug } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TerminalAIModeSelector } from "./TerminalAIModeSelector";
import { TerminalAIMessages } from "./TerminalAIMessages";
import { TerminalAIInput } from "./TerminalAIInput";
import { TerminalAIWelcome } from "./TerminalAIWelcome";
import { CommandApprovalList } from "./CommandApproval";
import { useTerminalAI } from "./useTerminalAI";
import { skillsApi, type Skill } from "@/lib/api/skills";

// ============================================================================
// 类型
// ============================================================================

interface TerminalAIPanelProps {
  /** 获取终端输出的回调 */
  getTerminalOutput?: () => string | null;
  /** 终端会话 ID（用于 AI 控制终端） */
  terminalSessionId?: string | null;
  /** 自定义类名 */
  className?: string;
}

// ============================================================================
// 组件
// ============================================================================

export const TerminalAIPanel: React.FC<TerminalAIPanelProps> = ({
  getTerminalOutput,
  terminalSessionId,
  className,
}) => {
  const [input, setInput] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);

  // 加载技能列表
  useEffect(() => {
    skillsApi
      .getLocal("lime")
      .then(setSkills)
      .catch((err) => console.error("加载技能列表失败:", err));
  }, []);

  const {
    messages,
    isSending,
    config,
    providerId,
    setProviderId,
    modelId,
    setModelId,
    sendMessage,
    clearMessages,
    toggleWidgetContext,
    toggleAutoExecute,
    // 终端控制
    isTerminalConnected,
    pendingCommands,
    connectTerminal,
    disconnectTerminal,
    approveCommand,
    rejectCommand,
  } = useTerminalAI(getTerminalOutput);

  // 当终端会话 ID 变化时，自动连接/断开
  useEffect(() => {
    if (terminalSessionId) {
      connectTerminal(terminalSessionId);
    } else {
      disconnectTerminal();
    }
  }, [terminalSessionId, connectTerminal, disconnectTerminal]);

  /**
   * 处理发送
   */
  const handleSend = useCallback(
    async (textOverride?: string) => {
      const text = textOverride || input;
      if (!text.trim()) return;
      setInput("");
      await sendMessage(text);
    },
    [input, sendMessage],
  );

  /**
   * 处理快捷输入
   */
  const handleQuickInput = useCallback((text: string) => {
    setInput(text);
  }, []);

  const hasMessages = messages.length > 0;
  const hasPendingCommands =
    pendingCommands.filter((c) => c.status === "pending").length > 0;

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-zinc-900 border-r border-zinc-700",
        className,
      )}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-yellow-400" />
          <span className="font-medium text-zinc-200">Terminal AI</span>
          {/* 终端连接状态指示器 */}
          {isTerminalConnected ? (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <Terminal size={12} />
              已连接
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-zinc-500">
              <Unplug size={12} />
              未连接
            </span>
          )}
        </div>

        {/* 更多菜单 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors">
              <MoreVertical size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="bg-zinc-800 border-zinc-700"
          >
            <DropdownMenuItem
              onClick={clearMessages}
              className="text-zinc-200 hover:bg-zinc-700 cursor-pointer"
            >
              <Trash2 size={14} className="mr-2" />
              清空对话
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Widget Context 开关 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700/50">
        <span className="text-sm text-zinc-400">Widget Context</span>
        <Switch
          checked={config.widgetContext}
          onCheckedChange={toggleWidgetContext}
          className="data-[state=checked]:bg-green-500"
        />
      </div>

      {/* 自动执行开关 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700/50">
        <div className="flex flex-col">
          <span className="text-sm text-zinc-400">自动执行命令</span>
          <span className="text-xs text-zinc-500">AI 命令无需手动批准</span>
        </div>
        <Switch
          checked={config.autoExecute}
          onCheckedChange={toggleAutoExecute}
          className="data-[state=checked]:bg-green-500"
        />
      </div>

      {/* 模式选择器 */}
      <div className="px-3 py-2 border-b border-zinc-700/50">
        <TerminalAIModeSelector
          providerId={providerId}
          onProviderChange={setProviderId}
          modelId={modelId}
          onModelChange={setModelId}
        />
      </div>

      {/* 待审批命令 */}
      {hasPendingCommands && (
        <div className="px-3 py-2 border-b border-zinc-700/50">
          <CommandApprovalList
            commands={pendingCommands.filter((c) => c.status === "pending")}
            onApprove={approveCommand}
            onReject={rejectCommand}
          />
        </div>
      )}

      {/* 消息区域 */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {hasMessages ? (
          <TerminalAIMessages messages={messages} isSending={isSending} />
        ) : (
          <TerminalAIWelcome onQuickInput={handleQuickInput} />
        )}
      </div>

      {/* 输入区域 */}
      <TerminalAIInput
        value={input}
        onChange={setInput}
        onSubmit={handleSend}
        isSending={isSending}
        placeholder={hasMessages ? "继续对话..." : "向 Terminal AI 提问..."}
        skills={skills}
      />
    </div>
  );
};
