import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalSkillInspection } from "@/lib/api/skills";

vi.mock("@/components/preview/MarkdownPreview", () => ({
  MarkdownPreview: ({ content }: { content: string }) => (
    <div data-testid="markdown-preview">{content}</div>
  ),
}));

import { SkillContentDialog } from "./SkillContentDialog";

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: RenderResult[] = [];

function createInspection(
  overrides: Partial<LocalSkillInspection> = {},
): LocalSkillInspection {
  return {
    content: "# 标题\n正文内容",
    metadata: {
      lime_category: "social",
      lime_workflow_ref: "references/workflow.json",
    },
    allowedTools: ["web.search"],
    resourceSummary: {
      hasScripts: false,
      hasReferences: true,
      hasAssets: false,
    },
    standardCompliance: {
      isStandard: true,
      validationErrors: [],
      deprecatedFields: [],
    },
    ...overrides,
  };
}

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
        inspection={createInspection()}
        open={true}
        onOpenChange={() => {}}
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
    expect(document.body.textContent).toContain("正在检查 Skill 包...");
  });

  it("出错时应显示错误信息", () => {
    renderDialog({ error: "读取失败: 文件不存在" });
    expect(document.body.textContent).toContain("读取失败: 文件不存在");
  });

  it("有检查结果时应渲染标准状态、元数据和 markdown 文本", () => {
    renderDialog();
    expect(document.body.textContent).toContain("标准");
    expect(document.body.textContent).toContain("lime_category");
    expect(document.body.textContent).toContain("web.search");
    expect(document.body.textContent).toContain("标题");
    expect(document.body.textContent).toContain("正文内容");
  });

  it("有校验错误时应显示待修复状态和错误明细", () => {
    renderDialog({
      inspection: createInspection({
        standardCompliance: {
          isStandard: false,
          validationErrors: ["workflow 引用不存在"],
          deprecatedFields: ["steps-json"],
        },
      }),
    });

    expect(document.body.textContent).toContain("待修复");
    expect(document.body.textContent).toContain("workflow 引用不存在");
    expect(document.body.textContent).toContain("steps-json");
  });
});
