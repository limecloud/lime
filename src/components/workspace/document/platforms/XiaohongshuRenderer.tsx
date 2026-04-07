/**
 * @file 小红书渲染器
 * @description 小红书笔记风格的文档渲染
 * @module components/workspace/document/platforms/XiaohongshuRenderer
 */

import React, { memo } from "react";
import styled from "styled-components";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  CoverImagePlaceholder,
  preprocessCoverImageUrls,
} from "./CoverImagePlaceholder";

interface XiaohongshuRendererProps {
  content: string;
}

const Container = styled.div`
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
  font-size: 16px;
  line-height: 2;
  color: #333;
  max-width: 100%;
  padding: 20px;
  background: #fff;

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    font-weight: bold;
    margin: 1em 0 0.5em;
    color: #333;
  }

  h1 {
    font-size: 20px;
  }
  h2 {
    font-size: 18px;
  }
  h3 {
    font-size: 17px;
  }

  p {
    margin: 0 0 1em;
  }

  ul,
  ol {
    margin: 0 0 1em;
    padding-left: 1.5em;
  }

  li {
    margin: 0.3em 0;
  }

  blockquote {
    margin: 1em 0;
    padding: 12px 16px;
    background: linear-gradient(135deg, #fff5f5 0%, #fff0f0 100%);
    border-radius: 12px;
    border: none;
    color: #666;

    p {
      margin: 0;
    }
  }

  code {
    padding: 2px 6px;
    background: #f5f5f5;
    border-radius: 4px;
    font-size: 14px;
  }

  pre {
    margin: 1em 0;
    padding: 12px;
    background: #f8f8f8;
    border-radius: 8px;
    overflow-x: auto;

    code {
      padding: 0;
      background: transparent;
    }
  }

  img {
    display: block;
    max-width: 100%;
    margin: 1em auto;
    border-radius: 12px;
  }

  a {
    color: #fe2c55;
    text-decoration: none;
  }

  strong {
    color: #fe2c55;
    font-weight: bold;
  }

  em {
    color: #999;
  }
  hr {
    margin: 1.5em 0;
    border: none;
    border-top: 1px solid #eee;
  }
`;

/* 话题标签高亮样式 */
const processContent = (content: string): string => {
  // 将 #话题# 格式转换为带样式的 span
  const withTags = content.replace(/#([^#\s]+)#/g, "**#$1#**");
  return preprocessCoverImageUrls(withTags);
};

/**
 * 小红书渲染器组件
 */
export const XiaohongshuRenderer: React.FC<XiaohongshuRendererProps> = memo(
  ({ content }) => {
    const processedContent = processContent(content);

    return (
      <Container>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            img({ src, alt }) {
              return <CoverImagePlaceholder src={src} alt={alt} />;
            },
          }}
        >
          {processedContent}
        </ReactMarkdown>
      </Container>
    );
  },
);

XiaohongshuRenderer.displayName = "XiaohongshuRenderer";
