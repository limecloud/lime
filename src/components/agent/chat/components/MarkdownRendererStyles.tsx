import styled from "styled-components";
import { CODE_THEME_TOKEN_CLASSES } from "@/lib/appearance/codeThemeTokens";

export const CODE_BLOCK_SURFACE = "var(--lime-code-surface, #ffffff)";
export const CODE_BLOCK_SURFACE_ACCENT = "none";
export const CODE_BLOCK_HEADER_SURFACE =
  "var(--lime-code-header-surface, #f7f7f7)";
export const CODE_BLOCK_BORDER = "var(--lime-code-border, #d9d9d9)";
export const CODE_BLOCK_HEADER_BORDER = "var(--lime-code-border, #d9d9d9)";
export const CODE_BLOCK_TEXT = "var(--lime-code-text, #0d0d0d)";
export const CODE_BLOCK_MUTED_TEXT = "var(--lime-code-muted, #666666)";
export const CODE_BLOCK_BUTTON_SURFACE =
  "var(--lime-code-button-surface, #f2f2f2)";
export const CODE_BLOCK_BUTTON_HOVER_SURFACE =
  "var(--lime-code-button-hover-surface, #e8e8e8)";
export const CODE_FONT_FAMILY =
  'var(--lime-code-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)';
export const CODE_FONT_SIZE = "var(--lime-code-font-size, 12px)";

const CODE_TOKEN_COLOR_RULES = CODE_THEME_TOKEN_CLASSES.map(
  (token) =>
    `.token.${token} { color: var(--lime-code-syntax-${token}, var(--lime-code-text, #0d0d0d)); }`,
).join("\n");

// 收紧正文与代码块表面，让消息正文更接近单列执行流的阅读节奏。
export const MarkdownContainer = styled.div`
  font-size: inherit;
  line-height: inherit;
  color: var(--lime-text, #1f2937);
  overflow-wrap: break-word;
  word-break: break-word;
  text-wrap: pretty;

  > :first-child {
    margin-top: 0;
  }

  > :last-child {
    margin-bottom: 0;
  }

  p {
    margin: 0 0 0.95em;
    color: inherit;
    font-size: 1em;
    line-height: inherit;
    font-weight: 400;
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    font-weight: 600;
    margin: 1.08em 0 0.5em;
    line-height: 1.42;
    letter-spacing: 0;
    color: var(--lime-text-strong, #111827);
  }

  h1:first-child,
  h2:first-child,
  h3:first-child {
    margin-top: 0;
  }

  h1 {
    font-size: 1.14em;
  }
  h2 {
    font-size: 1.08em;
  }
  h3 {
    font-size: 1.03em;
  }
  h4 {
    font-size: 1em;
  }
  h5,
  h6 {
    font-size: 0.98em;
  }

  ul,
  ol {
    padding-left: 1.28rem;
    margin: 0 0 0.95em;
  }

  ul {
    list-style-type: disc;
  }

  ol {
    list-style-type: decimal;
  }

  li {
    margin: 0.26em 0;
    padding-left: 0.08rem;
    color: inherit;
    font-weight: 400;
  }

  li > p {
    margin-bottom: 0.42em;
  }

  li::marker {
    color: hsl(var(--muted-foreground));
  }

  ul ul,
  ul ol,
  ol ul,
  ol ol {
    margin-top: 0.35em;
    margin-bottom: 0.45em;
  }

  strong {
    font-weight: 600;
    color: var(--lime-text-strong, #111827);
  }

  em {
    font-style: italic;
  }

  hr {
    margin: 18px 0;
    border: none;
    border-top: 1px solid hsl(var(--border));
    opacity: 0.9;
  }

  code[data-inline-code="true"] {
    font-family: ${CODE_FONT_FAMILY};
    font-size: 0.86em;
    line-height: 1.45;
    padding: 0.08rem 0.34rem;
    border-radius: 5px;
    border: 1px solid var(--lime-code-border, #d9d9d9);
    background-color: var(--lime-code-inline-surface, #f7f7f7);
    color: var(--lime-code-text, #0d0d0d);
  }

  pre {
    margin: 14px 0;
    padding: 10px 12px 12px;
    border-radius: 8px;
    overflow: auto;
    border: 1px solid var(--lime-code-border, #d9d9d9);
    background: var(--lime-code-surface, #ffffff);

    code {
      padding: 0;
      border: none;
      border-radius: 0;
      background: transparent;
      color: inherit;
    }
  }

  .token {
    color: var(--lime-code-text, #0d0d0d);
  }

  .token.italic {
    font-style: italic;
  }

  .token.bold,
  .token.important {
    font-weight: 700;
  }

  ${CODE_TOKEN_COLOR_RULES}

  table {
    border-collapse: separate;
    border-spacing: 0;
    width: 100%;
    min-width: 100%;
    margin: 0;
    font-size: 0.94em;
    table-layout: auto;
  }

  th,
  td {
    border-right: 1px solid var(--lime-surface-border, hsl(var(--border)));
    border-bottom: 1px solid var(--lime-surface-border, hsl(var(--border)));
    padding: 0.45rem 0.65rem;
    vertical-align: top;
    text-align: left;
  }

  th {
    font-weight: 600;
    background: var(--lime-surface-soft, #f8fafc);
    color: var(--lime-text-muted, #334155);
    white-space: nowrap;
  }

  tr > *:last-child {
    border-right: none;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  tbody tr:nth-child(even) td {
    background: var(--lime-surface-soft, hsl(var(--secondary) / 0.5));
  }

  a {
    color: var(--lime-brand, #2563eb);
    text-decoration: underline;
    text-underline-offset: 0.18em;
    text-decoration-color: color-mix(
      in srgb,
      var(--lime-brand, #2563eb) 32%,
      transparent
    );
    &:hover {
      text-decoration-color: currentColor;
    }
  }

  img {
    max-width: 100%;
    max-height: 512px;
    border-radius: 10px;
    object-fit: contain;
    cursor: pointer;
    border: 1px solid hsl(var(--border));
  }
`;

