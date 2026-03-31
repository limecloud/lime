/**
 * @file 微信公众号渲染器
 * @description 微信公众号风格的文档渲染
 * @module components/workspace/document/platforms/WechatRenderer
 */

import React, { memo } from "react";
import styled from "styled-components";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CoverImagePlaceholder, preprocessCoverImageUrls } from "./CoverImagePlaceholder";

interface WechatRendererProps {
  content: string;
}

const Container = styled.div`
  font-family: -apple-system, BlinkMacSystemFont, "Microsoft YaHei", sans-serif;
  font-size: 15px;
  line-height: 1.75;
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
    text-align: center;
    font-weight: bold;
    margin: 1.5em 0 1em;
    color: #333;
  }

  h1 {
    font-size: 22px;
  }
  h2 {
    font-size: 20px;
  }
  h3 {
    font-size: 18px;
  }

  p {
    margin: 0 0 1.5em;
    text-align: justify;
    text-indent: 2em;
  }

  ul,
  ol {
    margin: 0 0 1.5em 2em;
    padding: 0;
  }

  li {
    margin: 0.5em 0;
    text-indent: 0;
  }

  blockquote {
    margin: 1.5em 0;
    padding: 15px 20px;
    background: #f7f7f7;
    border-left: 4px solid #07c160;
    color: #666;
    font-style: italic;

    p {
      text-indent: 0;
      margin: 0;
    }
  }

  code {
    padding: 2px 6px;
    background: #f5f5f5;
    border-radius: 3px;
    font-family: Consolas, Monaco, monospace;
    font-size: 14px;
    color: #c7254e;
  }

  pre {
    margin: 1.5em 0;
    padding: 15px;
    background: #f5f5f5;
    border-radius: 4px;
    overflow-x: auto;

    code {
      padding: 0;
      background: transparent;
      color: #333;
    }
  }

  img {
    display: block;
    max-width: 100%;
    margin: 1.5em auto;
    border-radius: 4px;
  }

  /* 公众号不支持外链，转换为文字 */
  a {
    color: #576b95;
    text-decoration: none;
    border-bottom: 1px solid #576b95;
  }

  strong {
    color: #07c160;
  }
  em {
    color: #666;
  }
  hr {
    margin: 2em 0;
    border: none;
    border-top: 1px dashed #ddd;
  }
`;

/**
 * 微信公众号渲染器组件
 */
export const WechatRenderer: React.FC<WechatRendererProps> = memo(
  ({ content }) => {
    const processedContent = preprocessCoverImageUrls(content);
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

WechatRenderer.displayName = "WechatRenderer";
