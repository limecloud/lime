import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/preview/MarkdownPreview", () => ({
  MarkdownPreview: ({
    content,
  }: {
    content: string;
  }) => <div data-testid="markdown-preview">{content}</div>,
}));

import { SkillContentDialog } from "./SkillContentDialog";

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: RenderResult[] = [];

function renderDialog(
  overrides: Partial<ComponentProps<typeof SkillContentDialog>> = {},
): RenderResult {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <SkillContentDialog
        skillName="test-skill"
        open={true}
        onOpenChange={() => {}}
        content=""
        loading={false}
        error={null}
        {...overrides}
      />,
    );
  });

  const rendered = { container, root };
  mountedRoots.push(rendered);
  return rendered;
}

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
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
});

describe("SkillContentDialog", () => {
  it("加载中时应显示加载提示", () => {
    renderDialog({ loading: true });
    expect(document.body.textContent).toContain("正在读取 SKILL.md...");
  });

  it("出错时应显示错误信息", () => {
    renderDialog({ error: "读取失败: 文件不存在" });
    expect(document.body.textContent).toContain("读取失败: 文件不存在");
  });

  it("有内容时应渲染 markdown 文本", () => {
    renderDialog({ content: "# 标题\n正文内容" });
    expect(document.body.textContent).toContain("标题");
    expect(document.body.textContent).toContain("正文内容");
  });
});
