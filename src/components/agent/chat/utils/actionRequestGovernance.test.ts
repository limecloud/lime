import { describe, expect, it } from "vitest";

import type { ActionRequired } from "../types";
import { governActionRequest } from "./actionRequestGovernance";

describe("actionRequestGovernance", () => {
  it("ask_user 多问题时应只保留当前最关键的一问", () => {
    const governed = governActionRequest({
      requestId: "req-ask-govern",
      actionType: "ask_user",
      prompt: "继续前先确认几个点",
      questions: [
        { question: "你希望我先聚焦哪一部分？" },
        { question: "这一步更看重速度还是完整度？" },
        { question: "是否还有额外限制？" },
      ],
      status: "pending",
    });

    expect(governed.questions).toEqual([
      {
        question: "你希望我先聚焦哪一部分？",
      },
    ]);
    expect(governed.governance).toMatchObject({
      strategy: "single_turn_single_question",
      source: "runtime_action_required",
      originalQuestionCount: 3,
      deferredQuestionCount: 2,
    });
  });

  it("elicitation 多字段时应只保留当前关键字段", () => {
    const request: ActionRequired = {
      requestId: "req-elicitation-govern",
      actionType: "elicitation",
      prompt: "补充创作约束",
      questions: [
        {
          question: "主题是什么？",
          header: "topic",
        },
        {
          question: "风格是什么？",
          header: "style",
        },
      ],
      requestedSchema: {
        type: "object",
        required: ["topic", "style"],
        properties: {
          topic: {
            type: "string",
            title: "主题",
          },
          style: {
            type: "string",
            title: "风格",
          },
          includeCta: {
            type: "boolean",
            title: "是否加入 CTA",
          },
        },
        "x-lime-ask-user-questions": [
          {
            question: "主题是什么？",
            header: "topic",
          },
          {
            question: "风格是什么？",
            header: "style",
          },
        ],
      },
      status: "pending",
    };

    const governed = governActionRequest(request);

    expect(governed.questions).toEqual([
      {
        question: "主题是什么？",
        header: "topic",
      },
    ]);
    expect(governed.requestedSchema).toEqual({
      type: "object",
      required: ["topic"],
      properties: {
        topic: {
          type: "string",
          title: "主题",
        },
      },
      "x-lime-ask-user-questions": [
        {
          question: "主题是什么？",
          header: "topic",
        },
      ],
    });
    expect(governed.governance).toMatchObject({
      originalQuestionCount: 2,
      retainedQuestionIndex: 0,
      deferredQuestionCount: 1,
      strategy: "single_turn_single_question",
      source: "runtime_action_required",
      originalFieldCount: 3,
      retainedFieldKey: "topic",
      deferredFieldCount: 2,
    });
  });
});
