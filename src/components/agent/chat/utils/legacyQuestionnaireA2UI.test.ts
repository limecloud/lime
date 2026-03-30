import { describe, expect, it } from "vitest";

import type {
  A2UIComponent,
  ChoicePickerComponent,
  TextFieldComponent,
} from "@/lib/workspace/a2ui";

import {
  buildLegacyQuestionnaireSubmissionPayload,
  buildLegacyQuestionnaireA2UI,
  formatLegacyQuestionnaireSubmission,
} from "./legacyQuestionnaireA2UI";

const LEGACY_QUESTIONNAIRE = `为了继续推进，我需要你先补充以下信息：

1. 目标与对象
- 这次内容主要面向谁？（客户 / 上级 / 同事）
- 这次最想达成的目标是什么？

2. 风格与限制
- 语气偏好：正式严谨 / 友好专业 / 直接高效
- 是否需要加入明确行动号召？`;

const COMPAT_ASK_USER_QUESTIONNAIRE = `我注意到您想让我做“网页研究简报”，但您没有指定具体的研究主题。

我注意到您想让我做“网页研究简报”，但您没有指定具体的研究主题。

在我开始之前，需要先明确几个问题：

ask<arg_key>question</arg_key><arg_key>arg_value>请提供您希望我研究的具体主题。这可以是：

- 一个行业或领域（如“生成式 AI 在医疗领域的应用”）
- 一个产品或服务（如“Claude API vs 竞品对比”）
- 一个公司或组织（如“某公司的最新动态”）
- 一个技术或概念（如“WebAssembly 的新进展”）
- 其他您关心的主题

另外，请告诉我该研究的主要目的是什么？</arg_value></tool_calls>`;

const PLAIN_ASK_USER_QUESTIONNAIRE = `我需要先明确一下：您希望我研究哪个主题？您的消息中提到了“围绕这个主题”，但没有具体说明主题内容。请告诉我：

- 具体的研究主题（例如：某个产品、技术、公司、市场趋势、政策、事件等）
- 研究目的（例如：投资决策、技术选型、竞争分析、学习了解等）
- 是否有特定关注点（例如：风险、机会、对比、最新动态等）

一旦您明确了主题，我会：
1. 使用联网搜索获取最新信息
2. 整理关键来源和核心发现
3. 识别风险点和待追踪问题
4. 输出一版结构化的研究简报`;

const MARKDOWN_PLAIN_ASK_USER_QUESTIONNAIRE = `# 继续推进前，请先补充信息

请告诉我：

- **具体的研究主题**（例如：**A2UI 工作流** / **Chrome 连接器**）
- **研究目的**（例如：**技术选型** / **方案对比**）
- **是否有特定关注点**（例如：**风险** / **迁移成本**）

明确后我会继续整理。`;

type LegacyQuestionFieldComponent = (
  | ChoicePickerComponent
  | TextFieldComponent
) & {
  label: string;
};

function isLegacyQuestionFieldComponent(
  component: A2UIComponent,
): component is LegacyQuestionFieldComponent {
  return (
    (component.component === "ChoicePicker" ||
      component.component === "TextField") &&
    typeof component.label === "string"
  );
}

