/**
 * @file 布局过渡组件
 * @description 处理对话和画布之间的布局切换动画
 * @module components/content-creator/core/LayoutTransition/LayoutTransition
 */

import React, { memo, useEffect, useState } from "react";
import styled from "styled-components";
import { LayoutMode } from "../../types";
import { useLayoutTransition, TransitionConfig } from "./useLayoutTransition";

const STACKED_CHAT_CANVAS_BREAKPOINT_WIDTH = 1320;
const STACKED_CHAT_CANVAS_BREAKPOINT_HEIGHT = 820;
const STACKED_CHAT_CANVAS_PANEL_HEIGHT = "clamp(260px, 36%, 360px)";

function shouldUseStackedChatCanvasLayout(mode: LayoutMode): boolean {
  if (mode !== "chat-canvas" || typeof window === "undefined") {
    return false;
  }

  return (
    window.innerWidth <= STACKED_CHAT_CANVAS_BREAKPOINT_WIDTH ||
    window.innerHeight <= STACKED_CHAT_CANVAS_BREAKPOINT_HEIGHT
  );
}

const Container = styled.div<{ $stacked: boolean }>`
  display: flex;
  flex-direction: ${({ $stacked }) => ($stacked ? "column" : "row")};
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  gap: ${({ $stacked }) => ($stacked ? "10px" : "12px")};
`;

const ChatPanel = styled.div<{
  $width: string;
  $duration: number;
  $minWidth: string;
  $stacked: boolean;
  $hidden: boolean;
  $chrome: "panel" | "plain";
}>`
  height: ${({ $stacked, $hidden }) =>
    $hidden
      ? "0"
      : $stacked
        ? STACKED_CHAT_CANVAS_PANEL_HEIGHT
        : "100%"};
  max-height: ${({ $stacked, $hidden }) =>
    $hidden
      ? "0"
      : $stacked
        ? STACKED_CHAT_CANVAS_PANEL_HEIGHT
        : "100%"};
  overflow: hidden;
  transition:
    width ${({ $duration }) => $duration}ms ease-out,
    height ${({ $duration }) => $duration}ms ease-out;
  width: ${({ $stacked, $width, $hidden }) =>
    $hidden ? "0" : $stacked ? "100%" : $width};
  min-width: ${({ $stacked, $minWidth }) => ($stacked ? "0px" : $minWidth)};
  min-height: ${({ $stacked, $hidden }) =>
    $hidden ? "0" : $stacked ? "220px" : "100%"};
  flex: ${({ $stacked, $hidden }) =>
    $hidden
      ? "0 0 0"
      : $stacked
        ? `0 0 ${STACKED_CHAT_CANVAS_PANEL_HEIGHT}`
        : "0 0 auto"};
  will-change: width, height;
  display: ${({ $hidden }) => ($hidden ? "none" : "flex")};
  flex-direction: column;
  padding: ${({ $stacked, $chrome }) =>
    $stacked || $chrome === "plain" ? "0" : "16px 16px 16px 0"};
`;

const ChatPanelInner = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  background: hsl(var(--background));
  border-radius: 12px;
  border: 1px solid hsl(var(--border));
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
`;

const PlainChatPanelInner = styled.div`
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
`;

const CanvasPanel = styled.div<{
  $visible: boolean;
  $stacked: boolean;
  $transform: string;
  $opacity: number;
  $duration: number;
}>`
  position: relative;
  height: ${({ $stacked }) => ($stacked ? "auto" : "100%")};
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  transition:
    transform ${({ $duration }) => $duration}ms ease-out,
    opacity ${({ $duration }) => $duration}ms ease-out;
  transform: ${({ $transform }) => $transform};
  opacity: ${({ $opacity }) => $opacity};
  display: ${({ $visible }) => ($visible ? "block" : "none")};
  will-change: transform, opacity;
`;

interface LayoutTransitionProps {
  /** 当前布局模式 */
  mode: LayoutMode;
  /** 对话区域内容 */
  chatContent: React.ReactNode;
  /** 画布区域内容 */
  canvasContent: React.ReactNode;
  /** 过渡配置 */
  transitionConfig?: TransitionConfig;
  /** 聊天区域是否使用额外面板壳 */
  chatPanelChrome?: "panel" | "plain";
}

/**
 * 布局过渡组件
 *
 * 处理纯对话和对话+画布两种布局之间的平滑切换
 */
export const LayoutTransition: React.FC<LayoutTransitionProps> = memo(
  ({
    mode,
    chatContent,
    canvasContent,
    transitionConfig,
    chatPanelChrome = "panel",
  }) => {
    const hasCanvasContent = React.Children.count(canvasContent) > 0;
    const effectiveMode: LayoutMode = hasCanvasContent ? mode : "chat";
    const { isCanvasVisible, getTransitionStyles } = useLayoutTransition(
      effectiveMode,
      transitionConfig,
    );
    const [stackedChatCanvas, setStackedChatCanvas] = useState(() =>
      shouldUseStackedChatCanvasLayout(effectiveMode),
    );

    const chatStyles = getTransitionStyles("chat");
    const canvasStyles = getTransitionStyles("canvas");
    const shouldRenderCanvas = hasCanvasContent && isCanvasVisible;

    useEffect(() => {
      const updateLayout = () => {
        setStackedChatCanvas(
          shouldUseStackedChatCanvasLayout(effectiveMode),
        );
      };

      updateLayout();
      if (typeof window === "undefined") {
        return;
      }

      window.addEventListener("resize", updateLayout);
      return () => {
        window.removeEventListener("resize", updateLayout);
      };
    }, [effectiveMode]);

    return (
      <Container
        $stacked={stackedChatCanvas}
        data-testid="layout-transition-root"
        data-effective-mode={effectiveMode}
        data-has-canvas={shouldRenderCanvas ? "true" : "false"}
        data-layout-axis={stackedChatCanvas ? "vertical" : "horizontal"}
      >
        <CanvasPanel
          $visible={shouldRenderCanvas}
          $stacked={stackedChatCanvas}
          $transform={canvasStyles.transform as string}
          $opacity={canvasStyles.opacity as number}
          $duration={parseInt(
            canvasStyles.transition?.match(/\d+/)?.[0] || "300",
          )}
        >
          {canvasContent}
        </CanvasPanel>

        <ChatPanel
          $width={chatStyles.width as string}
          $duration={parseInt(
            chatStyles.transition?.match(/\d+/)?.[0] || "300",
          )}
          $minWidth={effectiveMode === "chat-canvas" ? "360px" : "0px"}
          $stacked={stackedChatCanvas}
          $hidden={effectiveMode === "canvas"}
          $chrome={chatPanelChrome}
        >
          {chatPanelChrome === "plain" ? (
            <PlainChatPanelInner data-testid="layout-chat-panel-plain">
              {chatContent}
            </PlainChatPanelInner>
          ) : (
            <ChatPanelInner data-testid="layout-chat-panel-inner">
              {chatContent}
            </ChatPanelInner>
          )}
        </ChatPanel>
      </Container>
    );
  },
);

LayoutTransition.displayName = "LayoutTransition";
