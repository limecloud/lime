import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContentReviewPanel } from "./ContentReviewPanel";

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: RenderResult[] = [];

const defaultExpert = {
  id: "expert-1",
  name: "评审专家",
  title: "结构审校",
  description: "负责检查评审输出结构是否合理",
  tags: ["结构", "审校"],
  avatarLabel: "审",
  avatarColor: "#2563eb",
};

function renderPanel(
  overrides: Partial<ComponentProps<typeof ContentReviewPanel>> = {},
): RenderResult {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <ContentReviewPanel
        open={true}
        experts={[defaultExpert]}
        selectedExpertIds={["expert-1"]}
        onToggleExpert={() => {}}
        onClose={() => {}}
        onCreateExpert={() => {}}
        onStartReview={() => {}}
        reviewRunning={false}
        reviewResult=""
        reviewError=""
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

describe("ContentReviewPanel", () => {
  it("应按结构化方式渲染 A2UI 评审结果，而不是直接显示原始代码块", () => {
    renderPanel({
      reviewResult: `\`\`\`a2ui
{
  "type": "form",
  "title": "创作需求收集",
  "description": "请补充以下内容",
  "fields": [
    {
      "id": "topic",
      "type": "text",
      "label": "内容主题",
      "placeholder": "请输入主题"
    }
  ],
  "submitLabel": "继续"
}
\`\`\``,
    });

    expect(document.body.textContent).toContain("创作需求收集");
    expect(document.body.textContent).toContain("内容主题");
    expect(document.body.textContent).not.toContain("```a2ui");
    expect(document.body.textContent).toContain(
      "检测到结构化补充信息，右侧栏已按结构化内容展示",
    );
    expect(document.body.textContent).toContain("结构化补充信息");
    expect(document.body.textContent).toContain("评审预览");
  });

  it("普通文本评审结果应保持原样显示", () => {
    renderPanel({
      reviewResult:
        "内容评审结果：整体结构清晰，但导语偏长，建议压缩到两句话内。",
    });

    expect(document.body.textContent).toContain("内容评审结果：整体结构清晰");
  });

  it("未完成的结构化评审结果应显示统一加载卡片", () => {
    renderPanel({
      reviewResult: '```a2ui\n{\n  "type": "form"\n',
      reviewRunning: false,
    });

    expect(document.body.textContent).toContain("结构化评审结果加载中...");
    expect(document.body.textContent).toContain("结构化补充信息");
    expect(document.body.textContent).toContain("评审预览");
  });
});
