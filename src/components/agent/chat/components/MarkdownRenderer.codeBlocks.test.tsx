import { describe, expect, it, vi } from "vitest";

import { renderMarkdown as render } from "./MarkdownRenderer.testHarness";

describe("MarkdownRenderer code blocks", () => {
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
    const backgroundColor = getComputedStyle(
      codeBlock as HTMLElement,
    ).backgroundColor;
    const rgbMatch = /rgb\((\d+), (\d+), (\d+)\)/.exec(backgroundColor);
    expect(rgbMatch).not.toBeNull();
    const [, red = "0", green = "0", blue = "0"] = rgbMatch ?? [];
    expect(Number(red)).toBeGreaterThanOrEqual(240);
    expect(Number(green)).toBeGreaterThanOrEqual(240);
    expect(Number(blue)).toBeGreaterThanOrEqual(240);
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
    expect(container.textContent).toContain("1 行");
  });

  it("显式 flow 代码块应渲染为流程视图而不是语法高亮", () => {
    const content = [
      "```flow",
      '用户操作 -> 点击"添加模型"',
      "↓",
      "选择服务商 -> 下拉选择 (OpenAI/Claude/自定义 API)",
      "↓",
      "填写信息 -> API Key、Base URL、模型（可选）",
      "```",
    ].join("\n");

    const container = render(content);

    expect(
      container.querySelector('[data-testid="markdown-flow-code-block"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="syntax-highlighter"]'),
    ).toBeNull();
    expect(container.textContent).toContain("5 行");
  });

  it("text 代码块即使包含流程箭头也应保持普通文本视图", () => {
    const content = [
      "```text",
      '用户操作 -> 点击"添加模型"',
      "↓",
      "选择服务商 -> 下拉选择 (OpenAI/Claude/自定义 API)",
      "↓",
      "填写信息 -> API Key、Base URL、模型（可选）",
      "```",
    ].join("\n");

    const container = render(content);

    expect(
      container.querySelector('[data-testid="markdown-flow-code-block"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="markdown-plain-code-block"]'),
    ).not.toBeNull();
  });

  it("带箭头的 Markdown 大纲代码块不应误渲染为流程胶囊", () => {
    const content = [
      "```",
      "导出 PDF / 分享",
      "↓",
      "---",
      "## 11.5 余料管理页面",
      "### 列表字段",
      "- 余料编号；",
      "- 图片；",
      "- 分类；",
      "↓",
      "## 12. AI 能力规划",
      "- 图像识别；",
      "- 图像生成；",
      "```",
    ].join("\n");

    const container = render(content);

    expect(
      container.querySelector('[data-testid="markdown-flow-code-block"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="markdown-plain-code-block"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("12 行");
    expect(container.textContent).toContain("## 11.5 余料管理页面");
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
    expect(container.textContent).toContain("6 行");
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
  it("不应改写代码块里的紧凑竖线文本", () => {
    const content = [
      "```text",
      "| 事件 | 要点 ||------|| 示例 | 保持原文 |",
      "```",
    ].join("\n");

    const container = render(content);

    expect(
      container.querySelector('[data-testid="markdown-table-scroll"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="markdown-plain-code-block"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("||------||");
  });

});
