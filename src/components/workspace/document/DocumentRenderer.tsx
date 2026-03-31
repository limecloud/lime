/**
 * @file 文档渲染器组件
 * @description 根据平台类型选择对应的渲染器，支持流式显示
 * @module components/workspace/document/DocumentRenderer
 */

import React, { memo, useState, useEffect, useRef, useCallback } from "react";
import styled, { keyframes } from "styled-components";
import type { DocumentRendererProps, PlatformType } from "./types";
import { MarkdownRenderer } from "./platforms/MarkdownRenderer";
import { WechatRenderer } from "./platforms/WechatRenderer";
import { XiaohongshuRenderer } from "./platforms/XiaohongshuRenderer";
import { ZhihuRenderer } from "./platforms/ZhihuRenderer";

const Container = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  background: hsl(var(--background));
`;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: hsl(var(--muted-foreground));
  font-size: 14px;
  gap: 8px;
`;

const EmptyIcon = styled.span`
  font-size: 48px;
  opacity: 0.5;
`;

const fadeIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const StreamingContainer = styled.div`
  animation: ${fadeIn} 0.2s ease-out;
`;

const StreamingCursor = styled.span`
  display: inline-block;
  width: 2px;
  height: 1em;
  background: hsl(var(--primary));
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: blink 1s step-end infinite;

  @keyframes blink {
    0%,
    50% {
      opacity: 1;
    }
    51%,
    100% {
      opacity: 0;
    }
  }
`;

/**
 * 根据平台类型获取渲染器
 */
const getRenderer = (platform: PlatformType, content: string) => {
  switch (platform) {
    case "wechat":
      return <WechatRenderer content={content} />;
    case "xiaohongshu":
      return <XiaohongshuRenderer content={content} />;
    case "zhihu":
      return <ZhihuRenderer content={content} />;
    case "markdown":
    default:
      return <MarkdownRenderer content={content} />;
  }
};

/**
 * 文档渲染器组件
 * 支持流式显示 - 按段落逐步显示内容
 */
export const DocumentRenderer: React.FC<DocumentRendererProps> = memo(
  ({ content, platform, isStreaming = false, onSelectionTextChange }) => {
    // 用于流式显示的状态
    const [displayContent, setDisplayContent] = useState(content);
    const prevContentRef = useRef(content);
    const containerRef = useRef<HTMLDivElement>(null);

    const notifySelection = useCallback(() => {
      if (!onSelectionTextChange) {
        return;
      }

      const container = containerRef.current;
      const selection = window.getSelection();
      if (!container || !selection) {
        onSelectionTextChange("");
        return;
      }

      const anchorNode = selection.anchorNode;
      const focusNode = selection.focusNode;
      const inContainer =
        (!!anchorNode && container.contains(anchorNode)) ||
        (!!focusNode && container.contains(focusNode));

      if (!inContainer) {
        onSelectionTextChange("");
        return;
      }

      const selectedText = selection.toString().trim();
      onSelectionTextChange(selectedText);
    }, [onSelectionTextChange]);

    useEffect(() => {
      if (!onSelectionTextChange) {
        return;
      }

      return () => {
        onSelectionTextChange("");
      };
    }, [onSelectionTextChange]);

    // 流式显示效果：当内容更新时，平滑过渡
    useEffect(() => {
      if (!isStreaming) {
        // 非流式模式，直接显示完整内容
        setDisplayContent(content);
        prevContentRef.current = content;
        return;
      }

      // 流式模式：检测内容变化
      if (content !== prevContentRef.current) {
        // 直接更新显示内容（一大段一大段显示）
        setDisplayContent(content);
        prevContentRef.current = content;

        // 自动滚动到底部
        if (containerRef.current) {
          requestAnimationFrame(() => {
            containerRef.current?.scrollTo({
              top: containerRef.current.scrollHeight,
              behavior: "smooth",
            });
          });
        }
      }
    }, [content, isStreaming]);

    if (!displayContent || displayContent.trim() === "") {
      return (
        <Container
          ref={containerRef}
          onMouseUp={notifySelection}
          onKeyUp={notifySelection}
        >
          <EmptyState>
            <EmptyIcon>📄</EmptyIcon>
            <span>暂无内容</span>
            <span>AI 生成的文档将在这里显示</span>
          </EmptyState>
        </Container>
      );
    }

    return (
      <Container
        ref={containerRef}
        onMouseUp={notifySelection}
        onKeyUp={notifySelection}
      >
        <StreamingContainer key={isStreaming ? "streaming" : "static"}>
          {getRenderer(platform, displayContent)}
          {isStreaming && <StreamingCursor />}
        </StreamingContainer>
      </Container>
    );
  },
);

DocumentRenderer.displayName = "DocumentRenderer";
