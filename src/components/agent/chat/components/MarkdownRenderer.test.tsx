import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownRenderer } from "./MarkdownRenderer";

vi.mock("react-syntax-highlighter", () => ({
  Prism: ({
    children,
    language,
    className,
    customStyle,
    codeTagProps,
  }: {
    children: React.ReactNode;
    language?: string;
    className?: string;
    customStyle?: React.CSSProperties;
    codeTagProps?: {
      style?: React.CSSProperties;
    };
  }) => (
    <pre
      data-testid="syntax-highlighter"
      data-language={language}
      className={className}
      data-font-family={customStyle?.fontFamily}
      data-text-shadow={customStyle?.textShadow}
      data-font-ligatures={String(codeTagProps?.style?.fontVariantLigatures)}
    >
      <code
        data-testid="syntax-highlighter-code"
        data-inline-code={String((codeTagProps as any)?.["data-inline-code"])}
        data-display={codeTagProps?.style?.display}
        data-padding={String(codeTagProps?.style?.padding)}
        data-border={String(codeTagProps?.style?.border)}
        data-border-radius={String(codeTagProps?.style?.borderRadius)}
        data-background={String(codeTagProps?.style?.background)}
        data-color={String(codeTagProps?.style?.color)}
      >
        {children}
      </code>
    </pre>
  ),
}));

vi.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({
  oneDark: {},
}));

vi.mock("./ArtifactPlaceholder", () => ({
  ArtifactPlaceholder: ({ language }: { language: string }) => (
    <div data-testid="artifact-placeholder">{language}</div>
  ),
}));

vi.mock("./A2UITaskCard", () => ({
  A2UITaskCard: () => <div data-testid="a2ui-task-card" />,
  A2UITaskLoadingCard: () => <div data-testid="a2ui-task-loading-card" />,
}));

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
}

interface RenderOptions {
  isStreaming?: boolean;
  collapseCodeBlocks?: boolean;
  shouldCollapseCodeBlock?: (language: string, code: string) => boolean;
  showBlockActions?: boolean;
  onQuoteContent?: (content: string) => void;
}

const mountedRoots: MountedHarness[] = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.useRealTimers();
  vi.clearAllMocks();
});

function render(
  content: string,
  {
    isStreaming = false,
    collapseCodeBlocks = false,
    shouldCollapseCodeBlock,
    showBlockActions = false,
    onQuoteContent,
  }: RenderOptions = {},
): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <MarkdownRenderer
        content={content}
        isStreaming={isStreaming}
        collapseCodeBlocks={collapseCodeBlocks}
        shouldCollapseCodeBlock={shouldCollapseCodeBlock}
        showBlockActions={showBlockActions}
        onQuoteContent={onQuoteContent}
      />,
    );
  });

  mountedRoots.push({ container, root });
  return container;
}

function renderHarness(
  content: string,
  {
    isStreaming = false,
    collapseCodeBlocks = false,
    shouldCollapseCodeBlock,
    showBlockActions = false,
    onQuoteContent,
  }: RenderOptions = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const rerender = (
    nextContent: string,
    {
      isStreaming: nextIsStreaming = isStreaming,
      collapseCodeBlocks: nextCollapseCodeBlocks = collapseCodeBlocks,
      shouldCollapseCodeBlock: nextShouldCollapseCodeBlock =
        shouldCollapseCodeBlock,
      showBlockActions: nextShowBlockActions = showBlockActions,
      onQuoteContent: nextOnQuoteContent = onQuoteContent,
    }: RenderOptions = {},
  ) => {
    act(() => {
      root.render(
        <MarkdownRenderer
          content={nextContent}
          isStreaming={nextIsStreaming}
          collapseCodeBlocks={nextCollapseCodeBlocks}
          shouldCollapseCodeBlock={nextShouldCollapseCodeBlock}
          showBlockActions={nextShowBlockActions}
          onQuoteContent={nextOnQuoteContent}
        />,
      );
    });
  };

  rerender(content, {
    isStreaming,
    collapseCodeBlocks,
    shouldCollapseCodeBlock,
    showBlockActions,
    onQuoteContent,
  });

  mountedRoots.push({ container, root });
  return { container, rerender };
}

