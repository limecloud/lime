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
    expect(response?.data).toMatchObject({});
    expect(
      response?.components.some(
        (component) => component.component === "ChoicePicker",
      ),
    ).toBe(true);
  });

  it("多问题 ask_user 应在 A2UI 层裁剪为单轮单问", () => {
    const request: ActionRequired = {
      requestId: "req-ask-governed-form",
      actionType: "ask_user",
      prompt: "继续前先确认几个点",
      questions: [
        {
          question: "你希望我先聚焦哪一部分？",
        },
        {
          question: "这一步更看重速度还是完整度？",
        },
      ],
      status: "pending",
    };

    const response = buildActionRequestA2UI(request);

    expect(response?.data).toMatchObject({
      governance: {
        originalQuestionCount: 2,
        deferredQuestionCount: 1,
      },
    });
    expect(response?.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: "TextField",
          label: "你希望我先聚焦哪一部分？",
        }),
      ]),
    );
    expect(response?.components).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "这一步更看重速度还是完整度？",
        }),
      ]),
    );
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

  it("多字段 elicitation 提交 metadata 时应保留治理信息", () => {
    const request: ActionRequired = {
      requestId: "req-eli-governed-meta",
      actionType: "elicitation",
      prompt: "补充创作约束",
      requestedSchema: {
        type: "object",
        required: ["topic", "audience"],
        properties: {
          topic: {
            type: "string",
            title: "主题",
          },
          audience: {
            type: "string",
            title: "目标人群",
          },
        },
      },
      status: "pending",
    };

    const payload = buildActionRequestSubmissionPayload(request, {
      "req-eli-governed-meta_topic": "A2UI 治理",
    });

    expect(payload.requestMetadata).toMatchObject({
      elicitation_context: {
        governance: {
          originalFieldCount: 2,
          retainedFieldKey: "topic",
          deferredFieldCount: 1,
        },
        entries: [
          expect.objectContaining({
            fieldKey: "topic",
            label: "主题",
          }),
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
          governance: {
            originalFieldCount: 2,
            retainedFieldKey: "topic",
            deferredFieldCount: 1,
          },
          entries: [
            {
              fieldKey: "topic",
              label: "主题",
              value: "A2UI 改造",
              summary: "A2UI 改造",
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
    });
  });

  it("缺少问题的 ask_user 应回退为默认文本输入表单", () => {
    const request: ActionRequired = {
      requestId: "req-ask-empty",
      actionType: "ask_user",
      status: "pending",
    };

    expect(isActionRequestA2UICompatible(request)).toBe(true);
    expect(buildActionRequestA2UI(request)).toMatchObject({
      id: "action-request-req-ask-empty",
      submitAction: {
        label: "确认并继续",
      },
      components: expect.arrayContaining([
        expect.objectContaining({
          component: "TextField",
          id: "req-ask-empty_answer",
          label: "请输入你的回答",
        }),
      ]),
    });
  });

  it("运行时权限确认应保留为可点击确认卡，不提升为输入区 A2UI", () => {
    const request: ActionRequired = {
      requestId: "runtime_permission_confirmation:turn-1",
      actionType: "elicitation",
      prompt: "当前执行需要确认运行时权限：web_search。",
      questions: [
        {
          question: "当前执行需要确认运行时权限：web_search。",
          options: [{ label: "允许本次执行" }, { label: "拒绝" }],
        },
      ],
      status: "pending",
    };

    expect(isActionRequestA2UICompatible(request)).toBe(false);
    expect(buildActionRequestA2UI(request)).toBeNull();
  });
});
