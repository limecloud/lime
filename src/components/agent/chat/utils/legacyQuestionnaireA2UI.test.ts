import { describe, expect, it } from "vitest";

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

describe("legacyQuestionnaireA2UI", () => {
  it("应将结构化问卷正文转换为输入区可渲染的 A2UI 表单", () => {
    const response = buildLegacyQuestionnaireA2UI(LEGACY_QUESTIONNAIRE);

    expect(response).not.toBeNull();
    expect(response?.submitAction?.label).toBe("确认并继续");
    expect(response?.data).toMatchObject({
      source: "legacy_questionnaire",
      sectionCount: 2,
      questionCount: 4,
    });
    expect(
      response?.components.some(
        (component) =>
          component.component === "ChoicePicker" &&
          "label" in component &&
          component.label === "语气偏好",
      ),
    ).toBe(true);
    expect(
      response?.components.some(
        (component) =>
          component.component === "TextField" &&
          "label" in component &&
          component.label === "这次最想达成的目标是什么？",
      ),
    ).toBe(true);
  });

  it("普通回复或内联 a2ui 不应被误识别为 legacy 表单", () => {
    expect(
      buildLegacyQuestionnaireA2UI("你可以先给我一个主题，我再继续展开。"),
    ).toBeNull();
    expect(
      buildLegacyQuestionnaireA2UI("<a2ui>{\"type\":\"form\"}</a2ui>"),
    ).toBeNull();
  });

  it("应将 legacy 表单回答格式化为带字段标签的用户摘要", () => {
    const response = buildLegacyQuestionnaireA2UI(LEGACY_QUESTIONNAIRE);
    if (!response) {
      throw new Error("预期应生成 legacy questionnaire A2UI");
    }

    const componentsByLabel = Object.fromEntries(
      response.components
        .filter(
          (component) =>
            (component.component === "ChoicePicker" ||
              component.component === "TextField") &&
            "label" in component &&
            typeof component.label === "string",
        )
        .map((component) => [component.label, component.id]),
    );

    const submission = formatLegacyQuestionnaireSubmission(response, {
      [componentsByLabel["这次内容主要面向谁？"]]: ["客户"],
      [componentsByLabel["这次最想达成的目标是什么？"]]:
        "帮助销售团队快速对齐宣传口径",
      [componentsByLabel["语气偏好"]]: ["友好专业"],
      [componentsByLabel["是否需要加入明确行动号召？"]]: ["是"],
    });

    expect(submission).toBe(`我的选择：
- 这次内容主要面向谁？: 客户
- 这次最想达成的目标是什么？: 帮助销售团队快速对齐宣传口径
- 语气偏好: 友好专业
- 是否需要加入明确行动号召？: 是`);
  });

  it("应生成可传给运行时的结构化 elicitation_context 元数据", () => {
    const response = buildLegacyQuestionnaireA2UI(LEGACY_QUESTIONNAIRE);
    if (!response) {
      throw new Error("预期应生成 legacy questionnaire A2UI");
    }

    const componentsByLabel = Object.fromEntries(
      response.components
        .filter(
          (component) =>
            (component.component === "ChoicePicker" ||
              component.component === "TextField") &&
            "label" in component &&
            typeof component.label === "string",
        )
        .map((component) => [component.label, component.id]),
    );

    const payload = buildLegacyQuestionnaireSubmissionPayload(response, {
      [componentsByLabel["这次内容主要面向谁？"]]: ["客户"],
      [componentsByLabel["这次最想达成的目标是什么？"]]:
        "帮助销售团队快速对齐宣传口径",
      [componentsByLabel["语气偏好"]]: ["友好专业"],
    });

    expect(payload).toMatchObject({
      userData: {
        "这次内容主要面向谁？": "客户",
        "这次最想达成的目标是什么？": "帮助销售团队快速对齐宣传口径",
        语气偏好: "友好专业",
      },
      requestMetadata: {
        elicitation_context: {
          source: "legacy_questionnaire",
          mode: "compatibility_bridge",
          section_count: 2,
          question_count: 4,
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
