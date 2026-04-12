import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceA2UIRuntime } from "./useWorkspaceA2UIRuntime";
import type { Message } from "../types";

type HookProps = Parameters<typeof useWorkspaceA2UIRuntime>[0];

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function createAssistantMessage(id: string, content: string): Message {
  return {
    id,
    role: "assistant",
    content,
    timestamp: new Date("2026-03-27T10:00:00.000Z"),
  };
}

function createUserMessage(id: string, content: string): Message {
  return {
    id,
    role: "user",
    content,
    timestamp: new Date("2026-03-27T10:00:10.000Z"),
  };
}

function renderHook(_initialProps: HookProps) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestValue: ReturnType<typeof useWorkspaceA2UIRuntime> | null = null;

  function Probe(currentProps: HookProps) {
    latestValue = useWorkspaceA2UIRuntime(currentProps);
    return null;
  }

  const render = async (nextProps: HookProps) => {
    await act(async () => {
      root.render(<Probe {...nextProps} />);
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  mountedRoots.push({ root, container });

  return {
    render,
    getValue: () => {
      if (!latestValue) {
        throw new Error("hook 尚未初始化");
      }
      return latestValue;
    },
  };
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
  vi.restoreAllMocks();
});

describe("useWorkspaceA2UIRuntime", () => {
  it("官方 JSONL A2UI 消息应直接提升为输入区表单", async () => {
    const jsonlA2UIMessage = createAssistantMessage(
      "assistant-jsonl",
      [
        "```a2ui",
        '{"version":"v0.9","createSurface":{"surfaceId":"main","catalogId":"https://a2ui.org/specification/v0_9/basic_catalog.json"}}',
        '{"version":"v0.9","updateComponents":{"surfaceId":"main","components":[{"id":"root","component":"Column","children":["header","date-picker"]},{"id":"header","component":"Text","text":"# Book Your Table","variant":"h1"},{"id":"date-picker","component":"DateTimeInput","label":"Select Date","value":{"path":"/reservation/date"},"enableDate":true}]}}',
        '{"version":"v0.9","updateDataModel":{"surfaceId":"main","path":"/reservation","value":{"date":"2025-12-15"}}}',
        "```",
      ].join("\n"),
    );
    const { render, getValue } = renderHook({
      messages: [jsonlA2UIMessage],
    });

    await render({ messages: [jsonlA2UIMessage] });

    expect(getValue().pendingA2UIForm).toMatchObject({
      id: "surface-main",
      root: "root",
      data: {
        reservation: {
          date: "2025-12-15",
        },
      },
    });
    expect(getValue().pendingA2UIForm?.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "date-picker",
          component: "DateTimeInput",
        }),
      ]),
    );
    expect(getValue().pendingA2UISource).toEqual({
      kind: "assistant_message",
      messageId: "assistant-jsonl",
    });
    expect(getValue().a2uiSubmissionNotice).toBeNull();
  });

  it("历史问卷正文不应再生成 pending A2UI 表单", async () => {
    const legacyQuestionnaireMessage = createAssistantMessage(
      "assistant-legacy-questionnaire",
      `为了继续推进，我需要你先补充以下信息：

1. 目标与对象
- 这次内容主要面向谁？（客户 / 上级 / 同事）
- 这次最想达成的目标是什么？

2. 风格与限制
- 语气偏好：正式严谨 / 友好专业 / 直接高效
- 是否需要加入明确行动号召？`,
    );
    const { render, getValue } = renderHook({
      messages: [legacyQuestionnaireMessage],
    });

    await render({ messages: [legacyQuestionnaireMessage] });

    expect(getValue().pendingA2UIForm).toBeNull();
    expect(getValue().pendingA2UISource).toBeNull();
    expect(getValue().pendingActionRequest).toBeNull();
    expect(getValue().pendingPromotedA2UIActionRequest).toBeNull();
    expect(getValue().a2uiSubmissionNotice).toBeNull();
  });

  it("内联 A2UI 在消息内容短暂变成不完整 JSON 时应保留最后一份有效表单", async () => {
    const validA2UIMessage = createAssistantMessage(
      "assistant-a2ui",
      [
        "```a2ui",
        '{"type":"form","title":"补充信息","fields":[{"id":"answer","type":"text","label":"你的回答"}],"submitLabel":"继续处理"}',
        "```",
      ].join("\n"),
    );
    const truncatedA2UIMessage = createAssistantMessage(
      "assistant-a2ui",
      ["```a2ui", '{"type":"form","title":"补充信息"'].join("\n"),
    );
    const { render, getValue } = renderHook({
      messages: [validA2UIMessage],
    });

    await render({ messages: [validA2UIMessage] });
    expect(getValue().pendingA2UIForm?.components.length).toBeGreaterThan(0);
    expect(getValue().pendingA2UISource).toEqual({
      kind: "assistant_message",
      messageId: "assistant-a2ui",
    });
    expect(getValue().a2uiSubmissionNotice).toBeNull();

    await render({ messages: [truncatedA2UIMessage] });
    expect(getValue().pendingA2UIForm?.components.length).toBeGreaterThan(0);
    expect(getValue().pendingA2UISource).toEqual({
      kind: "assistant_message",
      messageId: "assistant-a2ui",
    });
    expect(getValue().a2uiSubmissionNotice).toBeNull();
  });

  it("promoted action_required 在 pending 短暂切到 queued 时应继续保留输入区 A2UI", async () => {
    const pendingMessage: Message = {
      id: "assistant-action",
      role: "assistant",
      content: "请补充执行偏好。",
      timestamp: new Date("2026-03-27T10:01:00.000Z"),
      actionRequests: [
        {
          requestId: "req-a2ui-1",
          actionType: "ask_user",
          prompt: "请选择执行模式",
          questions: [
            {
              question: "你希望如何执行？",
              header: "执行模式",
              options: [{ label: "自动执行" }, { label: "手动确认" }],
            },
          ],
          status: "pending",
        },
      ],
    };
    const queuedMessage: Message = {
      ...pendingMessage,
      actionRequests: [
        {
          ...pendingMessage.actionRequests![0],
          status: "queued",
        },
      ],
    };
    const { render, getValue } = renderHook({
      messages: [pendingMessage],
    });

    await render({ messages: [pendingMessage] });
    expect(getValue().pendingA2UIForm?.id).toBe("action-request-req-a2ui-1");
    expect(getValue().pendingA2UISource).toEqual({
      kind: "action_request",
      requestId: "req-a2ui-1",
    });

    await render({ messages: [queuedMessage] });
    expect(getValue().pendingA2UIForm?.id).toBe("action-request-req-a2ui-1");
    expect(getValue().pendingA2UISource).toEqual({
      kind: "action_request",
      requestId: "req-a2ui-1",
    });
    expect(getValue().a2uiSubmissionNotice).toBeNull();
  });

  it("action_required 提交后应清理旧输入区表单且不再显示确认提示", async () => {
    const pendingMessage: Message = {
      id: "assistant-action-submitted",
      role: "assistant",
      content: "请补充执行偏好。",
      timestamp: new Date("2026-03-27T10:01:00.000Z"),
      actionRequests: [
        {
          requestId: "req-a2ui-submitted",
          actionType: "ask_user",
          prompt: "请选择执行模式",
          questions: [
            {
              question: "你希望如何执行？",
              header: "执行模式",
              options: [{ label: "自动执行" }, { label: "手动确认" }],
            },
          ],
          status: "pending",
        },
      ],
    };
    const submittedMessage: Message = {
      ...pendingMessage,
      actionRequests: [
        {
          ...pendingMessage.actionRequests![0],
          status: "submitted",
        },
      ],
    };
    const { render, getValue } = renderHook({
      messages: [pendingMessage],
    });

    await render({ messages: [pendingMessage] });
    expect(getValue().pendingA2UIForm?.id).toBe(
      "action-request-req-a2ui-submitted",
    );

    await render({ messages: [submittedMessage] });
    expect(getValue().pendingA2UIForm).toBeNull();
    expect(getValue().pendingA2UISource).toBeNull();
    expect(getValue().a2uiSubmissionNotice).toBeNull();
  });

  it("线程已切走且源消息消失时，应清理保留中的旧 A2UI", async () => {
    const validA2UIMessage = createAssistantMessage(
      "assistant-old",
      [
        "```a2ui",
        '{"type":"form","title":"补充信息","fields":[{"id":"answer","type":"text","label":"你的回答"}],"submitLabel":"继续处理"}',
        "```",
      ].join("\n"),
    );
    const { render, getValue } = renderHook({
      messages: [validA2UIMessage],
    });

    await render({ messages: [validA2UIMessage] });
    expect(getValue().pendingA2UIForm?.components.length).toBeGreaterThan(0);

    await render({
      messages: [createUserMessage("user-new-thread", "这是新的会话内容")],
    });
    expect(getValue().pendingA2UIForm).toBeNull();
    expect(getValue().pendingA2UISource).toBeNull();
    expect(getValue().a2uiSubmissionNotice).toBeNull();
  });

  it("多问题 action_required 应只展示当前一问，并直接提交当前回答", async () => {
    const pendingMessage: Message = {
      id: "assistant-action-progressive",
      role: "assistant",
      content: "请补充执行偏好。",
      timestamp: new Date("2026-03-27T10:01:00.000Z"),
      actionRequests: [
        {
          requestId: "req-a2ui-progressive",
          actionType: "ask_user",
          prompt: "继续前先确认几个点",
          questions: [
            {
              question: "你要我先聚焦哪一部分？",
            },
            {
              question: "这一步更看重速度还是完整度？",
            },
            {
              question: "是否还有额外限制？",
            },
          ],
          status: "pending",
        },
      ],
    };
    const { render, getValue } = renderHook({
      messages: [pendingMessage],
    });

    await render({ messages: [pendingMessage] });

    expect(getValue().pendingA2UIForm?.data).toMatchObject({
      governance: {
        originalQuestionCount: 3,
        deferredQuestionCount: 2,
      },
    });
    expect(getValue().pendingA2UIForm?.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: "TextField",
          label: "你要我先聚焦哪一部分？",
        }),
      ]),
    );
    expect(getValue().pendingA2UIForm?.components).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "这一步更看重速度还是完整度？",
        }),
      ]),
    );

    const currentField = getValue().pendingA2UIForm?.components.find(
      (component) =>
        component.component === "TextField" && typeof component.id === "string",
    ) as { id: string } | undefined;

    let submissionResult:
      | ReturnType<ReturnType<typeof getValue>["resolvePendingA2UISubmit"]>
      | undefined;

    await act(async () => {
      submissionResult = getValue().resolvePendingA2UISubmit({
        [currentField?.id || ""]: "先看 A2UI 对话呈现",
      });
      await Promise.resolve();
    });

    expect(submissionResult).toMatchObject({
      status: "submit",
      formData: {
        [currentField?.id || ""]: "先看 A2UI 对话呈现",
      },
    });
  });
});