describe("legacyQuestionnaireA2UI", () => {
  it("应将结构化问卷正文转换为输入区可渲染的 A2UI 表单", () => {
    const response = buildLegacyQuestionnaireA2UI(LEGACY_QUESTIONNAIRE);

    expect(response).not.toBeNull();
    expect(response?.submitAction?.label).toBe("确认并继续");
    expect(response?.data).toMatchObject({
      source: "legacy_questionnaire",
      sectionCount: 1,
      questionCount: 1,
      governance: {
        originalSectionCount: 2,
        originalQuestionCount: 4,
        deferredQuestionCount: 3,
      },
    });
    expect(
      response?.components.some((component) => component.component === "Card"),
    ).toBe(true);
    expect(
      response?.components.some(
        (component) =>
          component.component === "ChoicePicker" &&
          "label" in component &&
          component.label === "这次内容主要面向谁？",
      ),
    ).toBe(true);
    expect(response?.components).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "这次最想达成的目标是什么？",
        }),
        expect.objectContaining({
          label: "语气偏好",
        }),
      ]),
    );
  });

  it("普通回复或内联 a2ui 不应被误识别为 legacy 表单", () => {
    expect(
      buildLegacyQuestionnaireA2UI("你可以先给我一个主题，我再继续展开。"),
    ).toBeNull();
    expect(
      buildLegacyQuestionnaireA2UI('<a2ui>{"type":"form"}</a2ui>'),
    ).toBeNull();
  });

  it("应兼容 ask/tool_calls 残留问卷正文并转换为可渲染的 A2UI 表单", () => {
    const response = buildLegacyQuestionnaireA2UI(
      COMPAT_ASK_USER_QUESTIONNAIRE,
    );

    expect(response).not.toBeNull();
    expect(response?.data).toMatchObject({
      source: "legacy_questionnaire",
      sectionCount: 1,
      questionCount: 1,
      governance: {
        originalQuestionCount: 2,
        deferredQuestionCount: 1,
      },
    });

    const fieldComponents = response?.components.filter(
      isLegacyQuestionFieldComponent,
    );
    expect(fieldComponents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: "TextField",
          label: "请提供您希望我研究的具体主题",
          helperText: expect.stringContaining("生成式 AI 在医疗领域的应用"),
        }),
      ]),
    );
    expect(fieldComponents).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "请告诉我该研究的主要目的是什么？",
        }),
      ]),
    );
  });

  it("应将普通中文澄清问题提升为输入区可渲染的 A2UI 表单", () => {
    const response = buildLegacyQuestionnaireA2UI(PLAIN_ASK_USER_QUESTIONNAIRE);

    expect(response).not.toBeNull();
    expect(response?.data).toMatchObject({
      source: "legacy_questionnaire",
      sectionCount: 1,
      questionCount: 1,
      governance: {
        originalQuestionCount: 3,
        deferredQuestionCount: 2,
      },
    });

    const fieldComponents = response?.components.filter(
      isLegacyQuestionFieldComponent,
    );
    expect(fieldComponents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: "TextField",
          label: "具体的研究主题",
          helperText: "例如：某个产品、技术、公司、市场趋势、政策、事件等",
        }),
      ]),
    );
    expect(fieldComponents).toHaveLength(1);
  });

  it("应清洗字段中的 markdown 语法，并保留说明文本的段落结构", () => {
    const response = buildLegacyQuestionnaireA2UI(
      MARKDOWN_PLAIN_ASK_USER_QUESTIONNAIRE,
    );

    expect(response).not.toBeNull();

    const introTextComponent = response?.components.find(
      (component) =>
        component.component === "Text" &&
        typeof component.id === "string" &&
        component.id.includes("_intro"),
    );

    expect(introTextComponent).toMatchObject({
      component: "Text",
      text: "# 继续推进前，请先补充信息\n\n请告诉我：",
    });

    const fieldComponents = response?.components.filter(
      isLegacyQuestionFieldComponent,
    );
    expect(fieldComponents).toEqual([
      expect.objectContaining({
        component: "TextField",
        label: "具体的研究主题",
        helperText: "例如：A2UI 工作流 / Chrome 连接器",
      }),
    ]);
  });

  it("应将 legacy 表单回答格式化为带字段标签的用户摘要", () => {
    const response = buildLegacyQuestionnaireA2UI(LEGACY_QUESTIONNAIRE);
    if (!response) {
      throw new Error("预期应生成 legacy questionnaire A2UI");
    }

    const componentsByLabel = Object.fromEntries(
      response.components
        .filter(isLegacyQuestionFieldComponent)
        .map((component) => [component.label, component.id]),
    );

    const submission = formatLegacyQuestionnaireSubmission(response, {
      [componentsByLabel["这次内容主要面向谁？"]]: ["客户"],
    });

    expect(submission).toBe(`我的选择：
- 这次内容主要面向谁？: 客户`);
  });

  it("应生成可传给运行时的结构化 elicitation_context 元数据", () => {
    const response = buildLegacyQuestionnaireA2UI(LEGACY_QUESTIONNAIRE);
    if (!response) {
      throw new Error("预期应生成 legacy questionnaire A2UI");
    }

    const componentsByLabel = Object.fromEntries(
      response.components
        .filter(isLegacyQuestionFieldComponent)
        .map((component) => [component.label, component.id]),
    );

    const payload = buildLegacyQuestionnaireSubmissionPayload(response, {
      [componentsByLabel["这次内容主要面向谁？"]]: ["客户"],
    });

    expect(payload).toMatchObject({
      userData: {
        "这次内容主要面向谁？": "客户",
      },
      requestMetadata: {
        elicitation_context: {
          source: "legacy_questionnaire",
          mode: "compatibility_bridge",
          section_count: 1,
          question_count: 1,
          governance: {
            originalSectionCount: 2,
            originalQuestionCount: 4,
            deferredQuestionCount: 3,
          },
          entries: expect.arrayContaining([
            expect.objectContaining({
              label: "这次内容主要面向谁？",
              value: "客户",
              summary: "客户",
            }),
          ]),
        },
      },
    });
  });
});