describe("MarkdownRenderer", () => {
  it("代码块复制按钮应使用中文文案并反馈复制状态", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText,
      },
    });

    const content = ["```bash", "echo hello", "```"].join("\n");
    const container = render(content);
    const button = container.querySelector("button");

    expect(button).not.toBeNull();
    expect(button?.textContent).toContain("复制");

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(writeText).toHaveBeenCalledWith("echo hello");
    expect(container.querySelector("button")?.textContent).toContain("已复制");

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(container.querySelector("button")?.textContent).toContain("复制");
  });

  it("输出内容区块应支持复制与引用按钮", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const onQuoteContent = vi.fn();
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText,
      },
    });

    const container = render("第一段输出\n\n第二段输出", {
      showBlockActions: true,
      onQuoteContent,
    });

    const quoteButton = container.querySelector(
      'button[aria-label="引用内容区块"]',
    );
    const copyButton = container.querySelector(
      'button[aria-label="复制内容区块"]',
    );

    expect(quoteButton).not.toBeNull();
    expect(copyButton).not.toBeNull();

    await act(async () => {
      quoteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onQuoteContent).toHaveBeenCalledWith("第一段输出\n\n第二段输出");

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(writeText).toHaveBeenCalledWith("第一段输出\n\n第二段输出");
  });

  it("base64 图片说明文案应保持精简中文", () => {
    const content = "![示例图](data:image/png;base64,ZmFrZQ==)";

    const container = render(content);

    expect(container.textContent).toContain("图片 · 点击查看大图");
  });

  it("Markdown 表格应包裹在横向滚动容器中，避免窄列压缩", () => {
    const content = [
      "| 模块 | 输入 | 输出 | 备注 |",
      "| --- | --- | --- | --- |",
      "| Browser Runtime | 页面信息 | 结构化摘要 | 主链 |",
    ].join("\n");

    const container = render(content);
    const tableScroll = container.querySelector(
      '[data-testid="markdown-table-scroll"]',
    );

    expect(tableScroll).not.toBeNull();
    expect(tableScroll?.querySelector("table")).not.toBeNull();
    expect(container.textContent).toContain("Browser Runtime");
  });

  it("长文报告块应渲染标题层级、引用卡与分隔线", () => {
    const content = [
      "# Hermes Engine 选型建议",
      "",
      "这是导语段，用来概括结论与适用范围。",
      "",
      "## 为什么优先考虑它",
      "",
      "> 结论先行：优先保证稳定交付，再谈极限性能。",
      "",
      "---",
      "",
      "### 对比表",
      "",
      "| 方案 | 优势 |",
      "| --- | --- |",
      "| A | 稳定 |",
    ].join("\n");

    const container = render(content);

    expect(
      container.querySelector('h1[data-markdown-heading-level="1"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('h2[data-markdown-heading-level="2"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="markdown-blockquote-card"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="markdown-divider"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="markdown-table-scroll"]'),
    ).not.toBeNull();
  });

  it("非流式时应保留 raw html 渲染能力", () => {
    const content = [
      "前置文本",
      "",
      '<div class="rendered-html">原始 HTML</div>',
      "",
      "后置文本",
    ].join("\n");

    const container = render(content);

    expect(container.querySelector(".rendered-html")).not.toBeNull();
    expect(container.textContent).toContain("原始 HTML");
  });

  it("大段流式输出时应跳过 raw html 重解析", () => {
    const content = [
      "A".repeat(2_200),
      "",
      '<div class="rendered-html">原始 HTML</div>',
      "",
      "结尾文本",
    ].join("\n");

    const container = render(content, { isStreaming: true });

    expect(container.querySelector(".rendered-html")).toBeNull();
    expect(container.textContent).toContain("结尾文本");
  });

  it("流式结束后应立即恢复完整 raw html 渲染", () => {
    vi.useFakeTimers();
    const content = [
      "A".repeat(2_200),
      "",
      '<div class="rendered-html">原始 HTML</div>',
      "",
      "结尾文本",
    ].join("\n");

    const { container, rerender } = renderHarness(content, {
      isStreaming: true,
    });
    expect(container.querySelector(".rendered-html")).toBeNull();

    rerender(content, { isStreaming: false });
    expect(container.querySelector(".rendered-html")).not.toBeNull();
  });

  it("持续流式输出时应周期性刷新正文，而不是等到停止后才一起出现", () => {
    vi.useFakeTimers();
    const { container, rerender } = renderHarness("第一行", {
      isStreaming: true,
    });

    act(() => {
      vi.advanceTimersByTime(10);
    });
    rerender("第一行\n第二行", { isStreaming: true });

    act(() => {
      vi.advanceTimersByTime(10);
    });
    rerender("第一行\n第二行\n第三行", { isStreaming: true });

    act(() => {
      vi.advanceTimersByTime(10);
    });
    rerender("第一行\n第二行\n第三行\n第四行", { isStreaming: true });

    act(() => {
      vi.advanceTimersByTime(8);
    });

    expect(container.textContent).toContain("第三行");
    expect(container.textContent).not.toBe("第一行");
  });

  it("逐块判定返回 false 时应保持对话内联代码渲染", () => {
    const shouldCollapseCodeBlock = vi.fn(() => false);
    const content = ["```ts", "const answer = 42;", "```"].join("\n");

    const container = render(content, {
      collapseCodeBlocks: true,
      shouldCollapseCodeBlock,
    });

    expect(shouldCollapseCodeBlock).toHaveBeenCalledWith(
      "ts",
      "const answer = 42;",
    );
    expect(
      container.querySelector('[data-testid="artifact-placeholder"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="syntax-highlighter"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("const answer = 42;");
  });

  it("代码块高亮应关闭 textShadow 与字体连字，避免中英混排发虚", () => {
    const content = [
      "```typescript",
      "const answer = 42;",
      "```",
    ].join("\n");

    const container = render(content);
    const syntaxHighlighter = container.querySelector(
      '[data-testid="syntax-highlighter"]',
    );

    expect(syntaxHighlighter?.getAttribute("data-text-shadow")).toBe("none");
    expect(syntaxHighlighter?.getAttribute("data-font-ligatures")).toBe("none");
    expect(syntaxHighlighter?.getAttribute("data-font-family")).toContain(
      "ui-monospace",
    );
  });

  it("inline code 应单独标记，块级代码不应再继承胶囊样式", () => {
    const content = [
      "行内 `npm run dev`",
      "",
      "```ts",
      "const answer = 42;",
      "```",
    ].join("\n");

    const container = render(content);
    const inlineCode = container.querySelector('code[data-inline-code="true"]');
    const blockCode = container.querySelector(
      '[data-testid="syntax-highlighter-code"]',
    );

    expect(inlineCode?.textContent).toContain("npm run dev");
    expect(blockCode?.getAttribute("data-inline-code")).toBe("undefined");
    expect(blockCode?.getAttribute("data-display")).toBe("block");
    expect(blockCode?.getAttribute("data-padding")).toBe("0");
    expect(blockCode?.getAttribute("data-border")).toBe("none");
    expect(blockCode?.getAttribute("data-border-radius")).toBe("0");
    expect(blockCode?.getAttribute("data-background")).toBe("transparent");
    expect(blockCode?.getAttribute("data-color")).toBe("inherit");
  });

  it("代码块语言解析应兼容大小写与常见别名", () => {
    const content = ["```SHELL", "echo hello", "```"].join("\n");

    const container = render(content);
    const syntaxHighlighter = container.querySelector(
      '[data-testid="syntax-highlighter"]',
    );

    expect(syntaxHighlighter?.getAttribute("data-language")).toBe("bash");
    expect(container.textContent).toContain("bash");
  });

  it("文本流程代码块应渲染为流程视图而不是语法高亮", () => {
    const content = [
      "```text",
      '用户操作 -> 点击"添加凭证"',
      "↓",
      "选择提供商 -> 下拉选择 (OpenAI/Claude/Gemini/Kiro)",
      "↓",
      "填写信息 -> API Key、Secret、Endpoint（可选）",
      "```",
    ].join("\n");

    const container = render(content);

    expect(
      container.querySelector('[data-testid="markdown-flow-code-block"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="syntax-highlighter"]'),
    ).toBeNull();
  });

  it("伪代码目录块即使标注为 typescript 也应降级为纯文本视图", () => {
    const content = [
      "```typescript",
      "- AppLayout (应用主布局: Sidebar + Header + Content)",
      "- Sidebar (侧边导航栏)",
      "- Header (顶部导航栏)",
      "- PageHeader (页面标题与操作区)",
      "- ContentContainer (内容容器)",
      "- EmptyState (空状态占位)",
      "```",
    ].join("\n");

    const container = render(content);
    const plainBlock = container.querySelector(
      '[data-testid="markdown-plain-code-block"]',
    );

    expect(plainBlock).not.toBeNull();
    expect(
      plainBlock?.querySelector('[data-testid="markdown-plain-code-content"]'),
    ).not.toBeNull();
    expect(plainBlock?.querySelector("pre")).toBeNull();
    expect(
      container.querySelector('[data-testid="syntax-highlighter"]'),
    ).toBeNull();
    expect(container.textContent).toContain("AppLayout");
  });

  it("逐块判定返回 true 时才应渲染 artifact 占位卡", () => {
    const content = ["```tsx", "export default function Demo() {}", "```"].join(
      "\n",
    );

    const container = render(content, {
      collapseCodeBlocks: true,
      shouldCollapseCodeBlock: () => true,
    });

    expect(
      container.querySelector('[data-testid="artifact-placeholder"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="syntax-highlighter"]'),
    ).toBeNull();
  });
});
