import { describe, expect, it } from "vitest";

import type { Message } from "../types";
import {
  buildLiveTaskSnapshot,
  deriveTaskLiveState,
  deriveTaskStatusFromLiveState,
  extractTaskPreviewFromMessages,
} from "./agentChatShared";

function createBrowserPreflightMessages(): Message[] {
  return createBrowserPreflightMessagesByPhase("failed");
}

function createBrowserPreflightMessagesByPhase(
  phase: "launching" | "awaiting_user" | "ready_to_resume" | "failed" = "failed",
): Message[] {
  const startedAt = new Date("2026-03-15T09:45:00.000Z");
  const detail =
    phase === "launching"
      ? "正在尝试建立浏览器会话，请稍候..."
      : phase === "awaiting_user" || phase === "ready_to_resume"
        ? "已为你打开浏览器。请先完成登录、扫码或验证码，然后继续当前任务。"
        : "还没有建立可用的浏览器会话。请确认本机浏览器/CDP 可用后重试。";

  return [
    {
      id: "msg-user",
      role: "user",
      content: "帮我把文章发布到微信公众号",
      timestamp: startedAt,
    },
    {
      id: "msg-assistant-failed",
      role: "assistant",
      content: "",
      timestamp: new Date(startedAt.getTime() + 1000),
      toolCalls: [
        {
          id: "tool-cdp-failed",
          name: "browser_connect",
          arguments: JSON.stringify({ url: "https://mp.weixin.qq.com" }),
          status: "failed",
          startTime: new Date(startedAt.getTime() + 1000),
          endTime: new Date(startedAt.getTime() + 2000),
        },
      ],
    },
    {
      id: "msg-preflight-user",
      role: "user",
      content: "帮我把文章发布到微信公众号",
      timestamp: new Date(startedAt.getTime() + 3000),
    },
    {
      id: "msg-preflight-assistant",
      role: "assistant",
      content: "",
      timestamp: new Date(startedAt.getTime() + 3001),
      actionRequests: [
        {
          requestId: "browser-preflight-1",
          actionType: "ask_user",
          uiKind: "browser_preflight",
          browserRequirement: "required_with_user_step",
          browserPrepState: phase,
          prompt: "该任务需要真实浏览器执行，不能仅靠网页检索完成。",
          detail,
        },
      ],
      contentParts: [
        {
          type: "action_required",
          actionRequired: {
            requestId: "browser-preflight-1",
            actionType: "ask_user",
            uiKind: "browser_preflight",
            browserRequirement: "required_with_user_step",
            browserPrepState: phase,
            prompt: "该任务需要真实浏览器执行，不能仅靠网页检索完成。",
            detail,
          },
        },
      ],
    },
  ];
}

describe("agentChatShared", () => {
  it("浏览器预检未提交时应优先判定为待处理", () => {
    const messages = createBrowserPreflightMessages();

    expect(
      deriveTaskStatusFromLiveState({
        messages,
        isSending: false,
        pendingActionCount: 0,
        workspaceError: false,
      }),
    ).toBe("waiting");

    expect(
      buildLiveTaskSnapshot({
        messages,
        isSending: false,
        pendingActionCount: 0,
        workspaceError: false,
      }),
    ).toEqual(
      expect.objectContaining({
        status: "waiting",
        statusReason: "browser_failed",
      }),
    );

    expect(
      deriveTaskLiveState({
        messages,
        isSending: false,
        pendingActionCount: 0,
        workspaceError: false,
      }),
    ).toEqual({
      status: "waiting",
      statusReason: "browser_failed",
    });
  });

  it("应优先展示浏览器预检的待继续摘要", () => {
    const messages = createBrowserPreflightMessages();

    expect(extractTaskPreviewFromMessages(messages)).toBe(
      "还没有建立可用的浏览器会话。请确认本机浏览器/CDP 可用后重试。",
    );
  });

  it("应按浏览器预检阶段映射不同状态原因", () => {
    expect(
      deriveTaskLiveState({
        messages: createBrowserPreflightMessagesByPhase("launching"),
        isSending: false,
        pendingActionCount: 0,
        workspaceError: false,
      }),
    ).toEqual({
      status: "waiting",
      statusReason: "browser_launching",
    });

    expect(
      deriveTaskLiveState({
        messages: createBrowserPreflightMessagesByPhase("awaiting_user"),
        isSending: false,
        pendingActionCount: 0,
        workspaceError: false,
      }),
    ).toEqual({
      status: "waiting",
      statusReason: "browser_awaiting_user",
    });
  });
});
