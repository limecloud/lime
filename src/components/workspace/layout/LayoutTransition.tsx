/**
 * @file 布局过渡组件
 * @description 处理对话和画布之间的布局切换动画
 * @module components/workspace/layout/LayoutTransition
 */

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { UnifiedTabStrip } from "@/components/app-shell/AppShell";
import { HeaderToolbar } from "@/components/app-shell/HeaderToolbar";
import { SidePanelActivationContext } from "@/components/app-shell/unifiedTabStripContext";
import { LayoutMode } from "@/lib/workspace/workflowTypes";
import { useLayoutTransition, TransitionConfig } from "./useLayoutTransition";
import { getDefaultContentPaneWidth } from "./contentPaneWidth";

const COMPACT_CHAT_CANVAS_CONTAINER_WIDTH = 900;
const COMPACT_CHAT_CANVAS_BREAKPOINT_HEIGHT = 620;
const CHAT_CANVAS_RESIZE_MIN_CHAT_WIDTH = 320;
const CHAT_CANVAS_RESIZE_MIN_CANVAS_WIDTH = 320;

function shouldUseCompactChatCanvasLayout(
  mode: LayoutMode,
  containerWidth?: number,
): boolean {
  if (mode !== "chat-canvas" || typeof window === "undefined") {
    return false;
  }

  const availableWidth =
    typeof containerWidth === "number" && containerWidth > 0
      ? containerWidth
      : window.innerWidth;

  return (
    availableWidth <= COMPACT_CHAT_CANVAS_CONTAINER_WIDTH ||
    window.innerHeight <= COMPACT_CHAT_CANVAS_BREAKPOINT_HEIGHT
  );
}

const Container = styled.div`
  display: flex;
  position: relative;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`;

const PanelViewport = styled.div<{ $compactSinglePanel: boolean }>`
  position: relative;
  display: flex;
  flex-direction: row;
  flex: 1;
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  gap: ${({ $compactSinglePanel }) => ($compactSinglePanel ? "0" : "12px")};
`;

const SplitResizeHandle = styled.div<{ $dragging: boolean }>`
  position: relative;
  z-index: 12;
  flex: 0 0 10px;
  align-self: stretch;
  margin: 0 -6px;
  cursor: col-resize;
  touch-action: none;
  user-select: none;

  &::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 1px;
    transform: translateX(-50%);
    background: ${({ $dragging }) =>
      $dragging
        ? "var(--lime-surface-border-strong, #bbf7d0)"
        : "var(--lime-surface-border, rgba(226, 240, 226, 0.94))"};
  }

  &::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 4px;
    height: 52px;
    border-radius: 999px;
    transform: translate(-50%, -50%);
    background: ${({ $dragging }) =>
      $dragging ? "var(--lime-brand-soft, #ecfdf5)" : "transparent"};
  }

  &:hover::before {
    background: var(--lime-surface-border-strong, #bbf7d0);
  }

  &:hover::after {
    background: var(--lime-brand-soft, #ecfdf5);
  }

  &:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: -2px;
  }
`;

const ChatPanel = styled.div<{
  $width: string;
  $duration: number;
  $minWidth: string;
  $compactSinglePanel: boolean;
  $hidden: boolean;
}>`
  position: relative;
  height: ${({ $hidden }) => ($hidden ? "0" : "100%")};
  max-height: ${({ $hidden }) => ($hidden ? "0" : "100%")};
  overflow: hidden;
  transition:
    width ${({ $duration }) => $duration}ms ease-out,
    height ${({ $duration }) => $duration}ms ease-out;
  width: ${({ $compactSinglePanel, $width, $hidden }) =>
    $hidden ? "0" : $compactSinglePanel ? "100%" : $width};
  min-width: ${({ $compactSinglePanel, $minWidth }) =>
    $compactSinglePanel ? "0" : $minWidth};
  min-height: ${({ $hidden }) => ($hidden ? "0" : "100%")};
  flex: ${({ $compactSinglePanel, $hidden }) =>
    $hidden ? "0 0 0" : $compactSinglePanel ? "1 1 100%" : "0 0 auto"};
  will-change: width, height;
  display: ${({ $hidden }) => ($hidden ? "none" : "flex")};
  flex-direction: column;
  padding: 0;
`;

