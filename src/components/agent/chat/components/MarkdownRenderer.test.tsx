import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fileBrowserModule from "@/lib/api/fileBrowser";
import { MarkdownRenderer } from "./MarkdownRenderer";

const mockConvertLocalFileSrc = vi.fn((path: string) => `asset://${path}`);

vi.mock("react-syntax-highlighter", () => ({
  Prism: ({
    children,
    language,
    className,
    style,
    customStyle,
    codeTagProps,
  }: {
    children: React.ReactNode;
    language?: string;
    className?: string;
    style?: Record<string, unknown>;
    customStyle?: React.CSSProperties;
    codeTagProps?: {
      style?: React.CSSProperties;
    };
  }) => (
    <pre
      data-testid="syntax-highlighter"
      data-language={language}
      className={className}
      data-theme={(style as { __theme?: string } | undefined)?.__theme}
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
  oneDark: { __theme: "dark" },
  oneLight: { __theme: "light" },
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

vi.mock("@/lib/api/fileSystem", () => ({
  convertLocalFileSrc: (path: string) => mockConvertLocalFileSrc(path),
}));

vi.mock("@/lib/api/fileBrowser", () => ({
  readFilePreview: vi.fn(),
}));

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
}

interface RenderOptions {
  baseFilePath?: string;
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
  mockConvertLocalFileSrc.mockClear();
});

function render(
  content: string,
  {
    baseFilePath,
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
        baseFilePath={baseFilePath}
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
    baseFilePath,
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
      baseFilePath: nextBaseFilePath = baseFilePath,
      isStreaming: nextIsStreaming = isStreaming,
      collapseCodeBlocks: nextCollapseCodeBlocks = collapseCodeBlocks,
      shouldCollapseCodeBlock:
        nextShouldCollapseCodeBlock = shouldCollapseCodeBlock,
      showBlockActions: nextShowBlockActions = showBlockActions,
      onQuoteContent: nextOnQuoteContent = onQuoteContent,
    }: RenderOptions = {},
  ) => {
    act(() => {
      root.render(
        <MarkdownRenderer
          content={nextContent}
          baseFilePath={nextBaseFilePath}
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

  it("带 baseFilePath 时应把相对图片路径解析为本地文件资源", () => {
    const container = render("![配图](images/hero.png)", {
      baseFilePath:
        "/Users/coso/.proxycast/projects/default/exports/x-article/google/index.md",
    });

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(mockConvertLocalFileSrc).toHaveBeenCalledWith(
      "/Users/coso/.proxycast/projects/default/exports/x-article/google/images/hero.png",
    );
    expect(image?.getAttribute("src")).toBe(
      "asset:///Users/coso/.proxycast/projects/default/exports/x-article/google/images/hero.png",
    );
  });

  it("应通过同目录 meta.json 将远程图片替换为本地下载资源", async () => {
    vi.mocked(fileBrowserModule.readFilePreview).mockResolvedValue({
      path:
        "/Users/coso/.lime/projects/default/exports/x-article/google/meta.json",
      content: JSON.stringify({
        markdown_relative_path: "exports/x-article/google/index.md",
        images: [
          {
            original_url: "https://cdn.example.com/hero.png",
            markdown_path: "images/hero.png",
          },
        ],
      }),
      isBinary: false,
      size: 160,
      error: null,
    });

    const container = render("![配图](https://cdn.example.com/hero.png)", {
      baseFilePath:
        "/Users/coso/.lime/projects/default/exports/x-article/google/index.md",
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(fileBrowserModule.readFilePreview).toHaveBeenCalledWith(
      "/Users/coso/.lime/projects/default/exports/x-article/google/meta.json",
      64 * 1024,
    );

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(mockConvertLocalFileSrc).toHaveBeenCalledWith(
      "/Users/coso/.lime/projects/default/exports/x-article/google/images/hero.png",
    );
    expect(image?.getAttribute("src")).toBe(
      "asset:///Users/coso/.lime/projects/default/exports/x-article/google/images/hero.png",
    );
  });

  it("应归一化 ./ 和 ../ 相对图片路径并保留查询串", () => {
    const container = render("![配图](./images/../images/hero.png?raw=1#preview)", {
      baseFilePath:
        "/Users/coso/.proxycast/projects/default/exports/x-article/google/nested/index.md",
    });

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(mockConvertLocalFileSrc).toHaveBeenCalledWith(
      "/Users/coso/.proxycast/projects/default/exports/x-article/google/nested/images/hero.png",
    );
    expect(image?.getAttribute("src")).toBe(
      "asset:///Users/coso/.proxycast/projects/default/exports/x-article/google/nested/images/hero.png?raw=1#preview",
    );
  });

  it("绝对路径图片应复用本地资源转换并保留 hash", () => {
    const container = render("![配图](/Users/coso/demo/assets/cover.png#hero)");

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(mockConvertLocalFileSrc).toHaveBeenCalledWith(
      "/Users/coso/demo/assets/cover.png",
    );
    expect(image?.getAttribute("src")).toBe(
      "asset:///Users/coso/demo/assets/cover.png#hero",
    );
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

  it("标题后的正文应保持聊天正文排版，不应缩小变灰", () => {
    const container = document.createElement("div");
    container.style.setProperty("--foreground", "17 24 39");
    container.style.setProperty("--muted-foreground", "100 116 139");
    container.style.fontSize = "15px";
    container.style.lineHeight = "1.7";
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <MarkdownRenderer content={"## 小结\n\n这段正文应该和聊天正文保持同一字号与主色。"} />,
      );
    });

    mountedRoots.push({ container, root });

    const heading = container.querySelector(
      'h2[data-markdown-heading-level="2"]',
    );
    const paragraph = container.querySelector("p");

    expect(heading).not.toBeNull();
    expect(paragraph).not.toBeNull();
    expect(getComputedStyle(paragraph as Element).fontSize).toBe("1em");
    expect(document.head.textContent).not.toContain("h1 + p");
    expect(document.head.textContent).not.toContain("h2 + p");
    expect(document.head.textContent).not.toContain("h3 + p");
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
    const content = ["```typescript", "const answer = 42;", "```"].join("\n");

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

  it("代码块应改用浅色主题与浅底容器，避免整片黑底压过正文", () => {
    const content = ["```typescript", "const answer = 42;", "```"].join("\n");

    const container = render(content);
    const syntaxHighlighter = container.querySelector(
      '[data-testid="syntax-highlighter"]',
    );
    const codeBlock = container.querySelector(
      '[data-testid="markdown-syntax-code-block"]',
    );

    expect(syntaxHighlighter?.getAttribute("data-theme")).toBe("light");
    expect(codeBlock).not.toBeNull();
    expect(getComputedStyle(codeBlock as HTMLElement).backgroundColor).toBe(
      "rgb(248, 250, 252)",
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