export const MarkdownDivider = styled.hr`
  height: 1px;
  margin: 22px 0;
  border: none;
  background: linear-gradient(
    90deg,
    transparent 0%,
    hsl(var(--border)) 16%,
    hsl(var(--border)) 84%,
    transparent 100%
  );
`;

export const MarkdownQuoteCard = styled.blockquote`
  margin: 0 0 0.95em;
  padding: 0;
  border: 1px solid var(--lime-surface-border-strong, hsl(var(--border)));
  border-radius: 20px;
  background: linear-gradient(
    180deg,
    var(--lime-surface, hsl(var(--background))) 0%,
    var(--lime-surface-soft, hsl(var(--secondary) / 0.5)) 100%
  );
  box-shadow: 0 14px 34px -30px rgba(15, 23, 42, 0.18);
  overflow: hidden;
`;

export const MarkdownQuoteInner = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
`;

export const MarkdownQuoteIconShell = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 999px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--muted-foreground));
`;

export const MarkdownQuoteBody = styled.div`
  min-width: 0;
  color: hsl(var(--foreground));

  p {
    margin-bottom: 0.55em;
  }

  p:last-child {
    margin-bottom: 0;
  }
`;

export const CodeBlockContainer = styled.div`
  position: relative;
  margin: 10px 0;
  max-width: 100%;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid ${CODE_BLOCK_BORDER};
  background-color: ${CODE_BLOCK_SURFACE};
  background-image: ${CODE_BLOCK_SURFACE_ACCENT};
  box-shadow: none;
`;

export const CodeHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 5px 8px 5px 10px;
  background: ${CODE_BLOCK_HEADER_SURFACE};
  color: ${CODE_BLOCK_MUTED_TEXT};
  font-family: ${CODE_FONT_FAMILY};
  font-size: 11.5px;
  letter-spacing: 0;
  text-transform: none;
  border-bottom: 1px solid ${CODE_BLOCK_HEADER_BORDER};

  > span:first-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const CodeHeaderInfo = styled.span`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
`;

export const CodeLanguageLabel = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${CODE_BLOCK_TEXT};
  font-weight: 600;
`;

export const CodeLineCount = styled.span`
  flex-shrink: 0;
  color: ${CODE_BLOCK_MUTED_TEXT};
`;

export const CopyButton = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 6px;
  border: 1px solid ${CODE_BLOCK_HEADER_BORDER};
  background: ${CODE_BLOCK_BUTTON_SURFACE};
  color: ${CODE_BLOCK_TEXT};
  font-family: inherit;
  font-size: 11px;
  letter-spacing: 0;
  text-transform: none;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease;

  &:hover {
    background: ${CODE_BLOCK_BUTTON_HOVER_SURFACE};
    border-color: var(--lime-code-border, #d9d9d9);
  }

  &:focus-visible {
    outline: 2px solid var(--lime-code-border, #d9d9d9);
    outline-offset: 1px;
  }
`;

export const MarkdownBlockShell = styled.div`
  position: relative;

  &:hover [data-markdown-block-actions],
  &:focus-within [data-markdown-block-actions] {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }
`;

export const MarkdownBlockActions = styled.div`
  position: absolute;
  top: -10px;
  right: 2px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
`;

export const MarkdownBlockActionButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid rgba(203, 213, 225, 0.92);
  background: rgba(255, 255, 255, 0.96);
  color: rgb(100, 116, 139);
  box-shadow: 0 8px 22px -18px rgba(15, 23, 42, 0.3);
  cursor: pointer;
  transition:
    color 0.16s ease,
    border-color 0.16s ease,
    background-color 0.16s ease,
    box-shadow 0.16s ease;

  &:hover {
    color: rgb(15, 23, 42);
    border-color: rgba(148, 163, 184, 0.9);
    background: rgba(255, 255, 255, 1);
    box-shadow: 0 10px 24px -18px rgba(15, 23, 42, 0.34);
  }

  &:focus-visible {
    outline: 2px solid rgba(148, 163, 184, 0.56);
    outline-offset: 1px;
  }
`;

export const MarkdownTableScroll = styled.div`
  margin: 0 0 0.82em;
  overflow-x: auto;
  border: 1px solid var(--lime-surface-border-strong, hsl(var(--border)));
  border-radius: 8px;
  background: var(--lime-surface, hsl(var(--background)));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
`;
