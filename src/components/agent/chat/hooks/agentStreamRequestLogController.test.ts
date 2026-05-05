import { describe, expect, it } from "vitest";
import { buildAgentStreamRequestLogFinishPlan } from "./agentStreamRequestLogController";

describe("agentStreamRequestLogController", () => {
  it("无 requestLogId 时不应更新 activity log", () => {
    expect(
      buildAgentStreamRequestLogFinishPlan({
        requestLogId: null,
        requestFinished: false,
        requestStartedAt: 100,
        finishedAt: 180,
        payload: {
          eventType: "chat_request_complete",
          status: "success",
          description: "请求完成",
        },
      }),
    ).toEqual({
      shouldUpdate: false,
      nextRequestFinished: false,
      logId: null,
    });
  });

  it("request 已完成时不应重复更新 activity log", () => {
    expect(
      buildAgentStreamRequestLogFinishPlan({
        requestLogId: "log-a",
        requestFinished: true,
        requestStartedAt: 100,
        finishedAt: 180,
        payload: {
          eventType: "chat_request_complete",
          status: "success",
          description: "请求完成",
        },
      }),
    ).toEqual({
      shouldUpdate: false,
      nextRequestFinished: true,
      logId: "log-a",
    });
  });

  it("完成请求时应生成 success update payload 和 duration", () => {
    expect(
      buildAgentStreamRequestLogFinishPlan({
        requestLogId: "log-a",
        requestFinished: false,
        requestStartedAt: 100,
        finishedAt: 245,
        payload: {
          eventType: "chat_request_complete",
          status: "success",
          description: "请求完成，工具调用 2 次",
        },
      }),
    ).toEqual({
      shouldUpdate: true,
      nextRequestFinished: true,
      logId: "log-a",
      updatePayload: {
        eventType: "chat_request_complete",
        status: "success",
        duration: 145,
        description: "请求完成，工具调用 2 次",
        error: undefined,
      },
    });
  });

  it("失败请求时应保留 error 字段", () => {
    expect(
      buildAgentStreamRequestLogFinishPlan({
        requestLogId: "log-b",
        requestFinished: false,
        requestStartedAt: 200,
        finishedAt: 260,
        payload: {
          eventType: "chat_request_error",
          status: "error",
          error: "模型未输出最终答复",
        },
      }),
    ).toEqual({
      shouldUpdate: true,
      nextRequestFinished: true,
      logId: "log-b",
      updatePayload: {
        eventType: "chat_request_error",
        status: "error",
        duration: 60,
        description: undefined,
        error: "模型未输出最终答复",
      },
    });
  });
});
