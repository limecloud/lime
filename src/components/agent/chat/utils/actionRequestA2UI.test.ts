import { describe, expect, it } from "vitest";

import type { ActionRequired } from "../types";
import {
  buildActionRequestA2UI,
  buildActionRequestSubmissionContext,
  buildActionRequestSubmissionPayload,
  isActionRequestA2UICompatible,
  normalizeActionRequestFormDataForSubmission,
  resolveActionRequestInitialFormData,
  summarizeActionRequestSubmission,
} from "./actionRequestA2UI";

describe("actionRequestA2UI", () => {
  it("应将 ask_user 选项问题转换为 A2UI 选择器", () => {
    const request: ActionRequired = {
      requestId: "req-ask-1",
      actionType: "ask_user",
      prompt: "请选择执行模式",
      questions: [
        {
          question: "请选择执行模式",
          options: [
            { label: "自动执行", description: "不再逐项确认" },
            { label: "确认后执行", description: "每一步先问我" },
          ],
        },
      ],
      status: "pending",
    };

    const response = buildActionRequestA2UI(request);

    expect(response).not.toBeNull();
    expect(response?.submitAction?.label).toBe("确认并继续");
    expect(
      response?.components.some(
        (component) => component.component === "ChoicePicker",
      ),
    ).toBe(true);
  });

  it("应将单选 A2UI 表单值归一化为 ask_user 提交载荷", () => {
    const request: ActionRequired = {
      requestId: "req-ask-1",
      actionType: "ask_user",
      prompt: "请选择执行模式",
      questions: [
        {
          question: "请选择执行模式",
          options: [{ label: "自动执行" }, { label: "确认后执行" }],
        },
      ],
      status: "pending",
    };

    const payload = normalizeActionRequestFormDataForSubmission(request, {
      "req-ask-1_answer": ["自动执行"],
    });

    expect(payload.userData).toEqual({ answer: "自动执行" });
    expect(payload.responseText).toBe('{"answer":"自动执行"}');
  });

  it("应为真实 action_required 提交生成统一的 elicitation_context 元数据", () => {
    const request: ActionRequired = {
      requestId: "req-ask-meta-1",
      actionType: "ask_user",
      prompt: "请选择执行模式",
      questions: [
        {
          question: "请选择执行模式",
          options: [{ label: "自动执行" }, { label: "确认后执行" }],
        },
      ],
      status: "pending",
    };

    const payload = buildActionRequestSubmissionPayload(request, {
      "req-ask-meta-1_answer": ["自动执行"],
    });

    expect(payload.requestMetadata).toMatchObject({
      elicitation_context: {
        source: "action_required",
        mode: "runtime_protocol",
        form_id: "req-ask-meta-1",
        action_type: "ask_user",
        field_count: 1,
        prompt: "请选择执行模式",
        entries: [
          {
            fieldKey: "answer",
            label: "请选择执行模式",
            value: "自动执行",
            summary: "自动执行",
          },
        ],
      },
    });
  });

  it("应基于已解析 userData 为 elicitation 构造字段级 metadata", () => {
    const request: ActionRequired = {
      requestId: "req-eli-meta-1",
      actionType: "elicitation",
      prompt: "补充创作约束",
      requestedSchema: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            title: "主题",
          },
          includeCta: {
            type: "boolean",
            title: "是否加入 CTA",
          },
        },
      },
      status: "pending",
    };

    const context = buildActionRequestSubmissionContext(request, {
      topic: "A2UI 改造",
      includeCta: false,
    });

    expect(context).toMatchObject({
      requestMetadata: {
        elicitation_context: {
          action_type: "elicitation",
          entries: [
            {
              fieldKey: "topic",
              label: "主题",
              value: "A2UI 改造",
              summary: "A2UI 改造",
            },
            {
              fieldKey: "includeCta",
              label: "是否加入 CTA",
              value: false,
              summary: "否",
            },
          ],
        },
      },
    });
  });

  it("已提交的 action request 应生成简洁回显摘要", () => {
    const request: ActionRequired = {
      requestId: "req-ask-submitted",
      actionType: "ask_user",
      status: "submitted",
      submittedUserData: {
        answer: "直接回答优先",
      },
    };

    expect(summarizeActionRequestSubmission(request)).toBe("直接回答优先");
  });

  it("应将已提交的 elicitation 回答回填为只读 A2UI 初始值", () => {
    const request: ActionRequired = {
      requestId: "req-eli-1",
      actionType: "elicitation",
      status: "submitted",
      requestedSchema: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            title: "主题",
          },
          channels: {
            type: "array",
            title: "渠道",
            items: {
              enum: ["小红书", "视频号", "公众号"],
            },
          },
        },
      },
      submittedResponse: '{"topic":"A2UI 改造","channels":["小红书","视频号"]}',
    };

    expect(resolveActionRequestInitialFormData(request)).toEqual({
      "req-eli-1_topic": "A2UI 改造",
      "req-eli-1_channels": ["小红书", "视频号"],
    });
  });

  it("browser_preflight 不应被提升为 A2UI 表单", () => {
    const request: ActionRequired = {
      requestId: "req-browser",
      actionType: "ask_user",
      uiKind: "browser_preflight",
      status: "pending",
    };

    expect(isActionRequestA2UICompatible(request)).toBe(false);
    expect(buildActionRequestA2UI(request)).toBeNull();
  });
});
