/**
 * @file TerminalAIMessages.tsx
 * @description Terminal AI 消息列表组件
 * @module components/terminal/ai/TerminalAIMessages
 *
 * 参考 Waveterm 的 AIPanelMessages 设计
 */

import React, { useRef, useEffect, useState, useCallback, memo } from "react";
import { cn } from "@/lib/utils";
import type { AIMessage } from "./types";
import type { AgentToolCallState as ToolCallState } from "@/lib/api/agentProtocol";

// ============================================================================
// 子组件
// ============================================================================

/**
 * 思考中动画
 */
const AIThinking = memo(({ message = "思考中..." }: { message?: string }) => (
  <div className="flex items-center gap-2">
    <div className="animate-pulse flex items-center">
      <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full" />
      <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full mx-1" />
      <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full" />
    </div>
    <span className="text-sm text-zinc-400">{message}</span>
  </div>
));

AIThinking.displayName = "AIThinking";

/**
 * 消息内容渲染
 */
const MessageContent = memo(
  ({
    content,
    role,
    isStreaming,
  }: {
    content: string;
    role: string;
    isStreaming: boolean;
  }) => {
    if (role === "user") {
      return <div className="whitespace-pre-wrap break-words">{content}</div>;
    }

    // 简单的 Markdown 渲染（代码块）
    const parts = content.split(/(```[\s\S]*?```)/g);

    return (
      <div className="text-zinc-100 space-y-2">
        {parts.map((part, index) => {
          if (part.startsWith("```")) {
            // 代码块
            const match = part.match(/```(\w*)\n?([\s\S]*?)```/);
            if (match) {
              const [, lang, code] = match;
              return (
                <div
                  key={index}
                  className="bg-zinc-900 rounded-md overflow-hidden"
                >
                  {lang && (
                    <div className="px-3 py-1 text-xs text-zinc-400 bg-zinc-800 border-b border-zinc-700">
                      {lang}
                    </div>
                  )}
                  <pre className="p-3 text-sm overflow-x-auto">
                    <code>{code.trim()}</code>
                  </pre>
                </div>
              );
            }
          }

          // 普通文本
          if (part.trim()) {
            return (
              <div key={index} className="whitespace-pre-wrap break-words">
                {part}
              </div>
            );
          }

          return null;
        })}
        {isStreaming && (
          <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse" />
        )}
      </div>
    );
  },
);

MessageContent.displayName = "MessageContent";

/**
 * 工具调用显示
 */
const ToolCallDisplay = memo(({ toolCall }: { toolCall: ToolCallState }) => {
  const isCompleted = toolCall.status === "completed";
  const isFailed = toolCall.status === "failed";
  const isRunning = toolCall.status === "running";

  // 状态图标
  const statusIcon = isCompleted ? "✓" : isFailed ? "✗" : "•";

  // 背景色：成功用绿色调，失败用红色调，运行中用灰色
  const bgColor = isCompleted
    ? "bg-green-900/30 border-green-700/50"
    : isFailed
      ? "bg-red-900/30 border-red-700/50"
      : "bg-zinc-800/60 border-zinc-700";

  // 图标颜色
  const iconColor = isCompleted
    ? "text-green-400"
    : isFailed
      ? "text-red-400"
      : "text-zinc-400";

  // 工具名称颜色
  const nameColor = isCompleted
    ? "text-green-300"
    : isFailed
      ? "text-red-300"
      : "text-zinc-300";

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 p-2.5 rounded-md border text-sm",
        bgColor,
      )}
    >
      {/* 工具名称和状态 */}
      <div className="flex items-center gap-2">
        <span className={cn("font-bold text-base", iconColor)}>
          {statusIcon}
        </span>
        <span className={cn("font-medium", nameColor)}>{toolCall.name}</span>
        {isRunning && (
          <span className="text-xs text-zinc-500 animate-pulse">执行中...</span>
        )}
      </div>

      {/* 显示结果 */}
      {toolCall.result && (
        <div className="pl-6 space-y-1">
          {/* 成功输出 */}
          {toolCall.result.success && toolCall.result.output && (
            <div className="text-zinc-300 text-xs font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto bg-zinc-900/50 rounded p-2">
              {toolCall.result.output.length > 500
                ? toolCall.result.output.slice(0, 500) + "..."
                : toolCall.result.output}
            </div>
          )}

          {/* 错误信息 */}
          {toolCall.result.error && (
            <div className="text-red-300 text-xs">
              <span className="font-medium">错误: </span>
              {toolCall.result.error}
            </div>
          )}

          {/* 退出码（如果有） */}
          {!toolCall.result.success && !toolCall.result.error && (
            <div className="text-red-300 text-xs">命令执行失败</div>
          )}
        </div>
      )}
    </div>
  );
});

