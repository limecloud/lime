/**
 * @file Markdown 渲染器
 * @description GitHub 风格的 Markdown 渲染
 * @module components/workspace/document/platforms/MarkdownRenderer
 */

import React, { memo } from "react";
import styled from "styled-components";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { CoverImagePlaceholder, preprocessCoverImageUrls } from "./CoverImagePlaceholder";

interface MarkdownRendererProps {
  content: string;
}

const Container = styled.div`
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.6;
  color: hsl(var(--foreground));

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    margin-top: 24px;
    margin-bottom: 16px;
    font-weight: 600;
    line-height: 1.25;
  }

  h1 {
    font-size: 2em;
    border-bottom: 1px solid hsl(var(--border));
    padding-bottom: 0.3em;
  }
  h2 {
    font-size: 1.5em;
    border-bottom: 1px solid hsl(var(--border));
    padding-bottom: 0.3em;
  }
  h3 {
    font-size: 1.25em;
  }
  h4 {
    font-size: 1em;
  }

  p {
    margin-top: 0;
    margin-bottom: 16px;
  }

  ul,
  ol {
    margin-top: 0;
    margin-bottom: 16px;
    padding-left: 2em;
  }

  li {
    margin-top: 4px;
  }
  li + li {
    margin-top: 4px;
  }

  blockquote {
    margin: 0 0 16px 0;
    padding: 0 1em;
    color: hsl(var(--muted-foreground));
    border-left: 4px solid hsl(var(--border));
  }

  code {
    padding: 0.2em 0.4em;
    margin: 0;
    font-size: 85%;
    background: hsl(var(--muted) / 0.5);
    border-radius: 4px;
    font-family: "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
  }

  pre {
    margin-top: 0;
    margin-bottom: 16px;
    padding: 16px;
    overflow: auto;
    font-size: 85%;
    line-height: 1.45;
    background: hsl(var(--muted) / 0.3);
    border-radius: 8px;

    code {
      padding: 0;
      margin: 0;
      font-size: 100%;
      background: transparent;
      border-radius: 0;
    }
  }

  table {
    width: 100%;
    margin-bottom: 16px;
    border-collapse: collapse;
    border-spacing: 0;
  }

  th,
  td {
    padding: 8px 12px;
    border: 1px solid hsl(var(--border));
  }

  th {
    font-weight: 600;
    background: hsl(var(--muted) / 0.3);
  }

  img {
    max-width: 100%;
    height: auto;
    border-radius: 8px;
  }
  a {
    color: hsl(var(--primary));
    text-decoration: none;
    &:hover {
      text-decoration: underline;
    }
  }
  hr {
    height: 1px;
    margin: 24px 0;
    background: hsl(var(--border));
    border: 0;
  }
`;

const CodeBlockWrapper = styled.div`
  position: relative;
  margin-bottom: 16px;
`;

const CopyButton = styled.button`
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px 8px;
  font-size: 12px;
  background: hsl(var(--muted));
  border: none;
  border-radius: 4px;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s;

  ${CodeBlockWrapper}:hover & {
    opacity: 1;
  }

  &:hover {
    background: hsl(var(--muted) / 0.8);
  }
`;

/**
 * Markdown 渲染器组件
 */
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = memo(
  ({ content }) => {
    const handleCopy = async (code: string) => {
      await navigator.clipboard.writeText(code);
    };

    const processedContent = preprocessCoverImageUrls(content);

    return (
      <Container>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            img({ src, alt }) {
              return <CoverImagePlaceholder src={src} alt={alt} />;
            },
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || "");
              const codeString = String(children).replace(/\n$/, "");

              if (match) {
                return (
                  <CodeBlockWrapper>
                    <SyntaxHighlighter
                      style={oneDark}
                      language={match[1]}
                      PreTag="div"
                    >
                      {codeString}
                    </SyntaxHighlighter>
                    <CopyButton onClick={() => handleCopy(codeString)}>
                      复制
                    </CopyButton>
                  </CodeBlockWrapper>
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
          {processedContent}
        </ReactMarkdown>
      </Container>
    );
  },
);

MarkdownRenderer.displayName = "MarkdownRenderer";
