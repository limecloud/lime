/**
 * @file 知乎渲染器
 * @description 知乎专栏风格的文档渲染
 * @module components/workspace/document/platforms/ZhihuRenderer
 */

import React, { memo } from "react";
import styled from "styled-components";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

interface ZhihuRendererProps {
  content: string;
}

const Container = styled.div`
  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
  font-size: 16px;
  line-height: 1.8;
  color: #1a1a1a;
  max-width: 100%;
  padding: 24px;
  background: #fff;

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    font-weight: 600;
    margin: 1.5em 0 0.8em;
    color: #1a1a1a;
  }

  h1 {
    font-size: 24px;
  }
  h2 {
    font-size: 20px;
    border-bottom: 1px solid #eee;
    padding-bottom: 8px;
  }
  h3 {
    font-size: 18px;
  }

  p {
    margin: 0 0 1.2em;
  }

  ul,
  ol {
    margin: 0 0 1.2em;
    padding-left: 2em;
  }

  li {
    margin: 0.4em 0;
  }

  blockquote {
    margin: 1.2em 0;
    padding: 12px 20px;
    background: #f6f6f6;
    border-left: 3px solid #0084ff;
    color: #646464;

    p {
      margin: 0;
    }

    /* 引用来源格式 */
    cite {
      display: block;
      margin-top: 8px;
      font-size: 14px;
      color: #999;
      font-style: normal;

      &::before {
        content: "—— ";
      }
    }
  }

  code {
    padding: 2px 6px;
    background: #f6f6f6;
    border-radius: 3px;
    font-family: Menlo, Monaco, Consolas, monospace;
    font-size: 14px;
    color: #c7254e;
  }

  pre {
    margin: 1.2em 0;
    border-radius: 8px;
    overflow: hidden;

    code {
      padding: 0;
      background: transparent;
      color: inherit;
    }
  }

  img {
    display: block;
    max-width: 100%;
    margin: 1.2em auto;
    border-radius: 4px;
  }

  a {
    color: #0084ff;
    text-decoration: none;
    &:hover {
      text-decoration: underline;
    }
  }

  strong {
    color: #1a1a1a;
  }
  em {
    color: #646464;
  }
  hr {
    margin: 2em 0;
    border: none;
    border-top: 1px solid #eee;
  }

  table {
    width: 100%;
    margin: 1.2em 0;
    border-collapse: collapse;
  }

  th,
  td {
    padding: 10px 12px;
    border: 1px solid #e5e5e5;
    text-align: left;
  }

  th {
    background: #f6f6f6;
    font-weight: 600;
  }
`;

/**
 * 知乎渲染器组件
 */
export const ZhihuRenderer: React.FC<ZhihuRendererProps> = memo(
  ({ content }) => {
    return (
      <Container>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || "");
              const codeString = String(children).replace(/\n$/, "");

              if (match) {
                return (
                  <SyntaxHighlighter
                    style={vscDarkPlus}
                    language={match[1]}
                    PreTag="div"
                  >
                    {codeString}
                  </SyntaxHighlighter>
                );
              }
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </Container>
    );
  },
);

ZhihuRenderer.displayName = "ZhihuRenderer";