const ChatPanelInner = styled.div`
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
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
  box-sizing: border-box;
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
  mainToolbar?: React.ReactNode;
  sidePanelTabStrip?: React.ReactNode;
  mainTabLabel?: string;
  /** chat-canvas 模式下聊天面板宽度 */
  chatPanelWidth?: string;
  contentPaneDefaultWidth?: number;
  /** 紧凑单面板态下强制切回聊天区 */
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
    mainToolbar,
    sidePanelTabStrip,
    mainTabLabel,
    chatPanelWidth,
    contentPaneDefaultWidth,
    forceOpenChatPanel = false,
  }) => {
    const { t } = useTranslation("workspace");
    const containerRef = useRef<HTMLDivElement | null>(null);
    const chatPanelRef = useRef<HTMLDivElement>(null);
    const canvasPanelRef = useRef<HTMLDivElement>(null);
    const [paneBounds, setPaneBounds] = useState<{
      end: number;
      contentWidth: number;
      totalWidth: number;
      shellHeight: number;
      gap: number;
    }>();
    const lastChatFocus = useRef<HTMLElement | null>(null);
    const id = useId();
    const mainTabId = `${id}-chat-tab`;
    const mainTabPanelId = `${id}-chat-panel`;
    const canvasTabId = `${id}-canvas-tab`;
    const canvasPanelId = `${id}-canvas-panel`;
    const resizingChatPanelRef = useRef<{
      pointerId: number;
      startX: number;
      startWidth: number;
      didMove: boolean;
    } | null>(null);
    const [resizedChatPanelWidth, setResizedChatPanelWidth] = useState<
      number | null
    >(null);
    const [resizingChatPanel, setResizingChatPanel] = useState(false);
    const hasCanvasContent = React.Children.count(canvasContent) > 0;
    const hasSidePanelTabs = React.Children.count(sidePanelTabStrip) > 0;
    const effectiveMode: LayoutMode = hasCanvasContent ? mode : "chat";
    const effectiveChatPanelWidth = useMemo(
      () =>
        resizedChatPanelWidth !== null && effectiveMode === "chat-canvas"
          ? `${resizedChatPanelWidth}px`
          : contentPaneDefaultWidth !== undefined && paneBounds?.totalWidth
            ? `${Math.max(320, paneBounds.totalWidth - paneBounds.gap - getDefaultContentPaneWidth(paneBounds.totalWidth, paneBounds.shellHeight, contentPaneDefaultWidth))}px`
            : chatPanelWidth,
      [
        chatPanelWidth,
        contentPaneDefaultWidth,
        paneBounds,
        effectiveMode,
        resizedChatPanelWidth,
      ],
    );
    const { isCanvasVisible, getTransitionStyles } = useLayoutTransition(
      effectiveMode,
      transitionConfig,
      {
        chatCanvasPanelWidth: effectiveChatPanelWidth,
      },
    );
    const [compactChatCanvasLayout, setCompactChatCanvasLayout] = useState(() =>
      shouldUseCompactChatCanvasLayout(effectiveMode),
    );
    const [compactPrimaryPanel, setCompactPrimaryPanel] = useState<
      "chat" | "canvas"
    >(effectiveMode === "canvas" ? "canvas" : "chat");
    const [fullWidthRequested, setFullWidthRequested] = useState(false);
    const activateSidePanel = useCallback(
      () => setCompactPrimaryPanel("canvas"),
      [],
    );

    const chatStyles = getTransitionStyles("chat");
    const canvasStyles = getTransitionStyles("canvas");
    const resolvedChatPanelMinWidth =
      effectiveMode === "chat-canvas"
        ? `${CHAT_CANVAS_RESIZE_MIN_CHAT_WIDTH}px`
        : "0px";
    const shouldRenderCanvas = hasCanvasContent && isCanvasVisible;
    const isCompactChatCanvas =
      effectiveMode === "canvas" ||
      (effectiveMode === "chat-canvas" &&
        (compactChatCanvasLayout || fullWidthRequested));
    const handleContentTabDoubleClick = useCallback(
      (tabId: string) => {
        setFullWidthRequested(!isCompactChatCanvas);
        setCompactPrimaryPanel(tabId === mainTabId ? "chat" : "canvas");
      },
      [isCompactChatCanvas, mainTabId],
    );
    const chatHidden =
      (effectiveMode === "canvas" && compactPrimaryPanel !== "chat") ||
      (isCompactChatCanvas && compactPrimaryPanel !== "chat");
    const canvasHidden =
      effectiveMode === "chat" ||
      !shouldRenderCanvas ||
      (effectiveMode === "canvas" && compactPrimaryPanel === "chat") ||
      (isCompactChatCanvas && compactPrimaryPanel !== "canvas");
    const wasChatHidden = useRef(chatHidden);
    const wasCompactChatCanvas = useRef(isCompactChatCanvas);
    useLayoutEffect(() => {
      if (
        wasChatHidden.current === chatHidden &&
        wasCompactChatCanvas.current === isCompactChatCanvas
      )
        return;
      wasChatHidden.current = chatHidden;
      wasCompactChatCanvas.current = isCompactChatCanvas;
      if (chatHidden) {
        if (
          document.activeElement === lastChatFocus.current ||
          document.activeElement === document.body
        ) {
          document.getElementById(mainTabId)?.focus({ preventScroll: true });
        }
      } else {
        const active = document.activeElement;
        const tab = document.getElementById(mainTabId);
        if (
          active === document.body ||
          active === tab ||
          tab?.closest("[data-app-shell-unified-tab-strip]")?.contains(active)
        ) {
          const target = lastChatFocus.current?.isConnected
            ? lastChatFocus.current
            : chatPanelRef.current?.querySelector<HTMLElement>(
                '[contenteditable="true"], textarea, input, button, [tabindex="0"]',
              );
          target?.focus({ preventScroll: true });
        }
      }
    }, [chatHidden, isCompactChatCanvas, mainTabId]);
    const shouldRenderResizeHandle =
      effectiveMode === "chat-canvas" &&
      shouldRenderCanvas &&
      !isCompactChatCanvas;

    useLayoutEffect(() => {
      const container = containerRef.current;
      const canvas = canvasPanelRef.current;
      if (!container || !canvas || isCompactChatCanvas) return;
      const measure = () => {
        const rect = container.getBoundingClientRect();
        const next = {
          end: rect.left + canvas.offsetLeft,
          contentWidth: canvas.getBoundingClientRect().width,
          totalWidth: rect.width,
          shellHeight: window.innerHeight,
          gap: Math.max(
            0,
            canvas.offsetLeft - (chatPanelRef.current?.offsetWidth ?? 0),
          ),
        };
        setPaneBounds((current) =>
          current?.end === next.end &&
          current.contentWidth === next.contentWidth &&
          current.totalWidth === next.totalWidth &&
          current.shellHeight === next.shellHeight &&
          current.gap === next.gap
            ? current
            : next,
        );
      };
      measure();
      const observer =
        typeof ResizeObserver === "undefined"
          ? null
          : new ResizeObserver(measure);
      observer?.observe(container);
      if (chatPanelRef.current) observer?.observe(chatPanelRef.current);
      window.addEventListener("resize", measure);
      return () => {
        observer?.disconnect();
        window.removeEventListener("resize", measure);
      };
    }, [isCompactChatCanvas, shouldRenderCanvas, chatStyles.width]);

    const resolveConstrainedChatWidth = useCallback((clientX: number) => {
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) {
        return null;
      }
      const maxWidth = Math.max(
        CHAT_CANVAS_RESIZE_MIN_CHAT_WIDTH,
        containerRect.width -
          CHAT_CANVAS_RESIZE_MIN_CANVAS_WIDTH -
          Math.max(
            0,
            (canvasPanelRef.current?.offsetLeft ?? 0) -
              (chatPanelRef.current?.offsetWidth ?? 0),
          ),
      );
      return Math.min(
        Math.max(
          clientX - containerRect.left,
          CHAT_CANVAS_RESIZE_MIN_CHAT_WIDTH,
        ),
        maxWidth,
      );
    }, []);

    const handleResizeKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect || !chatPanelRef.current) return;
        const width = chatPanelRef.current.getBoundingClientRect().width;
        const next =
          event.key === "Home"
            ? rect.right
            : event.key === "End"
              ? rect.left
              : event.key === "ArrowRight"
                ? rect.left + width + 10
                : event.key === "ArrowLeft"
                  ? rect.left + width - 10
                  : null;
        if (next === null) return;
        const constrained = resolveConstrainedChatWidth(next);
        if (constrained === null) return;
        event.preventDefault();
        event.stopPropagation();
        setResizedChatPanelWidth(constrained);
      },
      [resolveConstrainedChatWidth],
    );

    const handleResizePointerDown = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (
          event.button !== 0 ||
          resizingChatPanelRef.current ||
          !chatPanelRef.current
        )
          return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        resizingChatPanelRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: chatPanelRef.current.getBoundingClientRect().width,
          didMove: false,
        };
        setResizingChatPanel(true);
      },
      [],
    );

    const handleResizePointerMove = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = resizingChatPanelRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const left = containerRef.current?.getBoundingClientRect().left ?? 0;
        drag.didMove ||= event.clientX !== drag.startX;
        const nextWidth = resolveConstrainedChatWidth(
          left + drag.startWidth + event.clientX - drag.startX,
        );
        if (nextWidth !== null) {
          setResizedChatPanelWidth(nextWidth);
        }
      },
      [resolveConstrainedChatWidth],
    );

    const handleResizePointerEnd = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = resizingChatPanelRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (drag.didMove && event.type === "pointerup")
          handleResizePointerMove(event);
        resizingChatPanelRef.current = null;
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }
        setResizingChatPanel(false);
      },
      [handleResizePointerMove],
    );

    useEffect(() => {
      if (effectiveMode !== "chat-canvas" || compactChatCanvasLayout) {
        resizingChatPanelRef.current = null;
        setResizingChatPanel(false);
      }
    }, [compactChatCanvasLayout, effectiveMode]);

    useEffect(() => {
      if (effectiveMode === "chat") setFullWidthRequested(false);
    }, [effectiveMode]);

    useEffect(() => {
      const updateLayout = (containerWidth?: number) => {
        setCompactChatCanvasLayout(
          shouldUseCompactChatCanvasLayout(effectiveMode, containerWidth),
        );
      };

      if (typeof window === "undefined") {
        return;
      }

      const updateFromWindow = () => {
        const containerWidth =
          containerRef.current?.getBoundingClientRect().width;
        updateLayout(containerWidth);
      };
      updateFromWindow();
      window.addEventListener("resize", updateFromWindow);

      const container = containerRef.current;
      const resizeObserver =
        container && typeof ResizeObserver !== "undefined"
          ? new ResizeObserver((entries) => {
              const observedWidth = entries[0]?.contentRect.width;
              updateLayout(observedWidth);
            })
          : null;
      if (container && resizeObserver) {
        resizeObserver.observe(container);
      }

      return () => {
        window.removeEventListener("resize", updateFromWindow);
        resizeObserver?.disconnect();
      };
    }, [effectiveMode]);

    useLayoutEffect(() => {
      if (effectiveMode === "canvas") {
        setCompactPrimaryPanel("canvas");
      } else if (compactChatCanvasLayout && !hasSidePanelTabs) {
        setCompactPrimaryPanel("chat");
      }
    }, [effectiveMode, compactChatCanvasLayout, hasSidePanelTabs]);

    useEffect(() => {
      if (!forceOpenChatPanel || !isCompactChatCanvas) {
        return;
      }

      setCompactPrimaryPanel("chat");
    }, [forceOpenChatPanel, isCompactChatCanvas]);

    const canvasPanelNode = (
      <CanvasPanel
        ref={canvasPanelRef}
        $visible={
          shouldRenderCanvas &&
          (!isCompactChatCanvas || compactPrimaryPanel === "canvas")
        }
        $transform={canvasStyles.transform as string}
        $opacity={canvasStyles.opacity as number}
        $duration={parseInt(
          canvasStyles.transition?.match(/\d+/)?.[0] || "300",
        )}
        data-testid="layout-canvas-panel"
        id={sidePanelTabStrip ? undefined : canvasPanelId}
        role={sidePanelTabStrip ? undefined : "tabpanel"}
        aria-labelledby={sidePanelTabStrip ? undefined : canvasTabId}
        aria-hidden={canvasHidden}
        {...(canvasHidden ? { inert: "" } : {})}
      >
        {canvasContent}
      </CanvasPanel>
    );

    const chatPanelNode = (
      <ChatPanel
        $width={
          effectiveMode === "canvas" && !chatHidden
            ? "100%"
            : (chatStyles.width as string)
        }
        $duration={parseInt(chatStyles.transition?.match(/\d+/)?.[0] || "300")}
        $minWidth={resolvedChatPanelMinWidth}
        $compactSinglePanel={isCompactChatCanvas}
        $hidden={chatHidden}
        style={{
          maxWidth: shouldRenderResizeHandle
            ? `calc(100% - ${CHAT_CANVAS_RESIZE_MIN_CANVAS_WIDTH}px - ${paneBounds?.gap ?? 0}px)`
            : undefined,
        }}
        data-testid="layout-chat-panel"
        ref={chatPanelRef}
        id={mainTabPanelId}
        role="tabpanel"
        aria-labelledby={mainTabId}
        aria-hidden={chatHidden}
        {...(chatHidden ? { inert: "" } : {})}
        onFocusCapture={(event) => {
          lastChatFocus.current = event.target as HTMLElement;
        }}
        data-chat-panel-width={chatStyles.width as string}
        data-chat-panel-min-width={resolvedChatPanelMinWidth}
        data-overlay-state={
          isCompactChatCanvas
            ? compactPrimaryPanel === "chat"
              ? "single-active"
              : "single-hidden"
            : "inline"
        }
      >
        <ChatPanelInner data-testid="layout-chat-panel-inner">
          {chatContent}
        </ChatPanelInner>
      </ChatPanel>
    );

    return (
      <Container
        ref={containerRef}
        data-testid="layout-transition-root"
        data-effective-mode={effectiveMode}
        data-has-canvas={shouldRenderCanvas ? "true" : "false"}
        data-layout-axis={isCompactChatCanvas ? "single" : "horizontal"}
        data-chat-panel-placement={
          isCompactChatCanvas ? "single-panel" : "inline"
        }
        data-compact-primary-panel={
          isCompactChatCanvas ? compactPrimaryPanel : undefined
        }
      >
        <UnifiedTabStrip
          mode={isCompactChatCanvas ? "full" : "split"}
          isVisible={effectiveMode !== "chat"}
          desktopPlacement="titlebar"
          mainTabId={mainTabId}
          mainTabPanelId={mainTabPanelId}
          sidePanelActive={!canvasHidden}
          mainPaneEnd={paneBounds?.end}
          onContentTabDoubleClick={handleContentTabDoubleClick}
          mainToolbar={
            <div
              id={!isCompactChatCanvas ? mainTabId : undefined}
              className="h-full min-w-0 flex-1"
            >
              {mainToolbar ?? (
                <HeaderToolbar>
                  {mainTabLabel ?? t("workspace.layout.compactMode.chat")}
                </HeaderToolbar>
              )}
            </div>
          }
          sidePanelTabStrip={
            <div
              className="flex h-full min-w-0 items-center"
              onClickCapture={(event) => {
                if ((event.target as Element).closest('[role="tab"]'))
                  setCompactPrimaryPanel("canvas");
              }}
            >
              {sidePanelTabStrip ? (
                <SidePanelActivationContext.Provider value={activateSidePanel}>
                  {sidePanelTabStrip}
                </SidePanelActivationContext.Provider>
              ) : (
                <button
                  type="button"
                  role="tab"
                  data-testid="layout-content-tab"
                  id={canvasTabId}
                  aria-controls={canvasPanelId}
                  aria-selected={!canvasHidden}
                  tabIndex={canvasHidden ? -1 : 0}
                  onClick={() => setCompactPrimaryPanel("canvas")}
                  className="h-8 truncate rounded-lg px-3 text-xs text-[color:var(--lime-text-strong)] hover:bg-[color:var(--lime-chrome-tab-hover)]"
                >
                  {t("workspace.layout.compactMode.workbench")}
                </button>
              )}
            </div>
          }
        >
          {isCompactChatCanvas ? (
            <button
              type="button"
              role="tab"
              data-testid="layout-main-tab"
              id={mainTabId}
              aria-controls={mainTabPanelId}
              aria-selected={!chatHidden}
              tabIndex={chatHidden ? -1 : 0}
              onClick={() => setCompactPrimaryPanel("chat")}
              className="h-8 max-w-64 shrink-0 truncate rounded-lg px-3 text-xs text-[color:var(--lime-text-strong)] hover:bg-[color:var(--lime-chrome-tab-hover)]"
            >
              {mainTabLabel ?? t("workspace.layout.compactMode.chat")}
            </button>
          ) : null}
        </UnifiedTabStrip>
        <PanelViewport
          $compactSinglePanel={isCompactChatCanvas}
          data-testid="layout-panel-viewport"
        >
          {chatPanelNode}
          {shouldRenderResizeHandle ? (
            <SplitResizeHandle
              role="separator"
              aria-orientation="vertical"
              aria-label={t("workspace.layout.splitter.resizeAria")}
              aria-valuemin={CHAT_CANVAS_RESIZE_MIN_CANVAS_WIDTH}
              aria-valuemax={
                paneBounds && paneBounds.totalWidth > 0
                  ? Math.max(
                      CHAT_CANVAS_RESIZE_MIN_CANVAS_WIDTH,
                      paneBounds.totalWidth -
                        paneBounds.gap -
                        CHAT_CANVAS_RESIZE_MIN_CHAT_WIDTH,
                    )
                  : undefined
              }
              aria-valuenow={
                paneBounds && paneBounds.totalWidth > 0
                  ? paneBounds.contentWidth
                  : undefined
              }
              tabIndex={0}
              onKeyDown={handleResizeKeyDown}
              $dragging={resizingChatPanel}
              data-testid="layout-chat-canvas-resize-handle"
              data-dragging={resizingChatPanel ? "true" : "false"}
              onPointerDown={handleResizePointerDown}
              onPointerMove={handleResizePointerMove}
              onPointerUp={handleResizePointerEnd}
              onPointerCancel={handleResizePointerEnd}
              onLostPointerCapture={handleResizePointerEnd}
              onDoubleClick={(event) => {
                event.preventDefault();
                resizingChatPanelRef.current = null;
                setResizingChatPanel(false);
                setResizedChatPanelWidth(null);
              }}
            />
          ) : null}
          {canvasPanelNode}
        </PanelViewport>
      </Container>
    );
  },
);

LayoutTransition.displayName = "LayoutTransition";
