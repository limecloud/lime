/**
 * @file 布局过渡组件
 * @description 处理对话和画布之间的布局切换动画
 * @module components/workspace/layout/LayoutTransition
 */

import React, { memo, useEffect, useState } from "react";
import styled from "styled-components";
import {
  MessageSquareText,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { CompactRightDockButton } from "@/components/ui/compact-right-dock-button";
import {
  CompactRightDrawerHeader,
  CompactRightDrawerIconButton,
} from "@/components/ui/compact-right-drawer-header";
import { LayoutMode } from "@/lib/workspace/workflowTypes";
import {
  emitCompactRightPanelOpen,
  onCompactRightPanelOpen,
} from "@/lib/compactRightPanelEvents";
import { useLayoutTransition, TransitionConfig } from "./useLayoutTransition";

const STACKED_CHAT_CANVAS_BREAKPOINT_WIDTH = 1320;
const STACKED_CHAT_CANVAS_BREAKPOINT_HEIGHT = 820;
const COMPACT_CHAT_CANVAS_DRAWER_WIDTH = "min(420px, calc(100% - 24px))";

function shouldUseCompactChatCanvasOverlay(mode: LayoutMode): boolean {
  if (mode !== "chat-canvas" || typeof window === "undefined") {
    return false;
  }

  return (
    window.innerWidth <= STACKED_CHAT_CANVAS_BREAKPOINT_WIDTH ||
    window.innerHeight <= STACKED_CHAT_CANVAS_BREAKPOINT_HEIGHT
  );
}

const Container = styled.div<{ $compactOverlay: boolean }>`
  display: flex;
  position: relative;
  flex-direction: row;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  gap: ${({ $compactOverlay }) => ($compactOverlay ? "0" : "12px")};
`;

const ChatPanel = styled.div<{
  $width: string;
  $duration: number;
  $minWidth: string;
  $compactOverlay: boolean;
  $compactOverlayOpen: boolean;
  $hidden: boolean;
  $chrome: "panel" | "plain";
}>`
  position: ${({ $compactOverlay }) =>
    $compactOverlay ? "absolute" : "relative"};
  top: ${({ $compactOverlay }) => ($compactOverlay ? "12px" : "auto")};
  right: ${({ $compactOverlay }) => ($compactOverlay ? "12px" : "auto")};
  bottom: ${({ $compactOverlay }) => ($compactOverlay ? "12px" : "auto")};
  z-index: ${({ $compactOverlay }) => ($compactOverlay ? 30 : "auto")};
  height: ${({ $compactOverlay, $hidden }) =>
    $hidden ? "0" : $compactOverlay ? "calc(100% - 24px)" : "100%"};
  max-height: ${({ $compactOverlay, $hidden }) =>
    $hidden ? "0" : $compactOverlay ? "calc(100% - 24px)" : "100%"};
  overflow: hidden;
  transition:
    transform ${({ $duration }) => $duration}ms ease-out,
    opacity ${({ $duration }) => $duration}ms ease-out,
    width ${({ $duration }) => $duration}ms ease-out,
    height ${({ $duration }) => $duration}ms ease-out;
  width: ${({ $compactOverlay, $width, $hidden }) =>
    $hidden
      ? "0"
      : $compactOverlay
        ? COMPACT_CHAT_CANVAS_DRAWER_WIDTH
        : $width};
  min-width: ${({ $compactOverlay, $minWidth }) =>
    $compactOverlay ? "min(320px, calc(100% - 24px))" : $minWidth};
  min-height: ${({ $compactOverlay, $hidden }) =>
    $hidden ? "0" : $compactOverlay ? "280px" : "100%"};
  flex: ${({ $compactOverlay, $hidden }) =>
    $hidden ? "0 0 0" : $compactOverlay ? "0 0 auto" : "0 0 auto"};
  will-change: width, height, transform, opacity;
  display: ${({ $hidden }) => ($hidden ? "none" : "flex")};
  flex-direction: column;
  padding: ${({ $compactOverlay, $chrome }) =>
    $compactOverlay || $chrome === "plain" ? "0" : "16px 16px 16px 0"};
  transform: ${({ $compactOverlay, $compactOverlayOpen }) =>
    $compactOverlay
      ? $compactOverlayOpen
        ? "translateX(0)"
        : "translateX(calc(100% + 24px))"
      : "translateX(0)"};
  opacity: ${({ $compactOverlay, $compactOverlayOpen }) =>
    $compactOverlay ? ($compactOverlayOpen ? 1 : 0) : 1};
  pointer-events: ${({ $compactOverlay, $compactOverlayOpen }) =>
    $compactOverlay ? ($compactOverlayOpen ? "auto" : "none") : "auto"};
  border: ${({ $compactOverlay }) =>
    $compactOverlay ? "1px solid rgba(226, 232, 240, 0.9)" : "none"};
  border-radius: ${({ $compactOverlay }) => ($compactOverlay ? "24px" : "0")};
  background: ${({ $compactOverlay }) =>
    $compactOverlay
      ? "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.96) 100%)"
      : "transparent"};
  box-shadow: ${({ $compactOverlay }) =>
    $compactOverlay ? "0 24px 80px rgba(15,23,42,0.16)" : "none"};
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

const CompactChatBackdrop = styled.button<{ $visible: boolean }>`
  position: absolute;
  inset: 0;
  z-index: 20;
  border: none;
  background: rgba(15, 23, 42, 0.08);
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  pointer-events: ${({ $visible }) => ($visible ? "auto" : "none")};
  transition: opacity 220ms ease-out;
`;

const CompactChatTriggerSlot = styled.div`
  position: absolute;
  right: 16px;
  top: 16px;
  z-index: 18;
`;

const CompactChatBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow: hidden;
`;

const CanvasPanel = styled.div<{
  $visible: boolean;
  $transform: string;
  $opacity: number;
  $duration: number;
}>`
  position: relative;
  height: 100%;
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
  /** chat-canvas 模式下聊天面板宽度 */
  chatPanelWidth?: string;
  /** chat-canvas 模式下聊天面板最小宽度 */
  chatPanelMinWidth?: string;
  /** 紧凑抽屉态下强制展开聊天区 */
  forceOpenChatPanel?: boolean;
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
    chatPanelWidth,
    chatPanelMinWidth,
    forceOpenChatPanel = false,
  }) => {
    const hasCanvasContent = React.Children.count(canvasContent) > 0;
    const effectiveMode: LayoutMode = hasCanvasContent ? mode : "chat";
    const { isCanvasVisible, getTransitionStyles } = useLayoutTransition(
      effectiveMode,
      transitionConfig,
      {
        chatCanvasPanelWidth: chatPanelWidth,
      },
    );
    const [compactChatCanvasOverlay, setCompactChatCanvasOverlay] = useState(
      () => shouldUseCompactChatCanvasOverlay(effectiveMode),
    );
    const [compactChatPanelOpen, setCompactChatPanelOpen] = useState(false);

    const chatStyles = getTransitionStyles("chat");
    const canvasStyles = getTransitionStyles("canvas");
    const shouldRenderCanvas = hasCanvasContent && isCanvasVisible;
    const shouldRenderCompactChatTrigger =
      compactChatCanvasOverlay &&
      effectiveMode === "chat-canvas" &&
      shouldRenderCanvas &&
      !compactChatPanelOpen;

    useEffect(() => {
      const updateLayout = () => {
        setCompactChatCanvasOverlay(
          shouldUseCompactChatCanvasOverlay(effectiveMode),
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

    useEffect(() => {
      if (effectiveMode !== "chat-canvas" || !compactChatCanvasOverlay) {
        setCompactChatPanelOpen(false);
      }
    }, [compactChatCanvasOverlay, effectiveMode]);

    useEffect(() => {
      if (
        !forceOpenChatPanel ||
        !compactChatCanvasOverlay ||
        effectiveMode !== "chat-canvas" ||
        compactChatPanelOpen
      ) {
        return;
      }

      setCompactChatPanelOpen(true);
      emitCompactRightPanelOpen({ source: "chat" });
    }, [
      compactChatCanvasOverlay,
      compactChatPanelOpen,
      effectiveMode,
      forceOpenChatPanel,
    ]);

    useEffect(() => {
      if (!compactChatCanvasOverlay || effectiveMode !== "chat-canvas") {
        return;
      }

      return onCompactRightPanelOpen((detail) => {
        if (detail.source !== "chat") {
          setCompactChatPanelOpen(false);
        }
      });
    }, [compactChatCanvasOverlay, effectiveMode]);

    const handleOpenCompactChatPanel = () => {
      setCompactChatPanelOpen(true);
      emitCompactRightPanelOpen({ source: "chat" });
    };

    return (
      <Container
        $compactOverlay={compactChatCanvasOverlay}
        data-testid="layout-transition-root"
        data-effective-mode={effectiveMode}
        data-has-canvas={shouldRenderCanvas ? "true" : "false"}
        data-layout-axis="horizontal"
        data-chat-panel-placement={
          compactChatCanvasOverlay && effectiveMode === "chat-canvas"
            ? "overlay-right"
            : "inline"
        }
      >
        <CanvasPanel
          $visible={shouldRenderCanvas}
          $transform={canvasStyles.transform as string}
          $opacity={canvasStyles.opacity as number}
          $duration={parseInt(
            canvasStyles.transition?.match(/\d+/)?.[0] || "300",
          )}
        >
          {canvasContent}
          {shouldRenderCompactChatTrigger ? (
            <CompactChatTriggerSlot>
              <CompactRightDockButton
                icon={
                  <span className="inline-flex items-center gap-1.5">
                    <PanelRightOpen size={16} />
                    <MessageSquareText size={15} />
                  </span>
                }
                label="聊天区"
                badgeLabel="调度"
                ariaLabel="展开右侧聊天区"
                testId="layout-chat-overlay-trigger"
                onClick={handleOpenCompactChatPanel}
              />
            </CompactChatTriggerSlot>
          ) : null}
        </CanvasPanel>

        {compactChatCanvasOverlay ? (
          <CompactChatBackdrop
            type="button"
            aria-label="收起右侧聊天区遮罩"
            $visible={compactChatPanelOpen}
            onClick={() => setCompactChatPanelOpen(false)}
          />
        ) : null}

        <ChatPanel
          $width={chatStyles.width as string}
          $duration={parseInt(
            chatStyles.transition?.match(/\d+/)?.[0] || "300",
          )}
          $minWidth={
            effectiveMode === "chat-canvas"
              ? chatPanelMinWidth || "360px"
              : "0px"
          }
          $compactOverlay={
            compactChatCanvasOverlay && effectiveMode === "chat-canvas"
          }
          $compactOverlayOpen={compactChatPanelOpen}
          $hidden={effectiveMode === "canvas"}
          $chrome={chatPanelChrome}
          data-testid="layout-chat-panel"
          data-overlay-state={
            compactChatCanvasOverlay && effectiveMode === "chat-canvas"
              ? compactChatPanelOpen
                ? "open"
                : "closed"
              : "inline"
          }
        >
          {compactChatCanvasOverlay && effectiveMode === "chat-canvas" ? (
            <>
              <CompactRightDrawerHeader
                eyebrow="右侧聊天区"
                heading="调度记录"
                subtitle="输入与状态反馈"
                icon={<MessageSquareText size={14} />}
                actions={
                  <CompactRightDrawerIconButton
                    aria-label="收起右侧聊天区"
                    onClick={() => setCompactChatPanelOpen(false)}
                  >
                    <PanelRightClose size={16} />
                  </CompactRightDrawerIconButton>
                }
                data-testid="layout-chat-drawer-header"
              />
              <CompactChatBody>
                {chatPanelChrome === "plain" ? (
                  <PlainChatPanelInner data-testid="layout-chat-panel-plain">
                    {chatContent}
                  </PlainChatPanelInner>
                ) : (
                  <ChatPanelInner data-testid="layout-chat-panel-inner">
                    {chatContent}
                  </ChatPanelInner>
                )}
              </CompactChatBody>
            </>
          ) : chatPanelChrome === "plain" ? (
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