ToolCallDisplay.displayName = "ToolCallDisplay";

/**
 * 单条消息
 */
const AIMessageItem = memo(
  ({ message, isStreaming }: { message: AIMessage; isStreaming: boolean }) => {
    const isUser = message.role === "user";
    const hasContent =
      message.content ||
      (message.contentParts && message.contentParts.length > 0);

    return (
      <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
        <div
          className={cn(
            "px-3 py-2 rounded-lg max-w-[85%]",
            isUser
              ? "bg-zinc-700/60 text-white"
              : "bg-transparent min-w-[200px]",
          )}
        >
          {/* 思考中状态 */}
          {message.isThinking && !hasContent && (
            <AIThinking message={message.thinkingContent} />
          )}

          {/* 交错内容渲染 */}
          {message.contentParts && message.contentParts.length > 0 ? (
            <div className="space-y-2">
              {message.contentParts.map((part, index) => {
                if (part.type === "text") {
                  return (
                    <MessageContent
                      key={index}
                      content={part.text}
                      role={message.role}
                      isStreaming={
                        isStreaming &&
                        index === message.contentParts!.length - 1
                      }
                    />
                  );
                } else if (part.type === "tool_use") {
                  return (
                    <ToolCallDisplay key={index} toolCall={part.toolCall} />
                  );
                }
                return null;
              })}
            </div>
          ) : (
            // 回退到普通内容渲染
            hasContent && (
              <MessageContent
                content={message.content}
                role={message.role}
                isStreaming={isStreaming}
              />
            )
          )}

          {/* 用户消息图片 */}
          {isUser && message.images && message.images.length > 0 && (
            <div className="mt-2 flex gap-2 flex-wrap">
              {message.images.map((img, index) => (
                <img
                  key={index}
                  src={`data:${img.mediaType};base64,${img.data}`}
                  alt="附件"
                  className="max-w-[100px] max-h-[100px] rounded object-cover"
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  },
);

AIMessageItem.displayName = "AIMessageItem";

// ============================================================================
// 主组件
// ============================================================================

interface TerminalAIMessagesProps {
  /** 消息列表 */
  messages: AIMessage[];
  /** 是否正在发送 */
  isSending: boolean;
}

export const TerminalAIMessages: React.FC<TerminalAIMessagesProps> = ({
  messages,
  isSending,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  /**
   * 检查是否在底部
   */
  const checkIfAtBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;

    const threshold = 50;
    const scrollBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    return scrollBottom <= threshold;
  }, []);

  /**
   * 滚动到底部
   */
  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
      setShouldAutoScroll(true);
    }
  }, []);

  /**
   * 处理滚动
   */
  const handleScroll = useCallback(() => {
    setShouldAutoScroll(checkIfAtBottom());
  }, [checkIfAtBottom]);

  // 监听滚动
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // 自动滚动
  useEffect(() => {
    if (shouldAutoScroll) {
      scrollToBottom();
    }
  }, [messages, shouldAutoScroll, scrollToBottom]);

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto p-3 space-y-3">
      {messages.map((message, index) => {
        const isLastMessage = index === messages.length - 1;
        const isStreaming =
          isSending && isLastMessage && message.role === "assistant";

        return (
          <AIMessageItem
            key={message.id}
            message={message}
            isStreaming={isStreaming}
          />
        );
      })}

      {/* 空消息时的流式占位符 */}
      {isSending &&
        (messages.length === 0 ||
          messages[messages.length - 1].role !== "assistant") && (
          <AIMessageItem
            message={{
              id: "streaming-placeholder",
              role: "assistant",
              content: "",
              timestamp: new Date(),
              isThinking: true,
              thinkingContent: "思考中...",
            }}
            isStreaming={true}
          />
        )}
    </div>
  );
};
