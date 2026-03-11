/**
 * @file GeneralChatPage.tsx
 * @description 通用对话主页面 - 三栏布局（旧 general-chat 兼容入口）
 * @module components/general-chat/GeneralChatPage
 *
 * @requirements 3.1, 3.5, 9.4
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import { ChatPanel } from "./chat/ChatPanel";
import { CanvasPanel } from "./canvas/CanvasPanel";
import { ErrorBoundary } from "./chat/ErrorBoundary";
import { useGeneralChatStore } from "./store/useGeneralChatStore";
import { useStreaming } from "./hooks/useStreaming";
import type { CanvasState, GeneralChatPageProps } from "./types";
import { DEFAULT_CANVAS_STATE } from "./types";

/**
 * 通用对话主页面
 *
 * 三栏布局：
 * - 左侧：会话列表（复用 ChatSidebar）
 * - 中间：聊天区域
 * - 右侧：画布面板（可折叠）
 *
 * @deprecated 该页面仅用于兼容旧版 general-chat 链路，新功能请优先接入统一对话入口。
 */
export const GeneralChatPage: React.FC<GeneralChatPageProps> = ({
  initialSessionId,
  onNavigate,
}) => {
  const { currentSessionId, selectSession, createSession, hydrateSessions } =
    useGeneralChatStore();

  // 画布状态
  const [canvasState, setCanvasState] =
    useState<CanvasState>(DEFAULT_CANVAS_STATE);

  // 使用 ref 防止 StrictMode 下重复初始化
  const hydratedRef = useRef(false);
  const sessionCreatedRef = useRef(false);

  // 接入现役 Aster 流式事件，避免发送后只停留在占位消息。
  useStreaming({ sessionId: currentSessionId });

  // 初始化：先从后端 hydrate 会话，再决定是否创建默认会话。
  useEffect(() => {
    if (hydratedRef.current) {
      return;
    }

    hydratedRef.current = true;
    let cancelled = false;

    void (async () => {
      try {
        const hydratedSessionId = await hydrateSessions(initialSessionId);

        if (!cancelled && !hydratedSessionId && !sessionCreatedRef.current) {
          sessionCreatedRef.current = true;
          await createSession();
        }
      } catch (error) {
        console.error("[GeneralChatPage] 初始化会话失败:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialSessionId, hydrateSessions, createSession]);

  useEffect(() => {
    if (initialSessionId && initialSessionId !== currentSessionId) {
      selectSession(initialSessionId);
    }
  }, [initialSessionId, currentSessionId, selectSession]);

  // 打开画布
  const handleOpenCanvas = useCallback((state: CanvasState) => {
    setCanvasState(state);
  }, []);

  // 关闭画布
  const handleCloseCanvas = useCallback(() => {
    setCanvasState(DEFAULT_CANVAS_STATE);
  }, []);

  // 画布内容变更
  const handleCanvasContentChange = useCallback((content: string) => {
    setCanvasState((prev) => ({ ...prev, content }));
  }, []);

  return (
    <div className="flex h-full bg-background">
      {/* 中间：聊天区域 - 使用 ErrorBoundary 包裹 */}
      <div className="flex-1 flex flex-col min-w-0">
        <ErrorBoundary
          componentName="ChatPanel"
          onError={(error, errorInfo) => {
            console.error(
              "[GeneralChatPage] ChatPanel 渲染错误:",
              error.message,
            );
            console.error(
              "[GeneralChatPage] 组件堆栈:",
              errorInfo.componentStack,
            );
          }}
        >
          <ChatPanel
            sessionId={currentSessionId}
            onOpenCanvas={handleOpenCanvas}
            onNavigate={onNavigate}
          />
        </ErrorBoundary>
      </div>

      {/* 右侧：画布面板 - 使用 ErrorBoundary 包裹 */}
      {canvasState.isOpen && (
        <div className="w-[400px] flex-shrink-0 border-l border-ink-200">
          <ErrorBoundary
            componentName="CanvasPanel"
            onError={(error, errorInfo) => {
              console.error(
                "[GeneralChatPage] CanvasPanel 渲染错误:",
                error.message,
              );
              console.error(
                "[GeneralChatPage] 组件堆栈:",
                errorInfo.componentStack,
              );
            }}
          >
            <CanvasPanel
              state={canvasState}
              onClose={handleCloseCanvas}
              onContentChange={handleCanvasContentChange}
            />
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
};

export default GeneralChatPage;
